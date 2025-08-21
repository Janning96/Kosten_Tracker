export async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error('PDF.js nicht verfügbar.');
  const buf = await file.arrayBuffer();
  const task = window.pdfjsLib.getDocument({ data: buf });
  const pdf = await task.promise;
  let full = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(it => (typeof it.str === 'string' ? it.str : '')).filter(Boolean);
    full += strings.join('\n') + '\n';
  }
  return full;
}
