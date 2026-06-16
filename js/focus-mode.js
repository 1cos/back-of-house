// ── FOCUS MODE v2 ──
// Staff only, 8AM-8PM CDT
// Feed view esistente + START/DONE + bottom bar semplificata

var _focusStartTimes = {};
var _focusChannel = null;
var _focusList = [];
var _focusIdx = 0;

function isFocusHour() {
  var h = parseInt(new Date().toLocaleString('en-US', {timeZone: 'America/Chicago', hour: 'numeric', hour12: false}));
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
  buildFocusList();
  renderFocusCard();
  startFocusRealtime();
};

window.hideFocusMode = function() {
  var el = document.getElementById('focusMode');
  if (el) el.style.display = 'none';
  if (_focusChannel) { supa.removeChannel(_focusChannel); _focusChannel = null; }
};

function buildFocusList() {
  var myStation = user && user.default_station ? user.default_station : null;
  _focusList = items.filter(function(i) {
    if (!myStation) return true;
    return i.category && i.category.includes(myStation);
  }).sort(function(a, b) {
    var aScore = (a.need_tomorrow ? 2 : 0) + (a.in_progress ? 1 : 0);
    var bScore = (b.need_tomorrow ? 2 : 0) + (b.in_progress ? 1 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return a.name.localeCompare(b.name);
  });
  if (_focusIdx >= _focusList.length) _focusIdx = 0;
}

window.renderFocusCard = function() {
  var container = document.getElementById('focusFeed');
  if (!container) return;
  if (!_focusList.length) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:18px;">All done!</div>';
    return;
  }
  var i = _focusList[_focusIdx];
  if (!i) return;

  var isUrgent = i.need_tomorrow && !i.in_progress;
  var isWip = i.in_progress;
  var isDone = !i.need_tomorrow && !i.in_progress;

  var statusLabel = isUrgent
    ? '<div style="font-size:13px;font-weight:700;color:#ef4444;letter-spacing:.05em;">DA FARE</div>'
    : isWip
    ? '<div style="font-size:13px;font-weight:700;color:#3b82f6;letter-spacing:.05em;">IN PROGRESS' + (_focusStartTimes[i.id] ? ' ' + Math.round((Date.now()-_focusStartTimes[i.id])/60000) + ' min' : '') + '</div>'
    : '<div style="font-size:13px;font-weight:700;color:#16a34a;letter-spacing:.05em;">DONE</div>';

  var counter = '<div style="font-size:13px;color:#94a3b8;margin-top:2px;">' + (_focusIdx+1) + ' / ' + _focusList.length + '</div>';

  var recipeLink = i.recipe_id
    ? '<div onclick="openRecipeForItem(\'' + i.id + '\')" style="font-size:14px;color:#059669;cursor:pointer;margin-top:12px;padding-top:12px;border-top:1px solid #f1f5f9;">📖 Ricetta</div>'
    : '';

  var startBtn = '<button onclick="focusStart(\'' + i.id + '\')" style="flex:1;height:56px;border-radius:16px;background:#16a34a;color:white;font-size:18px;font-weight:700;border:none;cursor:pointer;">START</button>';
  var doneBtn = '<button onclick="focusDone(\'' + i.id + '\')" style="flex:1;height:56px;border-radius:16px;background:#ef4444;color:white;font-size:18px;font-weight:700;border:none;cursor:pointer;">DONE</button>';

  var btns = '';
  if (isUrgent) btns = startBtn;
  else if (isWip) btns = startBtn + doneBtn;
  else btns = '';

  var prevBtn = _focusIdx > 0
    ? '<button onclick="focusNav(-1)" style="position:absolute;left:0;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.06);border:none;font-size:18px;cursor:pointer;color:#94a3b8;">‹</button>'
    : '';
  var nextBtn = _focusIdx < _focusList.length - 1
    ? '<button onclick="focusNav(1)" style="position:absolute;right:0;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,0.06);border:none;font-size:18px;cursor:pointer;color:#94a3b8;">›</button>'
    : '';

  container.innerHTML =
    '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:0 16px;">' +
      '<div style="text-align:center;margin-bottom:12px;">' + statusLabel + counter + '</div>' +
      '<div style="position:relative;width:100%;max-width:340px;">' +
        prevBtn +
        '<div style="background:white;border-radius:28px;box-shadow:0 4px 24px rgba(30,58,95,0.12);border:1px solid rgba(59,130,246,0.1);padding:28px 24px;margin:0 20px;">' +
          '<h2 style="font-size:30px;font-weight:800;color:#1e3a5f;text-align:center;margin-bottom:4px;">' + i.name + '</h2>' +
          '<p style="text-align:center;font-size:14px;color:#94a3b8;margin-bottom:16px;">' + (i.category || '') + '</p>' +
          (btns ? '<div style="display:flex;gap:10px;">' + btns + '</div>' : '<div style="text-align:center;font-size:28px;">✅</div>') +
          recipeLink +
        '</div>' +
        nextBtn +
      '</div>' +
    '</div>';
};

window.focusNav = function(dir) {
  _focusIdx = Math.max(0, Math.min(_focusList.length - 1, _focusIdx + dir));
  renderFocusCard();
};

window.focusStart = async function(id) {
  _focusStartTimes[id] = new Date();
  await supa.from('prep_tasks').update({in_progress: true}).eq('id', id);
  tasks[id].in_progress = true;
  buildFocusList();
  renderFocusCard();
};

window.focusDone = async function(id) {
  var it = tasks[id];
  var startedAt = _focusStartTimes[id] || null;
  var durationMinutes = startedAt ? Math.round((Date.now() - startedAt) / 60000) : null;

  var sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:flex;align-items:flex-end;';
  var durLabel = durationMinutes ? '<div style="font-size:13px;color:#f59e0b;margin-bottom:14px;">Tempo: ' + durationMinutes + ' min</div>' : '';
  sheet.innerHTML =
    '<div style="background:white;border-radius:24px 24px 0 0;padding:20px;width:100%;max-width:480px;margin:0 auto;">' +
      '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>' +
      '<div style="font-size:17px;font-weight:700;color:#1e3a5f;margin-bottom:4px;">' + it.name + '</div>' +
      durLabel +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">' +
        '<div><div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">QTY</div>' +
        '<select id="fmQty" style="width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:8px;font-size:14px;">' +
          ['0.25','0.5','0.75','1','1.5','2','3','4','5','6','8','10'].map(function(q) { return '<option' + (q === String(it.average_qty||1) ? ' selected' : '') + '>' + q + '</option>'; }).join('') +
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
        '<button onclick="focusConfirmDone(\'' + id + '\',this)" style="height:50px;border-radius:14px;background:#ef4444;color:white;font-size:16px;font-weight:700;border:none;cursor:pointer;">Conferma DONE</button>' +
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
  renderFocusCard();
};

function startFocusRealtime() {
  if (_focusChannel) supa.removeChannel(_focusChannel);
  _focusChannel = supa.channel('focus-rt')
    .on('postgres_changes', {event: '*', schema: 'public', table: 'prep_tasks'}, function() {
      supa.from('prep_tasks').select('*').order('name').then(function(res) {
        items = (res.data || []).filter(function(i) { return !i.archived; });
        items.forEach(function(i) { tasks[i.id] = i; });
        buildFocusList();
        renderFocusCard();
      });
    })
    .subscribe();
}

window.focusShowStations = function() {
  if (typeof showOtherStationsTab === 'function') showOtherStationsTab();
};

window.focusMyStation = function() {
  var myStation = user && user.default_station ? user.default_station : null;
  _focusList = items.filter(function(i) {
    if (!myStation) return true;
    return i.category && i.category.includes(myStation);
  }).sort(function(a, b) {
    var aScore = (a.need_tomorrow ? 2 : 0) + (a.in_progress ? 1 : 0);
    var bScore = (b.need_tomorrow ? 2 : 0) + (b.in_progress ? 1 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return a.name.localeCompare(b.name);
  });
  _focusIdx = 0;
  renderFocusCard();
};
