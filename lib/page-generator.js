const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { templates } = require('./templates');

// Generate safe, collision-resistant random slug for Cloudflare subdomains or URL paths
function generateRandomSlug(options = {}) {
  const prefix = options.prefix ? `${options.prefix.toLowerCase().replace(/[^a-z0-9-]/g, '')}-` : '';
  const length = options.length || 7;

  const bytes = crypto.randomBytes(Math.ceil(length * 0.75));
  let slug = bytes.toString('hex').slice(0, length);

  return `${prefix}${slug}`.toLowerCase();
}

function buildPageHtml(data = {}) {
  const templateName = data.template && templates[data.template] ? data.template : 'landing';
  const renderer = templates[templateName] || templates.landing;
  return renderer(data);
}

/**
 * Generate a brutalist index.html directory listing when files are uploaded without an index.html
 */
function buildDirectoryIndexHtml(title, slug, files = []) {
  const fileRows = files.map(f => {
    const cleanPath = f.path.replace(/^\/+/, '');
    const sizeKb = f.size ? (f.size / 1024).toFixed(1) + ' KB' : '';
    return `
      <tr>
        <td><a href="./${cleanPath}" target="_blank">${cleanPath}</a></td>
        <td style="text-align: right; color: #555;">${sizeKb}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Endpoint ' + slug}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; border-radius: 0 !important; }
    body { font-family: 'Space Mono', Courier, monospace; background: #F4F4EE; color: #000; padding: 40px 20px; font-size: 13px; line-height: 1.5; }
    .container { max-width: 800px; margin: 0 auto; border: 3px solid #000; background: #FFF; box-shadow: 6px 6px 0 #000; padding: 32px; }
    .badge { display: inline-block; background: #000; color: #FFF; padding: 2px 8px; font-size: 11px; font-weight: 700; margin-bottom: 12px; }
    h1 { font-family: -apple-system, sans-serif; font-size: 32px; font-weight: 900; text-transform: uppercase; margin-bottom: 8px; letter-spacing: -0.02em; }
    p { margin-bottom: 24px; color: #222; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; border: 2px solid #000; }
    th { background: #000; color: #FFF; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; }
    td { padding: 10px 12px; border-bottom: 1px solid #000; font-size: 12px; }
    a { color: #000; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
    a:hover { background: #000; color: #FFF; text-decoration: none; }
    .footer { margin-top: 24px; font-size: 11px; text-transform: uppercase; color: #555; border-top: 1px solid #000; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">// ENDPOINT: ${slug}</div>
    <h1>${title || 'Directory Index'}</h1>
    <p>Live static directory compiled and distributed on Cloudflare Pages Edge CDN.</p>
    <table>
      <thead>
        <tr>
          <th>FILE PATH</th>
          <th style="text-align: right;">SIZE</th>
        </tr>
      </thead>
      <tbody>
        ${fileRows}
      </tbody>
    </table>
    <div class="footer">Cloudflare Pages Direct Upload // ${new Date().toUTCString()}</div>
  </div>
</body>
</html>`;
}

// Cloudflare Pages platform limits reference:
// https://developers.cloudflare.com/pages/platform/limits/
// Checked: October 2026
const CF_PAGES_LIMITS = {
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024, // 25 MiB maximum per asset
  MAX_FILE_COUNT: 20000                 // 20,000 files maximum per deployment (Free tier)
};

/**
 * Validates and normalizes relative file paths, rejecting traversal attacks,
 * null bytes, absolute paths, and drive letters.
 *
 * @param {string} rawPath - Incoming path from client
 * @param {string} stagingDir - Absolute target directory
 * @returns {{ valid: boolean, normalizedPath?: string, destPath?: string, reason?: string }}
 */
function sanitizePath(rawPath, stagingDir) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { valid: false, reason: 'Empty or invalid path' };
  }

  // Reject null bytes
  if (rawPath.includes('\0') || rawPath.includes('%00')) {
    return { valid: false, reason: 'Null byte detected in path' };
  }

  // Convert backslashes to forward slashes
  let normalized = rawPath.replace(/\\/g, '/');

  // Reject drive letters (e.g. C:, D:)
  if (/^[a-zA-Z]:/.test(normalized)) {
    return { valid: false, reason: 'Drive letter detected in path' };
  }

  // Reject absolute paths
  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    return { valid: false, reason: 'Absolute path rejected' };
  }

  // Strip leading ./
  normalized = normalized.replace(/^\.\//, '');

  const stagingResolved = path.resolve(stagingDir);
  const destPath = path.resolve(stagingResolved, normalized);
  const rel = path.relative(stagingResolved, destPath);

  // Verify path does not escape stagingDir
  if (rel.startsWith('..') || path.isAbsolute(rel) || destPath === stagingResolved) {
    return { valid: false, reason: 'Path traversal or destination outside staging directory' };
  }

  return {
    valid: true,
    normalizedPath: normalized,
    destPath
  };
}

/**
 * Checks whether a relative path points to a sensitive file or directory.
 * Evaluates at ANY path depth while allowing .well-known/ directories.
 *
 * Excludes: .env*, any .git/ segment, .svn/, .hg/, *.pem, *.key, id_rsa*, id_ed25519*,
 * .aws/, .npmrc, .DS_Store, Thumbs.db.
 *
 * @param {string} normalizedPath
 * @returns {{ sensitive: boolean, reason?: string }}
 */
function isSensitivePath(normalizedPath) {
  const clean = normalizedPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = clean.split('/');
  const fileName = segments[segments.length - 1];

  const sensitiveDirs = ['.git', '.svn', '.hg', '.aws'];

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    // Allow .well-known/ directory segments
    if (seg === '.well-known') {
      continue;
    }
    if (sensitiveDirs.includes(seg)) {
      return { sensitive: true, reason: `Sensitive directory segment: ${seg}` };
    }
    if (seg.startsWith('.env')) {
      return { sensitive: true, reason: `Sensitive environment directory segment: ${seg}` };
    }
  }

  const lowerFile = fileName.toLowerCase();

  // .env* patterns at any depth
  if (lowerFile.startsWith('.env')) {
    return { sensitive: true, reason: 'Environment configuration file' };
  }

  // Git directory / metadata
  if (lowerFile === '.git' || segments.includes('.git')) {
    return { sensitive: true, reason: 'Git repository metadata' };
  }

  // .svn/, .hg/, .aws/ as leaf
  if (sensitiveDirs.includes(lowerFile)) {
    return { sensitive: true, reason: `Sensitive directory metadata: ${lowerFile}` };
  }

  // Cryptographic keys and certificates
  if (lowerFile.endsWith('.pem') || lowerFile.endsWith('.key')) {
    return { sensitive: true, reason: 'Cryptographic key or certificate' };
  }
  if (lowerFile.startsWith('id_rsa') || lowerFile.startsWith('id_ed25519')) {
    return { sensitive: true, reason: 'SSH private/public identity key' };
  }

  // Credentials and system files
  if (lowerFile === '.npmrc') {
    return { sensitive: true, reason: 'NPM config credentials' };
  }
  if (lowerFile === '.ds_store') {
    return { sensitive: true, reason: 'macOS system artifact' };
  }
  if (lowerFile === 'thumbs.db') {
    return { sensitive: true, reason: 'Windows thumbnail cache' };
  }

  return { sensitive: false };
}

/**
 * Prepares the files on disk for wrangler pages deploy.
 * Supports dropped files/folders as well as compiled HTML.
 * @param {Object} params
 * @param {string} params.slug - Unique random slug
 * @param {string} [params.html] - Compiled HTML content (if no files)
 * @param {Array} [params.files] - Uploaded files array [{ path, content, isBase64, size }]
 * @param {string} [params.title] - Page title
 * @param {string} [params.mode] - 'branch' or 'path'
 * @param {boolean} [params.autoRenameIndex] - Whether to auto-rename primary file to index.html
 * @returns {Object} { deployDir, htmlPath, slug, mode, fileCount, excludedFiles, rejectedFiles }
 */
function prepareStaging(params) {
  const { slug, html, files = [], title = '', mode = 'branch', autoRenameIndex = true } = params;
  const rootDir = path.resolve(__dirname, '..');
  const buildsDir = path.join(rootDir, 'dist', 'builds');

  // Enforce Cloudflare Pages deployment file count limit
  if (Array.isArray(files) && files.length > CF_PAGES_LIMITS.MAX_FILE_COUNT) {
    const err = new Error(`File count (${files.length}) exceeds Cloudflare Pages limit of ${CF_PAGES_LIMITS.MAX_FILE_COUNT} files.`);
    err.code = 'LIMIT_FILE_COUNT';
    throw err;
  }

  if (!fs.existsSync(buildsDir)) {
    fs.mkdirSync(buildsDir, { recursive: true });
  }

  const targetDir = mode === 'branch'
    ? path.join(buildsDir, slug)
    : path.join(rootDir, 'dist', 'static-site', 'r', slug);

  if (fs.existsSync(targetDir)) {
    // Clean directory to prevent stale files
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
    } catch (_) {}
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const excludedFiles = [];
  const rejectedFiles = [];
  const validFiles = [];

  // Filter, validate, and sanitize uploaded files
  if (Array.isArray(files) && files.length > 0) {
    for (const file of files) {
      if (!file || !file.path) continue;

      // 1. Enforce per-file size limit (25 MiB Cloudflare Pages limit)
      const fileSize = file.size || (file.content ? Buffer.byteLength(file.content, file.isBase64 ? 'base64' : 'utf8') : 0);
      if (fileSize > CF_PAGES_LIMITS.MAX_FILE_SIZE_BYTES) {
        const err = new Error(`File "${file.path}" (${fileSize} bytes) exceeds Cloudflare Pages 25 MiB limit.`);
        err.code = 'LIMIT_FILE_SIZE';
        throw err;
      }

      // 2. Normalize path and reject traversals, null bytes, drive letters, absolute paths
      const pathCheck = sanitizePath(file.path, targetDir);
      if (!pathCheck.valid) {
        rejectedFiles.push({ path: file.path, reason: pathCheck.reason });
        continue;
      }

      // 3. Exclude sensitive files at ANY path depth
      const sensCheck = isSensitivePath(pathCheck.normalizedPath);
      if (sensCheck.sensitive) {
        excludedFiles.push(file.path);
        continue;
      }

      validFiles.push({
        ...file,
        normalizedPath: pathCheck.normalizedPath,
        destPath: pathCheck.destPath
      });
    }

    let hasIndexHtml = validFiles.some(f => f.normalizedPath.toLowerCase() === 'index.html');

    // Find candidate to auto-rename if enabled and no index.html is present
    let candidateToRename = null;
    if (!hasIndexHtml && autoRenameIndex && validFiles.length > 0) {
      // 1. Prefer a root-level .html or .htm file
      candidateToRename = validFiles.find(f => {
        return !f.normalizedPath.includes('/') && (f.normalizedPath.toLowerCase().endsWith('.html') || f.normalizedPath.toLowerCase().endsWith('.htm'));
      });
      // 2. Or any .html file
      if (!candidateToRename) {
        candidateToRename = validFiles.find(f => f.normalizedPath.toLowerCase().endsWith('.html') || f.normalizedPath.toLowerCase().endsWith('.htm'));
      }
      // 3. Or single uploaded file
      if (!candidateToRename && validFiles.length === 1) {
        candidateToRename = validFiles[0];
      }
    }

    for (const file of validFiles) {
      let dest = file.destPath;

      // Apply auto-rename to index.html for chosen entrypoint
      if (candidateToRename && file === candidateToRename) {
        dest = path.join(targetDir, 'index.html');
        hasIndexHtml = true;
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });

      if (file.isBase64) {
        const base64Data = file.content.replace(/^data:[^;]+;base64,/, '');
        fs.writeFileSync(dest, Buffer.from(base64Data, 'base64'));
      } else {
        fs.writeFileSync(dest, file.content || '', 'utf8');
      }

      if (path.basename(dest).toLowerCase() === 'index.html') {
        hasIndexHtml = true;
      }
    }

    // If dropped bundle did not include an index.html and was not auto-renamed, generate clean directory index
    if (!hasIndexHtml) {
      const autoIndex = buildDirectoryIndexHtml(title, slug, validFiles);
      fs.writeFileSync(path.join(targetDir, 'index.html'), autoIndex, 'utf8');
    }
  } else {
    // Fallback: compile single HTML file
    const content = html || `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1></body></html>`;
    fs.writeFileSync(path.join(targetDir, 'index.html'), content, 'utf8');
  }

  // If in path mode, ensure root static-site index.html exists
  if (mode === 'path') {
    const rootStaticSiteDir = path.join(rootDir, 'dist', 'static-site');
    const rootIndexPath = path.join(rootStaticSiteDir, 'index.html');
    if (!fs.existsSync(rootIndexPath)) {
      const rootHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vault</title></head><body><h1>Cloudflare Pages Vault</h1></body></html>`;
      fs.writeFileSync(rootIndexPath, rootHtml, 'utf8');
    }

    return {
      deployDir: rootStaticSiteDir,
      htmlPath: path.join(targetDir, 'index.html'),
      slug,
      mode: 'path',
      fileCount: validFiles.length || 1,
      excludedFiles,
      rejectedFiles
    };
  }

  return {
    deployDir: targetDir,
    htmlPath: path.join(targetDir, 'index.html'),
    slug,
    mode: 'branch',
    fileCount: validFiles.length || 1,
    excludedFiles,
    rejectedFiles
  };
}

module.exports = {
  CF_PAGES_LIMITS,
  sanitizePath,
  isSensitivePath,
  generateRandomSlug,
  buildPageHtml,
  buildDirectoryIndexHtml,
  prepareStaging
};

