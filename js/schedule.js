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
  if (view === 'oggi') {
    btnOggi.style.background = '#1e3a5f'; btnOggi.style.color = 'white'; btnOggi.style.border = 'none';
    btnSett.style.background = 'white'; btnSett.style.color = '#1e3a5f'; btnSett.style.border = '1.5px solid #1e3a5f';
  } else {
    btnSett.style.background = '#1e3a5f'; btnSett.style.color = 'white'; btnSett.style.border = 'none';
    btnOggi.style.background = 'white'; btnOggi.style.color = '#1e3a5f'; btnOggi.style.border = '1.5px solid #1e3a5f';
  }
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
        start_time: dc.date + 'T' + parsed.startStr + ':00',
        end_time: parsed.endStr ? (dc.date + 'T' + parsed.endStr + ':00') : null,
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
          start_time: dc.date + 'T' + parsed.start2Str + ':00',
          end_time: parsed.end2Str ? (dc.date + 'T' + parsed.end2Str + ':00') : null,
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
  if (schedAllShifts.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px 0;font-size:14px;">' + tr('sched_no_data') + '</div>';
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
      '<span style="font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:' + (isSelected ? '#059669' : '#94a3b8') + ';">' +
        (function(){var days=tr('sched_days');var di=d.getDay();return Array.isArray(days)?days[di===0?6:di-1]:d.toLocaleDateString('en-US',{weekday:'short'});})() + '</span>' +
      '<span style="font-size:18px;font-weight:700;color:#1e3a5f;line-height:1.1;">' + d.getDate() + '</span>' +
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
    '<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin-bottom:8px;">' + tr('sched_timeline') + '<div style="flex:1;height:0.5px;background:rgba(59,130,246,0.15);"></div></div>' +
    timelineHtml +
    '<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin:18px 0 8px;">' + tr('sched_by_station') + '<div style="flex:1;height:0.5px;background:rgba(59,130,246,0.15);"></div></div>' +
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
    '<div style="font-size:24px;font-weight:800;color:' + color + ';line-height:1;">' + val + '</div>' +
    '<div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;margin-top:3px;">' + escHtml(lbl) + '</div>' +
  '</div>';
}

// Timeline: 8am–midnight = 16h
function schedBuildTimeline(dayShifts) {
  if (dayShifts.length === 0) return '<div style="color:#94a3b8;font-size:13px;padding:16px 0;">' + tr('sched_no_shifts') + '</div>';

  var START_H = 8, TOTAL_H = 16;
  var ticks = ['8a','10','12p','2p','4p','6p','8p','CL'];

  var axisHtml = '<div style="display:flex;padding-left:76px;margin-bottom:6px;">' +
    ticks.map(function(t) { return '<div style="flex:1;font-size:8px;font-weight:600;color:#94a3b8;letter-spacing:0.04em;">' + t + '</div>'; }).join('') +
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
      return '<div style="position:absolute;top:3px;height:18px;border-radius:5px;left:' + left + '%;width:' + width + '%;' + barColor + 'display:flex;align-items:center;padding:0 5px;overflow:hidden;">' +
        '<span style="font-size:8px;font-weight:700;letter-spacing:0.04em;white-space:nowrap;color:' + lblColor + ';">' + escHtml(lbl) + '</span>' +
      '</div>';
    }).join('');

    var firstName = name.split(' ')[0];
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
      '<span style="width:70px;font-size:11px;font-weight:600;color:#1e3a5f;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;">' + escHtml(firstName) + '</span>' +
      '<div style="flex:1;height:24px;background:rgba(59,130,246,0.04);border-radius:6px;border:0.5px solid rgba(59,130,246,0.08);position:relative;overflow:hidden;">' + bars + '</div>' +
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
            '<div style="font-size:14px;font-weight:600;color:#1e3a5f;">' + escHtml(s.employee_name) + '</div>' +
            (station && !/^(morning prep|evening)$/i.test(station)
              ? '<div style="font-size:10px;font-weight:600;letter-spacing:0.04em;color:' + grp.color + ';text-transform:uppercase;">' + escHtml(station) + '</div>'
              : '') +
          '</div>' +
        '</div>' +
        '<span style="font-size:11px;color:#94a3b8;font-weight:500;white-space:nowrap;">' + escHtml(shiftStr) + '</span>' +
      '</div>';
    }).join('');

    return '<div style="background:rgba(255,255,255,0.6);backdrop-filter:blur(12px);border:0.5px solid ' + grp.border + ';border-radius:16px;overflow:hidden;margin-bottom:10px;">' +
      '<div style="padding:9px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:0.5px solid ' + grp.border + ';background:' + grp.bg + ';">' +
        '<span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:' + grp.color + ';">' + grp.label + '</span>' +
        '<span style="font-size:10px;font-weight:700;color:' + grp.color + ';background:' + grp.bg + ';padding:2px 8px;border-radius:20px;border:0.5px solid ' + grp.border + ';">' + people.length + '</span>' +
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
    '<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#94a3b8;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:rgba(37,99,235,0.3);"></div>M = Morning</div>' +
    '<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#94a3b8;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:rgba(5,150,105,0.3);"></div>E = Evening</div>' +
    '<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#94a3b8;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:rgba(30,58,95,0.2);"></div>D = Double</div>' +
  '</div>';

  // Build grid
  var thCells = '<th style="text-align:left;min-width:88px;font-size:9px;font-weight:700;letter-spacing:0.1em;color:#94a3b8;padding:6px 6px;border-bottom:0.5px solid rgba(59,130,246,0.12);">Name</th>' +
    dayAbbrs.map(function(d) {
      return '<th style="text-align:center;font-size:9px;font-weight:700;letter-spacing:0.1em;color:#94a3b8;padding:6px 6px;border-bottom:0.5px solid rgba(59,130,246,0.12);">' + d + '</th>';
    }).join('') +
    '<th style="text-align:right;font-size:9px;font-weight:700;letter-spacing:0.1em;color:#94a3b8;padding:6px 6px;border-bottom:0.5px solid rgba(59,130,246,0.12);">HRS</th>';

  var rowsHtml = employees.map(function(emp) {
    var empShifts = schedAllShifts.filter(function(s) { return s.employee_name === emp; });
    var payHrs = empShifts[0] && empShifts[0].payable_hours ? empShifts[0].payable_hours : null;

    var cells = weekDates.map(function(d) {
      var dayS = empShifts.filter(function(s) { return s.date === d; });
      if (dayS.length === 0) return '<td style="text-align:center;padding:4px;border-bottom:0.5px solid rgba(59,130,246,0.05);"><span style="color:rgba(148,163,184,0.4);font-size:10px;font-weight:700;">—</span></td>';
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
        '<span style="display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;padding:3px 6px;border-radius:6px;min-width:26px;' + chipStyle + '">' + label + '</span>' +
      '</td>';
    }).join('');

    return '<tr>' +
      '<td style="text-align:left;font-size:13px;font-weight:600;color:#1e3a5f;white-space:nowrap;padding:4px 6px;border-bottom:0.5px solid rgba(59,130,246,0.05);">' + escHtml(emp) + '</td>' +
      cells +
      '<td style="text-align:right;font-size:10px;font-weight:700;color:#94a3b8;padding:4px 6px;border-bottom:0.5px solid rgba(59,130,246,0.05);">' + (payHrs || '') + '</td>' +
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
