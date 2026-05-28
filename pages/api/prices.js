export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const today = new Date();
  const dateLabel = today.toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  if (process.env.ENTSOE_TOKEN) {
    try {
      const prices = await fetchFromENTSOE(process.env.ENTSOE_TOKEN, today);
      return res.status(200).json({
        prices,
        source: 'ENTSO-E — Dati reali di mercato',
        isReal: true,
        date: dateLabel,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[EnergyTime] ENTSO-E error:', err.message);
    }
  }

  const prices = getTypicalItalianProfile();
  return res.status(200).json({
    prices,
    source: 'Profilo tipico italiano (demo)',
    isReal: false,
    date: dateLabel,
    updatedAt: new Date().toISOString(),
  });
}

async function fetchFromENTSOE(token, date) {
  // I prezzi MGP vengono pubblicati il giorno prima per il giorno dopo.
  // Quindi per avere i prezzi di OGGI dobbiamo chiedere quelli
  // che sono stati pubblicati IERI (con data di consegna = oggi).
  // ENTSO-E usa UTC — l'Italia è UTC+1 (o +2 in estate).
  // Usiamo un range ampio (giorno prima + giorno corrente) per sicurezza.

  const year  = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day   = String(date.getDate()).padStart(2, '0');

  // Giorno precedente (per coprire il caso UTC vs ora italiana)
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yYear  = yesterday.getFullYear();
  const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yDay   = String(yesterday.getDate()).padStart(2, '0');

  // Range: da ieri alle 23:00 UTC a domani alle 00:00 UTC
  const periodStart = `${yYear}${yMonth}${yDay}2300`;
  const periodEnd   = `${year}${month}${day}2300`;

  const url = `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=10YIT-GRTN-----B&out_Domain=10YIT-GRTN-----B&periodStart=${periodStart}&periodEnd=${periodEnd}&securityToken=${token}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const xml = await res.text();
  return parseENTSOEXml(xml);
}

function parseENTSOEXml(xml) {
  const prices = new Array(24).fill(null);
  const timeSeriesBlocks = xml.match(/<TimeSeries>[\s\S]*?<\/TimeSeries>/g) || [];

  for (const block of timeSeriesBlocks) {
    const resMatch = block.match(/<resolution>(.*?)<\/resolution>/);
    if (!resMatch || resMatch[1] !== 'PT60M') continue;

    const points = block.match(/<Point>[\s\S]*?<\/Point>/g) || [];
    for (const point of points) {
      const posMatch = point.match(/<position>(\d+)<\/position>/);
      const amtMatch = point.match(/<price\.amount>([\d.]+)<\/price\.amount>/);
      if (!posMatch || !amtMatch) continue;

      const pos = parseInt(posMatch[1]) - 1;
      const euroMWh = parseFloat(amtMatch[1]);
      if (pos >= 0 && pos < 24) {
        prices[pos] = parseFloat((euroMWh / 10).toFixed(2));
      }
    }
    if (prices.filter((p) => p !== null).length >= 20) break;
  }

  const filled = prices.filter((p) => p !== null).length;
  if (filled < 20) throw new Error(`Dati insufficienti: ${filled}/24 ore`);

  return prices.map((p, i) => {
    if (p !== null) return p;
    const prev = prices.slice(0, i).reverse().find((x) => x !== null) ?? 10;
    const next = prices.slice(i + 1).find((x) => x !== null) ?? 10;
    return parseFloat(((prev + next) / 2).toFixed(2));
  });
}

function getTypicalItalianProfile() {
  const base = [
    7.2, 6.3, 5.7, 5.3, 5.1, 5.7,
    9.1, 13.8, 16.5, 15.9, 14.7, 13.5,
    12.8, 12.3, 11.7, 13.1, 16.2, 18.9,
    21.0, 19.6, 17.9, 14.7, 11.5, 9.1,
  ];
  return base.map((v) => parseFloat((v + (Math.random() - 0.5) * 1.2).toFixed(2)));
}
