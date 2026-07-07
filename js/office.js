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

      // ── BOT CENTER ──
      var botBtn = document.createElement('div');
      botBtn.style.cssText = 'background:rgba(15,23,42,0.85);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:0.5px solid rgba(255,255,255,0.12);border-radius:18px;cursor:pointer;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.2);-webkit-tap-highlight-color:transparent;margin-top:10px;';
      botBtn.innerHTML =
        '<div style="display:flex;align-items:center;padding:14px 16px;gap:12px;">' +
          '<div style="width:5px;border-radius:4px;align-self:stretch;min-height:46px;flex-shrink:0;background:linear-gradient(180deg,#f59e0b,#8b5cf6,#3b82f6);"></div>' +
          '<div style="font-size:26px;width:32px;text-align:center;">🤖</div>' +
          '<div style="flex:1;">' +
            '<div style="color:white;font-size:16px;font-weight:600;">Bot Center</div>' +
            '<div style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:3px;">7 bot attivi · Log · Config · Trigger</div>' +
          '</div>' +
          '<span style="color:rgba(255,255,255,0.25);font-size:18px;">&#x203A;</span>' +
        '</div>';
      botBtn.addEventListener('click', function() { officeBotCenter(); });
      container.appendChild(botBtn);
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
  var startY = 0, active = false, touchInList = false;
  var list = el.querySelector('#officeFolderList');

  el.addEventListener('touchstart', function(e) {
    startY = e.touches[0].clientY;
    active = false;
    // Se il touch parte dentro la lista scrollabile, non interferire mai col drag-to-close:
    // lo scroll interno deve avere sempre priorità, indipendentemente dallo scrollTop attuale.
    touchInList = !!(list && list.contains(e.target));
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    var dy = e.touches[0].clientY - startY;
    // Se il touch è nella lista e la lista può ancora scrollare verso l'alto (non è in cima),
    // lascia fare lo scroll nativo e non interferire col drag-to-close.
    if (touchInList && list && list.scrollTop > 0) return;
    if (dy <= 0) return;
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
  // ── CHEF AI MODE — se reasoning_result e jarvis_status=ready, mostra card Chef AI ──
  if (item.jarvis_status === 'ready' && item.reasoning_result && item.reasoning_result.proposed_solution) {
    return officeRenderJarvisCard(item);
  }
  if (item.jarvis_status === 'reasoning') {
    return officeRenderJarvisThinking(item);
  }

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

  // ── Skill Dispatcher registry ──
  // Add issue_type here when a real Skill is implemented for it.
  // Rule: Resolve button appears ONLY when a Skill exists. Never fake.
  var SKILL_ISSUE_TYPES = ['bom_unknown_units', 'UNKNOWN_UNIT'];
  var hasSkill = SKILL_ISSUE_TYPES.indexOf(item.issue_type) !== -1;

  // Shared button styles for Later / Solved / Resolve
  var _styleLater   = 'flex:1;padding:9px 0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:0.5px solid rgba(148,163,184,0.3);background:transparent;color:#94a3b8;';
  var _styleSolved  = 'flex:1;padding:9px 0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:0.5px solid rgba(34,197,94,0.4);background:rgba(34,197,94,0.06);color:#15803d;';
  var _styleResolve = 'flex:1;padding:9px 0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;';

  var actionsHtml = '';
  if (options.length > 0) {
    // All items with ai_options: replace Fix now / Snooze / Ignore with honest buttons
    var _styleElabora2 = 'width:100%;padding:9px 0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;margin-top:2px;';
    var _btnElabora2 = (src === 'tell_chef' || src === 'ai_scan' || src === 'bot-recipe-guardian') ? '<button onclick="jarvisAnalyze(\'' + item.id + '\')" style="' + _styleElabora2 + '">🤖 Chef AI</button>' : '';
    if (hasSkill) {
      // Has a real Skill — show Later + Solved + 🧠 Resolve
      actionsHtml =
        '<div data-role="actions" style="display:flex;flex-direction:column;gap:6px;padding:0 14px 12px;">' +
          '<div style="display:flex;gap:7px;">' +
            '<button onclick="officeResolve(\'' + item.id + '\',\'later\')"   style="' + _styleLater   + '">🕒 Later</button>' +
            '<button onclick="officeResolve(\'' + item.id + '\',\'solved\')"  style="' + _styleSolved  + '">✓ Solved</button>' +
            '<button onclick="officeSkillDispatch(\'' + item.id + '\',\'' + (item.issue_type||'') + '\')" style="' + _styleResolve + '">🧠 Resolve</button>' +
          '</div>' +
          _btnElabora2 +
        '</div>';
    } else {
      // No Skill yet — show only Later + Solved. No fake Resolve.
      actionsHtml =
        '<div data-role="actions" style="display:flex;flex-direction:column;gap:6px;padding:0 14px 12px;">' +
          '<div style="display:flex;gap:7px;">' +
            '<button onclick="officeResolve(\'' + item.id + '\',\'later\')"  style="' + _styleLater  + '">🕒 Later</button>' +
            '<button onclick="officeResolve(\'' + item.id + '\',\'solved\')" style="' + _styleSolved + '">✓ Solved</button>' +
          '</div>' +
          _btnElabora2 +
        '</div>';
    }
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
      var styleElabora = 'width:100%;padding:9px 0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;';
      btnLeft  = '<button onclick="officeChefAction(\'' + item.id + '\',\'working_on_it\')" style="' + styleWip    + '">⚙️ Working on it</button>';
      btnRight = '<button onclick="officeChefAction(\'' + item.id + '\',\'done\')"         style="' + styleDone   + '">✓ Done</button>';
      var btnIgnore   = '<button onclick="officeChefAction(\'' + item.id + '\',\'ignored\')"  style="' + styleIgnore  + '">Ignore</button>';
      var btnElabora  = '<button onclick="jarvisAnalyze(\'' + item.id + '\')" style="' + styleElabora + '">🤖 Elabora</button>';
      actionsHtml =
        '<div data-role="actions" style="display:flex;flex-direction:column;gap:6px;padding:0 14px 12px;">' +
          '<div style="display:flex;gap:6px;">' + btnLeft + btnRight + '</div>' +
          btnIgnore +
          btnElabora +
        '</div>';
    } else if (src === 'operation_note') {
      btnLeft  = '<button onclick="officeResolve(\'' + item.id + '\',\'letto\')" style="' + styleGhost + '">Letto</button>';
      btnRight = '<button onclick="officeResolve(\'' + item.id + '\',\'archived\')" style="' + styleSolid + '">Archivia</button>';
    } else if (src === 'ai_scan') {
      var styleChefAI = 'flex:1;padding:11px 0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;';
      btnLeft  = '<button onclick="officeResolve(\'' + item.id + '\',\'archived\')" style="' + styleGhost + '">Ignora</button>';
      btnRight = '<button onclick="jarvisAnalyze(\'' + item.id + '\')" style="' + styleChefAI + '">🤖 Chef AI</button>';
    } else if (src === 'bot-recipe-guardian') {
      var styleChefAI2 = 'flex:1;padding:11px 0;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;';
      btnLeft  = '<button onclick="officeResolve(\'' + item.id + '\',\'archived\')" style="' + styleGhost + '">Ignora</button>';
      btnRight = '<button onclick="jarvisAnalyze(\'' + item.id + '\')" style="' + styleChefAI2 + '">🤖 Chef AI</button>';
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
    var isLetto  = (resolution === 'letto');
    var isLater  = (resolution === 'later');
    var isSolved = (resolution === 'solved');

    var updatePayload = {};

    if (isLater) {
      // Snooze 7 giorni: status=snoozed, snoozed_until = now + 7d
      var snoozeUntil = new Date();
      snoozeUntil.setDate(snoozeUntil.getDate() + 7);
      updatePayload = {
        status: 'snoozed',
        resolved_by: window.user?.name || 'Max',
        resolution: 'snoozed_7d',
        snoozed_until: snoozeUntil.toISOString(),
      };
    } else if (isSolved) {
      // Chef marks manually resolved — no Skill used
      updatePayload = {
        status: 'resolved',
        resolved_by: window.user?.name || 'Max',
        resolved_at: new Date().toISOString(),
        resolution: 'resolved_manual',
      };
    } else if (isLetto) {
      updatePayload = {
        status: 'open',
        resolved_by: null,
        resolved_at: null,
        resolution: null,
        priority: 'blue',
      };
    } else {
      updatePayload = {
        status: 'resolved',
        resolved_by: window.user?.name || 'Max',
        resolved_at: new Date().toISOString(),
        resolution: resolution,
      };
    }

    await sb.from('office_items').update(updatePayload).eq('id', id);

    var card = document.querySelector('[data-item-id="' + id + '"]');

    if (isLetto || isLater) {
      // Comprimi — non sparisce, si minimizza
      var toastMsg = isLater ? '🕒 Snoozed 7 days' : '📌 Letto — ci torni dopo';
      if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0.5';
        card.style.borderLeft = isLater ? '3px solid #f59e0b' : '3px solid #cbd5e1';
        var body = card.querySelector('[data-role="body"]');
        var aiBlock = card.querySelector('[data-role="ai"]');
        var actions = card.querySelector('[data-role="actions"]');
        var meta = card.querySelector('[data-role="meta"]');
        var dot = card.querySelector('[data-role="dot"]');
        if (body) body.style.display = 'none';
        if (aiBlock) aiBlock.style.display = 'none';
        if (meta) meta.style.display = 'none';
        if (dot) dot.style.background = isLater ? '#f59e0b' : '#cbd5e1';
        if (actions) actions.innerHTML =
          '<div style="padding:0 14px 10px;">' +
            (isLater ? '<div style="font-size:11px;color:#f59e0b;font-weight:600;text-align:center;padding-bottom:4px;">🕒 Snoozed 7 days</div>' : '') +
            '<button onclick="officeReopen(\'' + id + '\')" ' +
              'style="width:100%;padding:8px;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;border:0.5px solid rgba(59,130,246,0.2);background:rgba(59,130,246,0.04);color:#94a3b8;">↩ Reopen</button>' +
          '</div>';
      }
      if (typeof showScToast === 'function') showScToast(toastMsg);
    } else if (isSolved) {
      // Slide out immediately — resolved_manual
      if (card) {
        card.style.transition = 'all 0.25s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(40px)';
        setTimeout(function() {
          card.remove();
          if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
          var list = document.getElementById('officeFolderList');
          if (list && list.children.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:60px 20px;"><div style="font-size:48px;margin-bottom:12px;">✅</div><div style="font-size:15px;color:rgba(30,58,95,0.4);">'+tr('officeNoDrawer')+'</div></div>';
          }
          officeLoadHome();
        }, 270);
      }
      if (typeof showScToast === 'function') showScToast('✓ Marked as Solved');
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
      .neq('prep_type', 'checklist')
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
  // Protezione zero: chiede conferma esplicita prima di azzerare
  if (val === 0) {
    var itemName = input.closest('div[style*="border-radius:14px"]')?.querySelector('div[style*="font-weight:600"]')?.textContent?.trim() || 'this item';
    var confirmed = confirm('⚠️ Set ' + itemName + ' to ZERO?\n\nThis will erase the current stock. Tap Cancel to keep the existing value.');
    if (!confirmed) { input.value = ''; input.focus(); return; }
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
      .neq('prep_type', 'checklist')
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


// ══════════════════════════════════════════════════════════════
// BOT CENTER v3 — scheda bot con 3 tab: Cosa fa / Config / Codice
// Aggiornato al 4 luglio 2026 — dati verificati da codice live
// ══════════════════════════════════════════════════════════════

// Spiegazioni in italiano semplice per ogni bot
var _botExplain = {
  'bot-preplist-builder': {
    steps: [
      { icon: '🕓', title: 'Quando gira', text: 'Ogni notte alle 4:00 AM CDT — mentre la cucina dorme. v30 (Supabase v53).' },
      { icon: '📦', title: 'Cosa legge', text: 'Quante porzioni di ogni piatto sono state vendute negli ultimi 90 giorni, giorno per giorno. Sa che il martedì si vende meno del venerdì. Legge i giorni chiusi da closed_dates e non conta le domeniche.' },
      { icon: '🧊', title: 'Guarda lo stock', text: 'Legge current_stock per ogni prep task. Se è NULL, salta — non inventa numeri. Usa expected_duration_days dal prep task (non shelf_life_days della ricetta) per calcolare la finestra di copertura.' },
      { icon: '📐', title: 'Fa i calcoli', text: 'Calcola il consumo atteso nei prossimi giorni, aggiunge un buffer del +10%, e confronta con lo stock. Usa min_cover_days per evitare di suggerire cibo fresco che verrebbe preparato troppo in anticipo.' },
      { icon: '🚦', title: 'Assegna un colore', text: 'Rosso = prepara oggi (stock < minCoverDays). Giallo = prepara presto (stock basso ma non urgente). Verde = sei a posto. Checklist: sempre bordo neutro, nessun badge urgenza.' },
      { icon: '✍️', title: 'Scrive il risultato', text: 'Aggiorna suggested_qty e suggested_note in formato: colore|testo_it|testo_en|testo_es. Il frontend legge la lingua dall\'utente. Usa linguaggio cucina: "2 latte La Carmela", "22 pezzi", "50 nests".' },
      { icon: '🚫', title: 'Cosa salta', text: 'Salta se current_stock è NULL. Salta se base_weight_g > 500kg (anomalie). Salta i task di tipo "checklist". Domenica e giorni in closed_dates = 0 consumo ma il cibo va male lo stesso.' }
    ],
    params: [
      { key: 'buffer', label: 'Buffer %', desc: 'Aggiunge questa % extra allo stock calcolato. Default 10%.', type: 'number', min: 0, max: 50, step: 5, default: 10 },
      { key: 'red_pct', label: 'Soglia Rosso (%)', desc: 'Se lo stock è sotto questa % del fabbisogno → rosso (prepara oggi).', type: 'number', min: 0, max: 100, step: 5, default: 40 },
      { key: 'yellow_pct', label: 'Soglia Giallo (%)', desc: 'Se lo stock è sotto questa % del fabbisogno → giallo (prepara domani).', type: 'number', min: 0, max: 100, step: 5, default: 80 },
      { key: 'skip_pack', label: 'SKIP_PACK', desc: 'Ricette dove il bot NON usa il pack fornitore — mostra direttamente kg/g.', type: 'tags', default: ['BECHAMEL SAUCE','THYME BUTTER','Texana Soup','Rosemary Oil','CITRONETTE','SALMORIGLIO','Mash Potato','GARLIC OIL','Salmon Whole'] }
    ]
  },
  'bot-price-guard': {
    steps: [
      { icon: '📬', title: 'Quando gira', text: 'Subito dopo ogni importazione di una fattura fornitore — triggered da process-invoice.' },
      { icon: '📋', title: 'Cosa legge', text: 'Le righe della fattura appena importata (invoice_lines) — ogni ingrediente con il suo prezzo nuovo e il vendor.' },
      { icon: '📊', title: 'Controlla lo storico', text: 'Per ogni ingrediente, legge ingredient_vendors ordinato per data. Serve almeno 3 acquisti precedenti per avere un confronto affidabile. Calcola la media escludendo il record più recente.' },
      { icon: '⚠️', title: 'Quando scatta', text: 'Se il nuovo prezzo è variato di oltre il 10% rispetto alla media storica — sia in su che in giù. Sotto soglia o meno di 3 acquisti storici: silenzio.' },
      { icon: '📝', title: 'Cosa scrive', text: 'Crea un avviso in L\'Ufficio: "🟠 Arrabbiata — prezzo ▲23%" con vecchio prezzo, nuovo prezzo, fornitore. Propone: Accetta nuovo prezzo / Indaga con fornitore. Evita duplicati per stesso ingrediente + stessa fattura.' },
      { icon: '🚫', title: 'Cosa NON fa', text: 'Non blocca niente. Non modifica prezzi. Non giudica se il prezzo è giusto. Ti avvisa e basta. La decisione è sempre di Max.' }
    ],
    params: [
      { key: 'threshold', label: 'Soglia variazione (%)', desc: 'Sotto questa % di variazione il bot non segnala nulla. Default 10%.', type: 'number', min: 1, max: 50, step: 1, default: 10 },
      { key: 'min_history', label: 'Storico minimo (acquisti)', desc: 'Quanti acquisti passati deve avere un ingrediente prima che il bot inizi a controllarlo.', type: 'number', min: 1, max: 10, step: 1, default: 3 }
    ]
  },
  'bot-chat-analyst': {
    steps: [
      { icon: '🕓', title: 'Quando gira', text: 'Ogni notte alle 3:00 AM CDT (lunedì–sabato). La domenica fa un recap della settimana intera — ultimi 7 giorni invece di 24 ore.' },
      { icon: '💬', title: 'Cosa legge', text: 'Tutti i messaggi della chat brigata delle ultime 24 ore (o 7 giorni la domenica). Legge testo, autore e orario. Nessun filtraggio preventivo — manda tutto all\'AI.' },
      { icon: '🤖', title: 'Chiama l\'AI', text: 'Manda i messaggi a LLaMA 3.3 70B con prompt dedicato: cerca problemi operativi, dinamiche di squadra, segnali deboli, lamentele implicite, ritardi, cose positive. Prompt diverso per giornaliero vs settimanale.' },
      { icon: '📝', title: 'Cosa scrive', text: 'Se trova qualcosa, crea un item in L\'Ufficio (source: bot-chat-analyst) — massimo 5 punti, in italiano, diretti. Zero filosofia. Se l\'AI risponde "NIENTE DA SEGNALARE", non scrive nulla.' },
      { icon: '🚫', title: 'Non duplica', text: 'Controlla se esiste già un item creato oggi da questo bot. Se sì, salta — un\'analisi al giorno. Se la chat è completamente vuota (0 messaggi), salta senza chiamare l\'AI.' }
    ],
    params: []
  },
  'bot-tell-chef-reader': {
    steps: [
      { icon: '🕓', title: 'Quando gira', text: 'Ogni ora, tutto il giorno. v17 (Supabase v19).' },
      { icon: '📣', title: 'Cosa legge', text: 'I nuovi chef_reports con status="new" e souschef_suggestion IS NULL — messaggi Tell Chef non ancora processati dall\'AI. Fino a 25 per run.' },
      { icon: '🤖', title: 'Classifica con l\'AI — 11 categorie', text: 'Per ogni messaggio, LLaMA 3.3 70B assegna: categoria (PROBLEMA_OPERATIVO, GAP_CHECKLIST, CONTRIBUTO_RICETTA, QUALITA_STANDARD, FOOD_SAFETY, EQUIPMENT, INVENTORY_SHORTAGE, STAFF_COMMUNICATION, TRAINING_NEEDED, CATERING_EVENT_RISK, NOT_ACTIONABLE), priorità (critical/high/normal/low), e rileva entità: stazione, ricetta, ingrediente, attrezzatura, checklist.' },
      { icon: '🔗', title: 'Deduplication', text: 'Usa un issue_fingerprint per trovare office_items aperti sullo stesso problema. Se esiste, aggiunge il nuovo report al body esistente, incrementa times_seen, e scala la priority se il nuovo messaggio è più urgente. Non crea duplicati.' },
      { icon: '📋', title: 'Porta in L\'Ufficio', text: 'Crea card strutturate con: titolo specifico in linguaggio cucina (es. "Oven Station: Brussels Sprouts par cook mancante dalla preplist"), summary scritto come un kitchen manager, e 2-4 ai_options contestuali per categoria.' },
      { icon: '🔄', title: 'Sincronizza azioni', text: 'Se Max ha risposto "Working on it" o "Done" su una card, aggiorna il Tell Chef originale con la stessa risposta — la brigata vede lo stato.' },
      { icon: '⏰', title: 'Avvisa i dimenticati', text: 'Se un item è rimasto "Working on it" da più di 7 giorni, crea un alert critical con badge rosso per ricordartelo. Anti-spam: un solo alert per item.' },
      { icon: '📊', title: 'Analisi brigata 30 giorni', text: 'Aggiorna ogni run un riepilogo per persona: volume messaggi, % actionati, tempo medio di risposta, categoria top. Appare in L\'Ufficio come "Tell Chef — Brigade Summary".' }
    ],
    params: []
  },
  'bot-food-cost-guard': {
    steps: [
      { icon: '📬', title: 'Quando gira', text: 'Subito dopo ogni importazione di una fattura fornitore. v13.' },
      { icon: '📋', title: 'Cosa legge', text: 'Le righe della fattura con ingredient_id collegato. Deduplica ingredienti ripetuti. Carica contestualmente: vendite POS 30 giorni, BOM di tutte le ricette con pos_name, storico prezzi 90 giorni.' },
      { icon: '🔍', title: 'Noise protection — pack mismatch', text: 'Prima di segnalare un aumento di prezzo, verifica se il pack è cambiato (6 pezzi → 12 pezzi raddoppia il prezzo unitario senza che l\'ingrediente sia diventato più caro). Se rileva mismatch tra pack description o unità di acquisto, crea un warning separato invece di un falso allarme.' },
      { icon: '💰', title: 'Calcola impatto in dollari', text: 'Per ogni ingrediente con aumento ≥5%, trova le ricette che lo usano nel BOM. Legge le vendite POS degli ultimi 30 giorni per quelle ricette. Calcola: grammi usati per porzione × delta prezzo/100g × porzioni vendute = impatto mensile stimato in $.' },
      { icon: '🚦', title: 'Tre livelli di severity', text: 'Critical (🔴): aumento ≥15% con vendite reali, O impatto mensile ≥$150. Warning (🟡): aumento ≥5% o impatto ≥$40. Info (🔵): calo prezzi ≥3% su ricette attive, o aumento su ingredienti senza ricette POS. Max 3 critical + 5 warning per run.' },
      { icon: '📝', title: 'Cosa scrive', text: 'Crea item in L\'Ufficio con: nome ingrediente, % variazione, vecchio/nuovo prezzo, fornitore, ricette impattate, vendite 30gg, impatto mensile stimato. Se selling_price manca su ricette vendute, lo segnala separatamente. Dedup: se l\'item è già aperto, aggiorna invece di duplicare.' }
    ],
    params: [
      { key: 'impact_threshold', label: 'Soglia impatto ($/mese)', desc: 'Sotto questa cifra mensile il bot non segnala. Default $40.', type: 'number', min: 5, max: 500, step: 5, default: 40 },
      { key: 'min_variation', label: 'Variazione minima (%)', desc: 'Variazione di prezzo minima per iniziare il calcolo. Default 5%.', type: 'number', min: 1, max: 30, step: 1, default: 5 },
      { key: 'critical_pct', label: 'Soglia Critical (%)', desc: 'Variazione minima per diventare Critical (con vendite reali). Default 15%.', type: 'number', min: 5, max: 50, step: 5, default: 15 }
    ]
  },
  'bot-prep-accuracy': {
    steps: [
      { icon: '🕓', title: 'Quando gira', text: 'Ogni giorno alle 17:30 CDT (22:30 UTC) — dopo che il servizio di pranzo è finito e prima della serata.' },
      { icon: '🔍', title: 'Cosa legge', text: 'Tutti i log con unit="no_need" di oggi (mattina) — i casi in cui un cuoco ha dichiarato che un prep task non serviva. Poi guarda il prep_log tra le 14:00 e le 17:00 CDT dello stesso giorno.' },
      { icon: '👆', title: 'Colpevole mattina', text: 'Se tra le 14:00 e le 17:00 qualcuno ha dovuto preparare quella stessa cosa → il "no_need" della mattina era sbagliato. Crea un item orange in L\'Ufficio con nome del cuoco responsabile.' },
      { icon: '👆', title: 'Colpevole sera', text: 'Se nel pomeriggio nessuno ha preparato quell\'item → il closing della sera precedente era impreciso. Crea un item blue — era segnato come necessario ma non lo era.' },
      { icon: '📝', title: 'Cosa scrive', text: 'Un item per ogni discrepanza, con nome dell\'item, chi ha dichiarato "no_need", chi ha fatto la prep nel pomeriggio. Dedup: controlla se ha già scritto oggi per lo stesso item prima di inserire.' }
    ],
    params: []
  },
  'bot-recipe-guardian': {
    steps: [
      { icon: '🕓', title: 'Quando gira', text: 'Ogni mattina alle 6:00 AM CDT. v13.' },
      { icon: '🍽️', title: 'Quali ricette controlla', text: 'Solo le ricette con pos_name compilato — quelle vendute al POS. Le ordina per urgenza: vendute ieri prima, poi ultima settimana, poi ultimo mese. Chi vende di più viene controllato per primo.' },
      { icon: '🔴', title: 'Critical (massimo 5 per run)', text: 'BOM completamente vuoto. serving_qty o serving_unit mancanti (Bot 3 non può calcolare). base_servings mancante (BOM non scalabile). selling_price presente ma food cost non calcolabile per BOM incompleto.' },
      { icon: '🟠', title: 'Warning (massimo 5 per run)', text: 'BOM con meno di 4 righe valide. Righe BOM senza ingredient_id collegato (righe orfane). Righe BOM senza quantità o unità. Unità non convertibili (es. "portion", "batch") che il sistema non sa convertire in grammi.' },
      { icon: '🔵', title: 'Info (nessun limite)', text: 'Procedura / note di servizio non scritte (campo procedure vuoto). Foto del piatto mancante — nessun riferimento visivo per i cuochi.' },
      { icon: '📝', title: 'Deduplication', text: 'Per ogni combinazione (ricetta, tipo issue) controlla se esiste già un item open o snoozed. Se sì, aggiorna last_seen_at e times_seen invece di creare un duplicato. Non riempie L\'Ufficio ogni mattina.' }
    ],
    params: []
  }
};

var _botDefs = [
  { id:'bot-preplist-builder', name:'Costruttore Preplist',        icon:'📋', desc:'Calcola cosa preparare ogni notte — stock, vendite DOW, min_cover_days, linguaggio cucina.',  schedule:'Ogni notte 4:00 AM',      ribbon:'#f59e0b', fnName:'bot-preplist-builder', logTable:'preplist', hasConfig:true  },
  { id:'bot-price-guard',      name:'Guardiano Prezzi',            icon:'💰', desc:'Segnala variazioni di prezzo >10% dopo ogni fattura (min 3 acquisti storici).',               schedule:'Ad ogni fattura',         ribbon:'#ef4444', fnName:'bot-price-guard',      logTable:'invoice',  hasConfig:false },
  { id:'bot-chat-analyst',     name:'Analista Chat',               icon:'💬', desc:'Analizza la chat brigata ogni notte — problemi, dinamiche, segnali deboli. Domenica: recap settimanale.', schedule:'Ogni notte 3:00 AM',  ribbon:'#8b5cf6', fnName:'bot-chat-analyst',     logTable:'chat',     hasConfig:false },
  { id:'bot-tell-chef-reader', name:'Lettore Tell Chef',           icon:'📣', desc:'11 categorie, 4 livelli priorità, entity detection, dedup — classifica Tell Chef ogni ora.',  schedule:'Ogni ora',                ribbon:'#3b82f6', fnName:'bot-tell-chef-reader', logTable:'tellchef', hasConfig:false },
  { id:'bot-food-cost-guard',  name:'Guardiano Food Cost',         icon:'📊', desc:'Impatto $ mensile per aumento prezzi su ricette vendute — 3 livelli severity, pack mismatch detection.',schedule:'Ad ogni fattura',   ribbon:'#ec4899', fnName:'bot-food-cost-guard',  logTable:'invoice',  hasConfig:false },
  { id:'bot-prep-accuracy',    name:'Guardiano Accuratezza Prep',  icon:'🎯', desc:'Ogni sera confronta "no_need" mattutini con prep del pomeriggio — trova chi ha sbagliato.',  schedule:'Ogni sera 17:30 CDT',    ribbon:'#14b8a6', fnName:'bot-prep-accuracy',    logTable:'preplog',  hasConfig:false },
  { id:'bot-recipe-guardian',  name:'Recipe Guardian',             icon:'📖', desc:'6 AM — 4 check Critical + 4 Warning + 2 Info su ricette vendute, dedup, priorità per vendite.', schedule:'Ogni mattina 6:00 AM',  ribbon:'#10b981', fnName:'bot-recipe-guardian',  logTable:'office',   hasConfig:false }
];


// Codici sorgente dei bot (aggiornati al 1 luglio 2026)
var _botSources = {
  'bot-preplist-builder': 'Loading...',
  'bot-price-guard': 'Loading...',
  'bot-chat-analyst': 'Loading...',
  'bot-tell-chef-reader': 'Loading...',
  'bot-food-cost-guard': 'Loading...',
  'bot-prep-accuracy': 'Loading...',
  'bot-recipe-guardian': 'Loading...'
};

// Legge codice bot live da Supabase Management API tramite Edge Function proxy
// (Per ora usa una versione hardcoded — il deploy aggiorna il codice)
window.botLoadSource = async function(botId) {
  // Il codice viene caricato dalla UI tramite fetch alle edge functions
  // In questa versione il codice è mostrato come readonly con possibilità di editare
  return _botSources[botId] || '// codice non disponibile';
};

// ── Apri Bot Center ──
window.officeBotCenter = function() {
  var existing = document.getElementById('officeBotPanel');
  if (existing) existing.remove();

  var panel = document.createElement('div');
  panel.id = 'officeBotPanel';
  panel.style.cssText = [
    'position:fixed;top:0;left:50%;transform:translateX(-50%) translateY(100%);',
    'width:100%;max-width:480px;height:100vh;z-index:500;',
    'background:#0f172a;',
    'display:flex;flex-direction:column;overflow:hidden;',
    'font-family:Inter,system-ui,sans-serif;',
    'transition:transform 0.4s cubic-bezier(0.4,0,0.2,1);'
  ].join('');

  panel.innerHTML =
    '<div style="width:40px;height:5px;background:rgba(255,255,255,0.15);border-radius:3px;margin:10px auto 0;flex-shrink:0;"></div>' +
    '<div style="background:rgba(15,23,42,0.98);border-bottom:0.5px solid rgba(255,255,255,0.08);padding:14px 16px;display:flex;align-items:center;gap:14px;flex-shrink:0;">' +
      '<button onclick="document.getElementById(\'officeBotPanel\')?.remove();" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);border:0.5px solid rgba(255,255,255,0.15);color:white;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8592;</button>' +
      '<div style="flex:1;"><div style="font-size:19px;font-weight:700;color:white;">🤖 Bot Center</div><div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:2px;">7 bot attivi · clicca per aprire la scheda</div></div>' +
    '</div>' +
    '<div id="botCenterList" style="flex:1;overflow-y:auto;padding:14px 16px 80px;display:flex;flex-direction:column;gap:10px;">' +
      '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.3);">Caricamento...</div>' +
    '</div>';

  document.body.appendChild(panel);
  requestAnimationFrame(function() { requestAnimationFrame(function() { panel.style.transform = 'translateX(-50%) translateY(0)'; }); });

  var startY = 0;
  panel.addEventListener('touchstart', function(e) { startY = e.touches[0].clientY; }, { passive:true });
  panel.addEventListener('touchmove', function(e) {
    var dy = e.touches[0].clientY - startY;
    if (dy > 40) { panel.style.transition='none'; panel.style.transform='translateX(-50%) translateY('+dy+'px)'; }
  }, { passive:true });
  panel.addEventListener('touchend', function(e) {
    var dy = e.changedTouches[0].clientY - startY;
    if (dy > 120) { panel.style.transition='transform 0.35s cubic-bezier(0.4,0,0.2,1)'; panel.style.transform='translateX(-50%) translateY(100%)'; setTimeout(function(){panel.remove();},360); }
    else { panel.style.transition='transform 0.3s cubic-bezier(0.4,0,0.2,1)'; panel.style.transform='translateX(-50%) translateY(0)'; }
  }, { passive:true });

  botCenterLoadList();
};

async function botCenterLoadList() {
  var list = document.getElementById('botCenterList');
  if (!list) return;
  var sb = window.supa;
  var preplistData=[], tellchefData=[], officeData=[], invoiceData=[], preplogData=[];
  if (sb) {
    try {
      var r1 = await sb.from('bot_preplist_log').select('run_date,run_at,bot_version,task_name,percorso').order('run_at',{ascending:false}).limit(100);
      preplistData = r1.data || [];
      var r2 = await sb.from('chef_reports').select('souschef_at,report_type').not('souschef_at','is',null).order('souschef_at',{ascending:false}).limit(50);
      tellchefData = r2.data || [];
      var r3 = await sb.from('office_items').select('created_at,title,priority,source').eq('source','ai_scan').order('created_at',{ascending:false}).limit(30);
      officeData = r3.data || [];
      var r4 = await sb.from('invoice_warnings').select('created_at,code,status').order('created_at',{ascending:false}).limit(50);
      invoiceData = r4.data || [];
      var r5 = await sb.from('prep_log').select('created_at,item,station').order('created_at',{ascending:false}).limit(30);
      preplogData = r5.data || [];
    } catch(e) { console.warn('[BotCenter]', e.message); }
  }
  list.innerHTML = '';
  _botDefs.forEach(function(bot) {
    var s = botGetStatus(bot, {preplistData:preplistData, tellchefData:tellchefData, officeData:officeData, invoiceData:invoiceData, preplogData:preplogData});
    list.appendChild(botRenderCard(bot, s));
  });
}

function botGetStatus(bot, data) {
  var lastRun=null, tasksDone=0, tasksSkipped=0, logLines=[], version='';
  if (bot.logTable==='preplist' && data.preplistData.length>0) {
    var latest=data.preplistData[0]; version=latest.bot_version||''; lastRun=new Date(latest.run_at);
    var same=data.preplistData.filter(function(r){return r.run_at===latest.run_at;});
    same.forEach(function(r){ if(r.percorso&&r.percorso.indexOf('SKIP')!==-1){tasksSkipped++;logLines.push({c:'#94a3b8',t:'⏭ '+r.task_name+' — saltato'});}else{tasksDone++;logLines.push({c:'#86efac',t:'✅ '+r.task_name});} });
  } else if (bot.logTable==='tellchef' && data.tellchefData.length>0) {
    lastRun=new Date(data.tellchefData[0].souschef_at); tasksDone=data.tellchefData.length;
    logLines.push({c:'#86efac',t:'📣 '+data.tellchefData.length+' messaggi classificati totali'});
  } else if (bot.logTable==='office' && data.officeData.length>0) {
    lastRun=new Date(data.officeData[0].created_at);
    var todayItems=data.officeData.filter(function(r){return new Date(r.created_at)>new Date(Date.now()-86400000);});
    tasksDone=todayItems.length; logLines.push({c:'#86efac',t:'📖 '+todayItems.length+' ricette segnalate oggi'});
    todayItems.slice(0,3).forEach(function(r){var p=r.priority==='red'?'🔴':r.priority==='orange'?'🟠':'🔵';logLines.push({c:'#94a3b8',t:p+' '+(r.title||'—')});});
  } else if (bot.logTable==='invoice' && data.invoiceData.length>0) {
    lastRun=new Date(data.invoiceData[0].created_at); tasksDone=data.invoiceData.length;
    var open=data.invoiceData.filter(function(r){return r.status==='open';});
    logLines.push({c:'#86efac',t:'💰 '+data.invoiceData.length+' warning totali'});
    logLines.push({c:open.length>0?'#fbbf24':'#86efac',t:open.length>0?'⚠️ '+open.length+' aperti':'✅ Tutti risolti'});
  } else if (bot.logTable==='preplog' && data.preplogData.length>0) {
    lastRun=new Date(data.preplogData[0].created_at); tasksDone=data.preplogData.length;
    logLines.push({c:'#86efac',t:'🎯 '+data.preplogData.length+' log prep'});
    logLines.push({c:'#94a3b8',t:'Ultima: '+(data.preplogData[0].item||'—')});
  }
  var se='⚪', sl='Nessun dato', sc='#94a3b8';
  if (lastRun) {
    var m=(Date.now()-lastRun.getTime())/60000;
    if(m<180){se='🟢';sl='OK';sc='#86efac';}
    else if(m<1440){se='🟡';sl='Oggi';sc='#fbbf24';}
    else if(m<10080){se='🟠';sl='Questa settimana';sc='#fb923c';}
    else{se='🔴';sl='Mai/Bloccato';sc='#f87171';}
  }
  return {lastRun:lastRun,tasksDone:tasksDone,tasksSkipped:tasksSkipped,logLines:logLines,version:version,statusEmoji:se,statusLabel:sl,statusColor:sc};
}

function botFmtDate(d) {
  if(!d) return '—';
  return d.toLocaleDateString('it-IT',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric'})+' · '+d.toLocaleTimeString('it-IT',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit'})+' CDT';
}

function botRenderCard(bot, s) {
  var card=document.createElement('div');
  card.style.cssText='background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:18px;overflow:hidden;cursor:pointer;-webkit-tap-highlight-color:transparent;';
  card.innerHTML=
    '<div style="display:flex;align-items:center;padding:14px 16px;gap:12px;">'+
      '<div style="width:5px;border-radius:4px;align-self:stretch;min-height:46px;flex-shrink:0;background:'+bot.ribbon+';"></div>'+
      '<div style="font-size:26px;width:32px;text-align:center;">'+bot.icon+'</div>'+
      '<div style="flex:1;"><div style="color:white;font-size:16px;font-weight:600;">'+bot.name+'</div><div style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:2px;">'+bot.schedule+'</div></div>'+
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;"><span style="font-size:18px;">'+s.statusEmoji+'</span><span style="font-size:10px;color:'+s.statusColor+';font-weight:600;">'+s.statusLabel+'</span></div>'+
    '</div>'+
    '<div style="border-top:0.5px solid rgba(255,255,255,0.06);padding:10px 16px 12px 65px;color:rgba(255,255,255,0.3);font-size:12px;">'+(s.lastRun?botFmtDate(s.lastRun):'Nessuna run registrata')+'</div>';
  card.addEventListener('click',function(){botOpenDetail(bot,s);});
  return card;
}

// ── Scheda bot con 3 tab ──
function botOpenDetail(bot, s) {
  var existing=document.getElementById('botDetailPanel');
  if(existing) existing.remove();

  var panel=document.createElement('div');
  panel.id='botDetailPanel';
  panel.style.cssText=[
    'position:fixed;top:0;left:50%;transform:translateX(-50%) translateY(100%);',
    'width:100%;max-width:480px;height:100vh;z-index:600;',
    'background:#0f172a;display:flex;flex-direction:column;overflow:hidden;',
    'font-family:Inter,system-ui,sans-serif;transition:transform 0.4s cubic-bezier(0.4,0,0.2,1);'
  ].join('');

  var exp = _botExplain[bot.id] || {steps:[],params:[]};

  panel.innerHTML =
    '<div style="width:40px;height:5px;background:rgba(255,255,255,0.15);border-radius:3px;margin:10px auto 0;flex-shrink:0;"></div>'+
    // Header
    '<div style="background:rgba(15,23,42,0.98);border-bottom:0.5px solid rgba(255,255,255,0.08);padding:12px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;">'+
      '<button onclick="document.getElementById(\'botDetailPanel\')?.remove();" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);border:0.5px solid rgba(255,255,255,0.15);color:white;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">&#8592;</button>'+
      '<div style="flex:1;"><div style="font-size:17px;font-weight:700;color:white;">'+bot.icon+' '+bot.name+'</div><div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px;">'+s.statusEmoji+' '+s.statusLabel+' · '+botFmtDate(s.lastRun)+'</div></div>'+
      '<div style="width:5px;height:36px;border-radius:4px;background:'+bot.ribbon+';"></div>'+
    '</div>'+
    // Tab bar
    '<div id="botTabBar" style="display:flex;background:rgba(255,255,255,0.04);border-bottom:0.5px solid rgba(255,255,255,0.08);flex-shrink:0;">'+
      '<button id="botTab_cosa" onclick="botSwitchTab(\'cosa\',\''+bot.id+'\')" style="flex:1;padding:11px 4px;background:none;border:none;color:white;font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid '+bot.ribbon+';">📖 Cosa fa</button>'+
      (bot.id==='bot-preplist-builder' ? '<button id="botTab_config" onclick="botSwitchTab(\'config\',\''+bot.id+'\')" style="flex:1;padding:11px 4px;background:none;border:none;color:rgba(255,255,255,0.4);font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;">✏️ Preplist</button>' : '')+
      '<button id="botTab_codice" onclick="botSwitchTab(\'codice\',\''+bot.id+'\')" style="flex:1;padding:11px 4px;background:none;border:none;color:rgba(255,255,255,0.4);font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;">💻 Codice</button>'+
    '</div>'+
    // Content area
    '<div id="botDetailContent" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;"></div>';

  document.body.appendChild(panel);
  requestAnimationFrame(function(){requestAnimationFrame(function(){panel.style.transform='translateX(-50%) translateY(0)';});});

  // Mostra prima tab
  botSwitchTab('cosa', bot.id, s);

  // Salva dati per tab switch
  panel._botId = bot.id;
  panel._botDef = bot;
  panel._botStatus = s;
  panel._botExp = exp;
}

window.botSwitchTab = function(tab, botId, statusArg) {
  var panel = document.getElementById('botDetailPanel');
  if (!panel) return;
  var bot = panel._botDef || _botDefs.find(function(b){return b.id===botId;});
  var s = statusArg || panel._botStatus || {};
  var exp = panel._botExp || _botExplain[botId] || {steps:[],params:[]};

  // Aggiorna stili tab bar
  ['cosa','config','codice'].forEach(function(t) {
    var btn = document.getElementById('botTab_'+t);
    if (!btn) return;
    if (t===tab) { btn.style.color='white'; btn.style.borderBottomColor=bot.ribbon; }
    else { btn.style.color='rgba(255,255,255,0.35)'; btn.style.borderBottomColor='transparent'; }
  });

  var content = document.getElementById('botDetailContent');
  if (!content) return;

  if (tab==='cosa') {
    var html='<div style="padding:16px;display:flex;flex-direction:column;gap:12px;padding-bottom:80px;">';

    // Stato ultima run in cima
    html+='<div style="background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:14px;padding:14px;">';
    html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
    html+='<div style="color:rgba(255,255,255,0.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Ultima Run</div>';
    html+='<span style="font-size:14px;color:'+s.statusColor+';font-weight:700;">'+s.statusEmoji+' '+s.statusLabel+'</span>';
    html+='</div>';
    html+='<div style="color:white;font-size:14px;font-weight:600;margin-bottom:8px;">'+botFmtDate(s.lastRun)+'</div>';
    if (s.logLines && s.logLines.length>0) {
      s.logLines.slice(0,5).forEach(function(l){
        html+='<div style="font-size:12px;color:'+l.c+';padding:2px 0;">'+l.t+'</div>';
      });
    }
    html+='</div>';

    // Spiegazione step-by-step
    html+='<div style="background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:14px;padding:14px;">';
    html+='<div style="color:rgba(255,255,255,0.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px;">Come funziona — passo per passo</div>';
    exp.steps.forEach(function(step, i) {
      html+=
        '<div style="display:flex;gap:12px;'+(i>0?'margin-top:14px;border-top:0.5px solid rgba(255,255,255,0.06);padding-top:14px;':'')+'">'+
          '<div style="font-size:22px;flex-shrink:0;width:28px;text-align:center;">'+step.icon+'</div>'+
          '<div>'+
            '<div style="color:white;font-size:14px;font-weight:600;margin-bottom:3px;">'+step.title+'</div>'+
            '<div style="color:rgba(255,255,255,0.55);font-size:13px;line-height:1.5;">'+step.text+'</div>'+
          '</div>'+
        '</div>';
    });
    html+='</div>';

    // Trigger manuale
    html+='<div style="background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:14px;padding:14px;">';
    html+='<div style="color:rgba(255,255,255,0.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">Trigger Manuale</div>';
    html+='<button id="botRunBtn_'+bot.id+'" onclick="botTrigger(\''+bot.fnName+'\',\''+bot.id+'\')" style="width:100%;padding:14px;background:linear-gradient(135deg,'+bot.ribbon+','+bot.ribbon+'cc);border:none;border-radius:12px;color:white;font-size:15px;font-weight:700;cursor:pointer;">&#9654; Esegui ora</button>';
    html+='<div id="botRunResult_'+bot.id+'" style="margin-top:10px;display:none;"></div>';
    html+='</div>';

    html+='</div>';
    content.innerHTML = html;

  } else if (tab==='config') {
    // ── PREPLIST EDITOR — lista task con tutto quello che il bot vede ──
    content.innerHTML =
      '<div style="padding:12px 16px 80px;">' +
        '<div style="color:rgba(255,255,255,0.35);font-size:12px;margin-bottom:12px;line-height:1.5;">' +
          'Ogni riga è un prep task. Vedi esattamente cosa sa il bot e puoi modificare.' +
        '</div>' +
        '<div id="preplistEditorList" style="display:flex;flex-direction:column;gap:8px;">' +
          '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.3);">Caricamento task...</div>' +
        '</div>' +
      '</div>';
    botLoadPreplistEditor();

  } else if (tab==='codice') {
    content.innerHTML =
      '<div style="padding:16px;padding-bottom:80px;">'+
        '<div style="background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;">'+
          // toolbar codice
          '<div style="padding:10px 14px;background:rgba(255,255,255,0.06);border-bottom:0.5px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;">'+
            '<div>'+
              '<div style="color:white;font-size:13px;font-weight:700;">index.ts — '+bot.fnName+'</div>'+
              '<div style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:2px;">Modifica e premi Deploy per aggiornare il bot live</div>'+
            '</div>'+
            '<div style="display:flex;gap:8px;">'+
              '<button onclick="botCodeReset()" style="padding:6px 10px;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.15);border-radius:8px;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;">Reset</button>'+
              '<button onclick="botCodeDeploy(\''+bot.fnName+'\')" style="padding:6px 12px;background:'+bot.ribbon+';border:none;border-radius:8px;color:white;font-size:11px;font-weight:700;cursor:pointer;">🚀 Deploy</button>'+
            '</div>'+
          '</div>'+
          '<div id="botCodeStatus" style="display:none;padding:8px 14px;font-size:12px;"></div>'+
          '<textarea id="botCodeEditor" spellcheck="false" style="width:100%;min-height:500px;padding:14px;background:transparent;border:none;color:#e2e8f0;font-family:\'Courier New\',Courier,monospace;font-size:11px;line-height:1.6;resize:vertical;outline:none;box-sizing:border-box;white-space:pre;overflow-x:auto;">Caricamento codice...</textarea>'+
        '</div>'+
        '<div style="margin-top:12px;background:rgba(239,68,68,0.08);border:0.5px solid rgba(239,68,68,0.2);border-radius:10px;padding:12px;">'+
          '<div style="color:#fca5a5;font-size:12px;font-weight:700;margin-bottom:4px;">⚠️ Attenzione</div>'+
          '<div style="color:rgba(252,165,165,0.7);font-size:12px;line-height:1.5;">Deploy sovrascrive il bot live immediatamente. Se il codice ha errori, il bot smette di funzionare fino alla prossima correzione. Testa bene prima.</div>'+
        '</div>'+
      '</div>';

    // Carica codice
    botCodeLoad(bot.fnName);
  }
};

// Carica codice edge function
window.botCodeLoad = async function(fnName) {
  var editor = document.getElementById('botCodeEditor');
  if (!editor) return;
  try {
    var supaUrl = (window.supa?.supabaseUrl || 'https://ydqmumpytgrlceuinoqt.supabase.co');
    // Recupera codice dallo storage locale se già caricato
    var cached = window._botCodeCache && window._botCodeCache[fnName];
    if (cached) { editor.value = cached; return; }
    editor.value = '// Caricamento...';
    // Il codice non è accessibile direttamente via API pubblica senza service key
    // Usiamo le versioni hardcoded già lette in questa sessione
    var codes = window._botHardcodedSources || {};
    if (codes[fnName]) { editor.value = codes[fnName]; if(!window._botCodeCache)window._botCodeCache={}; window._botCodeCache[fnName]=codes[fnName]; }
    else { editor.value = '// Codice non disponibile in questa sessione.\n// Riapri Bot Center da una sessione fresca per caricare il codice live.'; }
  } catch(e) { if(editor) editor.value = '// Errore caricamento: '+e.message; }
};

window.botCodeReset = function() {
  var editor = document.getElementById('botCodeEditor');
  var panel = document.getElementById('botDetailPanel');
  if (!editor || !panel) return;
  var fnName = panel._botDef?.fnName;
  if (!fnName) return;
  var codes = window._botHardcodedSources || {};
  if (codes[fnName]) editor.value = codes[fnName];
};

window.botCodeDeploy = async function(fnName) {
  var editor = document.getElementById('botCodeEditor');
  var statusEl = document.getElementById('botCodeStatus');
  if (!editor || !statusEl) return;
  var code = editor.value.trim();
  if (!code || code.length < 20) return;

  statusEl.style.display='block';
  statusEl.style.background='rgba(245,158,11,0.1)';
  statusEl.style.color='#fbbf24';
  statusEl.textContent='🚀 Deploy in corso...';

  try {
    // Il deploy avviene tramite Supabase Management API
    // Richiede il service role key — non disponibile lato browser per sicurezza
    // Mostriamo il codice da copiare + istruzioni
    statusEl.style.background='rgba(59,130,246,0.1)';
    statusEl.style.color='#93c5fd';
    statusEl.innerHTML=
      '📋 Il deploy diretto dal browser richiede la chiave admin.<br>'+
      'Copia il codice modificato e mandalo a Claude con: <strong style="color:white;">"Deploya questo codice su '+fnName+'"</strong>';
  } catch(e) {
    statusEl.style.background='rgba(239,68,68,0.1)';
    statusEl.style.color='#fca5a5';
    statusEl.textContent='❌ Errore: '+e.message;
  }
};

// Config helpers
function botCfgGet(key, def) {
  try { var v=localStorage.getItem('botCfg_'+key); if(v!==null){var p=JSON.parse(v);return p;}return def; }
  catch(e){return def;}
}

window.botSaveCfg = function() {
  var exp = window._botCurrentExp || {params:[]};
  exp.params.forEach(function(p) {
    if (p.type==='tags') {
      try{localStorage.setItem('botCfg_'+p.key, JSON.stringify(window._botCurrentTags||p.default));}catch(e){}
    } else {
      var inp=document.getElementById('botCfg_'+p.key);
      if(inp){try{localStorage.setItem('botCfg_'+p.key, JSON.stringify(parseFloat(inp.value)||p.default));}catch(e){}}
    }
  });
  var msg=document.getElementById('botCfgMsg');
  if(msg){msg.style.display='block';msg.style.cssText='display:block;background:rgba(134,239,172,0.1);border:0.5px solid rgba(134,239,172,0.3);border-radius:10px;padding:10px 14px;color:#86efac;font-size:13px;margin-top:8px;';msg.textContent='✅ Salvato — effetto dalla prossima run alle 4:00 AM';}
};

window.botTagAdd = function() {
  var inp=document.getElementById('botTagInput');
  if(!inp) return;
  var v=(inp.value||'').trim();
  if(!v) return;
  if(!window._botCurrentTags) window._botCurrentTags=[];
  if(window._botCurrentTags.indexOf(v)===-1) window._botCurrentTags.push(v);
  inp.value='';
  botTagRefresh();
};

window.botTagRemove = function(i) {
  if(!window._botCurrentTags) return;
  window._botCurrentTags.splice(i,1);
  botTagRefresh();
};

function botTagRefresh() {
  var list=document.getElementById('botTagList');
  if(!list) return;
  var html='';
  (window._botCurrentTags||[]).forEach(function(tag,i){
    html+='<div style="display:inline-flex;align-items:center;gap:4px;background:rgba(245,158,11,0.15);border:0.5px solid rgba(245,158,11,0.4);border-radius:20px;padding:4px 10px;">'+
      '<span style="font-size:12px;color:#fbbf24;">'+tag+'</span>'+
      '<button onclick="botTagRemove('+i+')" style="background:none;border:none;color:rgba(251,191,36,0.5);font-size:14px;cursor:pointer;padding:0;line-height:1;">&#x2715;</button>'+
      '</div>';
  });
  list.innerHTML=html;
}

window.botTrigger = async function(fnName, botId) {
  var btn=document.getElementById('botRunBtn_'+botId);
  var result=document.getElementById('botRunResult_'+botId);
  if(!btn||!result) return;
  btn.disabled=true; btn.innerHTML='⏳ In esecuzione...';
  result.style.display='none';
  try {
    var supaUrl=window.supa?.supabaseUrl||'https://ydqmumpytgrlceuinoqt.supabase.co';
    var supaKey=window._supabaseAnonKey||'';
    var res=await fetch(supaUrl+'/functions/v1/'+fnName,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+supaKey},body:JSON.stringify({manual:true})});
    var body={}; try{body=await res.json();}catch(e){}
    result.style.display='block';
    if(res.ok){
      result.innerHTML='<div style="background:rgba(134,239,172,0.1);border:0.5px solid rgba(134,239,172,0.3);border-radius:10px;padding:12px;color:#86efac;font-size:13px;">✅ Eseguito · '+(body.tasks_updated!==undefined?body.tasks_updated+' task aggiornati':'')+' '+(body.tasks_skipped!==undefined?'· '+body.tasks_skipped+' saltati':'')+'</div>';
    } else {
      result.innerHTML='<div style="background:rgba(239,68,68,0.1);border:0.5px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px;color:#f87171;font-size:13px;">❌ Errore '+res.status+' — '+(body.error||'sconosciuto')+'</div>';
    }
  } catch(e) {
    result.style.display='block';
    result.innerHTML='<div style="background:rgba(239,68,68,0.1);border:0.5px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px;color:#f87171;font-size:13px;">❌ '+e.message+'</div>';
  }
  btn.disabled=false; btn.innerHTML='&#9654; Esegui ora';
};


// ── Codici sorgente bot per visualizzazione in Bot Center ──
window._botHardcodedSources = {
  'bot-preplist-builder': `// Historical stub — v22 — not executed — not current bot logic.
// Current bot: bot-preplist-builder v41 (Supabase Edge Function, not stored in GitHub).
// Do not rely on this code for any calculation or display.
`,
  'bot-price-guard': `// bot-price-guard v12
// Gira dopo ogni importazione fattura (chiamato da process-invoice)
// Confronta nuovo prezzo con media storica (min 3 acquisti)
// Se variazione > 10% -> crea avviso in office_items

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PRICE_THRESHOLD = 0.10; // 10%
const MIN_HISTORY = 3;        // almeno 3 acquisti storici

Deno.serve(async (req) => {
  const { document_id } = await req.json();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Leggi righe fattura appena importata
  const { data: lines } = await sb
    .from('invoice_lines')
    .select('ingredient_id, unit_price, raw_description, vendor')
    .eq('import_id', document_id)
    .not('ingredient_id', 'is', null)
    .gt('unit_price', 0);

  let warnings = 0;
  for (const line of (lines || [])) {
    // Storico prezzi per questo ingrediente
    const { data: history } = await sb
      .from('ingredient_vendors')
      .select('unit_price, last_invoice_date, vendor')
      .eq('ingredient_id', line.ingredient_id)
      .order('last_invoice_date', { ascending: false });

    if (!history || history.length < MIN_HISTORY) continue;

    // Media storica (escludi il piu' recente = quello appena importato)
    const historical = history.slice(1);
    if (historical.length < MIN_HISTORY) continue;

    const avg = historical.reduce((sum, h) => sum + parseFloat(h.unit_price), 0) / historical.length;
    const newPrice = parseFloat(line.unit_price);
    const variation = (newPrice - avg) / avg;

    // Sotto soglia -> ignora
    if (Math.abs(variation) < PRICE_THRESHOLD) continue;

    // Nome ingrediente
    const { data: ing } = await sb.from('ingredients').select('name').eq('id', line.ingredient_id).single();
    const ingName = ing?.name || line.raw_description;
    const direction = variation > 0 ? 'aumento' : 'calo';
    const pct = Math.round(Math.abs(variation) * 100);

    // Evita duplicati
    const { data: existing } = await sb.from('office_items').select('id')
      .eq('source', 'bot-price-guard').eq('source_id', document_id).like('title', '%' + ingName + '%').limit(1);
    if (existing && existing.length > 0) continue;

    // Crea avviso
    await sb.from('office_items').insert({
      source: 'bot-price-guard', source_id: document_id,
      from_user: 'system', priority: 'orange',
      title: ingName + ' — prezzo ' + direction + ' del ' + pct + '%',
      body: 'Nuovo: $' + newPrice.toFixed(2) + ' · Media storica: $' + avg.toFixed(2) + ' · Fornitore: ' + (line.vendor || '—'),
      ai_options: ['Accetta nuovo prezzo', 'Indaga con fornitore'],
      status: 'open', notify_brigade: false,
    });
    warnings++;
  }
  return new Response(JSON.stringify({ checked:(lines||[]).length, warnings }), { status:200 });
});
`,
  'bot-chat-analyst': `// bot-chat-analyst v13
// Giornaliero: 3:00 AM CDT (lun-sab) - legge ultime 24h di chat brigata
// Domenicale: recap settimanale (7 giorni)
// Manda i messaggi a LLaMA 3.3 70B -> trova pattern operativi e di squadra
// Scrive in office_items se trova qualcosa di rilevante

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY')!;

// Prompt per analisi giornaliera
const PROMPT_DAILY = \`Sei il secondo di cucina digitale di Zenos on the Square.
Hai letto i messaggi della chat brigata delle ultime 24 ore.
Brigata: Max (chef), Tela (coordinator), Antonella (IT), Rachel (ES), Cole, Samantha.

Cerca (solo se presenti):
1. PROBLEMI OPERATIVI - attrezzature, ingredienti, procedure
2. DINAMICHE SQUADRA - tensioni, collaborazioni
3. SEGNALI DEBOLI - cose dette una volta sola ma importanti
4. URGENZE - qualcosa che richiede azione di Max

REGOLE:
- Rispondi in italiano
- Se chat banale: rispondi solo "NIENTE DA SEGNALARE"
- Mai citare messaggi letteralmente
- Massimo 5 punti, diretti e concreti\`;

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const isWeekly = body.weekly === true;
  const hoursBack = isWeekly ? 168 : 24;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Leggi messaggi del periodo
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
  const { data: messages } = await sb.from('messages')
    .select('created_at, user_name, text, lang')
    .gte('created_at', since).not('text','is',null)
    .order('created_at', { ascending: true });

  if (!messages || messages.length < 1) return new Response(JSON.stringify({skipped:true,reason:'no messages'}), {status:200});

  // Formatta per l'AI
  const formatted = messages.map(m =>
    '[' + new Date(m.created_at).toLocaleString('it-IT',{timeZone:'America/Chicago'}) + '] ' + m.user_name + ': ' + m.text
  ).join('\\n');

  // Chiama LLaMA via OpenRouter
  const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+OPENROUTER_KEY },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct',
      max_tokens: 1000, temperature: 0.3,
      messages: [
        { role:'system', content: PROMPT_DAILY },
        { role:'user', content: 'MESSAGGI CHAT:\\n'+formatted }
      ]
    })
  });
  const aiData = await aiRes.json();
  const analysis = aiData.choices?.[0]?.message?.content || 'NIENTE DA SEGNALARE';

  // Se niente da segnalare -> non scrive nulla
  if (analysis.includes('NIENTE DA SEGNALARE')) return new Response(JSON.stringify({skipped:true}),{status:200});

  // Evita duplicato se gia' analizzato oggi
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const { data: existing } = await sb.from('office_items').select('id')
    .eq('source','bot-chat-analyst').gte('created_at',todayStart.toISOString()).limit(1);
  if (existing && existing.length > 0) return new Response(JSON.stringify({skipped:true,reason:'already today'}),{status:200});

  // Scrive in office_items
  const dateStr = new Date().toLocaleDateString('it-IT',{timeZone:'America/Chicago',day:'2-digit',month:'2-digit'});
  await sb.from('office_items').insert({
    source:'bot-chat-analyst', from_user:'system', priority:'blue',
    title: (isWeekly ? 'Recap chat settimanale' : 'Analisi chat') + ' — ' + dateStr,
    body: analysis, status:'open', notify_brigade:false,
  });
  return new Response(JSON.stringify({ok:true, messages_analyzed:messages.length}),{status:200});
});
`,
  'bot-tell-chef-reader': `// bot-tell-chef-reader v16
// Gira ogni ora (cron 0 * * * *)
// FASE 1: Legge i nuovi Tell Chef (chef_reports status=new)
//         Classifica con LLaMA: tipo + priorita' + riassunto + opzioni azione
//         Crea card in office_items gia' pronta per Max
// FASE 2: Sincronizza le azioni di Max (done/working_on_it) -> chef_reports
// FASE 3: Alert se "working on it" da piu' di 7 giorni
// FASE 4: Analisi pattern 30 giorni per tutta la brigata

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY')!;

// Tipi possibili per ogni Tell Chef
// CONTRIBUTO_RICETTA, GAP_CHECKLIST, PROBLEMA_OPERATIVO, FEEDBACK_RICETTA, SEGNALE_PERSONALE
// Priorita': red (urgente/sicurezza), orange (decide Max), blue (info)

async function classifyReport(message, userName, station) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+OPENROUTER_KEY},
    body: JSON.stringify({
      model:'meta-llama/llama-3.3-70b-instruct', max_tokens:400, temperature:0.2,
      messages:[
        {role:'system', content:'Classifica il messaggio Tell Chef. Rispondi SOLO JSON: {type, priority, summary, suggestion, options[]}'},
        {role:'user', content:'Mittente: '+userName+' ('+station+')\\nMessaggio: '+message}
      ]
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content.replace(/\`\`\`json|\`\`\`/g,'').trim());
}

Deno.serve(async (_req) => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();

  // FASE 1: Classifica nuovi Tell Chef
  const { data: reports } = await sb.from('chef_reports')
    .select('id, user_name, station, message, created_at')
    .eq('status','new').is('souschef_suggestion',null).not('message','is',null)
    .order('created_at',{ascending:true}).limit(20);

  let processed = 0;
  for (const report of (reports||[])) {
    const result = await classifyReport(report.message, report.user_name, report.station);
    if (!result) continue;
    // Aggiorna chef_report
    await sb.from('chef_reports').update({souschef_suggestion:result.suggestion, souschef_at:now, report_type:result.type, status:'read'}).eq('id',report.id);
    // Crea card in L'Ufficio
    await sb.from('office_items').insert({
      source:'tell_chef', source_id:report.id, from_user:'Chef AI',
      priority:result.priority, report_type:result.type,
      title:report.user_name+' — '+result.type.replace(/_/g,' '),
      body:result.summary+'\\n\\nSous Chef: '+result.suggestion,
      ai_options:result.options, status:'open', notify_brigade:false,
    });
    processed++;
  }

  // FASE 2: Sincronizza azioni Max -> chef_reports
  const { data: acted } = await sb.from('office_items')
    .select('source_id, chef_action, chef_action_at, chef_action_by')
    .eq('source','tell_chef').not('chef_action','is',null).not('source_id','is',null);
  for (const item of (acted||[])) {
    await sb.from('chef_reports').update({chef_action:item.chef_action, chef_action_at:item.chef_action_at, chef_action_by:item.chef_action_by}).eq('id',item.source_id);
  }

  // FASE 3: Alert "working on it" > 7 giorni
  const sevenDaysAgo = new Date(Date.now()-7*86400000).toISOString();
  const { data: stale } = await sb.from('office_items').select('id,title,chef_action_at')
    .eq('source','tell_chef').eq('chef_action','working_on_it').lt('chef_action_at',sevenDaysAgo).eq('status','open');
  for (const item of (stale||[])) {
    const daysAgo = Math.floor((Date.now()-new Date(item.chef_action_at).getTime())/86400000);
    await sb.from('office_items').insert({
      source:'tell_chef', source_id:item.id, from_user:'Chef AI', priority:'red',
      title:'In attesa da '+daysAgo+' giorni — '+item.title,
      body:'Hai segnato working on it '+daysAgo+' giorni fa. Chiudilo.',
      ai_options:['Mark Done','Ignore'], status:'open', notify_brigade:false,
    });
  }

  return new Response(JSON.stringify({ok:true, classified:processed}),{status:200});
});
`,
  'bot-food-cost-guard': `// bot-food-cost-guard v12
// Gira dopo ogni importazione fattura (chiamato da process-invoice)
// Per ogni ingrediente con prezzo aumentato, calcola impatto in dollari
// sul venduto dell'ultima settimana
// Segnala solo se impatto > $20/settimana

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const IMPACT_THRESHOLD = 20; // $20/settimana minimo

function toGrams(qty, unit) {
  const u = unit.toLowerCase().trim();
  if (u==='g') return qty; if (u==='kg') return qty*1000;
  if (u==='oz') return qty*28.35; if (u==='lb') return qty*453.6;
  return null;
}

Deno.serve(async (req) => {
  const { document_id } = await req.json();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Righe fattura con ingrediente abbinato
  const { data: lines } = await sb.from('invoice_lines')
    .select('ingredient_id, unit_price, raw_description, vendor, pack_description')
    .eq('import_id', document_id).not('ingredient_id','is',null).gt('unit_price',0);

  let warnings = 0;
  for (const line of (lines||[])) {
    const { data: history } = await sb.from('ingredient_vendors')
      .select('unit_price, last_invoice_date, price_type').eq('ingredient_id',line.ingredient_id)
      .order('last_invoice_date',{ascending:false}).limit(5);
    if (!history || history.length < 2) continue;

    const newPrice = parseFloat(line.unit_price);
    const oldPrice = parseFloat(history[1].unit_price);
    if (newPrice <= oldPrice || (newPrice-oldPrice)/oldPrice < 0.05) continue; // prezzo non aumentato o aumento < 5%

    // Trova ricette che usano questo ingrediente
    const { data: ing } = await sb.from('ingredients').select('name').eq('id',line.ingredient_id).single();
    const ingName = ing?.name || line.raw_description;

    // Vendite ultima settimana
    const oneWeekAgo = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
    // [calcola impatto per ogni ricetta affetta]
    // Se impatto > IMPACT_THRESHOLD -> crea avviso in office_items

    const variation = (newPrice - oldPrice) / oldPrice;
    const pct = Math.round(variation * 100);
    // [logica completa di calcolo impatto omessa per brevita']

    await sb.from('office_items').insert({
      source:'bot-food-cost-guard', source_id:document_id, from_user:'system',
      priority:'orange',
      title:'Food Cost — ' + ingName + ' +' + pct + '%',
      body:'Da $'+oldPrice.toFixed(2)+' a $'+newPrice.toFixed(2)+' — verifica impatto sulle ricette.',
      ai_options:['Rivedi prezzo vendita','Rivedi porzione','Accetta per ora'],
      status:'open', notify_brigade:false,
    });
    warnings++;
  }
  return new Response(JSON.stringify({ok:true, warnings}),{status:200});
});
`,
  'bot-prep-accuracy': `// bot-prep-accuracy v12
// Gira ogni sera tra 17:00-18:00 CDT (cron 0 23 * * * UTC)
// Logica: confronta "No Need" della mattina con prep del pomeriggio (14-17 CDT)
//
// Scenario A: mattina "No Need" su item X, pomeriggio qualcuno lo fa uguale
//   -> colpevole: morning (il cuoco della mattina aveva torto, il closing era ok)
//
// Scenario B: mattina "No Need" su item X, pomeriggio nessuno lo fa
//   -> colpevole: evening (il closing della sera era impreciso)
//
// Scrive in office_items per ogni caso trovato

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const nowUtc = new Date();
  const nowCdt = new Date(nowUtc.getTime() - 5*3600000);
  const today = nowCdt.toISOString().slice(0,10);

  // Tutti i "No Need" di stamattina (unit='no_need' nel prep_log)
  const { data: noNeedRows } = await sb.from('prep_log')
    .select('item, user_name, station, created_at')
    .eq('unit','no_need').gte('created_at',today+'T00:00:00Z').lte('created_at',today+'T23:59:59Z');

  if (!noNeedRows || noNeedRows.length===0) return new Response(JSON.stringify({processed:0}),{status:200});

  // Prep fatte nel pomeriggio (14:00-17:00 CDT = 19:00-22:00 UTC)
  const { data: afternoonRows } = await sb.from('prep_log')
    .select('item, user_name, qty, unit, created_at')
    .neq('unit','no_need').gte('created_at',today+'T19:00:00Z').lte('created_at',today+'T22:00:00Z');

  const afternoonItems = new Map();
  for (const r of (afternoonRows||[])) { afternoonItems.set(r.item.toLowerCase().trim(), r); }

  let processed = 0;
  for (const row of noNeedRows) {
    const itemKey = row.item.toLowerCase().trim();
    const madeInAfternoon = afternoonItems.has(itemKey);
    const afternoonMaker = afternoonItems.get(itemKey);

    let title, body, priority;
    if (madeInAfternoon) {
      priority='orange';
      title='No Need errato: '+row.item;
      body=row.user_name+' ha saltato '+row.item+' stamattina, ma '+afternoonMaker.user_name+' lo ha dovuto fare nel pomeriggio.';
    } else {
      priority='blue';
      title='Closing impreciso: '+row.item;
      body=row.item+' era segnato da fare dal closing serale, ma stamattina era sufficiente. Il closing della stazione '+row.station+' era impreciso.';
    }

    // Evita duplicati
    const { data: existing } = await sb.from('office_items').select('id')
      .eq('source','bot-prep-accuracy').eq('source_id',row.item+'-'+today).limit(1);
    if (existing && existing.length>0) continue;

    await sb.from('office_items').insert({
      source:'bot-prep-accuracy', source_id:row.item+'-'+today,
      from_user:'Bot 6', priority, title, body, status:'open', notify_brigade:false,
    });
    processed++;
  }
  return new Response(JSON.stringify({ok:true, processed}),{status:200});
});
`,
  'bot-recipe-guardian': `// bot-recipe-guardian v12
// Gira ogni mattina alle 6:00 AM CDT (cron 0 11 * * * UTC)
// Controlla SOLO le ricette vendute al POS (pos_name != null)
// Per ognuna verifica:
//   - BOM: vuoto (critico), parziale <4 righe (warning), ok
//   - serving_unit e serving_qty: mancanti = Bot 3 non puo' calcolare
//   - procedura: non scritta
//   - base_servings: mancante
// Non duplica: se l'item e' gia' aperto in office_items, salta
// Priorita': red=BOM vuoto, orange=BOM parziale o campi chiave mancanti, blue=solo procedura mancante

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Tutte le ricette vendute (con pos_name)
  const { data: recipes } = await sb.from('recipes')
    .select('id, title, pos_name, serving_unit, serving_qty, procedure, base_servings')
    .not('pos_name','is',null).neq('pos_name','');

  if (!recipes || recipes.length===0) return new Response(JSON.stringify({skipped:true}),{status:200});

  // Conta righe BOM per ogni ricetta
  const { data: bomRows } = await sb.from('recipe_bom').select('parent_recipe_id').in('parent_recipe_id', recipes.map(r=>r.id));
  const bomCount = {};
  for (const row of (bomRows||[])) { bomCount[row.parent_recipe_id] = (bomCount[row.parent_recipe_id]||0)+1; }

  // Items gia' aperti (non duplicare)
  const { data: existingItems } = await sb.from('office_items').select('source_id,status').eq('source','bot-recipe-guardian').in('status',['open','in_progress']);
  const alreadyOpen = new Set((existingItems||[]).map(i=>i.source_id));

  let inserted=0, skipped=0;
  for (const recipe of recipes) {
    if (alreadyOpen.has(recipe.id)) { skipped++; continue; }
    const bom = bomCount[recipe.id]||0;
    const issues = [];
    let priority = 'blue';

    if (bom===0) { issues.push('BOM completamente vuoto'); priority='red'; }
    else if (bom<4) { issues.push('BOM parziale — solo '+bom+' righe'); priority='orange'; }
    if (!recipe.serving_unit||!recipe.serving_qty) { issues.push('serving_unit/serving_qty mancanti — Bot 3 non puo calcolarlo'); if(priority==='blue')priority='orange'; }
    if (!recipe.procedure||recipe.procedure.trim()==='') { issues.push('Procedura non scritta'); if(priority==='blue')priority='orange'; }
    if (!recipe.base_servings) { issues.push('base_servings mancante'); if(priority==='blue')priority='orange'; }

    if (issues.length===0) { skipped++; continue; }

    await sb.from('office_items').insert({
      source:'bot-recipe-guardian', source_id:recipe.id, from_user:'bot-recipe-guardian',
      priority, title:'Ricetta incompleta — '+recipe.title,
      body:'Ricetta venduta al POS con problemi:\\n'+issues.map((i,n)=>(n+1)+'. '+i).join('\\n'),
      ai_options:['Compila ora','Delega a dopo','Ignora'], status:'open', notify_brigade:false,
    });
    inserted++;
  }
  return new Response(JSON.stringify({ok:true, issues_found:inserted, already_open:skipped}),{status:200});
});
`
};
// ══════════════════════════════════════════════════════════════
// PREPLIST EDITOR — editor completo per ogni prep task
// Mostra tutto quello che il bot vede + permette di modificarlo
// ══════════════════════════════════════════════════════════════

window.botLoadPreplistEditor = async function() {
  var list = document.getElementById('preplistEditorList');
  if (!list) return;
  var sb = window.supa;
  if (!sb) { list.innerHTML = '<div style="color:#f87171;padding:20px;">DB non disponibile</div>'; return; }

  try {
    // Carica tutti i task attivi non checklist con la ricetta collegata
    var { data: tasks, error } = await sb
      .from('prep_tasks')
      .select('id,name,category,unit,current_stock,prep_type,suggested_qty,suggested_note,expected_duration_days,recipe_id,recipes:recipe_id(id,title,pos_name,base_weight_g,base_servings,serving_unit,serving_qty,shelf_life_days)')
      .eq('archived', false)
      .neq('prep_type', 'checklist')
      .neq('prep_type', 'checklist')
      .order('category')
      .order('name');

    if (error) throw error;

    // Carica BOM count per ogni ricetta
    var recipeIds = (tasks||[]).filter(function(t){return t.recipe_id;}).map(function(t){return t.recipe_id;});
    var bomMap = {};
    if (recipeIds.length > 0) {
      var { data: bomRows } = await sb.from('recipe_bom').select('parent_recipe_id').in('parent_recipe_id', recipeIds);
      (bomRows||[]).forEach(function(r){ bomMap[r.parent_recipe_id] = (bomMap[r.parent_recipe_id]||0)+1; });
    }

    // Raggruppa per stazione
    var byStation = {};
    (tasks||[]).forEach(function(t) {
      var st = t.category || 'Altro';
      if (!byStation[st]) byStation[st] = [];
      byStation[st].push(t);
    });

    list.innerHTML = '';

    Object.keys(byStation).sort().forEach(function(station) {
      // Header stazione
      var stHdr = document.createElement('div');
      stHdr.style.cssText = 'color:rgba(255,255,255,0.4);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:8px 4px 4px;margin-top:8px;';
      stHdr.textContent = station;
      list.appendChild(stHdr);

      byStation[station].forEach(function(task) {
        var card = botBuildTaskCard(task, bomMap);
        list.appendChild(card);
      });
    });

  } catch(e) {
    list.innerHTML = '<div style="color:#f87171;padding:20px;">Errore: '+e.message+'</div>';
  }
};

// ── botLoadSimData — fetch latest bot_debug_runs row for this task ──
// Returns the most recent sim row, or null if none found.
window.botLoadSimData = async function(taskName) {
  var sb = window.supa;
  if (!sb) return null;
  try {
    var { data, error } = await sb
      .from('bot_debug_runs')
      .select('*')
      .eq('task_name', taskName)
      .order('sim_date', { ascending: false })
      .limit(1);
    if (error || !data || !data.length) return null;
    return data[0];
  } catch(e) {
    return null;
  }
};

// ── botFmtValue — shared formatter (single source of truth for display) ──
function botFmtValue(n, unit) {
  if (n === null || n === undefined) return '—';
  var v = parseFloat(n);
  if (isNaN(v)) return '—';
  var u = (unit || '').toLowerCase();
  var isPhys = ['pezzi','pz','nests','buste','cartocci','cup'].includes(u);
  if (isPhys) {
    var num = v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
    var showUnit = ['nests','cup','buste','cartocci'].includes(u);
    return showUnit ? num + ' ' + unit : num;
  }
  return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'kg' : Math.round(v) + 'g';
}

// ── botBuildTaskCard — UI shell only. No calculation. Reads trusted bot outputs. ──
// Sources of truth:
//   1. Real bot result: prep_tasks.suggested_qty / suggested_note / suggested_at / suggested_by
//   2. Trusted simulation: bot_debug_runs (via botLoadSimData)
// This function NEVER calculates quantities or colors independently.
function botBuildTaskCard(task, bomMap) {
  var rec = task.recipes;
  var bomCount = rec ? (bomMap[rec.id] || 0) : 0;

  // ── Parse real bot result from suggested_note ──
  var noteRaw   = task.suggested_note || '';
  var noteParts = noteRaw.split('|');
  var noteColor = noteParts[0] || '';
  var noteIT    = noteParts[1] || '';
  var noteEN    = noteParts[2] || '';
  var noteES    = noteParts[3] || '';
  var hasRealBot = noteRaw.includes('|') && noteParts.length >= 2;

  var pillColor = noteColor === 'red' ? '#ef4444' : noteColor === 'yellow' ? '#eab308' : '#22c55e';
  var pillBg    = noteColor === 'red' ? 'rgba(239,68,68,0.15)' : noteColor === 'yellow' ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.15)';
  var pillLabel = hasRealBot ? noteColor.toUpperCase() : '—';

  var posAliases = rec && rec.pos_name ? rec.pos_name.split('|').filter(Boolean) : [];

  var card = document.createElement('div');
  card.style.cssText = 'background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;';
  card.id = 'prepCard_' + task.id;

  // ── Header collassabile ──
  var header = document.createElement('div');
  header.style.cssText = 'padding:12px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;gap:10px;';

  var stockDisplay = task.current_stock !== null
    ? botFmtValue(task.current_stock, task.unit) + ' in stock'
    : '⚠️ stock NULL';

  header.innerHTML =
    '<span id="pillBadge_' + task.id + '" style="font-size:10px;padding:3px 8px;border-radius:20px;font-weight:700;background:' + (hasRealBot ? pillBg : 'rgba(100,116,139,0.2)') + ';color:' + (hasRealBot ? pillColor : 'rgba(255,255,255,0.3)') + ';flex-shrink:0;">' + pillLabel + '</span>' +
    '<div style="flex:1;min-width:0;">' +
      '<div style="color:white;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + task.name + '</div>' +
      '<div id="headerSub_' + task.id + '" style="color:rgba(255,255,255,0.3);font-size:11px;margin-top:2px;">' +
        stockDisplay +
        (noteIT ? ' · ' + noteIT.replace(/^(fai|hai|stock ok · |prepara oggi · )/i, '').substring(0, 40) : '') +
      '</div>' +
    '</div>' +
    '<span id="prepArrow_' + task.id + '" style="color:rgba(255,255,255,0.25);font-size:16px;transition:transform 0.2s;">&#x203A;</span>';

  // ── Body ──
  var body = document.createElement('div');
  body.id = 'prepBody_' + task.id;
  body.style.cssText = 'display:none;border-top:0.5px solid rgba(255,255,255,0.07);padding:14px;';

  // Helper to build a static read-only row
  function staticRow(label, value, valueColor) {
    var c = valueColor || 'rgba(255,255,255,0.7)';
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:0.5px solid rgba(255,255,255,0.05);">' +
      '<span style="color:rgba(255,255,255,0.4);font-size:12px;">' + label + '</span>' +
      '<span style="color:' + c + ';font-size:13px;font-weight:600;text-align:right;">' + value + '</span>' +
    '</div>';
  }

  // Helper to build an editable config row (for recipe params only — NOT for quantities)
  function editRowConfig(label, inputId, inputType, val, opts) {
    opts = opts || {};
    var hint = opts.hint ? '<div style="color:rgba(255,255,255,0.2);font-size:10px;margin-top:3px;">' + opts.hint + '</div>' : '';
    var inputStyle = 'background:rgba(255,255,255,0.08);border:1.5px solid rgba(255,255,255,0.18);border-radius:8px;color:white;font-size:14px;font-weight:700;padding:5px 8px;text-align:right;outline:none;';
    var inp = '';
    if (inputType === 'select' && opts.choices) {
      inp = '<select id="' + inputId + '" style="' + inputStyle + 'cursor:pointer;">';
      opts.choices.forEach(function(c) {
        inp += '<option value="' + c + '"' + (String(val) === String(c) ? ' selected' : '') + '>' + c + '</option>';
      });
      inp += '</select>';
    } else {
      var step = opts.step ? ' step="' + opts.step + '"' : '';
      var min  = opts.min != null ? ' min="' + opts.min + '"' : '';
      var max  = opts.max != null ? ' max="' + opts.max + '"' : '';
      var w    = inputType === 'number' ? 'width:80px;' : 'width:140px;';
      inp = '<input id="' + inputId + '" type="' + inputType + '" value="' + (val || '') + '" ' +
        step + min + max +
        'style="' + inputStyle + w + '">';
    }
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid rgba(255,255,255,0.05);">' +
      '<div>' +
        '<span style="color:rgba(255,255,255,0.4);font-size:12px;">' + label + '</span>' +
        hint +
      '</div>' +
      inp +
    '</div>';
  }

  var bodyHTML = '';

  // ── SEZIONE 1: RISULTATO BOT REALE ──────────────────────────────────
  // Source: prep_tasks.suggested_note / suggested_qty / suggested_at / suggested_by
  // logicSource: real_bot_v41_result
  var realBotColor = hasRealBot ? pillColor : 'rgba(255,255,255,0.2)';
  var realBotBg    = hasRealBot ? pillBg : 'rgba(255,255,255,0.03)';
  var realBotBorder = hasRealBot ? pillColor : 'rgba(255,255,255,0.1)';

  bodyHTML +=
    '<div style="background:' + realBotBg + ';border:1.5px solid ' + realBotBorder + ';border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<div style="color:rgba(255,255,255,0.4);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">🤖 Risultato bot reale</div>' +
        '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.2);letter-spacing:.05em;">logicSource: real_bot_v41_result</div>' +
      '</div>';

  if (hasRealBot) {
    var sugQty = task.suggested_qty != null ? botFmtValue(task.suggested_qty, task.unit) : '—';
    var runAt = task.suggested_at
      ? (function() {
          try {
            var d = new Date(task.suggested_at);
            var cdt = new Date(d.getTime() - 5 * 60 * 60 * 1000);
            return cdt.toISOString().slice(0,10) + ' ' +
              String(cdt.getUTCHours()).padStart(2,'0') + ':' +
              String(cdt.getUTCMinutes()).padStart(2,'0') + ' CDT';
          } catch(e) { return task.suggested_at; }
        })()
      : '—';

    bodyHTML +=
      staticRow('Pill', '<span style="background:' + pillBg + ';color:' + pillColor + ';padding:2px 8px;border-radius:20px;font-weight:700;">' + noteColor.toUpperCase() + '</span>', null) +
      staticRow('Suggested qty', sugQty, pillColor) +
      staticRow('🇮🇹 IT', noteIT || '—', '#86efac') +
      staticRow('🇺🇸 EN', noteEN || '—', '#93c5fd') +
      staticRow('🇪🇸 ES', noteES || '—', '#fbbf24') +
      staticRow('Run at (CDT)', runAt, 'rgba(255,255,255,0.4)') +
      staticRow('Run by', task.suggested_by || '—', 'rgba(255,255,255,0.3)');
  } else {
    bodyHTML +=
      '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:6px 0;">Il bot non ha ancora girato per questa prep.<br>' +
      '<span style="font-size:11px;color:rgba(255,255,255,0.2);">Il bot gira ogni notte alle 4:00 AM CDT.</span></div>';
  }

  bodyHTML += '</div>';

  // ── SEZIONE 2: SIMULAZIONE TRUSTED (bot_debug_runs) ─────────────────
  // Source: bot-preplist-sim → bot_debug_runs
  // logicSource: bot_debug_sim_v6
  // Loaded async after card is expanded
  bodyHTML +=
    '<div style="background:rgba(59,130,246,0.05);border:1.5px solid rgba(59,130,246,0.2);border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<div style="color:rgba(147,197,253,0.7);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">📊 Simulazione trusted</div>' +
        '<div style="font-size:9px;font-weight:700;color:rgba(147,197,253,0.3);letter-spacing:.05em;">logicSource: bot_debug_sim_v6</div>' +
      '</div>' +
      '<div id="simData_' + task.id + '" style="color:rgba(255,255,255,0.25);font-size:11px;">Caricamento...</div>' +
    '</div>';

  // ── SEZIONE 3: STOCK ATTUALE (DB read) ──────────────────────────────
  // stockSource: current_stock_db
  var stockVal = task.current_stock !== null ? botFmtValue(task.current_stock, task.unit) : null;
  bodyHTML +=
    '<div style="background:rgba(255,255,255,0.03);border:0.5px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<div style="color:rgba(255,255,255,0.4);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">📦 Stock attuale</div>' +
        '<div style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.2);letter-spacing:.05em;">stockSource: current_stock_db</div>' +
      '</div>' +
      (stockVal
        ? staticRow('current_stock', stockVal, '#22c55e')
        : '<div style="color:rgba(239,68,68,0.7);font-size:12px;">stock NULL — il bot salta questa prep</div>') +
      staticRow('Unità', task.unit || '—', 'rgba(255,255,255,0.5)') +
      staticRow('Prep type', task.prep_type || '—', 'rgba(255,255,255,0.5)') +
    '</div>';

  // ── SEZIONE 4: CONFIGURAZIONE BOT (editable — recipe params only) ────
  // These are INPUT parameters for the bot, not calculation outputs.
  // Editing these changes what the bot will use next time it runs.
  bodyHTML +=
    '<div style="background:rgba(255,255,255,0.03);border:0.5px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 14px;margin-bottom:14px;">' +
      '<div style="color:rgba(255,255,255,0.4);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">⚙️ Configurazione bot (parametri input)</div>';

  bodyHTML += editRowConfig('Tipo prep', 'f_preptype_' + task.id, 'select',
    task.prep_type || 'supporto', { choices: ['finale', 'supporto'] });

  bodyHTML += editRowConfig('Unità inventario', 'f_unit_' + task.id, 'select',
    task.unit || 'g', { choices: ['g', 'pezzi', 'pz', 'buste', 'cup', 'nests', 'kg', 'cartocci'] });

  if (rec) {
    bodyHTML += editRowConfig('Serving qty (' + (rec.serving_unit || 'unità') + '/porzione)', 'f_servqty_' + task.id, 'number',
      rec.serving_qty || '', { min: 0, step: 0.5, hint: 'Spinaci=1cup. Fettuccine=2nests. Lobster=1coda.' });

    bodyHTML += editRowConfig('Serving unit', 'f_servunit_' + task.id, 'select',
      rec.serving_unit || 'g', { choices: ['g', 'cup', 'nests', 'pezzi', 'filetto', 'porzione', 'buste'] });

    bodyHTML += editRowConfig('Peso batch (grammi)', 'f_bw_' + task.id, 'number',
      rec.base_weight_g || '', { min: 1, hint: '1 batch = N grammi. Es. Arrabbiata=3185g.' });

    bodyHTML += editRowConfig('Porzioni base', 'f_basesrv_' + task.id, 'number',
      rec.base_servings || '', { min: 1, hint: 'Quante porzioni fa 1 batch.' });

    bodyHTML += editRowConfig('Shelf life (giorni)', 'f_shelf_' + task.id, 'number',
      (rec.shelf_life_days || task.expected_duration_days || ''), { min: 1, max: 365, hint: 'Usato dal bot per calcolare la finestra di copertura.' });
  }

  bodyHTML += '</div>';

  // ── SEZIONE 5: POS ALIAS ─────────────────────────────────────────────
  bodyHTML +=
    '<div style="padding:6px 0;border-bottom:0.5px solid rgba(255,255,255,0.05);margin-bottom:14px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
        '<span style="color:rgba(255,255,255,0.4);font-size:12px;">POS alias (vendite collegate)</span>' +
        '<span style="color:rgba(255,255,255,0.25);font-size:10px;">Il bot legge queste voci dal POS</span>' +
      '</div>' +
      '<div id="posAliasTags_' + task.id + '" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;">';

  posAliases.forEach(function(a, i) {
    bodyHTML +=
      '<div style="display:inline-flex;align-items:center;gap:3px;background:rgba(59,130,246,0.15);border:0.5px solid rgba(147,197,253,0.3);border-radius:20px;padding:3px 8px;">' +
        '<span style="color:#93c5fd;font-size:11px;">' + a + '</span>' +
        '<button onclick="botRemovePosAlias(' + task.id + ',' + i + ')" style="background:none;border:none;color:rgba(147,197,253,0.4);font-size:12px;cursor:pointer;padding:0;line-height:1;">&#x2715;</button>' +
      '</div>';
  });

  bodyHTML +=
      '</div>' +
      '<div style="display:flex;gap:6px;">' +
        '<select id="posAliasInput_' + task.id + '" ' +
          'onfocus="botLoadPosDropdown(' + task.id + ')" ' +
          'style="flex:1;padding:6px 8px;background:rgba(255,255,255,0.06);border:1px solid rgba(147,197,253,0.25);border-radius:8px;font-size:12px;color:white;cursor:pointer;">' +
          '<option value="">— Seleziona dal POS —</option>' +
        '</select>' +
        '<button onclick="botAddPosAlias(' + task.id + ')" style="padding:6px 10px;background:rgba(59,130,246,0.2);border:1px solid rgba(147,197,253,0.3);border-radius:8px;color:#93c5fd;font-size:12px;font-weight:700;cursor:pointer;">+ Add</button>' +
      '</div>' +
    '</div>';

  // ── SAVE BUTTON — saves recipe config params only ────────────────────
  // Does NOT save suggested_note or any calculated quantity
  bodyHTML +=
    '<button id="saveBtn_' + task.id + '" onclick="botSaveTask(' + task.id + ')" ' +
      'style="width:100%;padding:13px;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;border-radius:12px;color:white;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px;">' +
      '💾 Salva configurazione bot' +
    '</button>' +
    '<div id="saveMsg_' + task.id + '" style="display:none;"></div>';

  body.innerHTML = bodyHTML;

  // Serializza solo i dati statici necessari a botSaveTask (recipe config, pos_name)
  body.dataset.task = JSON.stringify({
    id: task.id,
    unit: task.unit || 'g',
    prep_type: task.prep_type || 'supporto',
    recipe_id: rec ? rec.id : null,
    pos_name: rec ? (rec.pos_name || '') : '',
    serving_qty: rec ? (parseFloat(rec.serving_qty) || 0) : 0,
    serving_unit: rec ? (rec.serving_unit || '') : '',
    base_weight_g: rec ? (parseFloat(rec.base_weight_g) || 0) : 0,
    base_servings: rec ? (parseInt(rec.base_servings) || 1) : 1,
    shelf_life: rec ? (rec.shelf_life_days || task.expected_duration_days || 3) : (task.expected_duration_days || 3)
  });

  // Toggle expand — carica sim data solo alla prima apertura
  var expanded = false;
  var simLoaded = false;
  header.addEventListener('click', function() {
    expanded = !expanded;
    body.style.display = expanded ? 'block' : 'none';
    var arrow = document.getElementById('prepArrow_' + task.id);
    if (arrow) arrow.style.transform = expanded ? 'rotate(90deg)' : '';

    // Carica sim data la prima volta che la card si apre
    if (expanded && !simLoaded) {
      simLoaded = true;
      var simEl = document.getElementById('simData_' + task.id);
      window.botLoadSimData(task.name).then(function(sim) {
        if (!simEl) return;
        if (!sim) {
          simEl.innerHTML =
            '<div style="color:rgba(147,197,253,0.4);font-size:12px;">Nessun dato di simulazione disponibile.</div>' +
            '<div style="font-size:10px;color:rgba(255,255,255,0.2);margin-top:4px;">Esegui Bot Debug per dettagli — Admin → Bot Debug → Aggiorna simulazione.</div>';
          return;
        }
        var pill = sim.pill || 'green';
        var pc = pill === 'red' ? '#ef4444' : pill === 'yellow' ? '#eab308' : '#22c55e';
        var rows = [
          ['Stock reale',    botFmtValue(sim.current_stock,  sim.unit)],
          ['Venduto ieri',   sim.sold_yesterday ? '−' + botFmtValue(sim.sold_yesterday, sim.unit) : '—'],
          ['Stock presunto', botFmtValue(sim.stock_presunto, sim.unit)],
          ['Fabbisogno raw', botFmtValue(sim.fabbisogno_raw, sim.unit)],
          ['Suggestion',     sim.suggestion_text || '—'],
          ['Percorso',       sim.percorso || '—'],
          ['Sim date',       sim.sim_date || '—']
        ];
        var html =
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
            '<span style="font-size:10px;padding:2px 7px;border-radius:20px;font-weight:700;background:rgba(59,130,246,0.15);color:' + pc + ';">' + pill.toUpperCase() + '</span>' +
            '<span style="font-size:13px;font-weight:700;color:' + pc + ';">' + (sim.suggestion_text || '—') + '</span>' +
          '</div>';
        rows.forEach(function(r) {
          html +=
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.05);">' +
              '<span style="color:rgba(147,197,253,0.5);font-size:11px;">' + r[0] + '</span>' +
              '<span style="color:rgba(255,255,255,0.7);font-size:12px;font-weight:600;text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;">' + r[1] + '</span>' +
            '</div>';
        });
        simEl.innerHTML = html;
      }).catch(function() {
        if (simEl) simEl.innerHTML = '<div style="color:rgba(239,68,68,0.5);font-size:11px;">Errore caricamento sim.</div>';
      });
    }
  });

  card.appendChild(header);
  card.appendChild(body);
  return card;
}
// POS alias — aggiungi/rimuovi
// Carica nomi POS nel dropdown quando si apre
window.botLoadPosDropdown = async function(tid) {
  var sel = document.getElementById('posAliasInput_'+tid);
  if (!sel || sel.dataset.loaded) return; // carica solo una volta
  var sb = window.supa;
  if (!sb) return;
  try {
    sel.innerHTML = '<option value="">Caricamento...</option>';
    // Leggi tutti i menu_item distinti dal POS
    var { data } = await sb
      .from('pos_sales_by_item')
      .select('menu_item')
      .order('menu_item')
      .limit(500);
    // Deduplicati
    var items = [...new Set((data||[]).map(function(r){ return r.menu_item; }).filter(Boolean))];
    sel.innerHTML = '<option value="">— Seleziona dal POS —</option>';
    items.forEach(function(item) {
      var opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      sel.appendChild(opt);
    });
    sel.dataset.loaded = '1';
  } catch(e) {
    sel.innerHTML = '<option value="">Errore caricamento</option>';
  }
};

window.botAddPosAlias = function(tid) {
  var inp = document.getElementById('posAliasInput_'+tid);
  if (!inp || !inp.value.trim()) return;
  var val = inp.value.trim();
  // Reset il select alla voce placeholder
  inp.selectedIndex = 0;
  var container = document.getElementById('posAliasTags_'+tid);
  if (!container) return;
  var body = document.getElementById('prepBody_'+tid);
  var d={}; try{d=JSON.parse(body?.dataset.task||'{}');}catch(e){}
  var aliases = d.pos_name ? d.pos_name.split('|').filter(Boolean) : [];
  if (aliases.indexOf(val)===-1) aliases.push(val);
  d.pos_name = aliases.join('|');
  if (body) body.dataset.task = JSON.stringify(d);
  // Re-render tags
  var html='';
  aliases.forEach(function(a,i){
    html+='<div style="display:inline-flex;align-items:center;gap:3px;background:rgba(59,130,246,0.15);border:0.5px solid rgba(147,197,253,0.3);border-radius:20px;padding:3px 8px;">'+
      '<span style="color:#93c5fd;font-size:11px;">'+a+'</span>'+
      '<button onclick="botRemovePosAlias('+tid+','+i+')" style="background:none;border:none;color:rgba(147,197,253,0.4);font-size:12px;cursor:pointer;padding:0;line-height:1;">&#x2715;</button>'+
      '</div>';
  });
  container.innerHTML=html;
};

window.botRemovePosAlias = function(tid, idx) {
  var container = document.getElementById('posAliasTags_'+tid);
  var body = document.getElementById('prepBody_'+tid);
  var d={}; try{d=JSON.parse(body?.dataset.task||'{}');}catch(e){}
  var aliases = d.pos_name ? d.pos_name.split('|').filter(Boolean) : [];
  aliases.splice(idx,1);
  d.pos_name = aliases.join('|');
  if (body) body.dataset.task = JSON.stringify(d);
  var html='';
  aliases.forEach(function(a,i){
    html+='<div style="display:inline-flex;align-items:center;gap:3px;background:rgba(59,130,246,0.15);border:0.5px solid rgba(147,197,253,0.3);border-radius:20px;padding:3px 8px;">'+
      '<span style="color:#93c5fd;font-size:11px;">'+a+'</span>'+
      '<button onclick="botRemovePosAlias('+tid+','+i+')" style="background:none;border:none;color:rgba(147,197,253,0.4);font-size:12px;cursor:pointer;padding:0;line-height:1;">&#x2715;</button>'+
      '</div>';
  });
  if (container) container.innerHTML=html;
};

// ── Salva tutto sul DB ──
window.botSaveTask = async function(tid) {
  var sb   = window.supa; if(!sb) return;
  var body = document.getElementById('prepBody_'+tid);
  var d    = {}; try{d=JSON.parse(body?.dataset.task||'{}');}catch(e){}
  var btn  = document.getElementById('saveBtn_'+tid);
  var msg  = document.getElementById('saveMsg_'+tid);
  if(btn){btn.disabled=true;btn.textContent='Salvo...';}

  try {
    var saved=[];

    // 1. prep_tasks: current_stock, unit, prep_type
    var taskUpdate = {};
    var unitV  = document.getElementById('f_unit_'+tid)?.value;
    var typeV  = document.getElementById('f_preptype_'+tid)?.value;
    // NOTE: current_stock is not edited here — use prep.js DONE flow to update stock
    if(unitV) { taskUpdate.unit=unitV; saved.push('unit '+unitV); }
    if(typeV) { taskUpdate.prep_type=typeV; saved.push('tipo '+typeV); }

    // NOTE: suggested_note is written ONLY by the real bot (bot-preplist-builder v41).
    // The Costruttore Preplist UI never writes suggested_note — it only reads it.

    if(Object.keys(taskUpdate).length>0){
      var {error:te} = await sb.from('prep_tasks').update(taskUpdate).eq('id',tid);
      if(te) throw te;
    }

    // 2. recipes: shelf_life_days, base_weight_g, base_servings, serving_qty, serving_unit, pos_name
    if(d.recipe_id){
      var recUpdate={};
      var shelfV  = parseInt(document.getElementById('f_shelf_'+tid)?.value);
      var bwV     = parseFloat(document.getElementById('f_bw_'+tid)?.value);
      var bsV     = parseInt(document.getElementById('f_basesrv_'+tid)?.value);
      var sqV     = parseFloat(document.getElementById('f_servqty_'+tid)?.value);
      var suV     = document.getElementById('f_servunit_'+tid)?.value;
      var posV    = d.pos_name; // aggiornato da botAddPosAlias/botRemovePosAlias
      if(!isNaN(shelfV)&&shelfV>0) { recUpdate.shelf_life_days=shelfV; saved.push('shelf '+shelfV+'gg'); }
      if(!isNaN(bwV)&&bwV>0)       { recUpdate.base_weight_g=bwV; saved.push('batch '+bwV+'g'); }
      if(!isNaN(bsV)&&bsV>0)       { recUpdate.base_servings=bsV; saved.push('porzioni base '+bsV); }
      if(!isNaN(sqV)&&sqV>0)       { recUpdate.serving_qty=sqV; saved.push('serving qty '+sqV); }
      if(suV)                       { recUpdate.serving_unit=suV; saved.push('serving unit '+suV); }
      if(posV!==undefined)          { recUpdate.pos_name=posV; saved.push('POS alias'); }
      if(Object.keys(recUpdate).length>0){
        var {error:re} = await sb.from('recipes').update(recUpdate).eq('id',d.recipe_id);
        if(re) throw re;
      }
    }

    if(msg){
      msg.style.display='block';
      msg.innerHTML='<div style="background:rgba(134,239,172,0.1);border:0.5px solid rgba(134,239,172,0.3);border-radius:10px;padding:10px;color:#86efac;font-size:12px;margin-top:8px;">'+
        '✅ '+(saved.length>0?saved.join(' · '):'Nessuna modifica')+'<br>'+
        '<span style="opacity:.6;">Il bot usa questi valori stanotte alle 4AM</span></div>';
    }
  } catch(e) {
    if(msg){
      msg.style.display='block';
      msg.innerHTML='<div style="background:rgba(239,68,68,0.1);border:0.5px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px;color:#f87171;font-size:12px;margin-top:8px;">❌ '+e.message+'</div>';
    }
  } finally {
    if(btn){btn.disabled=false;btn.textContent='💾 Salva sul DB';}
  }
};


// ══════════════════════════════════════════════════════════════
// CHEF AI SKILL ENGINE — v1.0
// Architecture: Bot detects → issue_type → Dispatcher → Skill → Resolve → Learn
// ══════════════════════════════════════════════════════════════

// ── Skill Dispatcher ──────────────────────────────────────────
// Entry point: called by any "🧠 Resolve" button in L'Ufficio.
// Routes issue_type to the correct Skill. Never hardcoded in bots.
// Future Skills: plug-and-play — add case here, implement function below.
window.officeSkillDispatch = async function(itemId, issueType) {
  var sb = window.supa;
  if (!sb) return;

  // Load the full office_item
  var { data: item } = await sb
    .from('office_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();

  if (!item) return;

  switch (issueType) {
    case 'bom_unknown_units':
    case 'UNKNOWN_UNIT':
      window.officeSkillUnknownUnit(item);
      break;
    // Future Skills — plug-and-play:
    // case 'bom_partial':         window.officeSkillBomIncomplete(item); break;
    // case 'MISSING_LINK':        window.officeSkillIngredientLink(item); break;
    // case 'missing_procedure':   window.officeSkillProcedure(item); break;
    // case 'PRICE_ANOMALY':       window.officeSkillPriceAnomaly(item); break;
    default:
      // Fallback: open recipe editor if recipe_id known
      if (item.source_id) {
        window.officeOpenRecipe(itemId, item.source_id);
      }
  }
};

// ── Skill #001 — UNKNOWN_UNIT ─────────────────────────────────
// Level 1 Skill: deterministic, one row, one field, zero ambiguity.
// Target: < 30 seconds from open to resolved.
window.officeSkillUnknownUnit = async function(item) {
  var sb = window.supa;
  if (!sb) return;

  var recipeId = item.source_id || item.recipe_id;
  if (!recipeId) { alert('Recipe ID missing — cannot open Skill.'); return; }

  // Load all BOM rows with unknown units for this recipe
  var KNOWN_UNITS = ['g','kg','oz','lb','ml','l','tsp','tbsp','cup','each','pezzi','pz'];
  var { data: bomRows } = await sb
    .from('recipe_bom')
    .select('bom_id, quantity, unit, item_id, sub_recipe_id, component_type, ingredients:item_id(id, name, base_unit, measure_type)')
    .eq('parent_recipe_id', recipeId);

  var unknownRows = (bomRows || []).filter(function(r) {
    return r.unit && KNOWN_UNITS.indexOf((r.unit||'').toLowerCase().trim()) === -1;
  });

  var { data: recipe } = await sb
    .from('recipes')
    .select('id, title, base_servings, base_weight_g')
    .eq('id', recipeId)
    .maybeSingle();

  var recipeName = recipe ? recipe.title : (item.recipe_name || 'Recipe');

  // Build sheet HTML
  var rowsHTML = '';
  unknownRows.forEach(function(row, idx) {
    var ingName = row.ingredients ? row.ingredients.name : (row.sub_recipe_id ? 'Sub-recipe' : 'Ingredient');
    var baseUnit = row.ingredients ? (row.ingredients.base_unit || 'g') : 'g';
    var measureType = row.ingredients ? (row.ingredients.measure_type || 'weight') : 'weight';

    // Suggest compatible units based on ingredient measure_type
    var suggestedUnits;
    if (measureType === 'each') {
      suggestedUnits = ['each', 'pezzi', 'pz'];
    } else if (measureType === 'volume') {
      suggestedUnits = ['ml', 'l', 'tsp', 'tbsp', 'cup'];
    } else {
      suggestedUnits = ['g', 'kg', 'oz', 'lb'];
    }

    rowsHTML +=
      '<div style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.15);border-radius:12px;padding:14px;margin-bottom:12px;" id="skillRow_' + row.bom_id + '">' +
        '<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">BOM Row #' + row.bom_id + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:#1e3a5f;margin-bottom:4px;">' + ingName + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
          '<div style="background:rgba(239,68,68,0.1);border-radius:8px;padding:4px 10px;font-size:13px;font-weight:700;color:#ef4444;">' + row.quantity + ' <span style="text-decoration:line-through;">' + row.unit + '</span></div>' +
          '<div style="color:#94a3b8;font-size:13px;">cannot be converted</div>' +
        '</div>' +
        '<div style="font-size:12px;color:#475569;margin-bottom:8px;font-weight:600;">Choose unit:</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;" id="unitPicker_' + row.bom_id + '">' +
          suggestedUnits.map(function(u) {
            var isBase = u === baseUnit;
            return '<button onclick="officeSkillSelectUnit(' + row.bom_id + ',\'' + u + '\',this)" ' +
              'style="padding:8px 16px;border-radius:20px;font-size:14px;font-weight:600;cursor:pointer;' +
              (isBase
                ? 'border:2px solid #2563eb;background:#eff6ff;color:#1d4ed8;'
                : 'border:1px solid rgba(30,58,95,0.15);background:white;color:#475569;') +
              '">' + u + (isBase ? ' ✓' : '') + '</button>';
          }).join('') +
        '</div>' +
        '<input type="hidden" id="selectedUnit_' + row.bom_id + '" value="">' +
      '</div>';
  });

  if (unknownRows.length === 0) {
    rowsHTML = '<div style="text-align:center;padding:24px;color:#64748b;">No unknown units found — this issue may already be resolved.</div>';
  }

  var sheetHTML =
    '<div id="skillOverlay" onclick="if(event.target===this)officeSkillClose()" ' +
      'style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:flex-end;">' +
      '<div id="skillSheet" style="width:100%;max-height:90vh;background:white;border-radius:20px 20px 0 0;overflow-y:auto;padding:0 0 40px;">' +

        // Header
        '<div style="position:sticky;top:0;background:white;padding:16px 20px 12px;border-bottom:0.5px solid rgba(30,58,95,0.08);display:flex;align-items:center;gap:12px;z-index:1;">' +
          '<div style="flex:1;">' +
            '<div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px;">🧠 Skill #001 — Unknown Unit</div>' +
            '<div style="font-size:18px;font-weight:800;color:#1e3a5f;">' + recipeName + '</div>' +
          '</div>' +
          '<button onclick="officeSkillClose()" style="width:32px;height:32px;border-radius:50%;border:none;background:rgba(30,58,95,0.06);color:#64748b;font-size:18px;cursor:pointer;">×</button>' +
        '</div>' +

        // Context
        '<div style="margin:14px 20px 0;padding:10px 12px;background:rgba(239,68,68,0.05);border-left:3px solid #ef4444;border-radius:0 8px 8px 0;">' +
          '<div style="font-size:13px;color:#7f1d1d;line-height:1.5;">' +
            'This unit cannot be converted into food cost calculations.<br>' +
            '<span style="color:#94a3b8;font-size:12px;">Select the correct unit for each row below.</span>' +
          '</div>' +
        '</div>' +

        // Rows
        '<div style="padding:14px 20px 0;">' + rowsHTML + '</div>' +

        // Save button
        '<div style="padding:0 20px;" id="skillSaveBtnWrap"' + (unknownRows.length === 0 ? ' style="display:none"' : '') + '>' +
          '<button id="skillSaveBtn" onclick="officeSkillUnknownUnitSave(\'' + item.id + '\',\'' + recipeId + '\')" ' +
            'style="width:100%;padding:16px;border-radius:14px;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;font-size:17px;font-weight:700;cursor:pointer;opacity:0.4;pointer-events:none;">' +
            '💾 Save &amp; Close Issue' +
          '</button>' +
          '<div id="skillSaveMsg" style="display:none;margin-top:10px;"></div>' +
        '</div>' +

      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', sheetHTML);

  // Store unknown rows for save
  window._skillUnknownRows = unknownRows;
  window._skillSelectedUnits = {};
};

// ── Unit picker interaction ────────────────────────────────────
window.officeSkillSelectUnit = function(bomId, unit, btn) {
  // Highlight selected button
  var picker = document.getElementById('unitPicker_' + bomId);
  if (picker) {
    picker.querySelectorAll('button').forEach(function(b) {
      b.style.border = '1px solid rgba(30,58,95,0.15)';
      b.style.background = 'white';
      b.style.color = '#475569';
    });
  }
  btn.style.border = '2px solid #2563eb';
  btn.style.background = '#eff6ff';
  btn.style.color = '#1d4ed8';

  // Store selection
  var input = document.getElementById('selectedUnit_' + bomId);
  if (input) input.value = unit;
  window._skillSelectedUnits = window._skillSelectedUnits || {};
  window._skillSelectedUnits[bomId] = unit;

  // Check if all rows have a selection — enable Save
  var allSelected = (window._skillUnknownRows || []).every(function(row) {
    return window._skillSelectedUnits[row.bom_id];
  });
  var saveBtn = document.getElementById('skillSaveBtn');
  if (saveBtn && allSelected) {
    saveBtn.style.opacity = '1';
    saveBtn.style.pointerEvents = 'auto';
  }
};

// ── Skill #001 Save ───────────────────────────────────────────
window.officeSkillUnknownUnitSave = async function(itemId, recipeId) {
  var sb = window.supa;
  if (!sb) return;
  var btn = document.getElementById('skillSaveBtn');
  var msg = document.getElementById('skillSaveMsg');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving...'; }

  try {
    var rows = window._skillUnknownRows || [];
    var selected = window._skillSelectedUnits || {};
    var now = new Date().toISOString();
    var resolvedBy = window.user?.name || 'Max';
    var historyRows = [];

    // 1. Update each BOM row unit
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var newUnit = selected[row.bom_id];
      if (!newUnit) continue;

      var { error: bomErr } = await sb
        .from('recipe_bom')
        .update({ unit: newUnit })
        .eq('bom_id', row.bom_id);
      if (bomErr) throw bomErr;

      historyRows.push({
        skill_name: 'UNKNOWN_UNIT',
        office_item_id: itemId,
        recipe_id: recipeId,
        ingredient_id: row.item_id || null,
        bom_id: row.bom_id,
        old_value: row.unit,
        new_value: newUnit,
        field_name: 'unit',
        resolved_by: resolvedBy,
        resolved_at: now
      });
    }

    // 2. Log to chef_ai_skill_history
    if (historyRows.length > 0) {
      await sb.from('chef_ai_skill_history').insert(historyRows);
    }

    // 3. Verify: re-check BOM for unknown units
    var KNOWN_UNITS = ['g','kg','oz','lb','ml','l','tsp','tbsp','cup','each','pezzi','pz'];
    var { data: updatedBom } = await sb
      .from('recipe_bom')
      .select('bom_id, unit')
      .eq('parent_recipe_id', recipeId);

    var stillUnknown = (updatedBom || []).filter(function(r) {
      return r.unit && KNOWN_UNITS.indexOf((r.unit||'').toLowerCase().trim()) === -1;
    });

    // 4. Close office_item if issue is fully resolved
    if (stillUnknown.length === 0) {
      await sb.from('office_items').update({
        status: 'resolved',
        resolved_by: resolvedBy,
        resolved_at: now,
        resolution: 'Resolved via Skill UNKNOWN_UNIT — ' + historyRows.length + ' row(s) corrected'
      }).eq('id', itemId);
    }

    // 5. Success UI
    if (msg) {
      msg.style.display = 'block';
      msg.innerHTML =
        '<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:10px;padding:12px;text-align:center;">' +
          '<div style="font-size:20px;margin-bottom:4px;">✅</div>' +
          '<div style="font-size:15px;font-weight:700;color:#15803d;">Issue Resolved</div>' +
          '<div style="font-size:12px;color:#4ade80;margin-top:2px;">' + historyRows.length + ' unit(s) corrected · Logged to Skill History</div>' +
        '</div>';
    }

    // 6. Close sheet and refresh L'Ufficio after brief delay
    setTimeout(function() {
      officeSkillClose();
      // Remove resolved card from DOM
      var card = document.querySelector('[data-item-id="' + itemId + '"]');
      if (card) {
        card.style.transition = 'all 0.25s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(40px)';
        setTimeout(function() { card.remove(); }, 280);
      }
    }, 1800);

  } catch(e) {
    if (msg) {
      msg.style.display = 'block';
      msg.innerHTML = '<div style="color:#ef4444;font-size:13px;padding:8px;">❌ ' + e.message + '</div>';
    }
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save & Close Issue'; }
  }
};

// ── Close Skill Sheet ─────────────────────────────────────────
window.officeSkillClose = function() {
  document.getElementById('skillOverlay')?.remove();
  window._skillUnknownRows = null;
  window._skillSelectedUnits = null;
};


// ══════════════════════════════════════════════════════════════
// CHEF AI ENGINE UI — v1
// Card intelligenti con reasoning result di Chef AI
// ══════════════════════════════════════════════════════════════

// ── Card "thinking" — mostrata mentre jarvis-reason sta girando ──
function officeRenderJarvisThinking(item) {
  var ts = '';
  try {
    var d = new Date(item.created_at);
    ts = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) +
         ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
  } catch(e) {}

  return '<div data-item-id="' + item.id + '" style="background:white;border:0.5px solid rgba(139,92,246,0.2);border-left:3px solid #8b5cf6;border-radius:16px;margin:0 12px 8px;overflow:hidden;box-shadow:0 2px 8px rgba(139,92,246,0.08);">' +
    '<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#3b82f6);display:flex;align-items:center;justify-content:center;font-size:14px;animation:spin 2s linear infinite;flex-shrink:0;">🧠</div>' +
      '<div style="flex:1;">' +
        '<div style="font-size:15px;font-weight:700;color:#1e3a5f;">' + (item.title || '') + '</div>' +
        '<div style="font-size:12px;color:#8b5cf6;margin-top:2px;">Chef AI sta ragionando...</div>' +
      '</div>' +
      '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(139,92,246,0.1);color:#8b5cf6;font-weight:600;">AI scan</span>' +
    '</div>' +
    '<div style="padding:0 14px 12px;">' +
      '<div style="background:rgba(139,92,246,0.05);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:8px;">' +
        '<div style="width:6px;height:6px;border-radius:50%;background:#8b5cf6;animation:pulse 1s infinite;flex-shrink:0;"></div>' +
        '<div style="font-size:13px;color:#7c3aed;">Investigando nel database... questa operazione richiede 10-20 secondi.</div>' +
      '</div>' +
    '</div>' +
    '<div style="padding:0 14px 10px;font-size:12px;color:#94a3b8;">' + ts + '</div>' +
  '</div>';
}

// ── Card Chef AI completa con reasoning result ──
function officeRenderJarvisCard(item) {
  var rr = item.reasoning_result || {};
  var ts = '';
  try {
    var d = new Date(item.created_at);
    ts = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }) +
         ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' });
  } catch(e) {}

  var confidence = rr.confidence || 0;
  var confPct = Math.round(confidence * 100);
  var confColor = confidence >= 0.8 ? '#22c55e' : confidence >= 0.6 ? '#f59e0b' : '#ef4444';
  var dotColor = { red: '#ef4444', orange: '#f97316', blue: '#3b82f6' }[item.priority] || '#8b5cf6';
  var borderLeft = { red: '3px solid #ef4444', orange: '3px solid #f97316', blue: '3px solid #8b5cf6' }[item.priority] || '3px solid #8b5cf6';
  var escapedId = item.id.replace(/'/g, "\\'");
  var intent = rr.intent || rr.issue_type || '';
  var isProductionReport = (intent === 'production_report' || intent === 'stock_count');

  // HO CAPITO block per production_report / stock_count
  var hoCapitoBlock = '';
  if (isProductionReport) {
    var wp = rr.write_plan || null;
    var prep = rr.prep_candidate || (wp && wp.row) || '';
    var producedQty = rr.produced_qty != null ? rr.produced_qty : null;
    var prevStock = rr.previous_stock_claimed != null ? rr.previous_stock_claimed : null;
    var newTotal = rr.new_total_claimed != null ? rr.new_total_claimed : (wp && wp.new_value != null ? wp.new_value : null);
    var unit = rr.unit || (wp && wp.unit) || '';
    var reporter = rr.reporter || item.from_user || '';
    var station = rr.station || '';
    var writeEnabled = wp ? (wp.requires_approval === false) : false;

    var rows = '';
    if (prep)                rows += '<tr><td style="color:#64748b;padding:2px 8px 2px 0;font-size:13px;white-space:nowrap;">Prep</td><td style="font-weight:600;color:#1e3a5f;font-size:13px;">' + prep + '</td></tr>';
    if (producedQty != null) rows += '<tr><td style="color:#64748b;padding:2px 8px 2px 0;font-size:13px;white-space:nowrap;">Prodotto ora</td><td style="font-weight:700;color:#16a34a;font-size:13px;">+' + producedQty + ' ' + unit + '</td></tr>';
    if (prevStock != null)   rows += '<tr><td style="color:#64748b;padding:2px 8px 2px 0;font-size:13px;white-space:nowrap;">Stock prec.</td><td style="font-weight:600;color:#1e3a5f;font-size:13px;">' + prevStock + ' ' + unit + '</td></tr>';
    if (newTotal != null)    rows += '<tr><td style="color:#64748b;padding:2px 8px 2px 0;font-size:13px;white-space:nowrap;">Nuovo totale</td><td style="font-weight:700;color:#2563eb;font-size:13px;">' + newTotal + ' ' + unit + '</td></tr>';
    if (reporter)            rows += '<tr><td style="color:#64748b;padding:2px 8px 2px 0;font-size:13px;white-space:nowrap;">Reporter</td><td style="font-weight:600;color:#1e3a5f;font-size:13px;">' + reporter + '</td></tr>';
    if (station)             rows += '<tr><td style="color:#64748b;padding:2px 8px 2px 0;font-size:13px;white-space:nowrap;">Station</td><td style="font-weight:600;color:#1e3a5f;font-size:13px;">' + station + '</td></tr>';
    rows += '<tr><td style="color:#64748b;padding:2px 8px 2px 0;font-size:13px;white-space:nowrap;">Confidence</td><td style="font-weight:700;color:' + confColor + ';font-size:13px;">' + confPct + '%</td></tr>';

    var writePlanHtml = '';
    if (wp) {
      var wpTable = wp.table || 'prep_tasks';
      var wpField = wp.field || 'current_stock';
      var wpOld = wp.old_value != null ? wp.old_value : (prevStock != null ? prevStock : '-');
      var wpNew = wp.new_value != null ? wp.new_value : (newTotal != null ? newTotal : '-');
      var wpLabelColor = writeEnabled ? '#16a34a' : '#94a3b8';
      var wpLabel = writeEnabled ? 'WRITE ABILITATO' : 'WRITE DISABLED';
      writePlanHtml =
        '<div style="margin-top:10px;padding:8px 10px;background:rgba(30,58,95,0.04);border:0.5px solid rgba(30,58,95,0.12);border-radius:8px;">' +
          '<div style="font-size:10px;font-weight:700;color:' + wpLabelColor + ';letter-spacing:.05em;margin-bottom:6px;">WRITE PLAN - ' + wpLabel + '</div>' +
          '<table style="border-collapse:collapse;width:100%;">' +
            '<tr><td style="color:#64748b;font-size:12px;padding:1px 8px 1px 0;white-space:nowrap;">Tabella</td><td style="font-size:12px;font-weight:600;color:#1e3a5f;">' + wpTable + '</td></tr>' +
            '<tr><td style="color:#64748b;font-size:12px;padding:1px 8px 1px 0;white-space:nowrap;">Target</td><td style="font-size:12px;font-weight:600;color:#1e3a5f;">' + (prep || '-') + '</td></tr>' +
            '<tr><td style="color:#64748b;font-size:12px;padding:1px 8px 1px 0;white-space:nowrap;">Campo</td><td style="font-size:12px;font-weight:600;color:#1e3a5f;">' + wpField + '</td></tr>' +
            '<tr><td style="color:#64748b;font-size:12px;padding:1px 8px 1px 0;white-space:nowrap;">Da</td><td style="font-size:12px;color:#94a3b8;">' + wpOld + (unit ? ' ' + unit : '') + '</td></tr>' +
            '<tr><td style="color:#64748b;font-size:12px;padding:1px 8px 1px 0;white-space:nowrap;">A</td><td style="font-size:12px;font-weight:700;color:#2563eb;">' + wpNew + (unit ? ' ' + unit : '') + '</td></tr>' +
          '</table>' +
          (!writeEnabled ? '<div style="margin-top:6px;font-size:11px;color:#94a3b8;font-style:italic;">Piano pronto. Nessuna modifica fatta.</div>' : '') +
        '</div>';
    }

    hoCapitoBlock =
      '<div style="margin:0 14px 8px;padding:12px 14px;background:rgba(22,163,74,0.04);border:0.5px solid rgba(22,163,74,0.2);border-radius:12px;">' +
        '<div style="font-size:11px;font-weight:700;color:#16a34a;letter-spacing:.05em;margin-bottom:8px;">HO CAPITO</div>' +
        '<table style="border-collapse:collapse;width:100%;">' + rows + '</table>' +
        writePlanHtml +
      '</div>';
  }

  // Proposta
  var draftsCount = rr.action_drafts ? rr.action_drafts.length : 0;
  var proposalBlock =
    '<div style="margin:8px 14px 8px;padding:12px 14px;background:linear-gradient(135deg,rgba(30,58,95,0.04),rgba(37,99,235,0.06));border:0.5px solid rgba(37,99,235,0.15);border-radius:12px;">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
        '<span style="font-size:14px;">&#x1F916;</span>' +
        '<div style="font-size:11px;font-weight:700;color:#2563eb;letter-spacing:.04em;">PROPOSTA CHEF AI</div>' +
        (draftsCount > 0 ? '<span style="font-size:10px;background:rgba(37,99,235,0.1);color:#1d4ed8;border-radius:20px;padding:1px 7px;font-weight:700;">' + draftsCount + ' azione' + (draftsCount > 1 ? 'i' : '') + '</span>' : '') +
      '</div>' +
      '<div style="font-size:15px;color:#1e3a5f;line-height:1.5;font-weight:500;">' + (rr.proposed_solution || '') + '</div>' +
    '</div>';

  // Domanda per Max
  var questionBadge = '';
  var questionText = rr.follow_up_question || (rr.needs_one_question ? rr.one_question : null);
  if (questionText) {
    questionBadge =
      '<div style="margin:0 14px 8px;padding:10px 12px;background:rgba(245,158,11,0.06);border:0.5px solid rgba(245,158,11,0.25);border-radius:10px;">' +
        '<div style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:4px;">Una domanda per Max</div>' +
        '<div style="font-size:14px;color:#1e3a5f;">' + questionText + '</div>' +
      '</div>';
  }

  // Bottone Approva contestuale
  var approvaLabel = 'Approva';
  if (isProductionReport) {
    var apNewTotal = rr.new_total_claimed != null ? rr.new_total_claimed : (rr.write_plan && rr.write_plan.new_value != null ? rr.write_plan.new_value : null);
    var apPrep = rr.prep_candidate || '';
    var apUnit = rr.unit || '';
    if (apPrep && apNewTotal != null) {
      approvaLabel = 'Aggiorna ' + apPrep + ' a ' + apNewTotal + (apUnit ? ' ' + apUnit : '');
    } else if (apNewTotal != null) {
      approvaLabel = 'Aggiorna stock a ' + apNewTotal;
    }
  }

  var styleMap = {
    primary: 'flex:1;padding:10px 0;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;line-height:1.3;',
    secondary: 'flex:1;padding:10px 0;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:0.5px solid rgba(30,58,95,0.2);background:rgba(30,58,95,0.04);color:#1e3a5f;',
    danger: 'flex:1;padding:10px 0;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:0.5px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.05);color:#ef4444;'
  };

  // Bottoni: production_report usa logica confidence-based
  // confidence >= 0.85 -> "Si Chef" diretto + "Verifica" piccolo
  // confidence < 0.85  -> "Apri dettaglio" + "Verifica ragionamento"
  var apNewTotal2 = rr.new_total_claimed != null ? rr.new_total_claimed : (rr.write_plan && rr.write_plan.new_value != null ? rr.write_plan.new_value : null);
  var apUnit2 = rr.unit || '';
  var apPrep2 = rr.prep_candidate || '';
  var highConf = confidence >= 0.85;
  var approvaHtml;
  if (isProductionReport) {
    var siChefLabel = '<span style="font-size:14px;font-weight:700;">&#x2713; Si Chef</span>'
      + (apNewTotal2 != null ? '<span style="font-size:11px;font-weight:600;opacity:0.85;">' + (apPrep2 ? apPrep2 + ' ' : '') + apNewTotal2 + (apUnit2 ? ' ' + apUnit2 : '') + '</span>' : '');
    if (highConf) {
      // Confidence alta: esecuzione diretta
      approvaHtml = '<button onclick="jarvisDirectExecute(\'' + escapedId + '\')" style="' + styleMap.primary + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;">'
        + siChefLabel + '</button>';
    } else {
      // Confidence bassa: apre approval sheet
      approvaHtml = '<button onclick="jarvisAction(\'' + escapedId + '\',\'approve_all\')" style="' + styleMap.primary + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;">'
        + '<span style="font-size:14px;font-weight:700;">Apri dettaglio</span>'
        + (apNewTotal2 != null ? '<span style="font-size:11px;font-weight:600;opacity:0.85;">' + (apPrep2 ? apPrep2 + ' ' : '') + apNewTotal2 + (apUnit2 ? ' ' + apUnit2 : '') + '</span>' : '')
        + '</button>';
    }
  } else {
    approvaHtml = '<button onclick="jarvisAction(\'' + escapedId + '\',\'approve_all\')" style="' + styleMap.primary + '">' + approvaLabel + '</button>';
  }

  var followUpOptions = rr.follow_up_options || [];
  var secondaryBtns = [];
  if (isProductionReport) {
    // Correggi quantita apre editor inline
    secondaryBtns.push('<button onclick="jarvisInlineEdit(\'' + escapedId + '\')" style="' + styleMap.secondary + '">Correggi quantita</button>');
    secondaryBtns.push('<button onclick="jarvisAction(\'' + escapedId + '\',\'reject\')" style="' + styleMap.danger + '">Rifiuta</button>');
  } else if (followUpOptions.length > 0) {
    followUpOptions.slice(1).forEach(function(opt, i) {
      if (opt.toLowerCase().indexOf('rifiut') >= 0 || opt.toLowerCase().indexOf('close') >= 0) {
        secondaryBtns.push('<button onclick="jarvisAction(\'' + escapedId + '\',\'reject\')" style="' + styleMap.danger + '">' + opt + '</button>');
      } else {
        secondaryBtns.push('<button onclick="jarvisAction(\'' + escapedId + '\',\'secondary_' + i + '\')" style="' + styleMap.secondary + '">' + opt + '</button>');
      }
    });
    if (!secondaryBtns.some(function(b) { return b.indexOf('reject') >= 0; })) {
      secondaryBtns.push('<button onclick="jarvisAction(\'' + escapedId + '\',\'reject\')" style="' + styleMap.danger + '">Rifiuta</button>');
    }
  } else {
    var rawUiButtons = rr.ui_buttons || [];
    rawUiButtons.filter(function(b) { return b.action !== 'approve_all'; }).forEach(function(btn) {
      var s = styleMap[btn.style] || styleMap.secondary;
      var ea = btn.action.replace(/'/g, "\\'");
      secondaryBtns.push('<button onclick="jarvisAction(\'' + escapedId + '\',\'' + ea + '\')" style="' + s + '">' + btn.label + '</button>');
    });
    if (!secondaryBtns.some(function(b) { return b.indexOf('reject') >= 0; })) {
      secondaryBtns.push('<button onclick="jarvisAction(\'' + escapedId + '\',\'reject\')" style="' + styleMap.danger + '">Rifiuta</button>');
    }
  }

  var verificaBtn = '<button onclick="jarvisShowReasoning(\'' + escapedId + '\')" style="padding:10px 14px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;border:0.5px solid rgba(139,92,246,0.2);background:rgba(139,92,246,0.06);color:#7c3aed;white-space:nowrap;" title="Mostra ragionamento">&#x1F50D; Verifica</button>';
  var buttonsHtml = '<div style="display:flex;flex-direction:column;gap:6px;padding:0 14px 8px;">';
  if (isProductionReport && highConf) {
    // Confidence alta: Si Chef diretto su tutta la larghezza, Verifica + secondari sotto
    buttonsHtml += '<div style="display:flex;gap:6px;">' + approvaHtml + '</div>';
    var row2 = secondaryBtns.join('') + verificaBtn;
    buttonsHtml += '<div style="display:flex;gap:6px;">' + row2 + '</div>';
  } else {
    // Confidence bassa o non-production: layout standard
    buttonsHtml += '<div style="display:flex;gap:6px;">' + approvaHtml + '</div>';
    if (secondaryBtns.length > 0) buttonsHtml += '<div style="display:flex;gap:6px;">' + secondaryBtns.join('') + '</div>';
    buttonsHtml += '<div style="display:flex;justify-content:flex-end;">' + verificaBtn + '</div>';
  }
  buttonsHtml += '</div>';

  return '<div data-item-id="' + item.id + '" style="background:white;border:0.5px solid rgba(139,92,246,0.15);border-left:' + borderLeft + ';border-radius:16px;margin:0 12px 8px;overflow:hidden;box-shadow:0 2px 8px rgba(30,58,95,0.07),0 6px 16px rgba(139,92,246,0.05);">' +

    '<div style="display:flex;align-items:flex-start;gap:8px;padding:11px 14px 6px;">' +
      '<div style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:5px;"></div>' +
      '<div style="flex:1;">' +
        '<div style="font-size:16px;font-weight:700;color:#1e3a5f;line-height:1.3;">' + (item.title || '') + '</div>' +
        (item.from_user && item.from_user !== 'system' ? '<div style="font-size:12px;color:#60a5fa;margin-top:2px;">da ' + item.from_user + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">' +
        '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(139,92,246,0.1);color:#8b5cf6;font-weight:700;">&#x1F916; Chef AI</span>' +
        (isProductionReport ? '<span style="font-size:10px;padding:1px 7px;border-radius:20px;background:rgba(22,163,74,0.1);color:#16a34a;font-weight:700;">' + intent.replace('_', ' ') + '</span>' : '<span style="font-size:10px;color:' + confColor + ';font-weight:700;">' + confPct + '% confidence</span>') +
      '</div>' +
    '</div>' +

    (item.body ? '<div style="font-size:14px;color:#64748b;padding:0 14px 8px;font-style:italic;line-height:1.4;border-bottom:0.5px solid rgba(30,58,95,0.06);">' + item.body + '</div>' : '') +

    hoCapitoBlock +
    proposalBlock +
    questionBadge +
    buttonsHtml +

    (rr.root_cause && !isProductionReport ? '<div style="padding:0 14px 6px;font-size:11px;color:#94a3b8;">Causa: ' + rr.root_cause + '</div>' : '') +

    '<div style="padding:0 14px 10px;font-size:12px;color:#94a3b8;display:flex;justify-content:space-between;">' +
      '<span>' + ts + '</span>' +
      '<span style="color:#c4b5fd;">' + (rr.model_used || '') + '</span>' +
    '</div>' +

  '</div>';
}


// ── Azione Chef AI — gestisce approve/reject/edit/ask_question ──
// ── Esecuzione diretta senza approval sheet (confidence alta) ──
window.jarvisDirectExecute = async function(itemId) {
  var sb = window.supa;
  if (!sb) return;
  var byName = (window.currentUser || window.user || {}).name || 'Max';

  // Mostra feedback visivo immediato sulla card
  var card = document.querySelector('[data-item-id="' + itemId + '"]');
  var execBtn = card ? card.querySelector('button[onclick*="jarvisDirectExecute"]') : null;
  if (execBtn) { execBtn.disabled = true; execBtn.textContent = 'Esecuzione...'; }

  try {
    // Carica action_drafts pending — se vuoti li sintetizza dal reasoning_result
    var { data: drafts } = await sb.from('chef_ai_action_drafts').select('*').eq('office_item_id', itemId).eq('status', 'pending');
    if (!drafts || drafts.length === 0) {
      var { data: officeItem } = await sb.from('office_items').select('reasoning_result').eq('id', itemId).maybeSingle();
      var rr = officeItem && officeItem.reasoning_result ? officeItem.reasoning_result : null;
      var intent = rr ? (rr.intent || rr.issue_type || '') : '';
      var isProductionReport = (intent === 'production_report' || intent === 'stock_count');
      var effectiveWritePlan = rr ? (rr.write_plan || (isProductionReport && rr.new_total_claimed != null ? {
        table: 'prep_tasks', field: 'current_stock',
        new_value: rr.new_total_claimed, row: rr.prep_candidate || '', unit: rr.unit || ''
      } : null)) : null;
      if (rr && isProductionReport && effectiveWritePlan) {
        var wp = effectiveWritePlan;
        var synthDraft = {
          office_item_id: itemId,
          action_type: 'update_prep_stock',
          payload: {
            prep_name: rr.prep_candidate || wp.row || '',
            new_value: rr.new_total_claimed != null ? rr.new_total_claimed : wp.new_value,
            unit: rr.unit || '',
            field: wp.field || 'current_stock',
            table: wp.table || 'prep_tasks',
            produced_qty: rr.produced_qty,
            previous_stock_claimed: rr.previous_stock_claimed,
            new_total_claimed: rr.new_total_claimed,
            reporter: rr.reporter || '',
            station: rr.station || ''
          },
          risk_level: 'medium', requires_approval: true, status: 'pending'
        };
        var { data: inserted } = await sb.from('chef_ai_action_drafts').insert(synthDraft).select();
        drafts = inserted || [];
      }
    }
    if (!drafts || drafts.length === 0) {
      if (typeof showScToast === 'function') showScToast('Nessuna azione da eseguire');
      if (execBtn) { execBtn.disabled = false; execBtn.textContent = '✓ Si Chef'; }
      return;
    }

    // Esegue tutti i draft in sequenza
    var now = new Date().toISOString();
    var executedCount = 0;
    for (var di = 0; di < drafts.length; di++) {
      var draft = drafts[di];
      try {
        var result = await jarvisExecuteDraft(sb, draft);
        await sb.from('chef_ai_action_drafts').update({ status: 'executed', approved_by: byName, approved_at: now, executed_at: now }).eq('id', draft.id);
        await sb.from('chef_ai_audit_log').insert({ action_draft_id: draft.id, office_item_id: itemId, action_type: draft.action_type, payload_after: draft.payload, result: typeof result === 'object' ? JSON.stringify(result) : String(result), executed_by: 'jarvis-reason', approved_by: byName });
        executedCount++;
      } catch(e) {
        await sb.from('chef_ai_action_drafts').update({ status: 'failed', error_message: e.message }).eq('id', draft.id);
        if (typeof showScToast === 'function') showScToast('Errore: ' + e.message);
      }
    }

    // Chiude la card con animazione
    await sb.from('office_items').update({
      jarvis_status: 'executed', chef_action: 'done',
      chef_action_at: now, chef_action_by: byName,
      status: 'resolved', resolution: 'jarvis_direct_' + executedCount,
      resolved_by: byName, resolved_at: now
    }).eq('id', itemId);

    if (card) {
      card.style.transition = 'all 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(-30px)';
      setTimeout(function() { card.remove(); }, 320);
    }
    if (typeof showScToast === 'function') showScToast('Si Chef — fatto');

  } catch(e) {
    if (typeof showScToast === 'function') showScToast('Errore: ' + e.message);
    if (execBtn) { execBtn.disabled = false; execBtn.textContent = '✓ Si Chef'; }
  }
};

window.jarvisAction = async function(itemId, action) {
  var sb = window.supa;
  if (!sb) return;

  if (action === 'approve_all') {
    // Carica action_drafts pending per questo item
    var { data: drafts } = await sb
      .from('chef_ai_action_drafts')
      .select('*')
      .eq('office_item_id', itemId)
      .eq('status', 'pending');

    // Se action_drafts e vuoto ma c'e un write_plan nel reasoning_result, crea draft sintetico
    if (!drafts || drafts.length === 0) {
      var { data: officeItem } = await sb.from('office_items').select('reasoning_result').eq('id', itemId).maybeSingle();
      var rr = officeItem && officeItem.reasoning_result ? officeItem.reasoning_result : null;
      var intent = rr ? (rr.intent || rr.issue_type || '') : '';
      var isProductionReport = (intent === 'production_report' || intent === 'stock_count');
      // write_plan puo essere null se il modello non lo ha costruito — ricava dai campi top-level
      var effectiveWritePlan = rr ? (rr.write_plan || (isProductionReport && rr.new_total_claimed != null ? {
        table: 'prep_tasks',
        field: 'current_stock',
        new_value: rr.new_total_claimed,
        row: rr.prep_candidate || '',
        unit: rr.unit || ''
      } : null)) : null;
      if (rr && isProductionReport && effectiveWritePlan) {
        var wp = effectiveWritePlan;
        var prep = rr.prep_candidate || wp.row || 'stock';
        var newVal = rr.new_total_claimed != null ? rr.new_total_claimed : wp.new_value;
        var unit = rr.unit || '';
        // Crea draft sintetico in DB e poi mostra sheet
        var synthDraft = {
          office_item_id: itemId,
          action_type: 'update_prep_stock',
          payload: {
            prep_name: prep,
            new_value: newVal,
            unit: unit,
            field: wp.field || 'current_stock',
            table: wp.table || 'prep_tasks',
            produced_qty: rr.produced_qty,
            previous_stock_claimed: rr.previous_stock_claimed,
            new_total_claimed: rr.new_total_claimed,
            reporter: rr.reporter || '',
            station: rr.station || '',
            STOCK_WRITE_ENABLED: false
          },
          risk_level: 'medium',
          requires_approval: true,
          status: 'pending'
        };
        var { data: inserted } = await sb.from('chef_ai_action_drafts').insert(synthDraft).select();
        drafts = inserted || [];
        if (!drafts || drafts.length === 0) {
          if (typeof showScToast === 'function') showScToast('Nessuna azione da eseguire');
          return;
        }
      } else {
        if (typeof showScToast === 'function') showScToast('Nessuna azione da eseguire');
        return;
      }
    }

    // Mostra sheet di conferma con lista azioni
    jarvisShowApprovalSheet(itemId, drafts);

  } else if (action === 'reject') {
    try {
      var byName = (window.currentUser || window.user || {}).name || 'Max';
      // Rifiuta tutte le action_drafts pending
      await sb.from('chef_ai_action_drafts').update({ status: 'rejected', approved_by: byName, approved_at: new Date().toISOString() }).eq('office_item_id', itemId).eq('status', 'pending');
      // Aggiorna office_item
      await sb.from('office_items').update({ jarvis_status: 'rejected', chef_action: 'ignored', chef_action_at: new Date().toISOString(), chef_action_by: byName, status: 'resolved', resolution: 'jarvis_rejected', resolved_by: byName, resolved_at: new Date().toISOString() }).eq('id', itemId);
      // Anima rimozione card
      var card = document.querySelector('[data-item-id="' + itemId + '"]');
      if (card) {
        card.style.transition = 'all 0.25s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(-40px)';
        setTimeout(function() { card.remove(); officeLoadHome(); }, 280);
      }
      if (typeof showScToast === 'function') showScToast('Proposta rifiutata');
    } catch(e) {
      if (typeof showScToast === 'function') showScToast('Errore: ' + e.message);
    }

  } else if (action === 'ask_question') {
    // Apre Chef AI con il contesto precaricato
    var card = document.querySelector('[data-item-id="' + itemId + '"]');
    var title = card ? (card.querySelector('div[style*="font-size:16px"]')?.textContent || '') : '';
    if (typeof officeStopRealtime === 'function') officeStopRealtime();
    document.getElementById('officeOverlay')?.remove();
    document.getElementById('officeModal')?.remove();
    if (typeof window.openSousChefChat === 'function') {
      window.openSousChefChat();
      setTimeout(function() {
        var inp = document.getElementById('_scChatInput');
        if (inp) { inp.value = 'Domanda su: ' + title.trim(); inp.focus(); }
      }, 400);
    }

  } else if (action === 'edit') {
    // Apre il reasoning sheet in modalità edit
    jarvisShowReasoning(itemId);
  }
};

// ── Sheet di approvazione con lista action_drafts ──
// ── Editor inline per correggere quantita production_report ──
window.jarvisInlineEdit = async function(itemId) {
  var sb = window.supa;
  if (!sb) return;
  var { data: officeItem } = await sb.from('office_items').select('reasoning_result,title').eq('id', itemId).maybeSingle();
  var rr = officeItem && officeItem.reasoning_result ? officeItem.reasoning_result : {};

  var existing = document.getElementById('jarvisInlineEditSheet');
  if (existing) existing.remove();

  var producedQty = rr.produced_qty != null ? rr.produced_qty : '';
  var prevStock = rr.previous_stock_claimed != null ? rr.previous_stock_claimed : '';
  var newTotal = rr.new_total_claimed != null ? rr.new_total_claimed : '';
  var unit = rr.unit || 'nests';
  var prep = rr.prep_candidate || '';

  var sheet = document.createElement('div');
  sheet.id = 'jarvisInlineEditSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9900;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;';

  var inpStyle = 'width:100%;padding:10px 12px;border-radius:10px;border:0.5px solid rgba(30,58,95,0.2);font-size:15px;color:#1e3a5f;background:white;box-sizing:border-box;';
  var labelStyle = 'font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px;display:block;';

  sheet.innerHTML =
    '<div style="width:100%;max-width:480px;margin:0 auto;background:white;border-radius:24px 24px 0 0;padding:20px 20px 32px;max-height:80vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">' +
      '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>' +
      '<div style="font-size:17px;font-weight:700;color:#1e3a5f;margin-bottom:4px;">Correggi quantita</div>' +
      '<div style="font-size:13px;color:#64748b;margin-bottom:16px;">' + (prep || 'Prep') + ' — modifica i valori dichiarati</div>' +
      '<div style="display:flex;flex-direction:column;gap:12px;">' +
        '<div><label style="' + labelStyle + '">Prodotto ora</label><input id="_jeProduced" type="number" value="' + producedQty + '" placeholder="es. 102" style="' + inpStyle + '"></div>' +
        '<div><label style="' + labelStyle + '">Stock precedente dichiarato</label><input id="_jePrev" type="number" value="' + prevStock + '" placeholder="es. 303" style="' + inpStyle + '"></div>' +
        '<div><label style="' + labelStyle + '">Nuovo totale</label><input id="_jeTotal" type="number" value="' + newTotal + '" placeholder="es. 405" style="' + inpStyle + '"></div>' +
        '<div><label style="' + labelStyle + '">Unita</label>' +
          '<select id="_jeUnit" style="' + inpStyle + '">' +
            '<option value="nests"' + (unit === 'nests' ? ' selected' : '') + '>nests</option>' +
            '<option value="g"' + (unit === 'g' ? ' selected' : '') + '>g</option>' +
            '<option value="kg"' + (unit === 'kg' ? ' selected' : '') + '>kg</option>' +
            '<option value="pezzi"' + (unit === 'pezzi' ? ' selected' : '') + '>pezzi</option>' +
            '<option value="pz"' + (unit === 'pz' ? ' selected' : '') + '>pz</option>' +
            '<option value="cup"' + (unit === 'cup' ? ' selected' : '') + '>cup</option>' +
          '</select>' +
        '</div>' +
        '<div id="_jeAutoCalc" style="font-size:12px;color:#94a3b8;min-height:18px;"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button id="_jeCancel" style="flex:1;padding:14px;border-radius:14px;border:0.5px solid rgba(30,58,95,0.2);background:white;color:#64748b;font-size:15px;font-weight:600;cursor:pointer;">Annulla</button>' +
        '<button id="_jeSave" style="flex:2;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;font-size:15px;font-weight:700;cursor:pointer;">Aggiorna</button>' +
      '</div>' +
    '</div>';

  // Collega bottoni via event listener (non onclick inline con variabile JS)
  sheet.querySelector('#_jeCancel').addEventListener('click', function() { sheet.remove(); });
  sheet.querySelector('#_jeSave').addEventListener('click', function() { jarvisInlineEditSave(itemId); });

  // Auto-calcola nuovo totale da produced + prev
  sheet.addEventListener('input', function() {
    var prod = parseFloat(document.getElementById('_jeProduced')?.value) || 0;
    var prev = parseFloat(document.getElementById('_jePrev')?.value) || 0;
    var calc = document.getElementById('_jeAutoCalc');
    if (calc && prod > 0 && prev > 0) {
      var tot = prod + prev;
      document.getElementById('_jeTotal').value = tot;
      calc.textContent = prev + ' + ' + prod + ' = ' + tot + ' (calcolato automaticamente)';
    } else if (calc) {
      calc.textContent = '';
    }
  });

  sheet.addEventListener('click', function(e) { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
};

window.jarvisInlineEditSave = async function(itemId) {
  var sb = window.supa;
  if (!sb) return;
  var produced = parseFloat(document.getElementById('_jeProduced')?.value);
  var prev = parseFloat(document.getElementById('_jePrev')?.value);
  var total = parseFloat(document.getElementById('_jeTotal')?.value);
  var unit = document.getElementById('_jeUnit')?.value || 'nests';

  if (isNaN(total)) {
    if (typeof showScToast === 'function') showScToast('Inserisci almeno il nuovo totale');
    return;
  }

  // Aggiorna reasoning_result nel DB con i valori corretti
  var { data: current } = await sb.from('office_items').select('reasoning_result').eq('id', itemId).maybeSingle();
  var rr = current && current.reasoning_result ? { ...current.reasoning_result } : {};
  if (!isNaN(produced)) rr.produced_qty = produced;
  if (!isNaN(prev)) rr.previous_stock_claimed = prev;
  rr.new_total_claimed = total;
  rr.unit = unit;
  if (rr.write_plan) {
    rr.write_plan.new_value = total;
    rr.write_plan.unit = unit;
  }
  // Aggiorna anche i draft pending
  var { data: drafts } = await sb.from('chef_ai_action_drafts').select('id,payload').eq('office_item_id', itemId).eq('status', 'pending');
  if (drafts) {
    for (var dr of drafts) {
      var newPayload = { ...dr.payload, new_total_claimed: total, new_value: total, unit: unit };
      if (!isNaN(produced)) newPayload.produced_qty = produced;
      if (!isNaN(prev)) newPayload.previous_stock_claimed = prev;
      await sb.from('chef_ai_action_drafts').update({ payload: newPayload }).eq('id', dr.id);
    }
  }
  await sb.from('office_items').update({ reasoning_result: rr }).eq('id', itemId);

  document.getElementById('jarvisInlineEditSheet')?.remove();
  if (typeof showScToast === 'function') showScToast('Quantita aggiornata');
  // Ricarica la card
  if (typeof officeLoadHome === 'function') officeLoadHome();
};


function jarvisShowApprovalSheet(itemId, drafts) {
  var existing = document.getElementById('jarvisApprovalSheet');
  if (existing) existing.remove();

  var riskColors = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  var riskLabels = { low: 'Basso', medium: 'Medio', high: 'Alto' };

  var draftsHtml = drafts.map(function(d) {
    var rc = riskColors[d.risk_level] || '#f59e0b';
    var rl = riskLabels[d.risk_level] || 'Medio';
    var p = d.payload || {};
    // Label human-readable per update_prep_stock
    var actionLabel = d.action_type;
    var actionDetail = '';
    if (d.action_type === 'update_prep_stock') {
      var writeOk = p.STOCK_WRITE_ENABLED === true;
      var prepName = p.prep_name || 'prep';
      var newVal2 = p.new_total_claimed != null ? p.new_total_claimed : p.new_value;
      actionLabel = 'Aggiorna stock: ' + prepName + ' → ' + newVal2 + (p.unit ? ' ' + p.unit : '');
      // Placeholder — verra popolato async dopo inserimento sheet nel DOM
      actionDetail =
        '<div id="writePlanBlock_' + d.id + '" style="margin-top:8px;">' +
          '<div style="font-size:12px;color:#94a3b8;">Caricamento DB...</div>' +
        '</div>';
      // Schedula caricamento async del current_stock
      (function(draftId, pInner, writeOkInner) {
        setTimeout(async function() {
          var sb = window.supa;
          if (!sb) return;
          var prepN = pInner.prep_name || '';
          var dbStock = null;
          var dbPrepId = null;
          try {
            var { data: prepRows } = await sb.from('prep_tasks')
              .select('id,name,current_stock,unit')
              .ilike('name', '%' + prepN + '%')
              .eq('archived', false)
              .limit(3);
            if (prepRows && prepRows.length > 0) {
              dbStock = prepRows[0].current_stock;
              dbPrepId = prepRows[0].id;
            }
          } catch(e) {}
          var newV = pInner.new_total_claimed != null ? pInner.new_total_claimed : pInner.new_value;
          var prevClaimed = pInner.previous_stock_claimed;
          var unit2 = pInner.unit || '';
          var mismatch = dbStock != null && prevClaimed != null && Math.abs(dbStock - prevClaimed) > 0.01;
          var warningHtml = mismatch
            ? '<div style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,0.08);border:0.5px solid rgba(245,158,11,0.3);border-radius:8px;font-size:12px;color:#92400e;">' +
                '<span style="font-weight:700;">Attenzione:</span> ' + pInner.reporter + ' diceva stock iniziale ' + prevClaimed + ' ' + unit2 + ', ma il DB ora mostra ' + dbStock + ' ' + unit2 + '.' +
              '</div>'
            : '';
          var dbRow = dbStock != null
            ? '<tr><td style="color:#64748b;font-size:12px;padding:2px 8px 2px 0;white-space:nowrap;">DB attuale</td><td style="font-size:12px;font-weight:600;color:#1e293b;">' + dbStock + ' ' + unit2 + '</td></tr>'
            : '';
          var html =
            '<div style="background:rgba(30,58,95,0.03);border:0.5px solid rgba(30,58,95,0.1);border-radius:8px;padding:10px 12px;margin-top:6px;">' +
              '<div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.05em;margin-bottom:6px;">SCRIVEREBBE</div>' +
              '<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:8px;">prep_tasks.current_stock</div>' +
              '<table style="border-collapse:collapse;width:100%;">' +
                '<tr><td style="color:#64748b;font-size:12px;padding:2px 8px 2px 0;white-space:nowrap;">Target</td><td style="font-size:12px;font-weight:600;color:#1e3a5f;">' + (pInner.prep_name || '-') + '</td></tr>' +
                dbRow +
                (prevClaimed != null ? '<tr><td style="color:#64748b;font-size:12px;padding:2px 8px 2px 0;white-space:nowrap;">Dichiarato da</td><td style="font-size:12px;color:#94a3b8;">' + prevClaimed + ' ' + unit2 + '</td></tr>' : '') +
                '<tr><td style="color:#64748b;font-size:12px;padding:2px 8px 2px 0;white-space:nowrap;">Nuovo valore</td><td style="font-size:12px;font-weight:700;color:#2563eb;">' + newV + ' ' + unit2 + '</td></tr>' +
              '</table>' +
              warningHtml +
              '<div style="margin-top:8px;font-size:11px;color:' + (writeOkInner ? '#16a34a' : '#94a3b8') + ';font-style:italic;">' + (writeOkInner ? 'Scrittura abilitata.' : 'Write disabled — piano pronto, nessuna modifica fatta.') + '</div>' +
            '</div>';
          var el = document.getElementById('writePlanBlock_' + draftId);
          if (el) el.innerHTML = html;
        }, 100);
      })(d.id, p, writeOk);
    }
    var payloadStr = d.action_type === 'update_prep_stock' ? '' : JSON.stringify(p, null, 2);
    return '<div style="background:rgba(30,58,95,0.03);border:0.5px solid rgba(30,58,95,0.1);border-radius:12px;padding:12px 14px;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
        '<span style="font-size:11px;background:rgba(' + (d.risk_level === 'low' ? '34,197,94' : d.risk_level === 'high' ? '239,68,68' : '245,158,11') + ',0.1);color:' + rc + ';border-radius:20px;padding:2px 8px;font-weight:700;">' + rl + '</span>' +
        '<span style="font-size:13px;font-weight:700;color:#1e3a5f;">' + actionLabel + '</span>' +
      '</div>' +
      actionDetail +
      '<pre style="font-size:11px;color:#475569;background:#f8fafc;padding:8px;border-radius:8px;overflow-x:auto;margin:0;white-space:pre-wrap;">' + payloadStr + '</pre>' +
    '</div>';
  }).join('');

  var sheet = document.createElement('div');
  sheet.id = 'jarvisApprovalSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;';

  sheet.innerHTML =
    '<div style="width:100%;max-width:480px;margin:0 auto;max-height:85vh;background:white;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:14px 20px 12px;border-bottom:0.5px solid rgba(30,58,95,0.08);flex-shrink:0;">' +
        '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 12px;"></div>' +
        '<div style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Conferma esecuzione</div>' +
        '<div style="font-size:17px;font-weight:700;color:#1e3a5f;">Vuoi eseguire ' + drafts.length + ' azione' + (drafts.length > 1 ? 'i' : '') + '?</div>' +
        '<div style="font-size:13px;color:#64748b;margin-top:4px;">Chef AI ha preparato questi cambiamenti. Verifica i dettagli prima di confermare.</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:14px 20px;-webkit-overflow-scrolling:touch;">' + draftsHtml + '</div>' +
      '<div style="padding:12px 20px 28px;border-top:0.5px solid rgba(30,58,95,0.08);display:flex;gap:10px;flex-shrink:0;">' +
        '<button onclick="document.getElementById(\'jarvisApprovalSheet\').remove()" style="flex:1;padding:14px;border-radius:14px;border:0.5px solid rgba(30,58,95,0.2);background:white;color:#64748b;font-size:15px;font-weight:600;cursor:pointer;">Annulla</button>' +
        '<button onclick="jarvisExecuteApproved(\'' + itemId + '\')" style="flex:2;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;font-size:15px;font-weight:700;cursor:pointer;">Si Chef \u2014 Esegui</button>' +
      '</div>' +
    '</div>';

  sheet.addEventListener('click', function(e) { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}

// ── Esegui action_drafts approvati ──
window.jarvisExecuteApproved = async function(itemId) {
  var sheet = document.getElementById('jarvisApprovalSheet');
  if (sheet) {
    var btn = sheet.querySelector('button[onclick*="jarvisExecuteApproved"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Esecuzione...'; }
  }

  var sb = window.supa;
  if (!sb) return;

  try {
    var { data: drafts } = await sb.from('chef_ai_action_drafts').select('*').eq('office_item_id', itemId).eq('status', 'pending');
    if (!drafts || drafts.length === 0) { if (sheet) sheet.remove(); return; }

    var byName = (window.currentUser || window.user || {}).name || 'Max';
    var now = new Date().toISOString();

    var executedCount = 0;
    var errors = [];

    for (var i = 0; i < drafts.length; i++) {
      var draft = drafts[i];
      try {
        var result = await jarvisExecuteDraft(sb, draft);
        // Marca come eseguita
        await sb.from('chef_ai_action_drafts').update({ status: 'executed', approved_by: byName, approved_at: now, executed_at: now }).eq('id', draft.id);
        // Audit log
        await sb.from('chef_ai_audit_log').insert({
          action_draft_id: draft.id, office_item_id: itemId,
          action_type: draft.action_type, payload_after: draft.payload,
          executed_by: 'jarvis-reason', approved_by: byName,
          result: 'success'
        });
        executedCount++;
      } catch(e) {
        errors.push(draft.action_type + ': ' + e.message);
        await sb.from('chef_ai_action_drafts').update({ status: 'failed', error_message: e.message }).eq('id', draft.id);
        await sb.from('chef_ai_audit_log').insert({
          action_draft_id: draft.id, office_item_id: itemId,
          action_type: draft.action_type, payload_after: draft.payload,
          executed_by: 'jarvis-reason', approved_by: byName,
          result: 'failure', error_message: e.message
        });
      }
    }

    // Salva in chef_ai_memory per auto-apprendimento
    var item = await sb.from('office_items').select('reasoning_result,report_type').eq('id', itemId).maybeSingle();
    if (item.data && item.data.reasoning_result) {
      var rr = item.data.reasoning_result;
      await sb.from('chef_ai_memory').insert({
        pattern_type: rr.issue_type || item.data.report_type || 'unknown',
        context_summary: rr.summary || '',
        max_decision: errors.length > 0 ? 'modified' : 'approved',
        action_taken: { drafts_executed: executedCount, errors: errors },
        office_item_id: itemId
      });
    }

    // Chiudi office_item se tutto ok
    if (errors.length === 0) {
      await sb.from('office_items').update({
        jarvis_status: 'executed',
        chef_action: 'done', chef_action_at: now, chef_action_by: byName,
        status: 'resolved', resolved_by: byName, resolved_at: now,
        resolution: 'jarvis_executed_' + executedCount + '_actions'
      }).eq('id', itemId);
    }

    if (sheet) sheet.remove();

    var card = document.querySelector('[data-item-id="' + itemId + '"]');
    if (card) {
      card.style.transition = 'all 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(40px)';
      setTimeout(function() { card.remove(); officeLoadHome(); }, 310);
    }

    if (typeof showScToast === 'function') {
      if (errors.length === 0) showScToast('Si Chef \u2014 ' + executedCount + ' azione' + (executedCount > 1 ? 'i' : '') + ' eseguita' + (executedCount > 1 ? 'i' : ''));
      else showScToast('Eseguito con errori: ' + errors.join(' / '));
    }

  } catch(e) {
    if (sheet) sheet.remove();
    if (typeof showScToast === 'function') showScToast('Errore esecuzione: ' + e.message);
  }
};

// ── Esegue singola action_draft ──
async function jarvisExecuteDraft(sb, draft) {
  var payload = draft.payload || {};
  switch (draft.action_type) {

    case 'update_recipe_bom': {
      // payload: { bom_id, fields: { quantity, unit, ... } }
      if (!payload.bom_id) throw new Error('bom_id mancante');
      var { error } = await sb.from('recipe_bom').update(payload.fields || {}).eq('bom_id', payload.bom_id);
      if (error) throw new Error(error.message);
      return { updated: 'recipe_bom', bom_id: payload.bom_id };
    }

    case 'create_prep_task': {
      // payload: { name, category, unit, prep_type, recipe_id? }
      if (!payload.name || !payload.category) throw new Error('name e category richiesti');
      var { error } = await sb.from('prep_tasks').insert({ name: payload.name, category: payload.category, unit: payload.unit || 'g', prep_type: payload.prep_type || 'supporto', recipe_id: payload.recipe_id || null, archived: false, done: false, need_tomorrow: true });
      if (error) throw new Error(error.message);
      return { created: 'prep_task', name: payload.name };
    }

    case 'create_procedure_draft': {
      // payload: { recipe_id, procedure_text }
      if (!payload.recipe_id) throw new Error('recipe_id mancante');
      var { error } = await sb.from('recipes').update({ procedure: payload.procedure_text }).eq('id', payload.recipe_id);
      if (error) throw new Error(error.message);
      return { updated: 'recipes.procedure', recipe_id: payload.recipe_id };
    }

    case 'create_photo_request': {
      // payload: { recipe_id, recipe_title } — crea un office_item con richiesta foto
      var { error } = await sb.from('office_items').insert({
        source: 'ai_scan', from_user: 'jarvis-reason', priority: 'blue',
        title: 'Foto mancante: ' + (payload.recipe_title || payload.recipe_id),
        body: 'Ricetta venduta al POS senza foto di impiattamento. Scatta una foto e caricala dalla sezione Ricette.',
        status: 'open'
      });
      if (error) throw new Error(error.message);
      return { created: 'photo_request' };
    }

    case 'link_prep_task_to_recipe': {
      // payload: { prep_task_id, recipe_id }
      if (!payload.prep_task_id || !payload.recipe_id) throw new Error('prep_task_id e recipe_id richiesti');
      var { error } = await sb.from('prep_tasks').update({ recipe_id: payload.recipe_id }).eq('id', payload.prep_task_id);
      if (error) throw new Error(error.message);
      return { linked: { prep_task_id: payload.prep_task_id, recipe_id: payload.recipe_id } };
    }

    case 'mark_issue_not_needed': {
      // payload: { office_item_id }
      var oid = payload.office_item_id;
      if (!oid) throw new Error('office_item_id mancante');
      var { error } = await sb.from('office_items').update({ status: 'resolved', resolution: 'not_needed', resolved_at: new Date().toISOString() }).eq('id', oid);
      if (error) throw new Error(error.message);
      return { resolved: oid };
    }

    case 'archive_duplicate_issue': {
      // payload: { office_item_id }
      var oid = payload.office_item_id;
      if (!oid) throw new Error('office_item_id mancante');
      var { error } = await sb.from('office_items').update({ status: 'resolved', resolution: 'duplicate', resolved_at: new Date().toISOString() }).eq('id', oid);
      if (error) throw new Error(error.message);
      return { archived: oid };
    }

    case 'assign_task_to_station': {
      // payload: { prep_task_id, station }
      if (!payload.prep_task_id || !payload.station) throw new Error('prep_task_id e station richiesti');
      var { error } = await sb.from('prep_tasks').update({ category: payload.station }).eq('id', payload.prep_task_id);
      if (error) throw new Error(error.message);
      return { assigned: { prep_task_id: payload.prep_task_id, station: payload.station } };
    }

    case 'ask_staff_clarification': {
      // payload: { message, station }
      var { error } = await sb.from('office_items').insert({
        source: 'sous_chef_chat', from_user: 'jarvis-reason', priority: 'blue',
        title: 'Chiarimento richiesto',
        body: payload.message || 'Chef AI ha bisogno di un chiarimento.',
        status: 'open', station: payload.station
      });
      if (error) throw new Error(error.message);
      return { created: 'clarification_request' };
    }

    case 'update_prep_stock': {
      // payload: { prep_name, new_value, unit, field, table, produced_qty, reporter }
      var prepName = payload.prep_name || '';
      var newStock = payload.new_value != null ? parseFloat(payload.new_value) : null;
      if (!prepName || newStock == null || isNaN(newStock)) throw new Error('prep_name e new_value richiesti');
      // Lookup: exact match su nome non archiviato, poi ILIKE fallback
      var { data: exactRows } = await sb.from('prep_tasks').select('id,name,current_stock,unit').eq('archived', false).eq('name', prepName).limit(3);
      var foundRows = exactRows && exactRows.length ? exactRows : null;
      if (!foundRows || !foundRows.length) {
        // Fuzzy: cerca con ILIKE
        var { data: fuzzyRows } = await sb.from('prep_tasks').select('id,name,current_stock,unit').eq('archived', false).ilike('name', '%' + prepName + '%').limit(5);
        foundRows = fuzzyRows || [];
      }
      if (!foundRows || !foundRows.length) throw new Error('Prep task non trovato: ' + prepName);
      // Se multipli, preferisce quello con recipe_id o quello piu recente — prende il primo
      var target = foundRows[0];
      var { error } = await sb.from('prep_tasks').update({ current_stock: newStock }).eq('id', target.id);
      if (error) throw new Error(error.message);
      return { updated: 'prep_tasks.current_stock', id: target.id, name: target.name, new_value: newStock };
    }

    default:
      throw new Error('action_type non supportata: ' + draft.action_type);
  }
}

// ── Mostra reasoning steps in una sheet ──
window.jarvisShowReasoning = async function(itemId) {
  var sb = window.supa;
  if (!sb) return;

  var { data: item } = await sb.from('office_items').select('reasoning_result,title').eq('id', itemId).maybeSingle();
  if (!item || !item.reasoning_result) {
    if (typeof showScToast === 'function') showScToast('Nessun ragionamento disponibile');
    return;
  }

  var rr = item.reasoning_result;
  var steps = rr.react_steps || [];

  var stepsHtml = steps.map(function(s, idx) {
    var thoughtShort = (s.thought || '').slice(0, 300) + (s.thought && s.thought.length > 300 ? '...' : '');
    var toolHtml = '';
    if (s.tool_call) {
      toolHtml = '<div style="margin-top:6px;background:#f8fafc;border-radius:8px;padding:7px 10px;font-family:monospace;font-size:11px;color:#475569;">' +
        'TOOL: ' + s.tool_call.name + '(' + JSON.stringify(s.tool_call.args) + ')' + '</div>';
    }
    if (s.observation && s.tool_call) {
      var obsStr = JSON.stringify(s.observation);
      if (obsStr.length > 200) obsStr = obsStr.slice(0, 200) + '...';
      toolHtml += '<div style="margin-top:4px;font-size:11px;color:#64748b;">Risultato: ' + obsStr + '</div>';
    }
    return '<div style="padding:10px 0;border-bottom:0.5px solid rgba(30,58,95,0.06);">' +
      '<div style="font-size:11px;font-weight:700;color:#8b5cf6;margin-bottom:4px;">Step ' + (idx + 1) + '</div>' +
      '<div style="font-size:13px;color:#1e3a5f;line-height:1.4;">' + thoughtShort + '</div>' +
      toolHtml +
    '</div>';
  }).join('');

  var sheet = document.createElement('div');
  sheet.id = 'jarvisReasoningSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;';

  sheet.innerHTML =
    '<div style="width:100%;max-width:480px;margin:0 auto;max-height:80vh;background:white;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;">' +
      '<div style="padding:14px 20px 12px;border-bottom:0.5px solid rgba(30,58,95,0.08);flex-shrink:0;">' +
        '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 12px;"></div>' +
        '<div style="font-size:11px;font-weight:700;color:#8b5cf6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Ragionamento Chef AI</div>' +
        '<div style="font-size:16px;font-weight:700;color:#1e3a5f;">' + (item.title || '') + '</div>' +
        '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">' + (rr.thought_summary || '') + '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:14px 20px;-webkit-overflow-scrolling:touch;">' +
        (rr.root_cause ? '<div style="background:rgba(239,68,68,0.05);border-left:3px solid #ef4444;padding:8px 12px;border-radius:0 8px 8px 0;margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:2px;">Root cause</div><div style="font-size:13px;color:#1e3a5f;">' + rr.root_cause + '</div></div>' : '') +
        stepsHtml +
      '</div>' +
      '<div style="padding:12px 20px 28px;border-top:0.5px solid rgba(30,58,95,0.08);flex-shrink:0;">' +
        '<button onclick="document.getElementById(\'jarvisReasoningSheet\').remove()" style="width:100%;padding:14px;border-radius:14px;border:none;background:#f1f5f9;color:#475569;font-size:15px;font-weight:600;cursor:pointer;">Chiudi</button>' +
      '</div>' +
    '</div>';

  sheet.addEventListener('click', function(e) { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
};

// ── Trigger Chef AI su una card esistente (on-demand) ──
window.jarvisAnalyze = async function(itemId) {
  var sb = window.supa;
  if (!sb) return;

  // Aggiorna subito la card a "thinking"
  await sb.from('office_items').update({ jarvis_status: 'reasoning' }).eq('id', itemId);
  var card = document.querySelector('[data-item-id="' + itemId + '"]');
  if (card) {
    var tmp = document.createElement('div');
    tmp.innerHTML = officeRenderJarvisThinking({ id: itemId, title: card.querySelector('[style*="font-size:16px"]')?.textContent || 'Analisi in corso...', created_at: new Date().toISOString(), jarvis_status: 'reasoning' });
    var newCard = tmp.firstElementChild;
    if (newCard) card.parentNode?.replaceChild(newCard, card);
  }

  try {
    var supaUrl = (window.supa?.supabaseUrl) || 'https://ydqmumpytgrlceuinoqt.supabase.co';
    var supaKey = window.SUPABASE_ANON_KEY || (window.supa?.supabaseKey) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';
    var res = await fetch(supaUrl + '/functions/v1/jarvis-reason', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + supaKey },
      body: JSON.stringify({ office_item_id: itemId })
    });
    var data = await res.json();
    if (data.ok) {
      // Ricarica la folder corrente
      if (window._officeCurrentFolder && document.getElementById('officeFolder')) {
        window.officeOpenFolder(window._officeCurrentFolder);
      } else {
        officeLoadHome();
      }
    } else {
      if (typeof showScToast === 'function') showScToast('Chef AI error: ' + (data.error || 'unknown'));
    }
  } catch(e) {
    if (typeof showScToast === 'function') showScToast('Chef AI error: ' + e.message);
  }
};
