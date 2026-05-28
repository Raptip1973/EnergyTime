export default async function handler(req, res) {
  if (!process.env.ENTSOE_TOKEN) {
    return res.status(200).send('Token non configurato');
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const fmt = (d, hhmm) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}${hhmm}`;
  };

  const periodStart = fmt(yesterday, '2200');
  const periodEnd   = fmt(today, '2200');
  const url = `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=10YIT-GRTN-----B&out_Domain=10YIT-GRTN-----B&periodStart=${periodStart}&periodEnd=${periodEnd}&securityToken=${process.env.ENTSOE_TOKEN}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const xml = await response.text();
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(`STATUS: ${response.status}\nURL: ${url}\n\n${xml.substring(0, 3000)}`);
  } catch (err) {
    return res.status(200).send(`ERRORE: ${err.message}`);
  }
}
