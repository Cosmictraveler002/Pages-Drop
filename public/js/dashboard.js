/**
 * Cloudflare Pages Direct Deployment Dashboard
 * Minimal Brutalist Architecture with Strictly Scoped Orange Accent (#FF3B00)
 */

// Application State
const appState = {
  quota: null,
  deployments: [],
  secondsUntilReset: 0,
  activeMode: 'branch',           // 'branch' (subdomain) or 'path' (project.pages.dev/r/slug)
  currentModalQrUrl: '',
  currentModalSlug: '',
  deviceId: null,
  autoRenameIndex: true,
  queuedFiles: [],                // Array of { name, path, content, isBase64, size, type }
  excludedFiles: [],              // Excluded sensitive/traversal files
  isLinked: false,                // Device link state
  abortController: null,
  activeDeleteConfirmSlug: null,
  sortMode: 'newest'
};

// Cloudflare Pages Direct Upload Hard Limits
const CF_LIMITS = {
  maxFileSize: 25 * 1024 * 1024,  // 25 MiB maximum per asset
  maxFilesPerDeploy: 20000        // 20,000 files maximum per deployment
};

// DOM Elements Registry
const el = {
  // Top Bar
  connectionBadge: document.getElementById('connectionBadge'),
  unlinkedBanner: document.getElementById('unlinkedBanner'),
  relinkDeviceBtn: document.getElementById('relinkDeviceBtn'),
  syncStatusBtn: document.getElementById('syncStatusBtn'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),

  // 1. Hero Bento Tile: Uploads Left Today
  tileUploads: document.getElementById('tileUploads'),
  uploadsStateBadge: document.getElementById('uploadsStateBadge'),
  uploadsStateNote: document.getElementById('uploadsStateNote'),
  uploadsWarningLine: document.getElementById('uploadsWarningLine'),
  dailyRemaining: document.getElementById('dailyRemainingDisplay'),
  dailySubtext: document.getElementById('dailySubtext'),
  dailyProgressBarFill: document.getElementById('dailyProgressBarFill'),
  resetCountdown: document.getElementById('resetCountdownDisplay'),

  // 8. Builds Left This Month Tile
  tileBuilds: document.getElementById('tileBuilds'),
  buildsStateBadge: document.getElementById('buildsStateBadge'),
  monthlyRemaining: document.getElementById('monthlyRemainingDisplay'),
  monthlySubtext: document.getElementById('monthlySubtext'),
  monthlyProgressBarFill: document.getElementById('monthlyProgressBarFill'),
  monthlyResetNotice: document.getElementById('monthlyResetNotice'),

  // 4. Last Deployment Tile
  tileLastDeploy: document.getElementById('tileLastDeploy'),
  lastDeployTileBar: document.getElementById('lastDeployTileBar'),
  lastDeployEmpty: document.getElementById('lastDeployEmpty'),
  lastDeployContent: document.getElementById('lastDeployContent'),
  lastDeployTitle: document.getElementById('lastDeployTitle'),
  lastDeployTime: document.getElementById('lastDeployTime'),
  lastDeployTimeTag: document.getElementById('lastDeployTimeTag'),
  lastDeployUrlAnchor: document.getElementById('lastDeployUrlAnchor'),
  lastDeployCopyBtn: document.getElementById('lastDeployCopyBtn'),
  lastDeployOpenBtn: document.getElementById('lastDeployOpenBtn'),
  lastDeployQrBtn: document.getElementById('lastDeployQrBtn'),

  // 5. Your Sites Tile
  tileSites: document.getElementById('tileSites'),
  sitesCountDisplay: document.getElementById('sitesCountDisplay'),
  sitesNewestDisplay: document.getElementById('sitesNewestDisplay'),

  // 6. File Limits Tile
  tileLimits: document.getElementById('tileLimits'),
  limitsStateBadge: document.getElementById('limitsStateBadge'),
  limitsMetricDisplay: document.getElementById('limitsMetricDisplay'),
  limitsSubtext: document.getElementById('limitsSubtext'),
  limitsContext: document.getElementById('limitsContext'),
  limitsActionNote: document.getElementById('limitsActionNote'),

  // Deploy Form & Dropzone
  generatorForm: document.getElementById('generatorForm'),
  dropZone: document.getElementById('dropZone'),
  dropPrompt: document.getElementById('dropPrompt'),
  fileInput: document.getElementById('fileInput'),
  folderInput: document.getElementById('folderInput'),
  clearFilesBtn: document.getElementById('clearFilesBtn'),
  queuedFilesBox: document.getElementById('queuedFilesBox'),
  queuedHeader: document.getElementById('queuedHeader'),
  queuedSize: document.getElementById('queuedSize'),
  queuedList: document.getElementById('queuedList'),
  payloadSummary: document.getElementById('payloadSummary'),
  entryFileAlert: document.getElementById('entryFileAlert'),
  excludedFilesAlert: document.getElementById('excludedFilesAlert'),
  autoRenameCheckbox: document.getElementById('autoRenameCheckbox'),

  slugInput: document.getElementById('slugInput'),
  prefixInput: document.getElementById('prefixInput'),
  randomizeSlugBtn: document.getElementById('randomizeSlugBtn'),
  slugAvailability: document.getElementById('slugAvailability'),
  pageTitleInput: document.getElementById('pageTitleInput'),
  pageSubtitleInput: document.getElementById('pageSubtitleInput'),
  pageContentInput: document.getElementById('pageContentInput'),
  liveFinalUrl: document.getElementById('liveFinalUrl'),
  copyLiveUrlBtn: document.getElementById('copyLiveUrlBtn'),
  slugPreviewTexts: document.querySelectorAll('.slug-preview-text'),

  modeBranchOption: document.getElementById('modeBranchOption'),
  modePathOption: document.getElementById('modePathOption'),

  // 2. Deploy Button
  deployBtn: document.getElementById('deployBtn'),
  deployBtnText: document.getElementById('deployBtnText'),
  deploySpinner: document.getElementById('deploySpinner'),
  cancelDeployBtn: document.getElementById('cancelDeployBtn'),
  previewBtn: document.getElementById('previewBtn'),
  deployReasonText: document.getElementById('deployReasonText'),

  // Feedback Blocks
  feedbackContainer: document.getElementById('feedbackContainer'),
  deployProgressBox: document.getElementById('deployProgressBox'),
  deployProgressMessage: document.getElementById('deployProgressMessage'),
  deployProgressBarFill: document.getElementById('deployProgressBarFill'),
  deployErrorBox: document.getElementById('deployErrorBox'),
  deployErrorMessage: document.getElementById('deployErrorMessage'),
  deployErrorResolution: document.getElementById('deployErrorResolution'),
  deploySuccessBox: document.getElementById('deploySuccessBox'),
  successLiveUrlAnchor: document.getElementById('successLiveUrlAnchor'),
  successCopyBtn: document.getElementById('successCopyBtn'),
  successOpenBtn: document.getElementById('successOpenBtn'),
  successQrBtn: document.getElementById('successQrBtn'),

  // 9. Wrangler CLI Stream
  terminalDetails: document.getElementById('terminalDetails'),
  terminalOutput: document.getElementById('terminalOutput'),
  cliStatusTag: document.getElementById('cliStatusTag'),
  cliErrorBanner: document.getElementById('cliErrorBanner'),

  // 10. Ledger Section & Table Headers
  ledgerSection: document.getElementById('ledgerSection'),
  linksSearchInput: document.getElementById('linksSearchInput'),
  linksSortSelect: document.getElementById('linksSortSelect'),
  linksTableBody: document.getElementById('linksTableBody'),
  deploymentsCountBadge: document.getElementById('deploymentsCountBadge'),
  colHeaderName: document.getElementById('colHeaderName'),
  colHeaderStyle: document.getElementById('colHeaderStyle'),
  colHeaderUrl: document.getElementById('colHeaderUrl'),
  colHeaderDate: document.getElementById('colHeaderDate'),

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
  downloadQrBtn: document.getElementById('downloadQrBtn'),

  settingsModal: document.getElementById('settingsModal'),
  settingsDeviceId: document.getElementById('settingsDeviceId'),
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

// ==========================================================================
// 1. Device Storage
// ==========================================================================

async function initDeviceStorage() {
  const id = localStorage.getItem('cf_device_id');
  let isLinked = false;

  if (id && /^DEV-[A-Z0-9]{16}$/.test(id)) {
    try {
      const res = await fetch('/api/device', {
        headers: { 'X-Device-Id': id },
        credentials: 'same-origin'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.registered) {
          isLinked = true;
        }
      }
    } catch (_) {}
  }

  if (isLinked) {
    appState.deviceId = id;
    appState.isLinked = true;
    if (el.unlinkedBanner) el.unlinkedBanner.style.display = 'none';
    if (el.settingsDeviceId) el.settingsDeviceId.innerText = id;
  } else {
    // DO NOT silently create orphan records. Show unlinked state with re-link action.
    appState.deviceId = null;
    appState.isLinked = false;
    if (el.unlinkedBanner) el.unlinkedBanner.style.display = 'block';
    if (el.settingsDeviceId) el.settingsDeviceId.innerText = 'NOT LINKED';
  }
}

async function handleRelinkDevice() {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (data.success && data.deviceId) {
      localStorage.setItem('cf_device_id', data.deviceId);
      appState.deviceId = data.deviceId;
      appState.isLinked = true;
      if (el.unlinkedBanner) el.unlinkedBanner.style.display = 'none';
      if (el.settingsDeviceId) el.settingsDeviceId.innerText = data.deviceId;
      showToast('Device linked successfully!');
      fetchStatus(true);
      fetchDeployments();
      validateDeployButtonState();
    }
  } catch (err) {
    showToast('Failed to link device: ' + err.message, 'error');
  }
}

function loadSavedPreferences() {
  const savedMode = localStorage.getItem('cf_pref_mode');
  if (savedMode === 'path' || savedMode === 'branch') {
    appState.activeMode = savedMode;
    if (savedMode === 'path') {
      el.modePathOption.classList.add('selected');
      el.modeBranchOption.classList.remove('selected');
      el.modePathOption.querySelector('.arch-radio-mark').innerText = '[✓]';
      el.modeBranchOption.querySelector('.arch-radio-mark').innerText = '[ ]';
      el.modePathOption.querySelector('input').checked = true;
    } else {
      el.modeBranchOption.classList.add('selected');
      el.modePathOption.classList.remove('selected');
      el.modeBranchOption.querySelector('.arch-radio-mark').innerText = '[✓]';
      el.modePathOption.querySelector('.arch-radio-mark').innerText = '[ ]';
      el.modeBranchOption.querySelector('input').checked = true;
    }
  }

  const savedAutoRename = localStorage.getItem('cf_pref_auto_rename');
  if (savedAutoRename !== null) {
    appState.autoRenameIndex = savedAutoRename === 'true';
    if (el.autoRenameCheckbox) {
      el.autoRenameCheckbox.checked = appState.autoRenameIndex;
    }
  }
}

function apiFetch(url, options = {}) {
  const headers = options.headers || {};
  if (appState.deviceId) {
    headers['X-Device-Id'] = appState.deviceId;
  }
  return fetch(url, { ...options, headers, credentials: 'same-origin' });
}

// ==========================================================================
// 2. Initialization & Tickers
// ==========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await initDeviceStorage();
  loadSavedPreferences();
  generateNewSlug();
  bindEvents();
  initDropZone();
  updateLiveFinalUrl();
  updateFileLimitsTile();
  validateDeployButtonState();

  if (appState.isLinked) {
    fetchStatus(true);
    fetchDeployments();
  }

  setInterval(() => {
    if (appState.isLinked) fetchStatus(false);
  }, 25000);
  setInterval(tickCountdown, 1000);
});

function tickCountdown() {
  if (appState.secondsUntilReset > 0) {
    appState.secondsUntilReset--;
    formatAndDisplayCountdown();
  }
}

function formatAndDisplayCountdown() {
  if (!el.resetCountdown) return;

  const h = Math.floor(appState.secondsUntilReset / 3600);
  const m = Math.floor((appState.secondsUntilReset % 3600) / 60);

  const now = new Date();
  const nextResetDate = new Date(now.getTime() + appState.secondsUntilReset * 1000);
  const localTimeFormatted = nextResetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  el.resetCountdown.innerText = `Resets in ${h}h ${m}m (${localTimeFormatted} your time · 00:00 UTC)`;
}

// ==========================================================================
// 3. Site Name, URL Preview, & Availability Checker (Rule 7)
// ==========================================================================

function generateNewSlug() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let rand = '';
  for (let i = 0; i < 7; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const prefix = el.prefixInput ? el.prefixInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : '';
  const finalSlug = prefix ? `${prefix}-${rand}` : rand;

  if (el.slugInput) {
    el.slugInput.value = finalSlug;
  }

  updateSlugPreviews(finalSlug);
  checkSlugAvailability(finalSlug);
  updateLiveFinalUrl();
  validateDeployButtonState();
}

function updateSlugPreviews(slug) {
  const display = slug || 'mysite';
  el.slugPreviewTexts.forEach(node => {
    node.innerText = display;
  });
}

function computeProjectDomain() {
  return (appState.quota && appState.quota.cloudflare && appState.quota.cloudflare.projectName)
    ? appState.quota.cloudflare.projectName
    : 'random-pages-vault';
}

function computeLiveUrl(slug) {
  const clean = (slug || 'mysite').trim().toLowerCase();
  const proj = computeProjectDomain();
  if (appState.activeMode === 'path') {
    return `https://${proj}.pages.dev/r/${clean}`;
  }
  return `https://${clean}.pages.dev`;
}

function updateLiveFinalUrl() {
  const slug = el.slugInput.value.trim();
  const url = computeLiveUrl(slug);
  if (el.liveFinalUrl) {
    el.liveFinalUrl.innerText = url;
  }
}

// Rule 7: Available is black text with check mark; Taken/Invalid is orange fill badge with black text
function checkSlugAvailability(rawSlug) {
  const slug = (rawSlug || '').trim().toLowerCase();
  if (!el.slugAvailability) return;

  if (!slug) {
    el.slugAvailability.innerText = 'Required';
    el.slugAvailability.className = 'slug-status-indicator taken';
    return;
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    el.slugAvailability.innerText = 'Invalid format (use lowercase, numbers, hyphens)';
    el.slugAvailability.className = 'slug-status-indicator taken';
    return;
  }

  if (slug.length < 3) {
    el.slugAvailability.innerText = 'Too short (min 3 characters)';
    el.slugAvailability.className = 'slug-status-indicator taken';
    return;
  }

  const exists = appState.deployments.some(d => d.slug && d.slug.toLowerCase() === slug);
  if (exists) {
    el.slugAvailability.innerText = '[Taken] Name already deployed';
    el.slugAvailability.className = 'slug-status-indicator taken';
  } else {
    // 7. Available: black text with check mark, no color
    el.slugAvailability.innerText = '[✓] Available';
    el.slugAvailability.className = 'slug-status-indicator available';
  }
}

// ==========================================================================
// 4. File Limits Bento Tile (Verified against real Cloudflare Pages docs)
// ==========================================================================

function updateFileLimitsTile() {
  if (!el.tileLimits) return;

  const count = appState.queuedFiles.length;

  if (count === 0) {
    el.tileLimits.className = 'bento-tile tile-limits tile-state-ok';
    el.limitsStateBadge.innerText = 'OK';
    el.limitsMetricDisplay.innerText = '25 MB';
    el.limitsSubtext.innerText = 'Max per file · 20,000 files max';
    el.limitsContext.innerText = 'No files added yet · Ready for upload';
    el.limitsActionNote.innerText = 'Verified against Cloudflare Pages limits.';
    return;
  }

  const totalBytes = appState.queuedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const largestFile = appState.queuedFiles.reduce((max, f) => (f.size || 0) > (max.size || 0) ? f : max, appState.queuedFiles[0]);
  const largestSize = largestFile ? largestFile.size || 0 : 0;

  const totalFormatted = formatBytes(totalBytes);
  const largestFormatted = formatBytes(largestSize);

  const isAnyFileTooBig = largestSize > CF_LIMITS.maxFileSize;
  const isTooManyFiles = count > CF_LIMITS.maxFilesPerDeploy;

  if (isAnyFileTooBig) {
    // EMPTY / EXCEEDED state (Orange fill, black text)
    el.tileLimits.className = 'bento-tile tile-limits tile-state-empty';
    el.limitsStateBadge.innerText = 'EXCEEDED';
    el.limitsMetricDisplay.innerText = `${count} files`;
    el.limitsSubtext.innerText = `Oversized file detected (${largestFormatted})`;
    el.limitsContext.innerText = `"${largestFile.name}" exceeds 25 MB limit.`;
    el.limitsActionNote.innerText = 'Remove or compress this file to deploy.';
  } else if (isTooManyFiles) {
    el.tileLimits.className = 'bento-tile tile-limits tile-state-empty';
    el.limitsStateBadge.innerText = 'EXCEEDED';
    el.limitsMetricDisplay.innerText = `${count} files`;
    el.limitsSubtext.innerText = `Exceeds 20,000 file limit`;
    el.limitsContext.innerText = `Deployment contains ${count} files.`;
    el.limitsActionNote.innerText = 'Reduce folder contents under 20,000 assets.';
  } else {
    // OK state
    el.tileLimits.className = 'bento-tile tile-limits tile-state-ok';
    el.limitsStateBadge.innerText = 'OK';
    el.limitsMetricDisplay.innerText = `${count} file${count === 1 ? '' : 's'}`;
    el.limitsSubtext.innerText = `${totalFormatted} (largest: ${largestFormatted})`;
    el.limitsContext.innerText = 'Within limits (max 25 MB/file, 20k files).';
    el.limitsActionNote.innerText = 'Ready for Cloudflare edge compilation.';
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ==========================================================================
// 5. Dropzone & Drag-Over (Rule 5)
// ==========================================================================

function initDropZone() {
  if (!el.dropZone) return;

  el.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (el.fileInput) el.fileInput.click();
    }
  });

  // 5. DROPZONE DRAG-OVER: switches to solid 3px orange border and inverted headline
  ['dragenter', 'dragover'].forEach(name => {
    el.dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'dragend'].forEach(name => {
    el.dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.dropZone.classList.remove('dragover');
    });
  });

  el.dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dropZone.classList.remove('dragover');

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      await processDropItems(items);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFileList(e.dataTransfer.files);
    }
  });

  if (el.fileInput) {
    el.fileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await processFileList(e.target.files);
      }
    });
  }

  if (el.folderInput) {
    el.folderInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await processFileList(e.target.files);
      }
    });
  }

  if (el.clearFilesBtn) {
    el.clearFilesBtn.addEventListener('click', clearQueuedFiles);
  }
}

async function processDropItems(items) {
  const fileEntries = [];

  async function traverseEntry(entry, currentPath = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve));
      const relPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      fileEntries.push({ file, path: relPath });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readAllEntries = async () => {
        const entries = await new Promise((resolve) => dirReader.readEntries(resolve));
        if (entries.length > 0) {
          for (const child of entries) {
            await traverseEntry(child, currentPath ? `${currentPath}/${entry.name}` : entry.name);
          }
          await readAllEntries();
        }
      };
      await readAllEntries();
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry) await traverseEntry(entry);
    } else if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) fileEntries.push({ file, path: file.name });
    }
  }

  await loadFilesIntoQueue(fileEntries);
}

async function processFileList(fileList) {
  const fileEntries = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const relPath = file.webkitRelativePath || file.name;
    fileEntries.push({ file, path: relPath });
  }
  await loadFilesIntoQueue(fileEntries);
}

function isClientSensitivePath(filePath) {
  const clean = (filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = clean.split('/');
  const fileName = segments[segments.length - 1];
  const sensitiveDirs = ['.git', '.svn', '.hg', '.aws'];

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg === '.well-known') continue;
    if (sensitiveDirs.includes(seg) || seg.startsWith('.env')) return true;
  }

  const lower = fileName.toLowerCase();
  if (lower.startsWith('.env') || lower === '.git' || sensitiveDirs.includes(lower)) return true;
  if (lower.endsWith('.pem') || lower.endsWith('.key') || lower.startsWith('id_rsa') || lower.startsWith('id_ed25519')) return true;
  if (lower === '.npmrc' || lower === '.ds_store' || lower === 'thumbs.db') return true;

  return false;
}

async function loadFilesIntoQueue(fileEntries) {
  const binaryExtensions = [
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf',
    'zip', 'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'wasm'
  ];

  const processed = [];
  const excluded = [];

  for (const item of fileEntries) {
    const normPath = (item.path || item.file.name || '').replace(/\\/g, '/');

    // Reject null bytes, drive letters, traversals
    if (normPath.includes('\0') || /^[a-zA-Z]:/.test(normPath) || normPath.startsWith('/') || normPath.includes('../')) {
      excluded.push(normPath);
      continue;
    }

    // Exclude sensitive files at ANY path depth
    if (isClientSensitivePath(normPath)) {
      excluded.push(normPath);
      continue;
    }

    const ext = item.file.name.split('.').pop().toLowerCase();
    const isBinary = binaryExtensions.includes(ext) || item.file.type.startsWith('image/');

    const content = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      if (isBinary) {
        reader.readAsDataURL(item.file);
      } else {
        reader.readAsText(item.file);
      }
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
    });

    processed.push({
      name: item.file.name,
      path: normPath,
      content,
      isBase64: isBinary,
      size: item.file.size,
      type: item.file.type
    });
  }

  appState.queuedFiles = processed;
  appState.excludedFiles = excluded;
  renderQueuedFiles();
  updateFileLimitsTile();
  validateDeployButtonState();
}

function removeSingleQueuedFile(index) {
  if (index >= 0 && index < appState.queuedFiles.length) {
    appState.queuedFiles.splice(index, 1);
    renderQueuedFiles();
    updateFileLimitsTile();
    validateDeployButtonState();
  }
}

function clearQueuedFiles() {
  appState.queuedFiles = [];
  appState.excludedFiles = [];
  if (el.fileInput) el.fileInput.value = '';
  if (el.folderInput) el.folderInput.value = '';
  if (el.excludedFilesAlert) el.excludedFilesAlert.style.display = 'none';
  renderQueuedFiles();
  updateFileLimitsTile();
  validateDeployButtonState();
  showToast('Files cleared from queue');
}

function renderQueuedFiles() {
  if (appState.queuedFiles.length === 0) {
    el.queuedFilesBox.style.display = 'none';
    el.clearFilesBtn.style.display = 'none';
    el.payloadSummary.innerText = 'Select folder or files';
    el.entryFileAlert.style.display = 'none';
    if (el.excludedFilesAlert) el.excludedFilesAlert.style.display = 'none';
    return;
  }

  el.queuedFilesBox.style.display = 'block';
  el.clearFilesBtn.style.display = 'inline-flex';

  // Show excluded sensitive files banner before deploy
  if (el.excludedFilesAlert) {
    if (appState.excludedFiles && appState.excludedFiles.length > 0) {
      el.excludedFilesAlert.style.display = 'block';
      const count = appState.excludedFiles.length;
      const fileNames = appState.excludedFiles.slice(0, 3).map(p => p.split('/').pop()).join(', ');
      const more = count > 3 ? '...' : '';
      el.excludedFilesAlert.innerText = `${count} file${count === 1 ? '' : 's'} excluded: ${fileNames}${more}`;
    } else {
      el.excludedFilesAlert.style.display = 'none';
    }
  }

  const count = appState.queuedFiles.length;
  const totalFormatted = formatBytes(appState.queuedFiles.reduce((acc, f) => acc + (f.size || 0), 0));

  el.queuedHeader.innerText = `${count} file${count === 1 ? '' : 's'} queued`;
  el.queuedSize.innerText = totalFormatted;
  el.payloadSummary.innerText = `${count} file${count === 1 ? '' : 's'} (${totalFormatted})`;

  const hasExactIndex = appState.queuedFiles.some(f => f.path.replace(/^\/+/, '').toLowerCase() === 'index.html');
  let autoRenameCandidate = null;

  if (!hasExactIndex && appState.autoRenameIndex) {
    autoRenameCandidate = appState.queuedFiles.find(f => {
      const p = f.path.replace(/^\/+/, '');
      return !p.includes('/') && (p.toLowerCase().endsWith('.html') || p.toLowerCase().endsWith('.htm'));
    }) || appState.queuedFiles.find(f => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm'))
       || (appState.queuedFiles.length === 1 ? appState.queuedFiles[0] : null);
  }

  el.queuedList.innerHTML = appState.queuedFiles.map((file, idx) => {
    const sizeStr = formatBytes(file.size);
    const isExactIndex = file.path.replace(/^\/+/, '').toLowerCase() === 'index.html';
    const isCandidate = autoRenameCandidate && file === autoRenameCandidate;

    let badge = '';
    if (isExactIndex) {
      badge = `<span class="entry-badge native-index">Root index.html</span>`;
    } else if (isCandidate) {
      badge = `<span class="entry-badge">Auto-renamed to index.html</span>`;
    }

    return `
      <li class="queued-file-row">
        <div class="queued-file-left">
          <span>${escapeHtml(file.path)}</span>
          ${badge}
        </div>
        <div class="queued-file-right">
          <span class="file-size-tag">${sizeStr}</span>
          <button type="button" class="btn-remove-file" onclick="removeSingleQueuedFile(${idx})" title="Remove this file">
            Remove
          </button>
        </div>
      </li>
    `;
  }).join('');

  if (!hasExactIndex && !autoRenameCandidate) {
    el.entryFileAlert.style.display = 'block';
    el.entryFileAlert.className = 'entry-file-alert warn';
    el.entryFileAlert.innerText = 'Warning: No index.html found. Visitors will see a 404 unless an entry file is specified.';
  } else {
    el.entryFileAlert.style.display = 'none';
  }
}

window.removeSingleQueuedFile = removeSingleQueuedFile;

// ==========================================================================
// 6. Deploy Button (Rule 2) & Quota State Validation
// ==========================================================================

function validateDeployButtonState() {
  if (!appState.isLinked) {
    el.deployBtn.disabled = true;
    el.deployBtnText.innerText = 'Link device to deploy';
    el.deployReasonText.innerText = 'This browser is not linked to a device session.';
    return;
  }

  const hasFiles = appState.queuedFiles.length > 0;
  const isQuotaExceeded = appState.quota && appState.quota.daily && (appState.quota.daily.remaining <= 0 || appState.quota.daily.isExceeded);
  const slug = el.slugInput.value.trim();
  const isSlugValid = slug.length >= 3 && /^[a-z0-9-]+$/.test(slug);
  const hasOversizedFile = appState.queuedFiles.some(f => (f.size || 0) > CF_LIMITS.maxFileSize);

  if (isQuotaExceeded) {
    el.deployBtn.disabled = true;
    el.deployBtnText.innerText = 'Daily limit reached (0 left)';
    const nextResetDate = new Date(Date.now() + appState.secondsUntilReset * 1000);
    const localTimeFormatted = nextResetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.deployReasonText.innerText = `Daily limit reached, resets at ${localTimeFormatted}.`;
    return;
  }

  if (hasOversizedFile) {
    el.deployBtn.disabled = true;
    el.deployBtnText.innerText = 'File exceeds 25 MB limit';
    el.deployReasonText.innerText = 'One or more files exceed Cloudflare Pages asset limits.';
    return;
  }

  if (!hasFiles) {
    el.deployBtn.disabled = true;
    el.deployBtnText.innerText = 'Add files to deploy';
    el.deployReasonText.innerText = 'Drop a folder or select files above to enable deployment.';
    return;
  }

  if (!isSlugValid) {
    el.deployBtn.disabled = true;
    el.deployBtnText.innerText = 'Enter valid site name';
    el.deployReasonText.innerText = 'Site name must be at least 3 characters (letters, numbers, hyphens).';
    return;
  }

  // Enabled state: Orange fill, black text, 56px tall
  el.deployBtn.disabled = false;
  el.deployBtnText.innerText = 'Deploy';

  const remaining = appState.quota ? appState.quota.daily.remaining : 100;
  if (remaining < 10) {
    el.deployReasonText.innerText = `[!] Warning: Only ${remaining} upload${remaining === 1 ? '' : 's'} remaining today.`;
  } else {
    el.deployReasonText.innerText = '';
  }
}

// ==========================================================================
// 7. Telemetry & Quota Status (Rules 1 & 8)
// ==========================================================================

async function fetchStatus(syncWithCf = false) {
  try {
    const res = await apiFetch(`/api/status?sync=${syncWithCf}`);
    const data = await res.json();
    if (data.success && data.status) {
      updateStatusUI(data.status);
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
    if (el.connectionBadge) {
      el.connectionBadge.style.display = 'inline-block';
      el.connectionBadge.innerText = '[!] Cloudflare offline';
    }
  }
}

function updateStatusUI(status) {
  appState.quota = status;
  appState.secondsUntilReset = status.reset.secondsUntilReset;

  // 1. HERO TILE: Uploads Left Today
  const dailyRemaining = status.daily.remaining;
  const dailyLimit = status.daily.limit || 100;
  const dailyPercent = Math.min(100, Math.round(((dailyLimit - dailyRemaining) / dailyLimit) * 100));

  el.dailyRemaining.innerText = dailyRemaining;
  el.dailySubtext.innerText = `of ${dailyLimit} today`;
  el.dailyProgressBarFill.style.width = `${dailyPercent}%`;

  formatAndDisplayCountdown();

  const nextResetDate = new Date(Date.now() + appState.secondsUntilReset * 1000);
  const localResetTime = nextResetDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // 1. HERO STATES: OK, LOW, EMPTY
  if (dailyRemaining <= 0 || status.daily.isExceeded) {
    // EMPTY (0): solid orange fill, black numeral "0", reset time in large black text
    el.tileUploads.className = 'bento-tile tile-metric tile-hero tile-state-empty';
    el.uploadsStateBadge.innerText = 'EMPTY';
    el.uploadsWarningLine.style.display = 'block';
    el.uploadsWarningLine.innerText = `Back at ${localResetTime} (00:00 UTC)`;
    el.uploadsStateNote.innerText = `Daily upload quota exhausted. Replenishes at ${localResetTime}.`;
  } else if (dailyRemaining < 10) {
    // LOW (under 10): flips to solid orange fill, black numeral and text, plus warning
    el.tileUploads.className = 'bento-tile tile-metric tile-hero tile-state-low';
    el.uploadsStateBadge.innerText = 'LOW';
    el.uploadsWarningLine.style.display = 'block';
    el.uploadsWarningLine.innerText = `Warning: Only ${dailyRemaining} upload${dailyRemaining === 1 ? '' : 's'} left today.`;
    el.uploadsStateNote.innerText = `Resets at ${localResetTime} (${status.reset.countdownFormatted || 'tonight'}).`;
  } else {
    // OK (10 or more left): giant orange numeral on off-white tile; everything else stays black
    el.tileUploads.className = 'bento-tile tile-metric tile-hero tile-state-ok';
    el.uploadsStateBadge.innerText = 'OK';
    el.uploadsWarningLine.style.display = 'none';
    el.uploadsStateNote.innerText = 'Free quota resets daily at 00:00 UTC.';
  }

  // 8. BUILDS LEFT THIS MONTH TILE
  const monthlyRemaining = status.monthly.remaining;
  const monthlyLimit = status.monthly.limit || 500;
  const monthlyUsed = monthlyLimit - monthlyRemaining;
  const monthlyPercent = Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100));

  el.monthlyRemaining.innerText = monthlyRemaining;
  el.monthlySubtext.innerText = `of ${monthlyLimit} monthly builds`;
  el.monthlyProgressBarFill.style.width = `${monthlyPercent}%`;

  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthName = nextMonth.toLocaleDateString([], { month: 'short' });
  el.monthlyResetNotice.innerText = `Resets on 1 ${nextMonthName}`;

  // Rule 8: Progress bar fill is black until 80% used, then orange
  if (monthlyPercent >= 80) {
    el.tileBuilds.classList.add('builds-near-cap');
  } else {
    el.tileBuilds.classList.remove('builds-near-cap');
  }

  // Rule 8: LOW/EMPTY under 10% remaining (<= 50)
  if (monthlyRemaining <= 0) {
    el.tileBuilds.className = 'bento-tile tile-metric tile-state-empty';
    el.buildsStateBadge.innerText = 'EMPTY';
  } else if (monthlyRemaining <= 50) {
    el.tileBuilds.className = 'bento-tile tile-metric tile-state-low';
    el.buildsStateBadge.innerText = 'LOW';
  } else {
    el.tileBuilds.className = 'bento-tile tile-metric tile-state-ok';
    el.buildsStateBadge.innerText = 'OK';
  }

  if (!status.cloudflare.configured) {
    el.connectionBadge.style.display = 'inline-block';
    el.connectionBadge.innerText = '[!] Cloudflare credentials needed';
  } else {
    el.connectionBadge.style.display = 'none';
  }

  validateDeployButtonState();
  updateLiveFinalUrl();
}

// ==========================================================================
// 8. Last Deployment Tile (Rule 4) & Your Sites (Rule 5)
// ==========================================================================

async function fetchDeployments() {
  try {
    const res = await apiFetch('/api/deployments');
    const data = await res.json();
    if (data.success && data.deployments) {
      appState.deployments = data.deployments;
      renderDeploymentsTable();
      updateLastDeploymentTile();
      updateYourSitesTile();
      checkSlugAvailability(el.slugInput.value);
    }
  } catch (err) {
    console.error('Failed to fetch deployments:', err);
  }
}

// Rule 4: Last Deployment is NEVER orange. If "new" signal needed, instant black inversion of header for 10s
function updateLastDeploymentTile(invertHeader = false) {
  if (!el.tileLastDeploy) return;

  if (appState.deployments.length === 0) {
    el.lastDeployEmpty.style.display = 'flex';
    el.lastDeployContent.style.display = 'none';
    el.lastDeployTimeTag.innerText = 'Empty';
    return;
  }

  const sorted = [...appState.deployments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const latest = sorted[0];

  el.lastDeployEmpty.style.display = 'none';
  el.lastDeployContent.style.display = 'flex';

  const displayUrl = latest.url || `https://${latest.slug}.pages.dev`;
  const timeFormatted = formatLocalDate(latest.created_at);

  el.lastDeployTitle.innerText = latest.title || latest.slug;
  el.lastDeployTime.innerText = `${timeFormatted.primary} (${timeFormatted.relative})`;
  el.lastDeployTimeTag.innerText = timeFormatted.relative || 'Recent';

  el.lastDeployUrlAnchor.href = displayUrl;
  el.lastDeployUrlAnchor.innerText = displayUrl;

  el.lastDeployCopyBtn.onclick = () => {
    navigator.clipboard.writeText(displayUrl);
    showToast('Live link copied to clipboard');
  };

  el.lastDeployOpenBtn.onclick = () => {
    window.open(displayUrl, '_blank');
  };

  el.lastDeployQrBtn.onclick = () => {
    openQrModal(displayUrl, latest.slug);
  };

  // Rule 4: Instant black inversion of header for 10 seconds, never orange
  if (invertHeader) {
    el.tileLastDeploy.classList.add('header-inverted');
    setTimeout(() => {
      el.tileLastDeploy.classList.remove('header-inverted');
    }, 10000);
  }
}

function updateYourSitesTile() {
  if (!el.tileSites) return;

  const count = appState.deployments.length;
  el.sitesCountDisplay.innerText = count;

  if (count > 0) {
    const sorted = [...appState.deployments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const newestSlug = sorted[0].slug;
    el.sitesNewestDisplay.innerText = `Newest: ${newestSlug}`;
  } else {
    el.sitesNewestDisplay.innerText = 'No deployments yet';
  }
}

// ==========================================================================
// 9. Deployments Ledger Table (Rule 10)
// ==========================================================================

function updateSortHeadersUI() {
  // 10. Active sort column header gets 3px orange underline
  [el.colHeaderName, el.colHeaderStyle, el.colHeaderUrl, el.colHeaderDate].forEach(th => {
    if (th) th.classList.remove('sort-active');
  });

  if (appState.sortMode === 'alpha' && el.colHeaderName) {
    el.colHeaderName.classList.add('sort-active');
  } else if (el.colHeaderDate) {
    el.colHeaderDate.classList.add('sort-active');
  }
}

function renderDeploymentsTable() {
  const searchTerm = (el.linksSearchInput ? el.linksSearchInput.value : '').trim().toLowerCase();

  let items = appState.deployments.filter(d => {
    return (d.slug && d.slug.toLowerCase().includes(searchTerm)) ||
           (d.title && d.title.toLowerCase().includes(searchTerm)) ||
           (d.url && d.url.toLowerCase().includes(searchTerm));
  });

  if (appState.sortMode === 'oldest') {
    items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else if (appState.sortMode === 'alpha') {
    items.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));
  } else {
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  updateSortHeadersUI();

  if (el.deploymentsCountBadge) {
    el.deploymentsCountBadge.innerText = `Showing ${items.length} of ${appState.deployments.length}`;
  }

  if (items.length === 0) {
    const msg = searchTerm
      ? 'No deployments match your search filter.'
      : 'No deployments yet. Drop a folder to create one.';
    el.linksTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty-row">
          ${msg}
        </td>
      </tr>
    `;
    return;
  }

  el.linksTableBody.innerHTML = items.map(item => {
    const displayUrl = item.url || `https://${item.slug}.pages.dev`;
    const styleLabel = item.mode === 'path' ? 'Path' : 'Subdomain';
    const dateFormatted = formatLocalDate(item.created_at);
    const slug = escapeHtml(item.slug || '');
    const title = item.title && item.title !== 'Instant Edge Static Drop' ? escapeHtml(item.title) : '';
    const isConfirming = appState.activeDeleteConfirmSlug === item.slug;

    let actionsHtml = '';
    if (isConfirming) {
      // 10. Delete confirmation: Yes button is orange fill, black text
      actionsHtml = `
        <div class="delete-confirm-box">
          <span class="confirm-label">Delete?</span>
          <button type="button" class="btn-confirm-yes" onclick="confirmDeleteDeployment('${item.slug}')">Yes</button>
          <button type="button" class="btn-confirm-no" onclick="cancelDeleteDeployment()">Cancel</button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="table-actions-cluster">
          <button type="button" class="btn-row-action" onclick="copyLink('${displayUrl}')" title="Copy full URL">Copy</button>
          <button type="button" class="btn-row-action" onclick="openQrModal('${displayUrl}', '${slug}')" title="Show QR code">QR</button>
          <button type="button" class="btn-row-action" onclick="window.open('${displayUrl}', '_blank')" title="Open live site">Open</button>
          <div class="action-divider" aria-hidden="true"></div>
          <button type="button" class="btn-row-action btn-row-del" onclick="promptDeleteDeployment('${item.slug}')" title="Delete record">Delete</button>
        </div>
      `;
    }

    return `
      <tr>
        <td>
          <div class="table-site-name">${slug}</div>
          ${title ? `<div class="table-site-title">${title}</div>` : ''}
        </td>
        <td>
          <span class="table-style-badge">${styleLabel}</span>
        </td>
        <td>
          <a href="${displayUrl}" target="_blank" rel="noopener noreferrer" class="table-url-link" title="Open ${displayUrl}">
            ${displayUrl}
          </a>
        </td>
        <td>
          <div class="table-date-time">
            <span>${dateFormatted.primary}</span>
            <span class="table-date-relative">${dateFormatted.relative}</span>
          </div>
        </td>
        <td style="text-align: right;">
          ${actionsHtml}
        </td>
      </tr>
    `;
  }).join('');
}

function promptDeleteDeployment(slug) {
  appState.activeDeleteConfirmSlug = slug;
  renderDeploymentsTable();
}

function cancelDeleteDeployment() {
  appState.activeDeleteConfirmSlug = null;
  renderDeploymentsTable();
}

async function confirmDeleteDeployment(slug) {
  try {
    await apiFetch(`/api/deployments/${slug}`, { method: 'DELETE' });
    showToast(`Deleted deployment "${slug}"`);
    appState.activeDeleteConfirmSlug = null;
    await fetchDeployments();
    fetchStatus(false);
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

window.copyLink = function(url) {
  navigator.clipboard.writeText(url);
  showToast('Link copied to clipboard');
};

window.promptDeleteDeployment = promptDeleteDeployment;
window.cancelDeleteDeployment = cancelDeleteDeployment;
window.confirmDeleteDeployment = confirmDeleteDeployment;

// ==========================================================================
// 10. Deploy Execution & Wrangler Stream (Rule 9)
// ==========================================================================

async function handleDeploySubmit(e) {
  e.preventDefault();

  const slug = el.slugInput.value.trim().toLowerCase();
  const title = el.pageTitleInput.value.trim();
  const subtitle = el.pageSubtitleInput.value.trim();
  const content = el.pageContentInput.value.trim();
  const prefix = el.prefixInput.value.trim();
  const mode = appState.activeMode;
  const files = appState.queuedFiles;

  if (files.length === 0) {
    showToast('Please select or drop files to deploy', 'error');
    return;
  }

  appState.abortController = new AbortController();

  setDeployProgressState(true);
  hideAllFeedbackBoxes();

  el.deployProgressBox.style.display = 'flex';
  el.deployProgressMessage.innerText = `1/3: Staging ${files.length} file${files.length === 1 ? '' : 's'}...`;
  el.deployProgressBarFill.style.width = '33%';

  // 9. Wrangler CLI Stream: Running state gets solid orange square marker + "Running" label
  if (el.cliStatusTag) {
    el.cliStatusTag.className = 'cli-status-tag running';
    el.cliStatusTag.innerText = 'Running';
  }
  if (el.cliErrorBanner) {
    el.cliErrorBanner.style.display = 'none';
  }

  el.terminalOutput.innerText = `[INIT] Starting direct deployment for slug: ${slug}...\n[INIT] Mode: ${mode} | Queued: ${files.length} files\n`;

  const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

  try {
    setTimeout(() => {
      if (appState.abortController) {
        el.deployProgressMessage.innerText = `2/3: Uploading payload to Cloudflare Pages edge...`;
        el.deployProgressBarFill.style.width = '66%';
      }
    }, 600);

    const res = await apiFetch('/api/deployments/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId
      },
      signal: appState.abortController.signal,
      body: JSON.stringify({
        requestId,
        customSlug: slug,
        title,
        subtitle,
        content,
        prefix,
        mode,
        files,
        autoRenameIndex: appState.autoRenameIndex
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Cloudflare deployment failed');
    }

    el.deployProgressMessage.innerText = `3/3: Deployment finalized!`;
    el.deployProgressBarFill.style.width = '100%';

    if (data.logs && data.logs.length) {
      el.terminalOutput.innerText += data.logs.join('\n') + '\n';
    }
    el.terminalOutput.innerText += `\n[SUCCESS] Live URL is ready: ${data.url}\n`;

    if (el.cliStatusTag) {
      el.cliStatusTag.className = 'cli-status-tag';
      el.cliStatusTag.innerText = 'Success';
    }

    showSuccessBlock(data.url, slug);

    if (data.quota) updateStatusUI(data.quota);
    await fetchDeployments();

    // 4. Invert Last Deployment tile header for 10s (never orange)
    updateLastDeploymentTile(true);

    clearQueuedFiles();
    generateNewSlug();

  } catch (err) {
    if (err.name === 'AbortError') {
      showToast('Deployment cancelled by user');
      el.terminalOutput.innerText += `\n[CANCELLED] Deployment aborted by user.\n`;
      if (el.cliStatusTag) {
        el.cliStatusTag.className = 'cli-status-tag';
        el.cliStatusTag.innerText = 'Cancelled';
      }
      hideAllFeedbackBoxes();
    } else {
      showErrorBlock(err.message);
      el.terminalOutput.innerText += `\n[ERROR] ${err.message}\n`;
      // 9. Wrangler CLI Stream: Error state gets orange fill row with error text in black
      if (el.cliStatusTag) {
        el.cliStatusTag.className = 'cli-status-tag';
        el.cliStatusTag.innerText = 'Error';
      }
      if (el.cliErrorBanner) {
        el.cliErrorBanner.style.display = 'block';
        el.cliErrorBanner.innerText = `[STREAM ERROR] ${err.message}`;
      }
    }
  } finally {
    setDeployProgressState(false);
    appState.abortController = null;
  }
}

function setDeployProgressState(isDeploying) {
  if (isDeploying) {
    el.deployBtn.style.display = 'none';
    el.cancelDeployBtn.style.display = 'inline-flex';
    el.previewBtn.disabled = true;
  } else {
    el.deployBtn.style.display = 'inline-flex';
    el.cancelDeployBtn.style.display = 'none';
    el.previewBtn.disabled = false;
    validateDeployButtonState();
  }
}

function hideAllFeedbackBoxes() {
  el.deployProgressBox.style.display = 'none';
  el.deployErrorBox.style.display = 'none';
  el.deploySuccessBox.style.display = 'none';
}

function showSuccessBlock(url, slug) {
  el.deployProgressBox.style.display = 'none';
  el.deployErrorBox.style.display = 'none';
  el.deploySuccessBox.style.display = 'flex';

  el.successLiveUrlAnchor.href = url;
  el.successLiveUrlAnchor.innerText = url;

  el.successCopyBtn.onclick = () => {
    navigator.clipboard.writeText(url);
    showToast('Live link copied to clipboard');
  };

  el.successOpenBtn.onclick = () => {
    window.open(url, '_blank');
  };

  el.successQrBtn.onclick = () => {
    openQrModal(url, slug);
  };
}

function showErrorBlock(rawMessage) {
  el.deployProgressBox.style.display = 'none';
  el.deploySuccessBox.style.display = 'none';
  el.deployErrorBox.style.display = 'flex';

  let userMessage = rawMessage;
  let resolution = 'Check your files or review Cloudflare settings.';

  if (rawMessage.includes('Invalid API Token') || rawMessage.includes('code 1000')) {
    userMessage = 'Cloudflare API Token is invalid or unauthorized.';
    resolution = 'Open "Cloudflare settings" to enter a valid token with Pages:Edit permissions.';
  } else if (rawMessage.includes('limit reached') || rawMessage.includes('429')) {
    userMessage = 'Daily free quota limit reached (100 deployments/day).';
    resolution = 'Uploads will automatically unlock at 00:00 UTC.';
  }

  el.deployErrorMessage.innerText = userMessage;
  el.deployErrorResolution.innerText = `Suggested action: ${resolution}`;
}

// ==========================================================================
// 11. Event Bindings
// ==========================================================================

function bindEvents() {
  el.randomizeSlugBtn.addEventListener('click', generateNewSlug);

  el.slugInput.addEventListener('input', (e) => {
    const slug = e.target.value;
    updateSlugPreviews(slug);
    checkSlugAvailability(slug);
    updateLiveFinalUrl();
    validateDeployButtonState();
  });

  if (el.prefixInput) {
    el.prefixInput.addEventListener('input', generateNewSlug);
  }

  if (el.relinkDeviceBtn) {
    el.relinkDeviceBtn.addEventListener('click', handleRelinkDevice);
  }

  // 6. Selected URL Style: black inverted card + 8px orange left edge + orange [✓]
  el.modeBranchOption.addEventListener('click', () => {
    appState.activeMode = 'branch';
    localStorage.setItem('cf_pref_mode', 'branch');
    el.modeBranchOption.classList.add('selected');
    el.modePathOption.classList.remove('selected');
    el.modeBranchOption.querySelector('.arch-radio-mark').innerText = '[✓]';
    el.modePathOption.querySelector('.arch-radio-mark').innerText = '[ ]';
    el.modeBranchOption.querySelector('input').checked = true;
    updateLiveFinalUrl();
  });

  el.modePathOption.addEventListener('click', () => {
    appState.activeMode = 'path';
    localStorage.setItem('cf_pref_mode', 'path');
    el.modePathOption.classList.add('selected');
    el.modeBranchOption.classList.remove('selected');
    el.modePathOption.querySelector('.arch-radio-mark').innerText = '[✓]';
    el.modeBranchOption.querySelector('.arch-radio-mark').innerText = '[ ]';
    el.modePathOption.querySelector('input').checked = true;
    updateLiveFinalUrl();
  });

  if (el.copyLiveUrlBtn) {
    el.copyLiveUrlBtn.addEventListener('click', () => {
      const url = el.liveFinalUrl.innerText;
      navigator.clipboard.writeText(url);
      showToast('Live preview URL copied');
    });
  }

  el.generatorForm.addEventListener('submit', handleDeploySubmit);

  el.cancelDeployBtn.addEventListener('click', () => {
    if (appState.abortController) {
      appState.abortController.abort();
    }
  });

  el.previewBtn.addEventListener('click', openLivePreview);
  el.closePreviewModalBtn.addEventListener('click', () => el.previewModal.style.display = 'none');

  el.syncStatusBtn.addEventListener('click', () => {
    fetchStatus(true);
    fetchDeployments();
    showToast('Telemetry synchronized with Cloudflare');
  });

  if (el.autoRenameCheckbox) {
    el.autoRenameCheckbox.checked = appState.autoRenameIndex;
    el.autoRenameCheckbox.addEventListener('change', (e) => {
      appState.autoRenameIndex = e.target.checked;
      localStorage.setItem('cf_pref_auto_rename', String(appState.autoRenameIndex));
      renderQueuedFiles();
    });
  }

  // Tile 5 (Your Sites) click & keyboard handler
  if (el.tileSites) {
    const scrollToLedger = () => {
      if (el.ledgerSection) {
        el.ledgerSection.scrollIntoView({ behavior: 'smooth' });
        if (el.linksSearchInput) el.linksSearchInput.focus();
      }
    };
    el.tileSites.addEventListener('click', scrollToLedger);
    el.tileSites.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        scrollToLedger();
      }
    });
  }

  el.linksSearchInput.addEventListener('input', renderDeploymentsTable);
  el.linksSortSelect.addEventListener('change', (e) => {
    appState.sortMode = e.target.value;
    renderDeploymentsTable();
  });

  el.closeQrModalBtn.addEventListener('click', () => el.qrModal.style.display = 'none');
  el.copyQrUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(appState.currentModalQrUrl);
    showToast('Link copied to clipboard');
  });
  el.openQrUrlBtn.addEventListener('click', () => {
    if (appState.currentModalQrUrl) window.open(appState.currentModalQrUrl, '_blank');
  });
  el.downloadQrBtn.addEventListener('click', downloadQrImage);

  el.openSettingsBtn.addEventListener('click', openSettings);
  el.closeSettingsModalBtn.addEventListener('click', () => el.settingsModal.style.display = 'none');
  el.cancelSettingsBtn.addEventListener('click', () => el.settingsModal.style.display = 'none');
  el.saveSettingsBtn.addEventListener('click', saveSettings);
  el.testTokenBtn.addEventListener('click', testToken);
}

// ==========================================================================
// 12. Modals (Preview, QR, Settings)
// ==========================================================================

async function openLivePreview() {
  const slug = el.slugInput.value.trim() || 'preview-demo';
  const title = el.pageTitleInput.value.trim();
  const subtitle = el.pageSubtitleInput.value.trim();
  const content = el.pageContentInput.value.trim();

  const htmlFile = appState.queuedFiles.find(f => f.path.toLowerCase().endsWith('.html'));
  if (htmlFile && !htmlFile.isBase64) {
    el.previewIframe.srcdoc = htmlFile.content;
    el.previewModal.style.display = 'flex';
    return;
  }

  try {
    const res = await apiFetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title, subtitle, content })
    });
    const html = await res.text();
    el.previewIframe.srcdoc = html;
    el.previewModal.style.display = 'flex';
  } catch (err) {
    showToast(`Preview failed: ${err.message}`, 'error');
  }
}

window.openQrModal = function(url, slug = '') {
  appState.currentModalQrUrl = url;
  appState.currentModalSlug = slug;
  el.qrUrlLabel.innerText = url;
  el.qrModal.style.display = 'flex';
  drawQrToCanvas(url, el.qrCanvas);
};

function drawQrToCanvas(text, canvas) {
  if (window.LocalQRCode) {
    window.LocalQRCode.draw(text, canvas, { margin: 2, width: canvas.width || 220 });
  } else if (window.QRCode && window.QRCode.toCanvas) {
    window.QRCode.toCanvas(canvas, text, { margin: 2, width: canvas.width || 220 });
  } else {
    const ctx = canvas.getContext('2d');
    const size = canvas.width || 200;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    ctx.font = '12px monospace';
    ctx.fillText('Live Endpoint QR', 20, size / 2);
  }
}

async function downloadQrImage() {
  const url = appState.currentModalQrUrl;
  const slug = appState.currentModalSlug || 'site';
  let dataUrl = null;

  if (window.LocalQRCode && window.LocalQRCode.toDataURL && url) {
    try {
      dataUrl = await window.LocalQRCode.toDataURL(url, { width: 512, margin: 2 });
    } catch (_) {}
  }
  if (!dataUrl && el.qrCanvas) {
    dataUrl = el.qrCanvas.toDataURL('image/png');
  }
  if (!dataUrl) return;

  const a = document.createElement('a');
  a.download = `qr-${slug}.png`;
  a.href = dataUrl;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('High-resolution QR code downloaded as PNG');
}

function openSettings() {
  if (appState.quota && appState.quota.cloudflare) {
    if (!el.settingsProjectName.value) {
      el.settingsProjectName.value = appState.quota.cloudflare.projectName || 'random-pages-vault';
    }
  }
  if (el.settingsDeviceId) {
    el.settingsDeviceId.innerText = appState.deviceId;
  }
  el.testTokenResult.innerText = '';
  el.settingsModal.style.display = 'flex';
}

async function testToken() {
  const typedToken = el.settingsApiToken.value.trim();
  const typedAccountId = el.settingsAccountId.value.trim();

  el.testTokenResult.innerText = 'Verifying credentials...';
  el.testTokenResult.style.color = '#000000';

  try {
    const payload = {};
    if (typedToken) payload.apiToken = typedToken;
    if (typedAccountId) payload.accountId = typedAccountId;

    const res = await apiFetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.valid) {
      if (data.detectedAccountId && (!el.settingsAccountId.value || el.settingsAccountId.value.trim() === '')) {
        el.settingsAccountId.value = data.detectedAccountId;
      }
      if (data.permissionsWarning) {
        el.testTokenResult.innerText = `[Warning] ${data.permissionsWarning}`;
      } else {
        const autoDetectedMsg = data.detectedAccountId ? ' · Account auto-detected' : '';
        el.testTokenResult.innerText = `[OK] Token valid & active (Pages Edit)${autoDetectedMsg}`;
      }
      el.testTokenResult.style.color = '#000000';
    } else {
      el.testTokenResult.innerText = `[Error] ${data.message || 'Invalid token'}`;
      el.testTokenResult.style.color = '#000000';
    }
  } catch (err) {
    el.testTokenResult.innerText = `[Error] ${err.message}`;
    el.testTokenResult.style.color = '#000000';
  }
}

async function saveSettings() {
  const accountId = el.settingsAccountId.value.trim();
  const apiToken = el.settingsApiToken.value.trim();
  const projectName = el.settingsProjectName.value.trim() || 'random-pages-vault';
  const dailyFreeLimit = parseInt(el.settingsDailyLimit.value, 10) || 100;

  // Clean any legacy plaintext credentials from localStorage
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cf_device_vault_')) {
        localStorage.removeItem(key);
      }
    }
  } catch (_) {}

  try {
    const res = await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, apiToken, projectName, dailyFreeLimit })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Settings saved to secure server storage');
      el.settingsApiToken.value = ''; // Do not keep token in DOM input
      el.settingsModal.style.display = 'none';
      fetchStatus(true);
    } else {
      showToast(`Config error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ==========================================================================
// 13. Helpers (Never orange)
// ==========================================================================

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  toast.innerHTML = `<span class="toast-code">[${type === 'success' ? 'OK' : 'INFO'}]</span> <span class="toast-msg">${escapeHtml(message)}</span>`;
  el.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}

function formatLocalDate(isoString) {
  if (!isoString) return { primary: '--', relative: '' };
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  let relative = '';
  if (diffSec < 60) relative = 'just now';
  else if (diffSec < 3600) relative = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) relative = `${Math.floor(diffSec / 3600)}h ago`;
  else relative = `${Math.floor(diffSec / 86400)}d ago`;

  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const primary = isToday ? `Today, ${timeStr}` : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;

  return { primary, relative };
}
