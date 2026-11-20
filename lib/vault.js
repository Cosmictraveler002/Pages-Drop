const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDeviceConfig, saveDeviceConfig } = require('./device-storage');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const VAULTS_DIR = path.join(DATA_DIR, 'vaults');

function ensureVaultsDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(VAULTS_DIR)) {
    fs.mkdirSync(VAULTS_DIR, { recursive: true });
  }
}

/**
 * Derives a 32-byte AES key using HKDF from deviceSecret and deviceId.
 */
function deriveKey(deviceSecret, deviceId) {
  if (!deviceSecret || !deviceId) {
    throw new Error('Both deviceSecret and deviceId are required for HKDF key derivation.');
  }
  const ikm = Buffer.from(deviceSecret, 'utf8');
  const salt = Buffer.from(deviceId, 'utf8');
  const info = Buffer.from('cloudflare-connect-vault', 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32));
}

/**
 * Encrypts arbitrary vault data with AES-256-GCM.
 */
function encryptVaultData(data, deviceSecret, deviceId) {
  const key = deriveKey(deviceSecret, deviceId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const jsonStr = JSON.stringify(data);
  let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    version: 1,
    iv: iv.toString('hex'),
    authTag,
    ciphertext: encrypted
  };
}

/**
 * Decrypts AES-256-GCM vault data.
 */
function decryptVaultData(encryptedObj, deviceSecret, deviceId) {
  if (!encryptedObj || !encryptedObj.iv || !encryptedObj.authTag || !encryptedObj.ciphertext) {
    return null;
  }
  const key = deriveKey(deviceSecret, deviceId);
  const iv = Buffer.from(encryptedObj.iv, 'hex');
  const authTag = Buffer.from(encryptedObj.authTag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(encryptedObj.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    console.error('[VAULT] Failed to decrypt vault for device', deviceId, err.message);
    return null;
  }
}

/**
 * Saves connection credentials in the encrypted device vault file and syncs with device-storage.
 */
function saveVault(deviceId, deviceSecret, vaultData) {
  ensureVaultsDir();
  const filePath = path.join(VAULTS_DIR, `${deviceId}.json`);
  const encryptedPayload = encryptVaultData(vaultData, deviceSecret, deviceId);

  // Atomic file write
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(encryptedPayload, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);

  // Sync to device-storage so legacy readers and deployment pipelines get updated configuration
  saveDeviceConfig(deviceId, {
    accountId: vaultData.accountId,
    apiToken: vaultData.apiToken,
    projectName: vaultData.projectName || 'random-pages-vault',
    dailyFreeLimit: vaultData.dailyFreeLimit || 100
  });

  return {
    success: true,
    accountId: vaultData.accountId,
    accountName: vaultData.accountName || 'Primary Account',
    email: vaultData.email || null,
    projectName: vaultData.projectName || 'random-pages-vault'
  };
}

/**
 * Loads and decrypts credentials from the device vault.
 */
function loadVault(deviceId, deviceSecret) {
  ensureVaultsDir();
  const filePath = path.join(VAULTS_DIR, `${deviceId}.json`);

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const decrypted = decryptVaultData(parsed, deviceSecret, deviceId);
      if (decrypted) return decrypted;
    } catch (err) {
      console.warn('[VAULT] Error reading vault file:', err.message);
    }
  }

  // Fallback to device storage
  const devCfg = getDeviceConfig(deviceId);
  if (devCfg && devCfg.apiToken) {
    return {
      apiToken: devCfg.apiToken,
      accountId: devCfg.accountId,
      projectName: devCfg.projectName,
      accountName: 'Configured Account',
      email: null
    };
  }

  return null;
}

/**
 * Deletes vault file and revokes credentials from device storage.
 */
function deleteVault(deviceId) {
  ensureVaultsDir();
  const filePath = path.join(VAULTS_DIR, `${deviceId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }

  // Clear credentials in device-storage
  const existing = getDeviceConfig(deviceId);
  if (existing) {
    saveDeviceConfig(deviceId, {
      accountId: '',
      apiToken: '',
      projectName: existing.projectName || 'random-pages-vault'
    });
  }

  return { success: true, disconnected: true };
}

// In-memory rate limiting for connection attempts: max 5 per minute per device
const connectRateLimits = new Map();

function checkConnectRateLimit(deviceId) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = connectRateLimits.get(deviceId) || { count: 0, resetTime: now + windowMs };

  if (now > entry.resetTime) {
    entry.count = 0;
    entry.resetTime = now + windowMs;
  }

  entry.count++;
  connectRateLimits.set(deviceId, entry);

  return entry.count <= 5;
}

module.exports = {
  VAULTS_DIR,
  deriveKey,
  encryptVaultData,
  decryptVaultData,
  saveVault,
  loadVault,
  deleteVault,
  checkConnectRateLimit
};
