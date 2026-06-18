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

// ── APRI L'UFFICIO ──
window.openOffice = function() {
  if (typeof hideAdminMenu === 'function') hideAdminMenu();

  var existing = document.getElementById('officeModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'officeModal';
  // Overlay scuro dietro
  var overlay = document.createElement('div');
  overlay.id = 'officeOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.5);';
  overlay.onclick = function() { officeStopRealtime(); overlay.remove(); modal.remove(); };
  document.body.appendChild(overlay);

  modal.style.cssText = [
    'position:fixed;top:0;bottom:0;z-index:300;',
    'background:linear-gradient(160deg,#eff6ff 0%,#dbeafe 60%,#e0f2fe 100%);',
    'display:flex;flex-direction:column;',
    'font-family:Inter,system-ui,sans-serif;',
    'width:100%;max-width:480px;',
    'left:50%;transform:translateX(-50%);',
  ].join('');

  modal.innerHTML =
    '<div style="background:rgba(255,255,255,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:0.5px solid rgba(59,130,246,0.12);box-shadow:0 2px 8px rgba(30,58,95,0.06);padding:14px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
      '<button onclick="officeStopRealtime();document.getElementById(\'officeOverlay\')?.remove();document.getElementById(\'officeModal\').remove()" style="color:#60a5fa;background:none;border:none;font-size:22px;cursor:pointer;padding:4px;line-height:1;">&#8592;</button>' +
      '<div style="font-size:16px;font-weight:600;color:#1e3a5f;flex:1;">L\'Ufficio</div>' +
      '<div id="officeBadge" style="display:none;background:#ef4444;color:white;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;"></div>' +
    '</div>' +
    '<div id="officeSmartFocus" style="display:none;background:white;border:0.5px solid rgba(59,130,246,0.1);border-radius:16px;margin:10px 12px 0;overflow:hidden;box-shadow:0 2px 8px rgba(30,58,95,0.07);"></div>' +
    '<div id="officeList" style="flex:1;overflow-y:auto;padding:0 0 24px;-webkit-overflow-scrolling:touch;">' +
      '<div style="text-align:center;padding:60px 20px;font-size:14px;color:#94a3b8;">Caricamento...</div>' +
    '</div>';

  document.body.appendChild(modal);
  officeRenderSmartFocus();
  officeLoad();
  officeStartRealtime();
};

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
    if (typeof showScToast === 'function') showScToast('❌ Errore analisi');
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
  _officeRealtimeSub = sb.channel('office-items-changes')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'office_items',
    }, function() {
      officeLoad();
      officeBadgeUpdate();
    })
    .subscribe();
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
        '<div style="font-size:15px;font-weight:600;color:#1e3a5f;margin-bottom:6px;">Tutto a posto, Chef</div>' +
        '<div style="font-size:13px;color:#94a3b8;">Nessuna decisione in sospeso.</div>' +
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
      '<div style="margin:0 14px 8px;padding:8px 11px;background:rgba(59,130,246,0.04);border:0.5px solid rgba(59,130,246,0.15);border-radius:10px;border-left:2px solid #3b82f6;">' +
        '<div style="font-size:11px;color:#3b82f6;font-weight:700;letter-spacing:.04em;margin-bottom:4px;">Chef AI</div>' +
        '<div style="font-size:17px;color:#1e3a5f;line-height:1.5;">' + item.ai_analysis + '</div>' +
      '</div>';
  }

  var actionsHtml = '';
  if (options.length > 0) {
    actionsHtml = '<div style="display:flex;gap:7px;padding:0 14px 12px;">';
    options.forEach(function(opt, idx) {
      var isPrimary = idx === options.length - 1;
      actionsHtml +=
        '<button onclick="officeResolve(\'' + item.id + '\',\'' + escOpt(opt.label) + '\')" ' +
        'style="flex:1;padding:8px 0;border-radius:10px;font-size:17px;font-weight:600;cursor:pointer;border:0.5px solid ' +
        (isPrimary ? '#1e3a5f;background:#1e3a5f;color:white;' : 'rgba(59,130,246,0.2);background:rgba(59,130,246,0.04);color:#1e3a5f;') +
        '">' + opt.label + '</button>';
    });
    actionsHtml += '</div>';
  } else {
    // Nessuna opzione AI — mostra solo "Visto" e "Ignora"
    actionsHtml =
      '<div style="display:flex;gap:7px;padding:0 14px 12px;">' +
        '<button onclick="officeResolve(\'' + item.id + '\',\'letto\')" ' +
          'style="flex:1;padding:11px 0;border-radius:10px;font-size:17px;font-weight:600;cursor:pointer;border:0.5px solid rgba(59,130,246,0.2);background:rgba(59,130,246,0.04);color:#1e3a5f;">Letto</button>' +
        '<button onclick="officeResolve(\'' + item.id + '\',\'risolto\')" ' +
          'style="flex:1;padding:11px 0;border-radius:10px;font-size:17px;font-weight:600;cursor:pointer;border:0.5px solid #1e3a5f;background:#1e3a5f;color:white;">Risolto</button>' +
      '</div>';
  }

  return '<div style="background:white;border:0.5px solid rgba(59,130,246,0.1);border-left:' + borderLeft + ';border-radius:16px;margin:0 12px 8px;overflow:hidden;box-shadow:0 2px 8px rgba(30,58,95,0.07),0 6px 16px rgba(30,58,95,0.04);">' +
    '<div style="display:flex;align-items:flex-start;gap:8px;padding:11px 14px 6px;">' +
      '<div style="width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;margin-top:4px;"></div>' +
      '<div style="font-size:20px;font-weight:700;color:#1e3a5f;flex:1;line-height:1.3;">' + (item.title || '') + '</div>' +
      '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(59,130,246,0.07);color:#60a5fa;font-weight:600;white-space:nowrap;flex-shrink:0;">' + sourceLabel + '</span>' +
    '</div>' +
    (item.body ? '<div style="font-size:17px;color:#475569;padding:0 14px 12px;line-height:1.5;">' + item.body + '</div>' : '') +
    aiBlock +
    actionsHtml +
    '<div style="padding:0 14px 10px;font-size:12px;color:#94a3b8;font-weight:500;">' + (item.from_user && item.from_user !== 'system' ? item.from_user + ' · ' : '') + ts + '</div>' +
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

    // Rimuovi la card con animazione
    var cards = document.querySelectorAll('#officeList [style*="border-left"]');
    // Ricarica la lista
    officeLoad();

    if (typeof showScToast === 'function') showScToast('✓ ' + (isLetto ? 'Letto — ci torni dopo' : 'Risolto ✓'));
  } catch(e) {
    if (typeof showScToast === 'function') showScToast('❌ Errore: ' + e.message);
  }
};

// ── BADGE NEI TRE PUNTINI — mostra numero items aperti ──
window.officeBadgeUpdate = async function() {
  var sb = window.supa;
  if (!sb) return;
  try {
    var res = await sb.from('office_items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');
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
