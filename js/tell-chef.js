// ── TELL CHEF v2 ── fix: user_name da window.user
// Canale unidirezionale: cuoco → chef_reports DB → visibile solo a Max + Sous Chef
// Nessun user puo leggere i report altrui

// ── OPEN MODAL (user) — design chat, colori app ──
function openTellChef() {
  var existing = document.getElementById('tellChefModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'tellChefModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(15,23,42,0.5);display:flex;align-items:flex-end;justify-content:center;';

  var sheet = document.createElement('div');
  sheet.id = 'tellChefSheet';
  // Colori in linea con la home: sfondo #f0f4f8, card bianche, navy #1e3a5f, blue #3b82f6
  sheet.style.cssText = 'width:100%;max-width:448px;background:#f0f4f8;border-radius:24px 24px 0 0;box-shadow:0 -8px 40px rgba(30,58,95,0.15);display:flex;flex-direction:column;height:72vh;';

  // HEADER — celeste/navy stile topbar app
  var header = document.createElement('div');
  header.style.cssText = 'flex-shrink:0;padding:14px 16px 12px;background:linear-gradient(135deg,#1e3a5f,#2563eb);border-radius:24px 24px 0 0;display:flex;align-items:center;gap:10px;';
  header.innerHTML =
    '<div style="width:38px;height:38px;background:rgba(255,255,255,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;">📢</div>' +
    '<div style="flex:1;">' +
      '<div style="font-size:15px;font-weight:800;color:#fff;">Tell Chef</div>' +
      '<div id="tcSubtitle" style="font-size:11px;color:#93c5fd;margin-top:1px;"></div>' +
    '</div>' +
    '<button onclick="closeTellChef()" style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>';

  // MESSAGGI scrollabili
  var hist = document.createElement('div');
  hist.id = 'tellChefHistory';
  hist.style.cssText = 'flex:1;overflow-y:auto;padding:14px 14px 8px;display:flex;flex-direction:column;gap:8px;';

  // AREA INPUT fissa in fondo — sfondo bianco, bordi leggeri
  var inputArea = document.createElement('div');
  inputArea.style.cssText = 'flex-shrink:0;padding:10px 12px 28px;background:#fff;border-top:1px solid #e2e8f0;border-radius:0;';
  inputArea.innerHTML =
    '<div id="tcTip" style="font-size:11px;color:#60a5fa;margin-bottom:8px;"></div>' +
    '<div style="display:flex;gap:8px;align-items:flex-end;">' +
      '<textarea id="tellChefText" ' +
        'style="flex:1;min-height:44px;max-height:100px;border:2px solid #e2e8f0;border-radius:14px;padding:10px 12px;font-size:15px;font-family:inherit;resize:none;outline:none;color:#1e3a5f;line-height:1.4;background:#f8fafc;" ' +
        'onfocus="this.style.borderColor=\'#3b82f6\'" onblur="this.style.borderColor=\'#e2e8f0\'" ' +
        'oninput="this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight,100)+\'px\';"></textarea>' +
      '<button onclick="tellChefSend()" id="tellChefSendBtn" ' +
        'style="flex-shrink:0;width:48px;height:48px;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;border:none;border-radius:14px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(30,58,95,0.3);">→</button>' +
    '</div>' +
    '<div id="tellChefStatus" style="margin-top:6px;text-align:center;font-size:12px;color:#60a5fa;min-height:16px;"></div>';

  sheet.appendChild(header);
  sheet.appendChild(hist);
  sheet.appendChild(inputArea);
  modal.appendChild(sheet);

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeTellChef(); });

  // Applica traduzioni dopo mount
  setTimeout(function() {
    var sub = document.getElementById('tcSubtitle');
    var tip = document.getElementById('tcTip');
    var ta  = document.getElementById('tellChefText');
    if (sub) sub.textContent = tr('tcOnlyMax');
    if (tip) tip.textContent = tr('tcTipMic');
    if (ta)  { ta.placeholder = tr('tcWriteNote'); ta.focus(); }
  }, 50);

  loadTellChefHistory();

  // ── KEYBOARD FIX per Android (Visual Viewport API) ──
  var _tcVPHandler = function() {
    var s = document.getElementById('tellChefSheet');
    if (!s) { window.visualViewport && window.visualViewport.removeEventListener('resize', _tcVPHandler); return; }
    var vvH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    s.style.height = Math.min(vvH - 8, window.innerHeight * 0.92) + 'px';
    var h = document.getElementById('tellChefHistory');
    if (h) h.scrollTop = h.scrollHeight;
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', _tcVPHandler);
    var _tcObs = new MutationObserver(function() {
      if (!document.getElementById('tellChefModal')) {
        window.visualViewport.removeEventListener('resize', _tcVPHandler);
        _tcObs.disconnect();
      }
    });
    _tcObs.observe(document.body, { childList: true });
  }
}
// ── TELL CHEF HISTORY (user) — bolle chat ──
async function loadTellChefHistory() {
  var el = document.getElementById('tellChefHistory');
  if (!el) return;
  var u = window.user || {};
  if (!u.name) return;
  try {
    var res = await window.supa.from('chef_reports')
      .select('message,created_at,status')
      .eq('user_name', u.name)
      .order('created_at', { ascending: true })
      .limit(30);
    var rows = res.data || [];

    // Deduplica
    var seen = {};
    rows = rows.filter(function(r) {
      var key = r.message + '|' + r.created_at;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    if (!rows.length) {
      el.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px 0;">' + tr('tcNoMsg') + '</div>';
      return;
    }

    el.innerHTML = rows.map(function(r) {
      var d = new Date(r.created_at);
      var timeStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'}) + ' ' +
        d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/Chicago'});
      var statusIcon = r.status === 'done' ? ' ✅' : r.status === 'in_progress' ? ' 🔄' : r.status === 'ignored' ? ' —' : '';
      return '<div style="display:flex;justify-content:flex-end;">' +
        '<div style="max-width:82%;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;border-radius:18px 18px 4px 18px;padding:10px 14px;">' +
          '<div style="font-size:14px;line-height:1.45;">' + r.message + '</div>' +
          '<div style="font-size:10px;color:#94a3b8;margin-top:5px;text-align:right;">' + timeStr + statusIcon + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Scrolla in fondo
    el.scrollTop = el.scrollHeight;
  } catch(e) {}
}
function closeTellChef() {
  var m = document.getElementById('tellChefModal');
  if (m) m.remove();
  tellChefStopVoice();
}

// ── SEND ──
var _tcSending = false; // guard anti-doppio invio
async function tellChefSend() {
  if (_tcSending) return; // blocca doppio tap
  var text = (document.getElementById('tellChefText') || {}).value || '';
  text = text.trim();
  if (!text) {
    tellChefSetStatus('Write something first!', '#ef4444');
    return;
  }

  _tcSending = true;
  var btn = document.getElementById('tellChefSendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    var user = window.user || {};
    var payload = {
      user_name: user.name || 'Unknown',
      station: user.default_station || user.station || null,
      message: text,
      status: 'new'
    };

    var res = await window.supa.from('chef_reports').insert([payload]).select().single();
    if (res.error) throw res.error;

    // Scrivi in office_items per L'Ufficio
    if (typeof officeWriteItem === 'function') {
      var reportId = res.data ? res.data.id : null;
      var userName = user.name || 'Unknown';
      var stationLabel = payload.station ? payload.station.replace(' Station','') : '';
      var titleLabel = userName + (stationLabel ? ' (' + stationLabel + ')' : '') + ': ' + text.slice(0, 80) + (text.length > 80 ? '...' : '');
      officeWriteItem('tell_chef', reportId, userName, titleLabel, text);
    }

    // Success — aggiungi bolla in chat e resetta input (non chiudere il modal)
    var textEl = document.getElementById('tellChefText');
    if (textEl) { textEl.value = ''; textEl.style.height = 'auto'; }
    var btn2 = document.getElementById('tellChefSendBtn');
    if (btn2) { btn2.disabled = false; btn2.textContent = '→'; }
    tellChefSetStatus(tr('tcSent'), '#22c55e');
    setTimeout(function(){ tellChefSetStatus('', '#94a3b8'); }, 3000);
    // Ricarica la history per mostrare il nuovo messaggio
    await loadTellChefHistory();
    _tcSending = false;

  } catch(e) {
    _tcSending = false;
    if (btn) { btn.disabled = false; btn.textContent = '→'; }
    tellChefSetStatus('Error sending. Try again.', '#ef4444');
  }
}

function tellChefSetStatus(msg, color) {
  var el = document.getElementById('tellChefStatus');
  if (el) { el.textContent = msg; el.style.color = color || '#94a3b8'; }
}

// Voice: usa la dettatura nativa iOS dalla tastiera (microfono sulla tastiera)

// ── ADMIN INBOX ──
async function openTellChefAdmin() {
  if (typeof hideAdminMenu === 'function') hideAdminMenu();

  var existing = document.getElementById('tellChefAdminModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'tellChefAdminModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(15,23,42,0.6);display:flex;align-items:stretch;';

  modal.innerHTML =
    '<div style="width:100%;max-width:448px;margin:0 auto;background:#f8fafc;display:flex;flex-direction:column;">' +
      '<div style="background:#1a202c;padding:16px;display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
        '<button onclick="document.getElementById(\'tellChefAdminModal\').remove()" style="color:#64748b;background:none;border:none;font-size:22px;cursor:pointer;padding:4px;">←</button>' +
        '<div style="font-size:16px;font-weight:800;color:#fff;flex:1;">Tell Chef</div>' +
        '<div id="tcNewBadge" style="background:#f59e0b;color:#fff;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:800;display:none;"></div>' +
      '</div>' +
      '<div id="tcAdminList" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;">' +
        '<div style="text-align:center;color:#94a3b8;padding:40px;font-size:14px;">Loading...</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) modal.remove();
  });

  await tcAdminLoad();
}

async function tcAdminLoad() {
  var list = document.getElementById('tcAdminList');
  if (!list) return;

  try {
    var res = await window.supa.from('chef_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    var reports = res.data || [];

    // Mark new ones as read
    var newIds = reports.filter(function(r) { return r.status === 'new'; }).map(function(r) { return r.id; });
    if (newIds.length) {
      await window.supa.from('chef_reports').update({ status: 'read' }).in('id', newIds);
    }

    var badge = document.getElementById('tcNewBadge');
    if (badge && newIds.length) {
      badge.style.display = 'block';
      badge.textContent = newIds.length + ' ' + tr('tc_new');
    }

    if (!reports.length) {
      list.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px;font-size:14px;">' + tr('tc_no_reports') + '</div>';
      return;
    }

    list.innerHTML = reports.map(function(r) {
      var d = new Date(r.created_at);
      var timeStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' ' +
        d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'America/Chicago' });
      var statusColor = r.status==='done' ? '#22c55e' : r.status==='in_progress' ? '#f59e0b' : r.status==='ignored' ? '#94a3b8' : '#3b82f6';
      var statusLabel = r.status==='in_progress' ? tr('tc_in_progress') : r.status==='done' ? tr('tc_done') : r.status==='ignored' ? tr('tc_ignore') : r.status.charAt(0).toUpperCase()+r.status.slice(1);
      var station = r.station ? r.station.replace(' Station','') : '';

      return '<div style="background:#fff;border-radius:14px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<div style="font-size:13px;font-weight:800;color:#1a202c;">' + (r.user_name||'?') + '</div>' +
          (station ? '<div style="font-size:10px;color:#94a3b8;background:#f1f5f9;padding:2px 7px;border-radius:20px;font-weight:700;">' + station + '</div>' : '') +
          '<div style="flex:1;"></div>' +
          '<div style="font-size:10px;color:#94a3b8;">' + timeStr + '</div>' +
        '</div>' +
        '<div style="font-size:14px;color:#2d3748;line-height:1.5;margin-bottom:10px;">' + (r.message||'') + '</div>' +
        (r.souschef_suggestion ? '<div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:8px 10px;border-radius:0 8px 8px 0;font-size:12px;color:#3b82f6;margin-bottom:10px;">🤖 ' + r.souschef_suggestion + '</div>' : '') +
        '<div style="display:flex;gap:6px;">' +
          '<button onclick="tcSetStatus(\'' + r.id + '\',\'in_progress\',this)" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;font-weight:700;color:#f59e0b;background:#fff;cursor:pointer;">' + tr('tc_working') + '</button>' +
          '<button onclick="tcSetStatus(\'' + r.id + '\',\'done\',this)" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;font-weight:700;color:#22c55e;background:#fff;cursor:pointer;">' + tr('tc_done') + '</button>' +
          '<button onclick="tcSetStatus(\'' + r.id + '\',\'ignored\',this)" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;font-weight:700;color:#94a3b8;background:#fff;cursor:pointer;">' + tr('tc_ignore') + '</button>' +
        '</div>' +
        '<div style="margin-top:6px;text-align:right;">' +
          '<span style="font-size:10px;font-weight:800;color:' + statusColor + ';">● ' + statusLabel + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

  } catch(e) {
    list.innerHTML = '<div style="text-align:center;color:#ef4444;padding:40px;font-size:14px;">' + tr('tc_error_reports') + '</div>';
  }
}

async function tcSetStatus(id, status, btn) {
  try {
    await window.supa.from('chef_reports').update({ status: status }).eq('id', id);
    await tcAdminLoad();
  } catch(e) {}
}





