#!/usr/bin/env node

/**
 * Cross-Platform Codebase Linter & Syntax Validator
 * Validates JavaScript syntax across all source, library, script, test, and frontend files.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

const SCAN_DIRS = ['server', 'cli', 'lib', 'scripts', 'tests', path.join('public', 'js')];
const IGNORED_DIRS = ['node_modules', 'dist', 'build', '.wrangler', '.agents', 'scratch', 'data'];

function getJsFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        results = results.concat(getJsFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function runLint() {
  console.log('====================================================');
  console.log('       PROJECT SYNTAX & INTEGRITY LINTER            ');
  console.log('====================================================\n');

  let totalFiles = 0;
  let errors = 0;
  const jsFiles = [];

  for (const relDir of SCAN_DIRS) {
    const fullDir = path.join(ROOT_DIR, relDir);
    const files = getJsFiles(fullDir);
    jsFiles.push(...files);
  }

  totalFiles = jsFiles.length;
  console.log(`Discovered ${totalFiles} JavaScript file(s) to validate...\n`);

  for (const file of jsFiles) {
    const relPath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    const result = spawnSync(process.execPath, ['-c', file], {
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      errors++;
      console.error(`[FAIL] ${relPath}`);
      if (result.stderr) {
        console.error(`       ${result.stderr.trim()}`);
      }
    } else {
      console.log(`[PASS] ${relPath}`);
    }
  }

  console.log('\n====================================================');
  console.log(`Summary: ${totalFiles - errors}/${totalFiles} passed`);
  if (errors > 0) {
    console.error(`Failed:  ${errors} error(s) found.`);
    console.log('====================================================');
    process.exit(1);
  } else {
    console.log('Status:  Zero syntax or integrity errors detected.');
    console.log('====================================================');
    process.exit(0);
  }
}

runLint();
