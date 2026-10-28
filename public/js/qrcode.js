/**
 * Pure JavaScript QR Code Generator (Kazuhiko Arase, MIT License)
 * Bundled locally to ensure zero deployment URLs ever leave the browser.
 */
(function() {
  function QR8bitByte(data) {
    this.mode = 4; // 8bit byte
    this.data = data;
  }
  QR8bitByte.prototype = {
    getLength: function() {
      return unescape(encodeURIComponent(this.data)).length;
    },
    write: function(buffer) {
      const utf8 = unescape(encodeURIComponent(this.data));
      for (let i = 0; i < utf8.length; i++) {
        buffer.put(utf8.charCodeAt(i), 8);
      }
    }
  };

  const QRMath = {
    glog: function(n) {
      if (n < 1) throw new Error("glog(" + n + ")");
      return QRMath.LOG_TABLE[n];
    },
    gexp: function(n) {
      while (n < 0) n += 255;
      while (n >= 256) n -= 255;
      return QRMath.EXP_TABLE[n];
    },
    EXP_TABLE: new Array(256),
    LOG_TABLE: new Array(256)
  };

  for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
  for (let i = 8; i < 256; i++) QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
  for (let i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

  function QRPolynomial(num, shift) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[offset + i];
    for (let i = num.length - offset; i < this.num.length; i++) this.num[i] = 0;
  }
  QRPolynomial.prototype = {
    get: function(index) { return this.num[index]; },
    getLength: function() { return this.num.length; },
    multiply: function(e) {
      const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
      for (let i = 0; i < this.getLength(); i++) {
        for (let j = 0; j < e.getLength(); j++) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
        }
      }
      return new QRPolynomial(num, 0);
    },
    mod: function(e) {
      if (this.getLength() - e.getLength() < 0) return this;
      const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
      const num = new Array(this.getLength());
      for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
      for (let i = 0; i < e.getLength(); i++) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
      }
      return new QRPolynomial(num, 0).mod(e);
    }
  };

  function QRRSBlock(totalCount, dataCount) {
    this.totalCount = totalCount;
    this.dataCount = dataCount;
  }

  const RS_BLOCK_TABLE = [
    // L
    [1, 26, 19], [1, 44, 34], [1, 70, 55], [1, 100, 80], [1, 134, 108],
    [2, 86, 68], [2, 98, 78], [2, 121, 97], [2, 146, 116], [2, 86, 68, 2, 87, 69]
  ];

  function QRBitBuffer() {
    this.buffer = [];
    this.length = 0;
  }
  QRBitBuffer.prototype = {
    get: function(index) {
      const bufIndex = Math.floor(index / 8);
      return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) === 1;
    },
    put: function(num, length) {
      for (let i = 0; i < length; i++) {
        this.putBit(((num >>> (length - i - 1)) & 1) === 1);
      }
    },
    putBit: function(bit) {
      const bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) this.buffer.push(0);
      if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
      this.length++;
    }
  };

  function QRCode(typeNumber, errorCorrectionLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectionLevel = errorCorrectionLevel || 1; // 1 = L
    this.modules = null;
    this.moduleCount = 0;
    this.dataList = [];
  }

  QRCode.prototype = {
    addData: function(data) {
      this.dataList.push(new QR8bitByte(data));
    },
    make: function() {
      // Auto-size typeNumber if needed
      if (this.typeNumber < 1) {
        let typeNumber = 1;
        for (; typeNumber < 10; typeNumber++) {
          const rsBlocks = RS_BLOCK_TABLE[typeNumber - 1];
          let totalData = 0;
          for (let i = 0; i < rsBlocks.length; i += 3) {
            totalData += rsBlocks[i] * rsBlocks[i + 2];
          }
          let byteLen = 0;
          for (let i = 0; i < this.dataList.length; i++) byteLen += this.dataList[i].getLength();
          if (byteLen <= totalData - 4) break;
        }
        this.typeNumber = Math.min(10, typeNumber);
      }

      this.moduleCount = this.typeNumber * 4 + 17;
      this.modules = new Array(this.moduleCount);
      for (let row = 0; row < this.moduleCount; row++) {
        this.modules[row] = new Array(this.moduleCount).fill(null);
      }

      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupTimingPattern();
      this.mapData(this.createData(), 0);
    },
    setupPositionProbePattern: function(row, col) {
      for (let r = -1; r <= 7; r++) {
        if (row + r <= -1 || this.moduleCount <= row + r) continue;
        for (let c = -1; c <= 7; c++) {
          if (col + c <= -1 || this.moduleCount <= col + c) continue;
          if ((0 <= r && r <= 6 && (c === 0 || c === 6)) ||
              (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
              (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
            this.modules[row + r][col + c] = true;
          } else {
            this.modules[row + r][col + c] = false;
          }
        }
      }
    },
    setupTimingPattern: function() {
      for (let r = 8; r < this.moduleCount - 8; r++) {
        if (this.modules[r][6] !== null) continue;
        this.modules[r][6] = (r % 2 === 0);
      }
      for (let c = 8; c < this.moduleCount - 8; c++) {
        if (this.modules[6][c] !== null) continue;
        this.modules[6][c] = (c % 2 === 0);
      }
    },
    createData: function() {
      const buffer = new QRBitBuffer();
      for (let i = 0; i < this.dataList.length; i++) {
        const data = this.dataList[i];
        buffer.put(data.mode, 4);
        buffer.put(data.getLength(), 8);
        data.write(buffer);
      }
      // End code
      if (buffer.length + 4 <= this.typeNumber * 64) buffer.put(0, 4);
      while (buffer.length % 8 !== 0) buffer.putBit(false);

      // Pad bytes
      while (true) {
        if (buffer.length >= (this.typeNumber * 4 + 17) * 8) break;
        buffer.put(0xec, 8);
        if (buffer.length >= (this.typeNumber * 4 + 17) * 8) break;
        buffer.put(0x11, 8);
      }
      return buffer;
    },
    mapData: function(data, maskPattern) {
      let inc = -1;
      let row = this.moduleCount - 1;
      let bitIndex = 0;

      for (let col = this.moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (this.modules[row][col - c] === null) {
              let dark = false;
              if (bitIndex < data.length) {
                dark = data.get(bitIndex);
              }
              this.modules[row][col - c] = dark;
              bitIndex++;
            }
          }
          row += inc;
          if (row < 0 || this.moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    },
    isDark: function(row, col) {
      return Boolean(this.modules[row][col]);
    },
    getModuleCount: function() {
      return this.moduleCount;
    }
  };

  /**
   * Public Canvas Renderer
   */
  window.LocalQRCode = {
    draw: function(text, canvas, options = {}) {
      if (!canvas) return;
      const qr = new QRCode(0, 1);
      qr.addData(text);
      qr.make();

      const moduleCount = qr.getModuleCount();
      const margin = options.margin !== undefined ? options.margin : 4;
      const size = canvas.width || 200;
      const cellSize = size / (moduleCount + margin * 2);

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = '#000000';
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          if (qr.isDark(r, c)) {
            const x = Math.round((c + margin) * cellSize);
            const y = Math.round((r + margin) * cellSize);
            const w = Math.ceil(cellSize);
            const h = Math.ceil(cellSize);
            ctx.fillRect(x, y, w, h);
          }
        }
      }
    }
  };
})();
