import { buildPrompt, buildAskPrompt, reportSystemPrompt, ASK_SYSTEM_PROMPT, lengthGuidance } from '../prompts.js';

export const id = 'gemini';
export const label = 'Gemini (Google)';
export const defaultModel = 'gemini-2.5-pro';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

export function hasApiKey() {
  return Boolean(apiKey());
}

function blockReason(response) {
  const promptBlock = response.promptFeedback?.blockReason;
  if (promptBlock) return `blocked before generation (${promptBlock})`;

  const finish = response.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') return `stopped early (${finish})`;

  return null;
}

function extractText(response) {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

async function generateContent({ model, systemInstruction, prompt, maxOutputTokens, signal, history = [] }) {
  const key = apiKey();
  if (!key) throw new Error('No Gemini API key set (GEMINI_API_KEY or GOOGLE_API_KEY).');

  const contents = [
    ...history.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const response = await fetch(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { maxOutputTokens },
    }),
    signal,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Gemini request failed: ${message}`);
  }
  return body;
}

export async function generateNarrative(summary, options = {}) {
  const { model = defaultModel, verbosity = 'standard', periodLabel = 'today', period = 'day', signal, diffsByProject = {} } = options;

  const userPrompt = [
    buildPrompt(summary, { verbosity, periodLabel, diffsByProject }),
    '',
    `Length guidance: ${lengthGuidance(verbosity)}`,
  ].join('\n');

  const response = await generateContent({
    model,
    systemInstruction: reportSystemPrompt(period),
    prompt: userPrompt,
    maxOutputTokens: 8000,
    signal,
  });

  const reason = blockReason(response);
  if (reason) throw new Error(`Gemini declined to generate this report: ${reason}.`);

  const text = extractText(response);
  if (!text) throw new Error('Gemini returned an empty report.');

  return { markdown: text, usage: response.usageMetadata, model };
}

export async function answerQuestion(question, context, options = {}) {
  const { model = defaultModel, signal, history = [] } = options;

  const response = await generateContent({
    model,
    systemInstruction: ASK_SYSTEM_PROMPT,
    prompt: buildAskPrompt(question, context),
    maxOutputTokens: 4000,
    signal,
    history,
  });

  const reason = blockReason(response);
  if (reason) throw new Error(`Gemini declined to answer that question: ${reason}.`);

  const text = extractText(response);
  if (!text) throw new Error('Gemini returned an empty answer.');

  return { text, usage: response.usageMetadata, model };
}
