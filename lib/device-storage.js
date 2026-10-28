const fs = require('fs');
const path = require('path');
const { encryptSecret, decryptSecret, maskSecret } = require('./crypto-vault');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DEVICES_FILE)) {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
}

function getAllDeviceConfigs() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    const parsed = JSON.parse(raw) || {};

    // Decrypt tokens in memory
    const resolved = {};
    for (const [id, dev] of Object.entries(parsed)) {
      let token = '';
      if (dev.encryptedApiToken) {
        token = decryptSecret(dev.encryptedApiToken);
      } else if (dev.apiToken) {
        // Migrate plaintext legacy token to encrypted
        token = dev.apiToken;
      }
      resolved[id] = {
        ...dev,
        apiToken: token
      };
    }
    return resolved;
  } catch (err) {
    console.error('[DEVICE-STORAGE] Error reading devices file:', err.message);
    return {};
  }
}

function getDeviceConfig(deviceId) {
  if (!deviceId) return null;
  const devices = getAllDeviceConfigs();
  return devices[deviceId] || null;
}

function saveDeviceConfig(deviceId, configData) {
  if (!deviceId) return null;
  ensureDataDir();
  const rawDevices = (() => {
    try {
      return JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')) || {};
    } catch {
      return {};
    }
  })();

  const existing = rawDevices[deviceId] || {};
  let tokenToEncrypt = '';

  if (configData.apiToken !== undefined && configData.apiToken.trim() !== '') {
    tokenToEncrypt = configData.apiToken.trim();
  } else if (existing.encryptedApiToken) {
    tokenToEncrypt = decryptSecret(existing.encryptedApiToken);
  } else if (existing.apiToken) {
    tokenToEncrypt = existing.apiToken;
  }

  const updatedRecord = {
    ...existing,
    deviceId,
    accountId: configData.accountId !== undefined && configData.accountId.trim() !== '' ? configData.accountId.trim() : existing.accountId || '',
    encryptedApiToken: tokenToEncrypt ? encryptSecret(tokenToEncrypt) : '',
    projectName: configData.projectName !== undefined && configData.projectName.trim() !== '' ? configData.projectName.trim() : existing.projectName || 'random-pages-vault',
    dailyFreeLimit: configData.dailyFreeLimit !== undefined ? parseInt(configData.dailyFreeLimit, 10) : existing.dailyFreeLimit || 100,
    updatedAt: new Date().toISOString()
  };

  // Ensure no plaintext token is stored in JSON
  delete updatedRecord.apiToken;

  rawDevices[deviceId] = updatedRecord;

  // Atomic write
  const tempFile = `${DEVICES_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(rawDevices, null, 2), 'utf8');
  fs.renameSync(tempFile, DEVICES_FILE);

  return {
    deviceId,
    accountIdMasked: updatedRecord.accountId ? maskSecret(updatedRecord.accountId) : null,
    projectName: updatedRecord.projectName,
    hasToken: Boolean(tokenToEncrypt),
    dailyFreeLimit: updatedRecord.dailyFreeLimit,
    updatedAt: updatedRecord.updatedAt
  };
}

function listRegisteredDevices() {
  const devices = getAllDeviceConfigs();
  return Object.keys(devices).map(id => ({
    deviceId: id,
    projectName: devices[id].projectName,
    hasToken: Boolean(devices[id].apiToken),
    updatedAt: devices[id].updatedAt
  }));
}

module.exports = {
  getDeviceConfig,
  saveDeviceConfig,
  listRegisteredDevices
};
