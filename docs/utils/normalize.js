export function normalizeDescription(raw){
  if(!raw)return'';
  let s=String(raw).replace(/\u00A0/g,' ').replace(/[\u2212\u2012\u2013\u2014]/g,'-').replace(/\s+/g,' ').trim();
  s=s.replace(/\s+[A-Z]{2}\s+Visa$/i,'').trim();
  const rules=[
    {re:/(amzn|amazon\s+payments|amazon\.de|amazon\s+pay)/i,out:'Amazon'},
    {re:/paypal\b|pp\.?\b/i,out:'PayPal'},
    {re:/deutsche\s+bahn|db\b/i,out:'Deutsche Bahn'},
    {re:/\b(rewe|edeka|lidl|aldi|netto)\b/i,out:(m)=>m[1].toUpperCase()},
    {re:/\bdm\b/i,out:'dm'},
    {re:/rossmann/i,out:'Rossmann'},
    {re:/ikea/i,out:'IKEA'},
    {re:/lieferando|wolt|uber\s*eats/i,out:'Essen Lieferung'},
    {re:/airbnb/i,out:'Airbnb'},
    {re:/whoop/i,out:'WHOOP'},
  ];
  for(const r of rules){const m=s.match(r.re);if(m)return typeof r.out==='function'?r.out(m):r.out;}
  if(s.length>40){const t=s.split(/[\-|:/]/)[0].trim();if(t.length>=3)s=t;}
  s=s.replace(/\b([a-z])(\w*)/g,(m,a,b)=>a.toUpperCase()+b.toLowerCase());
  return s;
}