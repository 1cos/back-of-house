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
    _jFeedHtml(entries)+
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
function _jFeedHtml(entries){
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
    groups[d].forEach(function(e){ html+=_jCard(e); });
  });
  return html;
}

// ── Card ───────────────────────────────────────────────────────────
function _jCard(e){
  var cat=_jCat(e.category);
  var sev=J_SEV[e.severity]||J_SEV.info;
  var time=e.created_at?new Date(e.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}):'';
  var archived=e.is_archived;

  var menuItems='<div onclick="jEditEntry(\''+e.id+'\')" style="padding:10px 16px;font-size:14px;color:#1e293b;cursor:pointer;">'+tr('jEdit')+'</div>'+
    (archived
      ?'<div onclick="jRestore(\''+e.id+'\')" style="padding:10px 16px;font-size:14px;color:#059669;cursor:pointer;">'+tr('jRestore')+'</div>'
      :'<div onclick="jArchive(\''+e.id+'\')" style="padding:10px 16px;font-size:14px;color:#94a3b8;cursor:pointer;">'+tr('jArchive')+'</div>');

  return '<div style="background:white;border-radius:12px;margin-bottom:6px;border-left:3px solid '+sev+';'+(archived?'opacity:0.5;':'')+'position:relative;">'+
    '<div style="padding:12px 14px;">'+

    // Top row: category + time + menu
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'+
    '<div style="display:flex;align-items:center;gap:5px;">'+
    '<span style="font-size:12px;">'+cat.emoji+'</span>'+
    '<span style="font-size:11px;font-weight:500;color:'+cat.color+';">'+e.category+'</span>'+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:4px;">'+
    '<span style="font-size:10px;color:#cbd5e1;">'+time+'</span>'+
    '<button onclick="jCardMenu(this)" style="background:none;border:none;padding:2px 4px;cursor:pointer;font-size:14px;color:#cbd5e1;line-height:1;">⋯</button>'+
    '</div></div>'+

    // Title
    '<div style="font-size:14px;font-weight:600;color:#1e293b;line-height:1.4;">'+_jEsc(e.title)+'</div>'+

    // Body
    (e.body?'<div style="font-size:12px;color:#64748b;line-height:1.5;margin-top:3px;">'+_jEsc(e.body)+'</div>':'')+

    // Author
    '<div style="font-size:10px;color:#cbd5e1;margin-top:6px;">'+_jEsc(e.author)+'</div>'+

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

// ── Globals ────────────────────────────────────────────────────────
window.loadJournal=loadJournal;
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
