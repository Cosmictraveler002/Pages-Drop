const { getConfig } = require('./config');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

async function cfRequest(endpoint, options = {}, deviceId = null) {
  const config = getConfig(deviceId);
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

async function verifyToken(deviceId = null, explicitToken = null, explicitAccountId = null) {
  const config = getConfig(deviceId);
  const token = explicitToken || config.apiToken;
  const accountId = explicitAccountId || config.accountId;

  if (!token) {
    return { valid: false, message: 'API Token not configured' };
  }

  let permissionsWarning = null;

  // 1. If accountId is provided or token is an Account Token (cfat_), check account token endpoint first
  if (accountId) {
    try {
      const res = await cfRequest(`/accounts/${accountId}/tokens/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }, deviceId);

      // Check if policies include broader access than Pages
      if (res && res.policies && Array.isArray(res.policies)) {
        const hasBroadScope = res.policies.some(p => p.permission_groups && p.permission_groups.some(g => !g.name?.toLowerCase().includes('pages')));
        if (hasBroadScope) {
          permissionsWarning = 'Token permission scope is broader than Pages Edit. For least privilege, restrict to Pages: Edit.';
        }
      }

      return {
        valid: true,
        status: res.status || 'active',
        permissionsWarning
      };
    } catch (accountErr) {
      // If error was not 404/400, try pages projects check as fallback for account tokens
      try {
        await cfRequest(`/accounts/${accountId}/pages/projects`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }, deviceId);
        return {
          valid: true,
          status: 'active',
          permissionsWarning: null
        };
      } catch (_) {}
    }
  }

  // 2. Try User Token verification (/user/tokens/verify)
  try {
    const res = await cfRequest('/user/tokens/verify', {
      headers: { 'Authorization': `Bearer ${token}` }
    }, deviceId);

    if (res && res.policies && Array.isArray(res.policies)) {
      const hasBroadScope = res.policies.some(p => p.permission_groups && p.permission_groups.some(g => !g.name?.toLowerCase().includes('pages')));
      if (hasBroadScope) {
        permissionsWarning = 'Token permission scope is broader than Pages Edit. For least privilege, restrict to Pages: Edit.';
      }
    }

    return {
      valid: true,
      status: res.status || 'active',
      permissionsWarning
    };
  } catch (userErr) {
    return {
      valid: false,
      status: 'invalid',
      message: userErr.message
    };
  }
}

/**
 * Get Cloudflare Pages Project details
 */
async function getProject(projectName, deviceId = null) {
  const config = getConfig(deviceId);
  const name = projectName || config.projectName;
  if (!config.accountId) {
    throw new Error('Cloudflare Account ID is missing.');
  }

  return await cfRequest(`/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}`, {}, deviceId);
}

/**
 * Create Cloudflare Pages Project if it doesn't exist
 */
async function ensureProjectExists(projectName, deviceId = null) {
  const config = getConfig(deviceId);
  const name = projectName || config.projectName;
  if (!config.accountId) {
    throw new Error('Cloudflare Account ID is missing.');
  }

  try {
    const project = await getProject(name, deviceId);
    return { created: false, project };
  } catch (err) {
    if (err.status === 404 || (err.message && err.message.toLowerCase().includes('not found'))) {
      // Auto-create project
      const created = await cfRequest(`/accounts/${config.accountId}/pages/projects`, {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          production_branch: 'main'
        })
      }, deviceId);
      return { created: true, project: created };
    }
    throw err;
  }
}

/**
 * List recent deployments for the Pages project
 */
async function listDeployments(projectName, page = 1, perPage = 25, deviceId = null) {
  const config = getConfig(deviceId);
  const name = projectName || config.projectName;
  if (!config.accountId || !config.apiToken) {
    return [];
  }

  try {
    const result = await cfRequest(
      `/accounts/${config.accountId}/pages/projects/${encodeURIComponent(name)}/deployments?page=${page}&per_page=${perPage}`,
      {},
      deviceId
    );
    return result || [];
  } catch (err) {
    // If project is not yet created in Cloudflare (404), return empty list silently
    if (err.status === 404 || (err.message && err.message.toLowerCase().includes('not found'))) {
      return [];
    }
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
