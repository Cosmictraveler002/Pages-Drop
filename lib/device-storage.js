const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encryptSecret, decryptSecret, maskSecret } = require('./crypto-vault');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const CURRENT_SCHEMA_VERSION = 1;

let isDevicesCorrupted = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Atomic write helper: writes to a unique temporary file in the same directory,
 * flushes buffers to disk via fsync, and atomically renames over the target file.
 */
function atomicWriteFileSync(filePath, content) {
  ensureDataDir();
  const dir = path.dirname(filePath);
  const tempFile = path.join(dir, `${path.basename(filePath)}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  const fd = fs.openSync(tempFile, 'w');
  try {
    fs.writeSync(fd, data, 0, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tempFile, filePath);
}

/**
 * Reads and validates devices.json store.
 * - Handles JSON corruption by creating a timestamped backup and refusing further writes.
 * - Migrates legacy format to schemaVersion: 1.
 * - Rejects unknown newer schema versions without overwriting.
 * - Preserves unknown fields on the store object.
 */
function readDevicesStore() {
  ensureDataDir();

  if (isDevicesCorrupted) {
    const err = new Error('Devices data store is corrupted. Refusing operations until manual resolution.');
    err.code = 'STORE_CORRUPTED';
    throw err;
  }

  if (!fs.existsSync(DEVICES_FILE)) {
    const initialStore = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      devices: {}
    };
    atomicWriteFileSync(DEVICES_FILE, initialStore);
    return initialStore;
  }

  let raw = '';
  try {
    raw = fs.readFileSync(DEVICES_FILE, 'utf8');
  } catch (err) {
    console.error('[STORAGE I/O ERROR] Could not read devices.json:', err.message);
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    isDevicesCorrupted = true;
    const corruptBak = path.join(DATA_DIR, `devices.corrupt.${Date.now()}.bak`);
    try {
      fs.copyFileSync(DEVICES_FILE, corruptBak);
    } catch (_) {}

    console.error(`[STORAGE CORRUPTION] devices.json failed to parse. Copied to ${corruptBak}. Refusing writes.`);
    const err = new Error(`Data store corrupted: devices.json. Backed up to ${path.basename(corruptBak)}. Refusing writes until resolved.`);
    err.code = 'STORE_CORRUPTED';
    throw err;
  }

  // Schema Migration & Validation
  // 1. Legacy format: devices.json had no schemaVersion and devices directly at root
  if (!parsed.schemaVersion && !parsed.devices) {
    const migrated = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      devices: parsed
    };
    try {
      atomicWriteFileSync(DEVICES_FILE, migrated);
    } catch (writeErr) {
      console.warn('[STORAGE] Failed to persist migrated devices schema:', writeErr.message);
    }
    return migrated;
  }

  // 2. Reject unknown newer versions without overwriting
  const version = parsed.schemaVersion || CURRENT_SCHEMA_VERSION;
  if (version > CURRENT_SCHEMA_VERSION) {
    const err = new Error(`Unsupported newer schemaVersion: ${version}. Maximum supported version is ${CURRENT_SCHEMA_VERSION}.`);
    err.code = 'UNKNOWN_SCHEMA_VERSION';
    throw err;
  }

  if (!parsed.devices || typeof parsed.devices !== 'object') {
    parsed.devices = {};
  }

  return parsed;
}

function getAllDeviceConfigs() {
  try {
    const store = readDevicesStore();
    const rawDevices = store.devices || {};

    // Decrypt tokens in memory
    const resolved = {};
    for (const [id, dev] of Object.entries(rawDevices)) {
      let token = '';
      if (dev.encryptedApiToken) {
        token = decryptSecret(dev.encryptedApiToken);
      } else if (dev.apiToken) {
        // Plaintext fallback
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
    throw err;
  }
}

function getDeviceConfig(deviceId) {
  if (!deviceId) return null;
  const devices = getAllDeviceConfigs();
  return devices[deviceId] || null;
}

function saveDeviceConfig(deviceId, configData) {
  if (!deviceId) return null;

  try {
    const store = readDevicesStore();
    const devices = store.devices || {};
    const existing = devices[deviceId] || {};
    let tokenToEncrypt = '';

    if (configData.apiToken !== undefined) {
      tokenToEncrypt = configData.apiToken.trim();
    } else if (existing.encryptedApiToken) {
      tokenToEncrypt = decryptSecret(existing.encryptedApiToken);
    } else if (existing.apiToken) {
      tokenToEncrypt = existing.apiToken;
    }

    const targetAccountId = (configData.accountId !== undefined)
      ? configData.accountId.trim()
      : (existing.accountId || '');

    const updatedRecord = {
      ...existing,
      deviceId,
      accountId: targetAccountId,
      encryptedApiToken: tokenToEncrypt ? encryptSecret(tokenToEncrypt) : '',
      projectName: configData.projectName !== undefined && configData.projectName.trim() !== '' ? configData.projectName.trim() : existing.projectName || 'random-pages-vault',
      dailyFreeLimit: configData.dailyFreeLimit !== undefined ? parseInt(configData.dailyFreeLimit, 10) : existing.dailyFreeLimit || 100,
      updatedAt: new Date().toISOString()
    };

    // Ensure no plaintext token is stored in JSON
    delete updatedRecord.apiToken;

    devices[deviceId] = updatedRecord;

    // Preserve unknown fields on store
    const updatedStore = {
      ...store,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      devices
    };

    atomicWriteFileSync(DEVICES_FILE, updatedStore);

    return {
      deviceId,
      accountIdMasked: updatedRecord.accountId ? maskSecret(updatedRecord.accountId) : null,
      projectName: updatedRecord.projectName,
      hasToken: Boolean(tokenToEncrypt),
      dailyFreeLimit: updatedRecord.dailyFreeLimit,
      updatedAt: updatedRecord.updatedAt
    };
  } catch (err) {
    console.error('[DEVICE-STORAGE] Error saving device config:', err.message);
    throw err;
  }
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

function resetDevicesCorruptionState() {
  isDevicesCorrupted = false;
}

module.exports = {
  getDeviceConfig,
  saveDeviceConfig,
  listRegisteredDevices,
  resetDevicesCorruptionState
};
