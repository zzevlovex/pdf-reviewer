import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { validateResult, parseJson, mergeResults, chunkText, buildPrompt } from '../src/lib/prompt.js';
import { runWithFallback, GEMINI_MODELS, GROQ_MODELS, resetCooldowns } from '../src/lib/ai.js';
import { buildReviewerDoc, highlight } from '../src/lib/reviewerDoc.js';

const require = createRequire(import.meta.url);

const mc = (scenario, answer) => ({
  scenario,
  question: 'Which device applies?',
  choices: ['Router', 'Switch', 'Firewall', 'Hub'],
  answer,
  explanation: 'See page 1, Devices.',
});

const SAMPLE = {
  title: 'Module 1: Networking Basics',
  topics: [
    { heading: 'Network Devices', points: ['A ==router== links networks.', 'A ==switch== links devices in one LAN.'], remember: 'Router = between networks.' },
  ],
  terms: [
    { term: 'Router', definition: 'Forwards ==data packets== between networks.', topic: 'Network Devices', source: 'p. 1' },
    { term: 'Switch', definition: 'Connects devices in a ==single network==.', topic: 'Network Devices', source: 'p. 1' },
    { term: 'Firewall', definition: 'Filters traffic using ==security rules==.', topic: 'Network Devices', source: '' },
  ],
  scenarios: [mc('An office links its LAN to the internet.', 'A'), mc('Ten PCs share one LAN.', 'B')],
};

test('validateResult keeps good items, fixes answer formats, drops bad ones', () => {
  const v = validateResult({
    ...SAMPLE,
    scenarios: [...SAMPLE.scenarios, { scenario: 'bad' }, { ...mc('x', 'A'), answer: 'Switch' }, { ...mc('y', 'A'), answer: 2 }],
  });
  assert.equal(v.terms.length, 3);
  assert.equal(v.topics.length, 1);
  assert.equal(v.scenarios.length, 4);
  assert.equal(v.scenarios[2].answer, 'B');
  assert.equal(v.scenarios[3].answer, 'C');
  assert.throws(() => validateResult({ terms: [] }));
  assert.throws(() => validateResult(null));
});

test('parseJson handles code fences and extra text', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Here you go: {"a":2} thanks'), { a: 2 });
  assert.equal(parseJson('nope'), null);
});

test('mergeResults dedupes terms across parts', () => {
  const m = mergeResults([validateResult(SAMPLE), validateResult({ ...SAMPLE, title: 'Part 2' })]);
  assert.equal(m.terms.length, 3);
  assert.equal(m.scenarios.length, 4);
  assert.deepEqual(m.titles, ['Module 1: Networking Basics', 'Part 2']);
});

test('chunkText keeps all text', () => {
  const text = Array.from({ length: 100 }, (_, i) => `Paragraph ${i} `.repeat(20)).join('\n\n');
  const chunks = chunkText(text, 6000);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 6000));
  assert.equal(chunks.join('').replace(/\s/g, '').length, text.replace(/\s/g, '').length);
});

test('prompt asks for highlights and scenarios', () => {
  const p = buildPrompt({ fileName: 'm1.pdf', text: 'hello' });
  assert.match(p, /==this==/);
  assert.match(p, /scenario/i);
  assert.match(p, /<handout file="m1.pdf"/);
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const { status = 200, json, headers = {} } = handler(url, body, calls.length);
    return { ok: status < 400, status, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, text: async () => JSON.stringify(json) };
  };
  return calls;
}

const geminiOk = (data) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] } });
const groqOk = (data) => ({ json: { choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] } });

test('fallback: Gemini daily quota -> next Gemini model; all Gemini out -> Groq', async () => {
  resetCooldowns();
  const calls = mockFetch((url) => {
    if (url.includes(GEMINI_MODELS[0].id)) {
      return { status: 429, json: { error: { message: 'Quota exceeded', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] } } };
    }
    return geminiOk(SAMPLE);
  });
  const r1 = await runWithFallback(GEMINI_MODELS, { gemini: 'k' }, { prompt: 'p', pdfBase64: 'AAA' });
  assert.equal(r1.model.id, GEMINI_MODELS[1].id);
  assert.equal(calls[0].body.contents[0].parts[0].inline_data.mime_type, 'application/pdf');

  // the exhausted model is now skipped without a request
  calls.length = 0;
  await runWithFallback(GEMINI_MODELS, { gemini: 'k' }, { prompt: 'p' });
  assert.ok(!calls.some((c) => c.url.includes(GEMINI_MODELS[0].id)));

  resetCooldowns();
  mockFetch((url) => (url.includes('groq') ? groqOk(SAMPLE) : { status: 503, json: { error: { message: 'overloaded' } } }));
  await assert.rejects(runWithFallback(GEMINI_MODELS, { gemini: 'k' }, { prompt: 'p' }, () => {}, { sleep: async () => {} }));
  const r2 = await runWithFallback(GROQ_MODELS, { groq: 'g' }, { prompt: 'p' });
  assert.equal(r2.model.provider, 'groq');
  resetCooldowns();
});

test('fallback: invalid JSON retried once on the same model, bad key reported', async () => {
  resetCooldowns();
  let n = 0;
  mockFetch(() => (++n === 1 ? { json: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] } } : geminiOk(SAMPLE)));
  const r = await runWithFallback(GEMINI_MODELS, { gemini: 'k' }, { prompt: 'p' });
  assert.equal(r.model.id, GEMINI_MODELS[0].id);
  assert.equal(n, 2);

  // Gemini answers a wrong key with 400 "API key not valid".
  mockFetch(() => ({ status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.' } } }));
  await assert.rejects(runWithFallback(GEMINI_MODELS, { gemini: 'bad' }, { prompt: 'p' }), /key was rejected/);
  resetCooldowns();
});

test('highlight() turns ==x== into highlighted spans', () => {
  const spans = highlight('a ==key== b');
  assert.equal(spans.length, 3);
  assert.equal(spans[1].text, 'key');
  assert.ok(spans[1].background);
});

test('reviewer PDF renders with all sections', async () => {
  const pdfmake = require('pdfmake');
  pdfmake.addFonts(require('pdfmake/fonts/Roboto'));
  const data = { ...mergeResults([validateResult(SAMPLE)]), models: ['Gemini 3.8 Flash'] };
  const doc = buildReviewerDoc(data, { fileNames: ['module1.pdf'] });
  const json = JSON.stringify(doc.content);
  const buf = await pdfmake.createPdf(doc).getBuffer();
  assert.equal(Buffer.from(buf).subarray(0, 5).toString(), '%PDF-');
  if (process.env.SAVE_PDF) fs.writeFileSync(process.env.SAVE_PDF, buf);
  for (const s of ['Concept Summary', 'Key Terms', 'Scenario Questions', 'Answer Key']) assert.ok(json.includes(s), s);
  assert.ok(!json.includes('Mock Exam'));
});
