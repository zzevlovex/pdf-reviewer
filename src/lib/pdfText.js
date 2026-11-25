import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Extract text from a PDF, with a [Page N] marker before each page. */
export async function extractPdfText(arrayBuffer) {
  const task = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = '';
    const lines = [];
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    pages.push(`[Page ${n}]\n${lines.join('\n').replace(/[ \t]+/g, ' ').trim()}`);
  }
  const text = pages.join('\n\n');
  const realChars = text.replace(/\[Page \d+\]/g, '').replace(/\s/g, '').length;
  await task.destroy();
  return { text, pages: pages.length, realChars };
}

export function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}
