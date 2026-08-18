// Testability: no-op in a real browser. Lets tests/ require() this file directly.
if (typeof window === 'undefined') { global.window = global; }

// ── JOURNAL — Clean & Trust ────────────────────────────────────────
// Connected to public.journal_entries. Admin-only.
// Design: feed-first, composer collapsed, filters in panel.

var _jPeriod = '7';
var _jCatFilter = 'All';
var _jShowArchived = false;
var _jCustomFrom = null;
var _jCustomTo = null;
var _jEditId = null;
var _jComposerOpen = false;
var _jFilterOpen = false;

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
var J_SEV = {info:'#94a3b8', warning:'#f59e0b', critical:'#dc2626'};

var J_STATUS_LABELS = {OPEN:'Open', IN_PROGRESS:'In Progress', WAITING:'Waiting', RESOLVED:'Resolved', CLOSED:'Closed'};
var J_STATUS_COLORS = {OPEN:'#2563eb', IN_PROGRESS:'#d97706', WAITING:'#7c3aed', RESOLVED:'#059669', CLOSED:'#64748b'};

// Roster is fetched once and cached module-side — every card + the assignee
// picker reuse this instead of each running their own query (no N+1).
var _jRoster = null;
async function _jLoadRoster(){
  if(_jRoster) return _jRoster;
  var sb = window.supabaseClient;
  var {data,error} = await sb.from('users').select('id,name').eq('active',true).order('name');
  if(error){ console.error('[journal] roster load',error); return []; }
  _jRoster = data || [];
  return _jRoster;
}
function _jRosterName(userId){
  if(userId===null||userId===undefined) return null;
  var hit=(_jRoster||[]).find(function(u){return u.id===userId;});
  return hit?hit.name:null;
}

function _jCat(k){ return J_CATS.find(function(c){return c.key===k;})||{key:k,emoji:'📝',color:'#64748b'}; }
function _jEsc(s){ return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):''; }

function _jRange(){
  var t=new Date();t.setHours(0,0,0,0);
  var iso=function(d){return d.toISOString().slice(0,10);};
  var add=function(d,n){var r=new Date(d);r.setDate(r.getDate()+n);return r;};
  if(_jPeriod==='0') return{from:iso(t),to:iso(t)};
  if(_jPeriod==='7') return{from:iso(add(t,-6)),to:iso(t)};
  if(_jPeriod==='30')return{from:iso(add(t,-29)),to:iso(t)};
  if(_jPeriod==='custom'&&_jCustomFrom&&_jCustomTo)return{from:_jCustomFrom,to:_jCustomTo};
  return{from:iso(add(t,-6)),to:iso(t)};
}

function _jDateLabel(){
  var d=new Date();
  var days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()]+', '+months[d.getMonth()]+' '+d.getDate();
}

// One query for every visible card's update count/last-update date — avoids N+1.
async function _jLoadUpdateStats(entryIds){
  if(!entryIds||entryIds.length===0) return {};
  var sb=window.supabaseClient;
  var {data,error}=await sb.from('journal_updates').select('journal_entry_id,created_at').in('journal_entry_id',entryIds);
  if(error){ console.error('[journal] update stats',error); return {}; }
  var stats={};
  (data||[]).forEach(function(u){
    var s=stats[u.journal_entry_id];
    if(!s){ s={count:0,lastAt:null}; stats[u.journal_entry_id]=s; }
    s.count++;
    if(!s.lastAt||u.created_at>s.lastAt) s.lastAt=u.created_at;
  });
  return stats;
}

// ── Main render ────────────────────────────────────────────────────
async function loadJournal(){
  var sec=document.getElementById('vj');
  if(!sec||sec.classList.contains('hidden'))return;

  var sb=window.supabaseClient;
  var range=_jRange();

  var query=sb.from('journal_entries').select('*')
    .gte('entry_date',range.from).lte('entry_date',range.to)
    .order('entry_date',{ascending:false}).order('created_at',{ascending:false});
  if(!_jShowArchived) query=query.eq('is_archived',false);
  if(_jCatFilter!=='All') query=query.eq('category',_jCatFilter);

  var {data,error}=await query;
  if(error){sec.innerHTML='<div style="padding:20px;color:#dc2626;">'+error.message+'</div>';return;}
  var entries=data||[];
  var updateStats=await _jLoadUpdateStats(entries.map(function(e){return e.id;}));
  await _jLoadRoster();

  // Active filter indicator
  var hasFilter=_jCatFilter!=='All'||_jPeriod!=='7'||_jShowArchived;
  var filterLabel=hasFilter?'Filter ·':'Filter';

  sec.innerHTML='<div style="padding:16px 16px 120px;">'+
    // Header
    '<div style="margin-bottom:20px;">'+
    '<div style="font-size:24px;font-weight:800;color:#1e293b;letter-spacing:-.02em;">Journal</div>'+
    '<div style="font-size:13px;color:#94a3b8;margin-top:2px;">'+_jDateLabel()+'</div>'+
    '</div>'+

    // New entry button / composer
    _jComposerHtml()+

    // Feed header + filter
    '<div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 10px;">'+
    '<div style="font-size:12px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">'+
    entries.length+' '+(entries.length===1?'entry':'entries')+'</div>'+
    '<button onclick="jToggleFilter()" style="font-size:12px;font-weight:600;color:'+(hasFilter?'#6366f1':'#94a3b8')+';background:none;border:1px solid '+(hasFilter?'#c7d2fe':'#e2e8f0')+';border-radius:8px;padding:5px 12px;cursor:pointer;">'+filterLabel+'</button>'+
    '</div>'+

    // Filter panel (collapsed)
    (_jFilterOpen?_jFilterPanel():'')+

    // Feed
    _jFeedHtml(entries,updateStats)+
  '</div>';

  // Auto-focus title if composer is open
  if(_jComposerOpen||_jEditId){
    var tf=document.getElementById('jf_title');
    if(tf)setTimeout(function(){tf.focus();},100);
  }
}

// ── Composer ───────────────────────────────────────────────────────
function _jComposerHtml(){
  if(!_jComposerOpen&&!_jEditId){
    return '<button onclick="jOpenComposer()" style="width:100%;padding:14px 16px;border-radius:14px;border:1.5px dashed #c7d2fe;background:white;color:#6366f1;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;-webkit-tap-highlight-color:transparent;">'+
      '<span style="font-size:18px;line-height:1;">+</span> '+tr('jAddEntry')+
      '</button>';
  }

  var isEdit=!!_jEditId;
  var today=new Date().toISOString().slice(0,10);
  var catOpts=J_CATS.map(function(c){return'<option value="'+c.key+'">'+c.emoji+' '+c.key+'</option>';}).join('');

  return '<div style="background:white;border-radius:14px;padding:14px 16px;border:1px solid #e0e7ff;">'+

    // Row 1: Category + Severity
    '<div style="display:flex;gap:8px;margin-bottom:10px;">'+
    '<select id="jf_cat" style="flex:1;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;background:white;-webkit-appearance:none;appearance:none;">'+catOpts+'</select>'+
    '<select id="jf_sev" style="width:90px;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;background:white;color:#64748b;-webkit-appearance:none;appearance:none;">'+
    '<option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select>'+
    '</div>'+

    // Title
    '<input type="text" id="jf_title" placeholder="What happened?" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:15px;font-weight:500;margin-bottom:8px;box-sizing:border-box;">'+

    // Body
    '<textarea id="jf_body" rows="2" placeholder="Add details…" style="width:100%;padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical;box-sizing:border-box;font-family:inherit;color:#475569;margin-bottom:8px;"></textarea>'+

    // Date (discrete)
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'+
    '<div style="display:flex;align-items:center;gap:6px;">'+
    '<span style="font-size:11px;color:#94a3b8;">Date:</span>'+
    '<input type="date" id="jf_date" value="'+today+'" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;color:#475569;">'+
    '</div>'+
    (isEdit?'<button onclick="jCancelEdit()" style="font-size:12px;color:#94a3b8;background:none;border:none;cursor:pointer;">'+tr('prep_cancel')+'</button>':''+
    '<button onclick="jCloseComposer()" style="font-size:12px;color:#94a3b8;background:none;border:none;cursor:pointer;">'+tr('prep_cancel')+'</button>')+
    '</div>'+

    // Save
    '<button onclick="jSaveEntry()" style="width:100%;padding:11px;border-radius:12px;border:none;background:#6366f1;color:white;font-size:14px;font-weight:600;cursor:pointer;">'+(isEdit?tr('saveBtn'):tr('jAddEntry'))+'</button>'+
    '</div>';
}

// ── Filter panel ───────────────────────────────────────────────────
function _jFilterPanel(){
  var periods=[
    {m:'0',l:tr('jToday')},{m:'7',l:tr('j7days')},{m:'30',l:tr('j30days')},{m:'custom',l:'Custom'}
  ];
  var catOpts='<option value="All">'+tr('jAll')+'</option>'+
    J_CATS.map(function(c){return'<option value="'+c.key+'"'+(c.key===_jCatFilter?' selected':'')+'>'+c.emoji+' '+c.key+'</option>';}).join('');

  return '<div style="background:white;border-radius:14px;padding:14px 16px;margin-bottom:10px;border:1px solid #e2e8f0;">'+

    '<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Period</div>'+
    '<div style="display:flex;gap:6px;margin-bottom:12px;">'+
    periods.map(function(p){
      var a=_jPeriod===p.m;
      return'<button onclick="jSetPeriod(\''+p.m+'\')" style="flex:1;padding:7px 4px;border-radius:8px;border:1px solid '+(a?'#6366f1':'#e2e8f0')+';background:'+(a?'#6366f1':'white')+';color:'+(a?'white':'#475569')+';font-size:11px;font-weight:600;cursor:pointer;">'+p.l+'</button>';
    }).join('')+'</div>'+

    (_jPeriod==='custom'?
      '<div style="display:flex;gap:8px;margin-bottom:12px;">'+
      '<input type="date" id="_jFrom" value="'+(_jCustomFrom||'')+'" onchange="jCustomDate()" style="flex:1;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">'+
      '<input type="date" id="_jTo" value="'+(_jCustomTo||'')+'" onchange="jCustomDate()" style="flex:1;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">'+
      '</div>':'')+

    '<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">'+tr('jCategory')+'</div>'+
    '<select onchange="jSetCat(this.value)" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;background:white;margin-bottom:10px;-webkit-appearance:none;appearance:none;">'+catOpts+'</select>'+

    '<label style="font-size:12px;color:#64748b;display:flex;align-items:center;gap:6px;cursor:pointer;">'+
    '<input type="checkbox" '+(_jShowArchived?'checked':'')+' onchange="jToggleArchived()" style="accent-color:#6366f1;">'+
    tr('jShowArchived')+'</label>'+
    '</div>';
}

// ── Feed grouped by day ────────────────────────────────────────────
function _jFeedHtml(entries,updateStats){
  if(entries.length===0){
    return '<div style="text-align:center;padding:48px 20px;color:#94a3b8;">'+
      '<div style="font-size:32px;margin-bottom:8px;opacity:0.4;">📓</div>'+
      '<div style="font-size:14px;font-weight:500;">'+tr('jNoEntries')+'</div>'+
      '</div>';
  }

  var today=new Date().toISOString().slice(0,10);
  var yest=new Date(Date.now()-864e5).toISOString().slice(0,10);

  // Group by date
  var groups={};
  entries.forEach(function(e){
    var d=e.entry_date||'unknown';
    if(!groups[d])groups[d]=[];
    groups[d].push(e);
  });

  var html='';
  Object.keys(groups).sort().reverse().forEach(function(d){
    var label=d===today?'TODAY':d===yest?'YESTERDAY':d.slice(5).replace('-',' / ');
    html+='<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin:16px 0 8px;'+(html?'':'margin-top:4px;')+'">'+label+'</div>';
    groups[d].forEach(function(e){ html+=_jCard(e,updateStats&&updateStats[e.id]); });
  });
  return html;
}

// ── Card ───────────────────────────────────────────────────────────
function _jCard(e,stats){
  var cat=_jCat(e.category);
  var sev=J_SEV[e.severity]||J_SEV.info;
  var time=e.created_at?new Date(e.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}):'';
  var archived=e.is_archived;

  var menuItems='<div onclick="event.stopPropagation();jEditEntry(\''+e.id+'\')" style="padding:10px 16px;font-size:14px;color:#1e293b;cursor:pointer;">'+tr('jEdit')+'</div>'+
    (archived
      ?'<div onclick="event.stopPropagation();jRestore(\''+e.id+'\')" style="padding:10px 16px;font-size:14px;color:#059669;cursor:pointer;">'+tr('jRestore')+'</div>'
      :'<div onclick="event.stopPropagation();jArchive(\''+e.id+'\')" style="padding:10px 16px;font-size:14px;color:#94a3b8;cursor:pointer;">'+tr('jArchive')+'</div>');

  var updateLine=(stats&&stats.count>0)
    ?'<div style="font-size:10px;color:#a5b4fc;margin-top:4px;">'+stats.count+' '+(stats.count===1?'update':'updates')+' · Last update '+_jdFmtDateShort(stats.lastAt)+'</div>'
    :'';

  var assigneeName=_jRosterName(e.assigned_to);
  var lifecycleLine='<div style="font-size:10px;font-weight:600;color:'+(J_STATUS_COLORS[e.status]||'#94a3b8')+';margin-top:4px;">'+
    (J_STATUS_LABELS[e.status]||e.status)+(assigneeName?' · '+_jEsc(assigneeName):'')+'</div>';

  return '<div onclick="jOpenDetail(\''+e.id+'\')" style="background:white;border-radius:12px;margin-bottom:6px;border-left:3px solid '+sev+';'+(archived?'opacity:0.5;':'')+'position:relative;cursor:pointer;-webkit-tap-highlight-color:transparent;">'+
    '<div style="padding:12px 14px;">'+

    // Top row: category + time + menu
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'+
    '<div style="display:flex;align-items:center;gap:5px;">'+
    '<span style="font-size:12px;">'+cat.emoji+'</span>'+
    '<span style="font-size:11px;font-weight:500;color:'+cat.color+';">'+e.category+'</span>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:4px;">'+
    '<span style="font-size:10px;color:#cbd5e1;">'+time+'</span>'+
    '<button onclick="event.stopPropagation();jCardMenu(this)" style="background:none;border:none;padding:2px 4px;cursor:pointer;font-size:14px;color:#cbd5e1;line-height:1;">⋯</button>'+
    '</div></div>'+

    // Title
    '<div style="font-size:14px;font-weight:600;color:#1e293b;line-height:1.4;">'+_jEsc(e.title)+'</div>'+

    // Body
    (e.body?'<div style="font-size:12px;color:#64748b;line-height:1.5;margin-top:3px;">'+_jEsc(e.body)+'</div>':'')+

    // Author
    '<div style="font-size:10px;color:#cbd5e1;margin-top:6px;">'+_jEsc(e.author)+'</div>'+

    // Status/assignee lifecycle line
    lifecycleLine+

    // Update-count summary (only when it exists — no noise otherwise)
    updateLine+

    // Dropdown menu (hidden by default)
    '<div class="jcard-menu" style="display:none;position:absolute;right:12px;top:36px;background:white;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.12);border:1px solid #e2e8f0;z-index:10;min-width:120px;overflow:hidden;">'+
    menuItems+'</div>'+

    '</div></div>';
}

// ── Card menu toggle ───────────────────────────────────────────────
function jCardMenu(btn){
  // Close all other menus first
  document.querySelectorAll('.jcard-menu').forEach(function(m){m.style.display='none';});
  var menu=btn.closest('[style*="position:relative"]').querySelector('.jcard-menu');
  if(menu){
    menu.style.display=menu.style.display==='none'?'block':'none';
    if(menu.style.display==='block'){
      // Close on outside click
      var close=function(ev){
        if(!menu.contains(ev.target)&&ev.target!==btn){
          menu.style.display='none';
          document.removeEventListener('click',close,true);
        }
      };
      setTimeout(function(){document.addEventListener('click',close,true);},0);
    }
  }
}

// ── Actions ────────────────────────────────────────────────────────
function jOpenComposer(){ _jComposerOpen=true; loadJournal(); }
function jCloseComposer(){ _jComposerOpen=false; _jEditId=null; loadJournal(); }
function jToggleFilter(){ _jFilterOpen=!_jFilterOpen; loadJournal(); }
function jSetPeriod(m){ _jPeriod=m; loadJournal(); }
function jSetCat(c){ _jCatFilter=c; loadJournal(); }
function jToggleArchived(){ _jShowArchived=!_jShowArchived; loadJournal(); }
function jCustomDate(){
  var f=document.getElementById('_jFrom'),t=document.getElementById('_jTo');
  if(f&&t&&f.value&&t.value){_jCustomFrom=f.value;_jCustomTo=t.value;loadJournal();}
}

async function jSaveEntry(){
  var sb=window.supabaseClient;
  var title=(document.getElementById('jf_title')?.value||'').trim();
  if(!title){alert(tr('titleRequired'));return;}

  var payload={
    entry_date:document.getElementById('jf_date')?.value||new Date().toISOString().slice(0,10),
    category:document.getElementById('jf_cat')?.value||'other',
    severity:document.getElementById('jf_sev')?.value||'info',
    title:title,
    body:(document.getElementById('jf_body')?.value||'').trim()||null
  };

  if(_jEditId){
    var {error}=await sb.from('journal_entries').update(payload).eq('id',_jEditId);
    if(error){alert(tr('errorPrefix')+error.message);return;}
    _jEditId=null;
  } else {
    payload.author=window.user?.name||'Max';
    var {error}=await sb.from('journal_entries').insert(payload);
    if(error){alert(tr('errorPrefix')+error.message);return;}
  }
  _jComposerOpen=false;
  loadJournal();
}

async function jEditEntry(id){
  // Close any open card menu
  document.querySelectorAll('.jcard-menu').forEach(function(m){m.style.display='none';});

  var sb=window.supabaseClient;
  var {data}=await sb.from('journal_entries').select('*').eq('id',id).single();
  if(!data)return;

  _jEditId=id;
  _jComposerOpen=true;
  await loadJournal();

  var fd=document.getElementById('jf_date');
  var fc=document.getElementById('jf_cat');
  var fs=document.getElementById('jf_sev');
  var ft=document.getElementById('jf_title');
  var fb=document.getElementById('jf_body');
  if(fd)fd.value=data.entry_date;
  if(fc)fc.value=data.category;
  if(fs)fs.value=data.severity;
  if(ft)ft.value=data.title;
  if(fb)fb.value=data.body||'';

  var sec=document.getElementById('vj');
  if(sec)sec.scrollTo({top:0,behavior:'smooth'});
}

function jCancelEdit(){ _jEditId=null; _jComposerOpen=false; loadJournal(); }

async function jArchive(id){
  document.querySelectorAll('.jcard-menu').forEach(function(m){m.style.display='none';});
  await window.supabaseClient.from('journal_entries').update({is_archived:true}).eq('id',id);
  loadJournal();
}
async function jRestore(id){
  document.querySelectorAll('.jcard-menu').forEach(function(m){m.style.display='none';});
  await window.supabaseClient.from('journal_entries').update({is_archived:false}).eq('id',id);
  loadJournal();
}

// ── T1: Entry lifecycle + updates — plumbing only, no UI here yet ───
// journal_updates is a chronological, append-only child log: the original
// entry (title/body) is never overwritten by an update.
var J_STATUSES = ['OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED'];

async function jGetEntry(id){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('journal_entries').select('*').eq('id', id).single();
  if(error){ console.error('[journal] jGetEntry', error); return null; }
  return data;
}

async function jGetUpdates(entryId){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('journal_updates').select('*')
    .eq('journal_entry_id', entryId).order('created_at', { ascending: true });
  if(error){ console.error('[journal] jGetUpdates', error); return []; }
  return data || [];
}

async function jGetEntryWithUpdates(id){
  var entry = await jGetEntry(id);
  if(!entry) return null;
  var updates = await jGetUpdates(id);
  return { entry: entry, updates: updates };
}

async function jAddUpdate(entryId, body){
  body = (body || '').trim();
  if(!body) return { error: 'empty body' };
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('journal_updates').insert({
    journal_entry_id: entryId,
    author: (window.user && window.user.name) || 'Unknown',
    body: body
  }).select('*').single();
  if(error){ console.error('[journal] jAddUpdate', error); return { error: error }; }
  return { data: data };
}

async function jSetStatus(id, status){
  if(J_STATUSES.indexOf(status) < 0) return { error: 'invalid status: ' + status };
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('journal_entries').update({ status: status }).eq('id', id).select('*').single();
  if(error){ console.error('[journal] jSetStatus', error); return { error: error }; }
  return { data: data };
}

async function jSetAssignee(id, userId){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('journal_entries').update({ assigned_to: userId }).eq('id', id).select('*').single();
  if(error){ console.error('[journal] jSetAssignee', error); return { error: error }; }
  return { data: data };
}

// ── T2A: Entry detail sheet + timeline + Add Update ──────────────────
// Bottom sheet, same convention used elsewhere in BOH OS (e.g. vendor
// document review): fixed overlay, rounded panel sliding up from the
// bottom, drag handle, sticky header/footer, safe-area padding.
var _jdOpenId = null;
var _jdEntry = null;
var _jdUpdates = [];
var _jdComposerOpen = false;
var _jdSaving = false;
var _jdDirty = false; // true once anything changes, so jCloseDetail knows to refresh the feed behind it

function _jdFmtDateTime(iso){
  if(!iso) return '';
  var d=new Date(iso);
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var time=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
  return months[d.getMonth()]+' '+d.getDate()+' · '+time;
}
function _jdFmtDateShort(iso){
  if(!iso) return '';
  var d=new Date(iso);
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()]+' '+d.getDate();
}

async function jOpenDetail(id){
  document.querySelectorAll('.jcard-menu').forEach(function(m){m.style.display='none';});
  var result = await jGetEntryWithUpdates(id);
  if(!result) return;
  await _jLoadRoster();
  _jdOpenId = id;
  _jdEntry = result.entry;
  _jdUpdates = result.updates;
  _jdComposerOpen = false;
  _jdDirty = false;
  _jdRenderSheet();
}

function jCloseDetail(){
  var el = document.getElementById('jDetailSheet');
  if(el) el.remove();
  var dirty = _jdDirty;
  _jdOpenId = null; _jdEntry = null; _jdUpdates = []; _jdComposerOpen = false; _jdDirty = false;
  if(dirty) loadJournal(); // refresh card state (status/assignee/update count) behind the sheet
}

function jdUpdateRow(u){
  return '<div style="padding:10px 0;border-top:1px solid #f1f5f9;">'+
    '<div style="font-size:11px;color:#94a3b8;margin-bottom:3px;">'+_jdFmtDateTime(u.created_at)+' — '+_jEsc(u.author||'')+'</div>'+
    '<div style="font-size:13px;color:#334155;line-height:1.5;white-space:pre-wrap;">'+_jEsc(u.body)+'</div>'+
    '</div>';
}

function jdComposerHtml(){
  if(!_jdComposerOpen){
    return '<button onclick="jdOpenComposer()" style="width:100%;padding:12px;border-radius:12px;border:1.5px dashed #c7d2fe;background:white;color:#6366f1;font-size:14px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">+ Add Update</button>';
  }
  return '<textarea id="jd_update_text" rows="3" placeholder="Update text" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical;box-sizing:border-box;font-family:inherit;margin-bottom:8px;" '+(_jdSaving?'disabled':'')+'></textarea>'+
    '<div style="display:flex;gap:8px;">'+
    '<button onclick="jdCancelComposer()" style="flex:1;padding:11px;border-radius:12px;border:1px solid #e2e8f0;background:white;color:#64748b;font-size:14px;font-weight:600;cursor:pointer;" '+(_jdSaving?'disabled':'')+'>'+tr('prep_cancel')+'</button>'+
    '<button id="jdSaveBtn" onclick="jdSaveUpdate()" style="flex:2;padding:11px;border-radius:12px;border:none;background:#6366f1;color:white;font-size:14px;font-weight:600;cursor:pointer;" '+(_jdSaving?'disabled':'')+'>'+(_jdSaving?'…':'Add Update')+'</button>'+
    '</div>';
}

function jdStatusSelectHtml(entry){
  var color = J_STATUS_COLORS[entry.status]||'#64748b';
  var opts = J_STATUSES.map(function(s){
    return '<option value="'+s+'"'+(s===entry.status?' selected':'')+'>'+J_STATUS_LABELS[s]+'</option>';
  }).join('');
  return '<select id="jdStatusSelect" onchange="jdChangeStatus(this.value)" style="font-size:11px;font-weight:700;color:'+color+';background:'+color+'1a;border:1px solid '+color+'40;border-radius:20px;padding:4px 10px;-webkit-appearance:none;appearance:none;cursor:pointer;">'+opts+'</select>';
}

// Pure decision, no DOM — which status a quick action button should move to.
function jdQuickActionTarget(status){
  if(status==='OPEN'||status==='IN_PROGRESS'||status==='WAITING') return 'RESOLVED';
  if(status==='RESOLVED') return 'CLOSED';
  return null; // CLOSED — no further quick action
}
function jdQuickActionLabel(target){
  return target==='RESOLVED'?'✓ Resolve':target==='CLOSED'?'Close':'';
}
function jdQuickActionHtml(entry){
  var target=jdQuickActionTarget(entry.status);
  if(!target) return '';
  var color=target==='RESOLVED'?'#059669':'#64748b';
  return '<button onclick="jdChangeStatus(\''+target+'\')" style="font-size:11px;font-weight:600;color:'+color+';background:'+color+'15;border:1px solid '+color+'40;border-radius:20px;padding:4px 10px;cursor:pointer;">'+jdQuickActionLabel(target)+'</button>';
}

function jdAssigneeSelectHtml(entry){
  var opts='<option value=""'+(entry.assigned_to==null?' selected':'')+'>Unassigned</option>';
  (_jRoster||[]).forEach(function(u){
    opts+='<option value="'+u.id+'"'+(entry.assigned_to===u.id?' selected':'')+'>'+_jEsc(u.name)+'</option>';
  });
  return '<select id="jdAssigneeSelect" onchange="jdChangeAssignee(this.value)" style="font-size:12px;font-weight:600;color:#1e293b;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:6px 10px;-webkit-appearance:none;appearance:none;cursor:pointer;max-width:200px;">'+opts+'</select>';
}

var _jdStatusSaving=false;
async function jdChangeStatus(newStatus){
  if(_jdStatusSaving) return; // prevent duplicate submits
  var prev=_jdEntry.status;
  _jdStatusSaving=true;
  var sel=document.getElementById('jdStatusSelect');
  if(sel) sel.disabled=true;

  var res=await jSetStatus(_jdOpenId,newStatus);
  _jdStatusSaving=false;

  if(res.error){
    if(sel){ sel.disabled=false; sel.value=prev; } // preserve previous state visually
    alert('Could not change status. Please try again.');
    return;
  }
  _jdEntry=res.data; // includes resolved_at/closed_at as stamped by the T1 DB trigger
  _jdDirty=true;
  _jdRenderSheet();
}

var _jdAssigneeSaving=false;
async function jdChangeAssignee(val){
  if(_jdAssigneeSaving) return;
  var prev=_jdEntry.assigned_to;
  var newId = val===''? null : parseInt(val,10);
  _jdAssigneeSaving=true;
  var sel=document.getElementById('jdAssigneeSelect');
  if(sel) sel.disabled=true;

  var res=await jSetAssignee(_jdOpenId,newId);
  _jdAssigneeSaving=false;

  if(res.error){
    if(sel){ sel.disabled=false; sel.value=prev==null?'':prev; }
    alert('Could not update assignment. Please try again.');
    return;
  }
  _jdEntry=res.data;
  _jdDirty=true;
  _jdRenderSheet();
}

function _jdRenderSheet(){
  var existing = document.getElementById('jDetailSheet');
  if(existing) existing.remove();
  var entry = _jdEntry;
  if(!entry) return;
  var cat = _jCat(entry.category);

  var catDateLine = cat.emoji+' '+entry.category+' · '+_jdFmtDateShort(entry.entry_date+'T00:00:00');
  var originalBody = entry.body
    ? '<div style="font-size:14px;color:#1e293b;line-height:1.5;margin-top:4px;white-space:pre-wrap;">'+_jEsc(entry.body)+'</div>'
    : '';
  var updatesHtml = _jdUpdates.length===0
    ? '<div style="padding:16px 0;font-size:12px;color:#cbd5e1;text-align:center;">No updates yet.</div>'
    : _jdUpdates.map(function(u){ return jdUpdateRow(u); }).join('');

  var sheet = document.createElement('div');
  sheet.id = 'jDetailSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9100;display:flex;flex-direction:column;justify-content:flex-end;';

  sheet.innerHTML =
    '<div onclick="jCloseDetail()" style="flex:1;background:rgba(0,0,0,0.4);"></div>'+
    '<div style="background:white;border-radius:20px 20px 0 0;max-height:90vh;display:flex;flex-direction:column;touch-action:pan-y;">'+
      '<div style="display:flex;justify-content:center;padding:12px 0 4px;">'+
        '<div style="width:36px;height:4px;border-radius:2px;background:#e2e8f0;"></div>'+
      '</div>'+
      '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 16px 12px;border-bottom:1px solid #f1f5f9;flex-shrink:0;">'+
        '<button onclick="jCloseDetail()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>'+
        '<div style="flex:1;min-width:0;">'+
          '<div style="font-size:15px;font-weight:700;color:#1e293b;line-height:1.3;">'+_jEsc(entry.title)+'</div>'+
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;">'+
            '<span style="font-size:11px;color:#94a3b8;">'+catDateLine+'</span>'+
            jdStatusSelectHtml(entry)+
            jdQuickActionHtml(entry)+
          '</div>'+
          '<div style="display:flex;align-items:center;gap:6px;margin-top:8px;">'+
            '<span style="font-size:11px;color:#94a3b8;">Assigned to</span>'+
            jdAssigneeSelectHtml(entry)+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div id="jdScrollBody" style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;padding:14px 16px;">'+
        '<div style="background:#f8fafc;border-radius:12px;padding:12px 14px;margin-bottom:16px;">'+
          '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Original entry</div>'+
          '<div style="font-size:11px;color:#94a3b8;">'+_jdFmtDateTime(entry.created_at)+' — '+_jEsc(entry.author)+'</div>'+
          originalBody+
        '</div>'+
        '<div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Updates</div>'+
        '<div id="jdTimeline">'+updatesHtml+'</div>'+
      '</div>'+
      '<div id="jdComposerWrap" style="flex-shrink:0;padding:12px 16px;border-top:1px solid #f1f5f9;background:white;">'+
        jdComposerHtml()+
      '</div>'+
      '<div style="height:env(safe-area-inset-bottom,0px);background:white;flex-shrink:0;"></div>'+
    '</div>';

  document.body.appendChild(sheet);

  if(_jdComposerOpen){
    var ta=document.getElementById('jd_update_text');
    if(ta) setTimeout(function(){ ta.focus(); }, 100);
  }
}

function jdOpenComposer(){ _jdComposerOpen=true; _jdRenderSheet(); }
function jdCancelComposer(){ _jdComposerOpen=false; _jdRenderSheet(); }

async function jdSaveUpdate(){
  if(_jdSaving) return; // prevent duplicate submits
  var ta = document.getElementById('jd_update_text');
  var text = (ta && ta.value || '').trim();
  if(!text) return;

  _jdSaving = true;
  var wrap = document.getElementById('jdComposerWrap');
  if(wrap) wrap.innerHTML = jdComposerHtml(); // re-render footer in disabled/"…" state

  var res = await jAddUpdate(_jdOpenId, text);
  _jdSaving = false;

  if(res.error){
    // Keep the composer open, restore what was typed, don't create a duplicate.
    if(wrap) wrap.innerHTML = jdComposerHtml();
    var ta2 = document.getElementById('jd_update_text');
    if(ta2) ta2.value = text;
    alert('Could not save the update. Please try again.');
    return;
  }

  _jdUpdates.push(res.data);
  _jdComposerOpen = false;
  _jdDirty = true;
  _jdRenderSheet();
  setTimeout(function(){
    var body = document.getElementById('jdScrollBody');
    if(body) body.scrollTop = body.scrollHeight;
  }, 50);
}

// ── Globals ────────────────────────────────────────────────────────
window.loadJournal=loadJournal;
window.jGetEntry=jGetEntry;
window.jGetUpdates=jGetUpdates;
window.jGetEntryWithUpdates=jGetEntryWithUpdates;
window.jAddUpdate=jAddUpdate;
window.jSetStatus=jSetStatus;
window.jSetAssignee=jSetAssignee;
window.J_STATUSES=J_STATUSES;
window.jOpenComposer=jOpenComposer;
window.jCloseComposer=jCloseComposer;
window.jToggleFilter=jToggleFilter;
window.jSetPeriod=jSetPeriod;
window.jSetCat=jSetCat;
window.jToggleArchived=jToggleArchived;
window.jCustomDate=jCustomDate;
window.jSaveEntry=jSaveEntry;
window.jEditEntry=jEditEntry;
window.jCancelEdit=jCancelEdit;
window.jArchive=jArchive;
window.jRestore=jRestore;
window.jCardMenu=jCardMenu;
window.jOpenDetail=jOpenDetail;
window.jCloseDetail=jCloseDetail;
window.jdOpenComposer=jdOpenComposer;
window.jdCancelComposer=jdCancelComposer;
window.jdSaveUpdate=jdSaveUpdate;
window.jdChangeStatus=jdChangeStatus;
window.jdChangeAssignee=jdChangeAssignee;

// ── TEST-ONLY EXPORTS ────────────────────────────────────────────
// No-op in the browser (no `module` there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    J_STATUSES: J_STATUSES,
    J_STATUS_LABELS: J_STATUS_LABELS,
    jGetEntry: jGetEntry,
    jGetUpdates: jGetUpdates,
    jGetEntryWithUpdates: jGetEntryWithUpdates,
    jAddUpdate: jAddUpdate,
    jSetStatus: jSetStatus,
    jSetAssignee: jSetAssignee,
    jdQuickActionTarget: jdQuickActionTarget,
    _jRosterName: _jRosterName,
    _jSetRosterForTest: function(roster){ _jRoster = roster; }
  };
}
