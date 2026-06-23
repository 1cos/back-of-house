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
    el.textContent = 'Updated: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
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
  if (btn) { btn.textContent = 'Importing...'; btn.disabled = true; }

  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  if (lines.length < 2) {
    alert('CSV vuoto o non valido');
    if (btn) { btn.textContent = 'Import CSV'; btn.disabled = false; }
    return;
  }

  // Parse header
  var headers = schedCsvSplit(lines[0]);

  // Find column indexes
  var iName = schedColIdx(headers, ['Name', 'Employee Name', 'employee_name', 'Full Name']);
  var iRole = schedColIdx(headers, ['Role', 'role_name', 'Position', 'Job']);
  var iDept = schedColIdx(headers, ['Department', 'department_name', 'Station']);
  var iHrs  = schedColIdx(headers, ['Payable Hours', 'Total Hours', 'Hours', 'payable_hours', 'Paid Hours']);

  // Day columns: supports both "Mon 6/23" and full "Monday"/"Tuesday" formats
  var DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var DAY_ABBR  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Find the week start: look for a date header or use current Monday
  var dayCols = [];

  // Try format: "Mon 6/23" or "Mon, 6/23"
  headers.forEach(function(h, idx) {
    var m = h.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[,\s]+(\d{1,2})\/(\d{1,2})/i);
    if (m) {
      var year = new Date().getFullYear();
      var month = parseInt(m[2], 10);
      var day = parseInt(m[3], 10);
      var dateObj = new Date(year, month - 1, day);
      dayCols.push({ idx: idx, date: dateObj.toISOString().split('T')[0], dow: dateObj.getDay() });
    }
  });

  // If no date headers found, try full day names: Monday, Tuesday...
  if (dayCols.length === 0) {
    // Find the Monday of the current week as anchor
    var now = new Date();
    var anchor = new Date(now);
    var dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    var diffToMon = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek;
    anchor.setDate(now.getDate() + diffToMon);

    headers.forEach(function(h, idx) {
      var hClean = h.trim();
      var fullIdx = DAY_NAMES.findIndex(function(d) { return d.toLowerCase() === hClean.toLowerCase(); });
      if (fullIdx >= 0) {
        var d = new Date(anchor);
        // fullIdx: 0=Sun, 1=Mon... anchor is Monday (1)
        var offset = fullIdx === 0 ? 6 : fullIdx - 1; // Mon=0 offset, Tue=1, ... Sun=6
        d.setDate(anchor.getDate() + offset);
        dayCols.push({ idx: idx, date: d.toISOString().split('T')[0], dow: fullIdx });
      }
    });
  }

  // Derive week_start
  var weekStart = dayCols.length > 0 ? dayCols.reduce(function(a,b){ return a.date < b.date ? a : b; }).date : null;

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
          role_name: roleName || '',
          department_name: deptName,
          start_time: dc.date + 'T' + parsed.start2Str + ':00-05:00',
          end_time: parsed.end2Str ? (dc.date + 'T' + parsed.end2Str + ':00-05:00') : null,
          is_closing: false,
          shift_type: 'double',
          payable_hours: null,
          synced_at: new Date().toISOString()
        });
      }
    });
  }

  if (shifts.length === 0) {
    alert('Nessun turno trovato nel CSV. Verifica il formato.');
    if (btn) { btn.textContent = 'Import CSV'; btn.disabled = false; }
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
        alert('Errore salvataggio: ' + res.error.message);
      } else {
        schedLoadData();
        if (btn) { btn.textContent = 'Importati ' + shifts.length + ' turni'; }
        setTimeout(function() { if (btn) { btn.textContent = 'Import CSV'; btn.disabled = false; } }, 3000);
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
      start2Str: p2 ? p2.startStr : null, end2Str: p2 ? p2.endStr : null
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
  var m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|close|cl)?/i);
  if (!m) return null;

  var sh = parseInt(m[1], 10);
  var sm = parseInt(m[2] || '0', 10);
  var sAmPm = (m[3] || '').toLowerCase();
  var eh = parseInt(m[4], 10);
  var em = parseInt(m[5] || '0', 10);
  var eAmPm = (m[6] || '').toLowerCase();
  var isClosing = /close|cl/i.test(m[6] || '');

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
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px 0;font-size:14px;">Nessun dato. Importa il CSV da 7shifts.</div>';
    return;
  }
  if (schedCurrentView === 'oggi') { schedRenderOggi(container); }
  else { schedRenderSettimana(container); }
}

// ── TODAY VIEW ────────────────────────────────────────────
function schedRenderOggi(container) {
  var today = new Date();
  var todayStr = today.toISOString().split('T')[0];

  // Get week dates for day strip
  var weekDates = schedGetWeekDates();
  var selectedDate = weekDates[schedCurrentDayIndex] || todayStr;
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
        d.toLocaleDateString('en-US', { weekday: 'short' }) + '</span>' +
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
    schedStatCard(morning.filter(function(s,i,a){ return a.findIndex(function(x){ return x.employee_name===s.employee_name; })===i; }).length, 'Morning', '#2563eb') +
    schedStatCard(evening.filter(function(s,i,a){ return a.findIndex(function(x){ return x.employee_name===s.employee_name; })===i; }).length, 'Evening', '#059669') +
    schedStatCard(totalPeople, 'On today', '#1e3a5f') +
  '</div>';

  // Timeline
  var timelineHtml = schedBuildTimeline(dayShifts);

  // Station cards
  var stationHtml = schedBuildStationCards(dayShifts);

  container.innerHTML = dayStripHtml + statsHtml +
    '<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin-bottom:8px;">Timeline<div style="flex:1;height:0.5px;background:rgba(59,130,246,0.15);"></div></div>' +
    timelineHtml +
    '<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;display:flex;align-items:center;gap:8px;margin:18px 0 8px;">By Station<div style="flex:1;height:0.5px;background:rgba(59,130,246,0.15);"></div></div>' +
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
  if (dayShifts.length === 0) return '<div style="color:#94a3b8;font-size:13px;padding:16px 0;">Nessun turno</div>';

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
      var st = s.start_time ? new Date(s.start_time) : null;
      var et = s.end_time ? new Date(s.end_time) : null;
      if (!st) return '';
      var sh = st.getHours() + st.getMinutes() / 60;
      var eh = et ? (et.getHours() + et.getMinutes() / 60) : (sh + 6);
      if (s.is_closing) eh = START_H + TOTAL_H;
      var left = Math.max(0, (sh - START_H) / TOTAL_H * 100);
      var width = Math.min(100 - left, (eh - sh) / TOTAL_H * 100);
      var isMorning = sh < 13;
      var barColor = isMorning
        ? 'background:rgba(37,99,235,0.12);border:0.5px solid rgba(37,99,235,0.25);'
        : 'background:rgba(5,150,105,0.12);border:0.5px solid rgba(5,150,105,0.3);';
      var lblColor = isMorning ? '#2563eb' : '#059669';
      var lbl = s.role_name || (isMorning ? 'Morning' : 'Evening');
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

// Station cards: group by role_name / department_name
function schedBuildStationCards(dayShifts) {
  if (dayShifts.length === 0) return '';

  var groups = {};
  dayShifts.forEach(function(s) {
    var key = s.role_name || s.department_name || 'Other';
    if (!groups[key]) groups[key] = [];
    // Avoid duplicate names in same group
    if (!groups[key].find(function(x) { return x.employee_name === s.employee_name && x.start_time === s.start_time; })) {
      groups[key].push(s);
    }
  });

  return Object.keys(groups).map(function(grp) {
    var people = groups[grp];
    var rowsHtml = people.map(function(s) {
      var st = s.start_time ? new Date(s.start_time) : null;
      var et = s.end_time ? new Date(s.end_time) : null;
      var shiftStr = st ? st.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '--';
      if (et) shiftStr += ' – ' + (s.is_closing ? 'Close' : et.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
      var isMorning = st && st.getHours() < 13;
      var dotColor = isMorning ? '#2563eb' : '#059669';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid rgba(59,130,246,0.06);">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div style="width:7px;height:7px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;"></div>' +
          '<span style="font-size:14px;font-weight:600;color:#1e3a5f;">' + escHtml(s.employee_name) + '</span>' +
        '</div>' +
        '<span style="font-size:11px;color:#94a3b8;font-weight:500;">' + escHtml(shiftStr) + '</span>' +
      '</div>';
    }).join('');

    return '<div style="background:rgba(255,255,255,0.6);backdrop-filter:blur(12px);border:0.5px solid rgba(59,130,246,0.15);border-radius:16px;overflow:hidden;margin-bottom:8px;">' +
      '<div style="padding:9px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:0.5px solid rgba(59,130,246,0.08);background:rgba(255,255,255,0.4);">' +
        '<span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1e3a5f;">' + escHtml(grp) + '</span>' +
        '<span style="font-size:10px;font-weight:700;color:#60a5fa;background:rgba(59,130,246,0.08);padding:2px 8px;border-radius:20px;">' + people.length + '</span>' +
      '</div>' +
      '<div style="padding:4px 14px;">' + rowsHtml + '</div>' +
    '</div>';
  }).join('');
}

// ── WEEK VIEW ─────────────────────────────────────────────
function schedRenderSettimana(container) {
  var weekDates = schedGetWeekDates();
  if (weekDates.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px 0;">Nessun dato</div>';
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
  if (btn) btn.textContent = 'Import CSV';
});
