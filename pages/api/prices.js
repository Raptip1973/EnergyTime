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
      console.error('[EnergyTime] Errore:', err.message);
    }
  }

  return res.status(200).json({
    prices: getTypicalItalianProfile(),
    source: 'Profilo tipico italiano (demo)',
    isReal: false,
    date: dateLabel,
    updatedAt: new Date().toISOString(),
  });
}

async function fetchFromENTSOE(token, date) {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);

  const fmt = (d, hhmm) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}${hhmm}`;
  };

  const periodStart = fmt(yesterday, '2200');
  const periodEnd   = fmt(date, '2200');
  const domain = '10Y1001A1001A73I';

  const url = `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=${domain}&out_Domain=${domain}&periodStart=${periodStart}&periodEnd=${periodEnd}&securityToken=${token}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const xml = await response.text();

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return parseENTSOEXml(xml);
}

function parseENTSOEXml(xml) {
  // Accumula valori per ogni ora (0-23)
  const hourlyBuckets = Array.from({ length: 24 }, () => []);

  const periodBlocks = xml.match(/<Period>[\s\S]*?<\/Period>/g) || [];

  for (const period of periodBlocks) {
    // Determina la risoluzione: PT60M (oraria) o PT15M (ogni 15 min)
    const resMatch = period.match(/<resolution>(PT\d+M)<\/resolution>/);
    if (!resMatch) continue;
    const resolution = resMatch[1]; // 'PT60M' o 'PT15M'
    const minutesPerSlot = resolution === 'PT15M' ? 15 : 60;
    const slotsPerHour   = 60 / minutesPerSlot; // 4 per PT15M, 1 per PT60M

    const pointBlocks = period.match(/<Point>[\s\S]*?<\/Point>/g) || [];

    for (const point of pointBlocks) {
      const posMatch   = point.match(/<position>(\d+)<\/position>/);
      const priceMatch = point.match(/<price\.amount>([\d.]+)<\/price\.amount>/);
      if (!posMatch || !priceMatch) continue;

      const position = parseInt(posMatch[1]); // 1-based
      const euroMWh  = parseFloat(priceMatch[1]);
      const ctKwh    = parseFloat((euroMWh / 10).toFixed(3));

      // Converti posizione → ora del giorno (0-23)
      const hourIndex = Math.floor((position - 1) / slotsPerHour);
      if (hourIndex >= 0 && hourIndex < 24) {
        hourlyBuckets[hourIndex].push(ctKwh);
      }
    }
  }

  // Media dei valori per ogni ora
  const prices = hourlyBuckets.map(bucket =>
    bucket.length > 0
      ? parseFloat((bucket.reduce((a, b) => a + b, 0) / bucket.length).toFixed(2))
      : null
  );

  const filled = prices.filter(p => p !== null).length;
  console.log('[EnergyTime] Ore con dati:', filled, '/24');

  if (filled < 20) throw new Error(`Dati insufficienti: ${filled}/24 ore`);

  // Interpola eventuali ore mancanti
  return prices.map((p, i) => {
    if (p !== null) return p;
    const prev = prices.slice(0, i).reverse().find(x => x !== null) ?? 10;
    const next = prices.slice(i + 1).find(x => x !== null) ?? 10;
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
  return base.map(v => parseFloat((v + (Math.random() - 0.5) * 1.2).toFixed(2)));
}
