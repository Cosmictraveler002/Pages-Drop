#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const REQUIREMENTS_FILE = path.join(ROOT_DIR, 'requirements.txt');
const SERVER_FILE = path.join(ROOT_DIR, 'server', 'server.js');

/**
 * Parses requirements.txt and returns an array of package definitions.
 */
function parseRequirements() {
  if (!fs.existsSync(REQUIREMENTS_FILE)) {
    return [];
  }
  const lines = fs.readFileSync(REQUIREMENTS_FILE, 'utf8').split(/\r?\n/);
  const packages = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    // Parse package name (supports regular and scoped packages: e.g., express>=5.0, @scoped/pkg^1.0)
    let pkgName = '';
    if (line.startsWith('@')) {
      const match = line.slice(1).match(/^([^@>=<~^]+)/);
      if (match) {
        pkgName = '@' + match[1].trim();
      }
    } else {
      const match = line.match(/^([^@>=<~^]+)/);
      if (match) {
        pkgName = match[1].trim();
      }
    }

    if (pkgName) {
      packages.push({ raw: line, name: pkgName });
    }
  }

  return packages;
}

/**
 * Checks which packages from requirements.txt are missing from node_modules.
 */
function getMissingPackages(packages) {
  const missing = [];
  for (const pkg of packages) {
    try {
      require.resolve(pkg.name, { paths: [ROOT_DIR] });
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        missing.push(pkg);
      }
    }
  }
  return missing;
}

/**
 * Installs missing packages using npm install.
 */
function installDependencies(missing = []) {
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';

  if (missing.length > 0) {
    console.log('[REQUIREMENTS] Missing dependencies detected from requirements.txt:');
    missing.forEach(m => console.log(`   - ${m.raw || m.name}`));
  }
  console.log('[REQUIREMENTS] Running npm install to resolve dependencies...');

  const result = spawnSync(npmCmd, ['install'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: isWindows
  });

  if (result.status !== 0) {
    console.error(`[REQUIREMENTS ERROR] npm install exited with code ${result.status}.`);
    return false;
  }

  console.log('[REQUIREMENTS] All dependencies verified and ready.');
  return true;
}

/**
 * Starts the server and auto-recovers if a MODULE_NOT_FOUND failure occurs.
 */
function runServer(allowAutoRecover = true) {
  const requirements = parseRequirements();
  const missing = getMissingPackages(requirements);

  if (missing.length > 0) {
    const installed = installDependencies(missing);
    if (!installed) {
      console.warn('[REQUIREMENTS WARNING] Could not install all packages. Attempting server startup anyway...');
    }
  }

  const child = spawn(process.execPath, [SERVER_FILE], {
    cwd: ROOT_DIR,
    stdio: 'inherit'
  });

  child.on('exit', (code, signal) => {
    // If the server exited abnormally and auto-recover hasn't run yet
    if (code === 1 && allowAutoRecover) {
      const remainingMissing = getMissingPackages(requirements);
      if (remainingMissing.length > 0) {
        console.warn('[REQUIREMENTS] Server crashed due to missing module. Auto-installing dependencies...');
        const installed = installDependencies(remainingMissing);
        if (installed) {
          console.log('[REQUIREMENTS] Restarting server...');
          return runServer(false);
        }
      }
    }
    process.exit(code ?? (signal ? 1 : 0));
  });

  process.on('SIGINT', () => {
    if (!child.killed) child.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
    if (!child.killed) child.kill('SIGTERM');
  });
  return child;
}

if (require.main === module) {
  runServer();
}

module.exports = {
  parseRequirements,
  getMissingPackages,
  installDependencies,
  runServer
};
