const { getConfig } = require('./config');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

async function cfRequest(endpoint, options = {}, deviceId = null) {
  const config = getConfig(deviceId);
  const explicitAuth = options.headers && (options.headers.Authorization || options.headers.authorization);
  const token = explicitAuth ? explicitAuth.replace(/^Bearer\s+/i, '') : config.apiToken;
  if (!token) {
    throw new Error('Cloudflare API Token is missing. Please configure CLOUDFLARE_API_TOKEN.');
  }

  const url = `${CF_API_BASE}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
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
  let accountId = explicitAccountId || config.accountId;

  if (!token) {
    return { valid: false, message: 'API Token not configured. Please enter or save your Cloudflare API token.' };
  }

  let permissionsWarning = null;
  let detectedAccountId = null;

  // 1. If accountId is not known or token is an Account Token (cfat_), auto-detect account ID via GET /accounts
  if (!accountId || token.startsWith('cfat_')) {
    try {
      const accountsRes = await cfRequest('/accounts', {
        headers: { 'Authorization': `Bearer ${token}` }
      }, deviceId);

      if (Array.isArray(accountsRes) && accountsRes.length > 0 && accountsRes[0].id) {
        if (!accountId) {
          accountId = accountsRes[0].id;
        }
        detectedAccountId = accountsRes[0].id;
      }
    } catch (_) {}
  }

  // 2. If accountId is provided or detected, test Account Token endpoints
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
        detectedAccountId: detectedAccountId || accountId,
        permissionsWarning
      };
    } catch (accountErr) {
      // Fallback: Test pages projects access directly
      try {
        await cfRequest(`/accounts/${accountId}/pages/projects`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }, deviceId);
        return {
          valid: true,
          status: 'active',
          detectedAccountId: detectedAccountId || accountId,
          permissionsWarning: null
        };
      } catch (pagesErr) {
        // If it's a cfat_ token, do not fall through to user verify as it will always return 401
        if (token.startsWith('cfat_')) {
          return {
            valid: false,
            status: 'invalid',
            message: pagesErr.message || accountErr.message
          };
        }
      }
    }
  }

  // 3. Fallback: User Token verification (/user/tokens/verify) for legacy user tokens
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
      detectedAccountId,
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

/**
 * Cloudflare Connect Wizard token validation & account resolution helper
 */
async function wizardConnectToken(token, targetAccountId = null) {
  if (!token || !token.trim()) {
    const err = new Error('Paste your token first.');
    err.friendly = true;
    err.statusCode = 400;
    throw err;
  }

  const cleanToken = token.trim();

  // If token looks like a Global API Key (37 chars, not 40)
  if (cleanToken.length === 37 || /^[a-f0-9]{37}$/i.test(cleanToken)) {
    const err = new Error('This looks like a Global API Key. Please create an API Token instead, it is safer.');
    err.friendly = true;
    err.statusCode = 400;
    throw err;
  }

  // 1. Fetch user accounts
  let accounts = [];
  try {
    const accountsRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (accountsRes.status === 401 || accountsRes.status === 403) {
      // Test user/tokens/verify for legacy user tokens before reporting invalid
      const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { 'Authorization': `Bearer ${cleanToken}` }
      }).catch(() => null);

      if (!verifyRes || !verifyRes.ok) {
        const err = new Error("That token didn't work. Did you copy the full token? Try creating a new one.");
        err.friendly = true;
        err.statusCode = 400;
        throw err;
      }
    }

    if (!accountsRes.ok && accountsRes.status >= 500) {
      const err = new Error('Cloudflare is not responding. Try again in a minute.');
      err.friendly = true;
      err.statusCode = 502;
      throw err;
    }

    const json = await accountsRes.json().catch(() => ({}));
    if (json.success && Array.isArray(json.result)) {
      accounts = json.result.map(a => ({ id: a.id, name: a.name }));
    }
  } catch (netErr) {
    if (netErr.friendly) throw netErr;
    const err = new Error('Cloudflare is not responding. Try again in a minute.');
    err.friendly = true;
    err.statusCode = 502;
    throw err;
  }

  if (!accounts || accounts.length === 0) {
    const err = new Error("That token didn't work. Did you copy the full token? Try creating a new one.");
    err.friendly = true;
    err.statusCode = 400;
    throw err;
  }

  // If multiple accounts and none explicitly selected, prompt frontend to pick
  if (accounts.length > 1 && !targetAccountId) {
    return {
      needsAccountSelection: true,
      accounts
    };
  }

  const selectedAccount = (targetAccountId && accounts.find(a => a.id === targetAccountId)) || accounts[0];
  const accountId = selectedAccount.id;
  const accountName = selectedAccount.name;

  // 2. Validate Pages:Edit permission on this account
  try {
    const pagesCheck = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (pagesCheck.status === 401 || pagesCheck.status === 403) {
      const err = new Error('This token is missing Cloudflare Pages: Edit permission. Click here to fix it, then paste the new token.');
      err.friendly = true;
      err.statusCode = 400;
      throw err;
    }
  } catch (err) {
    if (err.friendly) throw err;
    const netErr = new Error('Cloudflare is not responding. Try again in a minute.');
    netErr.friendly = true;
    netErr.statusCode = 502;
    throw netErr;
  }

  // 3. Retrieve user email if accessible
  let email = null;
  try {
    const userRes = await fetch('https://api.cloudflare.com/client/v4/user', {
      headers: { 'Authorization': `Bearer ${cleanToken}` }
    });
    if (userRes.ok) {
      const ujson = await userRes.json();
      if (ujson.success && ujson.result && ujson.result.email) {
        email = ujson.result.email;
      }
    }
  } catch (_) {}

  return {
    needsAccountSelection: false,
    accountId,
    accountName,
    email: email || `${accountName} Member`,
    apiToken: cleanToken
  };
}

module.exports = {
  verifyToken,
  wizardConnectToken,
  getProject,
  ensureProjectExists,
  listDeployments,
  calculateStatsFromDeployments
};
