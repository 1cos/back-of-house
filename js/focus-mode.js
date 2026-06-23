// ── FOCUS MODE v6 ──
// Staff only. Si attiva SOLO se l'utente è schedulato oggi in shifts_schedule
// (match esatto su users.schedule_name), dentro la finestra esatta del turno.
// is_closing → fine a mezzanotte. Niente fallback 8-20.

var _focusStartTimes = {};
var _focusChannel = null;
var _focusList = [];
var _focusCurrentStation = null; // stazione attualmente visualizzata

// Cache turni utente oggi
var _focusShiftWindow = null; // {start: h(float), end: h(float)} o null

async function loadFocusShiftWindow() {
  _focusShiftWindow = null;
  if (!user || !user.schedule_name) return;
  var todayStr = new Date().toLocaleString('en-CA', {timeZone:'America/Chicago'}).split(',')[0];
  var res = await supa.from('shifts_schedule')
    .select('start_time, end_time, start_hour, is_closing')
    .eq('date', todayStr)
    .eq('employee_name', user.schedule_name);
  if (res.error || !res.data || res.data.length === 0) return;

  // helper: estrae ora frazionaria CDT da un timestamp ISO
  function hourFromTs(ts) {
    if (!ts) return null;
    var s = new Date(ts).toLocaleString('en-US', {timeZone:'America/Chicago', hour12:false, hour:'2-digit', minute:'2-digit'});
    // s formato "HH:MM" o "HH:MM:SS"
    var parts = s.split(':');
    var hh = parseInt(parts[0], 10);
    var mm = parseInt(parts[1], 10) || 0;
    if (isNaN(hh)) return null;
    return hh + (mm / 60);
  }

  var startH = null;
  var endH = null;
  res.data.forEach(function(s) {
    var sh = hourFromTs(s.start_time);
    if (sh === null && s.start_hour != null) sh = parseFloat(s.start_hour);
    if (sh !== null) startH = (startH === null) ? sh : Math.min(startH, sh);

    var eh;
    if (s.is_closing) {
      eh = 24;
    } else {
      eh = hourFromTs(s.end_time);
    }
    if (eh !== null && eh !== undefined) endH = (endH === null) ? eh : Math.max(endH, eh);
  });

  if (startH === null || endH === null) return;
  _focusShiftWindow = { start: startH, end: endH };
}

function isFocusHour() {
  if (!_focusShiftWindow) return false; // niente turno = niente Focus Mode
  var now = new Date().toLocaleString('en-US', {timeZone:'America/Chicago', hour12:false, hour:'2-digit', minute:'2-digit'});
  var p = now.split(':');
  var h = parseInt(p[0], 10) + (parseInt(p[1], 10) || 0) / 60;
  return h >= _focusShiftWindow.start && h < _focusShiftWindow.end;
}

function shouldShowFocusMode() {
  if (typeof isAdmin === 'function' && isAdmin()) return false;
  var day = new Date().toLocaleString('en-US', {timeZone:'America/Chicago', weekday:'long'});
  if (day === 'Sunday') return false;
  return isFocusHour();
}

window.initFocusMode = async function() {
  await loadFocusShiftWindow();
  if (!shouldShowFocusMode()) return;
  var el = document.getElementById('focusMode');
  if (!el) return;
  el.style.display = 'flex';
  _focusCurrentStation = user && user.default_station ? user.default_station : null;
  updateFocusHeader();
  buildFocusList();
  renderFocusFeed();
  startFocusRealtime();
  startFocusClock();
};

window.hideFocusMode = function() {
  var el = document.getElementById('focusMode');
  if (el) el.style.display = 'none';
  if (_focusChannel) { supa.removeChannel(_focusChannel); _focusChannel = null; }
};

function updateFocusHeader() {
  var nameEl = document.getElementById('focusHeaderName');
  var stationEl = document.getElementById('focusHeaderStation');
  if (nameEl && user) nameEl.textContent = user.name;
  if (stationEl) stationEl.textContent = _focusCurrentStation || 'All Stations';
}

function startFocusClock() {
  function tick() {
    var el = document.getElementById('focusClock');
    if (!el) return;
    el.textContent = new Date().toLocaleString('en-US', {timeZone:'America/Chicago', hour:'numeric', minute:'2-digit', hour12:true});
  }
  tick();
  setInterval(tick, 30000);
}

function buildFocusList() {
  var all = items.filter(function(i) {
    if (!_focusCurrentStation) return true;
    return i.category && i.category.includes(_focusCurrentStation);
  });
  _focusList = all.sort(function(a, b) {
    var aScore = a.in_progress ? 3 : (a.need_tomorrow ? 2 : 0);
    var bScore = b.in_progress ? 3 : (b.need_tomorrow ? 2 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return a.name.localeCompare(b.name);
  });
}

window.renderFocusFeed = function() {
  var container = document.getElementById('focusFeed');
  if (!container) return;
  if (!_focusList.length) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;font-size:18px;">Nothing to prep ✅</div>';
    return;
  }
  var html = '';
  _focusList.forEach(function(i) { html += renderOneFocusCard(i); });
  container.innerHTML = html;
};

function renderOneFocusCard(i) {
  var isWip = i.in_progress;
  var isDone = !i.need_tomorrow && !i.in_progress;

  // Colori sfondo e bordo per stato
  var bgColor = isWip ? '#fffbeb' : (isDone ? '#f0f9ff' : '#fff1f1');
  var borderColor = isWip ? '#fcd34d' : (isDone ? '#7dd3fc' : '#fca5a5');
  var statusColor = isWip ? '#d97706' : (isDone ? '#0369a1' : '#dc2626');
  var statusLabel = isWip
    ? 'IN PROGRESS' + (_focusStartTimes[i.id] ? ' · ' + Math.round((Date.now()-_focusStartTimes[i.id])/60000) + ' min ⏱' : '')
    : (isDone ? 'DONE' : 'DA FARE');

  var hasRecipe = i.recipe_id || (typeof recipeLinks !== 'undefined' && recipeLinks[i.id]) || i.note;
  var recipeLink = hasRecipe
    ? '<div onclick="openRecipeForItem(\'' + i.id + '\')" style="font-size:13px;color:#059669;cursor:pointer;margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06);">📖 Ricetta</div>'
    : '';

  // Bottoni per stato
  var btn = '';
  if (!isWip && !isDone) {
    btn = '<div style="display:flex;gap:8px;margin-top:14px;">' +
      '<button onclick="focusStart(\'' + i.id + '\')" style="flex:1;height:54px;border-radius:16px;background:#1e3a5f;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;">START</button>' +
      (i.need_tomorrow ? '<button onclick="noNeed(\'' + i.id + '\')" style="height:54px;padding:0 16px;border-radius:16px;background:rgba(234,179,8,0.12);color:#854d0e;font-size:14px;font-weight:600;border:0.5px solid rgba(234,179,8,0.4);cursor:pointer;white-space:nowrap;">No Need</button>' : '') +
    '</div>';
  } else if (isWip) {
    btn = '<button onclick="focusDone(\'' + i.id + '\')" style="width:100%;height:54px;border-radius:16px;background:#1e3a5f;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;margin-top:14px;">DONE</button>';
  } else {
    btn = '<button onclick="focusReopen(\'' + i.id + '\')" style="width:100%;height:54px;border-radius:16px;background:rgba(30,58,95,0.08);color:#1e3a5f;font-size:16px;font-weight:600;border:none;cursor:pointer;margin-top:14px;">Riapri</button>';
  }

  return '<div style="background:' + bgColor + ';border-radius:24px;border:1.5px solid ' + borderColor + ';padding:22px 20px;margin-bottom:12px;">' +
    '<div style="font-size:12px;font-weight:700;color:' + statusColor + ';letter-spacing:.06em;margin-bottom:4px;">' + statusLabel + '</div>' +
    '<h2 style="font-size:26px;font-weight:800;color:#1e3a5f;margin:0 0 2px 0;">' + i.name + '</h2>' +
    '<p style="font-size:13px;color:#94a3b8;margin:0;">' + (i.category || '') + '</p>' +
    btn + recipeLink +
  '</div>';
}

window.focusStart = async function(id) {
  _focusStartTimes[id] = new Date();
  await supa.from('prep_tasks').update({in_progress: true, need_tomorrow: true}).eq('id', id);
  tasks[id].in_progress = true;
  tasks[id].need_tomorrow = true;
  buildFocusList();
  renderFocusFeed();
};

window.focusReopen = async function(id) {
  await supa.from('prep_tasks').update({need_tomorrow: true, in_progress: false}).eq('id', id);
  tasks[id].need_tomorrow = true;
  tasks[id].in_progress = false;
  buildFocusList();
  renderFocusFeed();
};

window.focusDone = async function(id) {
  var it = tasks[id];
  var startedAt = _focusStartTimes[id] || null;
  var durationMinutes = startedAt ? Math.round((Date.now() - startedAt) / 60000) : null;
  await supa.from('prep_log').insert({
    item: it.name,
    station: it.category || _focusCurrentStation || '',
    qty: it.average_qty || 1,
    unit: it.unit || 'pz',
    container: it.container || '',
    user_name: user ? user.name : '',
    started_at: startedAt ? startedAt.toISOString() : null,
    duration_minutes: durationMinutes
  });
  await supa.from('prep_tasks').update({need_tomorrow: false, in_progress: false}).eq('id', id);
  tasks[id].need_tomorrow = false;
  tasks[id].in_progress = false;
  delete _focusStartTimes[id];
  if (typeof showConfetti === 'function') showConfetti();
  buildFocusList();
  renderFocusFeed();
};

// Realtime — aggiorna solo il task cambiato in memoria, no re-query
function startFocusRealtime() {
  if (_focusChannel) supa.removeChannel(_focusChannel);
  _focusChannel = supa.channel('focus-rt')
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'prep_tasks'}, function(payload) {
      var updated = payload.new;
      if (!updated || !updated.id) return;
      // Aggiorna solo questo task in memoria
      tasks[updated.id] = Object.assign(tasks[updated.id] || {}, updated);
      var idx = items.findIndex(function(i) { return i.id === updated.id; });
      if (idx !== -1) items[idx] = tasks[updated.id];
      buildFocusList();
      renderFocusFeed();
    })
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'prep_tasks'}, function(payload) {
      var newItem = payload.new;
      if (!newItem || newItem.archived) return;
      tasks[newItem.id] = newItem;
      items.push(newItem);
      buildFocusList();
      renderFocusFeed();
    })
    .subscribe();
}

// ── SCHEDULE OVERLAY (sopra la Focus Mode, non la spegne mai) ──
window.focusOpenSchedule = function() {
  var existing = document.getElementById('focusSchedOverlay');
  if (existing) existing.remove();

  var ov = document.createElement('div');
  ov.id = 'focusSchedOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:70;background:linear-gradient(160deg,#f0f4ff 0%,#f8fafc 60%);display:flex;flex-direction:column;overflow:hidden;';
  ov.innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;padding:16px 16px 10px;flex-shrink:0;">' +
      '<button onclick="focusCloseSchedule()" style="height:40px;padding:0 16px;border-radius:14px;background:white;border:1px solid #e2e8f0;color:#1e3a5f;font-size:15px;font-weight:700;cursor:pointer;">← Back</button>' +
      '<div style="font-size:18px;font-weight:800;color:#1e3a5f;">Schedule</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;padding:0 16px 14px;flex-shrink:0;">' +
      '<button id="schedBtnOggi" onclick="schedShowView(\'oggi\')" style="flex:1;padding:8px;border-radius:12px;border:none;background:#1e3a5f;color:white;font-size:13px;font-weight:600;cursor:pointer;">Oggi</button>' +
      '<button id="schedBtnSettimana" onclick="schedShowView(\'settimana\')" style="flex:1;padding:8px;border-radius:12px;border:1.5px solid #1e3a5f;background:white;color:#1e3a5f;font-size:13px;font-weight:600;cursor:pointer;">Settimana</button>' +
    '</div>' +
    '<div id="schedContent" style="flex:1;overflow-y:auto;padding:0 16px 24px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;">' +
      '<div style="text-align:center;color:#94a3b8;padding:40px 0;font-size:14px;">Loading…</div>' +
    '</div>';
  // Evita collisione di ID con la section #vsched nascosta.
  // L'overlay non è ancora nel DOM, quindi questi sono solo i gemelli di #vsched.
  ['schedContent','schedBtnOggi','schedBtnSettimana'].forEach(function(idn){
    var el = document.getElementById(idn);
    if (el) el.id = '_hidden_'+idn;
  });
  document.body.appendChild(ov);

  if (typeof schedShowView === 'function') schedShowView('oggi');
  if (typeof schedLoadData === 'function') schedLoadData();
};

window.focusCloseSchedule = function() {
  var ov = document.getElementById('focusSchedOverlay');
  if (ov) ov.remove();
  // Ripristina gli ID originali della section #vsched.
  ['schedContent','schedBtnOggi','schedBtnSettimana'].forEach(function(idn){
    var el = document.getElementById('_hidden_'+idn);
    if (el) el.id = idn;
  });
  // Focus Mode è sempre rimasta attiva sotto — niente da riattivare.
};

window.focusMyStation = function() {
  _focusCurrentStation = user && user.default_station ? user.default_station : null;
  updateFocusHeader();
  buildFocusList();
  renderFocusFeed();
};

window.focusShowStations = function() {
  var myStation = user && user.default_station ? user.default_station : null;
  var stationMap = {};
  items.forEach(function(i) {
    if (!i.category) return;
    i.category.split(',').forEach(function(c) {
      var s = c.trim();
      if (s) stationMap[s] = (stationMap[s] || 0) + 1;
    });
  });
  var stations = Object.keys(stationMap).sort();

  var existing = document.getElementById('focusStationsSheet');
  if (existing) existing.remove();

  var rows = stations.map(function(s) {
    var active = s === _focusCurrentStation;
    return '<button onclick="focusLoadStation(\'' + s + '\')" style="width:100%;padding:16px;border-radius:14px;background:' + (active ? '#eff6ff' : '#f8fafc') + ';border:1px solid ' + (active ? '#bfdbfe' : '#e2e8f0') + ';text-align:left;font-size:15px;font-weight:600;color:#1e3a5f;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">' +
      s + '<span style="font-size:13px;color:#94a3b8;">' + stationMap[s] + ' items</span></button>';
  }).join('');

  var sheet = document.createElement('div');
  sheet.id = 'focusStationsSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;justify-content:flex-end;';
  sheet.innerHTML =
    '<div style="flex:1;background:rgba(0,0,0,0.4);" id="focusStationsBg"></div>' +
    '<div style="background:white;border-radius:24px 24px 0 0;padding:20px;max-height:70vh;overflow-y:auto;">' +
      '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>' +
      '<div style="font-size:16px;font-weight:700;color:#1e3a5f;margin-bottom:14px;">Stazioni</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' + rows + '</div>' +
    '</div>';
  sheet.querySelector('#focusStationsBg').onclick = function() { sheet.remove(); };
  document.body.appendChild(sheet);
};

window.focusLoadStation = function(station) {
  var sheet = document.getElementById('focusStationsSheet');
  if (sheet) sheet.remove();
  _focusCurrentStation = station;
  updateFocusHeader();
  buildFocusList();
  renderFocusFeed();
};


