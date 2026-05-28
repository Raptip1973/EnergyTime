import * as XLSX from 'xlsx';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const today = new Date();
  const dateLabel = today.toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Tentativo 1: dati reali GME
  try {
    const prices = await fetchFromGME(today);
    return res.status(200).json({
      prices,
      source: 'GME — Dati reali PUN ufficiali',
      isReal: true,
      date: dateLabel,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[EnergyTime] GME error:', err.message);
  }

  // Tentativo 2: ENTSO-E (fallback)
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

  // Fallback finale: profilo tipico
  return res.status(200).json({
    prices: getTypicalItalianProfile(),
    source: 'Profilo tipico italiano (demo)',
    isReal: false,
    date: dateLabel,
    updatedAt: new Date().toISOString(),
  });
}

// ── GME: scarica il file Excel ufficiale del PUN ──────────────────────────
async function fetchFromGME(date) {
  // GME pubblica il file con il nome: YYYYMMDD_YYYYMMDD_PUN.xlsx
  const y   = date.getFullYear();
  const m   = String(date.getMonth() + 1).padStart(2, '0');
  const d   = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;

  const url = `https://www.mercatoelettrico.org/en/download/DownloadData.aspx?val=MGPPrezzi&DataStart=${dateStr}&DataEnd=${dateStr}`;

  console.log('[EnergyTime] GME URL:', url);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.mercatoelettrico.org',
    }
  });

  if (!response.ok) throw new Error(`GME HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  // Il foglio si chiama "MGP-PUNPUN"
  const sheetName = workbook.SheetNames.find(n => n.includes('PUN')) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  console.log('[EnergyTime] GME sheet:', sheetName, '| Righe:', rows.length);

  // Struttura: [Data, Ora (1-24), €/MWh]
  // Salta la riga di intestazione
  const prices = new Array(24).fill(null);

  for (const row of rows) {
    if (!row || row.length < 3) continue;
    const ora   = parseInt(row[1]); // 1-24
    const prezzo = parseFloat(String(row[2]).replace(',', '.'));

    if (!isNaN(ora) && !isNaN(prezzo) && ora >= 1 && ora <= 24) {
      // GME usa ore 1-24, convertiamo in 0-23
      // Convertiamo €/MWh → €ct/kWh (dividi per 10)
      prices[ora - 1] = parseFloat((prezzo / 10).toFixed(2));
    }
  }

  const filled = prices.filter(p => p !== null).length;
  console.log('[EnergyTime] GME prezzi estratti:', filled, '/24');

  if (filled < 20) throw new Error(`GME dati insufficienti: ${filled}/24`);

  return prices.map((p, i) => {
    if (p !== null) return p;
    const prev = prices.slice(0, i).reverse().find(x => x !== null) ?? 10;
    const next = prices.slice(i + 1).find(x => x !== null) ?? 10;
    return parseFloat(((prev + next) / 2).toFixed(2));
  });
}

// ── ENTSO-E (fallback) ────────────────────────────────────────────────────
async function fetchFromENTSOE(token, date) {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);

  const fmt = (d, hhmm) => {
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}${hhmm}`;
  };

  const domain = '10Y1001A1001A70O';
  const url = `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=${domain}&out_Domain=${domain}&periodStart=${fmt(yesterday,'2200')}&periodEnd=${fmt(date,'2200')}&securityToken=${token}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const xml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
    b.length > 0 ? parseFloat((b.reduce((a,c) => a+c, 0) / b.length).toFixed(2)) : null
  );

  if (prices.filter(p => p !== null).length < 20) throw new Error('Dati insufficienti');
  return prices.map((p, i) => {
    if (p !== null) return p;
    const prev = prices.slice(0, i).reverse().find(x => x !== null) ?? 10;
    const next = prices.slice(i + 1).find(x => x !== null) ?? 10;
    return parseFloat(((prev + next) / 2).toFixed(2));
  });
}

// ── Profilo tipico ────────────────────────────────────────────────────────
function getTypicalItalianProfile() {
  const base = [
    7.2, 6.3, 5.7, 5.3, 5.1, 5.7,
    9.1, 13.8, 16.5, 15.9, 14.7, 13.5,
    12.8, 12.3, 11.7, 13.1, 16.2, 18.9,
    21.0, 19.6, 17.9, 14.7, 11.5, 9.1,
  ];
  return base.map(v => parseFloat((v + (Math.random() - 0.5) * 1.2).toFixed(2)));
}
