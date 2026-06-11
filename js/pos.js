// ── POS Analytics ──────────────────────────────────────────────────
// Legge pos_daily_summary e pos_sales_by_item da Supabase
// e costruisce la dashboard nella sezione #vx

let posDateMode = 'today'; // 'today' | 'week' | 'month'

async function loadPOS() {
  const sec = document.getElementById('vx');
  if (!sec || sec.classList.contains('hidden')) return;

  sec.innerHTML = `<div class="flex items-center justify-center h-40 text-slate-400 text-sm">Caricamento…</div>`;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

    const from = posDateMode === 'today' ? today
               : posDateMode === 'week'  ? weekAgo
               : monthAgo;

    // ── fetch daily summary
    const { data: days, error: e1 } = await window.supabaseClient
      .from('pos_daily_summary')
      .select('*')
      .gte('sale_date', from)
      .lte('sale_date', today)
      .order('sale_date', { ascending: false });

    if (e1) throw e1;

    // ── fetch sales by item
    const { data: items, error: e2 } = await window.supabaseClient
      .from('pos_sales_by_item')
      .select('menu_item,sales_category,menu_group,quantity,gross_sales,net_sales')
      .gte('sale_date', from)
      .lte('sale_date', today)
      .eq('is_historical', false);

    if (e2) throw e2;

    // ── fetch modifiers
    const { data: mods, error: e3 } = await window.supabaseClient
      .from('pos_modifiers')
      .select('modifier,quantity_sold')
      .gte('sale_date', from)
      .lte('sale_date', today)
      .eq('is_historical', false);

    // ── aggregate
    const totalRevenue  = days.reduce((s, d) => s + (d.net_sales || 0), 0);
    const totalCovers   = days.reduce((s, d) => s + (d.bill_count || 0), 0);
    const totalDisc     = days.reduce((s, d) => s + (d.discounts || 0), 0);
    const totalFoodCost = days.reduce((s, d) => s + (d.food_cost || 0), 0);
    const avgCheck      = totalCovers > 0 ? totalRevenue / totalCovers : 0;
    const foodCostPct   = totalRevenue > 0 ? (totalFoodCost / totalRevenue) * 100 : 0;

    // top sellers by revenue
    const itemMap = {};
    (items || []).forEach(r => {
      const k = r.menu_item;
      if (!itemMap[k]) itemMap[k] = { name: k, cat: r.sales_category, group: r.menu_group, qty: 0, rev: 0 };
      itemMap[k].qty += Number(r.quantity) || 0;
      itemMap[k].rev += Number(r.gross_sales) || 0;
    });
    const topItems = Object.values(itemMap)
      .filter(x => x.rev > 0)
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 10);

    // top by category
    const catMap = {};
    (items || []).forEach(r => {
      const c = r.sales_category || 'Other';
      catMap[c] = (catMap[c] || 0) + (Number(r.gross_sales) || 0);
    });
    const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

    // top modifiers
    const modMap = {};
    (mods || []).forEach(r => {
      modMap[r.modifier] = (modMap[r.modifier] || 0) + (Number(r.quantity_sold) || 0);
    });
    const topMods = Object.entries(modMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

    // ── render
    const fmt  = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const fmtD = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const periodLabel = posDateMode === 'today' ? 'Oggi'
                      : posDateMode === 'week'  ? 'Ultimi 7 giorni'
                      : 'Ultimi 30 giorni';

    const catColors = { Food:'#059669', Alcohol:'#7c3aed', Wine:'#dc2626', Beer:'#d97706' };

    // bar chart for daily trend (week/month)
    let trendHtml = '';
    if (posDateMode !== 'today' && days.length > 1) {
      const maxRev = Math.max(...days.map(d => d.net_sales || 0));
      const sortedDays = [...days].sort((a, b) => a.sale_date.localeCompare(b.sale_date));
      trendHtml = `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Andamento Revenue</p>
          <div class="flex items-end gap-1 h-20">
            ${sortedDays.map(d => {
              const h = maxRev > 0 ? Math.round(((d.net_sales || 0) / maxRev) * 80) : 4;
              const label = d.sale_date.slice(5); // MM-DD
              return `<div class="flex-1 flex flex-col items-center gap-1 group relative">
                <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] rounded px-1 py-0.5 opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">${fmt(d.net_sales||0)}</div>
                <div style="height:${h}px;background:#059669;border-radius:2px 2px 0 0;width:100%;min-height:3px;"></div>
                <span class="text-[8px] text-slate-400">${label}</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    // no data for today's items? show message
    const noItemsMsg = topItems.length === 0
      ? `<div class="text-center text-slate-400 text-sm py-4">Nessun dato articoli per questo periodo.<br><span class="text-xs">I CSV giornalieri arrivano via email la mattina.</span></div>`
      : '';

    sec.innerHTML = `
      <div class="px-3 pt-3 pb-24 space-y-3">

        <!-- Selector -->
        <div class="flex gap-2">
          ${['today','week','month'].map(m => {
            const label = m==='today'?'Oggi':m==='week'?'7 giorni':'30 giorni';
            const active = posDateMode === m;
            return `<button onclick="posSetMode('${m}')" class="flex-1 text-xs font-medium py-2 rounded-xl transition-all ${active ? 'text-white' : 'text-slate-500 bg-white/60'}" style="${active ? 'background:#059669' : ''}">${label}</button>`;
          }).join('')}
        </div>

        <!-- KPI Cards -->
        <div class="grid grid-cols-2 gap-2">
          <div class="glass-card p-3 space-y-0.5">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Revenue netto</p>
            <p class="text-xl font-bold text-emerald-700">${fmt(totalRevenue)}</p>
            <p class="text-[10px] text-slate-400">${periodLabel}</p>
          </div>
          <div class="glass-card p-3 space-y-0.5">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Coperti</p>
            <p class="text-xl font-bold text-slate-700">${totalCovers.toLocaleString()}</p>
            <p class="text-[10px] text-slate-400">Check medio ${fmtD(avgCheck)}</p>
          </div>
          <div class="glass-card p-3 space-y-0.5">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Food cost</p>
            <p class="text-xl font-bold ${foodCostPct > 35 ? 'text-red-600' : 'text-slate-700'}">${foodCostPct.toFixed(1)}%</p>
            <p class="text-[10px] text-slate-400">${fmt(totalFoodCost)}</p>
          </div>
          <div class="glass-card p-3 space-y-0.5">
            <p class="text-[10px] text-slate-500 uppercase tracking-wide">Sconti</p>
            <p class="text-xl font-bold text-amber-600">${fmt(totalDisc)}</p>
            <p class="text-[10px] text-slate-400">${totalRevenue > 0 ? ((totalDisc/(totalRevenue+totalDisc))*100).toFixed(1)+'%' : '—'} del lordo</p>
          </div>
        </div>

        ${trendHtml}

        ${noItemsMsg}

        <!-- Top Sellers -->
        ${topItems.length > 0 ? `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Top 10 per Revenue</p>
          <div class="space-y-2">
            ${topItems.map((it, i) => {
              const barW = topItems[0].rev > 0 ? Math.round((it.rev / topItems[0].rev) * 100) : 0;
              const col = catColors[it.cat] || '#64748b';
              return `<div>
                <div class="flex justify-between items-baseline mb-0.5">
                  <span class="text-xs font-medium text-slate-700 truncate max-w-[60%]">${i+1}. ${it.name}</span>
                  <span class="text-xs font-bold text-slate-800">${fmt(it.rev)}</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div style="width:${barW}%;background:${col};height:100%;border-radius:999px;transition:width 0.4s"></div>
                  </div>
                  <span class="text-[10px] text-slate-400 w-12 text-right">${it.qty}x</span>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Revenue per categoria -->
        ${cats.length > 0 ? `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Revenue per categoria</p>
          <div class="space-y-2">
            ${cats.map(([cat, rev]) => {
              const col = catColors[cat] || '#64748b';
              const pct = totalRevenue > 0 ? ((rev/totalRevenue)*100).toFixed(1) : 0;
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

        <!-- Top Modifiers -->
        ${topMods.length > 0 ? `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Addons più richiesti</p>
          <div class="flex flex-wrap gap-2">
            ${topMods.map(([mod, qty]) =>
              `<div class="flex items-center gap-1 bg-violet-50 border border-violet-100 rounded-full px-3 py-1">
                <span class="text-xs text-violet-700 font-medium">${mod}</span>
                <span class="text-[10px] text-violet-400">${qty}x</span>
              </div>`
            ).join('')}
          </div>
        </div>` : ''}

        <!-- Daily log -->
        ${days.length > 0 ? `
        <div class="glass-card p-4">
          <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Giornate</p>
          <div class="space-y-2">
            ${days.map(d => `
              <div class="flex items-center justify-between py-1 border-b border-slate-50 last:border-0">
                <div>
                  <p class="text-xs font-medium text-slate-700">${d.day_of_week} ${d.sale_date.slice(5)}</p>
                  <p class="text-[10px] text-slate-400">${d.bill_count || '—'} coperti · check medio ${d.bill_count ? fmtD((d.net_sales||0)/d.bill_count) : '—'}</p>
                </div>
                <p class="text-sm font-bold text-emerald-700">${fmt(d.net_sales||0)}</p>
              </div>`).join('')}
          </div>
        </div>` : ''}

      </div>`;
  } catch(err) {
    console.error('POS load error:', err);
    sec.innerHTML = `<div class="px-3 pt-4 text-red-500 text-sm">Errore caricamento dati POS: ${err.message}</div>`;
  }
}

function posSetMode(m) {
  posDateMode = m;
  loadPOS();
}
