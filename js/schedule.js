// schedule.js - 7shifts integration v1

var schedCurrentView = 'oggi';

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

function schedShowView(view) {
  schedCurrentView = view;
  var btnOggi = document.getElementById('schedBtnOggi');
  var btnSett = document.getElementById('schedBtnSettimana');
  if (view === 'oggi') {
    btnOggi.style.background = '#1e3a5f';
    btnOggi.style.color = 'white';
    btnOggi.style.border = 'none';
    btnSett.style.background = 'white';
    btnSett.style.color = '#1e3a5f';
    btnSett.style.border = '1.5px solid #1e3a5f';
  } else {
    btnSett.style.background = '#1e3a5f';
    btnSett.style.color = 'white';
    btnSett.style.border = 'none';
    btnOggi.style.background = 'white';
    btnOggi.style.color = '#1e3a5f';
    btnOggi.style.border = '1.5px solid #1e3a5f';
  }
  schedRender();
}

var schedAllShifts = [];

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
  if (schedAllShifts.length === 0) {
    el.textContent = '';
    return;
  }
  var latest = schedAllShifts.reduce(function(a, b) {
    return (a.synced_at || '') > (b.synced_at || '') ? a : b;
  });
  if (latest.synced_at) {
    var d = new Date(latest.synced_at);
    el.textContent = 'Sync: ' + d.toLocaleDateString('it-IT') + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
}

function schedRender() {
  var container = document.getElementById('schedContent');
  if (!container) return;

  if (schedAllShifts.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px 0;font-size:14px;">Nessun dato. Premi Sincronizza.</div>';
    return;
  }

  if (schedCurrentView === 'oggi') {
    schedRenderOggi(container);
  } else {
    schedRenderSettimana(container);
  }
}

function schedRenderOggi(container) {
  var today = new Date();
  var todayStr = today.toISOString().split('T')[0];
  var todayShifts = schedAllShifts.filter(function(s) { return s.date === todayStr; });

  if (todayShifts.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:40px 0;font-size:14px;">Nessun turno per oggi</div>';
    return;
  }

  var html = '<div style="font-size:12px;color:#64748b;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;">' +
    today.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>';

  todayShifts.forEach(function(s) {
    var startStr = s.start_time ? new Date(s.start_time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
    var endStr = s.end_time ? new Date(s.end_time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
    html += '<div style="background:white;border-radius:14px;padding:12px 14px;box-shadow:0 1px 4px rgba(30,58,95,0.08);display:flex;align-items:center;justify-content:space-between;">' +
      '<div>' +
        '<div style="font-size:15px;font-weight:600;color:#1e3a5f;">' + escHtml(s.employee_name) + '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:2px;">' + escHtml(s.role_name || 'Nessun ruolo') + '</div>' +
      '</div>' +
      '<div style="text-align:right;">' +
        '<div style="font-size:14px;font-weight:600;color:#059669;">' + startStr + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;">' + endStr + '</div>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html;
}

function schedRenderSettimana(container) {
  var today = new Date();
  var days = [];
  for (var i = -1; i <= 6; i++) {
    var d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }

  var html = '';
  days.forEach(function(dateStr) {
    var dayShifts = schedAllShifts.filter(function(s) { return s.date === dateStr; });
    var d = new Date(dateStr + 'T12:00:00');
    var isToday = dateStr === today.toISOString().split('T')[0];
    var dayLabel = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

    html += '<div style="margin-bottom:16px;">' +
      '<div style="font-size:12px;font-weight:700;color:' + (isToday ? '#059669' : '#475569') + ';margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">' +
        (isToday ? 'OGGI - ' : '') + dayLabel +
      '</div>';

    if (dayShifts.length === 0) {
      html += '<div style="font-size:12px;color:#cbd5e1;padding:8px 0;">Nessun turno</div>';
    } else {
      dayShifts.forEach(function(s) {
        var startStr = s.start_time ? new Date(s.start_time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
        var endStr = s.end_time ? new Date(s.end_time).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--';
        html += '<div style="background:white;border-radius:12px;padding:10px 12px;margin-bottom:6px;box-shadow:0 1px 3px rgba(30,58,95,0.07);display:flex;align-items:center;justify-content:space-between;">' +
          '<div>' +
            '<div style="font-size:14px;font-weight:600;color:#1e3a5f;">' + escHtml(s.employee_name) + '</div>' +
            '<div style="font-size:11px;color:#64748b;">' + escHtml(s.role_name || '') + '</div>' +
          '</div>' +
          '<div style="font-size:13px;font-weight:600;color:#059669;">' + startStr + ' - ' + endStr + '</div>' +
        '</div>';
      });
    }
    html += '</div>';
  });

  container.innerHTML = html;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function syncSevenShift() {
  var btn = document.getElementById('schedSyncBtn');
  if (btn) { btn.textContent = 'Sincronizzando...'; btn.disabled = true; }

  try {
    var session = await window.supa.auth.getSession();
    var jwt = session.data.session ? session.data.session.access_token : '';

    var resp = await fetch('https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/sevenshift-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + jwt,
      },
      body: JSON.stringify({})
    });

    var data = await resp.json();

    if (data.success) {
      schedLoadData();
      if (btn) { btn.textContent = 'Sincronizzato (' + data.synced + ')'; }
      setTimeout(function() { if (btn) { btn.textContent = 'Sincronizza'; btn.disabled = false; } }, 3000);
    } else {
      if (btn) { btn.textContent = 'Errore'; btn.disabled = false; }
      console.error('[SCHED] Sync error:', data);
    }
  } catch (err) {
    console.error('[SCHED] Fetch error:', err);
    if (btn) { btn.textContent = 'Errore'; btn.disabled = false; }
  }
}

// Attacca il click handler al tab Schedule dopo il caricamento
// (necessario perche il tab e display:none quando il nav handler viene registrato)
document.addEventListener('DOMContentLoaded', function() {
  var tabSched = document.getElementById('tabSchedule');
  if (!tabSched) return;
  tabSched.addEventListener('click', function() {
    // Nascondi tutte le sezioni v*
    document.querySelectorAll('main section[id^="v"]').forEach(function(s) {
      s.classList.add('hidden');
    });
    // Mostra vsched
    var vsched = document.getElementById('vsched');
    if (vsched) vsched.classList.remove('hidden');
    // Aggiorna stile tab attivo
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.remove('tab-active');
      t.classList.add('text-slate-500');
      var svg = t.querySelector('svg');
      if (svg) svg.style.stroke = '';
      var sp = t.querySelector('.tab-label');
      if (sp) sp.style.color = '';
    });
    tabSched.classList.add('tab-active');
    tabSched.classList.remove('text-slate-500');
    var svg = tabSched.querySelector('svg');
    if (svg) svg.style.stroke = '#059669';
    var sp = tabSched.querySelector('.tab-label');
    if (sp) sp.style.color = '#059669';
    // Carica dati
    schedLoadData();
  });
});
