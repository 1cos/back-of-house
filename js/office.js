// ══════════════════════════════════════════════════════════════
// L'UFFICIO — js/office.js
// Scrivania operativa admin. Legge office_items dal DB.
// Fonti: tell_chef, operation_note, ai_scan, sous_chef_chat
// ══════════════════════════════════════════════════════════════

// ── SCRIVI IN OFFICE_ITEMS (usata da tell-chef e operation-notes) ──
window.officeWriteItem = async function(source, sourceId, fromUser, title, body) {
  const sb = window.supa;
  if (!sb) return;
  try {
    await sb.from('office_items').insert({
      source: source,
      source_id: sourceId ? String(sourceId) : null,
      from_user: fromUser || 'system',
      priority: 'blue',
      title: title,
      body: body,
      ai_analysis: null,
      ai_options: [],
      status: 'open',
    });
  } catch(e) {
    console.error('[Office] officeWriteItem error:', e.message);
  }
};


// Mappa source → folder. Per tell_chef il folder dipende dal report_type (vedi getFolderForItem)
var _officeFolderMap = {
  tell_chef:           'brigata',   // default — override da getFolderForItem
  operation_note:      'brigata',
  ai_scan:             'chefai',
  sous_chef_chat:      'chefai',
  prep_timing:         'prep',
  price_guard:         'incongruenze',
  food_cost_guard:     'incongruenze',
  suggestion:          'miglioramenti',
  'bot-recipe-guardian': 'miglioramenti',
  vendor_warning:      'fornitori'
};

// Ritorna la folder corretta per un item — per tell_chef usa report_type
function getFolderForItem(item) {
  if (item.source === 'tell_chef' || item.source === 'bot-tell-chef-reader') {
    var t = item.report_type || '';
    if (t === 'PROBLEMA_OPERATIVO' || t === 'GAP_CHECKLIST') return 'prep';
    if (t === 'CONTRIBUTO_RICETTA' || t === 'FEEDBACK_RICETTA') return 'miglioramenti';
    if (t === 'SEGNALE_PERSONALE') return 'brigata';
    // tell_chef senza classificazione ancora → brigata
    return 'brigata';
  }
  return _officeFolderMap[item.source] || 'chefai';
}

var _officeFolders = [
  { id:'brigata',       icon:'👨‍🍳', label:'La Brigata',    desc:'Tell Chef · Note serali',          ribbon:'#3b82f6', badge:'rgba(59,130,246,0.12)', badgeTxt:'#2563eb' },
  { id:'chefai',        icon:'🤖',        label:tr('chefAI'),       desc:'AI scan · Sous Chef chat',         ribbon:'#8b5cf6', badge:'rgba(139,92,246,0.12)',  badgeTxt:'#7c3aed' },
  { id:'prep',          icon:'📋',        label:'Prep & Check',  desc:'Alert timing · Task mancanti',     ribbon:'#f59e0b', badge:'rgba(245,158,11,0.12)',  badgeTxt:'#d97706' },
  { id:'incongruenze',  icon:'⚠️',        label:'Incongruenze',  desc:'Prezzi · Pesi · Catchweight',      ribbon:'#f97316', badge:'rgba(249,115,22,0.12)',  badgeTxt:'#ea580c' },
  { id:'miglioramenti', icon:'💡',        label:'Miglioramenti', desc:'Suggerimenti AI · Menu · Processi', ribbon:'#14b8a6', badge:'rgba(20,184,166,0.12)',  badgeTxt:'#0f766e' },
  { id:'fornitori',     icon:'📦',        label:'Fornitori',     desc:'Warning prezzi · Fatture',         ribbon:'#10b981', badge:'rgba(16,185,129,0.12)',  badgeTxt:'#059669' },
  { id:'dati',          icon:'📊',        label:'Dati',          desc:'Report vendite · Food cost',       ribbon:'#ec4899', badge:'rgba(236,72,153,0.12)',  badgeTxt:'#db2777' }
];

window.openOffice = function() {
  if (typeof hideAdminMenu === 'function') hideAdminMenu();
  var existing = document.getElementById('officeModal');
  if (existing) existing.remove();
  var existingOv = document.getElementById('officeOverlay');
  if (existingOv) existingOv.remove();

  var overlay = document.createElement('div');
  overlay.id = 'officeOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.3);';
  overlay.onclick = function() { officeStopRealtime(); overlay.remove(); document.getElementById('officeModal')?.remove(); };
  document.body.appendChild(overlay);

  var modal = document.createElement('div');
  modal.id = 'officeModal';
  modal.style.cssText = [
    'position:fixed;top:0;bottom:0;z-index:300;',
    'background:linear-gradient(160deg,#eff6ff 0%,#dbeafe 60%,#e0f2fe 100%);',
    'display:flex;flex-direction:column;overflow:hidden;',
    'font-family:Inter,system-ui,sans-serif;',
    'width:100%;max-width:480px;left:50%;transform:translateX(-50%);',
  ].join('');

  modal.innerHTML =
    '<div style="background:rgba(255,255,255,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:0.5px solid rgba(59,130,246,0.12);box-shadow:0 2px 8px rgba(30,58,95,0.06);padding:14px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
      '<button onclick="officeStopRealtime();document.getElementById(\'officeOverlay\')?.remove();document.getElementById(\'officeModal\')?.remove();" style="color:#60a5fa;background:none;border:none;font-size:22px;cursor:pointer;padding:4px;line-height:1;">&#8592;</button>' +
      '<div style="font-size:16px;font-weight:700;color:#1e3a5f;flex:1;">L\'Ufficio</div>' +
      '<div id="officeBadge" style="display:none;background:#ef4444;color:white;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;"></div>' +
    '</div>' +
    '<div id="officeHomeContent" style="flex:1;overflow-y:auto;padding:16px 16px 60px;-webkit-overflow-scrolling:touch;">' +
      '<div style="text-align:center;padding:40px;color:#94a3b8;">'+tr('loading')+'...</div>' +
    '</div>';

  document.body.appendChild(modal);
  officeLoadHome();
  officeStartRealtime();
};

// ── CARICA HOME CON CASSETTI ──
async function officeLoadHome() {
  var sb = window.supa;
  if (!sb) return;
  var container = document.getElementById('officeHomeContent');
  if (!container) return;

  try {
    var res = await sb.from('office_items').select('*').eq('status','open').order('created_at',{ascending:false}).limit(200);
    var sevenDaysAgo7 = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var items = (res.data || []).filter(function(i) {
      // done >7gg sparisce dalla vista
      if (i.chef_action === 'done' && i.chef_action_at) {
        return new Date(i.chef_action_at).getTime() > sevenDaysAgo7;
      }
      return true;
    });
    // Il badge conta solo quelli senza chef_action (non ancora actionati)
    var unactioned = items.filter(function(i) { return !i.chef_action; });

    // Conta per folder
    var counts = {};
    var previews = {};
    _officeFolders.forEach(function(f) { counts[f.id] = 0; previews[f.id] = ''; });

    items.forEach(function(item) {
      var folder = getFolderForItem(item);
      counts[folder] = (counts[folder] || 0) + 1;
      if (!previews[folder]) previews[folder] = item.title || '';
    });

    var totalUnread = items.length;

    // Badge header
    var badge = document.getElementById('officeBadge');
    if (badge) {
      if (totalUnread > 0) { badge.style.display='block'; badge.textContent=totalUnread+' nuovi'; }
      else badge.style.display='none';
    }

    // Costruisco con DOM invece di innerHTML per evitare problemi di escape
    container.innerHTML = '';

    // ── DA LEGGERE ──
    var strip = document.createElement('div');
    strip.style.cssText = 'background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);border-radius:18px;padding:16px 18px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;box-shadow:0 4px 16px rgba(30,58,95,0.25),0 8px 32px rgba(37,99,235,0.15);-webkit-tap-highlight-color:transparent;';
    strip.innerHTML = '<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:26px;">📬</span><div><div style="color:white;font-size:17px;font-weight:700;">Da leggere</div><div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:2px;">Tutti i messaggi in attesa</div></div></div><div style="background:white;color:#1e3a5f;font-size:22px;font-weight:800;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(30,58,95,0.2);">' + totalUnread + '</div>';
    strip.addEventListener('click', function() { officeOpenFolder('nonletti'); });
    container.appendChild(strip);

    // Label
    var lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:11px;font-weight:700;color:#60a5fa;letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px;padding-left:4px;';
    lbl.textContent = 'Cassetti';
    container.appendChild(lbl);

    // Lista cassetti
    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    _officeFolders.forEach(function(f) {
      var count = counts[f.id] || 0;
      var preview = previews[f.id] || tr('officeNoMsg');

      var row = document.createElement('div');
      row.style.cssText = 'background:rgba(255,255,255,0.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(59,130,246,0.18);border-radius:18px;cursor:pointer;overflow:hidden;box-shadow:0 2px 8px rgba(30,58,95,0.06),0 6px 20px rgba(30,58,95,0.04);-webkit-tap-highlight-color:transparent;';
      row.innerHTML =
        '<div style="display:flex;align-items:center;padding:14px 16px;gap:12px;">' +
          '<div style="width:5px;border-radius:4px;align-self:stretch;min-height:46px;flex-shrink:0;background:' + f.ribbon + ';"></div>' +
          '<div style="font-size:26px;width:32px;text-align:center;">' + f.icon + '</div>' +
          '<div style="flex:1;">' +
            '<div style="color:#1e3a5f;font-size:16px;font-weight:600;">' + f.label + '</div>' +
            '<div style="color:#60a5fa;font-size:12px;margin-top:3px;">' + f.desc + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:12px;font-weight:700;padding:3px 9px;border-radius:20px;background:' + f.badge + ';color:' + f.badgeTxt + ';">' + count + '</span>' +
            '<span style="color:rgba(30,58,95,0.25);font-size:18px;">&#x203A;</span>' +
          '</div>' +
        '</div>' +
        '<div style="border-top:0.5px solid rgba(59,130,246,0.1);padding:9px 16px 11px 65px;color:rgba(30,58,95,0.4);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + preview + '</div>';

      var fid = f.id;
      row.addEventListener('click', function() { officeOpenFolder(fid); });
      list.appendChild(row);
    });

    container.appendChild(list);

    // ── INVENTORY SETUP (solo admin) ──
    if (typeof isAdmin === 'function' && isAdmin()) {
      var adminSep = document.createElement('div');
      adminSep.style.cssText = 'font-size:11px;font-weight:700;color:#60a5fa;letter-spacing:.06em;text-transform:uppercase;margin:20px 0 10px 4px;';
      adminSep.textContent = 'Admin';
      container.appendChild(adminSep);

      var invBtn = document.createElement('div');
      invBtn.style.cssText = 'background:rgba(255,255,255,0.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(59,130,246,0.18);border-radius:18px;cursor:pointer;overflow:hidden;box-shadow:0 2px 8px rgba(30,58,95,0.06);-webkit-tap-highlight-color:transparent;';
      invBtn.innerHTML =
        '<div style="display:flex;align-items:center;padding:14px 16px;gap:12px;">' +
          '<div style="width:5px;border-radius:4px;align-self:stretch;min-height:46px;flex-shrink:0;background:#6366f1;"></div>' +
          '<div style="font-size:26px;width:32px;text-align:center;">📦</div>' +
          '<div style="flex:1;">' +
            '<div style="color:#1e3a5f;font-size:16px;font-weight:600;">Inventory Setup</div>' +
            '<div style="color:#60a5fa;font-size:12px;margin-top:3px;">Stock iniziale · Recipe Health</div>' +
          '</div>' +
          '<span style="color:rgba(30,58,95,0.25);font-size:18px;">&#x203A;</span>' +
        '</div>';
      invBtn.addEventListener('click', function() { officeOpenInventorySetup(); });
      container.appendChild(invBtn);
    }

  } catch(e) {
    container.innerHTML = '<div style="color:#ef4444;padding:40px;text-align:center;">Errore: ' + e.message + '</div>';
  }
}

// ── APRI CASSETTO FULLSCREEN ──
window.officeOpenFolder = async function(folderId) {
  window._officeCurrentFolder = folderId; // traccia folder aperta per Riapri
  // Carica items dal DB invece di passarli inline
  var sb = window.supa;
  var items = [];
  if (sb) {
    try {
      var res = await sb.from('office_items').select('*').eq('status','open').order('created_at',{ascending:false}).limit(200);
      var all = res.data || [];

      // Regola ciclo di vita: done > 7 giorni sparisce dalla vista
      var sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      all = all.filter(function(i) {
        if (i.chef_action === 'done' && i.chef_action_at) {
          return new Date(i.chef_action_at).getTime() > sevenDaysAgo;
        }
        return true;
      });

      if (folderId === 'nonletti') {
        items = all;
      } else {
        items = all.filter(function(i){ return getFolderForItem(i) === folderId; });
      }
    } catch(e) { console.warn('[Office] folder load error:', e.message); }
  }
  var existing = document.getElementById('officeFolder');
  if (existing) existing.remove();

  // Dati cassetto
  var folderData = _officeFolders.find(function(f){ return f.id===folderId; });
  var isNonLetti = folderId === 'nonletti';
  var icon   = isNonLetti ? '📬' : (folderData ? folderData.icon : '📁');
  var label  = isNonLetti ? 'Da leggere' : (folderData ? folderData.label : folderId);
  var desc   = isNonLetti ? 'Tutti i messaggi in attesa' : (folderData ? folderData.desc : '');
  var ribbon = isNonLetti ? '#1e3a5f' : (folderData ? folderData.ribbon : '#3b82f6');

  var el = document.createElement('div');
  el.id = 'officeFolder';
  el.style.cssText = [
    'position:fixed;top:0;left:50%;transform:translateX(-50%) translateY(100%);',
    'width:100%;max-width:480px;height:100vh;z-index:400;',
    'background:linear-gradient(160deg,#eff6ff 0%,#dbeafe 60%,#e0f2fe 100%);',
    'display:flex;flex-direction:column;overflow:hidden;',
    'font-family:Inter,system-ui,sans-serif;',
    'transition:transform 0.4s cubic-bezier(0.4,0,0.2,1);',
  ].join('');

  // Sort items: red → orange → blue
  var sorted = (items || []).slice().sort(function(a,b){
    var o={red:0,orange:1,blue:2};
    return (o[a.priority]||2)-(o[b.priority]||2);
  });

  // Header del cassetto
  el.innerHTML =
    '<div style="width:40px;height:5px;background:rgba(30,58,95,0.15);border-radius:3px;margin:10px auto 0;flex-shrink:0;"></div>' +
    '<div style="background:rgba(239,246,255,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:0.5px solid rgba(59,130,246,0.12);box-shadow:0 2px 8px rgba(30,58,95,0.06);padding:14px 16px;display:flex;align-items:center;gap:14px;flex-shrink:0;">' +
      '<button onclick="officeCloseFolder()" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.7);border:0.5px solid rgba(59,130,246,0.18);color:#1e3a5f;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(30,58,95,0.1);">&#8592;</button>' +
      '<div style="flex:1;">' +
        '<div style="font-size:19px;font-weight:700;color:#1e3a5f;letter-spacing:-0.3px;">' + icon + ' ' + label + '</div>' +
        '<div style="font-size:12px;color:#60a5fa;margin-top:2px;">' + desc + '</div>' +
      '</div>' +
      '<div style="width:5px;height:40px;border-radius:4px;background:' + ribbon + ';box-shadow:0 0 10px rgba(0,0,0,0.1);"></div>' +
    '</div>' +
    '<div id="officeFolderList" style="flex:1;overflow-y:auto;padding:14px 0 60px;-webkit-overflow-scrolling:touch;"></div>';

  // Aggiungo card via DOM per evitare problemi con apostrofi nel testo
  var listEl = el.querySelector('#officeFolderList');
  if (sorted.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div style="font-size:48px;margin-bottom:12px;">✅</div><div style="font-size:15px;color:rgba(30,58,95,0.4);">'+tr('officeNoDrawer')+'</div></div>';
  } else {
    sorted.forEach(function(item) {
      var tmp = document.createElement('div');
      tmp.innerHTML = officeRenderCard(item);
      var card = tmp.firstElementChild;
      if (card) listEl.appendChild(card);
    });
  }

  document.body.appendChild(el);

  // Slide up
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
  });

  // Swipe down to close
  officeAddSwipeDown(el);
};

window.officeCloseFolder = function() {
  var el = document.getElementById('officeFolder');
  if (!el) return;
  el.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1)';
  el.style.transform = 'translateX(-50%) translateY(100%)';
  setTimeout(function(){ el.remove(); }, 360);
};

function officeAddSwipeDown(el) {
  var startY = 0, startScroll = 0, active = false;
  var list = el.querySelector('#officeFolderList');

  el.addEventListener('touchstart', function(e) {
    startY = e.touches[0].clientY;
    startScroll = list ? list.scrollTop : 0;
    active = false;
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    var dy = e.touches[0].clientY - startY;
    if ((list && list.scrollTop > 6) || dy <= 0) return;
    active = true;
    el.style.transition = 'none';
    el.style.transform = 'translateX(-50%) translateY(' + dy + 'px)';
    el.style.opacity = String(Math.max(0.4, 1 - dy/380));
    e.preventDefault();
  }, { passive: false });

  el.addEventListener('touchend', function(e) {
    if (!active) return;
    var dy = e.changedTouches[0].clientY - startY;
    if (dy > 110) {
      el.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1),opacity 0.3s';
      el.style.transform = 'translateX(-50%) translateY(100%)';
      el.style.opacity = '0';
      setTimeout(function(){ el.remove(); }, 320);
    } else {
      el.style.transition = 'transform 0.38s cubic-bezier(0.34,1.4,0.64,1),opacity 0.25s';
      el.style.transform = 'translateX(-50%) translateY(0)';
      el.style.opacity = '1';
    }
    active = false;
  }, { passive: true });
}


// ── ANALIZZA ORA (on demand) ──
window.officeAnalyzeNow = async function(btn) {
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  try {
    const res = await fetch(window.SUPABASE_URL + '/functions/v1/office-ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({}),
    });
    const d = await res.json();
    if (typeof showScToast === 'function') {
      showScToast(d.processed > 0 ? '✓ Analizzati ' + d.processed + ' item' : '✓ Tutto già analizzato');
    }
    officeLoad();
  } catch(e) {
    console.warn('[Office] office-ai call failed:', e.message);
    if (typeof showScToast === 'function') showScToast('❌ ' + tr('errorAnalysis'));
  } finally {
    if (btn) { btn.textContent = 'Analizza'; btn.disabled = false; }
  }
};

// ── REALTIME — aggiorna lista quando arriva un nuovo item ──
var _officeRealtimeSub = null;

function officeStartRealtime() {
  var sb = window.supa;
  if (!sb) return;
  // Cancella subscription precedente se esiste
  if (_officeRealtimeSub) {
    sb.removeChannel(_officeRealtimeSub);
    _officeRealtimeSub = null;
  }
  // Nome univoco per evitare conflitti con sessioni precedenti
  var channelName = 'office-items-' + Date.now();
  _officeRealtimeSub = sb.channel(channelName)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'office_items',
    }, function(payload) {
      officeLoadHome();
      officeBadgeUpdate();
    })
    .subscribe(function(status) {
      console.log('[Office] Realtime status:', status);
    });
}

// Cancella realtime quando si chiude L'Ufficio
var _origOfficeClose = null;
function officeStopRealtime() {
  var sb = window.supa;
  if (sb && _officeRealtimeSub) {
    sb.removeChannel(_officeRealtimeSub);
    _officeRealtimeSub = null;
  }
}

// ── SMART FOCUS — ora e appuntamenti imminenti ──
function officeRenderSmartFocus() {
  var el = document.getElementById('officeSmartFocus');
  if (!el) return;

  var now = (typeof getNowDallas === 'function') ? getNowDallas() : new Date();
  var h = now.getHours();
  var m = now.getMinutes();
  var dow = now.getDay(); // 0=dom, 2=mar, 3=mer

  var focus = null;

  // Martedi pomeriggio (13:30-16:00) → meeting Monica
  if (dow === 2 && h >= 13 && h < 16) {
    var minutesLeft = (15 * 60) - (h * 60 + m - 13 * 60);
    if (minutesLeft > 0 && minutesLeft <= 90) {
      focus = {
        label: 'Meeting Monica — tra ' + minutesLeft + ' minuti',
        sub: 'Catering questa settimana · TripleSeat · Menu eventi',
      };
    }
  }
  // Mercoledi mattina (10:00-12:00) → meeting Zeno e Bo
  if (dow === 3 && h >= 10 && h < 12) {
    focus = {
      label: 'Meeting Zeno & Bo — oggi',
      sub: 'Front of house · Coordinamento sala/cucina',
    };
  }

  if (!focus) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px 7px;border-bottom:0.5px solid rgba(59,130,246,0.08);">' +
      '<span style="font-size:13px;font-weight:600;color:#60a5fa;letter-spacing:.06em;text-transform:uppercase;">Smart focus</span>' +
    '</div>' +
    '<div style="padding:10px 14px 5px;font-size:22px;font-weight:700;color:#1e3a5f;">' + focus.label + '</div>' +
    '<div style="padding:0 14px 14px;font-size:17px;color:#60a5fa;">' + focus.sub + '</div>';
}

// ── CARICA ITEMS DAL DB ──
async function officeLoad() {
  var list = document.getElementById('officeList');
  if (!list) return;
  var sb = window.supa;
  if (!sb) return;

  try {
    var res = await sb.from('office_items')
      .select('*')
      .eq('status', 'open')
      .order('priority', { ascending: true }) // red first (alphabetical: blue, orange, red — fix below)
      .order('created_at', { ascending: false })
      .limit(50);

    var items = res.data || [];

    // Sort: red → orange → blue
    var order = { red: 0, orange: 1, blue: 2 };
    items.sort(function(a, b) {
      return (order[a.priority] || 2) - (order[b.priority] || 2);
    });

    // Badge
    var badge = document.getElementById('officeBadge');
    var urgent = items.filter(function(i) { return i.priority === 'red'; }).length;
    if (badge) {
      if (urgent > 0) {
        badge.style.display = 'block';
        badge.textContent = urgent + ' urgenti';
      } else {
        badge.style.display = 'none';
      }
    }

    if (!items.length) {
      list.innerHTML = '<div style="text-align:center;padding:60px 20px;">' +
        '<div style="font-size:36px;margin-bottom:12px;">✅</div>' +
        '<div style="font-size:15px;font-weight:600;color:#1e3a5f;margin-bottom:6px;">'+tr('officeAllGood')+'</div>' +
        '<div style="font-size:13px;color:#94a3b8;">'+tr('officeNoPending')+'</div>' +
        '</div>';
      return;
    }

    var html = '';
    var lastPriority = null;

    var priorityLabels = { red: 'Urgente', orange: 'Da decidere', blue: 'Info' };

    items.forEach(function(item) {
      if (item.priority !== lastPriority) {
        html += '<div style="font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;padding:14px 16px 6px;">' +
          (priorityLabels[item.priority] || 'Info') + '</div>';
        lastPriority = item.priority;
      }
      html += officeRenderCard(item);
    });

    list.innerHTML = html;

  } catch(e) {
    list.innerHTML = '<div style="text-align:center;color:#ef4444;padding:40px;font-size:14px;">Errore caricamento: ' + e.message + '</div>';
  }
}

// ── RENDER SINGOLA CARD ──
function officeRenderCard(item) {
  // Se già actionato da Max → render stato finale direttamente dal DB
  if (item.chef_action === 'done') {
    var byDone = item.chef_action_by || 'Max';
    return '<div data-item-id="' + item.id + '" style="background:#f0fdf4;border:0.5px solid rgba(34,197,94,0.2);border-left:3px solid #22c55e;border-radius:16px;margin:0 12px 8px;overflow:hidden;opacity:0.7;">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;"></div>' +
        '<div style="font-size:14px;font-weight:500;color:#1e3a5f;flex:1;">' + (item.title||'') + '</div>' +
      '</div>' +
      '<div style="padding:0 14px 10px;font-size:12px;color:#22c55e;font-weight:700;">✓ Done — ' + byDone + '</div>' +
    '</div>';
  }
  if (item.chef_action === 'working_on_it') {
    var byWip = item.chef_action_by || 'Max';
    return '<div data-item-id="' + item.id + '" style="background:#fffbeb;border:0.5px solid rgba(245,158,11,0.3);border-left:3px solid #f59e0b;border-radius:16px;margin:0 12px 8px;overflow:hidden;">' +
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;">' +
        '<div style="width:8px;height:8px;border-radius:50%;background:#f59e0b;flex-shrink:0;"></div>' +
        '<div style="font-size:14px;font-weight:500;color:#1e3a5f;flex:1;">' + (item.title||'') + '</div>' +
      '</div>' +
      '<div style="padding:0 14px 6px;font-size:12px;color:#f59e0b;font-weight:700;margin-bottom:4px;">⚙️ Working on it — ' + byWip + '</div>' +
      '<div style="padding:0 14px 10px;">' +
        '<button onclick="officeChefAction(this.dataset.id,\'done\')" data-id="' + item.id + '"" style="width:100%;padding:8px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:0.5px solid #22c55e;background:#f0fdf4;color:#15803d;">✓ Mark Done</button>' +
      '</div>' +
    '</div>';
  }

  var dotColor = { red: '#ef4444', orange: '#f97316', blue: '#3b82f6' }[item.priority] || '#3b82f6';
  var borderLeft = { red: '3px solid #ef4444', orange: '3px solid #f97316', blue: '3px solid #3b82f6' }[item.priority] || '3px solid #3b82f6';
  var sourceLabels = { tell_chef: 'Tell Chef', operation_note: 'Op. note', ai_scan: 'AI scan', sous_chef_chat: 'Chat AI' };
  var sourceLabel = sourceLabels[item.source] || item.source;

  var ts = '';
  try {
    var d = new Date(item.created_at);
    ts = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) +
         ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
  } catch(e) {}

  // Parse ai_options
  var options = [];
  try {
    options = Array.isArray(item.ai_options) ? item.ai_options : JSON.parse(item.ai_options || '[]');
  } catch(e) { options = []; }

  var aiBlock = '';
  if (item.ai_analysis) {
    aiBlock =
      '<div data-role="ai" style="margin:0 14px 8px;padding:8px 11px;background:rgba(59,130,246,0.04);border:0.5px solid rgba(59,130,246,0.15);border-radius:10px;border-left:2px solid #3b82f6;">' +
        '<div style="font-size:11px;color:#3b82f6;font-weight:700;letter-spacing:.04em;margin-bottom:4px;">Chef AI</div>' +
        '<div style="font-size:17px;color:#1e3a5f;line-height:1.5;">' + item.ai_analysis + '</div>' +
      '</div>';
  }

  var actionsHtml = '';
  if (options.length > 0) {
    actionsHtml = '<div data-role="actions" style="display:flex;gap:7px;padding:0 14px 12px;">';
    options.forEach(function(opt, idx) {
      var isPrimary = idx === options.length - 1;
      var label = typeof opt === 'string' ? opt : (opt.label || String(opt));
      actionsHtml +=
        '<button onclick="officeResolve(\'' + item.id + '\',\'' + escOpt(label) + '\')" ' +
        'style="flex:1;padding:8px 0;border-radius:10px;font-size:17px;font-weight:600;cursor:pointer;border:0.5px solid ' +
        (isPrimary ? '#1e3a5f;background:#1e3a5f;color:white;' : 'rgba(59,130,246,0.2);background:rgba(59,130,246,0.04);color:#1e3a5f;') +
        '">' + label + '</button>';
    });
    actionsHtml += '</div>';
  } else {
    // Bottoni differenziati per fonte
    var src = item.source;
    var styleGhost = 'flex:1;padding:11px 0;border-radius:10px;font-size:17px;font-weight:600;cursor:pointer;border:0.5px solid rgba(59,130,246,0.2);background:rgba(59,130,246,0.04);color:#1e3a5f;';
    var styleSolid = 'flex:1;padding:11px 0;border-radius:10px;font-size:17px;font-weight:600;cursor:pointer;border:0.5px solid #1e3a5f;background:#1e3a5f;color:white;';
    var btnLeft = '', btnRight = '';

    if (src === 'tell_chef') {
      var styleWip     = 'flex:1;padding:11px 0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:0.5px solid #f59e0b;background:#fffbeb;color:#92400e;';
      var styleDone    = 'flex:1;padding:11px 0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:0.5px solid #22c55e;background:#f0fdf4;color:#15803d;';
      var styleIgnore  = 'flex:1;padding:11px 0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:0.5px solid rgba(148,163,184,0.4);background:rgba(148,163,184,0.06);color:#94a3b8;';
      btnLeft  = '<button onclick="officeChefAction(\'' + item.id + '\',\'working_on_it\')" style="' + styleWip    + '">⚙️ Working on it</button>';
      btnRight = '<button onclick="officeChefAction(\'' + item.id + '\',\'done\')"         style="' + styleDone   + '">✓ Done</button>';
      var btnIgnore = '<button onclick="officeChefAction(\'' + item.id + '\',\'ignored\')"  style="' + styleIgnore + '">Ignore</button>';
      actionsHtml =
        '<div data-role="actions" style="display:flex;flex-direction:column;gap:6px;padding:0 14px 12px;">' +
          '<div style="display:flex;gap:6px;">' + btnLeft + btnRight + '</div>' +
          btnIgnore +
        '</div>';
    } else if (src === 'operation_note') {
      btnLeft  = '<button onclick="officeResolve(\'' + item.id + '\',\'letto\')" style="' + styleGhost + '">Letto</button>';
      btnRight = '<button onclick="officeResolve(\'' + item.id + '\',\'archived\')" style="' + styleSolid + '">Archivia</button>';
    } else if (src === 'ai_scan') {
      btnLeft  = '<button onclick="officeResolve(\'' + item.id + '\',\'archived\')" style="' + styleGhost + '">Ignora</button>';
      btnRight = '<button onclick="officeInvestiga(\'' + item.id + '\')" style="' + styleSolid + '">Investiga</button>';
    } else if (src === 'bot-recipe-guardian') {
      btnLeft  = '<button onclick="officeResolve(\'' + item.id + '\',\'archived\')" style="' + styleGhost + '">Ignora</button>';
      btnRight = '<button onclick="officeOpenRecipe(\'' + item.id + '\',\'' + (item.source_id || '') + '\')" style="' + styleSolid + '">'+tr('openRecipe')+'</button>';
    } else {
      // sous_chef_chat — solo Letto
      btnLeft  = '<button onclick="officeResolve(\'' + item.id + '\',\'letto\')" style="' + styleGhost + '">Letto</button>';
    }

    if (src !== 'tell_chef') {
      actionsHtml =
        '<div data-role="actions" style="display:flex;gap:7px;padding:0 14px 12px;">' +
          btnLeft + btnRight +
        '</div>';
    }
  }

  return '<div data-item-id="' + item.id + '" style="background:white;border:0.5px solid rgba(59,130,246,0.1);border-left:' + borderLeft + ';border-radius:16px;margin:0 12px 8px;overflow:hidden;box-shadow:0 2px 8px rgba(30,58,95,0.07),0 6px 16px rgba(30,58,95,0.04);">' +
    '<div style="display:flex;align-items:flex-start;gap:8px;padding:11px 14px 6px;">' +
      '<div data-role="dot" style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:4px;"></div>' +
      '<div style="font-size:20px;font-weight:700;color:#1e3a5f;flex:1;line-height:1.3;">' + (item.title || '') + '</div>' +
      '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(59,130,246,0.07);color:#60a5fa;font-weight:600;white-space:nowrap;flex-shrink:0;">' + sourceLabel + '</span>' +
    '</div>' +
    (item.body ? '<div data-role="body" style="font-size:17px;color:#475569;padding:0 14px 12px;line-height:1.5;">' + item.body + '</div>' : '') +
    aiBlock +
    actionsHtml +
    '<div data-role="meta" style="padding:0 14px 10px;font-size:12px;color:#94a3b8;font-weight:500;">' + (item.from_user && item.from_user !== 'system' ? '<span style="color:#1e3a5f;font-weight:700;">' + item.from_user + '</span> · ' : '') + ts + '</div>' +
  '</div>';
}

function escOpt(s) {
  return (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ── RISOLVI ITEM ──
window.officeResolve = async function(id, resolution) {
  var sb = window.supa;
  if (!sb) return;
  try {
    var isLetto = (resolution === 'letto');
    await sb.from('office_items').update({
      status: isLetto ? 'open' : 'resolved',
      resolved_by: window.user?.name || 'Max',
      resolved_at: isLetto ? null : new Date().toISOString(),
      resolution: isLetto ? null : resolution,
      priority: isLetto ? 'blue' : undefined,
    }).eq('id', id);

    var card = document.querySelector('[data-item-id="' + id + '"]');

    if (isLetto) {
      // Comprimi — non sparisce, si minimizza
      if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0.5';
        card.style.borderLeft = '3px solid #cbd5e1';
        var body = card.querySelector('[data-role="body"]');
        var aiBlock = card.querySelector('[data-role="ai"]');
        var actions = card.querySelector('[data-role="actions"]');
        var meta = card.querySelector('[data-role="meta"]');
        var dot = card.querySelector('[data-role="dot"]');
        if (body) body.style.display = 'none';
        if (aiBlock) aiBlock.style.display = 'none';
        if (meta) meta.style.display = 'none';
        if (dot) dot.style.background = '#cbd5e1';
        if (actions) actions.innerHTML =
          '<div style="padding:0 14px 10px;">' +
            '<button onclick="officeReopen(\'' + id + '\')" ' +
              'style="width:100%;padding:8px;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;border:0.5px solid rgba(59,130,246,0.2);background:rgba(59,130,246,0.04);color:#94a3b8;">↩ Riapri</button>' +
          '</div>';
      }
      if (typeof showScToast === 'function') showScToast('📌 Letto — ci torni dopo');
    } else {
      // Risolto — slide out, rimuovi dal DOM (no officeLoad che cerca #officeList non presente nel folder)
      if (card) {
        card.style.transition = 'all 0.25s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(40px)';
        setTimeout(function() {
          card.remove();
          if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
          // Se siamo nel folder e la lista è vuota, mostra stato vuoto
          var list = document.getElementById('officeFolderList');
          if (list && list.children.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div style="font-size:48px;margin-bottom:12px;">✅</div><div style="font-size:15px;color:rgba(30,58,95,0.4);">'+tr('officeNoDrawer')+'</div></div>';
          }
          officeLoadHome();
        }, 270);
      } else {
        if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
        officeLoadHome();
      }
      if (typeof showScToast === 'function') showScToast('✓ Risolto');
    }

  } catch(e) {
    if (typeof showScToast === 'function') showScToast('❌ ' + tr('errorPrefix') + e.message);
  }
};

// ── RIAPRI item da stato letto ──
window.officeReopen = async function(id) {
  var sb = window.supa;
  if (!sb) return;
  try {
    await sb.from('office_items').update({ priority: 'orange', resolution: null, status: 'open' }).eq('id', id);
    if (window._officeCurrentFolder && document.getElementById('officeFolder')) {
      // Siamo dentro una folder — ricarica quella
      window.officeOpenFolder(window._officeCurrentFolder);
    } else {
      officeLoad();
    }
    if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
    if (typeof showScToast === 'function') showScToast('↩ Riaperto');
  } catch(e) {
    if (typeof showScToast === 'function') showScToast('❌ ' + e.message);
  }
};


// ── AZIONE CHEF SU TELL CHEF ──
window.officeChefAction = async function(id, action) {
  var sb = window.supa;
  if (!sb) return;
  try {
    var now = new Date().toISOString();
    var byName = (window.currentUser || window.user || {}).name || 'Max';

    // Salva nel DB — sempre, per i bot
    await sb.from('office_items').update({
      chef_action:    action,
      chef_action_at: now,
      chef_action_by: byName,
      status:   action === 'ignored' ? 'resolved' : 'open',
      resolution: action === 'ignored' ? 'ignored' : null,
      priority: action === 'working_on_it' ? 'orange' : (action === 'done' ? 'blue' : undefined),
      resolved_by: byName,
      resolved_at: action === 'ignored' ? now : null,
    }).eq('id', id);

    // Effetto visivo sulla card
    var card = document.querySelector('[data-item-id="' + id + '"]');
    if (!card) { officeLoad(); return; }

    if (action === 'ignored') {
      // Sparisce con animazione
      card.style.transition = 'all 0.25s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(40px)';
      setTimeout(function() {
        if (window._officeCurrentFolder && document.getElementById('officeFolder')) {
          window.officeOpenFolder(window._officeCurrentFolder);
        } else {
          officeLoad();
        }
        if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
      }, 270);
      if (typeof showScToast === 'function') showScToast('🚫 Ignorato');

    } else if (action === 'working_on_it') {
      // Bordino arancione, body rimane visibile
      card.style.borderLeft = '3px solid #f59e0b';
      card.style.background = '#fffbeb';
      var dot = card.querySelector('[data-role="dot"]');
      if (dot) dot.style.background = '#f59e0b';
      var actions = card.querySelector('[data-role="actions"]');
      if (actions) actions.innerHTML =
        '<div style="padding:0 14px 12px;">' +
          '<div style="font-size:12px;color:#f59e0b;font-weight:700;margin-bottom:6px;">⚙️ Working on it</div>' +
          '<button onclick="officeChefAction(this.dataset.id,\'done\')" data-id="' + id + '"" ' +
            'style="width:100%;padding:10px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:0.5px solid #22c55e;background:#f0fdf4;color:#15803d;">✓ Mark Done</button>' +
        '</div>';
      if (typeof showScToast === 'function') showScToast('⚙️ Working on it');
      if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();

    } else if (action === 'done') {
      // Verde, va in fondo visivamente, rimane in lista
      card.style.borderLeft = '3px solid #22c55e';
      card.style.background = '#f0fdf4';
      card.style.opacity = '0.7';
      var dot2 = card.querySelector('[data-role="dot"]');
      if (dot2) dot2.style.background = '#22c55e';
      var body2 = card.querySelector('[data-role="body"]');
      var ai2   = card.querySelector('[data-role="ai"]');
      if (body2) body2.style.display = 'none';
      if (ai2)   ai2.style.display   = 'none';
      var actions2 = card.querySelector('[data-role="actions"]');
      if (actions2) actions2.innerHTML =
        '<div style="padding:0 14px 12px;font-size:12px;color:#22c55e;font-weight:700;">✓ Done — ' + byName + '</div>';
      // Sposta in fondo
      var parent = card.parentNode;
      if (parent) { parent.removeChild(card); parent.appendChild(card); }
      if (typeof showScToast === 'function') showScToast('✓ Done');
      if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
    }

  } catch(e) {
    if (typeof showScToast === 'function') showScToast('❌ ' + e.message);
  }
};

// ── BADGE NEI TRE PUNTINI — mostra numero items aperti ──
window.officeBadgeUpdate = async function() {
  var sb = window.supa;
  if (!sb) return;
  try {
    var res = await sb.from('office_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .is('chef_action', null);
    var count = res.count || 0;
    var badge = document.getElementById('officeMenuBadge');
    if (!badge) return;
    if (count > 0) {
      badge.style.display = 'inline-flex';
      badge.textContent = count;
    } else {
      badge.style.display = 'none';
    }
  } catch(e) {}
};

// ── INVESTIGA — apre Sous Chef con testo item precaricato ──
window.officeInvestiga = function(id) {
  var card = document.querySelector('[data-item-id="' + id + '"]');
  var title = card ? (card.querySelector('[data-role="body"]')?.textContent || card.querySelector('div[style*="font-size:20px"]')?.textContent || '') : '';
  // Chiudi L'Ufficio
  if (typeof officeStopRealtime === 'function') officeStopRealtime();
  document.getElementById('officeOverlay')?.remove();
  document.getElementById('officeModal')?.remove();
  // Apri Sous Chef con testo precaricato
  if (typeof window.openSousChef === 'function') {
    window.openSousChef(title.trim());
  }
};


window.officeOpenRecipe = async function(itemId, recipeId) {
  // Chiudi L'Ufficio
  if (typeof officeStopRealtime === 'function') officeStopRealtime();
  document.getElementById('officeOverlay')?.remove();
  document.getElementById('officeModal')?.remove();

  if (!recipeId) return;

  // Vai al tab Ricette
  if (typeof showTab === 'function') showTab('recipes');

  // Piccola attesa per il render del tab, poi apri editor
  setTimeout(async function() {
    try {
      var { data: recipe } = await supa
        .from('recipes')
        .select('*')
        .eq('id', recipeId)
        .maybeSingle();
      if (recipe && typeof openRecipeEditor === 'function') {
        openRecipeEditor(recipe);
      }
    } catch(e) {
      console.error('[officeOpenRecipe]', e);
    }
  }, 400);
};


// ══════════════════════════════════════════════════════════════
// INVENTORY SETUP — pagina admin per stock iniziale e recipe health
// ══════════════════════════════════════════════════════════════

window.officeOpenInventorySetup = function() {
  var sb = window.supa;
  if (!sb) return;

  // Crea overlay + panel
  var overlay = document.createElement('div');
  overlay.id = 'invSetupOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:399;background:rgba(0,0,0,0.3);';
  overlay.onclick = function(e) {
    if (e.target === overlay) {
      overlay.remove();
      document.getElementById('invSetupPanel')?.remove();
    }
  };
  document.body.appendChild(overlay);

  var panel = document.createElement('div');
  panel.id = 'invSetupPanel';
  panel.style.cssText = [
    'position:fixed;top:0;bottom:0;z-index:400;',
    'background:linear-gradient(160deg,#eff6ff 0%,#dbeafe 60%,#e0f2fe 100%);',
    'display:flex;flex-direction:column;overflow:hidden;',
    'font-family:Inter,system-ui,sans-serif;',
    'width:100%;max-width:480px;left:50%;transform:translateX(-50%);',
  ].join('');

  panel.innerHTML =
    // Header
    '<div style="background:rgba(255,255,255,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:0.5px solid rgba(99,102,241,0.15);padding:14px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
      '<button onclick="document.getElementById(\'invSetupOverlay\')?.remove();document.getElementById(\'invSetupPanel\')?.remove();" style="color:#6366f1;background:none;border:none;font-size:22px;cursor:pointer;padding:4px;line-height:1;">&#8592;</button>' +
      '<div style="font-size:16px;font-weight:700;color:#1e3a5f;flex:1;">📦 Inventory Setup</div>' +
    '</div>' +
    // Tab bar
    '<div id="invSetupTabs" style="display:flex;border-bottom:0.5px solid rgba(99,102,241,0.15);background:rgba(255,255,255,0.7);flex-shrink:0;">' +
      '<button id="invTabA" onclick="invShowSection(\'A\')" style="flex:1;padding:12px;font-size:13px;font-weight:700;color:#6366f1;background:none;border:none;border-bottom:2px solid #6366f1;">A · Stock iniziale</button>' +
      '<button id="invTabB" onclick="invShowSection(\'B\')" style="flex:1;padding:12px;font-size:13px;font-weight:600;color:#94a3b8;background:none;border:none;border-bottom:2px solid transparent;">B · Recipe Health</button>' +
    '</div>' +
    // Contenuto
    '<div id="invSetupContent" style="flex:1;overflow-y:auto;padding:16px 16px 80px;-webkit-overflow-scrolling:touch;">' +
      '<div style="text-align:center;padding:40px;color:#94a3b8;">Caricamento...</div>' +
    '</div>';

  document.body.appendChild(panel);
  invShowSection('A');
};

// ── Tab switch ──
window.invShowSection = function(section) {
  // Stile tab attiva/inattiva
  var tA = document.getElementById('invTabA');
  var tB = document.getElementById('invTabB');
  if (tA && tB) {
    if (section === 'A') {
      tA.style.color = '#6366f1'; tA.style.borderBottom = '2px solid #6366f1'; tA.style.fontWeight = '700';
      tB.style.color = '#94a3b8'; tB.style.borderBottom = '2px solid transparent'; tB.style.fontWeight = '600';
    } else {
      tB.style.color = '#6366f1'; tB.style.borderBottom = '2px solid #6366f1'; tB.style.fontWeight = '700';
      tA.style.color = '#94a3b8'; tA.style.borderBottom = '2px solid transparent'; tA.style.fontWeight = '600';
    }
  }
  var container = document.getElementById('invSetupContent');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">Caricamento...</div>';
  if (section === 'A') invLoadSectionA(container);
  else invLoadSectionB(container);
};

// ── SEZIONE A: Stock iniziale ──
window.invLoadSectionA = async function(container) {
  var sb = window.supa;
  try {
    var res = await sb.from('prep_tasks')
      .select('id,name,category,unit,current_stock,recipe_id,prep_type')
      .is('current_stock', null)
      .eq('archived', false)
      .order('category')
      .order('name');
    var tasks = res.data || [];

    if (tasks.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;">' +
        '<div style="font-size:48px;margin-bottom:12px;">✅</div>' +
        '<div style="font-size:16px;font-weight:600;color:#059669;">Tutti i task hanno stock!</div>' +
        '<div style="font-size:13px;color:#94a3b8;margin-top:6px;">Il conteggio fisico è completo.</div>' +
      '</div>';
      return;
    }

    // Raggruppa per stazione
    var byStation = {};
    tasks.forEach(function(t) {
      var st = t.category || 'Altro';
      if (!byStation[st]) byStation[st] = [];
      byStation[st].push(t);
    });

    var html = '<div style="margin-bottom:12px;font-size:13px;color:#64748b;padding:4px 0;">' +
      '<span style="font-weight:700;color:#dc2626;">' + tasks.length + '</span> prep tasks senza stock · inserisci il conteggio fisico</div>';

    Object.keys(byStation).sort().forEach(function(station) {
      html += '<div style="margin-bottom:20px;">' +
        '<div style="font-size:11px;font-weight:700;color:#6366f1;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;padding-left:2px;">' + station + '</div>';

      byStation[station].forEach(function(t) {
        var unit = t.unit || '';
        var typeChip = '';
        if (t.prep_type === 'finale') typeChip = '<span style="font-size:10px;background:rgba(5,150,105,0.12);color:#059669;border-radius:4px;padding:1px 5px;margin-left:6px;">finale</span>';
        else if (t.prep_type === 'supporto') typeChip = '<span style="font-size:10px;background:rgba(99,102,241,0.12);color:#6366f1;border-radius:4px;padding:1px 5px;margin-left:6px;">supporto</span>';
        else if (t.prep_type === 'checklist') typeChip = '<span style="font-size:10px;background:rgba(148,163,184,0.15);color:#64748b;border-radius:4px;padding:1px 5px;margin-left:6px;">check</span>';

        html +=
          '<div style="background:rgba(255,255,255,0.75);border:0.5px solid rgba(99,102,241,0.15);border-radius:14px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;">' +
            '<div style="flex:1;">' +
              '<div style="font-size:14px;font-weight:600;color:#1e3a5f;">' + t.name + typeChip + '</div>' +
              (unit ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + unit + '</div>' : '') +
            '</div>' +
            '<input id="invA_' + t.id + '" type="number" min="0" step="any" placeholder="0" ' +
              'style="width:70px;padding:8px 10px;border:1.5px solid rgba(99,102,241,0.3);border-radius:10px;font-size:14px;font-weight:600;color:#1e3a5f;background:white;text-align:right;" ' +
              'onkeydown="if(event.key===\'Enter\') invSaveStock(' + t.id + ')">' +
            '<button onclick="invSaveStock(' + t.id + ')" ' +
              'style="height:36px;padding:0 14px;background:#6366f1;color:white;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">' +
              'Salva' +
            '</button>' +
          '</div>';
      });

      html += '</div>';
    });

    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div style="color:#ef4444;padding:20px;">Errore: ' + e.message + '</div>';
  }
};

// ── Salva singolo stock ──
window.invSaveStock = async function(taskId) {
  var sb = window.supa;
  var input = document.getElementById('invA_' + taskId);
  if (!input) return;
  var val = parseFloat(input.value);
  if (isNaN(val) || val < 0) {
    input.style.borderColor = '#ef4444';
    return;
  }
  input.disabled = true;
  try {
    var { error } = await sb.from('prep_tasks')
      .update({ current_stock: val })
      .eq('id', taskId);
    if (error) throw error;
    // Visual feedback: sostituisci riga con pill verde
    var row = input.closest('div[style*="border-radius:14px"]');
    if (row) {
      var name = row.querySelector('div[style*="font-weight:600"]')?.textContent || '';
      row.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:2px 0;">' +
        '<span style="font-size:16px;">✅</span>' +
        '<span style="font-size:13px;color:#059669;font-weight:600;">' + (name.split('<')[0]) + '</span>' +
        '<span style="font-size:12px;color:#059669;margin-left:4px;">→ ' + val + '</span>' +
      '</div>';
      row.style.background = 'rgba(5,150,105,0.07)';
      row.style.borderColor = 'rgba(5,150,105,0.3)';
    }
  } catch(e) {
    input.disabled = false;
    input.style.borderColor = '#ef4444';
    alert('Errore salvataggio: ' + e.message);
  }
};

// ── SEZIONE B: Recipe Health ──
window.invLoadSectionB = async function(container) {
  var sb = window.supa;
  try {
    // Ricette collegate a prep_tasks attivi con dati mancanti
    var ptRes = await sb.from('prep_tasks')
      .select('id,name,category,recipe_id')
      .eq('archived', false)
      .not('recipe_id', 'is', null);
    var ptData = ptRes.data || [];

    // Recipe IDs unici
    var recipeIds = [...new Set(ptData.map(function(t){ return t.recipe_id; }))];

    if (recipeIds.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;">Nessuna prep task collegata a ricette.</div>';
      return;
    }

    // Leggi ricette in batch (max 100 IDs)
    var recRes = await sb.from('recipes')
      .select('id,title,base_weight_g,shelf_life_days,base_servings')
      .in('id', recipeIds);
    var recipes = recRes.data || [];

    // Filtra solo quelle con dati mancanti
    var missing = recipes.filter(function(r) {
      return !r.base_weight_g || !r.shelf_life_days;
    });

    // Mappa recipe_id → prep tasks
    var tasksByRecipe = {};
    ptData.forEach(function(t) {
      if (!tasksByRecipe[t.recipe_id]) tasksByRecipe[t.recipe_id] = [];
      tasksByRecipe[t.recipe_id].push(t.name);
    });

    if (missing.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px 20px;">' +
        '<div style="font-size:48px;margin-bottom:12px;">✅</div>' +
        '<div style="font-size:16px;font-weight:600;color:#059669;">Tutte le ricette sono complete!</div>' +
        '<div style="font-size:13px;color:#94a3b8;margin-top:6px;">base_weight_g e shelf_life_days presenti su tutte le ricette attive.</div>' +
      '</div>';
      return;
    }

    var html = '<div style="margin-bottom:12px;font-size:13px;color:#64748b;padding:4px 0;">' +
      '<span style="font-weight:700;color:#f59e0b;">' + missing.length + '</span> ricette con dati mancanti · ogni correzione sblocca il bot</div>';

    missing.forEach(function(r) {
      var linkedTasks = tasksByRecipe[r.id] || [];
      var taskHtml = linkedTasks.length > 0
        ? '<div style="font-size:11px;color:#60a5fa;margin-top:3px;">↳ ' + linkedTasks.join(' · ') + '</div>'
        : '';

      html +=
        '<div style="background:rgba(255,255,255,0.75);border:0.5px solid rgba(245,158,11,0.2);border-radius:14px;padding:14px;margin-bottom:10px;" id="invBRow_' + r.id + '">' +
          '<div style="font-size:14px;font-weight:700;color:#1e3a5f;margin-bottom:4px;">' + r.title + '</div>' +
          taskHtml +
          '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">';

      // Campo base_weight_g
      if (!r.base_weight_g) {
        html +=
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="font-size:12px;color:#d97706;font-weight:600;width:110px;flex-shrink:0;">⚖️ Peso batch (g)</div>' +
            '<input id="invBw_' + r.id + '" type="number" min="0" step="1" placeholder="es. 5500" ' +
              'style="flex:1;padding:7px 10px;border:1.5px solid rgba(245,158,11,0.35);border-radius:9px;font-size:13px;font-weight:600;color:#1e3a5f;background:white;">' +
          '</div>';
      }

      // Campo shelf_life_days
      if (!r.shelf_life_days) {
        html +=
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="font-size:12px;color:#d97706;font-weight:600;width:110px;flex-shrink:0;">📅 Shelf life (gg)</div>' +
            '<input id="invBs_' + r.id + '" type="number" min="1" step="1" placeholder="es. 5" ' +
              'style="flex:1;padding:7px 10px;border:1.5px solid rgba(245,158,11,0.35);border-radius:9px;font-size:13px;font-weight:600;color:#1e3a5f;background:white;">' +
          '</div>';
      }

      html +=
          '</div>' +
          '<div style="margin-top:10px;text-align:right;">' +
            '<button class="invBSaveBtn" data-rid="' + r.id + '" data-bw="' + (!r.base_weight_g ? '1' : '0') + '" data-sl="' + (!r.shelf_life_days ? '1' : '0') + '" ' +
              'style="height:34px;padding:0 16px;background:#f59e0b;color:white;border:none;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;">' +
              'Salva' +
            '</button>' +
          '</div>' +
        '</div>';
    });

    container.innerHTML = html;

    // Attacca listener ai bottoni Salva (evita inline onclick con parametri complessi)
    container.querySelectorAll('.invBSaveBtn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        invSaveRecipeHealth(btn.dataset.rid, btn.dataset.bw === '1', btn.dataset.sl === '1');
      });
    });
  } catch(e) {
    container.innerHTML = '<div style="color:#ef4444;padding:20px;">Errore: ' + e.message + '</div>';
  }
};

// ── Salva recipe health ──
window.invSaveRecipeHealth = async function(recipeId, hasBw, hasSl) {
  var sb = window.supa;
  var update = {};

  if (hasBw) {
    var bwInput = document.getElementById('invBw_' + recipeId);
    if (bwInput) {
      var bw = parseFloat(bwInput.value);
      if (!isNaN(bw) && bw > 0) update.base_weight_g = bw;
    }
  }
  if (hasSl) {
    var slInput = document.getElementById('invBs_' + recipeId);
    if (slInput) {
      var sl = parseInt(slInput.value);
      if (!isNaN(sl) && sl > 0) update.shelf_life_days = sl;
    }
  }

  if (Object.keys(update).length === 0) return;

  try {
    var { error } = await sb.from('recipes').update(update).eq('id', recipeId);
    if (error) throw error;
    // Visual feedback
    var row = document.getElementById('invBRow_' + recipeId);
    if (row) {
      var savedFields = [];
      if (update.base_weight_g) savedFields.push('⚖️ ' + update.base_weight_g + 'g');
      if (update.shelf_life_days) savedFields.push('📅 ' + update.shelf_life_days + 'gg');
      row.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="font-size:16px;">✅</span>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:600;color:#059669;">' + recipeId + '</div>' +
            '<div style="font-size:12px;color:#059669;">' + savedFields.join(' · ') + ' salvati</div>' +
          '</div>' +
        '</div>';
      row.style.background = 'rgba(5,150,105,0.07)';
      row.style.borderColor = 'rgba(5,150,105,0.3)';
    }
  } catch(e) {
    alert('Errore: ' + e.message);
  }
};
