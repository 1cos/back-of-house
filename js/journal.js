// ── JOURNAL — Daily Operations Journal ─────────────────────────────
// Connected to public.journal_entries via Supabase client.
// Admin-only for MVP. Visual design inspired by Shell Lab Diario.

var _jPeriod = '30';        // '0'=today, '7', '30', 'custom'
var _jCatFilter = 'All';
var _jShowArchived = false;
var _jCustomFrom = null;
var _jCustomTo = null;
var _jEditId = null;         // uuid of entry being edited, null=add mode

// ── Category metadata ──────────────────────────────────────────────
var J_CATS = [
  {key:'service',     emoji:'🍽️', color:'#059669'},
  {key:'kitchen',     emoji:'🔪', color:'#2563eb'},
  {key:'equipment',   emoji:'🔧', color:'#d97706'},
  {key:'maintenance', emoji:'🛠️', color:'#7c3aed'},
  {key:'purchasing',  emoji:'📦', color:'#0891b2'},
  {key:'staff',       emoji:'👥', color:'#db2777'},
  {key:'event',       emoji:'🎉', color:'#ea580c'},
  {key:'incident',    emoji:'⚠️', color:'#dc2626'},
  {key:'other',       emoji:'📝', color:'#64748b'}
];
var J_SEV_COLORS = {info:'#3b82f6', warning:'#f59e0b', critical:'#dc2626'};

function _jCatMeta(key) {
  return J_CATS.find(function(c){ return c.key===key; }) || {key:key, emoji:'📝', color:'#64748b'};
}

// ── Period helpers ──────────────────────────────────────────────────
function _jDateRange() {
  var today = new Date(); today.setHours(0,0,0,0);
  var toISO = function(d){ return d.toISOString().slice(0,10); };
  var addD = function(d,n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; };
  if (_jPeriod==='0')  return {from:toISO(today), to:toISO(today)};
  if (_jPeriod==='7')  return {from:toISO(addD(today,-6)), to:toISO(today)};
  if (_jPeriod==='30') return {from:toISO(addD(today,-29)), to:toISO(today)};
  if (_jPeriod==='custom' && _jCustomFrom && _jCustomTo) return {from:_jCustomFrom, to:_jCustomTo};
  return {from:toISO(addD(today,-29)), to:toISO(today)};
}

// ── Load Journal page ──────────────────────────────────────────────
async function loadJournal() {
  var sec = document.getElementById('vj');
  if (!sec || sec.classList.contains('hidden')) return;

  var sb = window.supabaseClient;
  var range = _jDateRange();

  // Period selector
  var periods = [
    {m:'0',  label:tr('jToday')},
    {m:'7',  label:tr('j7days')},
    {m:'30', label:tr('j30days')},
    {m:'custom', label:'📅'}
  ];
  var periodHtml = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 44px;gap:5px;margin-bottom:10px;">' +
    periods.map(function(p){
      var a = _jPeriod===p.m;
      return '<button onclick="jSetPeriod(\''+p.m+'\')" style="padding:8px 4px;border-radius:10px;border:0.5px solid '+(a?'#6366f1':'rgba(99,102,241,0.15)')+';background:'+(a?'#6366f1':'white')+';color:'+(a?'white':'#1e293b')+';font-size:12px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">'+p.label+'</button>';
    }).join('') + '</div>';

  var customHtml = '';
  if (_jPeriod==='custom') {
    customHtml = '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
      '<input type="date" id="_jFrom" value="'+(_jCustomFrom||'')+'" onchange="jCustomDate()" style="flex:1;padding:8px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;">' +
      '<input type="date" id="_jTo" value="'+(_jCustomTo||'')+'" onchange="jCustomDate()" style="flex:1;padding:8px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;">' +
      '</div>';
  }

  // Category filter pills
  var catPills = '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;">' +
    '<button onclick="jSetCat(\'All\')" style="padding:5px 12px;border-radius:20px;border:1px solid '+(_jCatFilter==='All'?'#6366f1':'#e2e8f0')+';background:'+(_jCatFilter==='All'?'#6366f1':'white')+';color:'+(_jCatFilter==='All'?'white':'#475569')+';font-size:11px;font-weight:600;cursor:pointer;">'+tr('jAll')+'</button>' +
    J_CATS.map(function(c){
      var a = _jCatFilter===c.key;
      return '<button onclick="jSetCat(\''+c.key+'\')" style="padding:5px 10px;border-radius:20px;border:1px solid '+(a?c.color:'#e2e8f0')+';background:'+(a?c.color:'white')+';color:'+(a?'white':'#475569')+';font-size:11px;font-weight:600;cursor:pointer;">'+c.emoji+' '+c.key+'</button>';
    }).join('') + '</div>';

  // Show archived toggle
  var archToggle = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;">' +
    '<label style="font-size:11px;color:#94a3b8;cursor:pointer;display:flex;align-items:center;gap:5px;">' +
    '<input type="checkbox" id="_jArchChk" '+(_jShowArchived?'checked':'')+' onchange="jToggleArchived()" style="accent-color:#6366f1;">' +
    tr('jShowArchived') + '</label></div>';

  // Fetch data
  var query = sb.from('journal_entries')
    .select('*')
    .gte('entry_date', range.from)
    .lte('entry_date', range.to)
    .order('entry_date', {ascending:false})
    .order('created_at', {ascending:false});

  if (!_jShowArchived) query = query.eq('is_archived', false);
  if (_jCatFilter !== 'All') query = query.eq('category', _jCatFilter);

  var {data, error} = await query;
  if (error) { sec.innerHTML = '<div style="padding:16px;color:#dc2626;">'+tr('errorPrefix')+error.message+'</div>'; return; }
  var entries = data || [];

  // Counters
  var countAll = entries.length;
  var counterHtml = '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">' +
    countAll + ' ' + (countAll===1 ? 'entry' : 'entries') +
    (range.from === range.to ? ' · ' + range.from.slice(5) : ' · ' + range.from.slice(5) + ' → ' + range.to.slice(5)) +
    '</div>';

  // Feed
  var feedHtml = '';
  if (entries.length === 0) {
    feedHtml = '<div style="background:white;border-radius:16px;padding:40px 20px;text-align:center;color:#94a3b8;font-size:13px;">'+tr('jNoEntries')+'</div>';
  } else {
    feedHtml = entries.map(function(e){ return _jCardHtml(e); }).join('');
  }

  sec.innerHTML = '<div style="padding:12px 12px 120px;">' +
    '<div style="margin-bottom:14px;">' +
    '<div style="font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.08em;">'+tr('jTitle')+'</div>' +
    '<div style="font-size:18px;font-weight:800;color:#1e293b;">'+tr('jSubtitle')+'</div>' +
    '</div>' +
    periodHtml + customHtml +
    _jFormHtml() +
    catPills + archToggle + counterHtml + feedHtml +
    '</div>';
}

// ── Entry card ─────────────────────────────────────────────────────
function _jCardHtml(e) {
  var cat = _jCatMeta(e.category);
  var sevCol = J_SEV_COLORS[e.severity] || '#3b82f6';
  var archived = e.is_archived;
  var dateLabel = e.entry_date ? e.entry_date.slice(5) : '';
  var timeLabel = e.created_at ? new Date(e.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true}) : '';

  return '<div style="background:'+(archived?'#f8fafc':'white')+';border-radius:14px;padding:0;margin-bottom:8px;border-left:4px solid '+sevCol+';overflow:hidden;'+(archived?'opacity:0.6;':'')+'position:relative;">' +
    '<div style="padding:12px 14px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
    '<div style="display:flex;align-items:center;gap:6px;">' +
    '<span style="font-size:16px;">'+cat.emoji+'</span>' +
    '<span style="font-size:10px;font-weight:600;color:'+cat.color+';text-transform:uppercase;letter-spacing:.04em;">'+e.category+'</span>' +
    (e.severity!=='info' ? '<span style="font-size:9px;padding:2px 6px;border-radius:8px;background:'+(e.severity==='critical'?'#fef2f2':'#fffbeb')+';color:'+sevCol+';font-weight:700;">'+e.severity.toUpperCase()+'</span>' : '') +
    '</div>' +
    '<span style="font-size:10px;color:#94a3b8;">'+dateLabel+'</span>' +
    '</div>' +
    '<div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:'+(e.body?'4':'0')+'px;">'+_jEsc(e.title)+'</div>' +
    (e.body ? '<div style="font-size:12px;color:#475569;line-height:1.5;">'+_jEsc(e.body)+'</div>' : '') +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">' +
    '<span style="font-size:10px;color:#cbd5e1;">'+_jEsc(e.author)+' · '+timeLabel+'</span>' +
    '<div style="display:flex;gap:6px;">' +
    '<button onclick="jEditEntry(\''+e.id+'\')" style="font-size:10px;color:#6366f1;background:none;border:1px solid #e2e8f0;border-radius:8px;padding:4px 10px;cursor:pointer;">'+tr('jEdit')+'</button>' +
    (archived
      ? '<button onclick="jRestore(\''+e.id+'\')" style="font-size:10px;color:#059669;background:none;border:1px solid #d1fae5;border-radius:8px;padding:4px 10px;cursor:pointer;">'+tr('jRestore')+'</button>'
      : '<button onclick="jArchive(\''+e.id+'\')" style="font-size:10px;color:#94a3b8;background:none;border:1px solid #e2e8f0;border-radius:8px;padding:4px 10px;cursor:pointer;">'+tr('jArchive')+'</button>') +
    '</div></div>' +
    '</div></div>';
}

function _jEsc(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Add/Edit form ──────────────────────────────────────────────────
function _jFormHtml() {
  var isEdit = !!_jEditId;
  var today = new Date().toISOString().slice(0,10);
  var catOpts = J_CATS.map(function(c){
    return '<option value="'+c.key+'">'+c.emoji+' '+c.key+'</option>';
  }).join('');

  return '<div style="background:white;border-radius:16px;padding:14px;margin-bottom:12px;border:1px solid rgba(99,102,241,0.12);">' +
    '<div style="font-size:10px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">'+(isEdit?tr('jEdit'):tr('jAddEntry'))+'</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
    '<div>' +
    '<div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">'+tr('jDate')+'</div>' +
    '<input type="date" id="jf_date" value="'+today+'" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">' +
    '</div>' +
    '<div>' +
    '<div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">'+tr('jCategory')+'</div>' +
    '<select id="jf_cat" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;background:white;box-sizing:border-box;">'+catOpts+'</select>' +
    '</div>' +
    '</div>' +

    '<div style="margin-bottom:8px;">' +
    '<div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">'+tr('jSeverity')+'</div>' +
    '<div id="jf_sev" style="display:flex;gap:6px;">' +
    _jSevBtn('info', true) + _jSevBtn('warning', false) + _jSevBtn('critical', false) +
    '</div></div>' +

    '<div style="margin-bottom:8px;">' +
    '<div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">'+tr('jTitleLabel')+' *</div>' +
    '<input type="text" id="jf_title" placeholder="'+tr('jTitleLabel')+'" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;">' +
    '</div>' +

    '<div style="margin-bottom:10px;">' +
    '<div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">'+tr('jBody')+'</div>' +
    '<textarea id="jf_body" rows="2" placeholder="'+tr('jBody')+'" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>' +
    '</div>' +

    '<div style="display:flex;gap:8px;">' +
    '<button onclick="jSaveEntry()" style="flex:1;padding:10px;border-radius:12px;border:none;background:#6366f1;color:white;font-size:13px;font-weight:700;cursor:pointer;">'+(isEdit?tr('saveBtn'):tr('jAddEntry'))+'</button>' +
    (isEdit ? '<button onclick="jCancelEdit()" style="padding:10px 16px;border-radius:12px;border:1px solid #e2e8f0;background:white;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">'+tr('prep_cancel')+'</button>' : '') +
    '</div></div>';
}

function _jSevBtn(sev, active) {
  var col = J_SEV_COLORS[sev];
  return '<button onclick="jSetSev(\''+sev+'\')" data-sev="'+sev+'" style="flex:1;padding:6px 8px;border-radius:8px;border:1.5px solid '+(active?col:'#e2e8f0')+';background:'+(active?col+'1a':'white')+';color:'+(active?col:'#94a3b8')+';font-size:11px;font-weight:700;cursor:pointer;text-transform:capitalize;">'+sev+'</button>';
}

// ── UI actions ─────────────────────────────────────────────────────
function jSetPeriod(m) { _jPeriod=m; loadJournal(); }
function jSetCat(c)    { _jCatFilter=c; loadJournal(); }
function jToggleArchived() { _jShowArchived = !_jShowArchived; loadJournal(); }
function jCustomDate() {
  var f=document.getElementById('_jFrom');
  var t=document.getElementById('_jTo');
  if(f&&t&&f.value&&t.value){ _jCustomFrom=f.value; _jCustomTo=t.value; loadJournal(); }
}

function jSetSev(sev) {
  document.querySelectorAll('#jf_sev button').forEach(function(btn){
    var s = btn.dataset.sev;
    var col = J_SEV_COLORS[s];
    var active = s===sev;
    btn.style.border='1.5px solid '+(active?col:'#e2e8f0');
    btn.style.background=active?col+'1a':'white';
    btn.style.color=active?col:'#94a3b8';
  });
}

function _jGetSev() {
  var btns = document.querySelectorAll('#jf_sev button');
  for (var i=0; i<btns.length; i++) {
    if (btns[i].style.color && btns[i].style.color !== 'rgb(148, 163, 184)') return btns[i].dataset.sev;
  }
  return 'info';
}

// ── Save (insert or update) ────────────────────────────────────────
async function jSaveEntry() {
  var sb = window.supabaseClient;
  var title = (document.getElementById('jf_title')?.value || '').trim();
  if (!title) { alert(tr('titleRequired')); return; }

  var payload = {
    entry_date: document.getElementById('jf_date')?.value || new Date().toISOString().slice(0,10),
    category:   document.getElementById('jf_cat')?.value || 'other',
    severity:   _jGetSev(),
    title:      title,
    body:       (document.getElementById('jf_body')?.value || '').trim() || null
  };

  if (_jEditId) {
    // UPDATE
    var {error} = await sb.from('journal_entries').update(payload).eq('id', _jEditId);
    if (error) { alert(tr('errorPrefix')+error.message); return; }
    _jEditId = null;
  } else {
    // INSERT
    payload.author = window.user?.name || 'Max';
    var {error} = await sb.from('journal_entries').insert(payload);
    if (error) { alert(tr('errorPrefix')+error.message); return; }
  }
  loadJournal();
}

// ── Edit ───────────────────────────────────────────────────────────
async function jEditEntry(id) {
  var sb = window.supabaseClient;
  var {data} = await sb.from('journal_entries').select('*').eq('id',id).single();
  if (!data) return;

  _jEditId = id;
  // Re-render to show edit mode form, then populate
  await loadJournal();

  var fd = document.getElementById('jf_date');
  var fc = document.getElementById('jf_cat');
  var ft = document.getElementById('jf_title');
  var fb = document.getElementById('jf_body');
  if (fd) fd.value = data.entry_date;
  if (fc) fc.value = data.category;
  if (ft) ft.value = data.title;
  if (fb) fb.value = data.body || '';
  jSetSev(data.severity);

  // Scroll to form
  var sec = document.getElementById('vj');
  if (sec) sec.scrollTo({top:0, behavior:'smooth'});
}

function jCancelEdit() { _jEditId = null; loadJournal(); }

// ── Archive / Restore ──────────────────────────────────────────────
async function jArchive(id) {
  var sb = window.supabaseClient;
  await sb.from('journal_entries').update({is_archived:true}).eq('id',id);
  loadJournal();
}
async function jRestore(id) {
  var sb = window.supabaseClient;
  await sb.from('journal_entries').update({is_archived:false}).eq('id',id);
  loadJournal();
}

// ── Expose globals ─────────────────────────────────────────────────
window.loadJournal = loadJournal;
window.jSetPeriod = jSetPeriod;
window.jSetCat = jSetCat;
window.jToggleArchived = jToggleArchived;
window.jCustomDate = jCustomDate;
window.jSetSev = jSetSev;
window.jSaveEntry = jSaveEntry;
window.jEditEntry = jEditEntry;
window.jCancelEdit = jCancelEdit;
window.jArchive = jArchive;
window.jRestore = jRestore;
