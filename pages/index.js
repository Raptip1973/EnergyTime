import { useState, useEffect, useRef, useCallback } from 'react';

const APPLIANCES = [
  { name: 'Lavatrice',      icon: '🫧', kw: 2.0, hours: 1.5 },
  { name: 'Lavastoviglie',  icon: '🍽️', kw: 1.8, hours: 1.5 },
  { name: 'Asciugatrice',   icon: '💨', kw: 2.5, hours: 1.5 },
  { name: 'Forno',          icon: '🔥', kw: 2.2, hours: 1.0 },
  { name: 'Ferro da stiro', icon: '👔', kw: 2.4, hours: 0.5 },
  { name: 'Carica auto EV', icon: '🚗', kw: 7.4, hours: 4.0 },
];

const SLOTS = [
  { label: '🌙 Notte',           range: [0,  5],  tip: 'Ideale per lavatrice e lavastoviglie con timer' },
  { label: '🌅 Prima mattina',   range: [6,  8],  tip: 'Colazione e piccoli elettrodomestici' },
  { label: '☀️ Tarda mattina',   range: [9,  12], tip: 'Prezzi in salita — moderare i consumi' },
  { label: '🌤 Primo pomeriggio',range: [13, 15], tip: 'Piccola tregua prima della punta serale' },
  { label: '🌆 Punta serale',    range: [16, 21], tip: '⚠️ Fascia più cara — evita grandi consumi' },
  { label: '🌃 Tarda sera',      range: [22, 23], tip: 'Prezzi in calo — usa il timer notturno' },
];

const MONTHS_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const MONTHS_FULL = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function priceColor(p, min, max) {
  const r = (p - min) / (max - min || 1);
  if (r < 0.33) return '#16a34a';
  if (r < 0.66) return '#d97706';
  return '#dc2626';
}
function priceBg(p, min, max) {
  const r = (p - min) / (max - min || 1);
  if (r < 0.33) return '#dcfce7';
  if (r < 0.66) return '#fef3c7';
  return '#fee2e2';
}
function priceTag(p, min, max) {
  const r = (p - min) / (max - min || 1);
  if (r < 0.33) return { icon: '✅', text: 'Conveniente' };
  if (r < 0.66) return { icon: '⚡', text: 'Nella media' };
  return { icon: '🔴', text: 'Costoso' };
}
function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }

export default function EnergyTime() {
  const today = new Date(); today.setHours(12,0,0,0);
  const currentYear = today.getFullYear();

  // ── State ────────────────────────────────────────────────────────────────
  const [view,        setView]        = useState('daily');   // 'daily' | 'yearly'
  const [dayOffset,   setDayOffset]   = useState(0);         // -1, 0, 1
  const [yearOffset,  setYearOffset]  = useState(0);         // 0, -1, -2, -3
  const [dailyData,   setDailyData]   = useState({});        // cache daily
  const [monthlyData, setMonthlyData] = useState({});        // cache yearly
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [now,         setNow]         = useState(new Date());
  const [tab,         setTab]         = useState('chart');
  const [selected,    setSelected]    = useState(null);
  const canvasRef   = useRef(null);
  const touchStartX = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Daily data ───────────────────────────────────────────────────────────
  const currentDate = addDays(today, dayOffset);
  const dateStr     = toDateStr(currentDate);
  const currentDailyData = dailyData[dateStr];

  const loadDaily = useCallback(async (ds) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/prices?date=${ds}`);
      if (!res.ok) throw new Error(`Errore server: ${res.status}`);
      const json = await res.json();
      setDailyData(prev => ({ ...prev, [ds]: json }));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (view !== 'daily') return;
    if (!dailyData[dateStr]) loadDaily(dateStr);
    else setLoading(false);
    setSelected(null);
  }, [dateStr, view]);

  // Precarica ieri e domani
  useEffect(() => {
    [-1, 1].forEach(o => {
      const ds = toDateStr(addDays(today, o));
      if (!dailyData[ds]) fetch(`/api/prices?date=${ds}`).then(r=>r.json()).then(j=>setDailyData(p=>({...p,[ds]:j}))).catch(()=>{});
    });
  }, []);

  // ── Yearly data ──────────────────────────────────────────────────────────
  const targetYear = currentYear + yearOffset;
  const currentMonthlyData = monthlyData[targetYear];

  const loadMonthly = useCallback(async (yr) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/monthly?year=${yr}`);
      if (!res.ok) throw new Error(`Errore server: ${res.status}`);
      const json = await res.json();
      setMonthlyData(prev => ({ ...prev, [yr]: json }));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (view !== 'yearly') return;
    if (!monthlyData[targetYear]) loadMonthly(targetYear);
    else setLoading(false);
  }, [targetYear, view]);

  // ── Grafico giornaliero ──────────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'daily' || tab !== 'chart' || !currentDailyData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const { prices } = currentDailyData;
    const min = Math.min(...prices), max = Math.max(...prices);
    const isToday = dayOffset === 0;
    const hour = now.getHours();
    const padB = 22, chartH = H - padB;
    const barW = Math.floor((W - 2) / 24) - 1;

    ctx.clearRect(0, 0, W, H);
    prices.forEach((price, i) => {
      const ratio = (price - min) / (max - min || 1);
      const minH = chartH * 0.12, maxH = chartH * 0.92;
      const bh = minH + ratio * (maxH - minH);
      const x = i * (barW + 1) + 1, y = chartH - bh;
      const col = priceColor(price, min, max);
      const isNow = isToday && i === hour;

      ctx.fillStyle = isNow ? '#1e293b' : i === selected ? col : col + 'cc';
      ctx.beginPath(); ctx.roundRect(x, y, barW, bh, [3,3,0,0]); ctx.fill();

      if (price === min && !isNow) {
        ctx.fillStyle = '#16a34a';
        ctx.beginPath(); ctx.arc(x+barW/2, y-6, 3, 0, Math.PI*2); ctx.fill();
      }
      if (i % 4 === 0 || isNow) {
        ctx.fillStyle = isNow ? '#1e293b' : '#94a3b8';
        ctx.font = `${isNow?'bold ':''}9px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(pad2(i), x+barW/2, H-5);
      }
    });
  }, [view, tab, currentDailyData, now, selected, dayOffset]);

  // ── Grafico mensile (SVG tramite canvas) ─────────────────────────────────
  const renderMonthlyChart = (months) => {
    const valid = months.filter(m => m !== null);
    if (!valid.length) return null;
    const minV = Math.min(...valid), maxV = Math.max(...valid);
    const W = 300, H = 120, padL = 20, padB = 22, padT = 14, padR = 8;
    const chartW = W - padL - padR, chartH = H - padB - padT;
    const count = months.filter(m => m !== null).length;
    if (!count) return null;
    const slotW = chartW / 12;

    // Calcola coordinate
    const coords = months.map((m, i) => {
      if (m === null) return null;
      const ratio = (m - minV) / (maxV - minV || 1);
      const minH = chartH * 0.1, maxH = chartH * 0.9;
      const bh = minH + ratio * (maxH - minH);
      const x = padL + i * slotW + slotW * 0.15;
      const bw = slotW * 0.7;
      const y = padT + (chartH - bh);
      const cx = padL + i * slotW + slotW / 2;
      const cy = padT + chartH - (minH + ratio * (maxH - minH));
      return { x, bw, y, bh, cx, cy, val: m, col: priceColor(m, minV, maxV) };
    });

    const linePoints = coords.filter(Boolean).map(c => `${c.cx},${c.cy}`).join(' ');

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', display:'block' }}>
        {/* Griglia */}
        {[0.25, 0.5, 0.75].map((r,i) => (
          <line key={i} x1={padL} y1={padT + chartH*r} x2={W-padR} y2={padT + chartH*r} stroke="#f1f5f9" strokeWidth="1"/>
        ))}
        {/* Barre */}
        {coords.map((c, i) => c && (
          <rect key={i} x={c.x} y={c.y} width={c.bw} height={c.bh} rx="2" fill={c.col} fillOpacity="0.3"/>
        ))}
        {/* Linea trend */}
        {linePoints && (
          <polyline points={linePoints} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        )}
        {/* Pallini e valori */}
        {coords.map((c, i) => c && (
          <g key={i}>
            <circle cx={c.cx} cy={c.cy} r={c.val === minV || c.val === maxV ? 4 : 3} fill={c.val===minV?'#16a34a':c.val===maxV?'#dc2626':'#6366f1'} stroke="#fff" strokeWidth="1.5"/>
            <text x={c.cx} y={c.y - 3} textAnchor="middle" fontSize="7" fill={c.col} fontWeight="700">{c.val.toFixed(1)}</text>
          </g>
        ))}
        {/* Etichette mesi */}
        {MONTHS_IT.map((m, i) => {
          const x = padL + i * slotW + slotW / 2;
          return <text key={i} x={x} y={H-4} textAnchor="middle" fontSize="7" fill="#94a3b8">{m}</text>;
        })}
      </svg>
    );
  };

  // ── Swipe ────────────────────────────────────────────────────────────────
  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd   = (e) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (view === 'daily') {
        if (diff > 0) { // swipe sinistra
          if (dayOffset > -1) setDayOffset(o => o-1);
          else { setView('yearly'); setYearOffset(0); }
        } else { // swipe destra
          if (dayOffset < 1) setDayOffset(o => o+1);
        }
      } else { // yearly
        if (diff > 0) { // swipe sinistra = anno precedente
          if (yearOffset > -3) setYearOffset(o => o-1);
        } else { // swipe destra = anno successivo o torna daily
          if (yearOffset < 0) setYearOffset(o => o+1);
          else { setView('daily'); setDayOffset(-1); }
        }
      }
    }
    touchStartX.current = null;
  };

  const handleCanvasClick = (e) => {
    if (!currentDailyData) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const barW = Math.floor((canvasRef.current.width - 2) / 24) - 1;
    const idx = Math.floor(x / (barW + 1));
    if (idx >= 0 && idx < 24) setSelected(idx === selected ? null : idx);
  };

  // ── Dati derivati ─────────────────────────────────────────────────────────
  const prices = currentDailyData?.prices ?? [];
  const minP   = prices.length ? Math.min(...prices) : 0;
  const maxP   = prices.length ? Math.max(...prices) : 1;
  const hour   = now.getHours();
  const currP  = dayOffset === 0 && prices[hour] != null ? prices[hour] : null;
  const bestH  = prices.indexOf(Math.min(...prices));

  const mData  = currentMonthlyData?.months ?? [];
  const mValid = mData.filter(m => m !== null);
  const mMin   = mValid.length ? Math.min(...mValid) : 0;
  const mMax   = mValid.length ? Math.max(...mValid) : 1;
  const mAvg   = mValid.length ? mValid.reduce((a,b)=>a+b,0)/mValid.length : 0;
  const mMinM  = MONTHS_FULL[mData.indexOf(mMin < 999 ? mMin : 0)] ?? '';
  const mMaxM  = MONTHS_FULL[mData.indexOf(mMax)] ?? '';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={s.root} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>

      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.headerIcon}>⚡</span>
          <span style={s.headerTitle}>EnergyTime</span>
        </div>
        <div style={s.headerRight}>
          <span style={s.headerClock}>{pad2(now.getHours())}:{pad2(now.getMinutes())}</span>
          <button onClick={() => view==='daily' ? loadDaily(dateStr) : loadMonthly(targetYear)} style={s.refreshBtn}>↻</button>
        </div>
      </div>

      {/* Navigazione */}
      <div style={s.dayNav}>
        <button
          onClick={() => {
            if (view==='daily') {
              if (dayOffset > -1) setDayOffset(o=>o-1);
              else { setView('yearly'); setYearOffset(0); }
            } else {
              if (yearOffset > -3) setYearOffset(o=>o-1);
            }
          }}
          style={{ ...s.dayBtn, opacity: (view==='daily' && dayOffset<=-1 && false) || (view==='yearly' && yearOffset<=-3) ? 0.3 : 1 }}
        >‹</button>

        <div style={s.dayCenter}>
          {view === 'daily' ? (
            <>
              <div style={{ ...s.dayLabel, color: dayOffset===0 ? '#16a34a' : '#1e293b' }}>
                {dayOffset===0 ? '📅 Oggi' : dayOffset===1 ? '📅 Domani' : '📅 Ieri'}
              </div>
              <div style={s.dayDate}>
                {currentDate.toLocaleDateString('it-IT', { weekday:'long', day:'numeric', month:'long' })}
              </div>
            </>
          ) : (
            <>
              <div style={{ ...s.dayLabel, color:'#6366f1' }}>
                📊 Anno {targetYear}
              </div>
              <div style={s.dayDate}>Media mensile PUN</div>
            </>
          )}
        </div>

        <button
          onClick={() => {
            if (view==='yearly') {
              if (yearOffset < 0) setYearOffset(o=>o+1);
              else { setView('daily'); setDayOffset(-1); }
            } else {
              if (dayOffset < 1) setDayOffset(o=>o+1);
            }
          }}
          style={{ ...s.dayBtn, opacity: (view==='daily' && dayOffset>=1) ? 0.3 : 1 }}
          disabled={view==='daily' && dayOffset>=1}
        >›</button>
      </div>

      <div style={s.swipeHint}>← scorri per cambiare {view==='daily'?'giorno':'anno'} →</div>

      {loading && (
        <div style={s.centerMsg}>
          <div style={s.spinner} />
          <p style={s.loadText}>{view==='yearly' ? 'Carico dati annuali...' : 'Carico prezzi...'}</p>
        </div>
      )}
      {error && !loading && (
        <div style={s.errorBox}>
          ⚠️ {error}
          <button onClick={() => view==='daily' ? loadDaily(dateStr) : loadMonthly(targetYear)} style={s.retryBtn}>Riprova</button>
        </div>
      )}

      {/* ── VISTA GIORNALIERA ── */}
      {!loading && !error && view==='daily' && currentDailyData && (
        <>
          {dayOffset===0 && currP !== null && (
            <div style={s.hero}>
              <div style={s.heroLeft}>
                <div style={s.heroLabel}>ORA ATTUALE</div>
                <div style={s.heroTime}>ore {pad2(hour)}:00</div>
                <div style={{ ...s.heroBadge, background: priceBg(currP,minP,maxP), color: priceColor(currP,minP,maxP) }}>
                  {priceTag(currP,minP,maxP).icon} {priceTag(currP,minP,maxP).text}
                </div>
              </div>
              <div style={s.heroRight}>
                <span style={{ ...s.heroPrice, color: priceColor(currP,minP,maxP) }}>{currP.toFixed(1)}</span>
                <span style={s.heroUnit}>€ct/kWh</span>
              </div>
            </div>
          )}

          {prices.length > 0 && (
            <div style={s.bestBanner}>
              <span>💚</span>
              <span>Ora più conveniente: <strong style={{color:'#15803d'}}>ore {pad2(bestH)}:00</strong> → {minP.toFixed(1)} €ct/kWh</span>
            </div>
          )}

          <div style={s.sourceRow}>
            <span style={{ color: currentDailyData.isReal ? '#16a34a' : '#d97706', fontSize:10 }}>●</span>
            <span style={s.sourceText}>{currentDailyData.source}</span>
            {dayOffset===1 && !currentDailyData.isReal && <span style={s.tomorrowNote}>⏰ disponibile dopo le 14:00</span>}
          </div>

          <div style={s.tabs}>
            {[{id:'chart',label:'📊 Grafico'},{id:'slots',label:'🕐 Fasce'},{id:'appliances',label:'🏠 Elettrod.'}].map(t=>(
              <button key={t.id} onClick={()=>{setTab(t.id);setSelected(null);}} style={{...s.tab,...(tab===t.id?s.tabOn:{})}}>
                {t.label}
              </button>
            ))}
          </div>

          {tab==='chart' && (
            <div style={s.panel}>
              <div style={s.legend}>
                <span><span style={{color:'#16a34a'}}>■</span> Basso</span>
                <span><span style={{color:'#d97706'}}>■</span> Medio</span>
                <span><span style={{color:'#dc2626'}}>■</span> Alto</span>
                {dayOffset===0 && <span style={{color:'#94a3b8'}}>■ Ora attuale</span>}
              </div>
              <canvas ref={canvasRef} width={340} height={150} style={s.canvas} onClick={handleCanvasClick}/>
              {selected !== null && prices[selected] != null ? (
                <div style={{...s.selBox, borderColor: priceColor(prices[selected],minP,maxP)}}>
                  <span style={s.selHour}>Ore {pad2(selected)}:00 – {pad2(selected+1)}:00</span>
                  <span style={{fontWeight:700, color:priceColor(prices[selected],minP,maxP), fontSize:18}}>
                    {prices[selected].toFixed(2)} €ct/kWh
                  </span>
                  <span style={{...s.selBadge, background:priceBg(prices[selected],minP,maxP), color:priceColor(prices[selected],minP,maxP)}}>
                    {priceTag(prices[selected],minP,maxP).icon} {priceTag(prices[selected],minP,maxP).text}
                  </span>
                </div>
              ) : (
                <div style={s.hint}>Tocca una barra per vedere il dettaglio</div>
              )}
              <div style={s.list}>
                {prices.map((p,i)=>(
                  <div key={i} onClick={()=>setSelected(i===selected?null:i)}
                    style={{...s.listRow, background:(dayOffset===0&&i===hour)?'#f0fdf4':i===selected?priceBg(p,minP,maxP):'#fff', borderLeft:`4px solid ${(dayOffset===0&&i===hour)?'#15803d':priceColor(p,minP,maxP)}`}}>
                    <span style={s.listHour}>{pad2(i)}:00</span>
                    <div style={s.listBarBg}><div style={{...s.listBar,width:`${8 + ((p-minP)/(maxP-minP||1))*92}%`,background:priceColor(p,minP,maxP)}}/></div>
                    <span style={{...s.listVal,color:priceColor(p,minP,maxP)}}>{p.toFixed(1)}</span>
                    {p===minP && <span>💚</span>}
                    {dayOffset===0&&i===hour && <span style={s.nowChip}>ORA</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab==='slots' && (
            <div style={s.panel}>
              <div style={s.sectionTitle}>Fasce orarie</div>
              {SLOTS.map(slot=>{
                const sp=prices.slice(slot.range[0],slot.range[1]+1);
                const avg=sp.length?sp.reduce((a,b)=>a+b,0)/sp.length:10;
                const col=priceColor(avg,minP,maxP), bg=priceBg(avg,minP,maxP), tag=priceTag(avg,minP,maxP);
                const isNow=dayOffset===0&&hour>=slot.range[0]&&hour<=slot.range[1];
                return (
                  <div key={slot.label} style={{...s.slotCard,borderLeft:`4px solid ${col}`,background:isNow?bg:'#fff'}}>
                    <div style={s.slotTop}>
                      <span style={s.slotLabel}>{slot.label}</span>
                      <span style={{fontSize:11,color:'#94a3b8'}}>{pad2(slot.range[0])}:00–{pad2(slot.range[1]+1)}:00</span>
                      {isNow&&<span style={{...s.nowChip,background:'#dcfce7',color:'#15803d'}}>ORA</span>}
                      <span style={{...s.slotBadge,background:bg,color:col}}>{tag.icon} {avg.toFixed(1)} €ct</span>
                    </div>
                    <div style={s.slotTip}>{slot.tip}</div>
                    <div style={s.slotMini}>
                      {sp.map((p,k)=>{const r=(p-minP)/(maxP-minP||1);return<div key={k} style={{flex:1,height:`${8+r*20}px`,background:priceColor(p,minP,maxP),borderRadius:2}}/>;})}</div>
                  </div>
                );
              })}
            </div>
          )}

          {tab==='appliances' && (
            <div style={s.panel}>
              <div style={s.sectionTitle}>Quando usare i tuoi elettrodomestici?</div>
              <p style={s.sectionSub}>Basato sui prezzi {dayOffset===0?'di oggi':dayOffset===1?'di domani':'di ieri'}</p>
              {APPLIANCES.map(app=>{
                const costs=prices.map((p,i)=>({h:i,cost:(p*app.kw*app.hours)/100})).sort((a,b)=>a.cost-b.cost);
                const best3=costs.slice(0,3), worst=costs[costs.length-1];
                const saving=((worst.cost-best3[0].cost)/worst.cost*100).toFixed(0);
                return (
                  <div key={app.name} style={s.appCard}>
                    <div style={s.appHead}>
                      <span style={s.appIcon}>{app.icon}</span>
                      <div style={{flex:1}}><div style={s.appName}>{app.name}</div><div style={s.appSub}>{app.kw} kW · ciclo ~{app.hours}h</div></div>
                      <div style={s.appSaving}><div style={s.appSavingN}>-{saving}%</div><div style={s.appSavingL}>risparmio</div></div>
                    </div>
                    <div style={s.appBest}>
                      <span style={s.appBestLbl}>✅ Migliori ore:</span>
                      {best3.map(b=><span key={b.h} style={s.greenChip}>{pad2(b.h)}:00 <span style={{color:'#15803d',fontSize:10}}>~{b.cost.toFixed(2)}€</span></span>)}
                    </div>
                    <div style={s.appWorst}>
                      <span style={s.appWorstLbl}>🔴 Evita:</span>
                      <span style={s.redChip}>{pad2(worst.h)}:00</span>
                      <span style={s.appWorstNote}>costa {((worst.cost/best3[0].cost-1)*100).toFixed(0)}% in più</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── VISTA ANNUALE ── */}
      {!loading && !error && view==='yearly' && currentMonthlyData && (
        <div style={s.panel}>

          {/* Stat cards */}
          <div style={s.statRow}>
            <div style={s.statCard}>
              <div style={s.statLabel}>Minimo</div>
              <div style={{...s.statVal, color:'#16a34a'}}>{mMin.toFixed(1)}</div>
              <div style={s.statMonth}>{mMinM.slice(0,3)}</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Media annua</div>
              <div style={{...s.statVal, color:'#d97706'}}>{mAvg.toFixed(1)}</div>
              <div style={s.statMonth}>€ct/kWh</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Massimo</div>
              <div style={{...s.statVal, color:'#dc2626'}}>{mMax.toFixed(1)}</div>
              <div style={s.statMonth}>{mMaxM.slice(0,3)}</div>
            </div>
          </div>

          {/* Grafico barre + linea */}
          <div style={s.chartWrap}>
            <div style={s.chartLabel}>
              Andamento mensile · linea = trend
              <span style={{...s.legendDot, background:'#6366f1'}} /> trend
              <span style={{...s.legendDot, background:'#16a34a33', border:'1px solid #16a34a'}} /> barre
            </div>
            {renderMonthlyChart(mData)}
          </div>

          {/* Lista mesi */}
          <div style={s.sectionTitle}>Dettaglio per mese</div>
          {mData.map((val, i) => (
            <div key={i} style={s.monthRow}>
              <span style={s.monthName}>{MONTHS_IT[i]}</span>
              {val !== null ? (
                <>
                  <div style={s.monthBarBg}>
                    <div style={{...s.monthBarFill, width:`${8 + ((val-mMin)/(mMax-mMin||1))*92}%`, background:priceColor(val,mMin,mMax)}}/>
                  </div>
                  <span style={{...s.monthVal, color:priceColor(val,mMin,mMax)}}>{val.toFixed(1)}</span>
                  {val===mMin && <span style={{fontSize:12}}>💚</span>}
                  {val===mMax && <span style={{fontSize:12}}>🔴</span>}
                </>
              ) : (
                <>
                  <div style={{...s.monthBarBg, background:'#f8faff'}}/>
                  <span style={{fontSize:11, color:'#cbd5e1', width:38, textAlign:'right'}}>–</span>
                </>
              )}
            </div>
          ))}

          <div style={{...s.sourceRow, marginTop:10}}>
            <span style={{color:currentMonthlyData.isReal?'#16a34a':'#d97706', fontSize:10}}>●</span>
            <span style={s.sourceText}>{currentMonthlyData.source}</span>
          </div>
        </div>
      )}

      <div style={s.footer}>📡 Dati PUN · ENTSO-E / mercatoelettrico.org</div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f8faff; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const s = {
  root: { fontFamily:"'Inter','Helvetica Neue',sans-serif", background:'#f8faff', color:'#1e293b', minHeight:'100vh', maxWidth:400, margin:'0 auto', paddingBottom:70 },
  header: { background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:10 },
  headerLeft: { display:'flex', alignItems:'center', gap:8 },
  headerIcon: { fontSize:20 },
  headerTitle: { fontSize:18, fontWeight:700, color:'#1e293b' },
  headerRight: { display:'flex', alignItems:'center', gap:10 },
  headerClock: { fontSize:14, fontWeight:600, color:'#64748b' },
  refreshBtn: { background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#16a34a', padding:'2px 4px' },
  dayNav: { display:'flex', alignItems:'center', justifyContent:'space-between', background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'10px 16px' },
  dayBtn: { background:'none', border:'none', fontSize:28, cursor:'pointer', color:'#16a34a', padding:'0 8px', fontWeight:300 },
  dayCenter: { textAlign:'center', flex:1 },
  dayLabel: { fontSize:15, fontWeight:700 },
  dayDate: { fontSize:12, color:'#94a3b8', marginTop:1, textTransform:'capitalize' },
  swipeHint: { textAlign:'center', fontSize:10, color:'#cbd5e1', padding:'4px 0' },
  centerMsg: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:200, gap:12 },
  spinner: { width:32, height:32, border:'3px solid #e2e8f0', borderTopColor:'#16a34a', borderRadius:'50%', animation:'spin 0.9s linear infinite' },
  loadText: { fontSize:14, color:'#64748b' },
  errorBox: { margin:16, padding:14, background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:12, fontSize:13, color:'#dc2626', display:'flex', gap:10, alignItems:'center' },
  retryBtn: { marginLeft:'auto', background:'#fff', border:'1px solid #dc2626', color:'#dc2626', borderRadius:8, padding:'4px 12px', fontSize:12, cursor:'pointer' },
  hero: { margin:'12px 14px 0', background:'#fff', border:'1px solid #e2e8f0', borderRadius:16, padding:'16px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', boxShadow:'0 1px 4px #0000000a' },
  heroLeft: { display:'flex', flexDirection:'column', gap:6 },
  heroLabel: { fontSize:10, color:'#94a3b8', letterSpacing:2, fontWeight:600, textTransform:'uppercase' },
  heroTime: { fontSize:26, fontWeight:800, color:'#1e293b' },
  heroBadge: { display:'inline-flex', gap:5, alignItems:'center', borderRadius:20, padding:'4px 12px', fontSize:13, fontWeight:700 },
  heroRight: { display:'flex', alignItems:'baseline', gap:4 },
  heroPrice: { fontSize:56, fontWeight:900, lineHeight:1 },
  heroUnit: { fontSize:13, color:'#94a3b8' },
  bestBanner: { margin:'10px 14px 0', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:12, padding:'10px 14px', fontSize:13, color:'#166534', display:'flex', gap:8, alignItems:'center' },
  sourceRow: { margin:'8px 14px 0', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' },
  sourceText: { fontSize:11, color:'#94a3b8' },
  tomorrowNote: { fontSize:10, color:'#d97706', background:'#fef3c7', padding:'2px 8px', borderRadius:8 },
  tabs: { display:'flex', margin:'10px 14px 0', gap:6 },
  tab: { flex:1, padding:'9px 4px', background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, color:'#64748b', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all .15s' },
  tabOn: { background:'#f0fdf4', border:'1px solid #86efac', color:'#15803d' },
  panel: { margin:'10px 14px 0' },
  legend: { display:'flex', gap:10, fontSize:10, color:'#94a3b8', marginBottom:8, flexWrap:'wrap' },
  canvas: { width:'100%', borderRadius:12, background:'#fff', border:'1px solid #e2e8f0', cursor:'pointer', display:'block' },
  selBox: { marginTop:8, padding:'10px 14px', background:'#fff', borderRadius:10, border:'1px solid', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 },
  selHour: { fontSize:13, fontWeight:600, color:'#1e293b' },
  selBadge: { padding:'3px 10px', borderRadius:10, fontSize:11, fontWeight:700 },
  hint: { textAlign:'center', fontSize:12, color:'#cbd5e1', marginTop:6 },
  list: { marginTop:8, maxHeight:280, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 },
  listRow: { display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:8, cursor:'pointer', border:'1px solid #f1f5f9' },
  listHour: { fontSize:12, fontWeight:700, color:'#64748b', width:34, flexShrink:0 },
  listBarBg: { flex:1, height:6, background:'#f1f5f9', borderRadius:3, overflow:'hidden' },
  listBar: { height:'100%', borderRadius:3 },
  listVal: { fontSize:13, fontWeight:700, width:34, textAlign:'right' },
  nowChip: { fontSize:9, background:'#dcfce7', color:'#15803d', borderRadius:4, padding:'2px 5px', fontWeight:800 },
  sectionTitle: { fontSize:13, fontWeight:700, color:'#475569', letterSpacing:0.5, textTransform:'uppercase', marginBottom:4 },
  sectionSub: { fontSize:11, color:'#94a3b8', marginBottom:10 },
  slotCard: { marginBottom:8, padding:'12px 14px', background:'#fff', borderRadius:12, border:'1px solid #e2e8f0', boxShadow:'0 1px 3px #0000000a' },
  slotTop: { display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' },
  slotLabel: { flex:1, fontSize:13, fontWeight:700, color:'#1e293b' },
  slotBadge: { fontSize:11, padding:'3px 10px', borderRadius:10, fontWeight:700 },
  slotTip: { fontSize:12, color:'#64748b', marginBottom:8, lineHeight:1.5 },
  slotMini: { display:'flex', gap:2, alignItems:'flex-end', height:24 },
  appCard: { marginBottom:10, padding:'12px 14px', background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, boxShadow:'0 1px 3px #0000000a' },
  appHead: { display:'flex', gap:10, alignItems:'center', marginBottom:10 },
  appIcon: { fontSize:26 },
  appName: { fontSize:15, fontWeight:700, color:'#1e293b' },
  appSub: { fontSize:11, color:'#94a3b8', marginTop:1 },
  appSaving: { textAlign:'right' },
  appSavingN: { fontSize:22, fontWeight:800, color:'#16a34a' },
  appSavingL: { fontSize:10, color:'#94a3b8' },
  appBest: { display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:6 },
  appBestLbl: { fontSize:11, color:'#15803d', fontWeight:700 },
  greenChip: { background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'3px 9px', fontSize:12, color:'#15803d', fontWeight:700 },
  appWorst: { display:'flex', alignItems:'center', gap:6 },
  appWorstLbl: { fontSize:11, color:'#dc2626', fontWeight:700 },
  redChip: { background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8, padding:'3px 9px', fontSize:12, color:'#dc2626', fontWeight:700 },
  appWorstNote: { fontSize:11, color:'#94a3b8' },
  // Yearly styles
  statRow: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 },
  statCard: { background:'#fff', border:'1px solid #e2e8f0', borderRadius:10, padding:'8px 10px', textAlign:'center' },
  statLabel: { fontSize:10, color:'#94a3b8' },
  statVal: { fontSize:20, fontWeight:800 },
  statMonth: { fontSize:10, color:'#94a3b8' },
  chartWrap: { background:'#fff', border:'1px solid #e2e8f0', borderRadius:12, padding:'12px', marginBottom:12 },
  chartLabel: { fontSize:10, color:'#94a3b8', marginBottom:6, display:'flex', alignItems:'center', gap:6 },
  legendDot: { display:'inline-block', width:10, height:10, borderRadius:2 },
  monthRow: { display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:'1px solid #f1f5f9' },
  monthName: { fontSize:12, fontWeight:700, color:'#1e293b', width:28 },
  monthBarBg: { flex:1, height:6, background:'#f1f5f9', borderRadius:3, overflow:'hidden' },
  monthBarFill: { height:'100%', borderRadius:3 },
  monthVal: { fontSize:13, fontWeight:700, width:34, textAlign:'right' },
  footer: { position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:400, background:'#ffffffee', borderTop:'1px solid #e2e8f0', padding:'10px 14px 12px', backdropFilter:'blur(10px)', fontSize:10, color:'#94a3b8', textAlign:'center', zIndex:10 },
};
