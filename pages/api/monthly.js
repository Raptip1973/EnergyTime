export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const year = parseInt(req.query.year) || new Date().getFullYear();

  if (!process.env.ENTSOE_TOKEN) {
    return res.status(200).json({
      year,
      months: getTypicalYearProfile(year),
      source: 'Profilo tipico (demo)',
      isReal: false,
    });
  }

  try {
    const months = await fetchYearFromENTSOE(process.env.ENTSOE_TOKEN, year);
    return res.status(200).json({ year, months, source: 'ENTSO-E — Dati reali', isReal: true });
  } catch (err) {
    console.error('[EnergyTime Monthly]', err.message);
    return res.status(200).json({
      year,
      months: getTypicalYearProfile(year),
      source: 'Profilo tipico (demo)',
      isReal: false,
    });
  }
}

async function fetchYearFromENTSOE(token, year) {
  const domain = '10Y1001A1001A70O';
  // Richiesta: da dic 31 anno precedente ore 22 UTC a dic 31 anno corrente ore 22 UTC
  const prevYear = year - 1;
  const start = `${prevYear}12312200`;
  const end   = `${year}12312200`;

  const url = `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=${domain}&out_Domain=${domain}&periodStart=${start}&periodEnd=${end}&securityToken=${token}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const xml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return parseYearlyXml(xml, year);
}

function parseYearlyXml(xml, year) {
  const monthBuckets = Array.from({ length: 12 }, () => []);
  const periodBlocks = xml.match(/<Period>[\s\S]*?<\/Period>/g) || [];

  for (const period of periodBlocks) {
    const resMatch = period.match(/<resolution>(PT\d+M)<\/resolution>/);
    if (!resMatch) continue;
    const slotsPerHour = resMatch[1] === 'PT15M' ? 4 : 1;

    // Leggi l'ora di inizio del periodo
    const startMatch = period.match(/<start>([\dT:\-Z]+)<\/start>/);
    if (!startMatch) continue;
    const periodStart = new Date(startMatch[1]);

    const pointBlocks = period.match(/<Point>[\s\S]*?<\/Point>/g) || [];
    for (const point of pointBlocks) {
      const posMatch   = point.match(/<position>(\d+)<\/position>/);
      const priceMatch = point.match(/<price\.amount>([\d.]+)<\/price\.amount>/);
      if (!posMatch || !priceMatch) continue;

      const hoursFromStart = (parseInt(posMatch[1]) - 1) / slotsPerHour;
      const pointUTC       = new Date(periodStart.getTime() + hoursFromStart * 3600000);
      // Converti in ora italiana (UTC+1 come approssimazione per medie mensili)
      const italianTime = new Date(pointUTC.getTime() + 3600000);

      if (italianTime.getUTCFullYear() === year) {
        const month = italianTime.getUTCMonth(); // 0-11
        monthBuckets[month].push(parseFloat(priceMatch[1]) / 10);
      }
    }
  }

  // Calcola medie mensili — mesi futuri o corrente = null
  const today = new Date();
  return monthBuckets.map((bucket, m) => {
    if (year > today.getFullYear()) return null;
    if (year === today.getFullYear() && m >= today.getMonth()) return null;
    if (bucket.length === 0) return null;
    const avg = bucket.reduce((a, b) => a + b, 0) / bucket.length;
    return parseFloat(avg.toFixed(2));
  });
}

// Profilo tipico annuale italiano
function getTypicalYearProfile(year) {
  const today = new Date();
  const base = [13.2, 11.8, 10.5, 9.8, 9.2, 8.6, 8.1, 7.8, 10.2, 12.0, 14.8, 17.5];
  return base.map((v, m) => {
    if (year > today.getFullYear()) return null;
    if (year === today.getFullYear() && m >= today.getMonth()) return null;
    return parseFloat((v + (Math.random() - 0.5) * 1.5).toFixed(2));
  });
}
