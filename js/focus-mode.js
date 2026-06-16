// ── FOCUS MODE ──
// Modalita lavagna digitale per staff (non admin) — 8:00 AM → 8:00 PM CDT
// START → in_progress + salva started_at in memoria
// DONE → prep_log con started_at + duration_minutes

var _focusStartTimes = {}; // { prep_task_id: Date }
var _focusChannel = null;
var _focusAlertInterval = null;

function isFocusHour() {
  var h = parseInt(new Date().toLocaleString('en-US', {timeZone: 'America/Chicago', hour: 'numeric', hour12: false}));
  return h >= 8 && h < 20;
}

function shouldShowFocusMode() {
  if (isAdmin()) return false;
  return isFocusHour();
}

// ── INIT ──
window.initFocusMode = function() {
  if (!shouldShowFocusMode()) return;
  var el = document.getElementById('focusMode');
  if (!el) return;
  el.style.display = 'flex';
  renderFocusMode();
  startFocusRealtime();
  startFocusAlertTicker();
};

window.hideFocusMode = function() {
  var el = document.getElementById('focusMode');
  if (el) el.style.display = 'none';
  if (_focusChannel) { supa.removeChannel(_focusChannel); _focusChannel = null; }
  if (_focusAlertInterval) { clearInterval(_focusAlertInterval); _focusAlertInterval = null; }
};

// ── REALTIME ──
function startFocusRealtime() {
  if (_focusChannel) supa.removeChannel(_focusChannel);
  _focusChannel = supa.channel('focus-prep-rt')
    .on('postgres_changes', {event: '*', schema: 'public', table: 'prep_tasks'}, function() {
      supa.from('prep_tasks').select('*').order('name').then(function(res) {
        items = (res.data || []).filter(function(i) { return !i.archived; });
        items.forEach(function(i) { tasks[i.id] = i; });
        renderFocusMode();
      });
    })
    .subscribe();
}

// ── ALERT TICKER ──
function startFocusAlertTicker() {
  loadFocusAlerts();
  if (_focusAlertInterval) clearInterval(_focusAlertInterval);
  _focusAlertInterval = setInterval(loadFocusAlerts, 30000);
}

function loadFocusAlerts() {
  supa.from('alerts').select('message').eq('is_active', true).order('created_at', {ascending: false}).then(function(res) {
    var alerts = res.data || [];
    var ticker = document.getElementById('focusAlertTicker');
    if (!ticker) return;
    if (!alerts.length) {
      ticker.style.display = 'none';
      return;
    }
    ticker.style.display = 'block';
    var text = alerts.map(function(a) { return a.message; }).join('   •   ');
    var inner = document.getElementById('focusAlertText');
    if (inner) inner.textContent = text;
  });
}

// ── RENDER ──
window.renderFocusMode = function() {
  var myStation = user && user.default_station ? user.default_station : null;
  var myItems = items.filter(function(i) {
    if (!myStation) return true;
    return i.category && i.category.includes(myStation);
  });

  var todo = myItems.filter(function(i) { return i.need_tomorrow && !i.in_progress; });
  var inprog = myItems.filter(function(i) { return i.in_progress; });
  var done = myItems.filter(function(i) { return !i.need_tomorrow && !i.in_progress; });

  var container = document.getElementById('focusBody');
  if (!container) return;

  container.innerHTML =
    renderFocusSection('todo', 'To Do', '#ef4444', todo, true) +
    renderFocusSection('inprog', 'In Progress', '#3b82f6', inprog, true) +
    renderFocusSection('done', 'Done', '#16a34a', done, false);
};

function renderFocusSection(sectionId, label, color, itemList, expanded) {
  var countBadge = itemList.length > 0 ? (' <span style="background:' + color + ';color:white;border-radius:99px;padding:1px 8px;font-size:13px;">' + itemList.length + '</span>') : '';
  var headerHtml =
    '<div onclick="toggleFocusSection(\'' + sectionId + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.07);">' +
      '<span style="font-size:18px;font-weight:700;color:' + color + ';">' + label + countBadge + '</span>' +
      '<span id="focusChevron_' + sectionId + '" style="color:rgba(255,255,255,0.4);font-size:16px;">' + (expanded ? '▲' : '▼') + '</span>' +
    '</div>';

  var cardsHtml = '';
  itemList.forEach(function(i) {
    cardsHtml += renderFocusCard(i, sectionId);
  });
  if (!itemList.length) {
    cardsHtml = '<div style="padding:16px;color:rgba(255,255,255,0.3);font-size:15px;text-align:center;">—</div>';
  }

  return '<div style="margin-bottom:8px;background:rgba(255,255,255,0.04);border-radius:16px;overflow:hidden;">' +
    headerHtml +
    '<div id="focusSection_' + sectionId + '" style="display:' + (expanded ? 'block' : 'none') + ';">' +
      cardsHtml +
    '</div>' +
  '</div>';
}

function renderFocusCard(i, section) {
  var isStarted = !!_focusStartTimes[i.id];
  var elapsed = '';
  if (isStarted) {
    var mins = Math.round((Date.now() - _focusStartTimes[i.id]) / 60000);
    elapsed = '<span style="font-size:13px;color:#fbbf24;margin-left:8px;">⏱ ' + mins + ' min</span>';
  }

  var recipeLink = i.recipe_id
    ? '<span onclick="openRecipeForItem(\'' + i.id + '\')" style="font-size:13px;color:#059669;cursor:pointer;margin-top:4px;display:block;">📖 Recipe</span>'
    : '';

  var actionBtn = '';
  if (section === 'todo') {
    actionBtn =
      '<button onclick="focusStart(\'' + i.id + '\')" style="height:48px;padding:0 20px;border-radius:14px;background:#3b82f6;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;white-space:nowrap;">START</button>';
  } else if (section === 'inprog') {
    actionBtn =
      '<button onclick="focusDone(\'' + i.id + '\')" style="height:48px;padding:0 20px;border-radius:14px;background:#16a34a;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;white-space:nowrap;">DONE</button>';
  }

  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid rgba(255,255,255,0.05);">' +
    '<div style="flex:1;min-width:0;">' +
      '<div style="font-size:22px;font-weight:600;color:white;line-height:1.2;">' + i.name + elapsed + '</div>' +
      recipeLink +
    '</div>' +
    '<div style="margin-left:12px;flex-shrink:0;">' + actionBtn + '</div>' +
  '</div>';
}

window.toggleFocusSection = function(sectionId) {
  var el = document.getElementById('focusSection_' + sectionId);
  var chev = document.getElementById('focusChevron_' + sectionId);
  if (!el) return;
  var open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (chev) chev.textContent = open ? '▼' : '▲';
};

// ── START ──
window.focusStart = async function(id) {
  _focusStartTimes[id] = new Date();
  tasks[id].in_progress = true;
  tasks[id].need_tomorrow = true;
  await supa.from('prep_tasks').update({in_progress: true}).eq('id', id);
  renderFocusMode();
};

// ── DONE ──
window.focusDone = async function(id) {
  var it = tasks[id];
  var startedAt = _focusStartTimes[id] || null;
  var durationMinutes = startedAt ? Math.round((Date.now() - startedAt) / 60000) : null;

  var sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;';
  sheet.innerHTML =
    '<div style="background:#1e293b;border-radius:24px 24px 0 0;padding:20px;width:100%;max-width:480px;margin:0 auto;">' +
      '<div style="width:36px;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;margin:0 auto 16px;"></div>' +
      '<div style="font-size:18px;font-weight:700;color:white;margin-bottom:4px;">' + it.name + '</div>' +
      (durationMinutes ? '<div style="font-size:14px;color:#fbbf24;margin-bottom:16px;">⏱ ' + durationMinutes + ' min</div>' : '<div style="margin-bottom:16px;"></div>') +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">' +
        '<div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;">QTY</div>' +
          '<select id="fmQty" style="width:100%;background:#0f172a;color:white;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:8px;font-size:14px;">' +
            ['0.25','0.5','0.75','1','1.5','2','3','4','5','6','8','10'].map(function(q) {
              return '<option' + (q === String(it.average_qty || 1) ? ' selected' : '') + '>' + q + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;">UNIT</div>' +
          '<select id="fmUnit" style="width:100%;background:#0f172a;color:white;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:8px;font-size:14px;">' +
            ['pz','g','kg','ml','lt','porz'].map(function(u) { return '<option>' + u + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:4px;">CONTAINER</div>' +
          '<select id="fmCont" style="width:100%;background:#0f172a;color:white;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:8px;font-size:14px;">' +
            ['1/9 pan','1/6 pan','1/4 pan','1/3 pan','1/2 pan','Full pan','Bowl','Sacchetto'].map(function(c) { return '<option>' + c + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;">' +
        '<button onclick="this.closest(\'div[style*=position]\').remove()" style="height:52px;border-radius:14px;background:rgba(255,255,255,0.08);color:white;font-size:15px;border:none;cursor:pointer;">Cancel</button>' +
        '<button onclick="focusConfirmDone(\'' + id + '\',this)" style="height:52px;border-radius:14px;background:#16a34a;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;">Done ✓</button>' +
      '</div>' +
    '</div>';
  sheet.onclick = function(e) { if (e.target === sheet) sheet.remove(); };
  document.body.appendChild(sheet);
  sheet._startedAt = startedAt;
  sheet._durationMinutes = durationMinutes;
};

window.focusConfirmDone = async function(id, btn) {
  var sheet = btn.closest('div[style*="position:fixed"]');
  var qty = parseFloat(document.getElementById('fmQty').value);
  var unit = document.getElementById('fmUnit').value;
  var cont = document.getElementById('fmCont').value;
  var startedAt = sheet ? sheet._startedAt : null;
  var durationMinutes = sheet ? sheet._durationMinutes : null;
  var it = tasks[id];

  btn.textContent = '...'; btn.disabled = true;

  await supa.from('prep_log').insert({
    item: it.name,
    station: it.category || user.default_station || '',
    qty: qty,
    unit: unit,
    container: cont,
    user_name: user.name,
    started_at: startedAt ? startedAt.toISOString() : null,
    duration_minutes: durationMinutes
  });
  await supa.from('prep_tasks').update({need_tomorrow: false, in_progress: false}).eq('id', id);
  tasks[id].need_tomorrow = false;
  tasks[id].in_progress = false;
  delete _focusStartTimes[id];

  if (sheet) sheet.remove();
  showConfetti();
  renderFocusMode();
};
