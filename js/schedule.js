// schedule.js - Brigade Schedule v2 — CSV import + UI mockup
// v311 → v313

var schedCurrentView = 'oggi';
var schedAllShifts = [];
var schedCurrentDayIndex = 0; // index into week days array

// ── SHOW TAB ──────────────────────────────────────────────
function showSchedule() {
  document.querySelectorAll('section[id^="v"]').forEach(function(s) { s.classList.add('hidden'); });
  document.getElementById('vsched').classList.remove('hidden');
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.remove('tab-active');
    var icon = t.querySelector('.tab-icon');
    if (icon) icon.style.stroke = '';
    var label = t.querySelector('.tab-label');
    if (label) label.style.color = '';
  });
  var tab = document.getElementById('tabSchedule');
  if (tab) {
    tab.classList.add('tab-active');
    var icon = tab.querySelector('.tab-icon');
    if (icon) icon.style.stroke = '#059669';
    var label = tab.querySelector('.tab-label');
    if (label) label.style.color = '#059669';
  }
  schedLoadData();
}

// ── TAB OGGI / SETTIMANA ──────────────────────────────────
function schedShowView(view) {
  schedCurrentView = view;
  var btnOggi = document.getElementById('schedBtnOggi');
  var btnSett = document.getElementById('schedBtnSettimana');
  var btnGen  = document.getElementById('schedBtnGenera');
  var inactive = 'background:white;color:#1e3a5f;border:1.5px solid #1e3a5f;';
  var active   = 'background:#1e3a5f;color:white;border:none;';
  if (btnOggi) btnOggi.style.cssText += (view==='oggi' ? active : inactive);
  if (btnSett) btnSett.style.cssText += (view==='settimana' ? active : inactive);
  if (btnGen)  btnGen.style.cssText  += (view==='genera' ? active : inactive);
  schedRender();
}

// ── LOAD FROM DB ──────────────────────────────────────────
function schedLoadData() {
  window.supa.from('shifts_schedule')
    .select('*')
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
    .then(function(res) {
      schedAllShifts = res.data || [];
      schedUpdateLastSync();
      schedRender();
    });
}

function schedUpdateLastSync() {
  var el = document.getElementById('schedLastSync');
  if (!el) return;
  if (schedAllShifts.length === 0) { el.textContent = ''; return; }
  var latest = schedAllShifts.reduce(function(a, b) {
    return (a.synced_at || '') > (b.synced_at || '') ? a : b;
  });
  if (latest.synced_at) {
    var d = new Date(latest.synced_at);
    el.textContent = tr('sched_updated') + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
}

// ── CSV IMPORT ────────────────────────────────────────────
function schedOpenCsvImport() {
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.csv';
  inp.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) { schedParseCsv(ev.target.result, file.name); };
    reader.readAsText(file);
  };
  inp.click();
}

function schedParseCsv(text, filename) {
  var btn = document.getElementById('schedSyncBtn');
  if (btn) { btn.textContent = tr('sched_importing'); btn.disabled = true; }

  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  if (lines.length < 2) {
    alert('CSV vuoto o non valido');
    if (btn) { btn.textContent = tr('sched_import'); btn.disabled = false; }
    return;
  }

  // Parse header
  var headers = schedCsvSplit(lines[0]);

  // Find column indexes
  var iName = schedColIdx(headers, ['Name', 'Employee Name', 'employee_name', 'Full Name']);
  var iRole = schedColIdx(headers, ['Role', 'role_name', 'Position', 'Job']);
  var iDept = schedColIdx(headers, ['Department', 'department_name', 'Station']);
  var iHrs  = schedColIdx(headers, ['Payable Hours', 'Total Hours', 'Hours', 'payable_hours', 'Paid Hours']);

  // Get Monday anchor from filename: "Zenos_On_The_Square_Schedule_2026-06-22.csv"
  // → anchor = 2026-06-22. If not found, fallback to current Monday.
  var _anchorDate = null;
  var _fnMatch = (filename || '').match(/(\d{4}-\d{2}-\d{2})/);
  if (_fnMatch) {
    // Parse YYYY-MM-DD directly — no UTC conversion
    var _fp = _fnMatch[1].split('-');
    _anchorDate = new Date(parseInt(_fp[0]),parseInt(_fp[1])-1,parseInt(_fp[2]));
  } else {
    // Fallback: Monday of current week
    var _now = new Date();
    var _dow = _now.getDay();
    _anchorDate = new Date(_now);
    _anchorDate.setDate(_now.getDate() + (_dow === 0 ? -6 : 1 - _dow));
  }

  // Map day name → offset from Monday. Sunday excluded (Zenos closed).
  var WEEKDAY_OFFSET = {
    'monday':0,'tuesday':1,'wednesday':2,'thursday':3,'friday':4,'saturday':5
  };

  var dayCols = [];
  headers.forEach(function(h, idx) {
    var hKey = h.trim().toLowerCase();
    if (WEEKDAY_OFFSET[hKey] !== undefined) {
      var _d = new Date(_anchorDate);
      _d.setDate(_anchorDate.getDate() + WEEKDAY_OFFSET[hKey]);
      var yr = _d.getFullYear();
      var mo = String(_d.getMonth()+1).padStart(2,'0');
      var dy = String(_d.getDate()).padStart(2,'0');
      dayCols.push({ idx: idx, date: yr+'-'+mo+'-'+dy });
    }
  });

  var weekStart = dayCols.length > 0 ? dayCols[0].date : null;

  var shifts = [];
  for (var r = 1; r < lines.length; r++) {
    var cols = schedCsvSplit(lines[r]);
    if (!cols[iName] || cols[iName].trim() === '') continue;
    var empName = (cols[iName] || '').trim();
    var roleName = iRole >= 0 ? (cols[iRole] || '').trim() : '';
    var deptName = iDept >= 0 ? (cols[iDept] || '').trim() : '';
    var payHrs = iHrs >= 0 ? parseFloat(cols[iHrs]) || null : null;

    dayCols.forEach(function(dc) {
      var cell = (cols[dc.idx] || '').trim();
      if (!cell || cell === '' || cell.toLowerCase() === 'off' || cell === '-') return;

      // Parse cell: could be "8:00 AM - 2:30 PM\nRole" or "8am-2:30pm" or "Off"
      var parsed = schedParseShiftCell(cell);
      if (!parsed) return;

      // Determine shift_type
      var shiftType = 'morning';
      if (parsed.startHour >= 13) shiftType = 'evening';
      if (parsed.isDouble) shiftType = 'double';

      shifts.push({
        date: dc.date,
        week_start: weekStart,
        employee_name: empName,
        role_name: roleName || parsed.role || '',
        department_name: deptName,
        start_time: dc.date + 'T' + parsed.startStr + ':00-05:00',
        end_time: parsed.endStr ? (dc.date + 'T' + parsed.endStr + ':00-05:00') : null,
        start_label: schedFmtTime(parsed.startStr),
        end_label: parsed.isClosing ? tr('sched_close') : schedFmtTime(parsed.endStr),
        start_hour: parsed.startHour,
        is_closing: parsed.isClosing,
        shift_type: shiftType,
        payable_hours: payHrs,
        synced_at: new Date().toISOString()
      });

      // Double shift: add second block
      if (parsed.isDouble && parsed.start2Str) {
        shifts.push({
          date: dc.date,
          week_start: weekStart,
          employee_name: empName,
          role_name: roleName || parsed.role2 || parsed.role || '',
          department_name: deptName,
          start_time: dc.date + 'T' + parsed.start2Str + ':00-05:00',
          end_time: parsed.end2Str ? (dc.date + 'T' + parsed.end2Str + ':00-05:00') : null,
          start_label: schedFmtTime(parsed.start2Str),
          end_label: schedFmtTime(parsed.end2Str),
          start_hour: parsed.start2Str ? parseInt(parsed.start2Str.split(':')[0], 10) : (parsed.startHour + 9),
          is_closing: false,
          shift_type: 'double',
          payable_hours: null,
          synced_at: new Date().toISOString()
        });
      }
    });
  }

  if (shifts.length === 0) {
    alert(tr('sched_no_shifts_csv'));
    if (btn) { btn.textContent = tr('sched_import'); btn.disabled = false; }
    return;
  }

  // Delete existing week then insert
  var deleteQuery = weekStart
    ? window.supa.from('shifts_schedule').delete().eq('week_start', weekStart)
    : window.supa.from('shifts_schedule').delete().neq('id', 0);

  deleteQuery.then(function() {
    window.supa.from('shifts_schedule').insert(shifts).then(function(res) {
      if (res.error) {
        console.error('[SCHED] Insert error:', res.error);
        alert(tr('sched_save_error') + res.error.message);
      } else {
        schedLoadData();
        if (btn) { btn.textContent = tr('sched_imported').replace('{n}', shifts.length); }
        setTimeout(function() { if (btn) { btn.textContent = tr('sched_import'); btn.disabled = false; } }, 3000);
      }
    });
  });
}

function schedParseShiftCell(cell) {
  // Handle pipe-separated double shifts: "8am-2pm | 5pm-10:30pm"
  if (cell.indexOf('|') >= 0) {
    var parts = cell.split('|').map(function(p) { return p.trim(); });
    var p1 = schedParseSingleShift(parts[0]);
    var p2 = parts[1] ? schedParseSingleShift(parts[1]) : null;
    if (!p1) return null;
    return {
      startHour: p1.startHour, startStr: p1.startStr, endStr: p1.endStr,
      isClosing: p1.isClosing, isDouble: true, role: p1.role,
      start2Str: p2 ? p2.startStr : null, end2Str: p2 ? p2.endStr : null,
      role2: p2 ? p2.role : ''
    };
  }
  var s = schedParseSingleShift(cell);
  if (!s) return null;
  return { startHour: s.startHour, startStr: s.startStr, endStr: s.endStr,
           isClosing: s.isClosing, isDouble: false, role: s.role,
           start2Str: null, end2Str: null };
}

function schedParseSingleShift(str) {
  str = str.trim();
  // Extract role from parentheses: "8am - 2:30pm (Morning Prep)" → role = "Morning Prep"
  var roleMatch = str.match(/\(([^)]+)\)/);
  var role = roleMatch ? roleMatch[1].trim() : '';
  str = str.replace(/\([^)]*\)/g, '').trim(); // remove parentheses
  // Match patterns: "8:00 AM - 2:30 PM", "8am-2:30pm", "8am - 2:30pm"
  var m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|(close|cl))/i);
  if (!m) return null;

  var sh = parseInt(m[1], 10);
  var sm = parseInt(m[2] || '0', 10);
  var sAmPm = (m[3] || '').toLowerCase();
  var eh = m[4] ? parseInt(m[4], 10) : 0;
  var em = parseInt(m[5] || '0', 10);
  var eAmPm = (m[6] || '').toLowerCase();
  var isClosing = /close|cl/i.test(m[7] || m[6] || '');

  // Resolve AM/PM
  if (sAmPm === 'pm' && sh < 12) sh += 12;
  if (sAmPm === 'am' && sh === 12) sh = 0;
  if (!sAmPm && sh < 7) sh += 12; // assume pm for ambiguous small hours

  if (!isClosing) {
    if (eAmPm === 'pm' && eh < 12) eh += 12;
    if (eAmPm === 'am' && eh === 12) eh = 0;
    if (!eAmPm && eh < sh && eh >= 1) eh += 12; // cross noon
  }

  var startStr = String(sh).padStart(2,'0') + ':' + String(sm).padStart(2,'0');
  var endStr = isClosing ? '23:59' : (String(eh).padStart(2,'0') + ':' + String(em).padStart(2,'0'));

  return { startHour: sh, startStr: startStr, endStr: endStr, isClosing: isClosing, role: role };
}

function schedColIdx(headers, names) {
  for (var i = 0; i < names.length; i++) {
    var idx = headers.findIndex(function(h) { return h.toLowerCase().trim() === names[i].toLowerCase().trim(); });
    if (idx >= 0) return idx;
  }
  return -1;
}

function schedCsvSplit(line) {
  var result = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

// ── RENDER ────────────────────────────────────────────────
function schedRender() {
  var container = document.getElementById('schedContent');
  if (!container) return;
  if (schedCurrentView === 'genera') { schedRenderGeneratore(container); return; }
  if (schedAllShifts.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px 0;font-size:17px;">' + tr('sched_no_data') + '</div>';
    return;
  }
  if (schedCurrentView === 'oggi') { schedRenderOggi(container); }
  else { schedRenderSettimana(container); }
}

// ── TODAY VIEW ────────────────────────────────────────────
function schedRenderOggi(container) {
  var today = new Date();
  var todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');

  // Get week dates for day strip
  var weekDates = schedGetWeekDates();
  // Auto-select today if not yet selected
  if (schedCurrentDayIndex === 0 && weekDates.indexOf(todayStr) >= 0) {
    schedCurrentDayIndex = weekDates.indexOf(todayStr);
  }
  var selectedDate = weekDates[schedCurrentDayIndex] || weekDates[0] || todayStr;
  var dayShifts = schedAllShifts.filter(function(s) { return s.date === selectedDate; });

  var morning = dayShifts.filter(function(s) { return s.shift_type === 'morning' || s.shift_type === 'double'; });
  var evening = dayShifts.filter(function(s) { return s.shift_type === 'evening'; });
  var allPeople = {};
  dayShifts.forEach(function(s) { allPeople[s.employee_name] = true; });
  var totalPeople = Object.keys(allPeople).length;

  // Build day strip
  var dayStripHtml = '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">';
  weekDates.forEach(function(dateStr, idx) {
    var d = new Date(dateStr + 'T12:00:00');
    var isToday = dateStr === todayStr;
    var isSelected = idx === schedCurrentDayIndex;
    var dayShiftsCount = schedAllShifts.filter(function(s) { return s.date === dateStr; });
    var hasMorning = dayShiftsCount.some(function(s) { return s.shift_type === 'morning' || s.shift_type === 'double'; });
    var hasEvening = dayShiftsCount.some(function(s) { return s.shift_type === 'evening' || s.shift_type === 'double'; });
    var isSunday = d.getDay() === 0;

    dayStripHtml += '<div onclick="schedSelectDay(' + idx + ')" style="display:flex;flex-direction:column;align-items:center;padding:8px 10px;border-radius:14px;min-width:46px;cursor:pointer;flex-shrink:0;' +
      (isSelected ? 'background:white;border:0.5px solid rgba(5,150,105,0.4);box-shadow:0 2px 8px rgba(30,58,95,0.1);' : 'background:rgba(255,255,255,0.5);border:0.5px solid rgba(59,130,246,0.1);') + '">' +
      '<span style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:' + (isSelected ? '#059669' : '#94a3b8') + ';">' +
        (function(){var days=tr('sched_days');var di=d.getDay();return Array.isArray(days)?days[di===0?6:di-1]:d.toLocaleDateString('en-US',{weekday:'short'});})() + '</span>' +
      '<span style="font-size:21px;font-weight:700;color:#1e3a5f;line-height:1.1;">' + d.getDate() + '</span>' +
      '<div style="display:flex;gap:3px;margin-top:2px;">' +
        (hasMorning ? '<div style="width:4px;height:4px;border-radius:50%;background:#2563eb;"></div>' : '') +
        (hasEvening ? '<div style="width:4px;height:4px;border-radius:50%;background:#059669;"></div>' : '') +
        (isSunday ? '<div style="width:4px;height:4px;border-radius:50%;background:rgba(148,163,184,0.3);"></div>' : '') +
      '</div>' +
    '</div>';
  });
  dayStripHtml += '</div>';

  // Stats
  var statsHtml = '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
    schedStatCard(morning.filter(function(s,i,a){ return a.findIndex(function(x){ return x.employee_name===s.employee_name; })===i; }).length, tr('sched_morning'), '#2563eb') +
    schedStatCard(evening.filter(function(s,i,a){ return a.findIndex(function(x){ return x.employee_name===s.employee_name; })===i; }).length, tr('sched_evening'), '#059669') +
    schedStatCard(totalPeople, tr('sched_on_today'), '#1e3a5f') +
  '</div>';

  // Timeline
  var timelineHtml = schedBuildTimeline(dayShifts);

  // Station cards
  var stationHtml = schedBuildStationCards(dayShifts);

  container.innerHTML = dayStripHtml + statsHtml +
    '<div style="font-size:16px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin-bottom:8px;">' + tr('sched_timeline') + '<div style="flex:1;height:0.5px;background:rgba(59,130,246,0.15);"></div></div>' +
    timelineHtml +
    '<div style="font-size:16px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin:18px 0 8px;">' + tr('sched_by_station') + '<div style="flex:1;height:0.5px;background:rgba(59,130,246,0.15);"></div></div>' +
    stationHtml;
}

function schedSelectDay(idx) {
  schedCurrentDayIndex = idx;
  schedRenderOggi(document.getElementById('schedContent'));
}

function schedGetWeekDates() {
  if (schedAllShifts.length === 0) return [];
  var dates = {};
  schedAllShifts.forEach(function(s) { if (s.date) dates[s.date] = true; });
  return Object.keys(dates).sort();
}

function schedStatCard(val, lbl, color) {
  return '<div style="flex:1;background:rgba(255,255,255,0.6);backdrop-filter:blur(12px);border:0.5px solid rgba(59,130,246,0.15);border-radius:14px;padding:10px 12px;text-align:center;">' +
    '<div style="font-size:27px;font-weight:800;color:' + color + ';line-height:1;">' + val + '</div>' +
    '<div style="font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;margin-top:3px;">' + escHtml(lbl) + '</div>' +
  '</div>';
}

// Timeline: 8am–midnight = 16h
function schedBuildTimeline(dayShifts) {
  if (dayShifts.length === 0) return '<div style="color:#94a3b8;font-size:16px;padding:16px 0;">' + tr('sched_no_shifts') + '</div>';

  var START_H = 8, TOTAL_H = 16;
  var ticks = ['8a','10','12p','2p','4p','6p','8p','CL'];

  var axisHtml = '<div style="display:flex;padding-left:76px;margin-bottom:6px;">' +
    ticks.map(function(t) { return '<div style="flex:1;font-size:17px;font-weight:600;color:#94a3b8;letter-spacing:0.04em;">' + t + '</div>'; }).join('') +
  '</div>';

  // Unique employees preserving order
  var seen = {}, rows = [];
  dayShifts.forEach(function(s) {
    if (!seen[s.employee_name]) { seen[s.employee_name] = true; rows.push(s.employee_name); }
  });

  var rowsHtml = rows.map(function(name) {
    var personShifts = dayShifts.filter(function(s) { return s.employee_name === name; });
    var bars = personShifts.map(function(s) {
      var sh = s.start_hour != null ? parseFloat(s.start_hour) : null;
      if (sh === null) return '';
      // parse end hour from end_label: "4:30 PM" → 16.5
      var eh = sh + 6;
      if (s.end_label && s.end_label !== tr('sched_close')) {
        var em = s.end_label.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
        if (em) {
          var eh2 = parseInt(em[1], 10);
          var em2 = parseInt(em[2] || '0', 10);
          if (/pm/i.test(em[3]) && eh2 < 12) eh2 += 12;
          eh = eh2 + em2 / 60;
        }
      }
      if (s.is_closing) eh = START_H + TOTAL_H;
      var left = Math.max(0, (sh - START_H) / TOTAL_H * 100);
      var width = Math.min(100 - left, (eh - sh) / TOTAL_H * 100);
      var isMorning = sh < 13;
      var barColor = isMorning
        ? 'background:rgba(37,99,235,0.12);border:0.5px solid rgba(37,99,235,0.25);'
        : 'background:rgba(5,150,105,0.12);border:0.5px solid rgba(5,150,105,0.3);';
      var lblColor = isMorning ? '#2563eb' : '#059669';
      var lbl = s.role_name || (isMorning ? tr('sched_morning') : tr('sched_evening'));
      // Color by station
      var isDish = /dish/i.test(lbl);
      if (isDish) {
        barColor = isMorning
          ? 'background:rgba(245,158,11,0.12);border:0.5px solid rgba(245,158,11,0.3);'
          : 'background:rgba(239,68,68,0.12);border:0.5px solid rgba(239,68,68,0.3);';
        lblColor = isMorning ? '#d97706' : '#dc2626';
      }
      return '<div style="position:absolute;top:4px;height:20px;border-radius:5px;left:' + left + '%;width:' + width + '%;' + barColor + 'display:flex;align-items:center;padding:0 5px;overflow:hidden;">' +
        '<span style="font-size:17px;font-weight:700;letter-spacing:0.04em;white-space:nowrap;color:' + lblColor + ';">' + escHtml(lbl) + '</span>' +
      '</div>';
    }).join('');

    var firstName = name.split(' ')[0];
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
      '<span style="width:70px;font-size:17px;font-weight:600;color:#1e3a5f;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;">' + escHtml(firstName) + '</span>' +
      '<div style="flex:1;height:28px;background:rgba(59,130,246,0.04);border-radius:6px;border:0.5px solid rgba(59,130,246,0.08);position:relative;overflow:hidden;">' + bars + '</div>' +
    '</div>';
  }).join('');

  return axisHtml + rowsHtml;
}

// Station cards — 4 fixed groups: Morning / Morning Dish / Evening / Evening Dish
function schedBuildStationCards(dayShifts) {
  if (dayShifts.length === 0) return '';

  function isDish(s) { return /dish/i.test(s.role_name || ''); }
  function isMorn(s) { return (s.start_hour != null) ? parseFloat(s.start_hour) < 13 : true; }

  // Deduplicate by employee + start_time
  var seen = {};
  var shifts = dayShifts.filter(function(s) {
    var k = s.employee_name + '|' + s.start_time;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });

  var GROUPS = [
    {
      key: 'morning',
      label: tr('sched_morning'),
      color: '#2563eb',
      bg: 'rgba(37,99,235,0.06)',
      border: 'rgba(37,99,235,0.2)',
      dotColor: '#2563eb',
      filter: function(s) { return isMorn(s) && !isDish(s); }
    },
    {
      key: 'morning-dish',
      label: tr('sched_morning_dish'),
      color: '#d97706',
      bg: 'rgba(245,158,11,0.06)',
      border: 'rgba(245,158,11,0.2)',
      dotColor: '#d97706',
      filter: function(s) { return isMorn(s) && isDish(s); }
    },
    {
      key: 'evening',
      label: tr('sched_evening'),
      color: '#059669',
      bg: 'rgba(5,150,105,0.06)',
      border: 'rgba(5,150,105,0.2)',
      dotColor: '#059669',
      filter: function(s) { return !isMorn(s) && !isDish(s); }
    },
    {
      key: 'evening-dish',
      label: tr('sched_evening_dish'),
      color: '#dc2626',
      bg: 'rgba(239,68,68,0.06)',
      border: 'rgba(239,68,68,0.2)',
      dotColor: '#dc2626',
      filter: function(s) { return !isMorn(s) && isDish(s); }
    }
  ];

  return GROUPS.map(function(grp) {
    var people = shifts.filter(grp.filter);
    if (people.length === 0) return '';

    // Sort by start_hour
    people.sort(function(a,b) { return (a.start_hour||0) - (b.start_hour||0); });

    var rowsHtml = people.map(function(s) {
      var station = s.role_name || '';
      var shiftStr = (s.start_label || '--');
      if (s.end_label) shiftStr += ' – ' + s.end_label;

      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.06);">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
          '<div style="width:7px;height:7px;border-radius:50%;background:' + grp.dotColor + ';flex-shrink:0;"></div>' +
          '<div>' +
            '<div style="font-size:17px;font-weight:600;color:#1e3a5f;">' + escHtml(s.employee_name) + '</div>' +
            (station && !/^(morning prep|evening)$/i.test(station)
              ? '<div style="font-size:16px;font-weight:600;letter-spacing:0.04em;color:' + grp.color + ';text-transform:uppercase;">' + escHtml(station) + '</div>'
              : '') +
          '</div>' +
        '</div>' +
        '<span style="font-size:17px;color:#94a3b8;font-weight:500;white-space:nowrap;">' + escHtml(shiftStr) + '</span>' +
      '</div>';
    }).join('');

    return '<div style="background:rgba(255,255,255,0.6);backdrop-filter:blur(12px);border:0.5px solid ' + grp.border + ';border-radius:16px;overflow:hidden;margin-bottom:10px;">' +
      '<div style="padding:9px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:0.5px solid ' + grp.border + ';background:' + grp.bg + ';">' +
        '<span style="font-size:16px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:' + grp.color + ';">' + grp.label + '</span>' +
        '<span style="font-size:16px;font-weight:700;color:' + grp.color + ';background:' + grp.bg + ';padding:2px 8px;border-radius:20px;border:0.5px solid ' + grp.border + ';">' + people.length + '</span>' +
      '</div>' +
      '<div style="padding:4px 14px;">' + rowsHtml + '</div>' +
    '</div>';
  }).join('');
}

// ── WEEK VIEW ─────────────────────────────────────────────
function schedRenderSettimana(container) {
  var weekDates = schedGetWeekDates();
  if (weekDates.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px 0;">' + tr('sched_no_data') + '</div>';
    return;
  }

  // Get unique employees
  var empMap = {};
  schedAllShifts.forEach(function(s) { empMap[s.employee_name] = true; });
  var employees = Object.keys(empMap).sort();

  // Day headers
  var dayAbbrs = weekDates.map(function(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  });

  // Legend
  var legendHtml = '<div style="display:flex;gap:14px;padding:0 0 10px;align-items:center;">' +
    '<div style="display:flex;align-items:center;gap:5px;font-size:16px;color:#94a3b8;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:rgba(37,99,235,0.3);"></div>M = Morning</div>' +
    '<div style="display:flex;align-items:center;gap:5px;font-size:16px;color:#94a3b8;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:rgba(5,150,105,0.3);"></div>E = Evening</div>' +
    '<div style="display:flex;align-items:center;gap:5px;font-size:16px;color:#94a3b8;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:rgba(30,58,95,0.2);"></div>D = Double</div>' +
  '</div>';

  // Build grid
  var thCells = '<th style="text-align:left;min-width:88px;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#94a3b8;padding:6px 6px;border-bottom:0.5px solid rgba(59,130,246,0.12);">Name</th>' +
    dayAbbrs.map(function(d) {
      return '<th style="text-align:center;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#94a3b8;padding:6px 6px;border-bottom:0.5px solid rgba(59,130,246,0.12);">' + d + '</th>';
    }).join('') +
    '<th style="text-align:right;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#94a3b8;padding:6px 6px;border-bottom:0.5px solid rgba(59,130,246,0.12);">HRS</th>';

  var rowsHtml = employees.map(function(emp) {
    var empShifts = schedAllShifts.filter(function(s) { return s.employee_name === emp; });
    var payHrs = empShifts[0] && empShifts[0].payable_hours ? empShifts[0].payable_hours : null;

    var cells = weekDates.map(function(d) {
      var dayS = empShifts.filter(function(s) { return s.date === d; });
      if (dayS.length === 0) return '<td style="text-align:center;padding:4px;border-bottom:0.5px solid rgba(59,130,246,0.05);"><span style="color:rgba(148,163,184,0.4);font-size:16px;font-weight:700;">—</span></td>';
      var types = dayS.map(function(s) { return s.shift_type; });
      var isDouble = types.indexOf('double') >= 0 || (types.indexOf('morning') >= 0 && types.indexOf('evening') >= 0);
      var isEvening = !isDouble && types.indexOf('evening') >= 0;
      var label = isDouble ? 'D' : (isEvening ? 'E' : 'M');
      var chipStyle = isDouble
        ? 'background:linear-gradient(135deg,rgba(37,99,235,0.1),rgba(5,150,105,0.1));color:#1e3a5f;border:0.5px solid rgba(30,58,95,0.15);'
        : (isEvening
          ? 'background:rgba(5,150,105,0.1);color:#059669;border:0.5px solid rgba(5,150,105,0.2);'
          : 'background:rgba(37,99,235,0.1);color:#2563eb;border:0.5px solid rgba(37,99,235,0.2);');
      return '<td style="text-align:center;padding:4px;border-bottom:0.5px solid rgba(59,130,246,0.05);">' +
        '<span style="display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;padding:3px 6px;border-radius:6px;min-width:26px;' + chipStyle + '">' + label + '</span>' +
      '</td>';
    }).join('');

    return '<tr>' +
      '<td style="text-align:left;font-size:16px;font-weight:600;color:#1e3a5f;white-space:nowrap;padding:4px 6px;border-bottom:0.5px solid rgba(59,130,246,0.05);">' + escHtml(emp) + '</td>' +
      cells +
      '<td style="text-align:right;font-size:16px;font-weight:700;color:#94a3b8;padding:4px 6px;border-bottom:0.5px solid rgba(59,130,246,0.05);">' + (payHrs || '') + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML = legendHtml +
    '<div style="overflow-x:auto;scrollbar-width:none;">' +
    '<table style="width:100%;border-collapse:collapse;min-width:' + (weekDates.length * 40 + 130) + 'px;">' +
    '<thead><tr>' + thCells + '</tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '</table></div>';
}

// ── UTILITIES ─────────────────────────────────────────────
function schedFmtTime(hhmm) {
  if (!hhmm) return '';
  var parts = hhmm.split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1] || '0', 10);
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + (m > 0 ? ':' + String(m).padStart(2,'0') : '') + ' ' + ampm;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Legacy syncSevenShift — now replaced by CSV import
async function syncSevenShift() { schedOpenCsvImport(); }

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var tabSched = document.getElementById('tabSchedule');
  if (!tabSched) return;
  tabSched.addEventListener('click', function() {
    document.querySelectorAll('main section[id^="v"]').forEach(function(s) { s.classList.add('hidden'); });
    var vsched = document.getElementById('vsched');
    if (vsched) vsched.classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.remove('tab-active'); t.classList.add('text-slate-500');
      var svg = t.querySelector('svg'); if (svg) svg.style.stroke = '';
      var sp = t.querySelector('.tab-label'); if (sp) sp.style.color = '';
    });
    tabSched.classList.add('tab-active'); tabSched.classList.remove('text-slate-500');
    var svg = tabSched.querySelector('svg'); if (svg) svg.style.stroke = '#059669';
    var sp = tabSched.querySelector('.tab-label'); if (sp) sp.style.color = '#059669';
    schedLoadData();
  });

  // Update sync button label
  var btn = document.getElementById('schedSyncBtn');
  if (btn) btn.textContent = tr('sched_import');
});

// ══════════════════════════════════════════════════════════════
// SCHEDULE GENERATOR — Brigade auto-schedule da staff_profiles/stations
// ══════════════════════════════════════════════════════════════

var schedGenExceptions = []; // [{name, from, to}]
var schedGenResult = null;   // schedule generato
var schedGenView = 'day';    // 'day' | 'week'
var schedGenDayIdx = 0;

var SGEN_DAYS_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var SGEN_DAYS_IT   = ['Lun','Mar','Mer','Gio','Ven','Sab'];

var SGEN_AM_STATIONS = ['Oven Station','Sauté Station','Pasta Station','Salad Station','Fresh Pasta Station','Saucier Station','Coordinator Station','Dish Crew'];
var SGEN_PM_STATIONS = ['Oven Station','Pasta Station','Salad Station','Sauté Station','Plating Station','Table Side','Grill & Features','Dish Crew'];

// Candidati ordinati per priorità (aggiornati da DB staff_stations)
var SGEN_CANDIDATES = {
  morning: {
    'Oven Station':          ['Rachel','Genova','Anto','Samantha'],
    'Sauté Station':         ['Genova','Rachel','Colton','Anto'],
    'Pasta Station':         ['Chris','Anto','Colton'],
    'Salad Station':         ['Zuu','Anto','Samantha','Colton'],
    'Fresh Pasta Station':   ['Todd','Anto','Samantha'],
    'Saucier Station':       ['Chris','Colton','Anto'],
    'Coordinator Station':   ['Tela'],
    'Pastry Station':        ['Todd','Samantha','Anto'],
    'Dish Crew':             ['__DISH__'],
  },
  evening: {
    'Oven Station':          ['Haley','Genova','Chance'],
    'Pasta Station':         ['Maddie','Max','Colton','David'],
    'Salad Station':         ['Preston','Haley','Samantha','David','Colton'],
    'Sauté Station':         ['Chance','Colton','Genova'],
    'Plating Station':       ['Sofia','Samantha','Tela','Preston','Genova'],
    'Table Side':            ['David','Colton'],
    'Grill & Features':      ['Rachel','Max','Colton','Chance','David'],
    'Dish Crew':             ['__DISH__'],
  }
};

var SGEN_CONSTRAINTS = {
  Max:      { off:['Monday'],                       noEve:[], only:[], double:false },
  Anto:     { off:['Monday'],                       noEve:[], only:[], double:false },
  Colton:   { off:[],                               noEve:['Wednesday'], only:[], double:false },
  Tela:     { off:[],                               noEve:['Wednesday'], only:[], double:false },
  Samantha: { off:[],                               noEve:['Wednesday'], only:[], double:false },
  Rachel:   { off:['Friday','Saturday'],            noEve:[], only:['Monday','Tuesday','Wednesday','Thursday'], double:true },
  Todd:     { off:['Thursday','Friday','Saturday'], noEve:[], only:['Monday','Tuesday','Wednesday'], double:false },
  Zuu:      { off:[],                               noEve:[], only:[], double:false },
  Chris:    { off:[],                               noEve:['Wednesday'], only:[], double:false },
  Genova:   { off:['Saturday'],                     noEve:[], only:[], double:false },
  David:    { off:['Tuesday'],                      noEve:[], only:[], double:false },
  Sofia:    { off:[],                               noEve:[], only:[], double:false },
  Maddie:   { off:[],                               noEve:['Wednesday'], only:[], double:false },
  Preston:  { off:[],                               noEve:[], only:[], double:false },
  Haley:    { off:[],                               noEve:[], only:[], double:false },
  Chance:   { off:['Tuesday'],                      noEve:[], only:[], double:false },
};

var SGEN_FIXED = {
  morning: {
    'Coordinator Station': 'Tela',
    'Salad Station':       'Zuu',
  },
  evening: {
    'Table Side':       { Monday:'David', Wednesday:'David', Thursday:'David', Friday:'David', Saturday:'David', Tuesday:'Colton' },
    'Grill & Features': { Monday:'Rachel', Tuesday:'Rachel', Wednesday:'Rachel', Thursday:'Max', Friday:'Max', Saturday:'Max' },
    'Pasta Station':    { Wednesday:'Max' },
  }
};

// Controlla se persona è disponibile quel giorno/turno (vincoli fissi + eccezioni temporanee)
function sgenIsAvailable(name, day, shift, weekDates, exceptions) {
  if (name === '__DISH__') return true;
  var c = SGEN_CONSTRAINTS[name];
  if (!c) return true;
  if (c.off.indexOf(day) >= 0) return false;
  if (shift === 'evening' && c.noEve.indexOf(day) >= 0) return false;
  if (c.only.length > 0 && c.only.indexOf(day) < 0) return false;
  // Eccezioni temporanee settimana
  var dateStr = weekDates[SGEN_DAYS_FULL.indexOf(day)];
  if (dateStr) {
    for (var i = 0; i < exceptions.length; i++) {
      var ex = exceptions[i];
      if (ex.name === name && dateStr >= ex.from && dateStr <= ex.to) return false;
    }
  }
  return true;
}

function sgenResolveFixed(st, shift, day) {
  var rule = SGEN_FIXED[shift] && SGEN_FIXED[shift][st];
  if (!rule) return null;
  if (typeof rule === 'string') return rule;
  return rule[day] || null;
}

function sgenGenerate(weekDates, exceptions) {
  var sched = {};
  SGEN_DAYS_FULL.forEach(function(day) {
    var usedAm = {}, usedPm = {}, am = {}, pm = {}, warnings = [];

    // MATTINA
    var amList = SGEN_AM_STATIONS.slice();
    if (['Monday','Wednesday','Friday'].indexOf(day) >= 0) amList.push('Pastry Station');

    amList.forEach(function(st) {
      var fixed = sgenResolveFixed(st, 'morning', day);
      if (fixed) {
        if (sgenIsAvailable(fixed, day, 'morning', weekDates, exceptions) && !usedAm[fixed]) {
          am[st] = { name: fixed }; usedAm[fixed] = true; return;
        }
      }
      var cands = SGEN_CANDIDATES.morning[st] || [];
      for (var i = 0; i < cands.length; i++) {
        var name = cands[i];
        if (name === '__DISH__') { am[st] = { name:'Dish Crew', dish:true }; return; }
        if (sgenIsAvailable(name, day, 'morning', weekDates, exceptions) && !usedAm[name]) {
          am[st] = { name: name }; usedAm[name] = true; return;
        }
      }
      am[st] = null;
      if (st !== 'Pastry Station') warnings.push(st.replace(' Station','') + ' mattina');
    });

    // SERA
    SGEN_PM_STATIONS.forEach(function(st) {
      var fixed = sgenResolveFixed(st, 'evening', day);
      if (fixed) {
        if (sgenIsAvailable(fixed, day, 'evening', weekDates, exceptions) && !usedPm[fixed]) {
          var isDouble = SGEN_CONSTRAINTS[fixed] && SGEN_CONSTRAINTS[fixed].double && usedAm[fixed];
          pm[st] = { name: fixed, double: !!isDouble }; usedPm[fixed] = true; return;
        }
      }
      var cands = SGEN_CANDIDATES.evening[st] || [];
      for (var i = 0; i < cands.length; i++) {
        var name = cands[i];
        if (name === '__DISH__') { pm[st] = { name:'Dish Crew', dish:true }; return; }
        if (sgenIsAvailable(name, day, 'evening', weekDates, exceptions) && !usedPm[name]) {
          var isDouble = SGEN_CONSTRAINTS[name] && SGEN_CONSTRAINTS[name].double && usedAm[name];
          pm[st] = { name: name, double: !!isDouble }; usedPm[name] = true; return;
        }
      }
      pm[st] = null;
      warnings.push(st.replace(' Station','') + ' sera');
    });

    sched[day] = { am: am, pm: pm, warnings: warnings };
  });
  return sched;
}

// ── RENDER PANNELLO ECCEZIONI ─────────────────────────────
function schedRenderGeneratore(container) {
  var staffNames = Object.keys(SGEN_CONSTRAINTS).sort();

  // Calcola settimana corrente (lunedì → sabato)
  var now = new Date();
  var dow = now.getDay();
  var monday = new Date(now);
  // Prossima settimana: lunedì della settimana prossima
  var daysToNextMonday = dow === 0 ? 1 : (8 - dow);
  monday.setDate(now.getDate() + daysToNextMonday);
  var weekDates = [];
  for (var i = 0; i < 6; i++) {
    var d = new Date(monday); d.setDate(monday.getDate() + i);
    weekDates.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'));
  }
  window._sgenWeekDates = weekDates;
  var weekLabel = monday.toLocaleDateString('it-IT', { day:'numeric', month:'long' });

  var exRows = schedGenExceptions.map(function(ex, idx) {
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;" id="exrow_'+idx+'">' +
      '<span style="flex:1;font-size:13px;font-weight:600;color:#1e3a5f;">'+escHtml(ex.name)+'</span>' +
      '<span style="font-size:12px;color:#64748b;">'+ex.from+' → '+ex.to+'</span>' +
      '<button onclick="sgenRemoveException('+idx+')" style="width:24px;height:24px;border-radius:50%;border:none;background:#fee2e2;color:#ef4444;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">×</button>' +
    '</div>';
  }).join('');

  container.innerHTML =
    '<div style="background:white;border-radius:14px;padding:14px;margin-bottom:12px;border:0.5px solid #e2e8f0;">' +
      '<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:2px;">📅 Genera Schedule</div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">Settimana del '+escHtml(weekLabel)+'</div>' +

      // Eccezioni inserite
      (exRows ? '<div style="margin-bottom:10px;">'+exRows+'</div>' : '') +

      // Form nuova eccezione
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
        '<select id="sgenName" style="flex:1;min-width:100px;font-size:13px;border:0.5px solid #e2e8f0;border-radius:8px;padding:7px 8px;background:white;color:#1e3a5f;">' +
          '<option value="">— Persona —</option>' +
          staffNames.map(function(n){ return '<option>'+escHtml(n)+'</option>'; }).join('') +
        '</select>' +
        '<input type="date" id="sgenFrom" value="'+weekDates[0]+'" style="font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:7px 6px;color:#1e3a5f;width:130px;">' +
        '<input type="date" id="sgenTo" value="'+weekDates[5]+'" style="font-size:12px;border:0.5px solid #e2e8f0;border-radius:8px;padding:7px 6px;color:#1e3a5f;width:130px;">' +
        '<button onclick="sgenAddException()" style="padding:7px 12px;border-radius:8px;border:none;background:#f1f5f9;color:#1e3a5f;font-size:12px;font-weight:600;cursor:pointer;">+ Aggiungi</button>' +
      '</div>' +

      '<button onclick="sgenRunGenerate()" style="width:100%;margin-top:12px;padding:11px;border-radius:10px;border:none;background:#1e3a5f;color:white;font-size:14px;font-weight:700;cursor:pointer;">✦ Genera Schedule</button>' +
    '</div>' +

    // Risultato
    '<div id="sgenResult"></div>';

  // Se c'è già un risultato, mostralo subito
  if (schedGenResult) { sgenRenderResult(); }
}

function sgenAddException() {
  var name = document.getElementById('sgenName') && document.getElementById('sgenName').value;
  var from = document.getElementById('sgenFrom') && document.getElementById('sgenFrom').value;
  var to   = document.getElementById('sgenTo')   && document.getElementById('sgenTo').value;
  if (!name || !from || !to) { alert('Seleziona persona e date'); return; }
  if (from > to) { alert('Data inizio > data fine'); return; }
  schedGenExceptions.push({ name: name, from: from, to: to });
  schedRender();
}

function sgenRemoveException(idx) {
  schedGenExceptions.splice(idx, 1);
  schedRender();
}

function sgenRunGenerate() {
  var weekDates = window._sgenWeekDates || [];
  schedGenResult = sgenGenerate(weekDates, schedGenExceptions);
  schedGenDayIdx = 0;
  schedGenView = 'day';
  sgenRenderResult();
}

function sgenRenderResult() {
  var container = document.getElementById('sgenResult');
  if (!container || !schedGenResult) return;

  var weekDates = window._sgenWeekDates || [];

  // Tab day/week
  container.innerHTML =
    '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
      '<button onclick="schedGenView=\'day\';sgenRenderResult()" style="flex:1;padding:7px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:'+(schedGenView==='day'?'#1e3a5f':'#f1f5f9')+';color:'+(schedGenView==='day'?'white':'#64748b')+';"> 📆 Giornaliero</button>' +
      '<button onclick="schedGenView=\'week\';sgenRenderResult()" style="flex:1;padding:7px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:'+(schedGenView==='week'?'#1e3a5f':'#f1f5f9')+';color:'+(schedGenView==='week'?'white':'#64748b')+';"> 📊 Settimanale</button>' +
    '</div>';

  if (schedGenView === 'day') { sgenRenderDay(container, weekDates); }
  else { sgenRenderWeek(container, weekDates); }
}

function sgenRenderDay(container, weekDates) {
  // Day strip
  var strip = '<div style="display:flex;gap:5px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;margin-bottom:10px;">';
  SGEN_DAYS_IT.forEach(function(d, i) {
    var active = i === schedGenDayIdx;
    var dateStr = weekDates[i] || '';
    var dayNum = dateStr ? parseInt(dateStr.split('-')[2], 10) : '';
    strip += '<div onclick="schedGenDayIdx='+i+';sgenRenderResult()" style="display:flex;flex-direction:column;align-items:center;padding:6px 10px;border-radius:10px;min-width:42px;cursor:pointer;flex-shrink:0;border:0.5px solid '+(active?'#1e3a5f':'#e2e8f0')+';background:'+(active?'#1e3a5f':'white')+';"><span style="font-size:9px;font-weight:700;text-transform:uppercase;color:'+(active?'rgba(255,255,255,0.7)':'#94a3b8')+';">'+d+'</span><span style="font-size:17px;font-weight:700;color:'+(active?'white':'#1e3a5f')+';">'+dayNum+'</span></div>';
  });
  strip += '</div>';
  container.innerHTML += strip;

  var day = SGEN_DAYS_FULL[schedGenDayIdx];
  var data = schedGenResult[day];
  if (!data) return;

  var amCount = 0, pmCount = 0;
  Object.values(data.am).forEach(function(v){ if(v && !v.dish) amCount++; });
  Object.values(data.pm).forEach(function(v){ if(v && !v.dish) pmCount++; });

  var html = '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
    '<div style="flex:1;background:white;border:0.5px solid #e2e8f0;border-radius:10px;padding:7px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#3b82f6;">'+amCount+'</div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Mattina</div></div>' +
    '<div style="flex:1;background:white;border:0.5px solid #e2e8f0;border-radius:10px;padding:7px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#059669;">'+pmCount+'</div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Sera</div></div>' +
    '<div style="flex:1;background:white;border:0.5px solid #e2e8f0;border-radius:10px;padding:7px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#1e3a5f;">'+(amCount+pmCount)+'</div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">Totale</div></div>' +
  '</div>';

  data.warnings.forEach(function(w){ html += '<div style="background:#fef9c3;border:0.5px solid #fde68a;border-radius:9px;padding:7px 11px;margin-bottom:6px;font-size:11px;color:#92400e;">⚠️ '+escHtml(w)+' — non coperta</div>'; });

  // Mattina
  html += '<div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin:10px 0 7px;"><span>🌅 Mattina</span><div style="flex:1;height:0.5px;background:#e2e8f0;"></div><span style="font-size:9px;">8:00–14:00</span></div>';
  Object.entries(data.am).forEach(function(kv) {
    var st = kv[0], v = kv[1];
    var stName = st.replace(' Station','');
    if (!v) {
      html += '<div style="background:white;border-radius:11px;padding:9px 12px;margin-bottom:5px;display:flex;align-items:center;gap:10px;border:0.5px solid #fecaca;"><div style="width:7px;height:7px;border-radius:50%;background:#ef4444;flex-shrink:0;"></div><div><div style="font-size:13px;font-weight:600;color:#1e3a5f;">'+escHtml(stName)+'</div><div style="font-size:12px;color:#ef4444;font-style:italic;margin-top:1px;">Non coperta</div></div></div>';
    } else {
      html += '<div style="background:white;border-radius:11px;padding:9px 12px;margin-bottom:5px;display:flex;align-items:center;gap:10px;border:0.5px solid #e2e8f0;"><div style="width:7px;height:7px;border-radius:50%;background:'+(v.dish?'#94a3b8':'#3b82f6')+';flex-shrink:0;"></div><div><div style="font-size:13px;font-weight:600;color:#1e3a5f;">'+escHtml(stName)+'</div><div style="font-size:12px;color:'+(v.dish?'#94a3b8':'#059669')+';font-weight:500;margin-top:1px;">'+escHtml(v.name)+'</div></div></div>';
    }
  });

  // Sera
  var isWeekend = ['Friday','Saturday'].indexOf(day) >= 0;
  html += '<div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin:10px 0 7px;"><span>🌆 Sera</span><div style="flex:1;height:0.5px;background:#e2e8f0;"></div><span style="font-size:9px;">'+(isWeekend?'14:00–22:30':'14:00–21:30')+'</span></div>';
  Object.entries(data.pm).forEach(function(kv) {
    var st = kv[0], v = kv[1];
    var stName = st.replace(' Station','');
    if (!v) {
      html += '<div style="background:white;border-radius:11px;padding:9px 12px;margin-bottom:5px;display:flex;align-items:center;gap:10px;border:0.5px solid #fecaca;"><div style="width:7px;height:7px;border-radius:50%;background:#ef4444;flex-shrink:0;"></div><div><div style="font-size:13px;font-weight:600;color:#1e3a5f;">'+escHtml(stName)+'</div><div style="font-size:12px;color:#ef4444;font-style:italic;margin-top:1px;">Non coperta</div></div></div>';
    } else {
      html += '<div style="background:white;border-radius:11px;padding:9px 12px;margin-bottom:5px;display:flex;align-items:center;gap:10px;border:0.5px solid #e2e8f0;"><div style="width:7px;height:7px;border-radius:50%;background:'+(v.dish?'#94a3b8':'#059669')+';flex-shrink:0;"></div><div><div style="font-size:13px;font-weight:600;color:#1e3a5f;">'+escHtml(stName)+'</div><div style="font-size:12px;color:'+(v.dish?'#94a3b8':'#059669')+';font-weight:500;margin-top:1px;">'+escHtml(v.name)+(v.double?' <span style="font-size:9px;font-weight:700;background:#fef3c7;color:#92400e;border-radius:5px;padding:1px 4px;margin-left:3px;">2x</span>':'')+'</div></div></div>';
    }
  });

  container.innerHTML += html;
}

function sgenRenderWeek(container, weekDates) {
  var sched = schedGenResult;
  var allStations = { morning: [...SGEN_AM_STATIONS, 'Pastry Station'], evening: SGEN_PM_STATIONS };
  var dayNums = weekDates.map(function(d){ return d ? parseInt(d.split('-')[2],10) : ''; });

  var html = '<div style="overflow-x:auto;scrollbar-width:none;">';
  html += '<div style="min-width:480px;">';

  // Header
  html += '<div style="display:grid;grid-template-columns:90px repeat(6,1fr);gap:3px;margin-bottom:4px;">';
  html += '<div></div>';
  SGEN_DAYS_IT.forEach(function(d,i){
    html += '<div style="font-size:9px;font-weight:700;color:#94a3b8;text-align:center;text-transform:uppercase;letter-spacing:0.05em;">'+d+'<br><span style="font-size:9px;color:#cbd5e1;">'+dayNums[i]+'</span></div>';
  });
  html += '</div>';

  // Mattina
  html += '<div style="margin:6px 0 4px;"><span style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:white;background:#3b82f6;padding:3px 8px;border-radius:5px;">🌅 MATTINA</span></div>';
  allStations.morning.forEach(function(st) {
    var stName = st.replace(' Station','');
    html += '<div style="display:grid;grid-template-columns:90px repeat(6,1fr);gap:3px;margin-bottom:3px;">';
    html += '<div style="font-size:10px;font-weight:600;color:#1e3a5f;display:flex;align-items:center;padding:0 3px;line-height:1.2;">'+escHtml(stName)+'</div>';
    SGEN_DAYS_FULL.forEach(function(day) {
      if (st === 'Pastry Station' && ['Monday','Wednesday','Friday'].indexOf(day) < 0) {
        html += '<div style="background:#f8fafc;border-radius:5px;padding:3px 2px;text-align:center;font-size:9px;color:#cbd5e1;border:0.5px solid #f1f5f9;min-height:24px;display:flex;align-items:center;justify-content:center;">—</div>';
        return;
      }
      var v = sched[day] && sched[day].am[st];
      if (!v) {
        html += '<div style="background:#fef2f2;border-radius:5px;padding:3px 2px;text-align:center;font-size:9px;color:#ef4444;border:0.5px solid #fecaca;min-height:24px;display:flex;align-items:center;justify-content:center;">?</div>';
      } else if (v.dish) {
        html += '<div style="background:#f0f9ff;border-radius:5px;padding:3px 2px;text-align:center;font-size:9px;color:#0ea5e9;border:0.5px solid #e0f2fe;min-height:24px;display:flex;align-items:center;justify-content:center;">Dish</div>';
      } else {
        html += '<div style="background:white;border-radius:5px;padding:3px 2px;text-align:center;font-size:10px;font-weight:600;color:#1e3a5f;border:0.5px solid #e2e8f0;min-height:24px;display:flex;align-items:center;justify-content:center;">'+escHtml(v.name)+'</div>';
      }
    });
    html += '</div>';
  });

  // Sera
  html += '<div style="margin:10px 0 4px;"><span style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:white;background:#059669;padding:3px 8px;border-radius:5px;">🌆 SERA</span></div>';
  allStations.evening.forEach(function(st) {
    var stName = st.replace(' Station','');
    html += '<div style="display:grid;grid-template-columns:90px repeat(6,1fr);gap:3px;margin-bottom:3px;">';
    html += '<div style="font-size:10px;font-weight:600;color:#1e3a5f;display:flex;align-items:center;padding:0 3px;line-height:1.2;">'+escHtml(stName)+'</div>';
    SGEN_DAYS_FULL.forEach(function(day) {
      var v = sched[day] && sched[day].pm[st];
      if (!v) {
        html += '<div style="background:#fef2f2;border-radius:5px;padding:3px 2px;text-align:center;font-size:9px;color:#ef4444;border:0.5px solid #fecaca;min-height:24px;display:flex;align-items:center;justify-content:center;">?</div>';
      } else if (v.dish) {
        html += '<div style="background:#f0f9ff;border-radius:5px;padding:3px 2px;text-align:center;font-size:9px;color:#0ea5e9;border:0.5px solid #e0f2fe;min-height:24px;display:flex;align-items:center;justify-content:center;">Dish</div>';
      } else {
        html += '<div style="background:'+(v.double?'#fefce8':'white')+';border-radius:5px;padding:3px 2px;text-align:center;font-size:10px;font-weight:600;color:'+(v.double?'#92400e':'#1e3a5f')+';border:0.5px solid '+(v.double?'#fde68a':'#e2e8f0')+';min-height:24px;display:flex;align-items:center;justify-content:center;">'+escHtml(v.name)+(v.double?' 🔄':'')+'</div>';
      }
    });
    html += '</div>';
  });

  html += '</div></div>';
  container.innerHTML += html;
}
