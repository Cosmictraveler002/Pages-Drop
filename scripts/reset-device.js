#!/usr/bin/env node

/**
 * Reset Device Credentials & Identity CLI
 * Clears registered devices and encrypted vaults so you can re-link with a fresh Device ID.
 *
 * Usage:
 *   node scripts/reset-device.js            (resets all registered device sessions)
 *   node scripts/reset-device.js --device DEV-... (resets specific device ID)
 *   npm run reset:device
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const VAULTS_DIR = path.join(DATA_DIR, 'vaults');

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  orange: '\x1b[38;5;208m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  dim: '\x1b[2m'
};

function banner() {
  console.log(`
${colors.orange}${colors.bright}┌────────────────────────────────────────────────────────┐
│     🔐 CLOUDFLARE DASHBOARD: DEVICE CREDENTIALS RESET  │
└────────────────────────────────────────────────────────┘${colors.reset}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    targetDevice: null,
    all: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--device' || arg === '-d') {
      options.targetDevice = args[++i];
    } else if (arg === '--all' || arg === '-a') {
      options.all = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function run() {
  banner();
  const options = parseArgs();

  if (options.help) {
    console.log(`
${colors.bright}COMMAND USAGE:${colors.reset}
  npm run reset:device                 # Reset all device credentials
  node scripts/reset-device.js         # Reset all device credentials
  node scripts/reset-device.js --device DEV-XXXXXXXXXXXXXXXX

${colors.bright}OPTIONS:${colors.reset}
  --all, -a            Reset and unlink all devices (default)
  --device, -d <id>    Reset a specific Device ID
  --help, -h           Show this help message
`);
    process.exit(0);
  }

  console.log(`${colors.dim}Scanning data store...${colors.reset}`);

  let store = { devices: {} };
  if (fs.existsSync(DEVICES_FILE)) {
    try {
      const raw = fs.readFileSync(DEVICES_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      store = parsed.devices ? parsed : { devices: parsed };
      if (!store.devices) store.devices = {};
    } catch (err) {
      console.warn(`${colors.yellow}[!] Warning reading devices file: ${err.message}${colors.reset}`);
    }
  }

  const existingDevices = Object.keys(store.devices || {});
  console.log(`Found ${colors.bright}${existingDevices.length}${colors.reset} registered device(s) on server.\n`);

  if (existingDevices.length > 0) {
    existingDevices.forEach((id) => {
      const dev = store.devices[id] || {};
      const proj = dev.projectName || '(default)';
      console.log(`  • ${colors.cyan}${id}${colors.reset} [Project: ${proj}]`);
    });
    console.log('');
  }

  if (options.targetDevice) {
    const target = options.targetDevice.trim();
    if (!store.devices[target]) {
      console.log(`${colors.yellow}[!] Device "${target}" not found in devices.json.${colors.reset}`);
    } else {
      delete store.devices[target];
      fs.writeFileSync(DEVICES_FILE, JSON.stringify(store, null, 2), 'utf8');
      console.log(`${colors.green}[✔] Device ${target} removed from server registry.${colors.reset}`);
    }

    // Also remove vault file if exists
    const vaultPath = path.join(VAULTS_DIR, `${target}.json`);
    if (fs.existsSync(vaultPath)) {
      try {
        fs.unlinkSync(vaultPath);
        console.log(`${colors.green}[✔] Vault file ${target}.json deleted.${colors.reset}`);
      } catch (_) {}
    }
  } else {
    // Reset all devices
    store.devices = {};
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(store, null, 2), 'utf8');
    console.log(`${colors.green}[✔] All device credentials removed from devices.json.${colors.reset}`);

    // Clean vaults directory
    if (fs.existsSync(VAULTS_DIR)) {
      try {
        const vaults = fs.readdirSync(VAULTS_DIR);
        for (const file of vaults) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(VAULTS_DIR, file));
          }
        }
        console.log(`${colors.green}[✔] Cleared ${vaults.length} encrypted vault file(s).${colors.reset}`);
      } catch (_) {}
    }
  }

  console.log(`
${colors.orange}${colors.bright}════════════════════════════════════════════════════════════════${colors.reset}
${colors.bright}NEXT STEPS TO LOG IN WITH A NEW DEVICE ID:${colors.reset}
${colors.orange}${colors.bright}════════════════════════════════════════════════════════════════${colors.reset}

1. In your browser at ${colors.cyan}http://localhost:3000${colors.reset}:
   - Open Developer Tools (${colors.bright}F12${colors.reset} or ${colors.bright}Ctrl+Shift+I${colors.reset}) -> Console
   - Paste and run:
     ${colors.yellow}localStorage.removeItem('cf_device_id'); location.reload();${colors.reset}

2. Or simply click ${colors.bright}[Reset Device & Re-link]${colors.reset} in the dashboard Settings window.

3. The dashboard will automatically issue and link a fresh, unique ${colors.bright}DEV-XXXXXXXXXXXXXXXX${colors.reset} ID!
`);
}

run();

