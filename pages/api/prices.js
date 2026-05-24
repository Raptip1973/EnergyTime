/**
 * EnergyTime — API prezzi PUN orari
 *
 * Strategia in cascata:
 *  1. ENTSO-E Transparency Platform (se configurata la chiave API)
 *  2. Profilo tipico italiano (sempre disponibile come fallback)
 *
 * Per attivare i dati REALI:
 *  1. Registrati gratis su: https://transparency.entsoe.eu
 *  2. Vai su "My Account" → "Security Token" → copia il token
 *  3. Su Vercel: Settings → Environment Variables → aggiungi ENTSOE_TOKEN
 */

export default async function handler(req, res) {
  // Cache: aggiorna ogni ora, servi dati vecchi mentre ricalcola
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const today = new Date();
  const dateLabel = today.toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // ── Tentativo 1: ENTSO-E (dati reali) ──────────────────────────────────
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

  // ── Fallback: profilo tipico italiano ──────────────────────────────────
  const prices = getTypicalItalianProfile();
  return res.status(200).json({
    prices,
    source: 'Profilo tipico italiano (demo)',
    isReal: false,
    date: dateLabel,
    updatedAt: new Date().toISOString(),
    hint: 'Per dati reali, aggiungi ENTSOE_TOKEN nelle variabili Vercel',
  });
}

// ── ENTSO-E Fetcher ────────────────────────────────────────────────────────
async function fetchFromENTSOE(token, date) {
  // Zona di offerta Italia: 10YIT-GRTN-----B
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 0, 0, 0);

  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').slice(0, 12);

  const url = [
    'https://web-api.tp.entsoe.eu/api',
    '?documentType=A44',
    '&in_Domain=10YIT-GRTN-----B',
    '&out_Domain=10YIT-GRTN-----B',
    `&periodStart=${fmt(start)}`,
    `&periodEnd=${fmt(end)}`,
    `&securityToken=${token}`,
  ].join('');

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
  }

  const xml = await res.text();
  return parseENTSOEXml(xml);
}

function parseENTSOEXml(xml) {
  const prices = new Array(24).fill(null);

  // Estrai tutti i blocchi <TimeSeries>
  const timeSeriesBlocks = xml.match(/<TimeSeries>[\s\S]*?<\/TimeSeries>/g) || [];

  for (const block of timeSeriesBlocks) {
    // Solo serie con risoluzione oraria
    const resMatch = block.match(/<resolution>(.*?)<\/resolution>/);
    if (!resMatch || resMatch[1] !== 'PT60M') continue;

    // Estrai punti prezzo
    const points = block.match(/<Point>[\s\S]*?<\/Point>/g) || [];
    for (const point of points) {
      const posMatch = point.match(/<position>(\d+)<\/position>/);
      const amtMatch = point.match(/<price\.amount>([\d.]+)<\/price\.amount>/);
      if (!posMatch || !amtMatch) continue;

      const pos = parseInt(posMatch[1]) - 1; // 0-indexed
      const euroMWh = parseFloat(amtMatch[1]);
      // Converti €/MWh → €ct/kWh (dividi per 10)
      if (pos >= 0 && pos < 24) {
        prices[pos] = parseFloat((euroMWh / 10).toFixed(2));
      }
    }

    // Se abbiamo abbastanza dati usciamo
    if (prices.filter((p) => p !== null).length >= 20) break;
  }

  const filled = prices.filter((p) => p !== null).length;
  if (filled < 20) throw new Error(`Dati insufficienti: ${filled}/24 ore`);

  // Riempi eventuali buchi con interpolazione
  return prices.map((p, i) => {
    if (p !== null) return p;
    const prev = prices.slice(0, i).reverse().find((x) => x !== null) ?? 10;
    const next = prices.slice(i + 1).find((x) => x !== null) ?? 10;
    return parseFloat(((prev + next) / 2).toFixed(2));
  });
}

// ── Profilo tipico italiano (curva media stagionale) ──────────────────────
function getTypicalItalianProfile() {
  // Valori medi basati su dati storici PUN italiani (€ct/kWh)
  const base = [
    7.2, 6.3, 5.7, 5.3, 5.1, 5.7,      // 00-05 notte: minimo
    9.1, 13.8, 16.5, 15.9, 14.7, 13.5,  // 06-11 mattina: salita
    12.8, 12.3, 11.7, 13.1, 16.2, 18.9, // 12-17 pomeriggio
    21.0, 19.6, 17.9, 14.7, 11.5, 9.1,  // 18-23 sera: picco e discesa
  ];
  // Piccola variazione casuale per sembrare dati reali
  return base.map((v) => parseFloat((v + (Math.random() - 0.5) * 1.2).toFixed(2)));
}
