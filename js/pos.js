// ── POS Analytics ──────────────────────────────────────────────────
// Modalità: today | yesterday | weekend | week | month

let posDateMode = 'yesterday';

// Utility date
function toISO(d) { return d.toISOString().slice(0,10); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function dayName(iso) {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[new Date(iso+'T12:00:00').getDay()];
}
function dayNameIT(iso) {
  const days = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  return days[new Date(iso+'T12:00:00').getDay()];
}

function getPeriod(mode) {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayISO = toISO(today);
  const dow = today.getDay(); // 0=Sun

  if (mode === 'today') {
    return { from: todayISO, to: todayISO, label: 'Oggi', compareLabel: null, compareDates: [] };
  }

  if (mode === 'yesterday') {
    const yest = addDays(today, -1);
    const yestISO = toISO(yest);
    const yDow = yest.getDay();
    // last 8 occurrences of same weekday (excluding yesterday itself)
    const compareDates = [];
    for (let w = 1; w <= 12 && compareDates.length < 8; w++) {
      const d = toISO(addDays(yest, -7*w));
      compareDates.push(d);
    }
    return {
      from: yestISO, to: yestISO,
      label: `Ieri — ${dayNameIT(yestISO)}`,
      compareLabel: `Avg ${dayNameIT(yestISO)}`,
      compareDates,
      singleDay: true
    };
  }

  if (mode === 'weekend') {
    // last Fri+Sat+Sun
    const lastFri = addDays(today, -(((dow + 2) % 7) + 1));
    const lastSun = addDays(lastFri, 2);
    const friISO = toISO(lastFri);
    const sunISO = toISO(lastSun);
    // previous 8 weekends
    const compareDates = [];
    for (let w = 1; w <= 8; w++) {
      compareDates.push(toISO(addDays(lastFri, -7*w)));
      compareDates.push(toISO(addDays(addDays(lastFri,-7*w), 1)));
      compareDates.push(toISO(addDays(addDays(lastFri,-7*w), 2)));
    }
    return {
      from: friISO, to: sunISO,
      label: `Weekend ${friISO.slice(5)}–${sunISO.slice(5)}`,
      compareLabel: 'Avg weekend',
      compareDates
    };
  }

  if (mode === 'week') {
    return { from: toISO(addDays(today,-6)), to: todayISO, label: 'Ultimi 7 giorni', compareLabel: null, compareDates: [] };
  }

  if (mode === 'month') {
    return { from: toISO(addDays(today,-29)), to: todayISO, label: 'Ultimi 30 giorni', compareLabel: null, compareDates: [] };
  }
}

async function loadPOS() {
  const sec = document.getElementById('vx');
  if (!sec || sec.classList.contains('hidden')) return;
  sec.innerHTML = `<div class="flex items-center justify-center h-40 text-slate-400 text-sm">Caricamento…</div>`;

  try {
    const sb = window.supabaseClient;
    const period = getPeriod(posDateMode);

    // ── fetch main period daily summary
    const { data: days } = await sb.from('pos_daily_summary')
      .select('*')
      .gte('sale_date', period.from)
      .lte('sale_date', period.to)
      .order('sale_date', { ascending: false });

    // ── fetch compare period (if any)
    let compareDays = [];
    if (period.compareDates && period.compareDates.length > 0) {
      const { data: cd } = await sb.from('pos_daily_summary')
        .select('*')
        .in('sale_date', period.compareDates);
      compareDays = cd || [];
    }

    // ── fetch sales by item (main period, non-historical only)
    const { data: items } = await sb.from('pos_sales_by_item')
      .select('menu_item,sales_category,menu_group,quantity,gross_sales,net_sales')
      .gte('sale_date', period.from)
      .lte('sale_date', period.to)
      .eq('is_historical', false);

    // ── aggregate main
    const d = days || [];
    const totalRevenue  = d.reduce((s,x) => s+(x.net_sales||0), 0);
    const totalCovers   = d.reduce((s,x) => s+(x.bill_count||0), 0);
    const totalDisc     = d.reduce((s,x) => s+(x.discounts||0), 0);
    const totalFoodCost = d.reduce((s,x) => s+(x.food_cost||0), 0);
    const avgCheck      = totalCovers > 0 ? totalRevenue/totalCovers : 0;
    const foodCostPct   = totalRevenue > 0 ? (totalFoodCost/totalRevenue)*100 : 0;
    const nDays         = d.length || 1;

    // ── aggregate compare
    let cmpHtml = '';
    if (compareDays.length > 0) {
      const cDays = compareDays.length;
      // for single-day compare (yesterday mode), divide by number of occurrences
      const divisor = posDateMode === 'yesterday' ? cDays : Math.max(cDays/3, 1);
      const cRevAvg   = compareDays.reduce((s,x)=>s+(x.net_sales||0),0) / divisor;
      const cCovAvg   = compareDays.reduce((s,x)=>s+(x.bill_count||0),0) / divisor;
      const cCheckAvg = cCovAvg > 0 ? cRevAvg/cCovAvg : 0;
      const cFcAvg    = compareDays.reduce((s,x)=>s+(x.food_cost||0),0) / divisor;
      const cFcPct    = cRevAvg > 0 ? (cFcAvg/cRevAvg)*100 : 0;

      const revDiff  = totalRevenue > 0 && cRevAvg > 0 ? ((totalRevenue-cRevAvg)/cRevAvg*100) : null;
      const covDiff  = totalCovers > 0 && cCovAvg > 0  ? ((totalCovers-cCovAvg)/cCovAvg*100)  : null;

      const arrow = (v) => v === null ? '' : v >= 0
        ? `<span class="text-emerald-600 text-[10px]">▲ ${Math.abs(v).toFixed(0)}%</span>`
        : `<span class="text-red-500 text-[10px]">▼ ${Math.abs(v).toFixed(0)}%</span>`;

      cmpHtml = `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">${period.compareLabel} (${cDays} occorrenze)</p>
          <div class="grid grid-cols-3 gap-3">
            <div class="text-center">
              <p class="text-[10px] text-slate-400">Revenue</p>
              <p class="text-sm font-bold text-slate-600">${fmt(cRevAvg)}</p>
              ${arrow(revDiff)}
            </div>
            <div class="text-center">
              <p class="text-[10px] text-slate-400">Coperti</p>
              <p class="text-sm font-bold text-slate-600">${Math.round(cCovAvg)}</p>
              ${arrow(covDiff)}
            </div>
            <div class="text-center">
              <p class="text-[10px] text-slate-400">Check medio</p>
              <p class="text-sm font-bold text-slate-600">${fmtD(cCheckAvg)}</p>
            </div>
          </div>
          <p class="text-[10px] text-slate-400 mt-2 text-center">Food cost avg: ${cFcPct.toFixed(1)}%</p>
        </div>`;
    }

    // ── top sellers
    const itemMap = {};
    (items||[]).forEach(r => {
      const k = r.menu_item;
      if (!itemMap[k]) itemMap[k] = { name:k, cat:r.sales_category, qty:0, rev:0 };
      itemMap[k].qty += Number(r.quantity)||0;
      itemMap[k].rev += Number(r.gross_sales)||0;
    });
    const topItems = Object.values(itemMap).filter(x=>x.rev>0).sort((a,b)=>b.rev-a.rev).slice(0,10);

    // ── category breakdown
    const catMap = {};
    (items||[]).forEach(r => {
      const c = r.sales_category||'Other';
      catMap[c] = (catMap[c]||0) + (Number(r.gross_sales)||0);
    });
    const cats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]);

    // ── trend bars (week/month)
    let trendHtml = '';
    if (['week','month','weekend'].includes(posDateMode) && d.length > 1) {
      const sorted = [...d].sort((a,b)=>a.sale_date.localeCompare(b.sale_date));
      const maxRev = Math.max(...sorted.map(x=>x.net_sales||0));
      trendHtml = `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Andamento Revenue</p>
          <div class="flex items-end gap-1 h-20">
            ${sorted.map(x => {
              const h = maxRev > 0 ? Math.round(((x.net_sales||0)/maxRev)*76) : 3;
              return `<div class="flex-1 flex flex-col items-center gap-0.5 group relative">
                <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">${fmt(x.net_sales||0)}</div>
                <div style="height:${h}px;background:#059669;border-radius:2px 2px 0 0;width:100%;min-height:3px;"></div>
                <span class="text-[8px] text-slate-400 leading-none">${x.sale_date.slice(5)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // ── no items message
    const noItems = topItems.length === 0
      ? `<div class="glass-card p-4 text-center text-slate-400 text-sm">Nessun dato articoli.<br><span class="text-xs">I CSV arrivano via email ogni mattina.</span></div>`
      : '';

    const catColors = { Food:'#059669', Alcohol:'#7c3aed', Wine:'#dc2626', Beer:'#d97706' };

    sec.innerHTML = `
      <div class="px-3 pt-3 pb-24 space-y-3">

        <!-- Selector -->
        <div class="flex gap-1.5">
          ${['yesterday','today','weekend','week','month'].map(m => {
            const labels = { today:'Oggi', yesterday:'Ieri', weekend:'Weekend', week:'7 gg', month:'30 gg' };
            const active = posDateMode === m;
            return `<button onclick="posSetMode('${m}')" class="flex-1 text-[11px] font-medium py-2 rounded-xl transition-all ${active ? 'text-white shadow-sm' : 'text-slate-500 bg-white/60'}" style="${active ? 'background:#059669' : ''}">${labels[m]}</button>`;
          }).join('')}
        </div>

        <!-- Period label -->
        <p class="text-xs text-slate-500 font-medium px-1">${period.label}</p>

        <!-- KPI Cards -->
        <div class="grid grid-cols-2 gap-2">
          <div class="glass-card p-3">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Revenue netto</p>
            <p class="text-xl font-bold text-emerald-700">${fmt(totalRevenue)}</p>
            ${nDays > 1 ? `<p class="text-[10px] text-slate-400">avg/giorno ${fmt(totalRevenue/nDays)}</p>` : ''}
          </div>
          <div class="glass-card p-3">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Coperti</p>
            <p class="text-xl font-bold text-slate-700">${totalCovers}</p>
            <p class="text-[10px] text-slate-400">Check medio ${fmtD(avgCheck)}</p>
          </div>
          <div class="glass-card p-3">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Food cost</p>
            <p class="text-xl font-bold ${foodCostPct>35?'text-red-600':'text-slate-700'}">${foodCostPct.toFixed(1)}%</p>
            <p class="text-[10px] text-slate-400">${fmt(totalFoodCost)}</p>
          </div>
          <div class="glass-card p-3">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Sconti</p>
            <p class="text-xl font-bold text-amber-600">${fmt(totalDisc)}</p>
            <p class="text-[10px] text-slate-400">${totalRevenue>0?((totalDisc/(totalRevenue+totalDisc))*100).toFixed(1)+'%':'—'} del lordo</p>
          </div>
        </div>

        ${cmpHtml}
        ${trendHtml}
        ${noItems}

        <!-- Top Sellers -->
        ${topItems.length > 0 ? `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Top 10 per Revenue</p>
          <div class="space-y-2">
            ${topItems.map((it,i) => {
              const bw = topItems[0].rev > 0 ? Math.round((it.rev/topItems[0].rev)*100) : 0;
              const col = catColors[it.cat]||'#64748b';
              return `<div>
                <div class="flex justify-between items-baseline mb-0.5">
                  <span class="text-xs font-medium text-slate-700 truncate max-w-[62%]">${i+1}. ${it.name}</span>
                  <span class="text-xs font-bold text-slate-800">${fmt(it.rev)}</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div style="width:${bw}%;background:${col};height:100%;border-radius:999px;transition:width 0.4s"></div>
                  </div>
                  <span class="text-[10px] text-slate-400 w-10 text-right">${it.qty}x</span>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Categoria breakdown -->
        ${cats.length > 0 ? `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Per categoria</p>
          <div class="space-y-2">
            ${cats.map(([cat,rev]) => {
              const col = catColors[cat]||'#64748b';
              const pct = totalRevenue>0?((rev/totalRevenue)*100).toFixed(1):0;
              return `<div class="flex items-center gap-2">
                <span class="text-[10px] w-14 text-slate-500 truncate">${cat}</span>
                <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div style="width:${pct}%;background:${col};height:100%;border-radius:999px;"></div>
                </div>
                <span class="text-xs font-semibold text-slate-700 w-14 text-right">${fmt(rev)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Daily log -->
        ${d.length > 0 ? `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Giornate</p>
          <div class="space-y-2">
            ${d.map(x => `
              <div class="flex items-center justify-between py-1 border-b border-slate-50 last:border-0">
                <div>
                  <p class="text-xs font-medium text-slate-700">${dayNameIT(x.sale_date)} ${x.sale_date.slice(5)}</p>
                  <p class="text-[10px] text-slate-400">${x.bill_count||'—'} cop · check ${x.bill_count?fmtD((x.net_sales||0)/x.bill_count):'—'}</p>
                </div>
                <p class="text-sm font-bold text-emerald-700">${fmt(x.net_sales||0)}</p>
              </div>`).join('')}
          </div>
        </div>` : ''}

      </div>`;

  } catch(err) {
    console.error('POS error:', err);
    document.getElementById('vx').innerHTML = `<div class="px-3 pt-4 text-red-500 text-sm">Errore: ${err.message}</div>`;
  }
}

function fmt(n)  { return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); }
function fmtD(n) { return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function posSetMode(m) {
  posDateMode = m;
  loadPOS();
}
