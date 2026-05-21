// Study Assistant - Options page

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

init();

async function init() {
  const cfg = await chrome.storage.sync.get([
    'provider', 'apiKey', 'model', 'systemPrompt',
    'baseUrl', 'authScheme', 'endpointPath', 'apiFormat', 'autoTick'
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
  $('#auto-tick').checked = cfg.autoTick !== false; // default true

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
    autoTick: $('#auto-tick').checked
  });
  showStatus(`✓ Đã lưu cấu hình (provider: ${provider})`, 'success');
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
    'screenshot-lookup': 'Chụp vùng màn hình',
    'scan-question': 'Tra cứu nhanh (toast)'
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
