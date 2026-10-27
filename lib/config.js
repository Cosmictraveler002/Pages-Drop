const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function getConfig() {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    projectName: process.env.CLOUDFLARE_PROJECT_NAME || 'random-pages-vault',
    dailyFreeLimit: parseInt(process.env.DAILY_FREE_LIMIT || '100', 10),
    monthlyBuildLimit: parseInt(process.env.MONTHLY_BUILD_LIMIT || '500', 10),
    defaultDeployMode: process.env.DEFAULT_DEPLOY_MODE || 'branch', // 'branch' or 'path'
    port: parseInt(process.env.PORT || '3000', 10),
    hasCredentials: Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
  };
}

function updateConfig(newConfig) {
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

  return getConfig();
}

module.exports = {
  getConfig,
  updateConfig
};
