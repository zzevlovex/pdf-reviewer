// Turns handout files into merged reviewer data using the free model chain.
import { GEMINI_MODELS, GROQ_MODELS, runWithFallback, cooldownLeft } from './ai.js';
import { buildPrompt, chunkText, mergeResults } from './prompt.js';

// Gemini reads the whole PDF at once unless the text is very long.
const GEMINI_WHOLE_PDF_MAX_CHARS = 150_000;
const GEMINI_CHUNK_CHARS = 100_000;
// Groq's free tier allows about 8K tokens per minute, so its parts must be small.
const GROQ_CHUNK_CHARS = 6_000;
// Fewer readable characters than this per page means the PDF is a scan.
const MIN_CHARS_PER_PAGE = 40;

const geminiReady = (keys) => keys.gemini && GEMINI_MODELS.some((m) => cooldownLeft(m) === 0);

/**
 * @param {{name: string, bytes: ArrayBuffer, text: string, pages: number, realChars: number, base64: string}[]} handouts
 * @param {{gemini?: string, groq?: string}} keys
 * @param {(p: {message: string, model?: string}) => void} onProgress
 * @param {{run?: Function}} [deps] injectable for tests
 */
export async function generateReviewerData(handouts, keys, onProgress = () => {}, deps = {}) {
  const run = deps.run ?? runWithFallback;
  const results = [];
  const usedModels = new Set();

  for (const [h, handout] of handouts.entries()) {
    const label = handouts.length > 1 ? `Handout ${h + 1} of ${handouts.length}` : 'Your handout';
    const scanned = handout.realChars < MIN_CHARS_PER_PAGE * handout.pages;

    const report = (part, parts) => ({ model, waitingMs }) => {
      const where = parts > 1 ? `${label}, part ${part} of ${parts}` : label;
      if (waitingMs) onProgress({ message: `${where}: free limit hit, continuing in ${Math.ceil(waitingMs / 1000)}s` });
      else onProgress({ message: `${where}: reading with ${model.label}`, model: model.label });
    };

    // 1. Gemini first (reads the PDF itself, including scans, tables and images).
    if (geminiReady(keys)) {
      try {
        const parts = scanned || handout.text.length <= GEMINI_WHOLE_PDF_MAX_CHARS
          ? [{ pdfBase64: handout.base64 }]
          : chunkText(handout.text, GEMINI_CHUNK_CHARS).map((text) => ({ text }));
        const geminiResults = [];
        const geminiModels = [];
        for (const [i, p] of parts.entries()) {
          const prompt = buildPrompt({ fileName: handout.name, text: p.text, part: i + 1, parts: parts.length });
          const { data, model } = await run(GEMINI_MODELS, keys, { prompt, pdfBase64: p.pdfBase64 }, report(i + 1, parts.length));
          geminiResults.push(data);
          geminiModels.push(model.label);
        }
        results.push(...geminiResults);
        geminiModels.forEach((m) => usedModels.add(m));
        continue;
      } catch (err) {
        if (!keys.groq || scanned) throw withContext(err, handout, scanned);
        // Gemini is out of quota: fall through to Groq for this handout.
      }
    }

    // 2. Groq fallback (text only, small parts).
    if (scanned) {
      throw new Error(`"${handout.name}" is a scanned PDF. Scans need Gemini, which is out of free quota right now. Try again later or use a text-based PDF.`);
    }
    if (!keys.groq) {
      throw new Error('Gemini is out of free quota right now. Add a free Groq key in Settings so the app can keep going without waiting.');
    }
    const chunks = chunkText(handout.text, GROQ_CHUNK_CHARS);
    const partResults = [];
    for (const [i, text] of chunks.entries()) {
      const prompt = buildPrompt({ fileName: handout.name, text, part: i + 1, parts: chunks.length });
      const { data, model } = await run(GROQ_MODELS, keys, { prompt }, report(i + 1, chunks.length));
      partResults.push(data);
      usedModels.add(model.label);
    }
    results.push(...partResults);
  }

  onProgress({ message: 'Putting your reviewer together' });
  return { ...mergeResults(results), models: [...usedModels] };
}

function withContext(err, handout, scanned) {
  if (scanned) err.message = `"${handout.name}" is a scanned PDF and needs Gemini. ${err.message}`;
  return err;
}
