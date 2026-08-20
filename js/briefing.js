// ── BRIEFING AI ──
async function loadBriefing(){
  const el=document.getElementById('briefingContent');
  if(!el) return;
  el.innerHTML='<div class="animate-pulse h-4 bg-slate-100 rounded w-3/4"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-full mt-2"></div><div class="animate-pulse h-4 bg-slate-100 rounded w-2/3 mt-2"></div>';
  try{
    const today=getNowDallas().toLocaleDateString('en-CA');
    const{data:briefing}=await supa.from('briefing').select('*').eq('date',today).maybeSingle();
    if(!briefing||!briefing.points||!briefing.points.length){
      el.innerHTML='<p class="text-sm text-slate-400">'+tr('briefingEmpty')+'</p>';
      return;
    }
    const icons=['🔴','🟡','🔵'];
    const lang=user&&user.lang?user.lang:'it';
    const isAdmin_flag=typeof isAdmin==='function'&&isAdmin();
    // Legge colonna gia tradotta dal DB --- zero chiamate ai-translate
    var points;
    if(isAdmin_flag){
      if(lang==='en'&&briefing.points_en&&briefing.points_en.length) points=briefing.points_en;
      else if(lang==='es'&&briefing.points_es&&briefing.points_es.length) points=briefing.points_es;
      else points=briefing.points;
    } else {
      const staffPts=briefing.points_staff&&briefing.points_staff.length?briefing.points_staff:briefing.points;
      if(lang==='en'&&briefing.points_staff_en&&briefing.points_staff_en.length) points=briefing.points_staff_en;
      else if(lang==='es'&&briefing.points_staff_es&&briefing.points_staff_es.length) points=briefing.points_staff_es;
      else points=staffPts;
    }
    el.innerHTML=(points||[]).map(function(p,i){
      return '<div class="flex gap-2 items-start py-1">'+
      '<span class="text-sm mt-0.5 flex-shrink-0">'+(icons[i]||'•')+'</span>'+
      '<p class="text-sm text-slate-700 leading-snug">'+p+'</p>'+
      '</div>';
    }).join('');
  }catch(e){
    el.innerHTML='<p class="text-sm text-red-500">'+tr('briefingError')+'</p>';
  }
}

async function refreshBriefing(){
  const today=new Date().toISOString().slice(0,10);
  await supa.from('briefing').delete().eq('date',today);
  loadBriefing();
}


// HOME TO-DO BLOCK (staff only)
// Feature flag — set to true to re-enable when Chef AI suggestions are reliable
var HOME_TODO_ENABLED = false; // hotfix: hidden until suggestion-selection logic is fixed

function renderHomeTodo() {
  var el = document.getElementById('homeTodoList');
  if (!el) return;
  // Feature-flag early exit — hides widget, clears any stale rows, returns immediately
  if (!HOME_TODO_ENABLED) {
    var _w = document.getElementById('homeTodoWidget');
    if (_w) { _w.style.display = 'none'; el.innerHTML = ''; }
    return;
  }
  var _isAdmin = typeof isAdmin === 'function' && isAdmin();
  if (!user || !user.default_station || _isAdmin) {
    var widgetHide = document.getElementById('homeTodoWidget');
    if (widgetHide) widgetHide.style.display = 'none';
    return;
  }
  var userStation = user.default_station;
  var stationItems = (items || []).filter(function(i) {
    return !i.archived && i.category === userStation &&
      (typeof isActionableCard === 'function' ? isActionableCard(i) : i.need_tomorrow);
  });
  function _todoScore(i) {
    if (i.in_progress) return 5;
    if (i.prep_type === 'checklist') return 1;
    var _sg = (window._suggestions || {})[i.id];
    if (_sg) {
      if (_sg.status === 'do_first')    return 5;
      if (_sg.status === 'prep_today')  return 4;
      if (_sg.status === 'count_first') return 3;
      if (_sg.status === 'looks_ok')    return 2;
    }
    if (i.suggested_note && i.suggested_note.includes('|')) {
      var col = i.suggested_note.split('|')[0];
      if (col === 'red')    return 4;
      if (col === 'yellow') return 3;
      if (col === 'green')  return 2;
    }
    return 0;
  }
  var sorted = stationItems.slice().sort(function(a, b) {
    var sa = _todoScore(a), sb = _todoScore(b);
    if (sb !== sa) return sb - sa;
    return a.name.localeCompare(b.name);
  });
  var widget = document.getElementById('homeTodoWidget');
  if (!widget) return;
  widget.style.display = 'block';
  if (!sorted.length) {
    el.innerHTML = '<div style="font-size:13px;color:#94a3b8;padding:4px 0;">' + tr('todo_empty') + '</div>';
    return;
  }
  el.innerHTML = sorted.slice(0, 5).map(function(i) {
    var _sg = (window._suggestions || {})[i.id];
    var _hasSugg = !!_sg;
    var _plannedOut = _hasSugg && _sg.planned_output != null ? _sg.planned_output : null;
    var _qtyRaw = _plannedOut != null ? parseFloat(_plannedOut)
      : (!_hasSugg && i.suggested_qty != null) ? parseFloat(i.suggested_qty)
      : i.average_qty != null ? parseFloat(i.average_qty)
      : null;
    var _unit = (_hasSugg && _sg.output_unit) ? _sg.output_unit : (i.unit || '');
    var _qtyStr = '';
    if (_qtyRaw != null && !isNaN(_qtyRaw) && _qtyRaw > 0) {
      _qtyStr = (_qtyRaw === Math.floor(_qtyRaw))
        ? String(Math.floor(_qtyRaw))
        : parseFloat(_qtyRaw.toFixed(2)).toString();
    }
    var _qtyPart = _qtyStr ? (' \u00b7\u202f' + _qtyStr + (_unit ? '\u202f' + _unit : '')) : '';
    // Batch equivalence — same logic as prep.js L807-809
    // Fields from window._suggestions: planned_output, minimum_increment, production_constraint_quality
    // No unit conversion needed: po and mi are always in the same canonical unit
    var _batchStr = '';
    if (_hasSugg && _sg.production_constraint_quality === 'valid_fixed_batch') {
      var _mi = _sg.minimum_increment != null ? parseFloat(_sg.minimum_increment) : 0;
      var _po = _plannedOut != null ? parseFloat(_plannedOut) : 0;
      if (_mi > 0 && _po > 0) {
        var _batchN = _po / _mi;
        var _batchFmt = (_batchN === Math.floor(_batchN))
          ? String(Math.floor(_batchN))
          : parseFloat(_batchN.toFixed(2)).toString();
        var _batchWord = parseFloat(_batchFmt) === 1
          ? (typeof tr === 'function' ? tr('todo_batch_s') : 'batch')
          : (typeof tr === 'function' ? tr('todo_batch_p') : 'batches');
        _batchStr = ' = ' + _batchFmt + '\u202f' + _batchWord;
      }
    }
    var _dotColor = '#cbd5e1';
    if (i.in_progress) { _dotColor = '#3b82f6'; }
    else if (_hasSugg) {
      if (_sg.status === 'do_first')         _dotColor = '#ef4444';
      else if (_sg.status === 'prep_today')  _dotColor = '#f59e0b';
      else if (_sg.status === 'count_first') _dotColor = '#8b5cf6';
    } else if (i.suggested_note && i.suggested_note.includes('|')) {
      var col2 = i.suggested_note.split('|')[0];
      if (col2 === 'red') _dotColor = '#ef4444';
      else if (col2 === 'yellow') _dotColor = '#f59e0b';
    }
    var _doneLabel = typeof tr === 'function' ? tr('prep_done') : 'DONE';
    var _ariaLabel = _doneLabel + ': ' + i.name;
    var _safeId = JSON.stringify(i.id);
    return ('<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);min-width:0;">'
      + '<button type="button"'
          + ' onclick="if(document.querySelector(\'[data-prep-done-sheet]\'))'  
          + '{return;}if(typeof window.prepDone===\'function\'){window.prepDone(' + _safeId + ');}"'
          + ' aria-label="' + _ariaLabel + '"'
          + ' style="flex-shrink:0;width:20px;height:20px;border-radius:4px;background:white;border:1.5px solid #94a3b8;cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent;">'
          + '</button>'
      + '<span style="font-size:14px;color:#1e3a5f;font-weight:400;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + i.name + '</span>'
      + (_qtyPart ? '<span style="font-size:13px;color:#60a5fa;font-weight:500;white-space:nowrap;flex-shrink:0;">' + _qtyPart + _batchStr + '</span>' : '')
      + '</div>');
  }).join('');
}

// ── HOME STATIONS ──
// Admin: tutte le stazioni in pill (#homeStations) — verdi/rosse
// Staff: top 3 propria stazione (#homeStationItems) + altre stazioni con item da fare (#homeOtherStations)
function renderHomeStations(){
  if (typeof renderHomeTodo === 'function') renderHomeTodo();
  // Tutte le categorie presenti in prep_tasks
  const allCats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort();

  if(isAdmin()){
    // ── ADMIN: pill tutte le stazioni ──
    const el=document.getElementById('homeStations');
    if(!el) return;
    if(!allCats.length){
      el.innerHTML='<p class="text-xs text-slate-400">'+tr('noStation')+'</p>';
      return;
    }
    el.innerHTML=allCats.map(s=>{
      const missing=items.filter(i=>i.need_tomorrow&&i.category===s).length;
      const label=s.replace(' Station','').replace('Station','');
      return '<div onclick="goToStation(\'' + s + '\')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer active:scale-95 transition ' + (missing>0?'bg-red-100 text-red-700 border border-red-200':'bg-green-100 text-green-700 border border-green-200') + '">' +
        '<span>'+label+'</span>' +
        (missing>0?'<span class="bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">'+missing+'</span>':'<span>✓</span>')+
        '</div>';
    }).join('');

  } else {
    // ── STAFF: Your Station (top 3 item) ──
    renderHomeStationItems();

    // ── STAFF: Other Stations — solo quelle con item da fare ──
    const otherEl=document.getElementById('homeOtherStations');
    if(!otherEl) return;

    const userStation=user?.default_station||null;

    // Tutte le stazioni esclusa la propria, con almeno 1 item need_tomorrow
    const otherCats=allCats.filter(s=>{
      if(s===userStation) return false;
      if(s==='Chiusura') return false;
      const hasTodo=items.some(i=>i.need_tomorrow&&i.category===s);
      return hasTodo;
    });

    if(!otherCats.length){
      otherEl.innerHTML='';
      otherEl.style.display='none';
      // Nascondi anche il label "Other Stations" se esiste
      const otherLabel=document.getElementById('homeOtherStationsLabel');
      if(otherLabel) otherLabel.style.display='none';
      return;
    }

    // Mostra label e pill
    const otherLabel=document.getElementById('homeOtherStationsLabel');
    if(otherLabel) otherLabel.style.display='block';
    otherEl.style.display='flex';

    otherEl.innerHTML=otherCats.map(s=>{
      const missing=items.filter(i=>i.need_tomorrow&&i.category===s).length;
      const label=s.replace(' Station','').replace('Station','');
      return '<div onclick="goToStation(\'' + s + '\')" class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer active:scale-95 transition bg-red-100 text-red-700 border border-red-200">' +
        '<span>'+label+'</span>' +
        '<span class="bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">'+missing+'</span>'+
        '</div>';
    }).join('');
  }
}

function goToStation(s){
  station=s;
  station2=s;
  document.querySelector('[data-t=m]').click();
}

// ── HOME STATION ITEMS (top 3 propria stazione — solo staff) ──
function renderHomeStationItems(){
  const el=document.getElementById('homeStationItems');
  if(!el) return;
  const userStation=user?.default_station||null;
  const stationFilter=userStation?userStation.replace(' Station',''):null;
  const stationItems=stationFilter
    ?items.filter(i=>i.category?.includes(stationFilter))
    :items.filter(i=>station!=='All'?i.category?.includes(station):true);

  if(!stationItems.length){
    el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No items for your station</div>';
    return;
  }

  const sorted=stationItems.sort((a,b)=>(b.need_tomorrow?1:0)-(a.need_tomorrow?1:0)).slice(0,3);
  el.style.maxHeight='120px';
  el.style.overflowY='auto';
  el.innerHTML=sorted.map(i=>{
    const color=i.need_tomorrow?'#b91c1c':i.in_progress?'#1d4ed8':'#1e3a5f';
    const dot=i.need_tomorrow?'#ef4444':i.in_progress?'#3B82F6':'transparent';
    const dotBorder=i.need_tomorrow||i.in_progress?'none':'0.5px solid #93c5fd';
    return '<div onclick="document.querySelector(\"[data-t=m]\").click()" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
      '<div style="width:7px;height:7px;border-radius:50%;background:'+dot+';border:'+dotBorder+';flex-shrink:0;"></div>'+
      '<span style="font-size:14px;color:'+color+';font-weight:'+(i.need_tomorrow?'500':'400')+';">'+i.name+'</span>'+
      (i.need_tomorrow?'<span style="margin-left:auto;font-size:10px;color:#ef4444;background:rgba(239,68,68,0.1);padding:2px 7px;border-radius:20px;">'+tr('daFare')+'</span>':'')+
      (i.in_progress&&!i.need_tomorrow?'<span style="margin-left:auto;font-size:10px;color:#3B82F6;">'+tr('inProgress')+'</span>':'')+
      '</div>';
  }).join('');
}

// ── Helpers comuni per filtro bevande ──
const _EXCL_GROUPS='("NA Beverages","Beverages","Mocktail","Beer","Common Cocktails","House Cocktails","Gin","Rum","Scotch","Tequila","Liqueurs","The Bar","Sparkling Wine BOTTLE","Sparkling Wine GLASS")';
const _EXCL_SALES_CAT='("Alcohol","Beer","Wine")';
const _EXCL_KEYWORDS=['tea','water','coffee','pepsi','coke','soda','beer','wine','liquor','spirit','cocktail','margarita','michelob','modelo','corona','seltzr','seltzer','lemonade','juice','milk','espresso','cappuccino'];

function _filterDrinks(itemsArr){
  return (itemsArr||[]).filter(i=>{
    const name=(i.menu_item||'').toLowerCase();
    return !_EXCL_KEYWORDS.some(k=>name.includes(k));
  });
}

// ── SERVICE UPDATES — Yesterday's Highlights (lun-sab) / Weekly Highlights (lunedì) ──
// Admin: bills + net sales (solo yesterday) + top piatti
// Staff: solo top piatti — zero dati finanziari — regola ferrea
// Lunedì: dati aggregati 7 giorni (lun precedente → dom)
async function loadServiceUpdates(){
  const el=document.getElementById('serviceUpdatesList');
  if(!el) return;
  try{
    const now=getNowDallas();
    const dow=now.toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'long'});
    const isMonday=dow==='Monday';

    if(isMonday){
      await _loadWeeklyHighlights(el);
    } else {
      await _loadYesterdayHighlights(el);
    }
  }catch(e){
    el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';
  }
}

// ── ADD-ON OPPORTUNITIES (Insights v2.1) ──────────────────────────────────
// Item-level modifier attach-rate vs a 30-day weighted historical baseline,
// using pos_modifier_by_item (already parent-item-linked, already in prod).
// Scope: item-level only. NOT check-level, NOT server-level, NOT guaranteed
// lost revenue — see final report for the evidence behind every number.
//
// Allowlist = smallest explicit set of modifiers proven to be paid add-ons
// with a reliable, context-independent unit price (near-zero stddev across
// hundreds of real occurrences and multiple parent items). Real production
// data is full of non-commercial "modifiers" (kitchen routing like "Fired at
// 7:05 PM", prep prefs like "No Glass"/"On the side", substitutions) that
// must never be shown as revenue opportunities — hence an explicit allowlist
// rather than any automatic classification.
const _ADDON_ALLOWLIST=[
  {modifier:'Add chicken',      unitPrice:7.00},
  {modifier:'Add shrimp',       unitPrice:10.00},
  {modifier:'Add salmon whole', unitPrice:15.00},
  {modifier:'Add half spaghetti',unitPrice:5.00},
];
const _ADDON_MIN_YESTERDAY_PARENT_QTY=5;   // avoid 1-of-2 dish noise
const _ADDON_MIN_HIST_PARENT_QTY=20;       // enough historical volume
const _ADDON_MIN_HIST_DAYS=3;              // enough distinct selling days
const _ADDON_MIN_MISSED_ATTACHES=1.0;      // below this, gap is statistical noise
const _ADDON_MAX_CARDS=3;

function _addDaysISO(str,n){ const d=new Date(str+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }

async function _computeAddOnOpportunities(yStr){
  const modNames=_ADDON_ALLOWLIST.map(a=>a.modifier);
  const priceMap={}; _ADDON_ALLOWLIST.forEach(a=>priceMap[a.modifier]=a.unitPrice);
  const histEnd=_addDaysISO(yStr,-1);           // day before yesterday
  const histStart=_addDaysISO(yStr,-30);         // 30-day trailing window, excludes yesterday

  // 1) Historical modifier occurrences → discover which parent items are candidates
  const{data:histModRows}=await supa.from('pos_modifier_by_item')
    .select('parent_item,modifier,quantity_sold,sale_date')
    .in('modifier',modNames)
    .gte('sale_date',histStart).lte('sale_date',histEnd);
  if(!histModRows||!histModRows.length) return [];

  const parentItems=[...new Set(histModRows.map(r=>r.parent_item))];

  // 2) Historical parent-item daily quantities (denominator), only real selling days
  const{data:histParentRows}=await supa.from('pos_sales_by_item')
    .select('menu_item,quantity,sale_date')
    .in('menu_item',parentItems)
    .gte('sale_date',histStart).lte('sale_date',histEnd)
    .gt('quantity',0);

  // 3) Yesterday actuals
  const{data:yModRows}=await supa.from('pos_modifier_by_item')
    .select('parent_item,modifier,quantity_sold')
    .eq('sale_date',yStr).in('modifier',modNames);
  const{data:yParentRows}=await supa.from('pos_sales_by_item')
    .select('menu_item,quantity')
    .eq('sale_date',yStr).in('menu_item',parentItems);

  // Aggregate historical parent qty/days per parent item
  const histParentAgg={}; // parent -> {qty, days:Set}
  (histParentRows||[]).forEach(r=>{
    if(!histParentAgg[r.menu_item]) histParentAgg[r.menu_item]={qty:0,days:new Set()};
    histParentAgg[r.menu_item].qty+=Number(r.quantity)||0;
    histParentAgg[r.menu_item].days.add(r.sale_date);
  });
  // Aggregate historical modifier qty per (parent,modifier)
  const histModAgg={}; // "parent|modifier" -> qty
  (histModRows||[]).forEach(r=>{
    const k=r.parent_item+'|'+r.modifier;
    histModAgg[k]=(histModAgg[k]||0)+(Number(r.quantity_sold)||0);
  });
  const yParentMap={}; (yParentRows||[]).forEach(r=>{ yParentMap[r.menu_item]=Number(r.quantity)||0; });
  const yModMap={}; (yModRows||[]).forEach(r=>{ const k=r.parent_item+'|'+r.modifier; yModMap[k]=(yModMap[k]||0)+(Number(r.quantity_sold)||0); });

  // Distinct (parent,modifier) candidate pairs from historical data
  const pairs=[...new Set(histModRows.map(r=>r.parent_item+'|'+r.modifier))];

  const opportunities=[];
  for(const key of pairs){
    const[parent,modifier]=key.split('|');
    const yParentQty=yParentMap[parent]||0;
    if(yParentQty<_ADDON_MIN_YESTERDAY_PARENT_QTY) continue;
    const hp=histParentAgg[parent];
    if(!hp||hp.qty<_ADDON_MIN_HIST_PARENT_QTY||hp.days.size<_ADDON_MIN_HIST_DAYS) continue;
    const histModQty=histModAgg[key]||0;
    const histAttachRate=histModQty/hp.qty;
    const yModQty=yModMap[key]||0;
    const yAttachRate=yModQty/yParentQty;
    const expectedAttaches=histAttachRate*yParentQty;
    const missedAttaches=Math.max(0,expectedAttaches-yModQty);
    if(missedAttaches<_ADDON_MIN_MISSED_ATTACHES) continue;
    if(histAttachRate<=yAttachRate) continue; // yesterday already at/above baseline — not an opportunity (T6)
    opportunities.push({
      parent,modifier,yParentQty,yModQty,yAttachRate,
      histParentQty:hp.qty,histModQty,histDays:hp.days.size,histAttachRate,
      missedAttaches,
      dollarOpportunity:missedAttaches*priceMap[modifier], // allowlist prices are pre-validated reliable — see report
    });
  }
  opportunities.sort((a,b)=>b.missedAttaches-a.missedAttaches);
  return opportunities.slice(0,_ADDON_MAX_CARDS);
}

function _renderAddOnOpportunities(opps){
  if(!opps||!opps.length){
    return '<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No significant add-on opportunities detected yesterday.</div>';
  }
  const header='<div style="font-size:10px;font-weight:600;color:#f59e0b;letter-spacing:.06em;text-transform:uppercase;padding:2px 0 6px;">Opportunities</div>';
  const cards=opps.map(o=>{
    const yPct=(o.yAttachRate*100).toFixed(0);
    const hPct=(o.histAttachRate*100).toFixed(0);
    const missedRounded=Math.round(o.missedAttaches);
    const missedText=missedRounded<1?'~1':'~'+missedRounded;
    const dollarLine=(o.dollarOpportunity&&o.dollarOpportunity>=1)
      ? '<div style="font-size:12px;color:#059669;font-weight:600;margin-top:2px;">Potential opportunity: ~$'+Math.round(o.dollarOpportunity)+'</div>'
      : '';
    return '<div style="padding:7px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
      '<div style="font-size:13px;color:#1e3a5f;font-weight:600;">🟠 '+o.parent+' · '+o.modifier.replace(/^Add /,'')+'</div>'+
      '<div style="font-size:12px;color:#64748b;margin-top:2px;">'+yPct+'% yesterday vs '+hPct+'% recent baseline</div>'+
      '<div style="font-size:12px;color:#64748b;">'+missedText+' more add-ons would have matched normal performance</div>'+
      dollarLine+
      '</div>';
  }).join('');
  return header+cards;
}

// ── YESTERDAY highlights (martedì–sabato) ──
async function _loadYesterdayHighlights(el){
  const now=getNowDallas();
  const yesterday=new Date(now);
  yesterday.setDate(yesterday.getDate()-1);
  const yStr=yesterday.toLocaleDateString('en-CA');

  const{data:summary}=await supa.from('pos_daily_summary')
    .select('sale_date,bill_count,net_sales')
    .eq('sale_date',yStr)
    .maybeSingle();

  // Fallback su service_updates se nessun dato POS
  if(!summary){
    const{data:updates}=await supa.from('service_updates')
      .select('*').order('created_at',{ascending:false}).limit(3);
    if(!updates||!updates.length){
      el.innerHTML='<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';
      return;
    }
    el.innerHTML=updates.map(u=>{
      const color=u.level==='urgent'?'#ef4444':u.level==='warning'?'#f59e0b':'#3B82F6';
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;">'+
        '<div style="width:7px;height:7px;border-radius:50%;background:'+color+';flex-shrink:0;margin-top:4px;"></div>'+
        '<span style="font-size:13px;color:#1e3a5f;flex:1;line-height:1.4;">'+u.message+'</span>'+
        '</div>';
    }).join('');
    return;
  }

  // Admin: net sales ieri (bill count rimosso — duplicato con Briefing AI/altrove)
  const rows=[];
  if(typeof isAdmin==='function'&&isAdmin()&&summary){
    const sales=parseFloat(summary.net_sales||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
    rows.push(
      '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
      '<span style="font-size:15px;">💰</span>'+
      '<span style="font-size:13px;color:#1e3a5f;font-weight:600;">'+sales+'</span>'+
      '</div>'
    );
  }

  // Tutti: add-on opportunities reali (sostituisce la lista "top 3 piatti" duplicata)
  let opps=[];
  try{ opps=await _computeAddOnOpportunities(yStr); }catch(e){ console.error('[opportunities]',e); }
  rows.push(_renderAddOnOpportunities(opps));

  el.innerHTML=rows.length?rows.join(''):'<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No updates</div>';

}

// ── WEEKLY highlights (lunedì) — ultimi 7 giorni aggregati ──
async function _loadWeeklyHighlights(el){
  const now=getNowDallas();
  // Domenica scorsa (ieri) → lunedì scorso (7 giorni fa)
  const endDate=new Date(now);
  endDate.setDate(endDate.getDate()-1); // ieri = domenica
  const startDate=new Date(endDate);
  startDate.setDate(startDate.getDate()-6); // 7 giorni totali lun–dom
  const startStr=startDate.toLocaleDateString('en-CA');
  const endStr=endDate.toLocaleDateString('en-CA');

  // Admin: totale bills settimana (no net_sales — troppo finanziario per il widget)
  // Tutti: top 3 piatti aggregati
  const[summaryRes, posRes]=await Promise.all([
    supa.from('pos_daily_summary')
      .select('bill_count')
      .gte('sale_date',startStr)
      .lte('sale_date',endStr),
    supa.from('pos_sales_by_item')
      .select('menu_item,quantity')
      .gte('sale_date',startStr)
      .lte('sale_date',endStr)
      .not('menu_group','in',_EXCL_GROUPS)
      .not('sales_category','in',_EXCL_SALES_CAT)
      .lt('quantity',1000)
  ]);

  const summaryRows=summaryRes.data||[];
  const posItems=_filterDrinks(posRes.data||[]);

  // Aggrega quantità per piatto
  const totals={};
  posItems.forEach(function(r){
    totals[r.menu_item]=(totals[r.menu_item]||0)+Number(r.quantity||0);
  });
  const sorted=Object.entries(totals)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,3);

  const rows=[];
  const medals=['🥇','🥈','🥉'];

  // Admin: totale bills settimana
  if(typeof isAdmin==='function'&&isAdmin()&&summaryRows.length){
    const totalBills=summaryRows.reduce((s,r)=>s+(r.bill_count||0),0);
    rows.push(
      '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
      '<span style="font-size:15px;">🧾</span>'+
      '<span style="font-size:13px;color:#1e3a5f;font-weight:600;">'+totalBills+' bills</span>'+
      '<span style="font-size:12px;color:#64748b;">this week</span>'+
      '</div>'
    );
  }

  // Tutti: top 3 piatti settimana
  if(sorted.length){
    sorted.forEach(function([name,qty],i){
      rows.push(
        '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
        '<span style="font-size:15px;">'+medals[i]+'</span>'+
        '<span style="font-size:13px;color:#1e3a5f;font-weight:500;">'+name+'</span>'+
        '<span style="margin-left:auto;font-size:12px;color:#60a5fa;font-weight:600;">'+qty+' pcs</span>'+
        '</div>'
      );
    });
  }

  el.innerHTML=rows.length?rows.join(''):'<div style="font-size:12px;color:#93c5fd;padding:4px 0;">No data this week</div>';
}

// ── UPCOMING DEMAND — legge tabella events (TripleSeat) ──
async function loadUpcomingDemand(){
  const el=document.getElementById('upcomingDemand');
  const section=document.getElementById('upcomingDemandSection');
  const headerEl=document.getElementById('homeUpcomingLabel');
  if(!el) return;
  try{
    const today=getNowDallas().toLocaleDateString('en-CA');
    const{data}=await supa.from('events')
      .select('id,name,event_date,event_time,guest_count,service_style,location,room_name,event_recipes,status')
      .gte('event_date',today)
      .order('event_date',{ascending:true})
      .limit(5);
    if(!data||!data.length){
      if(section) section.style.display='none';
      else el.closest('div[style]') && (el.style.display='none');
      return;
    }
    if(section) section.style.display='';
    el.style.display='';
    // Header cliccabile — apre il calendario completo
    if(headerEl){
      headerEl.style.cursor='pointer';
      headerEl.title=tr('view_all_arrow');
      headerEl.onclick=()=>{ if(typeof showCalendar==='function') showCalendar(); };
    }
    const isAdm=typeof isAdmin==='function'&&isAdmin();
    el.innerHTML=data.map(e=>{
      const d=new Date(e.event_date+'T12:00:00');
      const dayStr=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
      const timeStr=e.event_time?e.event_time.slice(0,5):'';
      const loc=e.location||e.room_name||'';
      const svc=e.service_style||'';
      const recipes=Array.isArray(e.event_recipes)?e.event_recipes:[];
      const statusColor={confirmed:'#059669',tentative:'#f59e0b',cancelled:'#ef4444'}[e.status]||'#94a3b8';
      let recHtml='';
      if(recipes.length){
        recHtml='<div style="margin-top:4px;padding-top:4px;border-top:0.5px solid rgba(59,130,246,0.06);">'+
          recipes.slice(0,3).map(r=>
            '<div style="font-size:11px;color:#475569;padding:1px 0;">• '+
            (r.recipe_title||r.name||'')+
            (r.portions?' <span style="color:#94a3b8;">'+r.portions+' '+tr('event_portions')+'</span>':'')+
            '</div>'
          ).join('')+
          (recipes.length>3?'<div style="font-size:10px;color:#94a3b8;">+'+(recipes.length-3)+' '+tr('event_more')+'</div>':'')+
        '</div>';
      }
      return '<div style="padding:6px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);display:flex;gap:10px;">'+
        '<div style="flex-shrink:0;text-align:center;min-width:34px;">'+
          '<div style="font-size:10px;color:#60a5fa;font-weight:600;">'+dayStr.split(',')[0]+'</div>'+
          '<div style="font-size:14px;color:#1e3a5f;font-weight:800;">'+d.getDate()+'</div>'+
        '</div>'+
        '<div style="flex:1;">'+
          '<div style="font-size:13px;color:#1e3a5f;font-weight:600;display:flex;align-items:center;gap:6px;">'+
            e.name+
            '<span style="font-size:9px;font-weight:700;color:'+statusColor+';background:'+
              (e.status==='confirmed'?'#f0fdf4':e.status==='tentative'?'#fffbeb':'#fff5f5')+
              ';border-radius:4px;padding:1px 5px;">'+
              ({confirmed:tr('event_confirmed'),tentative:tr('event_tentative'),cancelled:tr('event_cancelled')}[e.status]||(e.status||'').charAt(0).toUpperCase()+(e.status||'').slice(1))+
            '</span>'+
          '</div>'+
          '<div style="font-size:11px;color:#93c5fd;margin-top:1px;">'+
            (e.guest_count?e.guest_count+' '+tr('event_guests'):'')+
            (e.guest_count&&(loc||svc||timeStr)?' · ':'')+
            (loc?loc:'')+(loc&&(svc||timeStr)?' · ':'')+
            (svc?svc:'')+(svc&&timeStr?' · ':'')+
            (timeStr?timeStr:'')+
          '</div>'+
          recHtml+
          (isAdm?'<div style="margin-top:4px;"><button onclick="openEventEditor()" style="font-size:10px;color:#3b82f6;background:none;border:none;padding:0;cursor:pointer;">'+tr('add_event')+'</button></div>':'')+
        '</div>'+
      '</div>';
    }).join('')+
    '<div style="text-align:right;padding-top:6px;">'+
      '<button onclick="showCalendar()" '+
        'style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;font-weight:600;">'+
        tr('view_all_arrow')+
      '</button>'+
    '</div>';
  }catch(e){
    el.style.display='none';
  }
}

// ── SERVICE UPDATES MODAL (View all) ──
// Lunedì: top 10 piatti della settimana; altri giorni: top 10 di ieri
async function openServiceUpdates(){
  const now=getNowDallas();
  const dow=now.toLocaleString('en-US',{timeZone:'America/Chicago',weekday:'long'});
  const isMonday=dow==='Monday';

  const medals=['🥇','🥈','🥉'];
  let rows=[];
  let headerLabel='';
  let headerTitle='';

  if(isMonday){
    // ── Weekly modal ──
    const endDate=new Date(now);
    endDate.setDate(endDate.getDate()-1);
    const startDate=new Date(endDate);
    startDate.setDate(startDate.getDate()-6);
    const startStr=startDate.toLocaleDateString('en-CA');
    const endStr=endDate.toLocaleDateString('en-CA');

    const{data:posData}=await supa.from('pos_sales_by_item')
      .select('menu_item,quantity')
      .gte('sale_date',startStr)
      .lte('sale_date',endStr)
      .not('menu_group','in',_EXCL_GROUPS)
      .not('sales_category','in',_EXCL_SALES_CAT)
      .lt('quantity',1000);

    const filtered=_filterDrinks(posData||[]);
    const totals={};
    filtered.forEach(function(r){
      totals[r.menu_item]=(totals[r.menu_item]||0)+Number(r.quantity||0);
    });
    const sorted=Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,10);

    headerTitle=tr('weekly_highlights');
    const wStart=startDate.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const wEnd=endDate.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    headerLabel=wStart+' – '+wEnd;

    rows=sorted.length
      ? sorted.map(([name,qty],i)=>
          '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
          '<span style="font-size:18px;min-width:28px;">'+(medals[i]||'·')+'</span>'+
          '<span style="font-size:14px;color:#1e3a5f;font-weight:500;flex:1;">'+name+'</span>'+
          '<span style="font-size:13px;color:#60a5fa;font-weight:600;">'+qty+' '+tr('pcs')+'</span>'+
          '</div>'
        )
      : ['<div style="font-size:13px;color:#93c5fd;padding:8px 0;">'+tr('no_food_week')+'</div>'];

  } else {
    // ── Yesterday modal ──
    const yesterday=new Date(now);
    yesterday.setDate(yesterday.getDate()-1);
    const yStr=yesterday.toLocaleDateString('en-CA');

    const EXCLUDED_GROUPS_ARR=['NA Beverages','Beverages','Mocktail','Lunch','Soup'];
    const{data:posData}=await supa.from('pos_sales_by_item')
      .select('menu_item,quantity,menu_group')
      .eq('sale_date',yStr)
      .eq('sales_category','Food')
      .not('menu_group','in','("'+EXCLUDED_GROUPS_ARR.join('","')+'")')
      .lt('quantity',1000)
      .order('quantity',{ascending:false})
      .limit(20);

    const filtered=_filterDrinks(posData||[]).slice(0,10);

    headerTitle=tr('yesterday_highlights');
    headerLabel=yesterday.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});

    rows=filtered.length
      ? filtered.map((item,i)=>
          '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">'+
          '<span style="font-size:18px;min-width:28px;">'+(medals[i]||'·')+'</span>'+
          '<span style="font-size:14px;color:#1e3a5f;font-weight:500;flex:1;">'+item.menu_item+'</span>'+
          '<span style="font-size:13px;color:#60a5fa;font-weight:600;">'+item.quantity+' '+tr('pcs')+'</span>'+
          '</div>'
        )
      : ['<div style="font-size:13px;color:#93c5fd;padding:8px 0;">'+tr('no_food_yesterday')+'</div>'];
  }

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML='<div style="background:rgba(255,255,255,0.97);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:75vh;overflow-y:auto;animation:slideUp .25s ease">'+
    '<div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>'+
    '<div style="font-size:14px;font-weight:600;color:#1e3a5f;margin-bottom:4px;">'+headerTitle+'</div>'+
    '<div style="font-size:11px;color:#93c5fd;margin-bottom:14px;">'+headerLabel+'</div>'+
    '<div>'+rows.join('')+'</div>'+
    '<button onclick="this.closest(\'.fixed\').remove()" style="width:100%;height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:14px;font-weight:600;margin-top:16px;border:none;">Close</button>'+
    '</div>';
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

async function addServiceUpdate(){
  const msg=prompt('Service update message:');
  if(!msg) return;
  const lvl=prompt('Level (info/warning/urgent/event):','info');
  await supa.from('service_updates').insert({message:msg,level:lvl||'info',created_by:user?.name});
  loadServiceUpdates();
  document.querySelector('.fixed')?.remove();
}

