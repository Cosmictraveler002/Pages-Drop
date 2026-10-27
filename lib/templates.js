/**
 * Production-ready, responsive static HTML templates for Cloudflare Pages
 * Injected with self-contained CSS, meta tags, and sleek micro-interactions
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const templates = {
  landing: (data) => {
    const title = escapeHtml(data.title || 'Dynamic Cloudflare Page');
    const subtitle = escapeHtml(data.subtitle || 'Generated instantaneously via Cloudflare Pages CLI Workflow');
    const content = escapeHtml(data.content || 'This live static site was built and published to the Cloudflare global edge network with zero server overhead.');
    const slug = escapeHtml(data.slug || 'random');
    const date = new Date().toUTCString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Cloudflare Pages</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 25, 42, 0.75);
      --border: rgba(255, 255, 255, 0.08);
      --cf-orange: #f38020;
      --cf-amber: #faad3f;
      --indigo: #6366f1;
      --emerald: #10b981;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 60%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: absolute;
      top: 10%;
      left: 50%;
      transform: translateX(-50%);
      width: 600px;
      height: 400px;
      background: radial-gradient(circle, rgba(243, 128, 32, 0.15) 0%, rgba(99, 102, 241, 0.1) 40%, transparent 70%);
      filter: blur(80px);
      z-index: 0;
      pointer-events: none;
    }
    .container {
      position: relative;
      z-index: 1;
      max-width: 840px;
      width: 100%;
      margin: 0 auto;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(243, 128, 32, 0.12);
      border: 1px solid rgba(243, 128, 32, 0.3);
      color: var(--cf-amber);
      font-size: 0.85rem;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 9999px;
      margin-bottom: 24px;
      backdrop-filter: blur(8px);
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      background: var(--emerald);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--emerald);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.2); }
    }
    .hero-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 48px;
      backdrop-filter: blur(16px);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      text-align: center;
    }
    h1 {
      font-size: clamp(2.2rem, 5vw, 3.5rem);
      font-weight: 800;
      line-height: 1.15;
      margin-bottom: 16px;
      background: linear-gradient(135deg, #ffffff 40%, var(--cf-amber) 80%, var(--cf-orange) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      font-size: 1.25rem;
      color: var(--text-muted);
      margin-bottom: 32px;
      line-height: 1.6;
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
    }
    .content-box {
      background: rgba(10, 15, 29, 0.6);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      font-size: 1.05rem;
      line-height: 1.7;
      color: #cbd5e1;
      text-align: left;
      margin-bottom: 32px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 32px;
      text-align: left;
    }
    .meta-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 18px;
    }
    .meta-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .meta-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.95rem;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cta-row {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 32px;
      flex-wrap: wrap;
    }
    .btn {
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--cf-orange), #ea580c);
      color: #fff;
      box-shadow: 0 4px 20px rgba(243, 128, 32, 0.35);
      border: none;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(243, 128, 32, 0.5);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    footer {
      margin-top: 40px;
      font-size: 0.85rem;
      color: var(--text-muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div style="text-align: center;">
      <div class="badge">
        <span class="badge-dot"></span>
        <span>Cloudflare Edge · Live Static Page</span>
      </div>
    </div>

    <div class="hero-card">
      <h1>${title}</h1>
      <p class="subtitle">${subtitle}</p>

      <div class="content-box">
        ${content}
      </div>

      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Unique Slug</div>
          <div class="meta-value">${slug}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Edge CDN</div>
          <div class="meta-value">Cloudflare Pages Free Tier</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Generated UTC</div>
          <div class="meta-value">${date}</div>
        </div>
      </div>

      <div class="cta-row">
        <button class="btn btn-primary" onclick="navigator.clipboard.writeText(window.location.href); alert('Live link copied to clipboard!');">
          📋 Copy Live Link
        </button>
        <a href="https://developers.cloudflare.com/pages/" target="_blank" class="btn btn-secondary">
          ⚡ Powered by Cloudflare Pages
        </a>
      </div>
    </div>

    <footer>
      Deployed with Wrangler Pages CLI · Free Tier Workflow
    </footer>
  </div>
</body>
</html>`;
  },

  secret: (data) => {
    const title = escapeHtml(data.title || 'Confidential Edge Note');
    const content = escapeHtml(data.content || 'This is a secure ephemeral note generated via Cloudflare Pages CLI workflow. Click the button below to decrypt and reveal the message.');
    const slug = escapeHtml(data.slug || 'secret-note');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Secure Note</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #030712;
      --card: #111827;
      --accent: #10b981;
      --text: #f9fafb;
      --muted: #9ca3af;
      --border: #1f2937;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Space Grotesk', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .vault-card {
      max-width: 650px;
      width: 100%;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.7);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .badge {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--accent);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .secret-box {
      background: #000;
      border: 1px dashed var(--border);
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 1rem;
      line-height: 1.6;
      color: #34d399;
      filter: blur(8px);
      user-select: none;
      transition: filter 0.3s ease;
      white-space: pre-wrap;
    }
    .secret-box.revealed {
      filter: blur(0);
      user-select: text;
    }
    .actions {
      display: flex;
      gap: 12px;
    }
    .btn {
      flex: 1;
      padding: 12px;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-family: inherit;
      transition: all 0.2s;
    }
    .btn-primary {
      background: var(--accent);
      color: #030712;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .btn-outline:hover { color: var(--text); border-color: var(--muted); }
  </style>
</head>
<body>
  <div class="vault-card">
    <div class="header">
      <h2>🔒 ${title}</h2>
      <div class="badge">● ENCRYPTED PAYLOAD</div>
    </div>
    <p style="color: var(--muted); font-size: 0.95rem;">Link ID: <code>${slug}</code></p>

    <div id="secretBox" class="secret-box">${content}</div>

    <div class="actions">
      <button id="toggleBtn" class="btn btn-primary" onclick="toggleSecret()">👁️ Click to Reveal Note</button>
      <button class="btn btn-outline" onclick="copySecret()">📋 Copy</button>
    </div>
  </div>

  <script>
    let isRevealed = false;
    function toggleSecret() {
      const box = document.getElementById('secretBox');
      const btn = document.getElementById('toggleBtn');
      isRevealed = !isRevealed;
      if (isRevealed) {
        box.classList.add('revealed');
        btn.innerText = '🔒 Mask Note';
      } else {
        box.classList.remove('revealed');
        btn.innerText = '👁️ Click to Reveal Note';
      }
    }
    function copySecret() {
      const content = document.getElementById('secretBox').innerText;
      navigator.clipboard.writeText(content);
      alert('Secret note copied to clipboard!');
    }
  </script>
</body>
</html>`;
  },

  showcase: (data) => {
    const title = escapeHtml(data.title || 'Product Feature Showcase');
    const subtitle = escapeHtml(data.subtitle || 'High-performance static site served directly from Cloudflare 300+ Edge locations.');
    const content = escapeHtml(data.content || 'Explore our latest drops, release notes, and documentation.');
    const slug = escapeHtml(data.slug || 'showcase');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #38bdf8;
      --accent: #f43f5e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 40px 20px;
    }
    .wrapper { max-width: 900px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 48px; }
    h1 { font-size: 2.8rem; font-weight: 800; margin-bottom: 12px; }
    .subtitle { color: var(--muted); font-size: 1.15rem; max-width: 600px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; margin-bottom: 48px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; transition: transform 0.2s; }
    .card:hover { transform: translateY(-4px); }
    .icon { font-size: 2rem; margin-bottom: 16px; }
    .card h3 { font-size: 1.25rem; margin-bottom: 8px; }
    .card p { color: var(--muted); font-size: 0.95rem; line-height: 1.6; }
    .banner { background: linear-gradient(135deg, #1e1b4b, #312e81); border: 1px solid #4338ca; border-radius: 16px; padding: 32px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <header>
      <h1>${title}</h1>
      <p class="subtitle">${subtitle}</p>
    </header>

    <div class="grid">
      <div class="card">
        <div class="icon">🚀</div>
        <h3>Lightning Edge Speed</h3>
        <p>Assets are cached across Cloudflare's global anycast network spanning 330+ cities worldwide.</p>
      </div>
      <div class="card">
        <div class="icon">🛡️</div>
        <h3>Free Tier Optimized</h3>
        <p>Direct upload workflow using Wrangler CLI with zero git build time consumption.</p>
      </div>
      <div class="card">
        <div class="icon">🎲</div>
        <h3>Random Link Deployment</h3>
        <p>Unique isolated deployment branch: <code>${slug}</code> with automatic SSL certificates.</p>
      </div>
    </div>

    <div class="banner">
      <h2 style="margin-bottom: 12px;">Live Content Details</h2>
      <p style="color: #c7d2fe; line-height: 1.7; margin-bottom: 20px;">${content}</p>
      <button onclick="window.print()" style="padding: 10px 20px; background: var(--primary); color: #0f172a; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">
        🖨️ Export / Print Page
      </button>
    </div>
  </div>
</body>
</html>`;
  },

  bio: (data) => {
    const title = escapeHtml(data.title || 'Digital Bio Card');
    const subtitle = escapeHtml(data.subtitle || '@cloudflare-creator');
    const content = escapeHtml(data.content || 'Sharing links, updates, and live static pages generated via Cloudflare Pages CLI.');
    const slug = escapeHtml(data.slug || 'bio');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #09090b;
      --card: #18181b;
      --border: #27272a;
      --accent: #f97316;
      --text: #fafafa;
      --muted: #a1a1aa;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .profile-card {
      max-width: 440px;
      width: 100%;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 36px 24px;
      text-align: center;
    }
    .avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, #f97316, #ec4899);
      margin: 0 auto 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      box-shadow: 0 8px 24px rgba(249, 115, 22, 0.3);
    }
    h2 { font-size: 1.5rem; margin-bottom: 4px; }
    .tagline { color: var(--accent); font-weight: 500; font-size: 0.9rem; margin-bottom: 16px; }
    .bio { color: var(--muted); font-size: 0.95rem; line-height: 1.6; margin-bottom: 28px; }
    .links-stack { display: flex; flex-direction: column; gap: 12px; }
    .link-btn {
      padding: 14px 20px;
      background: #27272a;
      color: #fff;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.95rem;
      border: 1px solid rgba(255, 255, 255, 0.05);
      transition: all 0.2s;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .link-btn:hover { background: #3f3f46; transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="profile-card">
    <div class="avatar">⚡</div>
    <h2>${title}</h2>
    <div class="tagline">${subtitle}</div>
    <p class="bio">${content}</p>

    <div class="links-stack">
      <a href="https://pages.cloudflare.com" target="_blank" class="link-btn">
        <span>🌐 Cloudflare Pages</span>
        <span>→</span>
      </a>
      <a href="https://developers.cloudflare.com/pages/get-started/direct-upload/" target="_blank" class="link-btn">
        <span>⚡ Wrangler CLI Guide</span>
        <span>→</span>
      </a>
      <a href="#" onclick="alert('Slug ID: ${slug}'); return false;" class="link-btn">
        <span>🎲 Random Link ID</span>
        <span style="font-family: monospace; color: var(--accent);">${slug}</span>
      </a>
    </div>
  </div>
</body>
</html>`;
  },

  custom: (data) => {
    // If user passed custom raw HTML, use that directly; otherwise format as article
    if (data.rawHtml && data.rawHtml.trim().startsWith('<')) {
      return data.rawHtml;
    }

    const title = escapeHtml(data.title || 'Live Static Document');
    const content = data.content || '<p>Default content.</p>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0b0f19; color: #f3f4f6; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.7; }
    h1 { color: #f97316; border-bottom: 1px solid #1f2937; padding-bottom: 12px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 24px; margin-top: 24px; }
    code { background: #1f2937; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="card">
    ${content}
  </div>
</body>
</html>`;
  }
};

module.exports = {
  templates,
  getTemplateNames: () => Object.keys(templates)
};
