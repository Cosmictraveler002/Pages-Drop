const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { getDeviceConfig, saveDeviceConfig } = require('./device-storage');

// Load environment variables from .env
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function getConfig(deviceId = null) {
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

function updateConfig(newConfig, deviceId = null) {
  // If deviceId provided, persist to device storage
  if (deviceId) {
    saveDeviceConfig(deviceId, newConfig);
  }

  const current = getConfig();
  const merged = { ...current, ...newConfig };

  let content = '';
  content += `# Cloudflare Pages CLI Workflow Configuration\n`;
  content += `CLOUDFLARE_ACCOUNT_ID=${merged.accountId || ''}\n`;
  content += `CLOUDFLARE_API_TOKEN=${merged.apiToken || ''}\n`;
  content += `CLOUDFLARE_PROJECT_NAME=${merged.projectName || 'random-pages-vault'}\n`;
  content += `DAILY_FREE_LIMIT=${merged.dailyFreeLimit || 100}\n`;
  content += `MONTHLY_BUILD_LIMIT=${merged.monthlyBuildLimit || 500}\n`;
  content += `DEFAULT_DEPLOY_MODE=${merged.defaultDeployMode || 'branch'}\n`;
  content += `PORT=${merged.port || 3000}\n`;

  fs.writeFileSync(envPath, content, 'utf8');

  // Update process.env in memory
  process.env.CLOUDFLARE_ACCOUNT_ID = merged.accountId || '';
  process.env.CLOUDFLARE_API_TOKEN = merged.apiToken || '';
  process.env.CLOUDFLARE_PROJECT_NAME = merged.projectName || 'random-pages-vault';
  process.env.DAILY_FREE_LIMIT = String(merged.dailyFreeLimit || 100);
  process.env.MONTHLY_BUILD_LIMIT = String(merged.monthlyBuildLimit || 500);
  process.env.DEFAULT_DEPLOY_MODE = merged.defaultDeployMode || 'branch';
  process.env.PORT = String(merged.port || 3000);

  return getConfig(deviceId);
}

module.exports = {
  getConfig,
  updateConfig
};
