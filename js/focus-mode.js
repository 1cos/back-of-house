// ── FOCUS MODE v5 ──
// Staff only, 8AM-8PM CDT
// Fix: _focusCurrentStation persiste tra START/DONE/realtime
// Fix: no re-query su realtime — aggiorna solo il task cambiato in memoria

var _focusStartTimes = {};
var _focusChannel = null;
var _focusList = [];
var _focusCurrentStation = null; // stazione attualmente visualizzata

function isFocusHour() {
  var h = parseInt(new Date().toLocaleString('en-US', {timeZone:'America/Chicago', hour:'numeric', hour12:false}));
  return h >= 8 && h < 20;
}

function shouldShowFocusMode() {
  if (typeof isAdmin === 'function' && isAdmin()) return false;
  return isFocusHour();
}

window.initFocusMode = function() {
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
  var statusColor = isWip ? '#3b82f6' : (isDone ? '#16a34a' : '#ef4444');
  var statusLabel = isWip
    ? 'IN PROGRESS' + (_focusStartTimes[i.id] ? ' · ' + Math.round((Date.now()-_focusStartTimes[i.id])/60000) + ' min ⏱' : '')
    : (isDone ? 'DONE' : 'DA FARE');

  var hasRecipe = i.recipe_id || (typeof recipeLinks !== 'undefined' && recipeLinks[i.id]) || i.note;
  var recipeLink = hasRecipe
    ? '<div onclick="openRecipeForItem(\'' + i.id + '\')" style="font-size:13px;color:#059669;cursor:pointer;margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9;">📖 Ricetta</div>'
    : '';

  var startBtn = !isWip
    ? '<button onclick="focusStart(\'' + i.id + '\')" style="flex:1;height:54px;border-radius:16px;background:#16a34a;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;">START</button>'
    : '';
  var actionBtn = !isDone
    ? '<button onclick="focusDone(\'' + i.id + '\')" style="flex:1;height:54px;border-radius:16px;background:#ef4444;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;">DONE</button>'
    : '<button onclick="focusReopen(\'' + i.id + '\')" style="flex:1;height:54px;border-radius:16px;background:#e2e8f0;color:#64748b;font-size:15px;font-weight:600;border:none;cursor:pointer;">Riapri</button>';

  var btns = '<div style="display:flex;gap:8px;margin-top:14px;">' + startBtn + actionBtn + '</div>';

  return '<div style="background:white;border-radius:24px;box-shadow:0 2px 16px rgba(30,58,95,0.09);border:1px solid rgba(59,130,246,0.08);padding:22px 20px;margin-bottom:12px;">' +
    '<div style="font-size:12px;font-weight:700;color:' + statusColor + ';letter-spacing:.06em;margin-bottom:4px;">' + statusLabel + '</div>' +
    '<h2 style="font-size:26px;font-weight:800;color:#1e3a5f;margin:0 0 2px 0;">' + i.name + '</h2>' +
    '<p style="font-size:13px;color:#94a3b8;margin:0;">' + (i.category || '') + '</p>' +
    btns + recipeLink +
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
