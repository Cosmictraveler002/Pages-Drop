const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { templates } = require('./templates');

// Generate safe, collision-resistant random slug for Cloudflare subdomains or URL paths
function generateRandomSlug(options = {}) {
  const prefix = options.prefix ? `${options.prefix.toLowerCase().replace(/[^a-z0-9-]/g, '')}-` : '';
  const length = options.length || 7;

  // Use cryptographic random bytes converted to base36 (alphanumeric lowercase)
  const bytes = crypto.randomBytes(Math.ceil(length * 0.75));
  let slug = bytes.toString('hex').slice(0, length);

  // Cloudflare branch names must start and end with an alphanumeric character
  // and be under 63 characters
  return `${prefix}${slug}`.toLowerCase();
}

function buildPageHtml(data = {}) {
  const templateName = data.template && templates[data.template] ? data.template : 'landing';
  const renderer = templates[templateName];
  return renderer(data);
}

/**
 * Prepares the files on disk for wrangler pages deploy.
 * @param {Object} params
 * @param {string} params.slug - Unique random slug
 * @param {string} params.html - Compiled HTML content
 * @param {string} params.mode - 'branch' (subdomain) or 'path' (directory path)
 * @returns {Object} { deployDir, htmlPath, slug, mode }
 */
function prepareStaging(params) {
  const { slug, html, mode = 'branch' } = params;
  const rootDir = path.resolve(__dirname, '..');
  const buildsDir = path.join(rootDir, 'dist', 'builds');

  if (!fs.existsSync(buildsDir)) {
    fs.mkdirSync(buildsDir, { recursive: true });
  }

  if (mode === 'branch') {
    // In branch mode, the staging directory contains an index.html at root.
    // Wrangler will deploy this directory as a branch preview deployment.
    // Cloudflare Pages assigns: https://<branch>.<project>.pages.dev
    const deployDir = path.join(buildsDir, slug);
    if (!fs.existsSync(deployDir)) {
      fs.mkdirSync(deployDir, { recursive: true });
    }
    const htmlPath = path.join(deployDir, 'index.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    return {
      deployDir,
      htmlPath,
      slug,
      mode: 'branch'
    };
  } else {
    // In path mode, files are accumulated in dist/static-site/
    // at /r/<slug>/index.html
    const deployDir = path.join(rootDir, 'dist', 'static-site');
    const slugDir = path.join(deployDir, 'r', slug);
    fs.mkdirSync(slugDir, { recursive: true });

    const htmlPath = path.join(slugDir, 'index.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    // Also ensure a root index.html exists if missing
    const rootIndexPath = path.join(deployDir, 'index.html');
    if (!fs.existsSync(rootIndexPath)) {
      const rootHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vault</title><style>body{font-family:sans-serif;background:#090d16;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style></head><body><h1>⚡ Cloudflare Pages Vault</h1></body></html>`;
      fs.writeFileSync(rootIndexPath, rootHtml, 'utf8');
    }

    return {
      deployDir,
      htmlPath,
      slug,
      mode: 'path'
    };
  }
}

module.exports = {
  generateRandomSlug,
  buildPageHtml,
  prepareStaging
};
