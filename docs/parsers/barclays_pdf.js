// Barclays DE PDF parser tuned for rows like:
// "DD.MM.YYYY  DD.MM.YYYY  <Beschreibung>  123,45-"
// i.e., amount with trailing sign. Also accept "−" unicode minus normalized earlier.
export function parseBarclaysPdfText(fullText) {
  if (!fullText || typeof fullText !== 'string') throw new Error('Leerer PDF-Text.');
  const text = fullText.replace(/\u00A0/g, ' ').replace(/\r/g, '');
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const results = [];

  const row = /^(\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})([+-])$/;

  for (const ln of lines) {
    const m = ln.match(row);
    if (!m) continue;
    const valuta = m[2];
    let desc = m[3].replace(/\s+[A-Z]{2}\s+Visa$/i, '').trim();
    if (/^gutschrift\s+manuelle\s+lastschrift$/i.test(desc)) continue;
    const sign = m[5] === '-' ? -1 : 1;
    const val = sign * Number(m[4].replace(/\./g, '').replace(',', '.'));
    const [dd, mm, yyyy] = valuta.split('.');
    const iso = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
    results.push({ description: desc, postingDate: iso, amount: val, source: 'Barclays' });
  }

  return results;
}
