// Free AI models, tried in order. When one is out of free quota, the next one takes over.
import { SYSTEM_PROMPT, parseJson, validateResult } from './prompt.js';

export const GEMINI_MODELS = [
  { provider: 'gemini', id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { provider: 'gemini', id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
  { provider: 'gemini', id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { provider: 'gemini', id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
];

export const GROQ_MODELS = [
  { provider: 'groq', id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)' },
  { provider: 'groq', id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)' },
  { provider: 'groq', id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (Groq)' },
];

const COOLDOWN_KEY = 'reviewer.cooldowns';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export class AiError extends Error {
  constructor(kind, message, cooldownMs = 0) {
    super(message);
    this.kind = kind; // 'quota' | 'auth' | 'unavailable' | 'bad_output' | 'network'
    this.cooldownMs = cooldownMs;
  }
}

// ---- cooldown bookkeeping (kept in localStorage so a used-up model is skipped after reloads)

const storage = typeof localStorage !== 'undefined' ? localStorage : null;
let memCooldowns = {};

function readCooldowns() {
  if (!storage) return memCooldowns;
  try { return JSON.parse(storage.getItem(COOLDOWN_KEY)) || {}; } catch { return {}; }
}
function writeCooldowns(c) {
  if (!storage) memCooldowns = c;
  else storage.setItem(COOLDOWN_KEY, JSON.stringify(c));
}
export function cooldownLeft(model) {
  return Math.max(0, (readCooldowns()[model.id] || 0) - Date.now());
}
function setCooldown(model, ms) {
  const c = readCooldowns();
  c[model.id] = Date.now() + ms;
  writeCooldowns(c);
}
export function resetCooldowns() {
  writeCooldowns({});
}

// ---- providers

function quotaCooldown(message, retrySeconds) {
  const daily = /per ?day|daily|RPD|TPD|requests per day|tokens per day/i.test(message) || retrySeconds > 300;
  if (daily) return 6 * HOUR;
  return Math.max(5_000, (retrySeconds || 30) * 1000 + 1000);
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new AiError('network', 'Could not reach the AI service. Check your internet connection.', 15_000);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { res, json, text };
}

function failFromStatus(status, message, retrySeconds) {
  if (status === 429) return new AiError('quota', `Free limit reached: ${message}`, quotaCooldown(message, retrySeconds));
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) return new AiError('auth', `The API key was rejected: ${message}`);
  if (status === 404 || (status === 400 && /not found|not supported|unknown model|does not exist|decommissioned/i.test(message))) {
    return new AiError('unavailable', `Model not available: ${message}`, 7 * 24 * HOUR);
  }
  if (status === 413) return new AiError('unavailable', `Request too large for this model: ${message}`);
  if (status >= 500) return new AiError('unavailable', `Service busy: ${message}`, MINUTE);
  return new AiError('unavailable', `Error ${status}: ${message}`, 10 * MINUTE);
}

async function callGemini(model, key, { prompt, pdfBase64 }) {
  const parts = [];
  if (pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
  parts.push({ text: prompt });
  const { res, json, text } = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`,
    { 'x-goog-api-key': key },
    {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json' },
    },
  );
  if (!res.ok) {
    const message = json?.error?.message || text.slice(0, 300);
    const retry = json?.error?.details?.find((d) => d.retryDelay)?.retryDelay;
    const quotaInfo = JSON.stringify(json?.error?.details || '');
    throw failFromStatus(res.status, `${message} ${/PerDay/i.test(quotaInfo) ? '(per day)' : ''}`.trim(), retry ? parseFloat(retry) : 0);
  }
  const cand = json?.candidates?.[0];
  const out = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (cand?.finishReason === 'MAX_TOKENS') throw new AiError('bad_output', 'The reply was cut off (too long).');
  if (!out) throw new AiError('bad_output', `Empty reply${cand?.finishReason ? ` (${cand.finishReason})` : ''}.`);
  return out;
}

async function callGroq(model, key, { prompt }) {
  const body = {
    model: model.id,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: 6000,
  };
  if (model.id.startsWith('openai/gpt-oss')) body.reasoning_effort = 'medium';
  const { res, json, text } = await postJson('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${key}` }, body);
  if (!res.ok) {
    const message = json?.error?.message || text.slice(0, 300);
    const retry = parseFloat(res.headers.get('retry-after') || '0');
    throw failFromStatus(res.status, message, retry);
  }
  const choice = json?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new AiError('bad_output', 'The reply was cut off (too long).');
  const out = choice?.message?.content;
  if (!out) throw new AiError('bad_output', 'Empty reply.');
  return out;
}

const CALLERS = { gemini: callGemini, groq: callGroq };

/**
 * Try each model in order until one returns valid reviewer JSON.
 * @param {object[]} models
 * @param {Record<string,string>} keys  { gemini, groq }
 * @param {{prompt: string, pdfBase64?: string}} request
 * @param {(info: {model: object, waitingMs?: number}) => void} onModel
 * @param {{fetchImpl?: Function, sleep?: Function}} [deps]
 * @returns {Promise<{data: object, model: object}>}
 */
export async function runWithFallback(models, keys, request, onModel = () => {}, deps = {}) {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const errors = [];
  const badKeys = new Set();

  for (let round = 0; round < 2; round++) {
    for (const model of models) {
      if (!keys[model.provider] || badKeys.has(model.provider) || cooldownLeft(model) > 0) continue;
      for (let attempt = 1; attempt <= 2; attempt++) {
        onModel({ model });
        try {
          const raw = await CALLERS[model.provider](model, keys[model.provider], request);
          const data = validateResult(parseJson(raw));
          return { data, model };
        } catch (err) {
          const e = err instanceof AiError ? err : new AiError('bad_output', err.message);
          errors.push(`${model.label}: ${e.message}`);
          if (e.kind === 'auth') { badKeys.add(model.provider); break; }
          if (e.kind === 'bad_output' && attempt === 1) continue; // one retry on the same model
          if (e.cooldownMs) setCooldown(model, e.cooldownMs);
          break;
        }
      }
    }
    // Everything is cooling down. If a model frees up within a minute, wait for it once.
    const usable = models.filter((m) => keys[m.provider] && !badKeys.has(m.provider));
    const soonest = Math.min(...usable.map(cooldownLeft).filter((ms) => ms > 0));
    if (round === 0 && Number.isFinite(soonest) && soonest <= 65_000) {
      onModel({ model: null, waitingMs: soonest });
      await sleep(soonest);
      continue;
    }
    break;
  }

  const authFail = [...badKeys];
  const err = new Error(
    authFail.length
      ? `Your ${authFail.map((p) => (p === 'gemini' ? 'Gemini' : 'Groq')).join(' and ')} key was rejected. Check it in Settings.`
      : 'All free AI models are busy or out of free quota right now.',
  );
  err.details = errors;
  throw err;
}
