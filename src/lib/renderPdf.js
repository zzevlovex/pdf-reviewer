import { buildReviewerDoc } from './reviewerDoc.js';

let pdfMakePromise;

async function loadPdfMake() {
  pdfMakePromise ??= (async () => {
    const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);
    pdfMake.addVirtualFileSystem(vfs);
    return pdfMake;
  })();
  return pdfMakePromise;
}

/** Build the reviewer PDF and return it as a Blob. */
export async function renderReviewerPdf(data, opts) {
  const pdfMake = await loadPdfMake();
  return pdfMake.createPdf(buildReviewerDoc(data, opts)).getBlob();
}
