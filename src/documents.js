// Study Assistant - Local document store and PDF retrieval

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

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'with',
  'ai', 'anh', 'bai', 'ban', 'bang', 'bi', 'bo', 'cac', 'cach', 'cai', 'can', 'cau', 'cho', 'co', 'con', 'cua', 'da', 'dang', 'day', 'de', 'den', 'di', 'do', 'duoc',
  'gi', 'giua', 'hay', 'hoi', 'khong', 'khi', 'la', 'lam', 'mot', 'nay', 'neu', 'nhung', 'nhu', 'o', 'ra', 'rang', 'sau', 'se', 'the', 'thi', 'trong', 'tu', 'va', 've', 'voi'
]);

export async function importPdfFile(file) {
  const now = Date.now();
  const documentId = createId();
  const baseDoc = {
    id: documentId,
    name: file.name || 'document.pdf',
    type: 'pdf',
    size: file.size || 0,
    pageCount: 0,
    chunkCount: 0,
    addedAt: now,
    status: 'processing',
    error: ''
  };

  await putDocument(baseDoc);

  try {
    validatePdfFile(file);
    const pages = await extractPdfPages(file);
    const pageCount = pages.length;
    const textLength = pages.reduce((sum, page) => sum + page.text.length, 0);

    if (textLength < 80) {
      throw new Error('PDF này có thể là scan/ảnh, v1 chưa hỗ trợ OCR.');
    }

    const chunks = buildChunks(pages).map((chunk, index) => ({
      id: `${documentId}:${index}`,
      documentId,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      text: chunk.text,
      normalizedText: normalizeText(chunk.text),
      tokenEstimate: estimateTokens(chunk.text)
    }));

    if (chunks.length === 0) {
      throw new Error('Không trích xuất được nội dung text từ PDF.');
    }

    await replaceDocumentChunks(documentId, chunks);
    const doc = {
      ...baseDoc,
      pageCount,
      chunkCount: chunks.length,
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

  const scored = readyChunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(chunk, terms, normalizedQuery)
    }))
    .filter((chunk) => chunk.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || (b.text.length - a.text.length));

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
    const header = `[${chunk.documentName || 'Tài liệu'}, ${pageLabel}]`;
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
    throw new Error('V1 chỉ hỗ trợ file PDF.');
  }
}

async function extractPdfPages(file) {
  const pdfjsLib = await import('./vendor/pdfjs/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/vendor/pdfjs/pdf.worker.mjs');

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data, disableFontFace: true });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      pages.push({ page: pageNumber, text });
    }
    page.cleanup?.();
  }

  await pdf.destroy?.();
  return pages;
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

  if ((chunk.text || '').length < 300) {
    score *= 0.85;
  }

  return score;
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
