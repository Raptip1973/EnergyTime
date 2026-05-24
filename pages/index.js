import { useState, useEffect, useRef, useCallback } from 'react';

// ── Costanti e helpers ──────────────────────────────────────────────────────

const APPLIANCES = [
  { name: 'Lavatrice',     icon: '🫧', kw: 2.0, hours: 1.5 },
  { name: 'Lavastoviglie', icon: '🍽️', kw: 1.8, hours: 1.5 },
  { name: 'Asciugatrice',  icon: '💨', kw: 2.5, hours: 1.5 },
  { name: 'Forno',         icon: '🔥', kw: 2.2, hours: 1.0 },
  { name: 'Ferro da stiro',icon: '👔', kw: 2.4, hours: 0.5 },
  { name: 'Carica auto EV',icon: '🚗', kw: 7.4, hours: 4.0 },
];

const SLOTS = [
  { label: '🌙 Notte',          range: [0,  5],  tip: 'Ottimo per lavatrice e lavastoviglie con timer' },
  { label: '🌅 Prima mattina',  range: [6,  8],  tip: 'Colazione e piccoli elettrodomestici' },
  { label: '☀️ Tarda mattina',  range: [9,  12], tip: 'Prezzi in salita — moderare i consumi' },
  { label: '🌤 Primo pomeriggio',range:[13, 15], tip: 'Piccola tregua prima della punta serale' },
  { label: '🌆 Punta serale',   range: [16, 21], tip: '⚠️ Fascia più cara — evita grandi consumi' },
  { label: '🌃 Tarda sera',     range: [22, 23], tip: 'Prezzi in calo — usa il timer notturno' },
];

function priceColor(price, min, max) {
  const r = (price - min) / (max - min || 1);
  if (r < 0.33) return '#22d07a';
  if (r < 0.66) return '#f5c542';
  return '#f0522a';
}

function priceTag(price, min, max) {
  const r = (price - min) / (max - min || 1);
  if (r < 0.33) return { icon: '✅', text: 'CONVENIENTE' };
  if (r < 0.66) return { icon: '⚡', text: 'NELLA MEDIA' };
  return { icon: '🔴', text: 'COSTOSO' };
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ── Componente principale ───────────────────────────────────────────────────
export default function EnergyTime() {
  const [data,      setData]      = useState(null);   // { prices, source, date, isReal }
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [now,       setNow]       = useState(new Date());
  const [tab,       setTab]       = useState('chart'); // chart | slots | appliances
  const [selected,  setSelected]  = useState(null);   // ora selezionata nel grafico
  const canvasRef = useRef(null);

  // Aggiorna orologio ogni minuto
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Carica prezzi dall'API
  const loadPrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/prices');
      if (!res.ok) throw new Error(`Errore server: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPrices(); }, [loadPrices]);

  // Disegna grafico a barre
  useEffect(() => {
    if (tab !== 'chart' || !data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const { prices } = data;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const hour = now.getHours();
    const padB = 24;
    const chartH = H - padB;
    const barW = Math.floor((W - 2) / 24) - 1;

    ctx.clearRect(0, 0, W, H);

    prices.forEach((price, i) => {
      const ratio  = (price - min) / (max - min || 1);
      const bh     = Math.max(6, ratio * chartH * 0.9);
      const x      = i * (barW + 1) + 1;
      const y      = chartH - bh;
      const col    = priceColor(price, min, max);
      const isNow  = i === hour;
      const isSel  = i === selected;

      ctx.shadowBlur  = (isNow || isSel) ? 14 : 0;
      ctx.shadowColor = isNow ? '#ffffff' : col;

      ctx.fillStyle = isNow ? '#ffffff' : isSel ? col : col + 'bb';
      ctx.beginPath();
      ctx.roundRect(x, y, barW, bh, [3, 3, 0, 0]);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Pallino "ora più economica"
      if (price === min && !isNow) {
        ctx.fillStyle = '#22d07a';
        ctx.beginPath();
        ctx.arc(x + barW / 2, y - 6, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Etichetta ora ogni 3h o ora attuale
      if (i % 4 === 0 || isNow) {
        ctx.fillStyle = isNow ? '#fff' : '#4a6a88';
        ctx.font = `${isNow ? 'bold ' : ''}9px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(pad2(i), x + barW / 2, H - 6);
      }
    });
  }, [tab, data, now, selected]);

  // ── Dati derivati ────────────────────────────────────────────────────────
  const hour    = now.getHours();
  const prices  = data?.prices ?? [];
  const minP    = prices.length ? Math.min(...prices) : 0;
  const maxP    = prices.length ? Math.max(...prices) : 1;
  const currP   = prices[hour] ?? null;
  const bestH   = prices.indexOf(minP);
  const selP    = selected !== null ? prices[selected] : null;

  const clockStr = `${pad2(hour)}:${pad2(now.getMinutes())}`;

  // Click sul canvas → seleziona ora
  const handleCanvasClick = (e) => {
    if (!data) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x    = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const barW = Math.floor((canvasRef.current.width - 2) / 24) - 1;
    const idx  = Math.floor(x / (barW + 1));
    if (idx >= 0 && idx < 24) setSelected(idx === selected ? null : idx);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      <div style={s.bgGrid} />

      {/* Status bar */}
      <div style={s.statusBar}>
        <span style={s.statusClock}>{clockStr}</span>
        <span style={s.appName}>⚡ EnergyTime</span>
        <button onClick={loadPrices} style={s.refreshBtn} title="Aggiorna prezzi">↻</button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div style={s.centerMsg}>
          <div style={s.spinner} />
          <p style={s.loadText}>Carico prezzi…</p>
        </div>
      )}
      {error && !loading && (
        <div style={s.errorBox}>
          ⚠️ {error}
          <button onClick={loadPrices} style={s.retryBtn}>Riprova</button>
        </div>
      )}

      {/* Contenuto principale */}
      {!loading && !error && data && (
        <>
          {/* Hero card */}
          <div style={s.hero}>
            <div style={s.heroLeft}>
              <div style={s.heroSmall}>ORA ATTUALE</div>
              <div style={s.heroHour}>ore {pad2(hour)}:00</div>
              {currP !== null && (
                <div style={{ ...s.heroBadge, background: priceColor(currP,minP,maxP)+'22', borderColor: priceColor(currP,minP,maxP) }}>
                  <span>{priceTag(currP,minP,maxP).icon}</span>
                  <span style={{ color: priceColor(currP,minP,maxP), fontWeight: 700 }}>
                    {priceTag(currP,minP,maxP).text}
                  </span>
                </div>
              )}
            </div>
            <div style={s.heroRight}>
              {currP !== null ? (
                <>
                  <div style={{ ...s.heroPrice, color: priceColor(currP,minP,maxP) }}>
                    {currP.toFixed(1)}
                  </div>
                  <div style={s.heroUnit}>€ct/kWh</div>
                </>
              ) : (
                <div style={s.noData}>–</div>
              )}
            </div>
          </div>

          {/* Banner ora migliore */}
          {prices.length > 0 && (
            <div style={s.bestBanner}>
              💚 Ora più conveniente oggi:&nbsp;
              <strong style={{ color: '#22d07a' }}>ore {pad2(bestH)}:00</strong>
              &nbsp;→ {minP.toFixed(1)} €ct/kWh
            </div>
          )}

          {/* Fonte dati */}
          <div style={{ ...s.sourceChip, borderColor: data.isReal ? '#22d07a55' : '#f5c54244' }}>
            <span style={{ color: data.isReal ? '#22d07a' : '#f5c542' }}>
              {data.isReal ? '●' : '○'}
            </span>
            &nbsp;{data.source}
          </div>

          {/* Tabs */}
          <div style={s.tabs}>
            {[
              { id: 'chart',      label: '📊 Grafico' },
              { id: 'slots',      label: '🕐 Fasce' },
              { id: 'appliances', label: '🏠 Elettrod.' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setSelected(null); }}
                style={{ ...s.tab, ...(tab === t.id ? s.tabOn : {}) }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── TAB GRAFICO ─────────────────────────────────────── */}
          {tab === 'chart' && (
            <div style={s.panel}>
              <div style={s.legend}>
                <span><span style={{ color:'#22d07a' }}>■</span> Basso</span>
                <span><span style={{ color:'#f5c542' }}>■</span> Medio</span>
                <span><span style={{ color:'#f0522a' }}>■</span> Alto</span>
                <span style={{ color:'#fff5' }}>■ Ora attuale</span>
              </div>
              <canvas
                ref={canvasRef}
                width={340}
                height={160}
                style={s.canvas}
                onClick={handleCanvasClick}
              />

              {selected !== null && selP !== null ? (
                <div style={{ ...s.selBox, borderColor: priceColor(selP,minP,maxP) }}>
                  <span>Ore <strong>{pad2(selected)}:00 – {pad2(selected+1)}:00</strong></span>
                  <span style={{ color: priceColor(selP,minP,maxP), fontWeight:700 }}>
                    {selP.toFixed(2)} €ct/kWh
                  </span>
                  <span style={{ ...s.selTag, background: priceColor(selP,minP,maxP)+'33', color: priceColor(selP,minP,maxP) }}>
                    {priceTag(selP,minP,maxP).icon} {priceTag(selP,minP,maxP).text}
                  </span>
                </div>
              ) : (
                <div style={s.hint}>Tocca una barra per il dettaglio dell'ora</div>
              )}

              {/* Lista scrollabile 24h */}
              <div style={s.list}>
                {prices.map((p, i) => (
                  <div
                    key={i}
                    onClick={() => setSelected(i === selected ? null : i)}
                    style={{
                      ...s.listRow,
                      background: i===hour ? '#ffffff0f' : i===selected ? priceColor(p,minP,maxP)+'18' : 'transparent',
                      borderLeft: `3px solid ${i===hour ? '#fff' : priceColor(p,minP,maxP)}`,
                    }}
                  >
                    <span style={s.listHour}>{pad2(i)}:00</span>
                    <div style={s.listBarBg}>
                      <div style={{ ...s.listBar, width:`${((p-minP)/(maxP-minP||1))*100}%`, background: priceColor(p,minP,maxP) }} />
                    </div>
                    <span style={{ ...s.listVal, color: priceColor(p,minP,maxP) }}>{p.toFixed(1)}</span>
                    {p === minP && <span style={s.bestDot}>💚</span>}
                    {i === hour && <span style={s.nowChip}>NOW</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB FASCE ────────────────────────────────────────── */}
          {tab === 'slots' && (
            <div style={s.panel}>
              <div style={s.sectionTitle}>Fasce orarie di oggi</div>
              {SLOTS.map((slot) => {
                const slotPrices = prices.slice(slot.range[0], slot.range[1]+1);
                const avg = slotPrices.length
                  ? slotPrices.reduce((a,b)=>a+b,0)/slotPrices.length
                  : 10;
                const tag  = priceTag(avg, minP, maxP);
                const col  = priceColor(avg, minP, maxP);
                const isNowSlot = hour >= slot.range[0] && hour <= slot.range[1];
                return (
                  <div key={slot.label} style={{ ...s.slotCard, borderColor: isNowSlot ? '#fff4' : '#1e3050' }}>
                    <div style={s.slotTop}>
                      <span style={s.slotLabel}>{slot.label}</span>
                      <span style={{ fontSize:9, color:'#567' }}>
                        {pad2(slot.range[0])}:00 – {pad2(slot.range[1]+1)}:00
                      </span>
                      {isNowSlot && <span style={s.nowPill}>◉ ORA</span>}
                      <span style={{ ...s.slotBadge, background: col+'22', color: col }}>
                        {tag.icon} {avg.toFixed(1)} €ct
                      </span>
                    </div>
                    <div style={s.slotTip}>{slot.tip}</div>
                    <div style={s.slotMini}>
                      {slotPrices.map((p,k)=>{
                        const ratio = (p-minP)/(maxP-minP||1);
                        return (
                          <div key={k} style={{ flex:1, height:`${8+ratio*20}px`, background:priceColor(p,minP,maxP), borderRadius:2, opacity:0.85 }}/>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── TAB ELETTRODOMESTICI ─────────────────────────────── */}
          {tab === 'appliances' && (
            <div style={s.panel}>
              <div style={s.sectionTitle}>Quando accendere i tuoi elettrodomestici?</div>
              <div style={{ fontSize:10, color:'#456', marginBottom:10 }}>
                Basato sui prezzi di oggi · orari con costo minore evidenziati
              </div>
              {APPLIANCES.map((app) => {
                const costs = prices.map((p,i) => ({
                  h: i,
                  cost: (p * app.kw * app.hours) / 100,
                })).sort((a,b)=>a.cost-b.cost);
                const best3  = costs.slice(0,3);
                const worst  = costs[costs.length-1];
                const saving = ((worst.cost - best3[0].cost) / worst.cost * 100).toFixed(0);
                return (
                  <div key={app.name} style={s.appCard}>
                    <div style={s.appHead}>
                      <span style={s.appIcon}>{app.icon}</span>
                      <div>
                        <div style={s.appName}>{app.name}</div>
                        <div style={s.appSub}>{app.kw} kW · ciclo ~{app.hours}h</div>
                      </div>
                      <div style={s.appSaving}>
                        <div style={s.appSavingN}>-{saving}%</div>
                        <div style={s.appSavingL}>risparmio</div>
                      </div>
                    </div>
                    <div style={s.appBest}>
                      <span style={s.appBestLbl}>✅ Migliori ore:</span>
                      {best3.map(b=>(
                        <span key={b.h} style={s.greenChip}>
                          {pad2(b.h)}:00
                          <span style={{ color:'#4a7', fontSize:9 }}> ~{(b.cost).toFixed(2)}€</span>
                        </span>
                      ))}
                    </div>
                    <div style={s.appWorst}>
                      <span style={s.appWorstLbl}>🔴 Evita:</span>
                      <span style={s.redChip}>{pad2(worst.h)}:00</span>
                      <span style={{ fontSize:9, color:'#678' }}>
                        costa {((worst.cost/best3[0].cost-1)*100).toFixed(0)}% in più
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Bottom bar */}
      <div style={s.bottom}>
        <span style={s.bottomTxt}>
          📡 Dati PUN · {data?.date ?? '…'} · fonte: mercatoelettrico.org / ENTSO-E
        </span>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #08111f; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #1e3050; border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

// ── Stili ────────────────────────────────────────────────────────────────────
const s = {
  root: {
    fontFamily: "'Courier New', monospace",
    background: '#08111f',
    color: '#dce8f5',
    minHeight: '100vh',
    maxWidth: 400,
    margin: '0 auto',
    paddingBottom: 60,
    position: 'relative',
    overflowX: 'hidden',
    animation: 'fadeUp .4s ease both',
  },
  bgGrid: {
    position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
    backgroundImage: 'linear-gradient(rgba(34,208,122,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(34,208,122,.04) 1px,transparent 1px)',
    backgroundSize: '30px 30px',
  },
  statusBar: {
    display:'flex', justifyContent:'space-between', alignItems:'center',
    padding:'10px 16px 6px', position:'relative', zIndex:1,
  },
  statusClock: { fontSize:12, fontWeight:700, color:'#8ab' },
  appName: { fontSize:13, fontWeight:900, letterSpacing:1 },
  refreshBtn: {
    background:'transparent', border:'none', color:'#4a8', fontSize:18,
    cursor:'pointer', padding:'2px 4px', lineHeight:1,
  },
  centerMsg: {
    display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'center', height:200, gap:12, position:'relative', zIndex:1,
  },
  spinner: {
    width:32, height:32, border:'3px solid #1e3050',
    borderTopColor:'#22d07a', borderRadius:'50%',
    animation:'spin 0.9s linear infinite',
  },
  loadText: { fontSize:12, color:'#567' },
  errorBox: {
    margin:'16px', padding:'12px', background:'#1a0a0a', border:'1px solid #f0522a44',
    borderRadius:10, fontSize:11, color:'#f0522a', display:'flex', gap:10,
    alignItems:'center', position:'relative', zIndex:1,
  },
  retryBtn: {
    marginLeft:'auto', background:'#f0522a22', border:'1px solid #f0522a',
    color:'#f0522a', borderRadius:6, padding:'4px 10px', fontSize:10,
    cursor:'pointer', fontFamily:"'Courier New',monospace",
  },
  hero: {
    margin:'8px 14px 0', padding:'16px', borderRadius:16,
    background:'linear-gradient(135deg,#0d1e33,#0a1626)',
    border:'1px solid #1e3050', display:'flex', justifyContent:'space-between',
    alignItems:'center', position:'relative', zIndex:1,
    boxShadow:'0 4px 20px #0006',
  },
  heroLeft: { display:'flex', flexDirection:'column', gap:6 },
  heroSmall: { fontSize:8, color:'#456', letterSpacing:2, fontWeight:700 },
  heroHour: { fontSize:24, fontWeight:900 },
  heroBadge: {
    display:'inline-flex', gap:5, alignItems:'center',
    borderRadius:20, padding:'3px 10px', fontSize:10, fontWeight:700,
    border:'1px solid', letterSpacing:.5,
  },
  heroRight: { textAlign:'right' },
  heroPrice: { fontSize:52, fontWeight:900, lineHeight:1, fontVariantNumeric:'tabular-nums' },
  heroUnit: { fontSize:10, color:'#456', marginTop:2 },
  noData: { fontSize:32, color:'#456' },
  bestBanner: {
    margin:'8px 14px 0', padding:'8px 12px', borderRadius:10,
    background:'#0d2218', border:'1px solid #1e4832',
    fontSize:11, color:'#89c4a8', position:'relative', zIndex:1,
  },
  sourceChip: {
    margin:'6px 14px 0', padding:'4px 10px', borderRadius:20,
    border:'1px solid', fontSize:9, color:'#567', display:'inline-block',
    position:'relative', zIndex:1,
  },
  tabs: {
    display:'flex', margin:'8px 14px 0', gap:6, position:'relative', zIndex:1,
  },
  tab: {
    flex:1, padding:'8px 4px', background:'#0d1929', border:'1px solid #1e3050',
    borderRadius:8, color:'#456', fontSize:10, cursor:'pointer',
    fontFamily:"'Courier New',monospace", fontWeight:700, letterSpacing:.4,
    transition:'all .2s',
  },
  tabOn: { background:'#0f2540', border:'1px solid #22d07a', color:'#22d07a' },
  panel: { margin:'8px 14px 0', position:'relative', zIndex:1 },
  legend: { display:'flex', gap:10, fontSize:9, color:'#456', marginBottom:6, flexWrap:'wrap' },
  canvas: {
    width:'100%', borderRadius:10, background:'#0d1929',
    border:'1px solid #1e3050', cursor:'pointer', display:'block',
  },
  selBox: {
    marginTop:8, padding:'8px 12px', background:'#0d1929', borderRadius:8,
    border:'1px solid', display:'flex', justifyContent:'space-between',
    alignItems:'center', fontSize:11, gap:6, flexWrap:'wrap',
  },
  selTag: { padding:'2px 8px', borderRadius:10, fontSize:9, fontWeight:700 },
  hint: { textAlign:'center', fontSize:10, color:'#2a4050', marginTop:6, fontStyle:'italic' },
  list: { marginTop:8, maxHeight:260, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 },
  listRow: {
    display:'flex', alignItems:'center', gap:7, padding:'4px 8px',
    borderRadius:6, cursor:'pointer', transition:'background .15s',
  },
  listHour: { fontSize:10, color:'#6a8899', width:32, flexShrink:0, fontWeight:700 },
  listBarBg: { flex:1, height:5, background:'#1a2a3a', borderRadius:3, overflow:'hidden' },
  listBar: { height:'100%', borderRadius:3 },
  listVal: { fontSize:10, width:30, textAlign:'right', fontWeight:700 },
  bestDot: { fontSize:10 },
  nowChip: {
    fontSize:7, background:'#ffffff22', color:'#fff',
    borderRadius:4, padding:'1px 4px', fontWeight:900,
  },
  sectionTitle: {
    fontSize:11, fontWeight:900, color:'#7a9ab8', letterSpacing:1,
    textTransform:'uppercase', marginBottom:10,
  },
  slotCard: {
    marginBottom:8, padding:'10px 12px', borderRadius:12,
    background:'#0d1929', border:'1px solid',
  },
  slotTop: { display:'flex', alignItems:'center', gap:6, marginBottom:4, flexWrap:'wrap' },
  slotLabel: { flex:1, fontSize:11, fontWeight:700 },
  nowPill: { fontSize:9, color:'#22d07a', fontWeight:900 },
  slotBadge: { fontSize:9, padding:'2px 8px', borderRadius:10, fontWeight:700 },
  slotTip: { fontSize:10, color:'#5a7a8a', marginBottom:6, lineHeight:1.5 },
  slotMini: { display:'flex', gap:2, alignItems:'flex-end', height:28 },
  appCard: {
    marginBottom:10, padding:'10px 12px', background:'#0d1929',
    border:'1px solid #1e3050', borderRadius:12,
  },
  appHead: { display:'flex', gap:10, alignItems:'center', marginBottom:8 },
  appIcon: { fontSize:24 },
  appName: { fontSize:13, fontWeight:700 },
  appSub: { fontSize:9, color:'#456' },
  appSaving: { marginLeft:'auto', textAlign:'right' },
  appSavingN: { fontSize:20, fontWeight:900, color:'#22d07a' },
  appSavingL: { fontSize:8, color:'#345' },
  appBest: { display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:4 },
  appBestLbl: { fontSize:9, color:'#22d07a', fontWeight:700 },
  greenChip: {
    background:'#0d2218', border:'1px solid #22d07a44',
    borderRadius:6, padding:'2px 7px', fontSize:10, color:'#22d07a', fontWeight:700,
  },
  appWorst: { display:'flex', alignItems:'center', gap:6 },
  appWorstLbl: { fontSize:9, color:'#f0522a', fontWeight:700 },
  redChip: {
    background:'#2a0d08', border:'1px solid #f0522a44',
    borderRadius:6, padding:'2px 7px', fontSize:10, color:'#f0522a', fontWeight:700,
  },
  bottom: {
    position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)',
    width:'100%', maxWidth:400, background:'#08111fee',
    borderTop:'1px solid #1e3050', padding:'8px 14px 10px',
    backdropFilter:'blur(10px)', zIndex:10,
  },
  bottomTxt: { fontSize:8, color:'#2a4050', display:'block', textAlign:'center', letterSpacing:.3 },
};
