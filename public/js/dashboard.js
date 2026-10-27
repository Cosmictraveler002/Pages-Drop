/**
 * Cloudflare Pages Live Static Workflow & Free Quota Dashboard
 */

// State
let appState = {
  quota: null,
  deployments: [],
  secondsUntilReset: 0,
  activeMode: 'branch',
  activeTemplate: 'landing',
  currentModalQrUrl: ''
};

// DOM Elements
const el = {
  // Stats
  dailyRemaining: document.getElementById('dailyRemainingDisplay'),
  dailyProgressBar: document.getElementById('dailyProgressBar'),
  dailyUsedLabel: document.getElementById('dailyUsedLabel'),
  dailyPercentLabel: document.getElementById('dailyPercentLabel'),
  resetCountdown: document.getElementById('resetCountdownDisplay'),
  monthlyRemaining: document.getElementById('monthlyRemainingDisplay'),
  monthlyProgressBar: document.getElementById('monthlyProgressBar'),
  monthlyUsedLabel: document.getElementById('monthlyUsedLabel'),
  monthlyPercentLabel: document.getElementById('monthlyPercentLabel'),
  totalLinks: document.getElementById('totalLinksDisplay'),
  cfProjectNameLabel: document.getElementById('cfProjectNameLabel'),
  dailySafetyBadge: document.getElementById('dailySafetyBadge'),
  
  // Status & Clock
  utcClock: document.getElementById('utcClockTime'),
  cfStatusDot: document.getElementById('cfStatusDot'),
  cfStatusText: document.getElementById('cfStatusText'),
  syncStatusBtn: document.getElementById('syncStatusBtn'),

  // Form
  generatorForm: document.getElementById('generatorForm'),
  slugInput: document.getElementById('slugInput'),
  prefixInput: document.getElementById('prefixInput'),
  randomizeSlugBtn: document.getElementById('randomizeSlugBtn'),
  pageTitleInput: document.getElementById('pageTitleInput'),
  pageSubtitleInput: document.getElementById('pageSubtitleInput'),
  pageContentInput: document.getElementById('pageContentInput'),
  deployBtn: document.getElementById('deployBtn'),
  deployBtnIcon: document.getElementById('deployBtnIcon'),
  deployBtnText: document.getElementById('deployBtnText'),
  deploySpinner: document.getElementById('deploySpinner'),
  previewBtn: document.getElementById('previewBtn'),

  // Mode & Templates
  modeBranchOption: document.getElementById('modeBranchOption'),
  modePathOption: document.getElementById('modePathOption'),
  templateCards: document.querySelectorAll('.template-card'),
  slugPreviews: document.querySelectorAll('.random-slug-preview'),

  // Terminal
  terminalContainer: document.getElementById('terminalContainer'),
  terminalOutput: document.getElementById('terminalOutput'),
  closeTerminalBtn: document.getElementById('closeTerminalBtn'),

  // Table
  linksTableBody: document.getElementById('linksTableBody'),
  linksSearchInput: document.getElementById('linksSearchInput'),

  // Modals
  previewModal: document.getElementById('previewModal'),
  previewIframe: document.getElementById('previewIframe'),
  closePreviewModalBtn: document.getElementById('closePreviewModalBtn'),

  qrModal: document.getElementById('qrModal'),
  qrCanvas: document.getElementById('qrCanvas'),
  qrUrlLabel: document.getElementById('qrUrlLabel'),
  closeQrModalBtn: document.getElementById('closeQrModalBtn'),
  copyQrUrlBtn: document.getElementById('copyQrUrlBtn'),
  openQrUrlBtn: document.getElementById('openQrUrlBtn'),

  settingsModal: document.getElementById('settingsModal'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsModalBtn: document.getElementById('closeSettingsModalBtn'),
  cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  testTokenBtn: document.getElementById('testTokenBtn'),
  testTokenResult: document.getElementById('testTokenResult'),
  settingsAccountId: document.getElementById('settingsAccountId'),
  settingsApiToken: document.getElementById('settingsApiToken'),
  settingsProjectName: document.getElementById('settingsProjectName'),
  settingsDailyLimit: document.getElementById('settingsDailyLimit'),

  toastContainer: document.getElementById('toastContainer')
};

// Preset Content for templates
const TEMPLATE_PRESETS = {
  landing: {
    title: 'Instant Edge Static Drop',
    subtitle: 'Deployed globally across 330+ Cloudflare Edge locations in milliseconds.',
    content: 'This live static website was compiled and published instantly using the Cloudflare Pages Direct Upload CLI workflow. Enjoy zero cold starts and 100% free tier hosting.'
  },
  secret: {
    title: 'Classified Edge Document',
    subtitle: 'Protected confidential message payload.',
    content: 'TOP SECRET NOTICE:\nDirect upload workflows enable high-frequency live static page deployment without exhausting monthly Git build quotas.\nVerification Key: CF-PAGES-7789'
  },
  showcase: {
    title: 'Vanguard Release Showcase',
    subtitle: 'High-performance edge distribution platform powered by Cloudflare Pages.',
    content: 'Highlights:\n• Free Direct Uploads: Up to 20,000 files\n• Unlimited global edge bandwidth\n• Direct branch preview URLs generated on demand'
  },
  bio: {
    title: 'Alex Rivera',
    subtitle: '@alexrivera · Cloud Architect & Developer',
    content: 'Building scalable edge workflows, serverless micro-frontends, and automated Cloudflare Pages pipelines.'
  }
};

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  generateNewSlug();
  bindEvents();
  fetchStatus(true);
  fetchDeployments();

  // Start auto-refresh interval: sync data every 20 seconds
  setInterval(() => fetchStatus(false), 20000);

  // Local second ticker for countdown
  setInterval(tickCountdown, 1000);
});

// Live UTC Clock
function initClock() {
  function update() {
    const now = new Date();
    const utcHours = String(now.getUTCHours()).padStart(2, '0');
    const utcMinutes = String(now.getUTCMinutes()).padStart(2, '0');
    const utcSeconds = String(now.getUTCSeconds()).padStart(2, '0');
    if (el.utcClock) el.utcClock.innerText = `${utcHours}:${utcMinutes}:${utcSeconds}`;
  }
  update();
  setInterval(update, 1000);
}

// Countdown Ticker
function tickCountdown() {
  if (appState.secondsUntilReset > 0) {
    appState.secondsUntilReset--;
    const h = Math.floor(appState.secondsUntilReset / 3600);
    const m = Math.floor((appState.secondsUntilReset % 3600) / 60);
    const s = appState.secondsUntilReset % 60;
    const pad = (n) => String(n).padStart(2, '0');
    el.resetCountdown.innerText = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }
}

// Random Slug Generator
function generateNewSlug() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const prefix = el.prefixInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const slug = prefix ? `${prefix}-${result}` : result;
  
  el.slugInput.value = slug;
  updateSlugPreviews(slug);
}

function updateSlugPreviews(slug) {
  el.slugPreviews.forEach(node => {
    node.innerText = slug || 'random-slug';
  });
}

// Bind UI Events
function bindEvents() {
  // Randomize button
  el.randomizeSlugBtn.addEventListener('click', generateNewSlug);
  el.slugInput.addEventListener('input', (e) => updateSlugPreviews(e.target.value));
  el.prefixInput.addEventListener('input', generateNewSlug);

  // Architecture Mode Toggle
  el.modeBranchOption.addEventListener('click', () => {
    appState.activeMode = 'branch';
    el.modeBranchOption.classList.add('selected');
    el.modePathOption.classList.remove('selected');
    el.modeBranchOption.querySelector('input').checked = true;
  });

  el.modePathOption.addEventListener('click', () => {
    appState.activeMode = 'path';
    el.modePathOption.classList.add('selected');
    el.modeBranchOption.classList.remove('selected');
    el.modePathOption.querySelector('input').checked = true;
  });

  // Template Cards Selection
  el.templateCards.forEach(card => {
    card.addEventListener('click', () => {
      el.templateCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input');
      radio.checked = true;
      const template = radio.value;
      appState.activeTemplate = template;

      // Update preset content
      if (TEMPLATE_PRESETS[template]) {
        el.pageTitleInput.value = TEMPLATE_PRESETS[template].title;
        el.pageSubtitleInput.value = TEMPLATE_PRESETS[template].subtitle;
        el.pageContentInput.value = TEMPLATE_PRESETS[template].content;
      }
    });
  });

  // Sync button
  el.syncStatusBtn.addEventListener('click', () => {
    el.syncStatusBtn.style.transform = 'rotate(180deg)';
    setTimeout(() => el.syncStatusBtn.style.transform = '', 300);
    fetchStatus(true);
    fetchDeployments();
    showToast('Syncing with Cloudflare...', 'success');
  });

  // Generator Form Submission
  el.generatorForm.addEventListener('submit', handleDeploySubmit);

  // Preview button
  el.previewBtn.addEventListener('click', openLivePreview);
  el.closePreviewModalBtn.addEventListener('click', () => el.previewModal.style.display = 'none');

  // Terminal Close
  el.closeTerminalBtn.addEventListener('click', () => el.terminalContainer.style.display = 'none');

  // Search filter
  el.linksSearchInput.addEventListener('input', renderDeploymentsTable);

  // QR Modal
  el.closeQrModalBtn.addEventListener('click', () => el.qrModal.style.display = 'none');
  el.copyQrUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(appState.currentModalQrUrl);
    showToast('Link copied to clipboard!', 'success');
  });
  el.openQrUrlBtn.addEventListener('click', () => {
    if (appState.currentModalQrUrl) window.open(appState.currentModalQrUrl, '_blank');
  });

  // Settings Modal
  el.openSettingsBtn.addEventListener('click', openSettings);
  el.closeSettingsModalBtn.addEventListener('click', () => el.settingsModal.style.display = 'none');
  el.cancelSettingsBtn.addEventListener('click', () => el.settingsModal.style.display = 'none');
  el.saveSettingsBtn.addEventListener('click', saveSettings);
  el.testTokenBtn.addEventListener('click', testToken);
}

// Fetch live quota status from server
async function fetchStatus(syncWithCf = false) {
  try {
    const res = await fetch(`/api/status?sync=${syncWithCf}`);
    const data = await res.json();
    if (data.success && data.status) {
      updateStatsUI(data.status);
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

// Update Stats Dashboard Cards
function updateStatsUI(status) {
  appState.quota = status;
  appState.secondsUntilReset = status.reset.secondsUntilReset;

  // Daily Free Quota
  el.dailyRemaining.innerText = status.daily.remaining;
  el.dailyUsedLabel.innerText = `Used: ${status.daily.used} / ${status.daily.limit}`;
  el.dailyPercentLabel.innerText = `${status.daily.percentage}%`;
  el.dailyProgressBar.style.width = `${status.daily.percentage}%`;

  if (status.daily.isExceeded) {
    el.dailySafetyBadge.innerText = 'LIMIT REACHED';
    el.dailySafetyBadge.style.background = 'rgba(239, 68, 68, 0.2)';
    el.dailySafetyBadge.style.color = '#ef4444';
  } else if (status.daily.isNearLimit) {
    el.dailySafetyBadge.innerText = 'NEARING LIMIT';
    el.dailySafetyBadge.style.background = 'rgba(245, 158, 11, 0.2)';
    el.dailySafetyBadge.style.color = '#f59e0b';
  } else {
    el.dailySafetyBadge.innerText = 'Free Tier Safe';
    el.dailySafetyBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    el.dailySafetyBadge.style.color = '#10b981';
  }

  // Monthly Builds
  el.monthlyRemaining.innerText = status.monthly.remaining;
  el.monthlyUsedLabel.innerText = `Used: ${status.monthly.used} / ${status.monthly.limit}`;
  el.monthlyPercentLabel.innerText = `${status.monthly.percentage}%`;
  el.monthlyProgressBar.style.width = `${status.monthly.percentage}%`;

  // Total pages
  el.totalLinks.innerText = status.totalTrackedPages;
  if (status.cloudflare.projectName) {
    el.cfProjectNameLabel.innerText = status.cloudflare.projectName;
  }

  // Cloudflare connection status
  if (status.cloudflare.configured) {
    el.cfStatusDot.className = 'status-dot status-dot-active';
    el.cfStatusText.innerText = 'Cloudflare API Active';
  } else {
    el.cfStatusDot.className = 'status-dot status-dot-warning';
    el.cfStatusText.innerText = 'Simulation Mode';
  }
}

// Fetch deployments ledger
async function fetchDeployments() {
  try {
    const res = await fetch('/api/deployments');
    const data = await res.json();
    if (data.success && data.deployments) {
      appState.deployments = data.deployments;
      renderDeploymentsTable();
    }
  } catch (err) {
    console.error('Failed to fetch deployments:', err);
  }
}

// Render Links Table
function renderDeploymentsTable() {
  const searchTerm = el.linksSearchInput.value.trim().toLowerCase();
  const filtered = appState.deployments.filter(d => {
    return (d.slug && d.slug.toLowerCase().includes(searchTerm)) ||
           (d.title && d.title.toLowerCase().includes(searchTerm)) ||
           (d.url && d.url.toLowerCase().includes(searchTerm));
  });

  if (filtered.length === 0) {
    el.linksTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty">
          <div class="empty-state">
            <div class="empty-icon">📂</div>
            <div class="empty-title">${searchTerm ? 'No matching pages found' : 'No pages deployed yet'}</div>
            <p class="empty-desc">${searchTerm ? 'Try a different search query' : 'Generate and deploy your first live static link above'}</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  el.linksTableBody.innerHTML = filtered.map(item => {
    const timeFormatted = formatRelativeTime(item.created_at);
    const displayUrl = item.url || `https://${item.slug}.pages.dev`;
    const modeBadge = item.mode === 'path' ? '📁 /r/' : '🌐 Branch';

    return `
      <tr>
        <td>
          <span class="table-link-title">${escapeHtml(item.title)}</span>
          <span class="table-slug-badge">${escapeHtml(item.slug)}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; text-transform: capitalize; color: #cbd5e1;">
            ${escapeHtml(item.template || 'landing')}
          </span>
          <span style="font-size: 0.72rem; color: #64748b; margin-left: 4px;">(${modeBadge})</span>
        </td>
        <td>
          <a href="${displayUrl}" target="_blank" class="table-url-anchor" title="Open live link">
            <span>${truncate(displayUrl, 32)}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </td>
        <td>
          <span class="table-time" title="${item.created_at}">${timeFormatted}</span>
        </td>
        <td style="text-align: right;">
          <div class="table-actions">
            <button class="btn btn-secondary btn-sm" onclick="copyLink('${displayUrl}')" title="Copy live URL">
              📋
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openQrModal('${displayUrl}')" title="Show QR code">
              📱
            </button>
            <button class="btn btn-secondary btn-sm" onclick="window.open('${displayUrl}', '_blank')" title="Visit live page">
              ↗
            </button>
            <button class="btn btn-outline btn-sm" onclick="deleteDeployment('${item.id || item.slug}')" title="Delete record" style="color: #ef4444;">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Handle Page Generation and Deployment
async function handleDeploySubmit(e) {
  e.preventDefault();

  const slug = el.slugInput.value.trim().toLowerCase();
  const title = el.pageTitleInput.value.trim();
  const subtitle = el.pageSubtitleInput.value.trim();
  const content = el.pageContentInput.value.trim();
  const prefix = el.prefixInput.value.trim();
  const template = appState.activeTemplate;
  const mode = appState.activeMode;

  // Set loading state
  setLoadingState(true);

  // Show terminal
  el.terminalContainer.style.display = 'block';
  el.terminalOutput.innerText = `[INIT] Starting static page compilation for slug: ${slug}...\n[INIT] Mode: ${mode} | Template: ${template}\n`;

  try {
    const res = await fetch('/api/deployments/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customSlug: slug,
        title,
        subtitle,
        content,
        prefix,
        template,
        mode
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Deployment failed');
    }

    // Append logs
    if (data.logs && data.logs.length) {
      el.terminalOutput.innerText += data.logs.join('\n') + '\n';
    }
    el.terminalOutput.innerText += `\n[SUCCESS] Live URL is ready: ${data.url}\n`;
    el.terminalOutput.scrollTop = el.terminalOutput.scrollHeight;

    showToast(`⚡ Live Page Published: ${data.url}`, 'success');

    // Update stats & deployments
    if (data.quota) updateStatsUI(data.quota);
    await fetchDeployments();

    // Prepare fresh slug for next generation
    generateNewSlug();

  } catch (err) {
    el.terminalOutput.innerText += `\n[ERROR] ${err.message}\n`;
    showToast(`Deployment error: ${err.message}`, 'error');
  } finally {
    setLoadingState(false);
  }
}

function setLoadingState(loading) {
  if (loading) {
    el.deployBtn.disabled = true;
    el.deploySpinner.style.display = 'inline-block';
    el.deployBtnIcon.style.display = 'none';
    el.deployBtnText.innerText = 'Deploying Live...';
  } else {
    el.deployBtn.disabled = false;
    el.deploySpinner.style.display = 'none';
    el.deployBtnIcon.style.display = 'inline';
    el.deployBtnText.innerText = 'Generate & Deploy Live';
  }
}

// Visual Preview in Modal
async function openLivePreview() {
  const slug = el.slugInput.value.trim() || 'preview-demo';
  const title = el.pageTitleInput.value.trim();
  const subtitle = el.pageSubtitleInput.value.trim();
  const content = el.pageContentInput.value.trim();
  const template = appState.activeTemplate;

  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title, subtitle, content, template })
    });
    const html = await res.text();

    el.previewIframe.srcdoc = html;
    el.previewModal.style.display = 'flex';
  } catch (err) {
    showToast(`Preview failed: ${err.message}`, 'error');
  }
}

// Standalone QR Code Canvas Generator
window.openQrModal = function(url) {
  appState.currentModalQrUrl = url;
  el.qrUrlLabel.innerText = url;
  el.qrModal.style.display = 'flex';

  drawQrToCanvas(url, el.qrCanvas);
};

// Pure canvas QR code generator
function drawQrToCanvas(text, canvas) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Use a simple, robust visual QR-pattern generator on canvas
  // Fallback to Google Chart QR API rendered to image if online
  const img = new Image();
  img.crossOrigin = 'Anonymous';
  img.onload = () => {
    ctx.drawImage(img, 10, 10, size - 20, size - 20);
  };
  img.onerror = () => {
    // Local fallback pattern
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(20, 20, 50, 50);
    ctx.fillRect(size - 70, 20, 50, 50);
    ctx.fillRect(20, size - 70, 50, 50);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#f38020';
    ctx.fillText('Live Cloudflare URL', 40, size / 2);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
};

window.copyLink = function(url) {
  navigator.clipboard.writeText(url);
  showToast('Live link copied to clipboard!', 'success');
};

window.deleteDeployment = async function(id) {
  if (!confirm('Remove this page from your local tracker?')) return;
  try {
    await fetch(`/api/deployments/${id}`, { method: 'DELETE' });
    showToast('Record deleted', 'success');
    fetchDeployments();
    fetchStatus(false);
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
};

// Settings Modal
function openSettings() {
  if (appState.quota && appState.quota.cloudflare) {
    el.settingsProjectName.value = appState.quota.cloudflare.projectName || 'random-pages-vault';
  }
  el.testTokenResult.innerText = '';
  el.settingsModal.style.display = 'flex';
}

async function testToken() {
  el.testTokenResult.innerText = 'Verifying token with Cloudflare...';
  el.testTokenResult.style.color = '#faad3f';

  try {
    const res = await fetch('/api/verify', { method: 'POST' });
    const data = await res.json();
    if (data.valid) {
      el.testTokenResult.innerText = '✓ Token Valid & Verified';
      el.testTokenResult.style.color = '#10b981';
    } else {
      el.testTokenResult.innerText = `✕ ${data.message || 'Invalid Token'}`;
      el.testTokenResult.style.color = '#ef4444';
    }
  } catch (err) {
    el.testTokenResult.innerText = `✕ Connection error: ${err.message}`;
    el.testTokenResult.style.color = '#ef4444';
  }
}

async function saveSettings() {
  const accountId = el.settingsAccountId.value.trim();
  const apiToken = el.settingsApiToken.value.trim();
  const projectName = el.settingsProjectName.value.trim() || 'random-pages-vault';
  const dailyFreeLimit = parseInt(el.settingsDailyLimit.value, 10) || 100;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, apiToken, projectName, dailyFreeLimit })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Settings saved successfully!', 'success');
      el.settingsModal.style.display = 'none';
      fetchStatus(true);
    } else {
      showToast(`Error saving settings: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Helpers
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : '⚠️'}</span><span>${escapeHtml(message)}</span>`;
  el.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString();
}
