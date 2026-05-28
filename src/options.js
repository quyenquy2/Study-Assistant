// Study Assistant - Options page

import { deleteDocument, importPdfFile, listDocuments } from './documents.js';

const $ = (s) => document.querySelector(s);

const MODEL_DEFAULTS = {
  gemini: 'gemini-2.0-flash',
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  custom: 'gpt-4o-mini'
};

const KEY_HINTS = {
  gemini: 'Lấy free tại aistudio.google.com/apikey',
  claude: 'Bắt đầu bằng "sk-ant-..." từ console.anthropic.com',
  openai: 'Bắt đầu bằng "sk-..." từ platform.openai.com',
  custom: 'API key do gateway bên thứ 3 cấp'
};

const QUICK_TOAST_DEFAULTS = {
  backgroundColor: '#2ecc71',
  textColor: '#ffffff',
  fontSize: 14,
  opacity: 0.95
};

let saveQuickToastTimer = null;

init();

async function init() {
  const cfg = await chrome.storage.sync.get([
    'provider', 'apiKey', 'model', 'systemPrompt',
    'baseUrl', 'authScheme', 'endpointPath', 'apiFormat', 'lookupMode',
    'showSelectionIcon', 'indexPdfVisuals',
    'quickToastStyleEnabled', 'quickToastBackgroundColor', 'quickToastTextColor',
    'quickToastFontSize', 'quickToastOpacity'
  ]);

  if (cfg.provider) {
    const radio = document.querySelector(`input[name="provider"][value="${cfg.provider}"]`);
    if (radio) radio.checked = true;
  }
  $('#api-key').value = cfg.apiKey || '';
  $('#model').value = cfg.model || '';
  $('#system-prompt').value = cfg.systemPrompt || '';
  $('#base-url').value = cfg.baseUrl || '';
  $('#endpoint-path').value = cfg.endpointPath || '';
  $('#auth-scheme').value = cfg.authScheme || '';
  $('#api-format').value = cfg.apiFormat || 'openai';
  const modeRadio = document.querySelector(`input[name="lookupMode"][value="${cfg.lookupMode || 'detail'}"]`);
  if (modeRadio) modeRadio.checked = true;
  $('#show-selection-icon').checked = cfg.showSelectionIcon !== false;
  $('#index-pdf-visuals').checked = cfg.indexPdfVisuals === true;
  setQuickToastSettings(cfg);

  updateHints();
  await renderShortcuts();

  document.querySelectorAll('input[name="provider"]').forEach((r) => {
    r.addEventListener('change', updateHints);
  });

  $('#api-format').addEventListener('change', updateFormatHints);

  $('#toggle-key').addEventListener('click', () => {
    const inp = $('#api-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  $('#save-btn').addEventListener('click', save);
  $('#test-btn').addEventListener('click', test);
  $('#open-shortcuts').addEventListener('click', openShortcutsPage);
  $('#show-selection-icon').addEventListener('change', async () => {
    await chrome.storage.sync.set({ showSelectionIcon: $('#show-selection-icon').checked });
  });
  $('#index-pdf-visuals').addEventListener('change', async () => {
    await chrome.storage.sync.set({ indexPdfVisuals: $('#index-pdf-visuals').checked });
  });
  $('#quick-toast-style-enabled').addEventListener('change', () => {
    updateQuickToastPreview();
    saveQuickToastSettings();
  });
  ['quick-toast-bg-color', 'quick-toast-text-color', 'quick-toast-font-size', 'quick-toast-opacity'].forEach((id) => {
    $(`#${id}`).addEventListener('input', () => {
      $('#quick-toast-style-enabled').checked = true;
      updateQuickToastPreview();
      scheduleQuickToastSettingsSave();
    });
  });
  $('#pdf-upload').addEventListener('change', handlePdfUpload);
  $('#document-list').addEventListener('click', handleDocumentListClick);

  await renderDocuments();
}

function getProvider() {
  return document.querySelector('input[name="provider"]:checked').value;
}

function updateHints() {
  const provider = getProvider();
  $('#key-hint').textContent = KEY_HINTS[provider];
  $('#model').placeholder = `Mặc định: ${MODEL_DEFAULTS[provider]}`;
  $('#model-hint').textContent = `Để trống sẽ dùng "${MODEL_DEFAULTS[provider]}"`;

  const customSection = $('#custom-gateway-section');
  if (provider === 'custom') {
    customSection.classList.remove('hidden');
    updateFormatHints();
  } else {
    customSection.classList.add('hidden');
  }
}

function updateFormatHints() {
  const fmt = $('#api-format').value;
  if (fmt === 'anthropic') {
    $('#endpoint-path').placeholder = '/v1/messages';
  } else {
    $('#endpoint-path').placeholder = '/v1/chat/completions';
  }
}

async function save() {
  const provider = getProvider();
  const apiKey = $('#api-key').value.trim();
  const model = $('#model').value.trim();
  const systemPrompt = $('#system-prompt').value.trim();
  const baseUrl = $('#base-url').value.trim();
  const endpointPath = $('#endpoint-path').value.trim();
  const authScheme = $('#auth-scheme').value.trim();
  const apiFormat = $('#api-format').value;
  const lookupMode = document.querySelector('input[name="lookupMode"]:checked')?.value || 'detail';
  const showSelectionIcon = $('#show-selection-icon').checked;
  const indexPdfVisuals = $('#index-pdf-visuals').checked;
  const quickToastSettings = getQuickToastSettings();

  if (!apiKey) {
    showStatus('Vui lòng nhập API key', 'error');
    return;
  }

  if (provider === 'custom' && !baseUrl) {
    showStatus('Custom Gateway cần Base URL', 'error');
    return;
  }

  await chrome.storage.sync.set({
    provider, apiKey, model, systemPrompt,
    baseUrl, endpointPath, authScheme, apiFormat,
    lookupMode,
    showSelectionIcon,
    indexPdfVisuals,
    ...quickToastSettings
  });
  showStatus(`✓ Đã lưu cấu hình (provider: ${provider}, mode: ${lookupMode})`, 'success');
}

function setQuickToastSettings(cfg) {
  $('#quick-toast-style-enabled').checked = cfg.quickToastStyleEnabled === true;
  $('#quick-toast-bg-color').value = normalizeHexColor(cfg.quickToastBackgroundColor, QUICK_TOAST_DEFAULTS.backgroundColor);
  $('#quick-toast-text-color').value = normalizeHexColor(cfg.quickToastTextColor, QUICK_TOAST_DEFAULTS.textColor);
  $('#quick-toast-font-size').value = normalizeFontSize(cfg.quickToastFontSize, QUICK_TOAST_DEFAULTS.fontSize);
  $('#quick-toast-opacity').value = normalizeOpacity(cfg.quickToastOpacity, QUICK_TOAST_DEFAULTS.opacity);
  updateQuickToastPreview();
}

function getQuickToastSettings() {
  return {
    quickToastStyleEnabled: $('#quick-toast-style-enabled').checked,
    quickToastBackgroundColor: normalizeHexColor($('#quick-toast-bg-color').value, QUICK_TOAST_DEFAULTS.backgroundColor),
    quickToastTextColor: normalizeHexColor($('#quick-toast-text-color').value, QUICK_TOAST_DEFAULTS.textColor),
    quickToastFontSize: normalizeFontSize($('#quick-toast-font-size').value, QUICK_TOAST_DEFAULTS.fontSize),
    quickToastOpacity: normalizeOpacity($('#quick-toast-opacity').value, QUICK_TOAST_DEFAULTS.opacity)
  };
}

function updateQuickToastPreview() {
  const preview = $('#quick-toast-preview');
  if (!preview) return;

  const settings = getQuickToastSettings();
  const isCustom = settings.quickToastStyleEnabled;
  preview.style.background = isCustom
    ? hexToRgba(settings.quickToastBackgroundColor, settings.quickToastOpacity)
    : hexToRgba(QUICK_TOAST_DEFAULTS.backgroundColor, QUICK_TOAST_DEFAULTS.opacity);
  preview.style.color = isCustom ? settings.quickToastTextColor : QUICK_TOAST_DEFAULTS.textColor;
  preview.style.fontSize = `${settings.quickToastFontSize}px`;
}

function scheduleQuickToastSettingsSave() {
  clearTimeout(saveQuickToastTimer);
  saveQuickToastTimer = setTimeout(saveQuickToastSettings, 200);
}

async function saveQuickToastSettings() {
  clearTimeout(saveQuickToastTimer);
  await chrome.storage.sync.set(getQuickToastSettings());
}

function normalizeHexColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function normalizeFontSize(value, fallback) {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.min(48, Math.max(10, Math.round(size)));
}

function normalizeOpacity(value, fallback) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return fallback;
  return Math.min(1, Math.max(0.1, opacity));
}

function hexToRgba(hex, opacity) {
  const color = normalizeHexColor(hex, QUICK_TOAST_DEFAULTS.backgroundColor).slice(1);
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${normalizeOpacity(opacity, QUICK_TOAST_DEFAULTS.opacity)})`;
}

async function test() {
  await save();
  showStatus('Đang test kết nối...', 'success');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ASK_AI',
      question: 'Trả lời ngắn gọn: 2+2=?',
      context: ''
    });

    if (response?.ok) {
      showStatus(`✓ Kết nối thành công. Trả lời: ${response.answer.slice(0, 100)}`, 'success');
    } else {
      showStatus(`✗ ${response?.error || 'Lỗi không xác định'}`, 'error');
    }
  } catch (err) {
    showStatus(`✗ ${err.message}`, 'error');
  }
}

async function renderShortcuts() {
  const container = $('#shortcut-list');
  if (!container) return;

  const labels = {
    'lookup-selection': 'Tra cứu đoạn bôi đen',
    '_execute_action': 'Mở popup Study Assistant',
    'screenshot-lookup': 'Chụp vùng màn hình'
  };

  try {
    const commands = await chrome.commands.getAll();
    const interesting = commands.filter((cmd) => labels[cmd.name]);

    container.innerHTML = '';
    if (interesting.length === 0) {
      container.innerHTML = '<div class="shortcut-empty">Không đọc được danh sách phím tắt từ Chrome.</div>';
      return;
    }

    for (const cmd of interesting) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const shortcut = cmd.shortcut?.trim();
      row.innerHTML = `
        <div class="shortcut-meta">
          <div class="shortcut-name">${escapeHtml(labels[cmd.name])}</div>
          <div class="shortcut-id">${escapeHtml(cmd.name)}</div>
        </div>
        <div class="shortcut-value ${shortcut ? 'is-bound' : 'is-unbound'}">
          ${escapeHtml(shortcut || 'Chưa được gán')}
        </div>
      `;
      container.appendChild(row);
    }
  } catch (err) {
    container.innerHTML = `<div class="shortcut-empty">Không đọc được phím tắt: ${escapeHtml(err.message)}</div>`;
  }
}

async function handlePdfUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const indexPdfVisuals = $('#index-pdf-visuals').checked;
  const visualIndex = indexPdfVisuals ? getVisualIndexConfig() : { enabled: false };
  if (indexPdfVisuals && !visualIndex.apiKey) {
    showDocumentStatus('Bật phân tích ảnh/sơ đồ PDF cần API key.', 'error');
    $('#pdf-upload').value = '';
    return;
  }

  $('#pdf-upload').disabled = true;
  try {
    for (const file of files) {
      showDocumentStatus(`Đang đọc "${file.name}"...`, 'success');
      const doc = await importPdfFile(file, {
        visualIndex,
        onProgress: createPdfProgressHandler(file.name)
      });
      if (doc.status === 'ready') {
        showDocumentStatus(`✓ Đã index "${doc.name}" (${formatDocumentImportMeta(doc)})`, 'success');
      } else {
        showDocumentStatus(`⚠️ ${doc.name}: ${doc.error || 'Không đọc được PDF'}`, 'error');
      }
      await renderDocuments();
    }
  } catch (err) {
    showDocumentStatus(`⚠️ ${err.message}`, 'error');
  } finally {
    $('#pdf-upload').value = '';
    $('#pdf-upload').disabled = false;
  }
}

function getVisualIndexConfig() {
  return {
    enabled: true,
    provider: getProvider(),
    apiKey: $('#api-key').value.trim(),
    model: $('#model').value.trim(),
    baseUrl: $('#base-url').value.trim(),
    endpointPath: $('#endpoint-path').value.trim(),
    authScheme: $('#auth-scheme').value.trim(),
    apiFormat: $('#api-format').value
  };
}

function createPdfProgressHandler(fileName) {
  return ({ phase, pageNumber, pageCount }) => {
    if (!pageNumber || !pageCount) return;

    const label = {
      text: 'Đang trích text',
      'visual-render': 'Đang render trang PDF',
      'visual-ai': 'Đang AI đọc ảnh/sơ đồ'
    }[phase] || 'Đang đọc';
    showDocumentStatus(`${label} "${fileName}" (${pageNumber}/${pageCount})...`, 'success');
  };
}

async function handleDocumentListClick(event) {
  const btn = event.target.closest('[data-delete-document]');
  if (!btn) return;

  const documentId = btn.getAttribute('data-delete-document');
  btn.disabled = true;
  await deleteDocument(documentId);
  showDocumentStatus('Đã xóa tài liệu', 'success');
  await renderDocuments();
}

async function renderDocuments() {
  const list = $('#document-list');
  const docs = await listDocuments();
  list.innerHTML = '';

  if (docs.length === 0) {
    list.innerHTML = '<div class="document-empty">Chưa có tài liệu nào</div>';
    return;
  }

  for (const doc of docs) {
    const item = document.createElement('div');
    item.className = `document-item is-${doc.status}`;
    const meta = doc.status === 'ready'
      ? `${doc.pageCount || 0} trang · ${doc.chunkCount || 0} đoạn${formatVisualMeta(doc)} · ${formatFileSize(doc.size)}`
      : `${formatFileSize(doc.size)} · ${doc.error || 'Không đọc được PDF'}`;
    item.innerHTML = `
      <div class="document-meta">
        <div class="document-name">${escapeHtml(doc.name)}</div>
        <div class="document-sub">${escapeHtml(meta)}</div>
      </div>
      <div class="document-actions">
        <span class="document-badge">${doc.status === 'ready' ? 'Đã index' : 'Lỗi'}</span>
        <button type="button" data-delete-document="${escapeHtml(doc.id)}">Xóa</button>
      </div>
    `;
    list.appendChild(item);
  }
}

function formatDocumentImportMeta(doc) {
  return `${doc.pageCount || 0} trang, ${doc.chunkCount || 0} đoạn${formatVisualMeta(doc).replaceAll(' · ', ', ')}`;
}

function formatVisualMeta(doc) {
  if (!doc.visualIndexStatus || doc.visualIndexStatus === 'off') return '';
  const count = doc.visualChunkCount || 0;
  const errors = doc.visualErrorCount || 0;
  const errorText = errors > 0 ? `, lỗi ${errors} trang` : '';
  return ` · ${count} trang ảnh/OCR${errorText}`;
}

function showDocumentStatus(text, type) {
  const el = $('#document-status');
  el.textContent = text;
  el.className = `document-status ${type}`;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function openShortcutsPage() {
  await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

function showStatus(text, type) {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${type}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
