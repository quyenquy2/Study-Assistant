// Study Assistant - Content Script

(() => {
  if (window.__studyAssistantInjected) return;
  window.__studyAssistantInjected = true;

  let floatingBtn = null;
  let resultPopup = null;
  let lastSelectionText = '';
  let screenshotState = null;

  // === Floating button khi có text được chọn ===
  document.addEventListener('mouseup', (e) => {
    if (e.target.closest?.('.sa-floating-btn, .sa-result-popup, .sa-screenshot-overlay, .sa-screenshot-toolbar')) return;

    setTimeout(() => {
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
    if (!e.target.closest?.('.sa-floating-btn, .sa-result-popup, .sa-screenshot-overlay, .sa-screenshot-toolbar')) {
      hideFloatingButton();
    }
  });

  // === Listen message từ background ===
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SHOW_LOOKUP') {
      showResultPopup(msg.text);
      askBackground({ question: msg.text });
    } else if (msg.type === 'START_SCREENSHOT_OVERLAY') {
      startScreenshotOverlay();
    } else if (msg.type === 'QUICK_LOOKUP_TOAST') {
      quickLookupToast(msg.text);
    } else if (msg.type === 'TOAST_ANSWER') {
      flashMessage(msg.text, msg.mode || 'info', msg.duration || 2500);
    }
  });

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
          showResultPopup(lastSelectionText);
          askBackground({ question: lastSelectionText });
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
            <button class="sa-btn-close" title="Đóng">✕</button>
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

  // === Screenshot overlay ===
  function startScreenshotOverlay() {
    if (screenshotState) return;

    const overlay = document.createElement('div');
    overlay.className = 'sa-screenshot-overlay';
    overlay.innerHTML = `<div class="sa-hint">📷 Kéo chuột để chọn vùng cần tra cứu · Esc để hủy</div>`;
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
    if (e.target.closest('.sa-screenshot-toolbar')) return;
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
    removeToolbar();
  }

  function onSMove(e) {
    if (!screenshotState?.drawing) return;
    const x = Math.min(e.clientX, screenshotState.startX);
    const y = Math.min(e.clientY, screenshotState.startY);
    const w = Math.abs(e.clientX - screenshotState.startX);
    const h = Math.abs(e.clientY - screenshotState.startY);
    Object.assign(screenshotState.rect.style, {
      left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px'
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
      // quá nhỏ - hủy
      cleanupScreenshot();
      return;
    }

    screenshotState.finalRect = { x, y, width: w, height: h };
    showScreenshotToolbar(x + w, y + h);
  }

  function onSKey(e) {
    if (!screenshotState) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanupScreenshot();
    } else if (e.key === 'Enter' && screenshotState.finalRect) {
      e.preventDefault();
      e.stopPropagation();
      confirmScreenshot();
    }
  }

  function showScreenshotToolbar(x, y) {
    removeToolbar();
    const tb = document.createElement('div');
    tb.className = 'sa-screenshot-toolbar';
    tb.innerHTML = `
      <button class="sa-cancel">Hủy (Esc)</button>
      <button class="sa-confirm">✓ Tra cứu (Enter)</button>
    `;
    document.body.appendChild(tb);

    // đặt toolbar phía dưới-phải vùng chọn, fallback nếu tràn màn hình
    const tbRect = tb.getBoundingClientRect();
    let tx = x - tbRect.width;
    let ty = y + 8;
    if (ty + tbRect.height > window.innerHeight) ty = y - tbRect.height - 8;
    if (tx < 8) tx = 8;
    tb.style.left = tx + 'px';
    tb.style.top = ty + 'px';

    tb.querySelector('.sa-cancel').addEventListener('click', cleanupScreenshot);
    tb.querySelector('.sa-confirm').addEventListener('click', confirmScreenshot);
    screenshotState.toolbar = tb;
  }

  function removeToolbar() {
    if (screenshotState?.toolbar) {
      screenshotState.toolbar.remove();
      screenshotState.toolbar = null;
    }
  }

  async function confirmScreenshot() {
    const rect = screenshotState.finalRect;
    const dpr = window.devicePixelRatio || 1;

    // Ẩn overlay & rect trước khi chụp để không bị lẫn vào ảnh
    screenshotState.overlay.style.display = 'none';
    screenshotState.rect.style.display = 'none';
    removeToolbar();

    // Đợi 1 frame để repaint
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_AND_CROP',
        rect,
        dpr
      });

      cleanupScreenshot();

      if (response?.ok) {
        showResultPopup('', response.dataUrl);
        askBackground({ question: '', imageDataUrl: response.dataUrl });
      } else {
        showResultPopup('Lỗi chụp màn hình');
        const ans = resultPopup.querySelector('.sa-answer');
        ans.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(response?.error || 'Không chụp được')}</div>`;
      }
    } catch (err) {
      cleanupScreenshot();
      showResultPopup('Lỗi chụp màn hình');
      const ans = resultPopup.querySelector('.sa-answer');
      ans.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(err.message)}</div>`;
    }
  }

  function cleanupScreenshot() {
    if (!screenshotState) return;
    screenshotState.overlay.remove();
    screenshotState.rect.remove();
    removeToolbar();
    document.removeEventListener('mousemove', onSMove);
    document.removeEventListener('mouseup', onSEnd);
    document.removeEventListener('keydown', onSKey, true);
    screenshotState = null;
  }

  // === Scan mode: dùng text được bôi đen làm anchor ===
  let scanState = null;

  function startScanMode(anchorText) {
    // Nếu có text được bôi đen, dùng nó làm anchor để tìm câu hỏi luôn
    const sel = window.getSelection();
    let anchor = (anchorText || sel?.toString() || '').trim();

    // Nếu không có selection, fallback sang chế độ click cũ
    if (!anchor) {
      startScanModeInteractive();
      return;
    }

    // Tìm element gần nhất chứa anchor text
    const anchorEl = findAnchorElement(anchor);
    if (!anchorEl) {
      flashMessage('❌ Không tìm thấy câu hỏi chứa: ' + anchor.slice(0, 40));
      return;
    }

    // Tìm container câu hỏi (có ≥ 2 input radio/checkbox) gần anchor nhất
    const container = findQuestionContainerFrom(anchorEl);
    if (!container) {
      flashMessage('❌ Không thấy câu hỏi trắc nghiệm gần "' + anchor.slice(0, 40) + '"');
      return;
    }

    // Bỏ bôi đen rồi xử lý câu hỏi
    sel?.removeAllRanges();

    const data = extractQuestion(container);
    if (!data || data.options.length < 2) {
      flashMessage('❌ Không trích xuất được đáp án');
      return;
    }

    askForMultipleChoiceSilent(data, container);
  }

  // Mode cũ (giữ lại làm fallback): di chuột → click
  function startScanModeInteractive() {
    if (scanState) return;
    const hint = document.createElement('div');
    hint.className = 'sa-scan-hint';
    hint.textContent = '🔍 Bôi đen câu hỏi rồi nhấn Ctrl+Shift+Q. Hoặc di chuột → click · Esc để hủy';
    document.body.appendChild(hint);

    scanState = { hint, currentTarget: null };
    document.addEventListener('mousemove', onScanMove);
    document.addEventListener('click', onScanClick, true);
    document.addEventListener('keydown', onScanKey, true);
  }

  function flashMessage(text, type, duration = 2500) {
    const tip = document.createElement('div');
    tip.className = 'sa-scan-hint';
    if (type === 'success') {
      tip.style.background = 'rgba(46, 204, 113, 0.95)';
    } else if (type === 'info') {
      tip.style.background = 'rgba(102, 126, 234, 0.95)';
    } else {
      tip.style.background = 'rgba(192, 57, 43, 0.95)';
    }
    tip.textContent = text;
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), duration);
  }

  async function quickLookupToast(selectionText) {
    if (!selectionText) return;
    const prompt = `Đây là câu hỏi trắc nghiệm (có thể bao gồm cả các đáp án A, B, C, D...). Hãy chọn ĐÚNG MỘT đáp án.

NỘI DUNG:
${selectionText}

Trả lời theo định dạng CHÍNH XÁC sau (không thêm gì khác):
ĐÁP ÁN: <chữ cái A/B/C/D...>
GIẢI THÍCH: <giải thích ngắn gọn>`;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ASK_AI',
        question: prompt,
        context: ''
      });

      if (!response?.ok) {
        cornerToast('⚠️ ' + (response?.error || 'Lỗi không xác định'), 'error');
        return;
      }

      const parsed = parseMultipleChoice(response.answer);
      if (parsed.index < 0) {
        const short = response.answer.slice(0, 100).replace(/\s+/g, ' ');
        cornerToast(short, 'success');
        return;
      }

      const letter = String.fromCharCode(65 + parsed.index);
      cornerToast(letter, 'success');
    } catch (err) {
      cornerToast('⚠️ ' + err.message, 'error');
    }
  }

  // Toast ở góc dưới-phải, dùng cho Ctrl+Shift+Q
  function cornerToast(text, type = 'success', duration = 1000) {
    const tip = document.createElement('div');
    tip.className = 'sa-corner-toast';
    if (type === 'success') {
      tip.style.background = 'rgba(46, 204, 113, 0.95)';
    } else {
      tip.style.background = 'rgba(192, 57, 43, 0.95)';
    }
    tip.textContent = text;
    document.body.appendChild(tip);
    setTimeout(() => tip.remove(), duration);
  }

  // Click element robust: input thật thì set checked + dispatch,
  // custom thì dispatch full pointer/mouse events để React/Vue bắt được.
  function robustClick(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });

      if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) {
        if (!el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        el.click();
        return true;
      }

      el.click();

      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true,
          clientX: x, clientY: y, button: 0
        }));
      });

      return true;
    } catch (e) {
      console.warn('robustClick failed', e);
      return false;
    }
  }

  // Tìm element chứa anchor text - dùng TreeWalker
  function findAnchorElement(text) {
    if (!text) return null;
    const lowerText = text.toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (node.nodeValue.toLowerCase().includes(lowerText)) {
          // Bỏ qua các node trong UI của extension
          let p = node.parentElement;
          while (p) {
            if (p.classList && (
              p.classList.contains('sa-result-popup') ||
              p.classList.contains('sa-floating-btn') ||
              p.classList.contains('sa-scan-hint')
            )) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    });
    const found = walker.nextNode();
    return found?.parentElement || null;
  }

  // Đi lên cây DOM tìm container có ≥ 2 lựa chọn (input thật hoặc custom radio).
  function findQuestionContainerFrom(el) {
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 15) {
      if (countOptionElements(node) >= 2) return node;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  // Đếm số đáp án có thể có trong container, hỗ trợ nhiều kiểu UI
  function countOptionElements(container) {
    if (!container?.querySelectorAll) return 0;
    return findOptionElements(container).length;
  }

  // Tìm tất cả element là "đáp án" trong container.
  // Trả về array { element: clickable, text: nhãn }
  function findOptionElements(container) {
    // 1) Input radio/checkbox thật
    const inputs = Array.from(container.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    if (inputs.length >= 2) {
      return inputs.map((input) => ({
        element: input,
        text: getInputLabel(input)
      }));
    }

    // 2) ARIA role="radio" hoặc role="option"
    const ariaRadios = Array.from(container.querySelectorAll('[role="radio"], [role="option"], [role="menuitemradio"]'));
    if (ariaRadios.length >= 2) {
      return ariaRadios.map((el) => ({
        element: el,
        text: el.innerText?.trim() || el.getAttribute('aria-label') || ''
      }));
    }

    // 3) Class name chứa "option", "answer", "choice"
    const classMatches = Array.from(container.querySelectorAll(
      '[class*="option"], [class*="answer"], [class*="choice"], [class*="Option"], [class*="Answer"], [class*="Choice"]'
    )).filter((el) => {
      const txt = el.innerText?.trim() || '';
      return txt.length > 0 && txt.length < 500 && /^\s*[A-Da-d][\.\)\:]/.test(txt);
    });
    if (classMatches.length >= 2) {
      return classMatches.map((el) => ({
        element: el,
        text: el.innerText.trim()
      }));
    }

    // 4) Pattern text "A. ... B. ... C. ... D. ..."
    // Tìm các text node hoặc element bắt đầu bằng "A.", "B.", "C.", "D."
    const candidates = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (node.children.length > 5) return NodeFilter.FILTER_SKIP;
        const t = (node.innerText || '').trim();
        if (/^[A-Ha-h][\.\)\:]\s+\S/.test(t) && t.length < 500) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      // Bỏ qua nếu element là con của candidate đã có
      const isChildOfExisting = candidates.some((c) => c.element.contains(n));
      if (!isChildOfExisting) {
        candidates.push({ element: n, text: n.innerText.trim() });
      }
    }
    if (candidates.length >= 2) {
      return candidates;
    }

    return [];
  }

  function getInputLabel(input) {
    let labelText = '';
    if (input.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lbl) labelText = lbl.innerText.trim();
    }
    if (!labelText) {
      const parentLabel = input.closest('label');
      if (parentLabel) labelText = parentLabel.innerText.trim();
    }
    if (!labelText) {
      const next = input.nextElementSibling || input.parentElement?.nextElementSibling;
      if (next) labelText = next.innerText?.trim() || '';
    }
    if (!labelText) labelText = input.value || '(không có nhãn)';
    return labelText;
  }

  function onScanMove(e) {
    if (!scanState) return;
    const container = findQuestionContainer(e.target);
    if (container !== scanState.currentTarget) {
      if (scanState.currentTarget) {
        scanState.currentTarget.classList.remove('sa-scan-highlight');
      }
      if (container) {
        container.classList.add('sa-scan-highlight');
      }
      scanState.currentTarget = container;
    }
  }

  function onScanClick(e) {
    if (!scanState?.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();

    const container = scanState.currentTarget;
    const data = extractQuestion(container);
    cleanupScan();

    if (!data || data.options.length < 2) {
      showResultPopup('Không phát hiện được câu hỏi trắc nghiệm');
      askBackground({ question: data?.question || container.innerText.slice(0, 1000) });
      return;
    }

    showResultPopup(formatQuestionPreview(data));
    askForMultipleChoice(data, container);
  }

  function onScanKey(e) {
    if (e.key === 'Escape' && scanState) {
      e.preventDefault();
      e.stopPropagation();
      cleanupScan();
    }
  }

  function cleanupScan() {
    if (!scanState) return;
    if (scanState.currentTarget) {
      scanState.currentTarget.classList.remove('sa-scan-highlight');
    }
    scanState.hint.remove();
    document.removeEventListener('mousemove', onScanMove);
    document.removeEventListener('click', onScanClick, true);
    document.removeEventListener('keydown', onScanKey, true);
    scanState = null;
  }

  // Tìm container nhỏ nhất chứa câu hỏi + ít nhất 2 lựa chọn (input thật hoặc custom)
  function findQuestionContainer(el) {
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 10) {
      if (countOptionElements(node) >= 2) {
        return node;
      }
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  function extractQuestion(container) {
    const opts = findOptionElements(container);
    if (opts.length < 2) return null;

    const options = opts.map((o, idx) => ({
      index: idx,
      text: o.text || `Đáp án ${idx + 1}`,
      element: o.element
    }));

    const allText = container.innerText.trim();
    const optionText = options.map((o) => o.text).join('\n');
    let questionText = allText.replace(optionText, '').trim();
    if (!questionText || questionText.length < 5) {
      questionText = allText;
    }

    return { question: questionText, options };
  }

  function formatQuestionPreview(data) {
    const opts = data.options.map((o, i) =>
      `${String.fromCharCode(65 + i)}. ${o.text}`
    ).join('\n');
    return `${data.question}\n\n${opts}`;
  }

  async function askForMultipleChoice(data, container) {
    const optionsList = data.options.map((o, i) =>
      `${String.fromCharCode(65 + i)}. ${o.text}`
    ).join('\n');

    const prompt = `Đây là câu hỏi trắc nghiệm. Hãy chọn ĐÚNG MỘT đáp án.

CÂU HỎI: ${data.question}

CÁC ĐÁP ÁN:
${optionsList}

Hãy trả lời theo định dạng CHÍNH XÁC sau (không thêm gì):
ĐÁP ÁN: <chữ cái A/B/C/D...>
GIẢI THÍCH: <giải thích ngắn gọn>`;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ASK_AI',
        question: prompt,
        context: ''
      });

      const answerEl = resultPopup.querySelector('.sa-answer');
      if (response?.ok) {
        const parsed = parseMultipleChoice(response.answer);
        if (parsed.index >= 0 && parsed.index < data.options.length) {
          const correctInput = data.options[parsed.index].element;
          highlightCorrectAnswer(correctInput);
          answerEl.innerHTML = renderAnswer(data, parsed);

          // Auto-tick nếu user đã bật trong Options (default: bật)
          const { autoTick } = await chrome.storage.sync.get(['autoTick']);
          if (autoTick !== false) {
            try {
              correctInput.click();
            } catch (_) {}
          }

          attachTickButton(answerEl, correctInput, autoTick !== false);
        } else {
          answerEl.innerHTML = formatAnswer(response.answer);
        }
      } else {
        answerEl.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(response?.error || 'Lỗi không xác định')}</div>`;
      }
    } catch (err) {
      const answerEl = resultPopup?.querySelector('.sa-answer');
      if (answerEl) answerEl.innerHTML = `<div class="sa-error">⚠️ ${escapeHtml(err.message)}</div>`;
    }
  }

  function parseMultipleChoice(text) {
    // Tìm "ĐÁP ÁN: X" hoặc "Đáp án: X"
    const m = /[ĐD]áp\s*[áa]n\s*[:\-]\s*([A-Z])/i.exec(text);
    let index = -1;
    if (m) {
      index = m[1].toUpperCase().charCodeAt(0) - 65;
    }
    // Tìm phần giải thích
    const exp = /[Gg]iải\s*thích\s*[:\-]\s*([\s\S]+)/i.exec(text);
    const explanation = exp ? exp[1].trim() : text;
    return { index, explanation };
  }

  function renderAnswer(data, parsed) {
    const letter = String.fromCharCode(65 + parsed.index);
    const opt = data.options[parsed.index];
    return `
      <div style="margin-bottom:10px;padding:8px;background:#e8f5e9;border-left:3px solid #2ecc71;border-radius:4px">
        <strong>✓ Đáp án: ${letter}.</strong> ${escapeHtml(opt.text)}
      </div>
      <div style="margin-bottom:10px">${formatAnswer(parsed.explanation)}</div>
    `;
  }

  function attachTickButton(answerEl, inputElement, alreadyTicked) {
    const btn = document.createElement('button');
    btn.style.cssText = 'padding:8px 12px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;width:100%;margin-top:6px';
    if (alreadyTicked) {
      btn.textContent = '✓ Đã tick (click để tick lại)';
    } else {
      btn.textContent = '✓ Tự tick đáp án này';
    }
    btn.addEventListener('click', () => {
      try {
        inputElement.click();
        btn.textContent = '✓ Đã tick';
        btn.style.opacity = '0.6';
      } catch (e) {
        btn.textContent = '⚠️ Không tick được';
      }
    });
    answerEl.appendChild(btn);
  }

  function highlightCorrectAnswer(input) {
    // Highlight container của input (label hoặc parent)
    const target = input.closest('label') || input.parentElement || input;
    target.classList.add('sa-correct-answer');

    // Thêm badge "ĐÚNG"
    const existingBadge = target.querySelector('.sa-correct-badge');
    if (!existingBadge) {
      const badge = document.createElement('span');
      badge.className = 'sa-correct-badge';
      badge.textContent = 'ĐÚNG';
      target.appendChild(badge);
    }

    // Tự động xóa highlight sau 30s
    setTimeout(() => {
      target.classList.remove('sa-correct-answer');
      const b = target.querySelector('.sa-correct-badge');
      if (b) b.remove();
    }, 30000);
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
