// ── TELL CHEF v2 ── fix: user_name da window.user
// Canale unidirezionale: cuoco → chef_reports DB → visibile solo a Max + Sous Chef
// Nessun user puo leggere i report altrui

// ── OPEN MODAL (user) ──
function openTellChef() {
  var existing = document.getElementById('tellChefModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'tellChefModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(15,23,42,0.6);display:flex;align-items:flex-end;justify-content:center;';

  modal.innerHTML =
    '<div id="tellChefSheet" style="width:100%;max-width:448px;background:#fff;border-radius:24px 24px 0 0;padding:20px 16px 40px;box-shadow:0 -8px 40px rgba(0,0,0,0.2);">' +
      '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">' +
        '<div style="width:40px;height:40px;background:#fef3c7;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;">📢</div>' +
        '<div>' +
          '<div style="font-size:16px;font-weight:800;color:#1a202c;">Tell Chef</div>' +
          '<div style="font-size:12px;color:#94a3b8;">Only Chef Max will see this</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">💡 Tip: use the mic on your keyboard to dictate</div>' +
      '<textarea id="tellChefText" placeholder="Write your note, suggestion or report..." ' +
        'style="width:100%;min-height:120px;border:2px solid #e2e8f0;border-radius:14px;padding:12px 14px;font-size:15px;font-family:inherit;resize:none;outline:none;color:#1a202c;line-height:1.5;" ' +
        'onfocus="this.style.borderColor=\'#f59e0b\'" onblur="this.style.borderColor=\'#e2e8f0\'"></textarea>' +
      '<div style="display:flex;gap:10px;margin-top:12px;">' +
        '<button onclick="tellChefSend()" ' +
          'style="flex:1;height:48px;background:#1a202c;color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:800;cursor:pointer;letter-spacing:0.02em;">Send to Chef →</button>' +
        '<button onclick="closeTellChef()" ' +
          'style="flex:0 0 48px;height:48px;border:2px solid #e2e8f0;border-radius:14px;background:#f8fafc;font-size:20px;cursor:pointer;">✕</button>' +
      '</div>' +
      '<div id="tellChefStatus" style="margin-top:10px;text-align:center;font-size:13px;color:#94a3b8;min-height:20px;"></div>' +
      '<div id="tellChefHistory" style="margin-top:16px;"></div>' +
    '</div>';

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeTellChef(); });
  setTimeout(function() { var t = document.getElementById('tellChefText'); if (t) { t.focus(); t.click(); } }, 300);
  loadTellChefHistory();
}


// ── TELL CHEF HISTORY (user) ──
async function loadTellChefHistory() {
  var el = document.getElementById('tellChefHistory');
  if (!el) return;
  var u = window.user || {};
  if (!u.name) return;
  try {
    var res = await window.supa.from('chef_reports')
      .select('message,created_at')
      .eq('user_name', u.name)
      .order('created_at', { ascending: false })
      .limit(20);
    var rows = res.data || [];
    if (!rows.length) return;
    el.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.06em;margin-bottom:8px;">YOUR PREVIOUS MESSAGES</div>' +
      rows.map(function(r) {
        var d = new Date(r.created_at);
        var dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'});
        return '<div style="padding:10px 12px;background:#f8fafc;border-radius:10px;margin-bottom:6px;">' +
          '<div style="font-size:10px;color:#94a3b8;margin-bottom:3px;">' + dateStr + '</div>' +
          '<div style="font-size:13px;color:#475569;line-height:1.4;">' + r.message + '</div>' +
          '</div>';
      }).join('');
  } catch(e) {}
}

function closeTellChef() {
  var m = document.getElementById('tellChefModal');
  if (m) m.remove();
  tellChefStopVoice();
}

// ── SEND ──
async function tellChefSend() {
  var text = (document.getElementById('tellChefText') || {}).value || '';
  text = text.trim();
  if (!text) {
    tellChefSetStatus('Write something first!', '#ef4444');
    return;
  }

  var btn = document.querySelector('#tellChefSheet button[onclick="tellChefSend()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  try {
    var user = window.user || {};
    var payload = {
      user_name: (window.user || user || {}).name || 'Unknown',
      station: (window.user || user || {}).default_station || (window.user || user || {}).station || null,
      message: text,
      status: 'new'
    };

    var res = await window.supa.from('chef_reports').insert([payload]).select().single();
    if (res.error) throw res.error;

    // Scrivi in office_items per L'Ufficio
    if (typeof officeWriteItem === 'function') {
      var reportId = res.data ? res.data.id : null;
      var stationLabel = payload.station ? payload.station.replace(' Station','') : '';
      var titleLabel = (payload.user_name || 'Staff') + (stationLabel ? ' (' + stationLabel + ')' : '') + ': ' + text.slice(0, 80) + (text.length > 80 ? '...' : '');
      officeWriteItem('tell_chef', reportId, payload.user_name, titleLabel, text);
    }

    // Success
    var sheet = document.getElementById('tellChefSheet');
    if (sheet) {
      sheet.innerHTML =
        '<div style="text-align:center;padding:40px 20px;">' +
          '<div style="font-size:48px;margin-bottom:12px;">✅</div>' +
          '<div style="font-size:18px;font-weight:800;color:#1a202c;margin-bottom:6px;">Sent to Chef</div>' +
          '<div style="font-size:13px;color:#94a3b8;">Chef Max will see your message</div>' +
        '</div>';
    }
    setTimeout(closeTellChef, 2000);

  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send to Chef →'; }
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
      badge.textContent = newIds.length + ' new';
    }

    if (!reports.length) {
      list.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px;font-size:14px;">No reports yet 📭</div>';
      return;
    }

    list.innerHTML = reports.map(function(r) {
      var d = new Date(r.created_at);
      var timeStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' ' +
        d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true, timeZone:'America/Chicago' });
      var statusColor = r.status==='done' ? '#22c55e' : r.status==='in_progress' ? '#f59e0b' : r.status==='ignored' ? '#94a3b8' : '#3b82f6';
      var statusLabel = r.status==='in_progress' ? 'In Progress' : r.status.charAt(0).toUpperCase()+r.status.slice(1);
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
          '<button onclick="tcSetStatus(\'' + r.id + '\',\'in_progress\',this)" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;font-weight:700;color:#f59e0b;background:#fff;cursor:pointer;">Working on it</button>' +
          '<button onclick="tcSetStatus(\'' + r.id + '\',\'done\',this)" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;font-weight:700;color:#22c55e;background:#fff;cursor:pointer;">Done ✓</button>' +
          '<button onclick="tcSetStatus(\'' + r.id + '\',\'ignored\',this)" style="flex:1;padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;font-weight:700;color:#94a3b8;background:#fff;cursor:pointer;">Ignore</button>' +
        '</div>' +
        '<div style="margin-top:6px;text-align:right;">' +
          '<span style="font-size:10px;font-weight:800;color:' + statusColor + ';">● ' + statusLabel + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

  } catch(e) {
    list.innerHTML = '<div style="text-align:center;color:#ef4444;padding:40px;font-size:14px;">Error loading reports</div>';
  }
}

async function tcSetStatus(id, status, btn) {
  try {
    await window.supa.from('chef_reports').update({ status: status }).eq('id', id);
    await tcAdminLoad();
  } catch(e) {}
}



