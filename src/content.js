// Study Assistant - Content Script

(() => {
  if (window.__studyAssistantInjected) return;
  window.__studyAssistantInjected = true;

  const LOOKUP_MODE_DETAIL = 'detail';
  const LOOKUP_MODE_QUICK = 'quick';
  const QUICK_IMAGE_PROMPT = 'Đọc nội dung trong ảnh. Nếu là câu trắc nghiệm, trả lời đáp án đúng ngắn gọn. Nếu không, trả lời ngắn gọn nhất có thể.';

  let floatingBtn = null;
  let resultPopup = null;
  let lastSelectionText = '';
  let screenshotState = null;
  let showSelectionIcon = true;

  initSelectionIconSetting();

  // === Floating button khi có text được chọn ===
  document.addEventListener('mouseup', (e) => {
    if (e.target.closest?.('.sa-floating-btn, .sa-result-popup, .sa-screenshot-overlay')) return;

    setTimeout(() => {
      if (!showSelectionIcon) {
        hideFloatingButton();
        return;
      }

      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';

      if (text.length > 1 && text.length < 5000) {
        lastSelectionText = text;
        showFloatingButton(e.clientX, e.clientY);
      } else {
        hideFloatingButton();
      }
    }, 10);
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest?.('.sa-floating-btn, .sa-result-popup, .sa-screenshot-overlay')) {
      hideFloatingButton();
    }
  });

  // === Listen message từ background / popup ===
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'LOOKUP_TEXT' || msg.type === 'SHOW_LOOKUP') {
      runLookup({ question: msg.text || '', mode: msg.mode });
    } else if (msg.type === 'LOOKUP_IMAGE') {
      runLookup({ question: msg.question || '', imageDataUrl: msg.imageDataUrl, mode: msg.mode });
    } else if (msg.type === 'START_SCREENSHOT_OVERLAY') {
      startScreenshotOverlay();
    } else if (msg.type === 'TOAST_ANSWER') {
      cornerToast(msg.text, msg.mode || 'info', msg.duration || 2500);
    }
  });

  function initSelectionIconSetting() {
    chrome.storage.sync.get(['showSelectionIcon'], (data) => {
      showSelectionIcon = data.showSelectionIcon !== false;
      if (!showSelectionIcon) hideFloatingButton();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes.showSelectionIcon) return;
      showSelectionIcon = changes.showSelectionIcon.newValue !== false;
      if (!showSelectionIcon) hideFloatingButton();
    });
  }

  // === Lookup flow ===
  async function runLookup({ question, imageDataUrl, mode }) {
    const resolvedMode = mode || await getLookupMode();
    if (resolvedMode === LOOKUP_MODE_QUICK) {
      await runQuickLookup({ question, imageDataUrl });
      return;
    }

    showResultPopup(question, imageDataUrl);
    await askBackground({ question, imageDataUrl });
  }

  async function getLookupMode() {
    try {
      const { lookupMode } = await chrome.storage.sync.get(['lookupMode']);
      return lookupMode === LOOKUP_MODE_QUICK ? LOOKUP_MODE_QUICK : LOOKUP_MODE_DETAIL;
    } catch (_) {
      return LOOKUP_MODE_DETAIL;
    }
  }

  async function runQuickLookup({ question, imageDataUrl }) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ASK_AI',
        question: imageDataUrl ? (question || QUICK_IMAGE_PROMPT) : buildQuickTextPrompt(question),
        context: '',
        imageDataUrl
      });

      if (!response?.ok) {
        showQuickFailureToast();
        return;
      }

      const answerLetter = getQuickAnswerLetter(response.answer);
      if (!answerLetter) {
        showQuickFailureToast();
        return;
      }

      cornerToast(answerLetter, 'success', 2500);
    } catch (err) {
      showQuickFailureToast();
    }
  }

  function buildQuickTextPrompt(text) {
    return `Đây là nội dung cần tra cứu nhanh. Nếu là câu trắc nghiệm, hãy chọn đúng một đáp án và trả lời theo dạng "ĐÁP ÁN: <chữ cái>". Nếu không phải trắc nghiệm, trả lời một câu thật ngắn.

NỘI DUNG:
${text}`;
  }

  function getQuickAnswerLetter(answer) {
    const text = String(answer || '').trim();
    const parsed = parseMultipleChoice(text);
    if (parsed.index >= 0) {
      return String.fromCharCode(65 + parsed.index);
    }

    return null;
  }

  function showQuickFailureToast() {
    cornerToast('F', 'fail', 1800);
  }

  async function askBackground({ question, imageDataUrl }) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ASK_AI',
        question: question || '',
        context: '',
        imageDataUrl
      });

      const answerEl = resultPopup.querySelector('.sa-answer');
      if (response?.ok) {
        answerEl.innerHTML = formatAnswer(response.answer);
      } else {
        answerEl.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(response?.error || 'Lỗi không xác định')}</div>`;
      }
    } catch (err) {
      const answerEl = resultPopup?.querySelector('.sa-answer');
      if (answerEl) {
        answerEl.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  // === Floating button ===
  function showFloatingButton(x, y) {
    if (!floatingBtn) {
      floatingBtn = document.createElement('div');
      floatingBtn.className = 'sa-floating-btn';
      floatingBtn.title = 'Tra cứu với Study Assistant';
      floatingBtn.textContent = '🎓';
      floatingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (lastSelectionText) {
          runLookup({ question: lastSelectionText });
          hideFloatingButton();
        }
      });
      document.body.appendChild(floatingBtn);
    }
    const offset = 8;
    floatingBtn.style.left = `${x + offset + window.scrollX}px`;
    floatingBtn.style.top = `${y + offset + window.scrollY}px`;
    floatingBtn.style.display = 'flex';
  }

  function hideFloatingButton() {
    if (floatingBtn) floatingBtn.style.display = 'none';
  }

  // === Result popup ===
  function showResultPopup(question, imageDataUrl) {
    if (!resultPopup) {
      resultPopup = document.createElement('div');
      resultPopup.className = 'sa-result-popup';
      resultPopup.innerHTML = `
        <div class="sa-header">
          <span class="sa-title">🎓 Study Assistant</span>
          <div class="sa-actions">
            <button class="sa-btn-copy" title="Copy đáp án">📋</button>
            <button class="sa-btn-close" title="Đóng">×</button>
          </div>
        </div>
        <div class="sa-question"></div>
        <div class="sa-answer">
          <div class="sa-loader">Đang phân tích...</div>
        </div>
      `;
      document.body.appendChild(resultPopup);

      resultPopup.querySelector('.sa-btn-close').addEventListener('click', () => {
        resultPopup.style.display = 'none';
      });
      resultPopup.querySelector('.sa-btn-copy').addEventListener('click', () => {
        const text = resultPopup.querySelector('.sa-answer').innerText;
        navigator.clipboard.writeText(text);
        const btn = resultPopup.querySelector('.sa-btn-copy');
        btn.textContent = '✓';
        setTimeout(() => (btn.textContent = '📋'), 1500);
      });
      makeDraggable(resultPopup, resultPopup.querySelector('.sa-header'));
    }

    const qEl = resultPopup.querySelector('.sa-question');
    qEl.innerHTML = '';
    if (imageDataUrl) {
      const img = document.createElement('img');
      img.className = 'sa-thumb';
      img.src = imageDataUrl;
      qEl.appendChild(img);
    }
    if (question) {
      const span = document.createElement('div');
      span.textContent = question;
      qEl.appendChild(span);
    }

    resultPopup.querySelector('.sa-answer').innerHTML = '<div class="sa-loader">Đang phân tích...</div>';
    resultPopup.style.display = 'block';
  }

  // === Screenshot overlay ===
  function startScreenshotOverlay() {
    if (screenshotState) return;

    const overlay = document.createElement('div');
    overlay.className = 'sa-screenshot-overlay';
    document.body.appendChild(overlay);

    const rect = document.createElement('div');
    rect.className = 'sa-screenshot-rect';
    rect.style.display = 'none';
    document.body.appendChild(rect);

    screenshotState = { overlay, rect, startX: 0, startY: 0, drawing: false, finalRect: null };

    overlay.addEventListener('mousedown', onSStart);
    document.addEventListener('mousemove', onSMove);
    document.addEventListener('mouseup', onSEnd);
    document.addEventListener('keydown', onSKey, true);
  }

  function onSStart(e) {
    e.preventDefault();
    screenshotState.startX = e.clientX;
    screenshotState.startY = e.clientY;
    screenshotState.drawing = true;
    const r = screenshotState.rect;
    r.style.display = 'block';
    r.style.left = e.clientX + 'px';
    r.style.top = e.clientY + 'px';
    r.style.width = '0px';
    r.style.height = '0px';
  }

  function onSMove(e) {
    if (!screenshotState?.drawing) return;
    const x = Math.min(e.clientX, screenshotState.startX);
    const y = Math.min(e.clientY, screenshotState.startY);
    const w = Math.abs(e.clientX - screenshotState.startX);
    const h = Math.abs(e.clientY - screenshotState.startY);
    Object.assign(screenshotState.rect.style, {
      left: x + 'px',
      top: y + 'px',
      width: w + 'px',
      height: h + 'px'
    });
  }

  function onSEnd(e) {
    if (!screenshotState?.drawing) return;
    screenshotState.drawing = false;

    const x = Math.min(e.clientX, screenshotState.startX);
    const y = Math.min(e.clientY, screenshotState.startY);
    const w = Math.abs(e.clientX - screenshotState.startX);
    const h = Math.abs(e.clientY - screenshotState.startY);

    if (w < 8 || h < 8) {
      cleanupScreenshot();
      return;
    }

    screenshotState.finalRect = { x, y, width: w, height: h };
    confirmScreenshot();
  }

  function onSKey(e) {
    if (!screenshotState) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanupScreenshot();
    }
  }

  async function confirmScreenshot() {
    const rect = screenshotState.finalRect;
    const dpr = window.devicePixelRatio || 1;

    screenshotState.overlay.style.display = 'none';
    screenshotState.rect.style.display = 'none';

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_AND_CROP',
        rect,
        dpr
      });

      cleanupScreenshot();

      if (response?.ok) {
        await runLookup({ question: '', imageDataUrl: response.dataUrl });
      } else {
        await showCaptureError(response?.error || 'Không chụp được');
      }
    } catch (err) {
      cleanupScreenshot();
      await showCaptureError(err.message);
    }
  }

  async function showCaptureError(message) {
    if (await getLookupMode() === LOOKUP_MODE_QUICK) {
      showQuickFailureToast();
      return;
    }

    showResultPopup('Lỗi chụp màn hình');
    const ans = resultPopup.querySelector('.sa-answer');
    ans.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(message)}</div>`;
  }

  function cleanupScreenshot() {
    if (!screenshotState) return;
    screenshotState.overlay.remove();
    screenshotState.rect.remove();
    document.removeEventListener('mousemove', onSMove);
    document.removeEventListener('mouseup', onSEnd);
    document.removeEventListener('keydown', onSKey, true);
    screenshotState = null;
  }

  // === Toast ===
  function cornerToast(text, type = 'success', duration = 1000) {
    const tip = document.createElement('div');
    tip.className = 'sa-corner-toast';
    if (type === 'success') {
      tip.style.background = 'rgba(46, 204, 113, 0.95)';
      tip.style.color = 'white';
    } else if (type === 'info') {
      tip.style.background = 'rgba(102, 126, 234, 0.95)';
      tip.style.color = 'white';
    } else if (type === 'fail') {
      tip.style.background = 'rgba(238, 240, 243, 0.98)';
      tip.style.color = '#555';
    } else {
      tip.style.background = 'rgba(192, 57, 43, 0.95)';
      tip.style.color = 'white';
    }
    tip.textContent = text;
    document.body.appendChild(tip);
    if (duration > 0) setTimeout(() => tip.remove(), duration);
    return tip;
  }

  function parseMultipleChoice(text) {
    const m = /(?:Đ|D|đ|d)[aá]p\s*[aá]n\s*[:\-]\s*([A-H])/i.exec(text)
      || /^\s*([A-H])(?:[\.\)]|\s|$)/i.exec(text);
    let index = -1;
    if (m) {
      index = m[1].toUpperCase().charCodeAt(0) - 65;
    }
    return { index };
  }

  // === Helpers ===
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

  function makeDraggable(el, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      handle.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = `${e.clientX - offsetX}px`;
      el.style.top = `${e.clientY - offsetY}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
      handle.style.cursor = 'grab';
    });
  }
})();
