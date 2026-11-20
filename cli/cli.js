#!/usr/bin/env node

/**
 * Cloudflare Pages Random Link Generator & CLI Workflow
 */

const { getConfig } = require('../lib/config');
const { generateRandomSlug, buildPageHtml, prepareStaging } = require('../lib/page-generator');
const { deployWithWrangler } = require('../lib/deployer');
const { getQuotaStatus, getLocalDeployments } = require('../lib/tracker');

// ANSI Color Helpers
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  orange: '\x1b[38;5;208m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  bgDark: '\x1b[48;5;235m'
};

function printBanner() {
  console.log(`
${colors.orange}${colors.bright}┌────────────────────────────────────────────────────────┐
│  ⚡ CLOUDFLARE PAGES RANDOM LINK WORKFLOW (FREE TIER)  │
└────────────────────────────────────────────────────────┘${colors.reset}`);
}

function printHelp() {
  printBanner();
  console.log(`
${colors.bright}USAGE:${colors.reset}
  node cli/cli.js [options]

${colors.bright}OPTIONS:${colors.reset}
  --deploy                Deploy live to Cloudflare Pages via Wrangler CLI
  --template <name>       Template name: landing, secret, showcase, bio, custom (default: landing)
  --title <string>        Custom page headline / title
  --subtitle <string>     Custom subtitle
  --content <string>      Body content / text / encrypted note
  --slug <string>         Specify exact slug (default: auto-generates 7-character random slug)
  --prefix <string>       Prefix for generated slug (e.g., "drop", "note")
  --mode <branch|path>    Deployment mode (default: branch)
                            - 'branch': https://<random-slug>.<project>.pages.dev
                            - 'path':   https://<project>.pages.dev/r/<random-slug>
  --status                Display live Daily Free Quota, Monthly Builds & Reset Countdown
  --dry-run               Run build and simulation without publishing to Cloudflare
  --help, -h              Show this help guide

${colors.bright}EXAMPLES:${colors.reset}
  ${colors.cyan}# 1. Generate & deploy a live random landing page:${colors.reset}
  node cli/cli.js --deploy

  ${colors.cyan}# 2. Deploy a secret note with custom content:${colors.reset}
  node cli/cli.js --deploy --template secret --title "Confidential Note" --content "Passcode: 4892"

  ${colors.cyan}# 3. Check remaining daily free tier deployments:${colors.reset}
  node cli/cli.js --status
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    deploy: false,
    template: 'landing',
    title: '',
    subtitle: '',
    content: '',
    slug: '',
    prefix: '',
    projectName: '',
    mode: 'branch',
    status: false,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--status') options.status = true;
    else if (arg === '--deploy') options.deploy = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--template' && args[i + 1]) options.template = args[++i];
    else if (arg === '--title' && args[i + 1]) options.title = args[++i];
    else if (arg === '--subtitle' && args[i + 1]) options.subtitle = args[++i];
    else if (arg === '--content' && args[i + 1]) options.content = args[++i];
    else if (arg === '--slug' && args[i + 1]) options.slug = args[++i];
    else if (arg === '--prefix' && args[i + 1]) options.prefix = args[++i];
    else if ((arg === '--project-name' || arg === '--project') && args[i + 1]) options.projectName = args[++i];
    else if (arg === '--mode' && args[i + 1]) options.mode = args[++i];
  }

  return options;
}

async function showStatus() {
  printBanner();
  console.log(`${colors.cyan}📊 Fetching Daily Free Limit & Usage Status...${colors.reset}\n`);

  const status = await getQuotaStatus(true);
  const config = getConfig();

  const dailyBar = getProgressBar(status.daily.percentage);
  const monthlyBar = getProgressBar(status.monthly.percentage);

  console.log(`${colors.bright}Cloudflare Project:${colors.reset} ${colors.orange}${config.projectName}${colors.reset}`);
  console.log(`${colors.bright}Credentials:${colors.reset}        ${config.hasCredentials ? colors.green + '✓ Connected to Cloudflare API' : colors.yellow + '⚠️ Simulation Mode (No Token Configured)'}${colors.reset}`);
  console.log('');
  console.log(`${colors.bright}DAILY FREE QUOTA:${colors.reset}`);
  console.log(`  Used Today:      ${colors.bright}${status.daily.used}${colors.reset} / ${status.daily.limit} deployments`);
  console.log(`  Remaining Free:  ${colors.green}${colors.bright}${status.daily.remaining}${colors.reset} deployments`);
  console.log(`  Usage:           [${dailyBar}] ${status.daily.percentage}%`);
  console.log(`  Daily Reset In:  ${colors.cyan}${status.reset.countdownFormatted}${colors.reset} (00:00:00 UTC)`);
  console.log('');
  console.log(`${colors.bright}MONTHLY BUILD ALLOWANCE:${colors.reset}`);
  console.log(`  Used This Month: ${colors.bright}${status.monthly.used}${colors.reset} / ${status.monthly.limit} builds`);
  console.log(`  Remaining:       ${colors.green}${status.monthly.remaining}${colors.reset} builds`);
  console.log(`  Usage:           [${monthlyBar}] ${status.monthly.percentage}%`);
  console.log('');
  console.log(`${colors.bright}Total Tracked Pages:${colors.reset} ${status.totalTrackedPages}`);
  console.log('────────────────────────────────────────────────────────');
}

function getProgressBar(percent, length = 20) {
  const filled = Math.min(length, Math.max(0, Math.round((percent / 100) * length)));
  const empty = length - filled;
  const color = percent > 80 ? colors.red : percent > 50 ? colors.yellow : colors.green;
  return `${color}${'█'.repeat(filled)}${colors.dim}${'░'.repeat(empty)}${colors.reset}`;
}

async function run() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  if (options.status) {
    await showStatus();
    return;
  }

  printBanner();

  // 0. Project name is mandatory
  const cfg = getConfig();
  const effectiveProject = options.projectName || cfg.projectName;
  if (!effectiveProject || !effectiveProject.trim()) {
    console.error(`\n${colors.red}${colors.bright}❌ ERROR: Project name is mandatory.${colors.reset} Please configure a project name via .env or pass --project-name <name>.`);
    process.exit(1);
  }

  // 1. Check Daily Free Limit before executing
  const quota = await getQuotaStatus(false);
  if (quota.daily.isExceeded) {
    console.error(`\n${colors.red}${colors.bright}⚠️ DAILY FREE LIMIT EXCEEDED!${colors.reset}`);
    console.error(`You have reached the daily quota of ${quota.daily.limit} deployments.`);
    console.error(`Next reset in: ${colors.cyan}${quota.reset.countdownFormatted}${colors.reset} (00:00:00 UTC)`);
    console.error(`To protect your free tier, deployment was paused.`);
    process.exit(1);
  }

  // 2. Generate random slug
  const slug = options.slug || generateRandomSlug({
    prefix: options.prefix,
    length: 7
  });

  const title = options.title || `Instant Drop: ${slug}`;
  const subtitle = options.subtitle || 'Generated live via Cloudflare Pages CLI Workflow';
  const content = options.content || 'This live static site was built and published to the Cloudflare global edge network with zero server overhead.';

  console.log(`${colors.bright}⚡ Generating Static Page...${colors.reset}`);
  console.log(`  • Random Slug:   ${colors.orange}${slug}${colors.reset}`);
  console.log(`  • Template:      ${colors.cyan}${options.template}${colors.reset}`);
  console.log(`  • Title:         ${title}`);
  console.log(`  • Mode:          ${options.mode}`);

  // 3. Render HTML
  const html = buildPageHtml({
    template: options.template,
    title,
    subtitle,
    content,
    slug
  });

  // 4. Stage files for Wrangler
  const staged = prepareStaging({
    slug,
    html,
    mode: options.mode
  });

  console.log(`  • Staged Path:   ${colors.dim}${staged.htmlPath}${colors.reset}`);

  // 5. Deploy or simulate
  console.log(`\n${colors.bright}🚀 Executing Cloudflare Pages Direct Upload...${colors.reset}`);

  try {
    const result = await deployWithWrangler({
      deployDir: staged.deployDir,
      slug,
      mode: options.mode,
      title,
      template: options.template,
      dryRun: options.dryRun || !options.deploy,
      onLog: (line) => console.log(`   ${colors.dim}${line}${colors.reset}`)
    });

    console.log(`\n${colors.green}${colors.bright}🎉 SUCCESS! LIVE STATIC PAGE IS READY:${colors.reset}`);
    console.log(`\n   👉 ${colors.bright}${colors.cyan}${result.url}${colors.reset}\n`);

    if (result.isSimulation) {
      console.log(`${colors.yellow}ℹ️ Note: Staged locally. To deploy live to Cloudflare edge CDN, run with --deploy flag.${colors.reset}`);
      console.log(`   Command: node cli/cli.js --deploy\n`);
    }

    // Show updated quota
    const updatedQuota = await getQuotaStatus(false);
    console.log(`${colors.bright}Daily Quota Remaining:${colors.reset} ${colors.green}${updatedQuota.daily.remaining}${colors.reset} / ${updatedQuota.daily.limit} deployments today`);
    console.log(`${colors.dim}Next UTC Reset in: ${updatedQuota.reset.countdownFormatted}${colors.reset}\n`);

  } catch (err) {
    console.error(`\n${colors.red}${colors.bright}❌ DEPLOYMENT FAILED:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
