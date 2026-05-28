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
      console.error('[EnergyTime] Errore finale:', err.message);
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
  // ENTSO-E usa UTC. Italia = UTC+2 in estate.
  // I prezzi del giorno X vanno da 22:00 UTC del giorno X-1 alle 22:00 UTC del giorno X.
  // Usiamo un range largo per catturare sicuramente i dati.
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);

  const fmt = (d, hhmm) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}${hhmm}`;
  };

  // Range: da ieri ore 22:00 UTC a oggi ore 22:00 UTC = le 24h italiane di oggi
  const periodStart = fmt(yesterday, '2200');
  const periodEnd   = fmt(date,      '2200');

  console.log('[EnergyTime] Richiesta range:', periodStart, '->', periodEnd);

  const url = `https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=10YIT-GRTN-----B&out_Domain=10YIT-GRTN-----B&periodStart=${periodStart}&periodEnd=${periodEnd}&securityToken=${token}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const xml = await response.text();

  console.log('[EnergyTime] Status HTTP:', response.status);
  console.log('[EnergyTime] XML inizio:', xml.substring(0, 300));

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${xml.substring(0, 150)}`);
  }

  // Parser robusto: estrae direttamente tutte le coppie position+price dall'XML
  const prices = new Array(24).fill(null);

  // Cerca tutti i blocchi <Period> che contengono i prezzi
  const periodBlocks = xml.match(/<Period>[\s\S]*?<\/Period>/g) || [];
  console.log('[EnergyTime] Blocchi Period trovati:', periodBlocks.length);

  for (const period of periodBlocks) {
    // Solo periodi con risoluzione oraria
    if (!period.includes('PT60M')) continue;

    // Estrai tutti i Point dentro questo Period
    const pointBlocks = period.match(/<Point>[\s\S]*?<\/Point>/g) || [];

    for (const point of pointBlocks) {
      // Posizione (1-24)
      const posMatch   = point.match(/<position>(\d+)<\/position>/);
      // Prezzo — prova entrambi i formati possibili
      const priceMatch = point.match(/<price\.amount>([\d.]+)<\/price\.amount>/) ||
                         point.match(/<price>([\d.]+)<\/price>/);

      if (posMatch && priceMatch) {
        const pos      = parseInt(posMatch[1]) - 1; // converti 1-24 → 0-23
        const euroMWh  = parseFloat(priceMatch[1]);
        const ctKwh    = parseFloat((euroMWh / 10).toFixed(2)); // €/MWh → €ct/kWh
        if (pos >= 0 && pos < 24) {
          prices[pos] = ctKwh;
        }
      }
    }
  }

  const filled = prices.filter(p => p !== null).length;
  console.log('[EnergyTime] Prezzi estratti:', filled, '/24');

  if (filled < 20) {
    // Proviamo anche cercando direttamente nell'XML senza struttura Period
    const allPos    = [...xml.matchAll(/<position>(\d+)<\/position>/g)];
    const allPrices = [...xml.matchAll(/<price\.amount>([\d.]+)<\/price\.amount>/g)];
    console.log('[EnergyTime] Posizioni trovate:', allPos.length, '| Prezzi trovati:', allPrices.length);
    console.log('[EnergyTime] XML completo (500 chars):', xml.substring(0, 500));
    throw new Error(`Dati insufficienti: ${filled}/24 ore`);
  }

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
