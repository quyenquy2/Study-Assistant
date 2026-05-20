// Study Assistant - Popup script

const $ = (sel) => document.querySelector(sel);

const questionInput = $('#question-input');
const askBtn = $('#ask-btn');
const answerSection = $('#answer-section');
const answerContent = $('#answer-content');
const copyBtn = $('#copy-btn');
const historyList = $('#history-list');
const clearHistoryBtn = $('#clear-history');
const noKeyWarning = $('#no-key-warning');

init();

async function init() {
  // Kiểm tra API key
  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    noKeyWarning.classList.remove('hidden');
  }

  // Pre-fill bằng selection hiện tại từ tab active
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() ?? ''
      });
      const sel = (result?.result || '').trim();
      if (sel) questionInput.value = sel;
    }
  } catch (_) { /* không thể inject vào trang chrome:// */ }

  loadHistory();

  askBtn.addEventListener('click', handleAsk);
  questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAsk();
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(answerContent.innerText);
    copyBtn.textContent = '✓';
    setTimeout(() => (copyBtn.textContent = '📋'), 1500);
  });

  $('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#link-options')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  $('#screenshot-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const url = tab.url || '';
    if (/^(chrome|edge|about|chrome-extension|moz-extension|view-source):/i.test(url)
        || url.startsWith('https://chromewebstore.google.com')) {
      alert('Không thể chụp trên trang nội bộ của trình duyệt. Hãy mở một trang web bình thường (https://...)');
      return;
    }

    try {
      await sendOrInject(tab.id, { type: 'START_SCREENSHOT_OVERLAY' });
      window.close();
    } catch (e) {
      alert('Không thể chụp ảnh: ' + e.message);
    }
  });

  clearHistoryBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
    loadHistory();
  });
}

async function handleAsk() {
  const question = questionInput.value.trim();
  if (!question) return;

  askBtn.disabled = true;
  askBtn.textContent = 'Đang phân tích...';
  answerSection.classList.remove('hidden');
  answerContent.innerHTML = '<em style="color:#888">Đang phân tích...</em>';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ASK_AI',
      question,
      context: ''
    });

    if (response?.ok) {
      answerContent.innerHTML = formatAnswer(response.answer);
    } else {
      answerContent.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(response?.error || 'Lỗi không xác định')}</div>`;
    }
  } catch (err) {
    answerContent.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(err.message)}</div>`;
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = 'Tra cứu (Ctrl+Enter)';
    loadHistory();
  }
}

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  const history = response?.history || [];

  historyList.innerHTML = '';
  if (history.length === 0) {
    historyList.innerHTML = '<li style="color:#aaa;font-style:italic">Chưa có lịch sử</li>';
    return;
  }

  history.slice(0, 10).forEach((item) => {
    const li = document.createElement('li');
    const preview = item.question.length > 60 ? item.question.slice(0, 60) + '…' : item.question;
    const time = new Date(item.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<div>${escapeHtml(preview)}</div><div class="ts">${time}</div>`;
    li.addEventListener('click', () => {
      questionInput.value = item.question;
      answerSection.classList.remove('hidden');
      answerContent.innerHTML = formatAnswer(item.answer);
    });
    historyList.appendChild(li);
  });
}

function formatAnswer(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendOrInject(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // Content script chưa load - inject thủ công
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['src/content.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content.js']
    });
    await new Promise((r) => setTimeout(r, 100));
    await chrome.tabs.sendMessage(tabId, message);
  }
}
