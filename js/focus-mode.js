// ── FOCUS MODE v4 ──
// Staff only, 8AM-8PM CDT
// Bottoni START/DONE su tutte le card — libertà totale

var _focusStartTimes = {};
var _focusChannel = null;
var _focusList = [];

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
  if (stationEl && user) stationEl.textContent = user.default_station || 'All Stations';
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
  var myStation = user && user.default_station ? user.default_station : null;
  var all = items.filter(function(i) {
    if (!myStation) return true;
    return i.category && i.category.includes(myStation);
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

  // START sempre visibile tranne su in_progress
  // DONE sempre visibile tranne su done
  var startBtn = !isWip
    ? '<button onclick="focusStart(\'' + i.id + '\')" style="flex:1;height:54px;border-radius:16px;background:#16a34a;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;">START</button>'
    : '';
  var doneBtn = !isDone
    ? '<button onclick="focusDone(\'' + i.id + '\')" style="flex:1;height:54px;border-radius:16px;background:#ef4444;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;">DONE</button>'
    : '<button onclick="focusReopen(\'' + i.id + '\')" style="flex:1;height:54px;border-radius:16px;background:#e2e8f0;color:#64748b;font-size:15px;font-weight:600;border:none;cursor:pointer;">Riapri</button>';

  var btns = '<div style="display:flex;gap:8px;margin-top:14px;">' + startBtn + doneBtn + '</div>';

  return '<div style="background:white;border-radius:24px;box-shadow:0 2px 16px rgba(30,58,95,0.09);border:1px solid rgba(59,130,246,0.08);padding:22px 20px;margin-bottom:12px;">' +
    '<div style="font-size:12px;font-weight:700;color:' + statusColor + ';letter-spacing:.06em;margin-bottom:4px;">' + statusLabel + '</div>' +
    '<h2 style="font-size:26px;font-weight:800;color:#1e3a5f;margin:0 0 2px 0;">' + i.name + '</h2>' +
    '<p style="font-size:13px;color:#94a3b8;margin:0;">' + (i.category || '') + '</p>' +
    btns +
    recipeLink +
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
  var durLabel = durationMinutes ? '<div style="font-size:13px;color:#f59e0b;margin-bottom:14px;">⏱ Tempo: ' + durationMinutes + ' min</div>' : '';

  var sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.4);display:flex;align-items:flex-end;';
  sheet.innerHTML =
    '<div style="background:white;border-radius:24px 24px 0 0;padding:20px;width:100%;max-width:480px;margin:0 auto;">' +
      '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>' +
      '<div style="font-size:18px;font-weight:700;color:#1e3a5f;margin-bottom:6px;">' + it.name + '</div>' +
      durLabel +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;">' +
        '<div><div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">QTY</div>' +
        '<select id="fmQty" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:8px;font-size:14px;">' +
          ['0.25','0.5','0.75','1','1.5','2','3','4','5','6','8','10'].map(function(q) { return '<option' + (q===String(it.average_qty||1)?' selected':'') + '>' + q + '</option>'; }).join('') +
        '</select></div>' +
        '<div><div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">UNIT</div>' +
        '<select id="fmUnit" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:8px;font-size:14px;">' +
          ['pz','g','kg','ml','lt','porz'].map(function(u) { return '<option>' + u + '</option>'; }).join('') +
        '</select></div>' +
        '<div><div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">CONTAINER</div>' +
        '<select id="fmCont" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:8px;font-size:14px;">' +
          ['1/9 pan','1/6 pan','1/4 pan','1/3 pan','1/2 pan','Full pan','Bowl','Sacchetto'].map(function(c) { return '<option>' + c + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;">' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="height:50px;border-radius:14px;background:#f1f5f9;color:#64748b;font-size:15px;border:none;cursor:pointer;">Annulla</button>' +
        '<button onclick="focusConfirmDone(\'' + id + '\',this)" style="height:50px;border-radius:14px;background:#ef4444;color:white;font-size:16px;font-weight:700;border:none;cursor:pointer;">Conferma DONE ✓</button>' +
      '</div>' +
    '</div>';
  sheet.onclick = function(e) { if (e.target === sheet) sheet.remove(); };
  sheet._startedAt = startedAt;
  sheet._durationMinutes = durationMinutes;
  document.body.appendChild(sheet);
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
    station: it.category || (user ? user.default_station : '') || '',
    qty: qty, unit: unit, container: cont,
    user_name: user ? user.name : '',
    started_at: startedAt ? startedAt.toISOString() : null,
    duration_minutes: durationMinutes
  });
  await supa.from('prep_tasks').update({need_tomorrow: false, in_progress: false}).eq('id', id);
  tasks[id].need_tomorrow = false;
  tasks[id].in_progress = false;
  delete _focusStartTimes[id];
  if (sheet) sheet.remove();
  if (typeof showConfetti === 'function') showConfetti();
  buildFocusList();
  renderFocusFeed();
};

function startFocusRealtime() {
  if (_focusChannel) supa.removeChannel(_focusChannel);
  _focusChannel = supa.channel('focus-rt')
    .on('postgres_changes', {event:'*', schema:'public', table:'prep_tasks'}, function() {
      supa.from('prep_tasks').select('*').order('name').then(function(res) {
        items = (res.data || []).filter(function(i) { return !i.archived; });
        items.forEach(function(i) { tasks[i.id] = i; });
        buildFocusList();
        renderFocusFeed();
      });
    })
    .subscribe();
}

window.focusMyStation = function() {
  buildFocusList();
  renderFocusFeed();
};

window.focusShowStations = function() {
  if (typeof showOtherStationsTab === 'function') showOtherStationsTab();
};
