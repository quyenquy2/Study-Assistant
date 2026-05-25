// Study Assistant - Background Service Worker
// Xử lý: context menu, keyboard shortcut, gọi API AI, chụp ảnh màn hình

import { askAI } from './api.js';

const CONTEXT_MENU_LOOKUP = 'study-assistant-lookup';
const CONTEXT_MENU_SCREENSHOT = 'study-assistant-screenshot';

// === Setup khi cài đặt ===
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    createContextMenus();
  });

  chrome.storage.sync.get(['provider', 'apiKey', 'lookupMode', 'showSelectionIcon'], (data) => {
    const defaults = {};
    if (!data.lookupMode) {
      defaults.lookupMode = 'detail';
    }
    if (data.showSelectionIcon === undefined) {
      defaults.showSelectionIcon = true;
    }
    if (Object.keys(defaults).length > 0) {
      chrome.storage.sync.set(defaults);
    }
    if (!data.apiKey) {
      chrome.runtime.openOptionsPage();
    }
  });
});

function createContextMenus() {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_LOOKUP,
    title: 'Tra cứu đoạn bôi đen: "%s"',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SCREENSHOT,
    title: '📷 Chụp vùng màn hình để tra cứu',
    contexts: ['page', 'image']
  });
}

// === Context menu click ===
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === CONTEXT_MENU_LOOKUP && info.selectionText) {
    await triggerLookupInTab(tab.id, info.selectionText);
  } else if (info.menuItemId === CONTEXT_MENU_SCREENSHOT) {
    await startScreenshotMode(tab.id);
  }
});

// === Keyboard shortcuts ===
chrome.commands.onCommand.addListener(async (command, commandTab) => {
  try {
    const tab = commandTab?.id
      ? commandTab
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) {
      console.warn('[Study Assistant] No active tab for command', command);
      return;
    }

    if (command === 'lookup-selection') {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection()?.toString() ?? ''
        });
        const text = (result?.result || '').trim();
        if (text) await triggerLookupInTab(tab.id, text);
      } catch (e) {
        console.warn('[Study Assistant] lookup-selection failed:', e.message);
      }
    } else if (command === 'screenshot-lookup') {
      await startScreenshotMode(tab.id);
    }
  } catch (e) {
    console.warn('[Study Assistant] command handler failed:', e.message);
  }
});

// === Message từ content script / popup ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ASK_AI') {
    handleAsk(msg.question, msg.context, msg.imageDataUrl).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (msg.type === 'GET_HISTORY') {
    chrome.storage.local.get(['history'], (data) => {
      sendResponse({ ok: true, history: data.history || [] });
    });
    return true;
  }

  if (msg.type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ history: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'START_SCREENSHOT') {
    const tabId = sender.tab?.id;
    if (tabId) startScreenshotMode(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'CAPTURE_AND_CROP') {
    captureAndCrop(sender.tab?.windowId, msg.rect, msg.dpr).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
});

// === Helpers ===
async function triggerLookupInTab(tabId, selectionText) {
  try {
    await sendOrInject(tabId, {
      type: 'LOOKUP_TEXT',
      text: selectionText
    });
  } catch (e) {
    console.warn('Cannot inject into this page:', e.message);
  }
}

async function startScreenshotMode(tabId) {
  try {
    await sendOrInject(tabId, { type: 'START_SCREENSHOT_OVERLAY' });
  } catch (e) {
    console.warn('Cannot start screenshot here:', e.message);
  }
}

async function sendOrInject(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
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

async function captureAndCrop(windowId, rect, dpr = 1) {
  // Chụp vùng hiển thị
  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });

  // Crop bằng OffscreenCanvas
  const blob = await (await fetch(fullDataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  // rect ở viewport CSS pixels; ảnh chụp ở device pixels
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const cropped = await canvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await blobToDataUrl(cropped);
  return { ok: true, dataUrl };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handleAsk(question, context, imageDataUrl) {
  const config = await chrome.storage.sync.get([
    'provider', 'apiKey', 'model', 'systemPrompt',
    'baseUrl', 'authScheme', 'endpointPath', 'apiFormat'
  ]);

  if (!config.apiKey) {
    return {
      ok: false,
      error: 'Chưa cấu hình API key. Mở Options để thiết lập.'
    };
  }

  try {
    const answer = await askAI({
      provider: config.provider || 'gemini',
      apiKey: config.apiKey,
      model: config.model,
      systemPrompt: config.systemPrompt,
      baseUrl: config.baseUrl,
      authScheme: config.authScheme,
      endpointPath: config.endpointPath,
      apiFormat: config.apiFormat,
      question,
      context,
      imageDataUrl
    });

    const { history = [] } = await chrome.storage.local.get(['history']);
    history.unshift({
      question: imageDataUrl ? `📷 ${question || '(Ảnh chụp)'}` : question,
      answer,
      hasImage: !!imageDataUrl,
      timestamp: Date.now()
    });
    await chrome.storage.local.set({ history: history.slice(0, 50) });

    return { ok: true, answer };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
