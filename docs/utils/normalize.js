/**
 * Normalize merchant descriptions to a concise main name.
 * Examples:
 *  - "AMZN Mktp DE 123-456" → "Amazon"
 *  - "AMAZON PAYMENTS EUROPE S.C.A." → "Amazon"
 *  - "PAYPAL EUROPE S.A.R.L. ET CIE S.C.A 1234/PP. Ihr Einkauf bei XYZ" → "PayPal"
 *  - "REWE Fil. 1234 – Frankfurt" → "REWE"
 *  - Trims NBSP, normalizes Unicode minus to ASCII '-'.
 */
export function normalizeDescription(raw) {
  if (!raw) return '';
  let s = String(raw)
    .replace(/\u00A0/g, ' ')        // NBSP → space
    .replace(/[\u2212\u2012\u2013\u2014]/g, '-') // unicode minus/en dash → '-'
    .replace(/\s+/g, ' ')           // collapse spaces
    .trim();

  const lower = s.toLowerCase();

  // Common buckets
  const rules = [
    { re: /(amzn|amazon\s+payments|amazon\s+eu|amazon\s+pay)/i, out: 'Amazon' },
    { re: /paypal\b|pp\.?\b|pay pal/i, out: 'PayPal' },
    { re: /netflix/i, out: 'Netflix' },
    { re: /spotify/i, out: 'Spotify' },
    { re: /rewe\b/i, out: 'REWE' },
    { re: /aldi\b/i, out: 'ALDI' },
    { re: /lidl\b/i, out: 'LIDL' },
    { re: /dm\b.*(drogerie)?/i, out: 'dm' },
    { re: /rossmann/i, out: 'Rossmann' },
    { re: /shell|esso|aral|total/i, out: 'Tankstelle' },
    { re: /deutsche\s+bahn|db\b|bahncard/i, out: 'Deutsche Bahn' },
    { re: /ikea/i, out: 'IKEA' },
    { re: /zara|hm\b|h&m/i, out: 'Fashion' },
    { re: /lieferando|wolt|uber\s*eats/i, out: 'Essen Lieferung' },
  ];
  for (const r of rules) if (r.re.test(s)) return r.out;

  // Trim long IBAN/order tails
  s = s.replace(/([A-Z]{2}\d{2}[A-Z0-9]{10,}|\d{6,}|bestellnr\.|auftrag|referenz)[^]*$/i, '').trim();

  // Remove leading payment rails markers
  s = s.replace(/^(lastschrift|sepa|kartenzahlung|kreditkarte|girocard)\s*[:-]?\s*/i, '');

  // If still long with slashes/dashes, keep first token(s)
  if (s.length > 28) {
    const token = s.split(/[\-–—|:/]/)[0].trim();
    if (token.length >= 3) s = token;
  }

  // Title case light
  s = s.replace(/\b([a-z])(\w*)/g, (m, a, b) => a.toUpperCase() + b.toLowerCase());

  return s;
}
