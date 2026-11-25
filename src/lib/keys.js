// API keys live only in this browser's localStorage.
const KEY = 'reviewer.keys';

export function loadKeys() {
  try {
    return { gemini: '', groq: '', ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { gemini: '', groq: '' };
  }
}

export function saveKeys(keys) {
  localStorage.setItem(KEY, JSON.stringify({ gemini: keys.gemini.trim(), groq: keys.groq.trim() }));
}
