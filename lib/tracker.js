const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const cfApi = require('./cf-api');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEPLOYMENTS_FILE = path.join(DATA_DIR, 'deployments.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

function getLocalDeployments() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DEPLOYMENTS_FILE, 'utf8');
    return JSON.parse(raw) || [];
  } catch (err) {
    console.error('Error reading deployments file:', err.message);
    return [];
  }
}

function saveDeploymentRecord(record) {
  ensureDataDir();
  const deployments = getLocalDeployments();
  deployments.unshift({
    id: record.id || `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    slug: record.slug,
    title: record.title || 'Untitled Static Page',
    template: record.template || 'landing',
    mode: record.mode || 'branch',
    url: record.url,
    canonicalUrl: record.canonicalUrl || record.url,
    cfDeploymentId: record.cfDeploymentId || null,
    isSimulation: Boolean(record.isSimulation),
    created_at: record.created_at || new Date().toISOString(),
    status: record.status || 'success'
  });

  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2), 'utf8');
  return deployments[0];
}

function removeDeploymentRecord(id) {
  ensureDataDir();
  const deployments = getLocalDeployments();
  const filtered = deployments.filter(d => d.id !== id && d.slug !== id);
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
  return true;
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
 * Comprehensive status report with daily & monthly limits auto-calculated
 */
async function getQuotaStatus(syncWithCf = false) {
  const config = getConfig();
  const localList = getLocalDeployments();
  const timing = getResetTiming();

  const now = new Date();
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const startOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

  let remoteStats = null;
  let remoteDeployments = [];
  let cfConnected = false;

  if (config.hasCredentials && syncWithCf) {
    try {
      remoteDeployments = await cfApi.listDeployments(config.projectName, 1, 50);
      remoteStats = cfApi.calculateStatsFromDeployments(remoteDeployments);
      cfConnected = true;
    } catch (err) {
      console.warn('Could not sync with Cloudflare API:', err.message);
    }
  }

  // Count local deployments created today and this month
  let localToday = 0;
  let localMonth = 0;

  for (const item of localList) {
    const d = new Date(item.created_at);
    if (!isNaN(d.getTime())) {
      if (d >= startOfTodayUtc) localToday++;
      if (d >= startOfMonthUtc) localMonth++;
    }
  }

  // If remote is synced and larger, use remote count, else local count
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
      accountId: config.accountId ? `${config.accountId.substring(0, 6)}...` : null
    },
    totalTrackedPages: localList.length
  };
}

module.exports = {
  getLocalDeployments,
  saveDeploymentRecord,
  removeDeploymentRecord,
  getResetTiming,
  getQuotaStatus
};
