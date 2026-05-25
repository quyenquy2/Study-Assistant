// Study Assistant - Local document store and PDF retrieval

import { describeDocumentPageImage } from './api.js';

const DB_NAME = 'studyAssistantDocs';
const DB_VERSION = 1;
const DOC_STORE = 'documents';
const CHUNK_STORE = 'chunks';
const PDFJS_VERSION = '5.7.284';

const CHUNK_TARGET = 1100;
const CHUNK_MAX = 1300;
const CHUNK_OVERLAP = 200;
const MAX_CONTEXT_CHARS = 8000;
const DEFAULT_SEARCH_LIMIT = 6;
const MIN_SCORE = 1.5;

const VISUAL_RENDER_MAX_DIMENSION = 1400;
const VISUAL_RENDER_MAX_SCALE = 2;
const VISUAL_IMAGE_QUALITY = 0.78;
const VISUAL_MIN_TEXT_LENGTH = 60;
const VISUAL_MAX_TEXT_LENGTH = 1800;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'with',
  'ai', 'anh', 'bai', 'ban', 'bang', 'bi', 'bo', 'cac', 'cach', 'cai', 'can', 'cau', 'cho', 'co', 'con', 'cua', 'da', 'dang', 'day', 'de', 'den', 'di', 'do', 'duoc',
  'gi', 'giua', 'hay', 'hoi', 'khong', 'khi', 'la', 'lam', 'mot', 'nay', 'neu', 'nhung', 'nhu', 'o', 'ra', 'rang', 'sau', 'se', 'the', 'thi', 'trong', 'tu', 'va', 've', 'voi'
]);

export async function importPdfFile(file, options = {}) {
  const now = Date.now();
  const documentId = createId();
  const visualIndex = normalizeVisualIndexOptions(options.visualIndex);
  const baseDoc = {
    id: documentId,
    name: file.name || 'document.pdf',
    type: 'pdf',
    size: file.size || 0,
    pageCount: 0,
    chunkCount: 0,
    textChunkCount: 0,
    visualChunkCount: 0,
    visualErrorCount: 0,
    visualIndexStatus: visualIndex.enabled ? 'processing' : 'off',
    addedAt: now,
    status: 'processing',
    error: ''
  };

  await putDocument(baseDoc);

  try {
    validatePdfFile(file);
    if (visualIndex.enabled && !visualIndex.apiKey) {
      throw new Error('Bật phân tích ảnh/sơ đồ PDF cần API key.');
    }

    const extraction = await extractPdfContent(file, {
      documentName: baseDoc.name,
      onProgress: options.onProgress,
      visualIndex
    });
    const textChunks = buildChunks(extraction.pages).map((chunk) => ({
      ...chunk,
      source: 'text'
    }));
    const visualChunks = extraction.visualPages.map((page) => ({
      pageStart: page.page,
      pageEnd: page.page,
      source: 'visual',
      text: page.text
    }));
    const rawChunks = [...textChunks, ...visualChunks];

    if (rawChunks.length === 0) {
      if (visualIndex.enabled) {
        throw new Error('Không đọc được nội dung text/ảnh từ PDF. Hãy kiểm tra API vision hoặc thử PDF khác.');
      }
      throw new Error('PDF này có thể là scan/ảnh. Bật phân tích ảnh/sơ đồ bằng AI khi nạp để index loại PDF này.');
    }

    const chunks = rawChunks.map((chunk, index) => ({
      id: `${documentId}:${index}`,
      documentId,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      source: chunk.source || 'text',
      text: chunk.text,
      normalizedText: normalizeText(chunk.text),
      tokenEstimate: estimateTokens(chunk.text)
    }));

    await replaceDocumentChunks(documentId, chunks);
    const doc = {
      ...baseDoc,
      pageCount: extraction.pageCount,
      chunkCount: chunks.length,
      textChunkCount: textChunks.length,
      visualChunkCount: visualChunks.length,
      visualErrorCount: extraction.visualErrors.length,
      visualIndexStatus: getVisualIndexStatus(visualIndex, visualChunks.length, extraction.visualErrors.length),
      status: 'ready',
      error: ''
    };
    await putDocument(doc);
    return doc;
  } catch (err) {
    await deleteChunksForDocument(documentId);
    const errorDoc = {
      ...baseDoc,
      status: 'error',
      visualIndexStatus: visualIndex.enabled ? 'error' : 'off',
      error: err?.message || 'Không đọc được PDF.'
    };
    await putDocument(errorDoc);
    return errorDoc;
  }
}

export async function listDocuments() {
  const db = await openDb();
  const docs = await getAll(db, DOC_STORE);
  return docs.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export async function deleteDocument(documentId) {
  await deleteChunksForDocument(documentId);
  const db = await openDb();
  const tx = db.transaction(DOC_STORE, 'readwrite');
  tx.objectStore(DOC_STORE).delete(documentId);
  await txDone(tx);
}

export async function searchRelevantChunks(query, limit = DEFAULT_SEARCH_LIMIT, options = {}) {
  const db = await openDb();
  const [documents, chunks] = await Promise.all([
    getAll(db, DOC_STORE),
    getAll(db, CHUNK_STORE)
  ]);
  const readyDocs = new Map(documents.filter((doc) => doc.status === 'ready').map((doc) => [doc.id, doc]));
  const readyChunks = chunks
    .filter((chunk) => readyDocs.has(chunk.documentId))
    .sort((a, b) => {
      const docDelta = (readyDocs.get(b.documentId)?.addedAt || 0) - (readyDocs.get(a.documentId)?.addedAt || 0);
      return docDelta || ((a.pageStart || 0) - (b.pageStart || 0));
    });
  if (readyChunks.length === 0) return [];

  const normalizedQuery = normalizeText(query || '');
  const terms = getSearchTerms(normalizedQuery);
  if (terms.length === 0) {
    return options.fallback ? withDocumentNames(readyChunks.slice(0, limit), readyDocs) : [];
  }

  const locationIntent = isLocationQuery(normalizedQuery);
  const scored = readyChunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(chunk, terms, normalizedQuery)
    }))
    .filter((chunk) => chunk.score >= MIN_SCORE)
    .sort((a, b) => sortScoredChunks(a, b, locationIntent));

  const selected = scored.length > 0
    ? scored.slice(0, limit)
    : (options.fallback ? readyChunks.slice(0, limit) : []);

  return withDocumentNames(selected, readyDocs);
}

export function formatDocumentContext(chunks) {
  if (!chunks?.length) return '';

  let total = 0;
  const parts = [];
  for (const chunk of chunks) {
    const pageLabel = formatPageRange(chunk.pageStart, chunk.pageEnd);
    const sourceLabel = chunk.source === 'visual' ? ', OCR/ảnh' : '';
    const header = `[${chunk.documentName || 'Tài liệu'}, ${pageLabel}${sourceLabel}]`;
    const text = chunk.text.trim();
    const next = `${header}\n${text}`;
    if (total + next.length > MAX_CONTEXT_CHARS && parts.length > 0) break;
    parts.push(next);
    total += next.length;
  }

  if (parts.length === 0) return '';
  return `Tài liệu tham khảo liên quan:\n\n${parts.join('\n\n')}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        db.createObjectStore(DOC_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const chunks = db.createObjectStore(CHUNK_STORE, { keyPath: 'id' });
        chunks.createIndex('documentId', 'documentId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putDocument(doc) {
  return writeStore(DOC_STORE, (store) => store.put(doc));
}

async function replaceDocumentChunks(documentId, chunks) {
  await deleteChunksForDocument(documentId);
  const db = await openDb();
  const tx = db.transaction(CHUNK_STORE, 'readwrite');
  const store = tx.objectStore(CHUNK_STORE);
  chunks.forEach((chunk) => store.put(chunk));
  await txDone(tx);
}

async function deleteChunksForDocument(documentId) {
  const db = await openDb();
  const tx = db.transaction(CHUNK_STORE, 'readwrite');
  const index = tx.objectStore(CHUNK_STORE).index('documentId');
  const req = index.openCursor(IDBKeyRange.only(documentId));
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await txDone(tx);
}

async function writeStore(storeName, fn) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  fn(tx.objectStore(storeName));
  await txDone(tx);
}

function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function validatePdfFile(file) {
  const name = (file.name || '').toLowerCase();
  if (!name.endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error('Chỉ hỗ trợ file PDF.');
  }
}

async function extractPdfContent(file, { documentName, onProgress, visualIndex }) {
  const pdfjsLib = await import('./vendor/pdfjs/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/vendor/pdfjs/pdf.worker.mjs');

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true });
  const pdf = await loadingTask.promise;
  const pages = [];
  const visualPages = [];
  const visualErrors = [];

  try {
    const pageCount = pdf.numPages;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      notifyProgress(onProgress, { phase: 'text', pageNumber, pageCount });
      const page = await pdf.getPage(pageNumber);

      try {
        const text = await extractPageText(page);
        if (text) {
          pages.push({ page: pageNumber, text });
        }

        if (visualIndex.enabled) {
          try {
            notifyProgress(onProgress, { phase: 'visual-render', pageNumber, pageCount });
            const imageDataUrl = await renderPdfPageImage(page);
            notifyProgress(onProgress, { phase: 'visual-ai', pageNumber, pageCount });
            const description = await describeDocumentPageImage({
              ...visualIndex,
              imageDataUrl,
              documentName,
              pageNumber,
              extractedText: text
            });
            const visualText = cleanVisualDescription(description);
            if (visualText) {
              visualPages.push({
                page: pageNumber,
                text: `OCR/mô tả hình ảnh trang ${pageNumber}: ${visualText}`
              });
            }
          } catch (err) {
            visualErrors.push({ page: pageNumber, error: err?.message || 'Không phân tích được ảnh trang PDF.' });
          }
        }
      } finally {
        page.cleanup?.();
      }
    }

    return { pageCount, pages, visualPages, visualErrors };
  } finally {
    await pdf.destroy?.();
  }
}

async function extractPageText(page) {
  const content = await page.getTextContent();
  return content.items
    .map((item) => item.str || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function renderPdfPageImage(page) {
  if (typeof document === 'undefined') {
    throw new Error('Chỉ có thể phân tích ảnh PDF trong trang Options.');
  }

  const baseViewport = page.getViewport({ scale: 1 });
  const maxDimension = Math.max(baseViewport.width, baseViewport.height);
  const scale = Math.min(VISUAL_RENDER_MAX_SCALE, VISUAL_RENDER_MAX_DIMENSION / maxDimension);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', VISUAL_IMAGE_QUALITY);
  canvas.width = 1;
  canvas.height = 1;
  return dataUrl;
}

function buildChunks(pages) {
  const chunks = [];
  let current = '';
  let pageStart = null;
  let pageEnd = null;

  const flush = () => {
    const text = cleanChunkText(current);
    if (text.length >= 80) {
      chunks.push({ pageStart, pageEnd, text });
    }
    current = '';
    pageStart = null;
    pageEnd = null;
  };

  for (const page of pages) {
    const pageText = cleanChunkText(page.text);
    if (!pageText) continue;

    if (pageText.length > CHUNK_MAX) {
      flush();
      chunks.push(...splitLongPage(pageText, page.page));
      continue;
    }

    if (current && current.length + pageText.length + 2 > CHUNK_MAX) {
      flush();
    }

    if (!current) pageStart = page.page;
    current = current ? `${current}\n\n${pageText}` : pageText;
    pageEnd = page.page;

    if (current.length >= CHUNK_TARGET) {
      flush();
    }
  }

  flush();
  return chunks;
}

function splitLongPage(text, pageNumber) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_TARGET, text.length);
    if (end < text.length) {
      const whitespace = text.lastIndexOf(' ', end);
      if (whitespace > start + 500) end = whitespace;
    }
    const chunkText = cleanChunkText(text.slice(start, end));
    if (chunkText.length >= 80) {
      chunks.push({ pageStart: pageNumber, pageEnd: pageNumber, text: chunkText });
    }
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function scoreChunk(chunk, terms, normalizedQuery) {
  const haystack = chunk.normalizedText || normalizeText(chunk.text || '');
  let score = 0;
  const seen = new Set();

  for (const term of terms) {
    if (seen.has(term)) continue;
    seen.add(term);
    if (!haystack.includes(term)) continue;

    if (term.includes(' ')) {
      score += term.length > 18 ? 4 : 2.5;
    } else {
      score += term.length > 6 ? 1.5 : 1;
    }
  }

  const queryPreview = normalizedQuery.slice(0, 80).trim();
  if (queryPreview.length > 20 && haystack.includes(queryPreview)) {
    score += 5;
  }

  if (chunk.source === 'visual') {
    score *= 1.1;
  }

  if ((chunk.text || '').length < 300) {
    score *= 0.85;
  }

  return score;
}

function sortScoredChunks(a, b, locationIntent) {
  if (locationIntent) {
    return (a.pageStart || 0) - (b.pageStart || 0)
      || b.score - a.score
      || (b.text.length - a.text.length);
  }
  return b.score - a.score || (b.text.length - a.text.length);
}

function getSearchTerms(normalizedQuery) {
  const words = normalizedQuery
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));

  const terms = [...words.filter((word) => word.length >= 3)];
  for (let i = 0; i < words.length - 1; i++) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    if (phrase.length >= 7) terms.push(phrase);
  }
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (phrase.length >= 11) terms.push(phrase);
  }

  return Array.from(new Set(terms)).slice(0, 80);
}

function isLocationQuery(normalizedQuery) {
  return /\b(dau tien|trang may|trang nao|o dau|nam o|xuat hien|vi du dau|bai tap dau)\b/.test(normalizedQuery);
}

function withDocumentNames(chunks, docsById) {
  return chunks.map((chunk) => ({
    ...chunk,
    documentName: docsById.get(chunk.documentId)?.name || 'Tài liệu'
  }));
}

function formatPageRange(start, end) {
  if (!start && !end) return 'không rõ trang';
  return start === end ? `trang ${start}` : `trang ${start}-${end}`;
}

function normalizeVisualIndexOptions(options) {
  return {
    enabled: !!options?.enabled,
    provider: options?.provider,
    apiKey: options?.apiKey,
    model: options?.model,
    baseUrl: options?.baseUrl,
    authScheme: options?.authScheme,
    endpointPath: options?.endpointPath,
    apiFormat: options?.apiFormat
  };
}

function getVisualIndexStatus(visualIndex, visualChunkCount, visualErrorCount) {
  if (!visualIndex.enabled) return 'off';
  if (visualChunkCount > 0 && visualErrorCount > 0) return 'partial';
  if (visualChunkCount > 0) return 'ready';
  if (visualErrorCount > 0) return 'error';
  return 'empty';
}

function cleanVisualDescription(text) {
  const cleaned = cleanChunkText(text);
  if (!cleaned || /^empty\.?$/i.test(cleaned)) return '';
  if (/^(khong co|không có|trang trong|trang trống)/i.test(cleaned)) return '';
  if (cleaned.length < VISUAL_MIN_TEXT_LENGTH) return '';
  return cleaned.slice(0, VISUAL_MAX_TEXT_LENGTH);
}

function notifyProgress(onProgress, payload) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(payload);
  } catch (err) {
    console.warn('[Study Assistant] document progress handler failed:', err);
  }
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanChunkText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const PDFJS_DIST_VERSION = PDFJS_VERSION;
