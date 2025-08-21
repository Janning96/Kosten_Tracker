export function normalizeDescription(raw) {
  if (!raw) return '';
  let s = String(raw)
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2212\u2012\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const rules = [
    { re: /(amzn|amazon\s+payments|amazon\.de|amazon\s+eu|amazon\s+pay)/i, out: 'Amazon' },
    { re: /paypal\b|pp\.?\b|pay pal/i, out: 'PayPal' },
    { re: /deutsche\s+bahn|db\b|bahncard/i, out: 'Deutsche Bahn' },
    { re: /\b(rewe|edeka|lidl|aldi|netto)\b/i, out: (m) => m[1].toUpperCase() },
    { re: /\bdm\b.*(drogerie)?/i, out: 'dm' },
    { re: /rossmann/i, out: 'Rossmann' },
    { re: /ikea/i, out: 'IKEA' },
    { re: /lieferando|wolt|uber\s*eats/i, out: 'Essen Lieferung' },
    { re: /airbnb/i, out: 'Airbnb' },
    { re: /whoop/i, out: 'WHOOP' },
  ];
  for (const r of rules) {
    const m = s.match(r.re);
    if (m) return typeof r.out === 'function' ? r.out(m) : r.out;
  }

  s = s.replace(/\s+[A-Z]{2}\s+Visa$/i, '').trim();
  s = s.replace(/([A-Z]{2}\d{2}[A-Z0-9]{10,}|\d{6,}|bestellnr\.|auftrag|referenz)[^]*$/i, '').trim();
  s = s.replace(/^(lastschrift|gutschrift|belastung(en)?|kartenzahlung|kreditkarte|girocard)\s*[:-]?\s*/i, '');
  if (s.length > 36) {
    const token = s.split(/[\-–—|:/]/)[0].trim();
    if (token.length >= 3) s = token;
  }
  s = s.replace(/\b([a-z])(\w*)/g, (m, a, b) => a.toUpperCase() + b.toLowerCase());
  return s;
}
