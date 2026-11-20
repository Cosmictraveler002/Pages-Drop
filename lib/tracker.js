const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getConfig } = require('./config');
const cfApi = require('./cf-api');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEPLOYMENTS_FILE = path.join(DATA_DIR, 'deployments.json');
const CURRENT_SCHEMA_VERSION = 1;

// Write mutex queue: serializes all writes to avoid concurrent read-modify-write races
let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  const next = writeQueue.then(() => fn(), () => fn());
  writeQueue = next.catch(() => {});
  return next;
}

// Track corruption state in memory so subsequent write calls refuse to run until resolved
let isDeploymentsCorrupted = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Atomic write helper: writes to a unique temporary file in the same directory,
 * flushes buffers to disk via fsync, and atomically renames over the target file.
 *
 * @param {string} filePath - Absolute destination file path
 * @param {Object|string} content - Data to write
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

  // Windows file locking retry logic for atomic rename
  const maxRetries = 8;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      fs.renameSync(tempFile, filePath);
      return;
    } catch (err) {
      if ((err.code === 'EPERM' || err.code === 'EBUSY') && attempt < maxRetries) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * (attempt + 1));
        continue;
      }
      try { fs.unlinkSync(tempFile); } catch (_) {}
      throw err;
    }
  }
}

/**
 * Reads and validates deployments.json store.
 * - Handles JSON corruption by creating a timestamped backup and refusing further writes.
 * - Migrates legacy array data to schemaVersion: 1.
 * - Rejects unknown newer schema versions without overwriting.
 * - Preserves unknown fields on the store object.
 */
function readDeploymentsStore() {
  ensureDataDir();

  if (isDeploymentsCorrupted) {
    const err = new Error('Deployments data store is corrupted. Refusing operations until manual resolution.');
    err.code = 'STORE_CORRUPTED';
    throw err;
  }

  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    const initialStore = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      records: []
    };
    atomicWriteFileSync(DEPLOYMENTS_FILE, initialStore);
    return initialStore;
  }

  let raw = '';
  try {
    raw = fs.readFileSync(DEPLOYMENTS_FILE, 'utf8');
  } catch (err) {
    console.error('[STORAGE I/O ERROR] Could not read deployments.json:', err.message);
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    isDeploymentsCorrupted = true;
    const corruptBak = path.join(DATA_DIR, `deployments.corrupt.${Date.now()}.bak`);
    try {
      fs.copyFileSync(DEPLOYMENTS_FILE, corruptBak);
    } catch (_) {}

    console.error(`[STORAGE CORRUPTION] deployments.json failed to parse. Copied to ${corruptBak}. Refusing writes.`);
    const err = new Error(`Data store corrupted: deployments.json. Backed up to ${path.basename(corruptBak)}. Refusing writes until resolved.`);
    err.code = 'STORE_CORRUPTED';
    throw err;
  }

  // Schema Migration & Validation
  // 1. Legacy format: deployments.json was a raw array `[ ... ]`
  if (Array.isArray(parsed)) {
    const migrated = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      records: parsed
    };
    try {
      atomicWriteFileSync(DEPLOYMENTS_FILE, migrated);
    } catch (writeErr) {
      console.warn('[STORAGE] Failed to persist migrated schema:', writeErr.message);
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

  if (!Array.isArray(parsed.records)) {
    parsed.records = [];
  }

  return parsed;
}

/**
 * Returns deployments matching deviceId (or all deployments if deviceId is null).
 * Supports options.includeShared to include CLI deployments and Cloudflare-synced records (deviceId === null).
 *
 * @param {string|null} deviceId
 * @param {Object|boolean} [options] - Options object or boolean includeShared flag
 * @returns {Array} Array of deployment records
 */
function getLocalDeployments(deviceId = null, options = {}) {
  try {
    const store = readDeploymentsStore();
    const records = store.records || [];
    if (!deviceId) {
      return records;
    }
    const includeShared = typeof options === 'boolean' ? options : Boolean(options && options.includeShared);
    const all = Boolean(options && options.all);
    if (all) {
      return records;
    }
    return records.filter(d => d.deviceId === deviceId || (includeShared && !d.deviceId));
  } catch (err) {
    console.error('[STORAGE] Error reading deployments:', err.message);
    throw err;
  }
}

/**
 * Saves a deployment record. Serialized through the write queue.
 * Stores deviceId and preserves unknown store fields.
 *
 * @param {Object} record
 * @returns {Promise<Object>} Newly created deployment record
 */
async function saveDeploymentRecord(record) {
  return enqueueWrite(async () => {
    try {
      const store = readDeploymentsStore();
      const records = store.records || [];

      let defaultProject = 'random-pages-vault';
      try {
        const cfg = getConfig(record.deviceId);
        if (cfg && cfg.projectName) defaultProject = cfg.projectName;
      } catch (_) {}

      const newRecord = {
        id: record.id || `dep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        deviceId: record.deviceId || null,
        projectName: record.projectName || defaultProject,
        slug: record.slug,
        title: record.title || 'Untitled Static Page',
        template: record.template || 'landing',
        mode: record.mode || 'branch',
        url: record.url,
        canonicalUrl: record.canonicalUrl || record.url,
        cfDeploymentId: record.cfDeploymentId || null,
        isSimulation: Boolean(record.isSimulation),
        created_at: record.created_at || new Date().toISOString(),
        status: record.status || 'active',
        pausedAt: record.pausedAt || null,
        prePauseUrl: record.prePauseUrl || null,
        redeployCount: record.redeployCount || 0,
        lastRedeployedAt: record.lastRedeployedAt || null,
        originalSlug: record.originalSlug || null
      };

      records.unshift(newRecord);

      // Preserve unknown fields on store
      const updatedStore = {
        ...store,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        records
      };

      atomicWriteFileSync(DEPLOYMENTS_FILE, updatedStore);
      return newRecord;
    } catch (err) {
      console.error('[STORAGE] Error saving deployment record:', err.message);
      throw err;
    }
  });
}

/**
 * Returns a deployment record matching idOrSlug (and optional deviceId).
 *
 * @param {string} idOrSlug
 * @param {string|null} [deviceId]
 * @returns {Object|null}
 */
function getDeploymentRecord(idOrSlug, deviceId = null) {
  try {
    const store = readDeploymentsStore();
    const records = store.records || [];
    return records.find(d => {
      const match = (d.id === idOrSlug || d.slug === idOrSlug);
      if (!match) return false;
      if (deviceId && d.deviceId && d.deviceId !== deviceId) return false;
      return true;
    }) || null;
  } catch (err) {
    console.error('[STORAGE] Error finding deployment record:', err.message);
    throw err;
  }
}

/**
 * Updates an existing deployment record. Serialized through the write queue.
 *
 * @param {string} idOrSlug
 * @param {Object} updates
 * @param {string|null} [deviceId]
 * @returns {Promise<Object>}
 */
async function updateDeploymentRecord(idOrSlug, updates = {}, deviceId = null) {
  return enqueueWrite(async () => {
    try {
      const store = readDeploymentsStore();
      const records = store.records || [];
      const index = records.findIndex(d => {
        const match = (d.id === idOrSlug || d.slug === idOrSlug);
        if (!match) return false;
        if (deviceId && d.deviceId && d.deviceId !== deviceId) return false;
        return true;
      });

      if (index === -1) {
        throw new Error(`Deployment record '${idOrSlug}' not found or unauthorized.`);
      }

      const existing = records[index];
      const updated = {
        ...existing,
        ...updates
      };

      records[index] = updated;

      const updatedStore = {
        ...store,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        records
      };

      atomicWriteFileSync(DEPLOYMENTS_FILE, updatedStore);
      return updated;
    } catch (err) {
      console.error('[STORAGE] Error updating deployment record:', err.message);
      throw err;
    }
  });
}

/**
 * Removes a deployment record by ID or slug. Serialized through write queue.
 *
 * @param {string} id - Deployment ID or slug
 * @param {string|null} [deviceId] - Optional device ID to ensure ownership
 * @returns {Promise<boolean>}
 */
async function removeDeploymentRecord(id, deviceId = null) {
  return enqueueWrite(async () => {
    try {
      const store = readDeploymentsStore();
      const records = store.records || [];
      const filtered = records.filter(d => {
        const match = (d.id === id || d.slug === id);
        if (match) {
          if (deviceId && d.deviceId && d.deviceId !== deviceId) {
            return true; // Belongs to a different device, refuse delete
          }
          return false; // Owned by caller or shared (CLI/null), remove
        }
        return true;
      });

      const updatedStore = {
        ...store,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        records: filtered
      };

      atomicWriteFileSync(DEPLOYMENTS_FILE, updatedStore);
      return true;
    } catch (err) {
      console.error('[STORAGE] Error removing deployment record:', err.message);
      throw err;
    }
  });
}

/**
 * Synchronizes remote Cloudflare Pages deployments into local ledger.
 * Serialized through the write queue.
 *
 * @param {Array} remoteDeployments
 * @param {string|null} [projectName]
 */
async function syncRemoteDeploymentsToLocal(remoteDeployments, projectName = null) {
  if (!Array.isArray(remoteDeployments) || remoteDeployments.length === 0) return;

  return enqueueWrite(async () => {
    try {
      const store = readDeploymentsStore();
      const localList = store.records || [];
      let changed = false;

      for (const remote of remoteDeployments) {
        const remoteId = remote.id;
        const exists = localList.some(l => l.cfDeploymentId === remoteId || l.url === remote.url);
        if (!exists) {
          const rawSlug = (remote.aliases && remote.aliases[0])
            ? remote.aliases[0]
            : (remote.url ? remote.url : `cf_${remoteId.slice(0, 7)}`);
          const slug = rawSlug.replace(/^https?:\/\//, '').split('.')[0];

          localList.push({
            id: `dep_cf_${remoteId.slice(0, 8)}`,
            deviceId: null,
            projectName: remote.project_name || projectName || 'random-pages-vault',
            slug,
            title: remote.deployment_trigger?.metadata?.commit_message || `Cloudflare Deployment ${slug}`,
            template: 'direct',
            mode: 'branch',
            url: remote.url,
            canonicalUrl: remote.url,
            cfDeploymentId: remoteId,
            isSimulation: false,
            created_at: remote.created_on || new Date().toISOString(),
            status: remote.latest_stage?.status === 'success' ? 'active' : (remote.latest_stage?.status || 'active')
          });
          changed = true;
        }
      }

      if (changed) {
        const updatedStore = {
          ...store,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          records: localList
        };
        atomicWriteFileSync(DEPLOYMENTS_FILE, updatedStore);
      }
    } catch (err) {
      console.warn('[STORAGE] Remote sync write skipped:', err.message);
    }
  });
}

/**
 * Calculates current UTC reset countdown and timestamps
 */
function getResetTiming() {
  const now = new Date();
  const nextResetUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));

  const diffMs = Math.max(0, nextResetUtc.getTime() - now.getTime());
  const diffSec = Math.floor(diffMs / 1000);

  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;

  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

  return {
    nextResetUtcIso: nextResetUtc.toISOString(),
    secondsUntilReset: diffSec,
    countdownFormatted: formatted
  };
}

/**
 * Quota counters are computed per Cloudflare project/account, NOT per device,
 * since the real limits are account-level. Uses stored UTC timestamps.
 */
async function getQuotaStatus(syncWithCf = false, deviceId = null) {
  try {
    const config = getConfig(deviceId);
    // Quota is account/project wide: read all deployment records across all devices
    const allDeployments = getLocalDeployments(null);
    const timing = getResetTiming();

    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const startOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

    let remoteStats = null;
    let remoteDeployments = [];
    let cfConnected = false;

    if (config.hasCredentials && syncWithCf) {
      try {
        remoteDeployments = await cfApi.listDeployments(config.projectName, 1, 25, deviceId);
        remoteStats = cfApi.calculateStatsFromDeployments(remoteDeployments);
        cfConnected = true;

        await syncRemoteDeploymentsToLocal(remoteDeployments, config.projectName);
      } catch (err) {
        console.warn('Could not sync with Cloudflare API:', err.message);
      }
    }

    // Account/Project level counter using UTC timestamps
    let localToday = 0;
    let localMonth = 0;

    for (const item of allDeployments) {
      const d = new Date(item.created_at);
      if (!isNaN(d.getTime())) {
        if (d >= startOfTodayUtc) localToday++;
        if (d >= startOfMonthUtc) localMonth++;
      }
    }

    const dailyUsed = (remoteStats && remoteStats.todayCount > localToday) ? remoteStats.todayCount : localToday;
    const monthlyUsed = (remoteStats && remoteStats.monthCount > localMonth) ? remoteStats.monthCount : localMonth;

    const dailyLimit = config.dailyFreeLimit || 100;
    const monthlyLimit = config.monthlyBuildLimit || 500;

    const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);
    const monthlyRemaining = Math.max(0, monthlyLimit - monthlyUsed);

    const dailyPercent = Math.min(100, Math.round((dailyUsed / dailyLimit) * 100));
    const monthlyPercent = Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100));

    return {
      daily: {
        used: dailyUsed,
        limit: dailyLimit,
        remaining: dailyRemaining,
        percentage: dailyPercent,
        isExceeded: dailyRemaining === 0,
        isNearLimit: dailyRemaining > 0 && dailyRemaining <= 10
      },
      monthly: {
        used: monthlyUsed,
        limit: monthlyLimit,
        remaining: monthlyRemaining,
        percentage: monthlyPercent,
        isExceeded: monthlyRemaining === 0
      },
      reset: timing,
      cloudflare: {
        configured: config.hasCredentials,
        connected: cfConnected,
        projectName: config.projectName,
        accountId: config.accountId ? `${config.accountId.substring(0, 4)}...${config.accountId.substring(config.accountId.length - 4)}` : null
      },
      totalTrackedPages: allDeployments.length
    };
  } catch (err) {
    console.error('[STORAGE] Error calculating quota status:', err.message);
    throw err;
  }
}

// Reset corruption flag (used for testing and recovery)
function resetCorruptionState() {
  isDeploymentsCorrupted = false;
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  atomicWriteFileSync,
  getLocalDeployments,
  getDeploymentRecord,
  saveDeploymentRecord,
  updateDeploymentRecord,
  removeDeploymentRecord,
  getResetTiming,
  getQuotaStatus,
  resetCorruptionState
};
