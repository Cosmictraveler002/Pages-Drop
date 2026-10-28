const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { getDeviceConfig, saveDeviceConfig } = require('./device-storage');

// Load environment variables from .env
const envPath = path.resolve(__dirname, '..', '.env');
let lastEnvMtime = 0;

function reloadEnvIfNeeded() {
  try {
    if (fs.existsSync(envPath)) {
      const stat = fs.statSync(envPath);
      if (stat.mtimeMs !== lastEnvMtime) {
        lastEnvMtime = stat.mtimeMs;
        const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
        for (const [k, v] of Object.entries(parsed)) {
          process.env[k] = v;
        }
      }
    }
  } catch (_) {}
}

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  try {
    lastEnvMtime = fs.statSync(envPath).mtimeMs;
  } catch (_) {}
} else {
  dotenv.config();
}

function getConfig(deviceId = null) {
  reloadEnvIfNeeded();
  // If a deviceId is specified and has saved credentials in device storage, resolve them
  const devConfig = deviceId ? getDeviceConfig(deviceId) : null;

  const accountId = (devConfig && devConfig.accountId) || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const apiToken = (devConfig && devConfig.apiToken) || process.env.CLOUDFLARE_API_TOKEN || '';
  const projectName = (devConfig && devConfig.projectName) || process.env.CLOUDFLARE_PROJECT_NAME || 'random-pages-vault';
  const dailyFreeLimit = parseInt((devConfig && devConfig.dailyFreeLimit) || process.env.DAILY_FREE_LIMIT || '100', 10);
  const monthlyBuildLimit = parseInt(process.env.MONTHLY_BUILD_LIMIT || '500', 10);
  const defaultDeployMode = process.env.DEFAULT_DEPLOY_MODE || 'branch';
  const port = parseInt(process.env.PORT || '3000', 10);

  return {
    deviceId: deviceId || null,
    accountId,
    apiToken,
    projectName,
    dailyFreeLimit,
    monthlyBuildLimit,
    defaultDeployMode,
    port,
    host: process.env.HOST || '127.0.0.1',
    hasCredentials: Boolean(apiToken && accountId),
    isDeviceStored: Boolean(devConfig && devConfig.apiToken)
  };
}

const { maskSecret } = require('./crypto-vault');

function updateConfig(newConfig = {}, deviceId = null) {
  // Check for newline / carriage return injection attempts
  for (const [key, val] of Object.entries(newConfig)) {
    if (typeof val === 'string' && (/[\r\n]/.test(val))) {
      throw new Error(`Security validation failed: newline characters are prohibited in ${key}.`);
    }
  }

  const current = getConfig(deviceId);

  // Validate Account ID (32 hex characters) if provided
  let accountId = current.accountId;
  if (newConfig.accountId !== undefined && newConfig.accountId.trim() !== '') {
    const trimmedAcc = newConfig.accountId.trim();
    if (!/^[a-f0-9]{32}$/i.test(trimmedAcc)) {
      throw new Error('Account ID must be a 32-character hexadecimal string.');
    }
    accountId = trimmedAcc;
  }

  // Validate API Token (non-empty, no whitespace) if provided
  let apiToken = current.apiToken;
  if (newConfig.apiToken !== undefined && newConfig.apiToken.trim() !== '') {
    const trimmedTok = newConfig.apiToken.trim();
    if (!/^[a-zA-Z0-9_\-]+$/.test(trimmedTok)) {
      throw new Error('API Token must contain only alphanumeric characters, underscores, and hyphens with no whitespace.');
    }
    apiToken = trimmedTok;
  }

  const projectName = (newConfig.projectName !== undefined && newConfig.projectName.trim() !== '')
    ? newConfig.projectName.trim()
    : current.projectName;

  const dailyFreeLimit = (newConfig.dailyFreeLimit !== undefined && !isNaN(parseInt(newConfig.dailyFreeLimit, 10)))
    ? parseInt(newConfig.dailyFreeLimit, 10)
    : current.dailyFreeLimit;

  // If deviceId provided, persist to encrypted device storage
  if (deviceId) {
    saveDeviceConfig(deviceId, {
      accountId,
      apiToken,
      projectName,
      dailyFreeLimit
    });
  }

  let content = '';
  content += `# Cloudflare Pages CLI Workflow Configuration\n`;
  content += `CLOUDFLARE_ACCOUNT_ID=${accountId || ''}\n`;
  content += `CLOUDFLARE_API_TOKEN=${apiToken || ''}\n`;
  content += `CLOUDFLARE_PROJECT_NAME=${projectName || 'random-pages-vault'}\n`;
  content += `DAILY_FREE_LIMIT=${dailyFreeLimit || 100}\n`;
  content += `MONTHLY_BUILD_LIMIT=${current.monthlyBuildLimit || 500}\n`;
  content += `DEFAULT_DEPLOY_MODE=${current.defaultDeployMode || 'branch'}\n`;
  content += `PORT=${current.port || 3000}\n`;

  // Atomic write to .env
  const tempFile = `${envPath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, content, 'utf8');
  fs.renameSync(tempFile, envPath);

  // Update process.env in memory
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId || '';
  process.env.CLOUDFLARE_API_TOKEN = apiToken || '';
  process.env.CLOUDFLARE_PROJECT_NAME = projectName || 'random-pages-vault';
  process.env.DAILY_FREE_LIMIT = String(dailyFreeLimit || 100);

  // Never return raw credentials
  return {
    hasCredentials: Boolean(apiToken && accountId),
    accountIdMasked: accountId ? maskSecret(accountId) : null,
    projectName,
    dailyFreeLimit
  };
}

module.exports = {
  getConfig,
  updateConfig
};
