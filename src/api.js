// Study Assistant - AI API client
// Hỗ trợ Claude, OpenAI, Gemini, Custom Gateway, kèm vision (image)

const DEFAULT_SYSTEM_PROMPT = `Bạn là trợ lý học tập. Khi nhận được câu hỏi hoặc bài tập:
1. Đưa ra đáp án ngắn gọn, chính xác trước.
2. Sau đó giải thích từng bước ngắn gọn để người học hiểu.
3. Nếu là trắc nghiệm, nêu rõ đáp án đúng (A/B/C/D) và lý do.
4. Trả lời bằng tiếng Việt.`;

const VISION_PROMPT = 'Hãy đọc nội dung trong hình ảnh và giải bài tập/trả lời câu hỏi xuất hiện trong đó.';

const DEFAULT_MODELS = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  custom: 'gpt-4o-mini'
};

export async function askAI({
  provider, apiKey, model, systemPrompt, question, context,
  baseUrl, authScheme, endpointPath, apiFormat,
  imageDataUrl
}) {
  const sys = systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const questionText = imageDataUrl
    ? (question?.trim() || VISION_PROMPT)
    : question;
  const userText = context
    ? `Ngữ cảnh bổ sung:\n"""\n${context}\n"""\n\nCâu hỏi/bài tập:\n${questionText}`
    : questionText;

  switch (provider) {
    case 'claude':
      return callClaude({ apiKey, model: model || DEFAULT_MODELS.claude, systemPrompt: sys, userText, imageDataUrl });
    case 'openai':
      return callOpenAI({ apiKey, model: model || DEFAULT_MODELS.openai, systemPrompt: sys, userText, imageDataUrl });
    case 'custom':
      return callCustom({
        baseUrl, authScheme, endpointPath, apiKey,
        apiFormat: apiFormat || 'openai',
        model: model || DEFAULT_MODELS.custom,
        systemPrompt: sys, userText, imageDataUrl
      });
    case 'gemini':
    default:
      return callGemini({ apiKey, model: model || DEFAULT_MODELS.gemini, systemPrompt: sys, userText, imageDataUrl });
  }
}

// === Helpers cho data URL ===
function parseDataUrl(dataUrl) {
  // dataUrl dạng "data:image/png;base64,XXXX"
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Image data URL không hợp lệ');
  return { mediaType: m[1], data: m[2] };
}

// === Claude / Anthropic ===
async function callClaude({ apiKey, model, systemPrompt, userText, imageDataUrl }) {
  return anthropicCompatible({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    model, systemPrompt, userText, imageDataUrl
  });
}

async function anthropicCompatible({ url, headers, model, systemPrompt, userText, imageDataUrl }) {
  const content = [];
  if (imageDataUrl) {
    const { mediaType, data } = parseDataUrl(imageDataUrl);
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data }
    });
  }
  content.push({ type: 'text', text: userText });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content }]
    })
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (Array.isArray(data.content)) {
    return data.content.map((c) => c.text || '').join('') || '(Không có nội dung)';
  }
  return data.choices?.[0]?.message?.content
    || data.content?.[0]?.text
    || '(Không có nội dung)';
}

// === OpenAI ===
async function callOpenAI({ apiKey, model, systemPrompt, userText, imageDataUrl }) {
  return openAICompatible({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${apiKey}` },
    model, systemPrompt, userText, imageDataUrl
  });
}

async function openAICompatible({ url, headers, model, systemPrompt, userText, imageDataUrl }) {
  let userContent;
  if (imageDataUrl) {
    userContent = [
      { type: 'image_url', image_url: { url: imageDataUrl } },
      { type: 'text', text: userText }
    ];
  } else {
    userContent = userText;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.3
    })
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '(Không có nội dung)';
}

// === Custom Gateway ===
async function callCustom({
  baseUrl, authScheme, endpointPath, apiKey, apiFormat,
  model, systemPrompt, userText, imageDataUrl
}) {
  if (!baseUrl) throw new Error('Chưa cấu hình Base URL cho Custom Gateway');

  const base = baseUrl.replace(/\/+$/, '');
  const defaultPath = apiFormat === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
  const rawPath = endpointPath?.trim() || defaultPath;
  const path = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
  const url = base + path;

  const headers = {};
  const scheme = (authScheme || 'x-api-key').toLowerCase();
  if (scheme === 'bearer' || scheme === 'authorization') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    headers[authScheme || 'x-api-key'] = apiKey;
  }

  if (apiFormat === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return anthropicCompatible({ url, headers, model, systemPrompt, userText, imageDataUrl });
  }
  return openAICompatible({ url, headers, model, systemPrompt, userText, imageDataUrl });
}

// === Gemini ===
async function callGemini({ apiKey, model, systemPrompt, userText, imageDataUrl }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [];
  if (imageDataUrl) {
    const { mediaType, data } = parseDataUrl(imageDataUrl);
    parts.push({ inline_data: { mime_type: mediaType, data } });
  }
  parts.push({ text: userText });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
    })
  });

  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const respParts = data.candidates?.[0]?.content?.parts || [];
  return respParts.map((p) => p.text).join('') || '(Không có nội dung)';
}
