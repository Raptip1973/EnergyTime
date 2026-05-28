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
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}${hhmm}`;
  };

  // Zona IT-Centre-North — la più vicina al PUN ufficiale GME
  const domain = '10Y1001A1001A70O';

  const url = `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=${domain}&out_Domain=${domain}&periodStart=${fmt(yesterday,'2200')}&periodEnd=${fmt(date,'2200')}&securityToken=${token}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const xml = await response.text();

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${xml.slice(0, 150)}`);

  const rawPrices = parseENTSOEXml(xml);

  // Corregge lo sfasamento UTC → ora italiana (UTC+2 in estate)
  const utcOffset = getItalyUTCOffset(date); // +1 inverno, +2 estate
  return shiftForTimezone(rawPrices, utcOffset);
}

// Calcola offset UTC dell'Italia per la data specificata
// Italia: CET (UTC+1) in inverno, CEST (UTC+2) in estate
function getItalyUTCOffset(date) {
  // Ora legale in Italia: ultima domenica di marzo → ultima domenica di ottobre
  const year = date.getFullYear();

  // Ultima domenica di marzo
  const lastSundayMarch = new Date(year, 2, 31);
  lastSundayMarch.setDate(31 - lastSundayMarch.getDay());

  // Ultima domenica di ottobre
  const lastSundayOctober = new Date(year, 9, 31);
  lastSundayOctober.setDate(31 - lastSundayOctober.getDay());

  const isDST = date >= lastSundayMarch && date < lastSundayOctober;
return isDST ? 1 : 0;
}

// Sposta i prezzi di N ore per correggere UTC → ora locale
function shiftForTimezone(prices, hoursToShift) {
  return prices.map((_, i) => {
    const srcIndex = (i - hoursToShift + 24) % 24;
    return prices[srcIndex];
  });
}

function parseENTSOEXml(xml) {
  const hourlyBuckets = Array.from({ length: 24 }, () => []);
  const periodBlocks  = xml.match(/<Period>[\s\S]*?<\/Period>/g) || [];

  for (const period of periodBlocks) {
    const resMatch = period.match(/<resolution>(PT\d+M)<\/resolution>/);
    if (!resMatch) continue;
    const slotsPerHour = resMatch[1] === 'PT15M' ? 4 : 1;
    const pointBlocks  = period.match(/<Point>[\s\S]*?<\/Point>/g) || [];

    for (const point of pointBlocks) {
      const posMatch   = point.match(/<position>(\d+)<\/position>/);
      const priceMatch = point.match(/<price\.amount>([\d.]+)<\/price\.amount>/);
      if (!posMatch || !priceMatch) continue;

      const hourIndex = Math.floor((parseInt(posMatch[1]) - 1) / slotsPerHour);
      if (hourIndex >= 0 && hourIndex < 24) {
        hourlyBuckets[hourIndex].push(parseFloat(priceMatch[1]) / 10);
      }
    }
  }

  const prices = hourlyBuckets.map(b =>
    b.length > 0
      ? parseFloat((b.reduce((a, c) => a + c, 0) / b.length).toFixed(2))
      : null
  );

  const filled = prices.filter(p => p !== null).length;
  console.log('[EnergyTime] Prezzi estratti:', filled, '/24');

  if (filled < 20) throw new Error(`Dati insufficienti: ${filled}/24 ore`);

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
