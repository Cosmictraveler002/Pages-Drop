const express = require('express');
const cors = require('cors');
const path = require('path');
const { getConfig, updateConfig } = require('../lib/config');
const { generateRandomSlug, buildPageHtml, prepareStaging } = require('../lib/page-generator');
const { deployWithWrangler } = require('../lib/deployer');
const { getQuotaStatus, getLocalDeployments, removeDeploymentRecord } = require('../lib/tracker');
const { getDeviceConfig } = require('../lib/device-storage');
const cfApi = require('../lib/cf-api');

const app = express();
const config = getConfig();

app.use(cors());
// Support multi-file / folder uploads up to 50MB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// Helper to extract device identifier
function extractDeviceId(req) {
  return req.headers['x-device-id'] || req.query.deviceId || (req.body && req.body.deviceId) || null;
}

// API: Check device credentials & registration status
app.get('/api/device', (req, res) => {
  const deviceId = extractDeviceId(req);
  if (!deviceId) {
    return res.json({ registered: false, deviceId: null, message: 'No Device ID provided' });
  }
  const devConfig = getDeviceConfig(deviceId);
  res.json({
    registered: Boolean(devConfig && devConfig.apiToken),
    deviceId,
    projectName: (devConfig && devConfig.projectName) || config.projectName,
    hasToken: Boolean(devConfig && devConfig.apiToken),
    updatedAt: devConfig ? devConfig.updatedAt : null
  });
});

// API: Get live quota status & countdown (device-aware)
app.get('/api/status', async (req, res) => {
  try {
    const sync = req.query.sync === 'true';
    const deviceId = extractDeviceId(req);
    const status = await getQuotaStatus(sync, deviceId);
    res.json({ success: true, status, deviceId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get list of deployed links
app.get('/api/deployments', (req, res) => {
  try {
    const deployments = getLocalDeployments();
    res.json({ success: true, deployments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Generate & Deploy a live static page or dropped folder/files
app.post('/api/deployments/generate', async (req, res) => {
  try {
    const deviceId = extractDeviceId(req);
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

    // Check quota before proceeding
    const quota = await getQuotaStatus(false, deviceId);
    if (quota.daily.isExceeded) {
      return res.status(429).json({
        success: false,
        error: `Daily free tier deployment limit reached (${quota.daily.limit}/${quota.daily.limit}). Next reset in ${quota.reset.countdownFormatted}.`
      });
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
    const staged = prepareStaging({
      slug,
      html,
      files,
      title: pageTitle,
      mode,
      autoRenameIndex: Boolean(autoRenameIndex)
    });

    // Deploy logs collector
    const logs = [];
    const onLog = (msg) => logs.push(msg);

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

    res.json({
      success: true,
      deployment: deployResult.record,
      url: deployResult.url,
      slug: deployResult.slug,
      isSimulation: deployResult.isSimulation,
      fileCount: staged.fileCount,
      deployType,
      logs,
      quota: updatedQuota
    });
  } catch (err) {
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
    const deviceId = extractDeviceId(req);
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
    const deviceId = extractDeviceId(req);
    const { accountId, apiToken, projectName, dailyFreeLimit } = req.body;
    const updated = updateConfig({
      accountId,
      apiToken,
      projectName,
      dailyFreeLimit: dailyFreeLimit ? parseInt(dailyFreeLimit, 10) : undefined
    }, deviceId);
    res.json({ success: true, config: updated, deviceId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Delete a deployment from tracker
app.delete('/api/deployments/:id', (req, res) => {
  try {
    removeDeploymentRecord(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
