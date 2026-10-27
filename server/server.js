const express = require('express');
const cors = require('cors');
const path = require('path');
const { getConfig, updateConfig } = require('../lib/config');
const { generateRandomSlug, buildPageHtml, prepareStaging } = require('../lib/page-generator');
const { deployWithWrangler } = require('../lib/deployer');
const { getQuotaStatus, getLocalDeployments, removeDeploymentRecord } = require('../lib/tracker');
const cfApi = require('../lib/cf-api');

const app = express();
const config = getConfig();

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// API: Get live quota status & countdown
app.get('/api/status', async (req, res) => {
  try {
    const sync = req.query.sync === 'true';
    const status = await getQuotaStatus(sync);
    res.json({ success: true, status });
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

// API: Generate & Deploy a live static page
app.post('/api/deployments/generate', async (req, res) => {
  try {
    const {
      template = 'landing',
      title,
      subtitle,
      content,
      prefix,
      customSlug,
      mode = 'branch',
      dryRun = false
    } = req.body;

    // Check quota before proceeding
    const quota = await getQuotaStatus(false);
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
    const pageSubtitle = subtitle || 'Generated live via Cloudflare Pages CLI Workflow';
    const pageContent = content || 'Live static page served from Cloudflare global Edge CDN.';

    // Compile HTML
    const html = buildPageHtml({
      template,
      title: pageTitle,
      subtitle: pageSubtitle,
      content: pageContent,
      slug
    });

    // Stage files
    const staged = prepareStaging({
      slug,
      html,
      mode
    });

    // Deploy logs collector
    const logs = [];
    const onLog = (msg) => logs.push(msg);

    const deployResult = await deployWithWrangler({
      deployDir: staged.deployDir,
      slug,
      mode,
      title: pageTitle,
      template,
      dryRun: Boolean(dryRun),
      onLog
    });

    const updatedQuota = await getQuotaStatus(false);

    res.json({
      success: true,
      deployment: deployResult.record,
      url: deployResult.url,
      slug: deployResult.slug,
      isSimulation: deployResult.isSimulation,
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
    const { template = 'landing', title, subtitle, content, slug = 'preview-demo' } = req.body;
    const html = buildPageHtml({
      template,
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

// API: Verify Cloudflare Token & Account
app.post('/api/verify', async (req, res) => {
  try {
    const result = await cfApi.verifyToken();
    res.json(result);
  } catch (err) {
    res.status(500).json({ valid: false, message: err.message });
  }
});

// API: Update Config Settings
app.post('/api/config', (req, res) => {
  try {
    const { accountId, apiToken, projectName, dailyFreeLimit } = req.body;
    const updated = updateConfig({
      accountId,
      apiToken,
      projectName,
      dailyFreeLimit: dailyFreeLimit ? parseInt(dailyFreeLimit, 10) : undefined
    });
    res.json({ success: true, config: updated });
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
app.listen(PORT, () => {
  console.log(`⚡ Cloudflare Pages Workflow & Auto-Updating Quota Dashboard running on:`);
  console.log(`   👉 http://localhost:${PORT}`);
});
