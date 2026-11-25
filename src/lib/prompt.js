// Prompt text, output validation and merging for reviewer data.

export const SYSTEM_PROMPT =
  'You are an expert teacher who writes exam reviewers for a college student from their course handouts. ' +
  'Use ONLY the handout content you are given. Never add outside knowledge. ' +
  'Reply with a single JSON object and nothing else.';

const EXAMPLE = {
  title: 'Module 3: Network Security',
  topics: [
    {
      heading: 'Firewalls',
      points: [
        'A ==firewall== filters incoming and outgoing traffic using ==security rules==.',
        'Placed between a ==trusted internal network== and an untrusted outside network.',
      ],
      remember: 'Firewall = rule-based traffic filter at the network boundary.',
    },
  ],
  terms: [
    {
      term: 'Firewall',
      definition: 'A network security device that ==monitors and filters== incoming and outgoing traffic based on ==security rules==.',
      topic: 'Firewalls',
      source: 'p. 4',
    },
  ],
  scenarios: [
    {
      scenario: 'A company wants to block all outside traffic except web requests to its public site.',
      question: 'Which control should the network administrator configure?',
      choices: ['Firewall', 'Proxy server', 'Antivirus', 'VPN'],
      answer: 'A',
      explanation: 'A firewall filters traffic using security rules (p. 4, Firewalls).',
    },
  ],
};

/**
 * @param {object} p
 * @param {string} p.fileName
 * @param {string} [p.text]   handout text; omit when the PDF itself is attached
 * @param {number} p.part
 * @param {number} p.parts
 */
export function buildPrompt({ fileName, text, part = 1, parts = 1 }) {
  const source = text
    ? `<handout file="${fileName}" part="${part}" of="${parts}">\n${text}\n</handout>\n\n`
    : `The attached PDF is the handout "${fileName}".\n\n`;
  const scope = parts > 1 ? ` This is part ${part} of ${parts}; cover only this part.` : '';

  return `${source}Create reviewer material from this handout.${scope}

The student's exam has two kinds of items: (1) terminology taken directly from the handout and (2) scenario-based questions where they must recognize which concept applies. Write material that prepares them for exactly that.

Return JSON with these fields:
- "title": the handout's title or module name as written in it.
- "topics": the handout's main topics in order. For each: "heading"; "points" = 3 to 7 short study-note bullets covering what the handout says; "remember" = one sentence that captures the idea most likely to be tested.
- "terms": EVERY key term, concept, acronym, named principle, type or category in the handout, not a sample. "definition" stays close to the handout's wording. "topic" is the matching topic heading. "source" is the page or section where it appears, or "" if unknown.
- "scenarios": about one question per two terms${parts === 1 ? ' and at least 10 if the handout supports it' : ''}. Each describes a short realistic situation (a workplace, a school, a person doing something) and asks which concept from the handout applies. Exactly 4 "choices"; the 3 wrong ones are other real terms from this handout that a careless student could confuse with the answer. "answer" is the letter A, B, C or D. "explanation" is one sentence saying why, naming the page or section. Vary the position of the correct answer.

Highlighting: in "points" and "definition", wrap the 1 to 3 most exam-relevant words or phrases in == ==, like ==this==. Do not highlight whole sentences.

Every item must be supported by the handout. If the handout cannot support an item, leave it out instead of inventing it.

Example of the shape (illustrative content only):
${JSON.stringify(EXAMPLE, null, 2)}

Return only the JSON object.`;
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const LETTERS = ['A', 'B', 'C', 'D'];

function normalizeAnswer(a, choices) {
  if (typeof a === 'number' && a >= 0 && a < 4) return LETTERS[a];
  if (typeof a !== 'string') return null;
  const s = a.trim();
  const letter = s.match(/^\(?([A-Da-d])\b/);
  if (letter) return letter[1].toUpperCase();
  const idx = choices.findIndex((c) => c.trim().toLowerCase() === s.toLowerCase());
  return idx >= 0 ? LETTERS[idx] : null;
}

/** Pull the first JSON object out of a model reply. */
export function parseJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Check one AI result. Throws when unusable; drops individual malformed items. */
export function validateResult(data) {
  if (!data || typeof data !== 'object') throw new Error('The AI reply was not JSON.');
  if (!Array.isArray(data.terms)) throw new Error('The AI reply had no "terms" list.');
  const terms = data.terms
    .filter((t) => t && isStr(t.term) && isStr(t.definition))
    .map((t) => ({
      term: t.term.trim(),
      definition: t.definition.trim(),
      topic: isStr(t.topic) ? t.topic.trim() : '',
      source: isStr(t.source) ? t.source.trim() : '',
    }));
  if (terms.length === 0) throw new Error('The AI found no terms.');

  const topics = (Array.isArray(data.topics) ? data.topics : [])
    .filter((t) => t && isStr(t.heading))
    .map((t) => ({
      heading: t.heading.trim(),
      points: (Array.isArray(t.points) ? t.points : []).filter(isStr).map((p) => p.trim()),
      remember: isStr(t.remember) ? t.remember.trim() : '',
    }))
    .filter((t) => t.points.length > 0);

  const scenarios = (Array.isArray(data.scenarios) ? data.scenarios : [])
    .map((q) => {
      if (!q || !isStr(q.scenario) || !Array.isArray(q.choices)) return null;
      const choices = q.choices.filter(isStr).map((c) => c.trim().replace(/^[A-D][.)]\s+/, ''));
      if (choices.length !== 4) return null;
      const answer = normalizeAnswer(q.answer, choices);
      if (!answer) return null;
      return {
        scenario: q.scenario.trim(),
        question: isStr(q.question) ? q.question.trim() : 'Which concept applies?',
        choices,
        answer,
        explanation: isStr(q.explanation) ? q.explanation.trim() : '',
      };
    })
    .filter(Boolean);

  return { title: isStr(data.title) ? data.title.trim() : '', topics, terms, scenarios };
}

const norm = (s) => s.toLowerCase().replace(/==/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Merge results from several parts or handouts. */
export function mergeResults(results) {
  const titles = [];
  const topics = [];
  const terms = new Map();
  const scenarios = [];
  for (const r of results) {
    if (r.title && !titles.includes(r.title)) titles.push(r.title);
    topics.push(...r.topics);
    for (const t of r.terms) {
      const key = norm(t.term);
      const prev = terms.get(key);
      if (!prev || t.definition.length > prev.definition.length) terms.set(key, t);
    }
    scenarios.push(...r.scenarios);
  }
  return { titles, topics, terms: [...terms.values()], scenarios };
}

/** Split text into chunks of about `size` characters on paragraph or line breaks. */
export function chunkText(text, size) {
  if (text.length <= size) return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks;
}
