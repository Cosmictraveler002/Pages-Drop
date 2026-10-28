const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

// Ensure directory and devices file exist
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DEVICES_FILE)) {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify({}, null, 2), 'utf8');
  }
}

// In-memory rate limiting stores
const unauthRateLimit = new Map(); // ip -> { count, resetTime }
const failedAuthAttempts = new Map(); // ipOrDevice -> { attempts, lockedUntil }

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
}

function checkUnauthRateLimit(ip) {
  const now = Date.now();
  const entry = unauthRateLimit.get(ip) || { count: 0, resetTime: now + 60000 };
  if (now > entry.resetTime) {
    entry.count = 0;
    entry.resetTime = now + 60000;
  }
  entry.count++;
  unauthRateLimit.set(ip, entry);
  return entry.count <= 30; // Max 30 requests per minute
}

function checkFailedAuth(ip) {
  const now = Date.now();
  const entry = failedAuthAttempts.get(ip);
  if (!entry) return true;
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return false; // Still locked
  }
  if (entry.lockedUntil && now >= entry.lockedUntil) {
    failedAuthAttempts.delete(ip);
    return true;
  }
  return true;
}

function recordFailedAuth(ip) {
  const now = Date.now();
  const entry = failedAuthAttempts.get(ip) || { attempts: 0, lockedUntil: null };
  entry.attempts++;
  if (entry.attempts >= 5) {
    entry.lockedUntil = now + (15 * 60 * 1000); // Lock for 15 minutes
  }
  failedAuthAttempts.set(ip, entry);
}

function resetFailedAuth(ip) {
  failedAuthAttempts.delete(ip);
}

function getAllDevices() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
    const parsed = JSON.parse(raw) || {};
    if (parsed.devices && typeof parsed.devices === 'object') {
      return parsed.devices;
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveAllDevices(devices) {
  ensureDataDir();
  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')) || {};
  } catch (_) {}

  const updatedStore = {
    ...store,
    schemaVersion: 1,
    devices
  };

  const tempFile = `${DEVICES_FILE}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(updatedStore, null, 2), 'utf8');
  fs.renameSync(tempFile, DEVICES_FILE);
}

function validateDeviceId(deviceId) {
  return typeof deviceId === 'string' && /^DEV-[A-Z0-9]{16}$/.test(deviceId);
}

function issueDeviceCredentials() {
  ensureDataDir();
  const randomHex = crypto.randomBytes(8).toString('hex').toUpperCase(); // 16 chars
  const deviceId = `DEV-${randomHex}`;
  const secret = crypto.randomBytes(32).toString('hex'); // 32 bytes -> 64 hex
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

  const devices = getAllDevices();
  devices[deviceId] = {
    deviceId,
    secretHash,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveAllDevices(devices);

  return { deviceId, secret };
}

function verifyDeviceSecret(deviceId, secret) {
  if (!validateDeviceId(deviceId) || typeof secret !== 'string' || !secret) {
    return false;
  }
  const devices = getAllDevices();
  const dev = devices[deviceId];
  if (!dev || !dev.secretHash) {
    return false;
  }

  const candidateHash = crypto.createHash('sha256').update(secret).digest('hex');
  const bufA = Buffer.from(candidateHash, 'utf8');
  const bufB = Buffer.from(dev.secretHash, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  header.split(';').forEach(pair => {
    const [name, ...val] = pair.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(val.join('='));
  });
  return cookies;
}

function setDeviceSecretCookie(res, secret, req) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `device_secret=${encodeURIComponent(secret)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Authentication & boundary middleware
function authMiddleware(req, res, next) {
  // Allow registration endpoint without prior auth
  if (req.path === '/api/auth/register') {
    return next();
  }

  const ip = getClientIp(req);

  // Check brute force lockout
  if (!checkFailedAuth(ip)) {
    return res.status(429).json({
      success: false,
      error: 'Too many failed authentication attempts. Access locked for 15 minutes.'
    });
  }

  // Extract Device ID
  const deviceId = req.headers['x-device-id'] || req.query.deviceId || (req.body && req.body.deviceId);

  if (!deviceId || !validateDeviceId(deviceId)) {
    recordFailedAuth(ip);
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing Device ID. Format must be DEV-[A-Z0-9]{16}.'
    });
  }

  // Extract Secret from HttpOnly cookie or header
  const cookies = parseCookies(req);
  const secret = cookies.device_secret || req.headers['x-device-secret'];

  if (!secret || !verifyDeviceSecret(deviceId, secret)) {
    recordFailedAuth(ip);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed: Invalid device credentials.'
    });
  }

  // Authentication succeeded
  resetFailedAuth(ip);
  req.deviceId = deviceId;
  next();
}

// Origin & Host header validation for state-changing requests
function originCheckMiddleware(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.headers.origin;
    const host = req.headers.host;

    if (origin && host) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host !== host) {
          return res.status(403).json({
            success: false,
            error: 'Cross-origin state-changing request blocked.'
          });
        }
      } catch {
        return res.status(403).json({
          success: false,
          error: 'Malformed Origin header.'
        });
      }
    }
  }
  next();
}

module.exports = {
  validateDeviceId,
  issueDeviceCredentials,
  verifyDeviceSecret,
  parseCookies,
  setDeviceSecretCookie,
  authMiddleware,
  originCheckMiddleware,
  checkUnauthRateLimit,
  getClientIp,
  resetFailedAuth
};
