const { spawn } = require('child_process');
const path = require('path');
const { getConfig } = require('./config');
const { saveDeploymentRecord } = require('./tracker');

/**
 * Deploys static folder via Wrangler CLI
 * @param {Object} options
 * @param {string} options.deployDir - Absolute directory to upload
 * @param {string} options.slug - Random slug identifier
 * @param {string} options.mode - 'branch' or 'path'
 * @param {string} options.title - Page title
 * @param {string} options.template - Template name
 * @param {boolean} options.dryRun - Whether to simulate without hitting Cloudflare
 * @param {Function} options.onLog - Optional progress stream callback
 */
async function deployWithWrangler(options) {
  const {
    deployDir,
    slug,
    mode = 'branch',
    title = 'Static Page',
    template = 'direct',
    dryRun = false,
    deviceId = null,
    skipRecord = false,
    commitMessage = null,
    projectName: explicitProjectName = null,
    onLog = () => {}
  } = options;

  const config = getConfig(deviceId);
  const rawProject = (explicitProjectName && explicitProjectName.trim())
    ? explicitProjectName.trim()
    : (config.projectName || 'random-pages-vault');
  const projectName = rawProject.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'random-pages-vault';

  let projectDomain = `${projectName}.pages.dev`;

  // If user explicitly requested dry run or has not configured credentials yet
  if (dryRun || !config.hasCredentials) {
    onLog(`[INFO] Running in ${dryRun ? 'Dry-Run' : 'Simulation'} mode (No Cloudflare API token provided or dry-run requested)`);
    onLog(`[BUILD] Staged directory ready at: ${deployDir}`);

    const simulatedUrl = mode === 'branch'
      ? `https://${slug}.${projectDomain}`
      : `https://${projectDomain}/r/${slug}`;

    onLog(`[SUCCESS] Simulated live static link: ${simulatedUrl}`);

    let record = null;
    if (!skipRecord) {
      record = await saveDeploymentRecord({
        deviceId,
        projectName,
        slug,
        title,
        template,
        mode,
        url: simulatedUrl,
        canonicalUrl: simulatedUrl,
        cfDeploymentId: `sim_${Date.now()}`,
        isSimulation: true,
        status: 'active'
      });
    }

    return {
      success: true,
      url: simulatedUrl,
      slug,
      isSimulation: true,
      record
    };
  }

  // Live deployment using Wrangler CLI
  onLog(`[WRANGLER] Starting deployment to Cloudflare Pages project: ${projectName}...`);

  // Ensure project is provisioned on Cloudflare Pages before deploying and resolve canonical domain
  try {
    const cfApi = require('./cf-api');
    const projResult = await cfApi.ensureProjectExists(projectName, deviceId);
    if (projResult && projResult.project) {
      const p = projResult.project;
      if (p.domains && p.domains.length > 0) {
        projectDomain = p.domains[0];
      } else if (p.sub_domain) {
        projectDomain = p.sub_domain;
      }
    }
    if (projResult && projResult.created) {
      onLog(`[PROJECT] Auto-provisioned new Cloudflare Pages project: "${projectName}" (${projectDomain}).`);
    } else {
      onLog(`[PROJECT] Cloudflare Pages project "${projectName}" is ready (${projectDomain}).`);
    }
  } catch (projErr) {
    onLog(`[PROJECT NOTICE] ${projErr.message}`);
  }

  onLog(`[WRANGLER] Deploy directory: ${deployDir}`);
  onLog(`[WRANGLER] Branch: ${mode === 'branch' ? slug : 'main'}`);

  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npx.cmd' : 'npx';

    // Quote paths and flags that may contain spaces when shell: true flattens args on Windows
    const safeDeployDir = isWindows ? `"${deployDir}"` : deployDir;
    const safeProjectNameArg = isWindows ? `"--project-name=${projectName}"` : `--project-name=${projectName}`;
    const branchVal = mode === 'branch' ? slug : 'main';
    const safeBranchArg = isWindows ? `"--branch=${branchVal}"` : `--branch=${branchVal}`;
    const safeCommitMsg = (commitMessage || `Deploy-${slug}`).replace(/"/g, '');
    const safeCommitMsgArg = isWindows ? `"--commit-message=${safeCommitMsg}"` : `--commit-message=${safeCommitMsg}`;

    const args = [
      'wrangler',
      'pages',
      'deploy',
      safeDeployDir,
      safeProjectNameArg,
      safeBranchArg,
      safeCommitMsgArg,
      '--commit-dirty=true'
    ];

    onLog(`[COMMAND] npx ${args.join(' ')}`);

    // Pass environment variables to wrangler
    const env = {
      ...process.env,
      CLOUDFLARE_API_TOKEN: config.apiToken,
      CLOUDFLARE_ACCOUNT_ID: config.accountId
    };

    const child = spawn(npmCmd, args, {
      cwd: path.resolve(__dirname, '..'),
      env,
      shell: isWindows
    });

    let stdoutData = '';
    let stderrData = '';

    const scrubSecrets = (text) => {
      if (!text) return '';
      let s = String(text);
      if (config.apiToken) {
        s = s.replaceAll(config.apiToken, config.apiToken.slice(0, 4) + '...' + config.apiToken.slice(-4));
      }
      return s.replace(/(cfat_[a-zA-Z0-9_-]{10,})/g, (m) => m.slice(0, 4) + '...' + m.slice(-4));
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutData += text;
      onLog(scrubSecrets(text).trim());
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrData += text;
      onLog(`[ERR] ${scrubSecrets(text).trim()}`);
    });

    child.on('close', async (code) => {
      if (code === 0) {
        onLog('[WRANGLER] Deployment completed successfully!');

        // Extract URL from output (supports multi-level subdomains: hash.project-subdomain.pages.dev)
        let liveUrl = null;
        let canonicalUrl = null;
        const urlRegex = /https:\/\/[a-zA-Z0-9_.-]+\.pages\.dev(?:\/[^\s]*)?/gi;
        const rawMatches = stdoutData.match(urlRegex) || [];
        const matches = rawMatches.map(u => u.replace(/[.,;'"\)\]]+$/, ''));

        if (matches && matches.length > 0) {
          // 1. Look for explicit alias URL from stdout
          const aliasMatch = stdoutData.match(/Deployment alias URL:\s*(https:\/\/[a-zA-Z0-9_.-]+\.pages\.dev(?:\/[^\s]*)?)/i);
          if (aliasMatch && aliasMatch[1]) {
            liveUrl = aliasMatch[1].replace(/[.,;'"\)\]]+$/, '');
          }

          // 2. If branch mode, find URL matching the branch slug prefix
          if (!liveUrl && mode === 'branch') {
            const branchMatch = matches.find(u => {
              try {
                const host = new URL(u).hostname.toLowerCase();
                return host.startsWith(`${slug.toLowerCase()}.`);
              } catch (_) {
                return false;
              }
            });
            if (branchMatch) liveUrl = branchMatch;
          }

          // 3. Fallback to first URL (deployment hash URL)
          if (!liveUrl) {
            liveUrl = matches[0];
          }

          canonicalUrl = matches[0];
        }

        // 4. If URL was not found in stdout, attempt to query Cloudflare Deployments API directly
        if (!liveUrl) {
          try {
            const cfApi = require('./cf-api');
            const recentDeps = await cfApi.listDeployments(projectName, 1, 5, deviceId);
            if (Array.isArray(recentDeps) && recentDeps.length > 0) {
              const latest = recentDeps[0];
              if (mode === 'branch' && Array.isArray(latest.aliases) && latest.aliases.length > 0) {
                const matchedAlias = latest.aliases.find(a => a.toLowerCase().includes(`://${slug.toLowerCase()}.`));
                liveUrl = matchedAlias || latest.aliases[0];
              }
              if (!liveUrl && latest.url) {
                liveUrl = latest.url;
              }
              if (latest.url) {
                canonicalUrl = latest.url;
              }
            }
          } catch (cfDepErr) {
            onLog(`[CF NOTICE] Could not resolve deployment URL via API: ${cfDepErr.message}`);
          }
        }

        // 5. Final fallback calculated URL using real projectDomain from Cloudflare
        if (!liveUrl) {
          liveUrl = mode === 'branch'
            ? `https://${slug}.${projectDomain}`
            : `https://${projectDomain}/r/${slug}`;
        }
        if (!canonicalUrl) {
          canonicalUrl = liveUrl;
        }

        let record = null;
        if (!skipRecord) {
          record = await saveDeploymentRecord({
            deviceId,
            projectName,
            slug,
            title,
            template,
            mode,
            url: liveUrl,
            canonicalUrl: canonicalUrl,
            cfDeploymentId: `cf_${Date.now()}`,
            isSimulation: false,
            status: 'active'
          });
        }

        resolve({
          success: true,
          url: liveUrl,
          slug,
          isSimulation: false,
          record,
          logs: stdoutData
        });
      } else {
        const errorMsg = stderrData || stdoutData || `Wrangler exited with code ${code}`;
        onLog(`[WRANGLER FAILED] Exit code ${code}: ${errorMsg}`);

        // If the error indicates project not found, suggest project create
        let help = '';
        if (errorMsg.includes('not found') || errorMsg.includes('Project not found')) {
          help = `\nProject '${projectName}' does not exist yet. Run: npx wrangler pages project create ${projectName} --production-branch main`;
        }

        reject(new Error(`Cloudflare deployment failed (code ${code}): ${errorMsg}${help}`));
      }
    });

    child.on('error', (err) => {
      onLog(`[PROCESS ERROR] ${err.message}`);
      reject(err);
    });
  });
}

module.exports = {
  deployWithWrangler
};
