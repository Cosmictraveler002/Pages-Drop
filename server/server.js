const express = require('express');
const path = require('path');
const { getConfig, updateConfig } = require('../lib/config');
const { generateRandomSlug, buildPageHtml, prepareStaging } = require('../lib/page-generator');
const { deployWithWrangler } = require('../lib/deployer');
const { getQuotaStatus, getLocalDeployments, removeDeploymentRecord } = require('../lib/tracker');
const { getDeviceConfig } = require('../lib/device-storage');
const {
  authMiddleware,
  originCheckMiddleware,
  issueDeviceCredentials,
  setDeviceSecretCookie,
  checkUnauthRateLimit,
  getClientIp
} = require('../lib/auth');
const cfApi = require('../lib/cf-api');

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
  const { deviceId, secret } = issueDeviceCredentials();
  setDeviceSecretCookie(res, secret, req);
  res.json({ success: true, deviceId });
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
}, 60 * 1000);

// API: Get list of deployed links (caller records only + pagination)
app.get('/api/deployments', (req, res, next) => {
  try {
    const deviceId = req.deviceId;
    const callerDeployments = getLocalDeployments(deviceId);

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
      mode = 'branch',
      dryRun = false,
      autoRenameIndex = true
    } = req.body;

    const executeDeploy = async () => {
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

// API: Update Config Settings (stored locally per device & in .env)
app.post('/api/config', (req, res) => {
  try {
    const deviceId = req.deviceId;
    const { accountId, apiToken, projectName, dailyFreeLimit } = req.body;
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
  const maskedError = (err.stack || err.message || '')
    .replace(/(cfat_[a-zA-Z0-9_-]{10,})/g, (m) => m.slice(0, 4) + '...' + m.slice(-4))
    .replace(/([a-f0-9]{32})/gi, (m) => m.slice(0, 4) + '...' + m.slice(-4));

  console.error(`[SERVER 500 ERROR] [RequestId: ${requestId}] ${err.name || 'Error'}: ${err.message}\n${maskedError}`);

  return res.status(500).json({
    success: false,
    error: 'Internal server error',
    requestId
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

app.listen(PORT, HOST, () => {
  console.log(`⚡ Cloudflare Pages Workflow & Auto-Updating Quota Dashboard running on:`);
  console.log(`   👉 http://${HOST}:${PORT}`);
});
