const { getConfig } = require('./config');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

async function cfRequest(endpoint, options = {}) {
  const config = getConfig();
  if (!config.apiToken) {
    throw new Error('Cloudflare API Token is missing. Please configure CLOUDFLARE_API_TOKEN.');
  }

  const url = `${CF_API_BASE}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${config.apiToken}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    const errorMsg = (data.errors && data.errors[0] && data.errors[0].message) ||
      `Cloudflare API error (${response.status}: ${response.statusText})`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.errors = data.errors || [];
    throw error;
  }

  return data.result;
}

/**
 * Verify Cloudflare API Token
 */
async function verifyToken() {
  const config = getConfig();
  if (!config.apiToken) {
    return { valid: false, message: 'API Token not configured' };
  }
  try {
    const res = await cfRequest('/user/tokens/verify');
    return {
      valid: true,
      id: res.id,
      status: res.status,
      expires_on: res.expires_on
    };
  } catch (err) {
    return {
      valid: false,
      message: err.message
    };
  }
}

/**
 * Get Cloudflare Pages Project details
 */
async function getProject(projectName) {
  const config = getConfig();
  const name = projectName || config.projectName;
  if (!config.accountId) {
    throw new Error('Cloudflare Account ID is missing.');
  }

  return await cfRequest(`/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}`);
}

/**
 * Create Cloudflare Pages Project if it doesn't exist
 */
async function ensureProjectExists(projectName) {
  const config = getConfig();
  const name = projectName || config.projectName;
  if (!config.accountId) {
    throw new Error('Cloudflare Account ID is missing.');
  }

  try {
    const project = await getProject(name);
    return { created: false, project };
  } catch (err) {
    if (err.status === 404 || err.message.toLowerCase().includes('not found')) {
      // Create project
      const created = await cfRequest(`/accounts/${config.accountId}/pages/projects`, {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          production_branch: 'main'
        })
      });
      return { created: true, project: created };
    }
    throw err;
  }
}

/**
 * List recent deployments for the Pages project
 */
async function listDeployments(projectName, page = 1, perPage = 50) {
  const config = getConfig();
  const name = projectName || config.projectName;
  if (!config.accountId || !config.apiToken) {
    return [];
  }

  try {
    const result = await cfRequest(
      `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}/deployments?page=${page}&per_page=${perPage}`
    );
    return result || [];
  } catch (err) {
    console.warn(`[cf-api] Could not fetch remote deployments: ${err.message}`);
    return [];
  }
}

/**
 * Calculate deployments usage for today and current month from API deployments
 */
function calculateStatsFromDeployments(deployments) {
  const now = new Date();
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const startOfMonthUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));

  let todayCount = 0;
  let monthCount = 0;

  for (const dep of deployments) {
    const created = new Date(dep.created_on);
    if (!isNaN(created.getTime())) {
      if (created >= startOfTodayUtc) {
        todayCount++;
      }
      if (created >= startOfMonthUtc) {
        monthCount++;
      }
    }
  }

  return {
    todayCount,
    monthCount,
    totalFetched: deployments.length
  };
}

module.exports = {
  verifyToken,
  getProject,
  ensureProjectExists,
  listDeployments,
  calculateStatsFromDeployments
};
