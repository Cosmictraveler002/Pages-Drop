const express = require('express');
const path = require('path');
const fs = require('fs');
const { getConfig, updateConfig } = require('../lib/config');
const {
  generateRandomSlug,
  buildPageHtml,
  buildPausedPageHtml,
  buildRedirectPageHtml,
  prepareStaging
} = require('../lib/page-generator');
const { deployWithWrangler } = require('../lib/deployer');
const {
  getQuotaStatus,
  getLocalDeployments,
  getDeploymentRecord,
  updateDeploymentRecord,
  removeDeploymentRecord
} = require('../lib/tracker');
const { getDeviceConfig } = require('../lib/device-storage');
const {
  authMiddleware,
  originCheckMiddleware,
  issueDeviceCredentials,
  setDeviceSecretCookie,
  clearDeviceCredentials,
  clearDeviceSecretCookie,
  checkUnauthRateLimit,
  getClientIp,
  resetFailedAuth
} = require('../lib/auth');
const cfApi = require('../lib/cf-api');
const {
  saveVault,
  loadVault,
  deleteVault,
  checkConnectRateLimit
} = require('../lib/vault');

const crypto = require('crypto');

const app = express();
const config = getConfig();

// Disable X-Powered-By
app.disable('x-powered-by');

// Security Headers: Content-Security-Policy, nosniff, no-referrer, frame-ancestors none
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Support multi-file / folder uploads up to 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// API: Register device and issue credentials (unauthenticated, rate-limited)
app.post('/api/auth/register', (req, res) => {
  const ip = getClientIp(req);
  if (!checkUnauthRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Registration rate limit exceeded. Try again in 1 minute.' });
  }
  resetFailedAuth(ip);
  const { deviceId, secret } = issueDeviceCredentials();
  setDeviceSecretCookie(res, secret, req);
  res.json({ success: true, deviceId });
});

// API: Reset / unlink device credentials (allows re-registering with fresh Device ID)
app.post('/api/auth/reset', (req, res) => {
  const ip = getClientIp(req);
  resetFailedAuth(ip);
  const cookies = req.headers.cookie ? req.headers.cookie.split(';') : [];
  let deviceId = req.deviceId || req.headers['x-device-id'] || req.query.deviceId || (req.body && req.body.deviceId);
  if (deviceId) {
    clearDeviceCredentials(deviceId);
    deleteVault(deviceId);
  }
  clearDeviceSecretCookie(res, req);
  res.json({ success: true, message: 'Device credentials cleared. You can now register with a new device ID.' });
});

// Protect all other /api routes with Origin check & Device Auth boundary
app.use('/api', originCheckMiddleware);
app.use('/api', authMiddleware);

const { maskSecret } = require('../lib/crypto-vault');

// API: Check device credentials & registration status
app.get('/api/device', (req, res) => {
  const deviceId = req.deviceId;
  const cfg = getConfig(deviceId);
  res.json({
    registered: true,
    deviceId,
    projectName: cfg.projectName,
    hasCredentials: cfg.hasCredentials,
    accountIdMasked: cfg.accountId ? maskSecret(cfg.accountId) : null
  });
});

// API: Get live quota status & countdown (device-aware)
app.get('/api/status', async (req, res, next) => {
  try {
    const sync = req.query.sync === 'true';
    const deviceId = req.deviceId;
    const status = await getQuotaStatus(sync, deviceId);
    res.json({ success: true, status, deviceId });
  } catch (err) {
    next(err);
  }
});

// Idempotency cache for deployments (requestId -> { inFlight, result, timestamp })
const deployIdempotencyCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, item] of deployIdempotencyCache.entries()) {
    if (now - item.timestamp > 5 * 60 * 1000) {
      deployIdempotencyCache.delete(key);
    }
  }
}, 60 * 1000).unref();

// API: Get list of deployed links (caller records + shared/CLI records + pagination)
app.get('/api/deployments', (req, res, next) => {
  try {
    const deviceId = req.deviceId;
    const includeShared = req.query.shared !== 'false';
    const all = req.query.all === 'true';
    const callerDeployments = getLocalDeployments(deviceId, { includeShared, all });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const paginated = callerDeployments.slice(offset, offset + limit);

    res.json({
      success: true,
      deployments: paginated,
      pagination: {
        page,
        limit,
        total: callerDeployments.length,
        totalPages: Math.ceil(callerDeployments.length / limit) || 1
      }
    });
  } catch (err) {
    next(err);
  }
});

// API: Generate & Deploy a live static page or dropped folder/files
app.post('/api/deployments/generate', async (req, res) => {
  try {
    const deviceId = req.deviceId;
    const requestId = req.headers['x-request-id'] || req.body.requestId;

    // Server-side deduplication by requestId (Idempotency)
    if (requestId) {
      const cached = deployIdempotencyCache.get(requestId);
      if (cached) {
        if (cached.inFlight) {
          try {
            const result = await cached.inFlight;
            return res.json({ ...result, idempotentReplay: true });
          } catch (inFlightErr) {
            return res.status(500).json({ success: false, error: inFlightErr.message });
          }
        }
        if (cached.result) {
          return res.json({ ...cached.result, idempotentReplay: true });
        }
      }
    }

    const {
      files = [],
      title,
      subtitle,
      content,
      prefix,
      customSlug,
      projectName: reqProjectName,
      mode = 'branch',
      dryRun = false,
      autoRenameIndex = true
    } = req.body;

    const executeDeploy = async () => {
      // Ensure project name is configured
      const currentConfig = getConfig(deviceId);
      const rawProject = (reqProjectName && reqProjectName.trim())
        ? reqProjectName.trim()
        : currentConfig.projectName;
      const targetProject = (rawProject || '')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (!targetProject) {
        const err = new Error('Project name is mandatory. Please enter a project name before deploying.');
        err.statusCode = 400;
        throw err;
      }

      // Check quota before proceeding (account/project wide)
      const quota = await getQuotaStatus(false, deviceId);
      if (quota.daily.isExceeded) {
        const err = new Error(`Daily free tier deployment limit reached (${quota.daily.limit}/${quota.daily.limit}). Next reset in ${quota.reset.countdownFormatted}.`);
        err.statusCode = 429;
        throw err;
      }

      const slug = (customSlug && customSlug.trim())
        ? customSlug.toLowerCase().replace(/[^a-z0-9-]/g, '')
        : generateRandomSlug({ prefix, length: 7 });

      const pageTitle = title || `Drop ${slug.toUpperCase()}`;
      const pageSubtitle = subtitle || 'Generated live via Cloudflare Pages Direct Upload CLI Workflow';
      const pageContent = content || 'Live static endpoint served from Cloudflare global Edge CDN.';

      // Compile single fallback HTML if no files were dropped
      let html = null;
      if (!files || files.length === 0) {
        html = buildPageHtml({
          template: 'landing',
          title: pageTitle,
          subtitle: pageSubtitle,
          content: pageContent,
          slug
        });
      }

      // Determine deployment type
      let deployType = 'direct';
      if (files && files.length > 0) {
        deployType = files.length === 1 ? 'file' : 'folder';
      }

      // Stage files on disk
      let staged;
      try {
        staged = prepareStaging({
          slug,
          html,
          files,
          title: pageTitle,
          mode,
          autoRenameIndex: Boolean(autoRenameIndex)
        });
      } catch (err) {
        if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || (err.message && err.message.includes('exceeds Cloudflare Pages'))) {
          err.statusCode = 400;
        }
        throw err;
      }

      // Deploy logs collector
      const logs = [];
      const onLog = (msg) => logs.push(msg);

      if (staged.excludedFiles && staged.excludedFiles.length > 0) {
        onLog(`[SECURITY] Excluded ${staged.excludedFiles.length} sensitive file(s): ${staged.excludedFiles.join(', ')}`);
      }
      if (staged.rejectedFiles && staged.rejectedFiles.length > 0) {
        onLog(`[SECURITY] Rejected ${staged.rejectedFiles.length} invalid/malformed file path(s)`);
      }

      const deployResult = await deployWithWrangler({
        deployDir: staged.deployDir,
        slug,
        projectName: targetProject,
        mode,
        title: pageTitle,
        template: deployType,
        deviceId,
        dryRun: Boolean(dryRun),
        onLog
      });

      const updatedQuota = await getQuotaStatus(false, deviceId);

      return {
        success: true,
        deployment: deployResult.record,
        url: deployResult.url,
        slug: deployResult.slug,
        isSimulation: deployResult.isSimulation,
        fileCount: staged.fileCount,
        excludedFiles: staged.excludedFiles || [],
        rejectedFiles: staged.rejectedFiles || [],
        deployType,
        logs,
        quota: updatedQuota
      };
    };

    let result;
    if (requestId) {
      const deployPromise = executeDeploy();
      deployIdempotencyCache.set(requestId, { inFlight: deployPromise, timestamp: Date.now() });
      try {
        result = await deployPromise;
        deployIdempotencyCache.set(requestId, { result, timestamp: Date.now() });
      } catch (deployErr) {
        deployIdempotencyCache.delete(requestId);
        throw deployErr;
      }
    } else {
      result = await executeDeploy();
    }

    res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('Generation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Live HTML Preview (without deploying)
app.post('/api/preview', (req, res) => {
  try {
    const { title, subtitle, content, slug = 'preview-demo' } = req.body;
    const html = buildPageHtml({
      template: 'landing',
      title: title || 'Preview Page Title',
      subtitle: subtitle || 'Subtitle preview',
      content: content || 'Preview body content for live visual inspection.',
      slug
    });
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h3>Error generating preview: ${err.message}</h3>`);
  }
});

// API: Verify Cloudflare Token & Account (device-aware)
app.post('/api/verify', async (req, res) => {
  try {
    const deviceId = req.deviceId;
    const explicitToken = req.body && req.body.apiToken ? req.body.apiToken.trim() : null;
    const explicitAccountId = req.body && req.body.accountId ? req.body.accountId.trim() : null;
    const result = await cfApi.verifyToken(deviceId, explicitToken, explicitAccountId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ valid: false, message: err.message });
  }
});

// CLOUDFLARE CONNECT WIZARD: Connect and auto-detect Account ID
app.post('/api/cloudflare/connect', async (req, res) => {
  try {
    const deviceId = req.deviceId;
    const deviceSecret = req.deviceSecret;

    // Rate limiting: max 5 attempts per minute per device
    if (!checkConnectRateLimit(deviceId)) {
      return res.status(429).json({
        success: false,
        error: 'Too many connection attempts. Please wait a minute before trying again.'
      });
    }

    const { apiToken, accountId, projectName } = req.body || {};

    // Validate with Cloudflare API
    const result = await cfApi.wizardConnectToken(apiToken, accountId);

    // If multiple accounts found and user hasn't selected one yet
    if (result.needsAccountSelection) {
      return res.json({
        success: true,
        needsAccountSelection: true,
        accounts: result.accounts
      });
    }

    // Determine target project name
    const targetProjectName = (projectName && projectName.trim())
      ? projectName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
      : (getConfig(deviceId).projectName || 'random-pages-vault');

    // Save into device vault encrypted with AES-256-GCM via HKDF key
    saveVault(deviceId, deviceSecret, {
      apiToken: result.apiToken,
      accountId: result.accountId,
      accountName: result.accountName,
      email: result.email,
      projectName: targetProjectName
    });

    return res.json({
      success: true,
      needsAccountSelection: false,
      accountName: result.accountName,
      accountIdMasked: maskSecret(result.accountId),
      email: result.email,
      projectName: targetProjectName,
      message: `Connected as ${result.email} - Account: ${result.accountName}`
    });
  } catch (err) {
    const status = err.statusCode || (err.friendly ? 400 : 500);
    return res.status(status).json({
      success: false,
      error: err.message || 'Connection failed'
    });
  }
});

// CLOUDFLARE CONNECT WIZARD: Get connection status
app.get('/api/cloudflare/status', (req, res) => {
  try {
    const deviceId = req.deviceId;
    const deviceSecret = req.deviceSecret;
    const vault = loadVault(deviceId, deviceSecret);

    if (vault && vault.apiToken && vault.accountId) {
      return res.json({
        success: true,
        connected: true,
        accountName: vault.accountName || 'Connected Account',
        accountIdMasked: maskSecret(vault.accountId),
        email: vault.email || null,
        projectName: vault.projectName || 'random-pages-vault'
      });
    }

    const cfg = getConfig(deviceId);
    return res.json({
      success: true,
      connected: false,
      accountName: null,
      accountIdMasked: null,
      email: null,
      projectName: cfg.projectName || 'random-pages-vault'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// CLOUDFLARE CONNECT WIZARD: Disconnect account & clear vault
app.post('/api/cloudflare/disconnect', (req, res) => {
  try {
    const deviceId = req.deviceId;
    deleteVault(deviceId);
    return res.json({
      success: true,
      disconnected: true,
      message: 'Cloudflare account disconnected and credentials removed from vault.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: Update Config Settings (stored locally per device & in .env)
app.post('/api/config', (req, res) => {
  try {
    const deviceId = req.deviceId;
    const { accountId, apiToken, projectName, dailyFreeLimit } = req.body;

    if (projectName !== undefined && (!projectName || !projectName.trim())) {
      return res.status(400).json({ success: false, error: 'Project name is mandatory and cannot be empty.' });
    }

    const result = updateConfig({
      accountId,
      apiToken,
      projectName,
      dailyFreeLimit: dailyFreeLimit ? parseInt(dailyFreeLimit, 10) : undefined
    }, deviceId);
    res.json({
      success: true,
      hasCredentials: result.hasCredentials,
      accountIdMasked: result.accountIdMasked,
      projectName: result.projectName,
      dailyFreeLimit: result.dailyFreeLimit,
      deviceId
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// API: Pause a deployment (serves minimal paused placeholder)
app.post('/api/deployments/:slug/pause', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const deviceId = req.deviceId;
    const record = getDeploymentRecord(slug, deviceId);

    if (!record) {
      return res.status(404).json({ success: false, error: `Deployment '${slug}' not found or unauthorized.` });
    }

    if (record.status === 'paused') {
      return res.json({ success: true, message: 'Deployment is already paused.', deployment: record });
    }

    // Check quota
    const quota = await getQuotaStatus(false, deviceId);
    if (quota.daily.isExceeded) {
      return res.status(429).json({
        success: false,
        error: `Daily deployment limit reached (${quota.daily.limit}/${quota.daily.limit}). Next reset in ${quota.reset.countdownFormatted}.`
      });
    }

    const buildsDir = path.resolve(__dirname, '..', 'dist', 'builds');
    const liveDir = path.join(buildsDir, slug);
    const backupDir = path.join(buildsDir, `${slug}_backup`);

    // Backup current live build files if present
    if (fs.existsSync(liveDir)) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch (_) {}
      try {
        fs.cpSync(liveDir, backupDir, { recursive: true });
      } catch (cpErr) {
        console.warn(`[PAUSE] Could not backup directory for ${slug}:`, cpErr.message);
      }
    }

    // Stage pause placeholder page
    const pauseHtml = buildPausedPageHtml(slug, record.title);
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'index.html'), pauseHtml, 'utf8');

    // Deploy paused placeholder to branch
    await deployWithWrangler({
      deployDir: liveDir,
      slug,
      mode: record.mode || 'branch',
      title: `[Paused] ${record.title}`,
      template: 'direct',
      deviceId,
      dryRun: Boolean(record.isSimulation),
      skipRecord: true,
      commitMessage: `Pause-${slug}`
    });

    const updatedRecord = await updateDeploymentRecord(slug, {
      status: 'paused',
      pausedAt: new Date().toISOString(),
      prePauseUrl: record.url
    }, deviceId);

    const updatedQuota = await getQuotaStatus(false, deviceId);

    res.json({
      success: true,
      deployment: updatedRecord,
      quota: updatedQuota
    });
  } catch (err) {
    next(err);
  }
});

// API: Resume a paused deployment (restores original files)
app.post('/api/deployments/:slug/resume', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const deviceId = req.deviceId;
    const record = getDeploymentRecord(slug, deviceId);

    if (!record) {
      return res.status(404).json({ success: false, error: `Deployment '${slug}' not found or unauthorized.` });
    }

    if (record.status !== 'paused') {
      return res.json({ success: true, message: 'Deployment is not paused.', deployment: record });
    }

    // Check quota
    const quota = await getQuotaStatus(false, deviceId);
    if (quota.daily.isExceeded) {
      return res.status(429).json({
        success: false,
        error: `Daily deployment limit reached (${quota.daily.limit}/${quota.daily.limit}). Next reset in ${quota.reset.countdownFormatted}.`
      });
    }

    const buildsDir = path.resolve(__dirname, '..', 'dist', 'builds');
    const liveDir = path.join(buildsDir, slug);
    const backupDir = path.join(buildsDir, `${slug}_backup`);

    // Restore from backup if exists, otherwise generate fallback
    if (fs.existsSync(backupDir)) {
      try {
        fs.rmSync(liveDir, { recursive: true, force: true });
      } catch (_) {}
      fs.cpSync(backupDir, liveDir, { recursive: true });
    } else if (!fs.existsSync(liveDir) || !fs.existsSync(path.join(liveDir, 'index.html'))) {
      const fallbackHtml = buildPageHtml({
        template: record.template || 'landing',
        title: record.title,
        slug
      });
      fs.mkdirSync(liveDir, { recursive: true });
      fs.writeFileSync(path.join(liveDir, 'index.html'), fallbackHtml, 'utf8');
    }

    await deployWithWrangler({
      deployDir: liveDir,
      slug,
      mode: record.mode || 'branch',
      title: record.title,
      template: record.template || 'direct',
      deviceId,
      dryRun: Boolean(record.isSimulation),
      skipRecord: true,
      commitMessage: `Resume-${slug}`
    });

    const updatedRecord = await updateDeploymentRecord(slug, {
      status: 'active',
      pausedAt: null
    }, deviceId);

    const updatedQuota = await getQuotaStatus(false, deviceId);

    res.json({
      success: true,
      deployment: updatedRecord,
      quota: updatedQuota
    });
  } catch (err) {
    next(err);
  }
});

// API: Redeploy an existing project with updated files (and optional URL rename)
app.post('/api/deployments/:slug/redeploy', async (req, res, next) => {
  try {
    const originalSlug = req.params.slug;
    const deviceId = req.deviceId;
    const record = getDeploymentRecord(originalSlug, deviceId);

    if (!record) {
      return res.status(404).json({ success: false, error: `Deployment '${originalSlug}' not found or unauthorized.` });
    }

    const {
      files = [],
      title,
      subtitle,
      content,
      newSlug,
      projectName: reqProjectName,
      autoRenameIndex = true
    } = req.body;

    const currentConfig = getConfig(deviceId);
    const rawProject = (reqProjectName && reqProjectName.trim())
      ? reqProjectName.trim()
      : (record.projectName || currentConfig.projectName);
    const targetProject = (rawProject || '')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!targetProject) {
      return res.status(400).json({ success: false, error: 'Project name is mandatory. Please configure a project name before deploying.' });
    }

    // Check quota
    const quota = await getQuotaStatus(false, deviceId);
    if (quota.daily.isExceeded) {
      return res.status(429).json({
        success: false,
        error: `Daily free tier deployment limit reached (${quota.daily.limit}/${quota.daily.limit}). Next reset in ${quota.reset.countdownFormatted}.`
      });
    }

    // Validate newSlug if changing URL name
    let targetSlug = originalSlug;
    const isUrlRenamed = Boolean(newSlug && newSlug.trim() && newSlug.trim().toLowerCase() !== originalSlug.toLowerCase());

    if (isUrlRenamed) {
      targetSlug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (targetSlug.length < 3) {
        return res.status(400).json({ success: false, error: 'New site name must be at least 3 characters.' });
      }

      // Check for collision with other existing deployments
      const collision = getDeploymentRecord(targetSlug);
      if (collision && collision.slug !== originalSlug) {
        return res.status(400).json({ success: false, error: `Site name '${targetSlug}' is already taken.` });
      }
    }

    const pageTitle = title || record.title || `Drop ${targetSlug.toUpperCase()}`;
    const pageSubtitle = subtitle || 'Generated live via Cloudflare Pages Direct Upload CLI Workflow';
    const pageContent = content || 'Live static endpoint served from Cloudflare global Edge CDN.';

    let html = null;
    if (!files || files.length === 0) {
      html = buildPageHtml({
        template: 'landing',
        title: pageTitle,
        subtitle: pageSubtitle,
        content: pageContent,
        slug: targetSlug
      });
    }

    let deployType = 'direct';
    if (files && files.length > 0) {
      deployType = files.length === 1 ? 'file' : 'folder';
    }

    let staged;
    try {
      staged = prepareStaging({
        slug: targetSlug,
        html,
        files,
        title: pageTitle,
        mode: record.mode || 'branch',
        autoRenameIndex: Boolean(autoRenameIndex)
      });
    } catch (err) {
      if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || (err.message && err.message.includes('exceeds Cloudflare Pages'))) {
        err.statusCode = 400;
      }
      throw err;
    }

    const logs = [];
    const onLog = (msg) => logs.push(msg);

    const deployResult = await deployWithWrangler({
      deployDir: staged.deployDir,
      slug: targetSlug,
      projectName: targetProject,
      mode: record.mode || 'branch',
      title: pageTitle,
      template: deployType,
      deviceId,
      dryRun: Boolean(record.isSimulation),
      skipRecord: true,
      commitMessage: `Redeploy-${targetSlug}`,
      onLog
    });

    // If URL was renamed, deploy redirect page to the old branch so old links point to new location
    if (isUrlRenamed) {
      try {
        const buildsDir = path.resolve(__dirname, '..', 'dist', 'builds');
        const oldRedirectDir = path.join(buildsDir, `_redirect_${originalSlug}`);
        fs.mkdirSync(oldRedirectDir, { recursive: true });
        const redirHtml = buildRedirectPageHtml(deployResult.url, targetSlug);
        fs.writeFileSync(path.join(oldRedirectDir, 'index.html'), redirHtml, 'utf8');

        await deployWithWrangler({
          deployDir: oldRedirectDir,
          slug: originalSlug,
          mode: record.mode || 'branch',
          title: `Moved to ${targetSlug}`,
          template: 'direct',
          deviceId,
          dryRun: Boolean(record.isSimulation),
          skipRecord: true,
          commitMessage: `Redirect-${originalSlug}-to-${targetSlug}`
        });
        onLog(`[REDIRECT] Deployed redirect from old URL to new URL: ${deployResult.url}`);
      } catch (redirErr) {
        onLog(`[REDIRECT NOTICE] Could not deploy redirect to old URL: ${redirErr.message}`);
      }
    }

    // Update existing record
    const updatedRecord = await updateDeploymentRecord(originalSlug, {
      slug: targetSlug,
      projectName: targetProject,
      title: pageTitle,
      template: deployType,
      url: deployResult.url,
      canonicalUrl: deployResult.url,
      status: 'active',
      pausedAt: null,
      redeployCount: (record.redeployCount || 0) + 1,
      lastRedeployedAt: new Date().toISOString(),
      originalSlug: record.originalSlug || (isUrlRenamed ? originalSlug : null)
    }, deviceId);

    const updatedQuota = await getQuotaStatus(false, deviceId);

    res.json({
      success: true,
      deployment: updatedRecord,
      url: deployResult.url,
      slug: targetSlug,
      originalSlug,
      isSimulation: deployResult.isSimulation,
      fileCount: staged.fileCount,
      deployType,
      logs,
      quota: updatedQuota
    });
  } catch (err) {
    next(err);
  }
});

// API: Delete a deployment from tracker (ensuring device ownership)
app.delete('/api/deployments/:id', async (req, res, next) => {
  try {
    await removeDeploymentRecord(req.params.id, req.deviceId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Central JSON Error Handler
// 4xx returns message; 5xx returns "Internal server error" + masked log + requestId
app.use((err, req, res, next) => {
  const requestId = req.headers['x-request-id'] || `err_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const status = err.statusCode || err.status || 500;

  if (status >= 400 && status < 500) {
    return res.status(status).json({
      success: false,
      error: err.message || 'Client error'
    });
  }

  // 5xx: Mask secrets in server log, never leak details to client
  const scrubSecrets = (str) => String(str || '')
    .replace(/(cfat_[a-zA-Z0-9_-]{10,})/g, (m) => m.slice(0, 4) + '...' + m.slice(-4))
    .replace(/([a-zA-Z0-9_-]{40,50})/g, (m) => m.slice(0, 4) + '...' + m.slice(-4))
    .replace(/([a-f0-9]{32})/gi, (m) => m.slice(0, 4) + '...' + m.slice(-4));

  const maskedMsg = scrubSecrets(err.message);
  const maskedError = scrubSecrets(err.stack || err.message || '');

  console.error(`[SERVER 500 ERROR] [RequestId: ${requestId}] ${err.name || 'Error'}: ${maskedMsg}\n${maskedError}`);

  return res.status(500).json({
    success: false,
    error: 'Internal server error',
    requestId
  });
});

// Explicit 404 for unmatched API routes (prevents fallback to index.html for API requests)
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`
  });
});

// Fallback to index.html for SPA routes
app.use((req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'public', 'index.html'));
});

const PORT = config.port || 3000;
const HOST = config.host || '127.0.0.1';

// Binding to any non-loopback host requires explicit env var and auth enabled
const isLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
if (!isLoopback) {
  const allowExternal = process.env.ALLOW_EXTERNAL_BINDING === 'true';
  const authEnabled = process.env.AUTH_ENABLED === 'true';
  if (!allowExternal || !authEnabled) {
    console.error('FATAL: Binding to external host requires ALLOW_EXTERNAL_BINDING=true and AUTH_ENABLED=true.');
    process.exit(1);
  }
}

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`⚡ Cloudflare Pages Workflow & Auto-Updating Quota Dashboard running on:`);
    console.log(`   👉 http://${HOST}:${PORT}`);
  });
}

module.exports = app;
