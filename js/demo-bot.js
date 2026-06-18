// ══════════════════════════════════════════════════════════════
// DEMO BOT + BUG TRACKER — js/demo-bot.js
// Simula eventi brigata a intervalli scelti da Max.
// Bug Tracker monitora errori e li porta in office_items come red.
// Tutti i dati demo hanno is_demo=true — reset cancella tutto.
// ══════════════════════════════════════════════════════════════

var _demoBotTimer = null;
var _demoBotRunning = false;
var _demoBotDay = 0;
var _demoBotLog = []; // {table, id} per reset

// ── STAFF SIMULATO ──
var DEMO_STAFF = [
  { name: 'Cole',     station: 'Saucier',    lang: 'en' },
  { name: 'Samantha', station: 'Pastry',     lang: 'en' },
  { name: 'Sofia',    station: 'Plating',    lang: 'en' },
  { name: 'Rachel',   station: 'Oven',       lang: 'es' },
  { name: 'Chance',   station: 'Oven',       lang: 'en' },
  { name: 'Anto',     station: 'Fresh Pasta',lang: 'it' },
  { name: 'Todd',     station: 'Fresh Pasta',lang: 'en' },
  { name: 'Tela',     station: 'Operations', lang: 'en' },
];

// ── PREP ITEMS con timing realistico ──
var DEMO_PREP = [
  { item: 'Pasta Dough', unit: 'kg', qty: 3, fast_mins: 25, slow_mins: 55 },
  { item: 'Bolognese', unit: 'lt', qty: 8, fast_mins: 40, slow_mins: 90 },
  { item: 'Arrabbiata', unit: 'lt', qty: 6, fast_mins: 20, slow_mins: 45 },
  { item: 'Piccata Sauce', unit: 'lt', qty: 4, fast_mins: 15, slow_mins: 35 },
  { item: 'Caesar Dressing', unit: 'lt', qty: 3, fast_mins: 10, slow_mins: 25 },
  { item: 'Tiramisu', unit: 'pz', qty: 12, fast_mins: 30, slow_mins: 70 },
  { item: 'Chicken Parm', unit: 'pz', qty: 20, fast_mins: 35, slow_mins: 65 },
  { item: 'Bread', unit: 'loaves', qty: 8, fast_mins: 5, slow_mins: 15 },
];

// ── TELL CHEF MESSAGES ──
var DEMO_MESSAGES = [
  { from: 'Cole',     text: 'Running low on veal, maybe 4 portions left', priority: 'orange', analysis: 'Scorte veal basse — ordine urgente o cambio menu stasera' },
  { from: 'Samantha', text: 'Tiramisu needs more mascarpone tomorrow', priority: 'blue', analysis: 'Ordine mascarpone per domani — avvisa Tela' },
  { from: 'Sofia',    text: 'Plating station light is too dim on the right side', priority: 'blue', analysis: 'Problema illuminazione plating — manutenzione, non urgente' },
  { from: 'Rachel',   text: 'El horno no calienta bien en la parte trasera', priority: 'orange', analysis: 'Forno posteriore non scalda uniformemente — verifica manutenzione' },
  { from: 'Chance',   text: 'We ran out of parchment paper', priority: 'red', analysis: 'Carta forno esaurita — servizio a rischio, risolvi subito' },
  { from: 'Anto',     text: 'Fresh pasta nests are drying too fast today — humidity issue?', priority: 'orange', analysis: 'Problema umidità — pasta fresca si secca troppo velocemente' },
  { from: 'Todd',     text: 'Need more semolina flour for tomorrow', priority: 'blue', analysis: 'Semola da ordinare — non urgente per stasera' },
  { from: 'Tela',     text: 'FreshPoint delivery was short on salmon today — 5lbs instead of 15', priority: 'red', analysis: 'Consegna salmon incompleta — contatta FreshPoint o trova alternativa' },
  { from: 'Cole',     text: 'Butter is almost gone, used more than expected', priority: 'orange', analysis: 'Burro in esaurimento — verifica ordine e uso in cucina' },
  { from: 'Samantha', text: 'Panna cotta set perfectly today, new timing works great', priority: 'blue', analysis: 'Feedback positivo su panna cotta — annota il timing nuovo' },
];

// ── OPERATION NOTES ──
var DEMO_OP_NOTES = [
  { user: 'Cole',     note: 'Good service, ran out of ribeye at 8:30pm. Need to order more for Friday.', priority: 'orange' },
  { user: 'Samantha', note: 'Dessert sales strong tonight. Tiramisu sold out by 9pm.', priority: 'blue' },
  { user: 'Sofia',    note: 'Plating was slow during the 7pm rush — need extra hands or better prep.', priority: 'orange' },
  { user: 'Chance',   note: 'Oven temp fluctuating between 370-390F. Need tech check.', priority: 'red' },
  { user: 'Tela',     note: 'Hardie\'s invoice arrived but quantities were off — held for review.', priority: 'orange' },
  { user: 'Anto',     note: 'Pasta production smooth. Made 8kg dough, used 7.5kg service.', priority: 'blue' },
];

// ── CHIUSURE TURNO (alcune complete, alcune mancanti) ──
var DEMO_CLOSINGS = [
  { user: 'Cole',     closed: true },
  { user: 'Samantha', closed: true },
  { user: 'Sofia',    closed: true },
  { user: 'Rachel',   closed: false }, // non chiude
  { user: 'Chance',   closed: true },
  { user: 'Anto',     closed: false }, // non chiude
  { user: 'Todd',     closed: true },
];

// ── TIPI DI EVENTI ──
var EVENT_TYPES = ['tell_chef', 'prep_log', 'operation_note', 'closing', 'daily_summary'];

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ── APRI PANNELLO DEMO BOT ──
window.openDemoBot = function() {
  if (typeof hideAdminMenu === 'function') hideAdminMenu();
  var existing = document.getElementById('demoBotModal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'demoBotModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:300;background:linear-gradient(160deg,#fffbeb 0%,#fef3c7 60%,#fde68a 100%);display:flex;flex-direction:column;font-family:Inter,system-ui,sans-serif;max-width:480px;margin:0 auto;';

  modal.innerHTML =
    '<div style="background:rgba(255,255,255,0.92);backdrop-filter:blur(16px);border-bottom:0.5px solid rgba(146,64,14,0.12);box-shadow:0 2px 8px rgba(146,64,14,0.06);padding:14px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
      '<button onclick="document.getElementById(\'demoBotModal\').remove()" style="color:#92400e;background:none;border:none;font-size:22px;cursor:pointer;padding:4px;">&#8592;</button>' +
      '<div style="font-size:16px;font-weight:700;color:#92400e;flex:1;">Demo Bot</div>' +
      '<div id="demoBotStatus" style="font-size:12px;font-weight:600;color:#94a3b8;padding:5px 12px;background:rgba(0,0,0,0.05);border-radius:20px;">FERMO</div>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:16px;">' +
      // Frequenza
      '<div style="background:white;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(146,64,14,0.07);">' +
        '<div style="font-size:12px;font-weight:700;color:#92400e;letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px;">Frequenza eventi</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button onclick="demoBotSetFreq(this,1)" class="freq-btn" style="flex:1;padding:12px;border-radius:10px;font-size:15px;font-weight:600;border:1.5px solid rgba(146,64,14,0.2);background:rgba(146,64,14,0.04);color:#92400e;cursor:pointer;min-width:60px;">1m</button>' +
          '<button onclick="demoBotSetFreq(this,5)" class="freq-btn active-freq" style="flex:1;padding:12px;border-radius:10px;font-size:15px;font-weight:600;border:1.5px solid rgba(146,64,14,0.2);background:rgba(146,64,14,0.04);color:#92400e;cursor:pointer;min-width:60px;">5m</button>' +
          '<button onclick="demoBotSetFreq(this,10)" class="freq-btn" style="flex:1;padding:12px;border-radius:10px;font-size:15px;font-weight:600;border:1.5px solid rgba(146,64,14,0.2);background:rgba(146,64,14,0.04);color:#92400e;cursor:pointer;min-width:60px;">10m</button>' +
          '<button onclick="demoBotSetFreq(this,15)" class="freq-btn" style="flex:1;padding:12px;border-radius:10px;font-size:15px;font-weight:600;border:1.5px solid rgba(146,64,14,0.2);background:rgba(146,64,14,0.04);color:#92400e;cursor:pointer;min-width:60px;">15m</button>' +
          '<button onclick="demoBotSetFreq(this,20)" class="freq-btn" style="flex:1;padding:12px;border-radius:10px;font-size:15px;font-weight:600;border:1.5px solid rgba(146,64,14,0.2);background:rgba(146,64,14,0.04);color:#92400e;cursor:pointer;min-width:60px;">20m</button>' +
        '</div>' +
      '</div>' +
      // Info
      '<div style="background:white;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(146,64,14,0.07);">' +
        '<div style="font-size:12px;font-weight:700;color:#92400e;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Cosa simula</div>' +
        '<div style="font-size:14px;color:#64748b;line-height:1.6;">Ogni tick = 1 giorno compresso. Il bot genera:<br>• Tell Chef dalla brigata<br>• Prep log con timing veloce/lento<br>• Note serali di chiusura<br>• Chiusure turno (alcune mancanti)<br>• Bug tracker monitora errori → card rosse in L\'Ufficio</div>' +
      '</div>' +
      // Log
      '<div style="background:white;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(146,64,14,0.07);">' +
        '<div style="font-size:12px;font-weight:700;color:#92400e;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Log <span id="demoBotDayCount" style="color:#64748b;font-weight:400;text-transform:none;font-size:11px;"></span></div>' +
        '<div id="demoBotLog" style="font-size:13px;color:#64748b;line-height:1.8;max-height:200px;overflow-y:auto;">In attesa...</div>' +
      '</div>' +
      // Azioni
      '<div style="display:flex;gap:10px;margin-bottom:12px;">' +
        '<button id="demoBotStartBtn" onclick="demoBotStart()" style="flex:2;padding:16px;border-radius:14px;font-size:16px;font-weight:700;background:#92400e;color:white;border:none;cursor:pointer;">▶ Start</button>' +
        '<button id="demoBotStopBtn" onclick="demoBotStop()" style="flex:1;padding:16px;border-radius:14px;font-size:16px;font-weight:700;background:rgba(146,64,14,0.1);color:#92400e;border:1.5px solid rgba(146,64,14,0.2);cursor:pointer;">⏹ Stop</button>' +
      '</div>' +
      '<button onclick="demoBotReset()" style="width:100%;padding:14px;border-radius:14px;font-size:15px;font-weight:600;background:rgba(239,68,68,0.08);color:#ef4444;border:1.5px solid rgba(239,68,68,0.2);cursor:pointer;">🗑 Reset — cancella tutti i dati demo</button>' +
    '</div>';

  document.body.appendChild(modal);
  window._demoBotFreq = 10;
};

// ── FREQUENZA ──
window.demoBotSetFreq = function(btn, mins) {
  document.querySelectorAll('.freq-btn').forEach(function(b) {
    b.style.background = 'rgba(146,64,14,0.04)';
    b.style.color = '#92400e';
    b.style.borderColor = 'rgba(146,64,14,0.2)';
  });
  btn.style.background = '#92400e';
  btn.style.color = 'white';
  btn.style.borderColor = '#92400e';
  window._demoBotFreq = mins;
};

// ── LOG UI ──
function demoBotAddLog(text) {
  var log = document.getElementById('demoBotLog');
  if (!log) return;
  if (log.textContent === 'In attesa...') log.textContent = '';
  var line = document.createElement('div');
  line.textContent = '• ' + text;
  log.insertBefore(line, log.firstChild);
  var dayEl = document.getElementById('demoBotDayCount');
  if (dayEl) dayEl.textContent = '— Giorno ' + _demoBotDay;
}

// ── START ──
window.demoBotStart = function() {
  if (_demoBotRunning) return;
  _demoBotRunning = true;
  var statusEl = document.getElementById('demoBotStatus');
  if (statusEl) { statusEl.textContent = 'IN CORSA'; statusEl.style.color = '#22c55e'; statusEl.style.background = 'rgba(34,197,94,0.1)'; }
  var badge = document.getElementById('demoBotBadge');
  if (badge) badge.style.display = 'block';
  demoBotTick();
  _demoBotTimer = setInterval(demoBotTick, (window._demoBotFreq || 10) * 60 * 1000);
};

// ── STOP ──
window.demoBotStop = function() {
  if (_demoBotTimer) { clearInterval(_demoBotTimer); _demoBotTimer = null; }
  _demoBotRunning = false;
  var statusEl = document.getElementById('demoBotStatus');
  if (statusEl) { statusEl.textContent = 'FERMO'; statusEl.style.color = '#94a3b8'; statusEl.style.background = 'rgba(0,0,0,0.05)'; }
  var badge = document.getElementById('demoBotBadge');
  if (badge) badge.style.display = 'none';
  demoBotAddLog('Bot fermato.');
};

// ── TICK — genera UN evento per giorno simulato ──
async function demoBotTick() {
  _demoBotDay++;
  var sb = window.supa;
  if (!sb) { demoBotAddLog('❌ Supabase non disponibile'); demoBotBugReport('Supabase non disponibile al tick ' + _demoBotDay, 'red'); return; }

  var eventType = randomFrom(EVENT_TYPES);

  try {
    if (eventType === 'tell_chef') {
      var msg = randomFrom(DEMO_MESSAGES);
      var { data, error } = await sb.from('chef_reports').insert({
        user_name: msg.from,
        station: DEMO_STAFF.find(function(s) { return s.name === msg.from; })?.station || '',
        message: msg.text,
        is_demo: true,
        created_at: new Date().toISOString(),
      }).select().single();
      if (error) throw new Error('chef_reports: ' + error.message);
      if (data) _demoBotLog.push({ table: 'chef_reports', id: data.id });
      // Scrivi in office_items
      await sb.from('office_items').insert({
        source: 'tell_chef',
        from_user: msg.from,
        priority: msg.priority,
        title: msg.from + ': ' + msg.text.slice(0, 80),
        body: msg.text,
        ai_analysis: msg.analysis,
        ai_options: msg.priority === 'red'
          ? [{ label: 'Gestisci ora' }]
          : [{ label: 'Ignora' }, { label: 'Prendi nota' }],
        status: 'open',
        is_demo: true,
      });
      demoBotAddLog('📢 Tell Chef da ' + msg.from + ' [' + msg.priority + ']');

    } else if (eventType === 'prep_log') {
      var prep = randomFrom(DEMO_PREP);
      var staff = randomFrom(DEMO_STAFF.filter(function(s) { return s.station !== 'Operations'; }));
      var isSlow = Math.random() > 0.6;
      var mins = isSlow
        ? randomInt(prep.slow_mins, prep.slow_mins + 20)
        : randomInt(prep.fast_mins, prep.fast_mins + 10);
      var { data: pd, error: pe } = await sb.from('prep_log').insert({
        item: prep.item,
        qty: prep.qty,
        unit: prep.unit,
        user_name: staff.name,
        station: staff.station,
        duration_minutes: mins,
        started_at: new Date(Date.now() - mins * 60000).toISOString(),
        is_demo: true,
        created_at: new Date().toISOString(),
      }).select().single();
      if (pe) throw new Error('prep_log: ' + pe.message);
      if (pd) _demoBotLog.push({ table: 'prep_log', id: pd.id });
      var label = isSlow ? '🐢 lento (' + mins + 'min)' : '⚡ veloce (' + mins + 'min)';
      demoBotAddLog('🍳 Prep: ' + staff.name + ' — ' + prep.item + ' ' + label);
      // Se molto lento → bug tracker segnala
      if (mins > prep.slow_mins + 10) {
        await demoBotBugReport(staff.name + ' ha impiegato ' + mins + ' minuti per ' + prep.item + ' (normale: ' + prep.fast_mins + '-' + prep.slow_mins + ' min)', 'orange');
      }

    } else if (eventType === 'operation_note') {
      var note = randomFrom(DEMO_OP_NOTES);
      var noteDate = new Date().toISOString().slice(0, 10);
      var { data: nd, error: ne } = await sb.from('operation_notes').insert({
        user_name: note.user,
        note: note.note,
        note_date: noteDate,
        lang: 'en',
        service: 'dinner',
        is_demo: true,
        created_at: new Date().toISOString(),
      }).select().single();
      if (ne) throw new Error('operation_notes: ' + ne.message);
      if (nd) _demoBotLog.push({ table: 'operation_notes', id: nd.id });
      await sb.from('office_items').insert({
        source: 'operation_note',
        from_user: note.user,
        priority: note.priority,
        title: note.user + ' — nota serale: ' + note.note.slice(0, 70),
        body: note.note,
        ai_analysis: null,
        ai_options: [],
        status: 'open',
        is_demo: true,
      });
      demoBotAddLog('📋 Op. Note da ' + note.user + ' [' + note.priority + ']');

    } else if (eventType === 'closing') {
      // Simula chiusure turno — alcune mancanti
      var closedAll = true;
      for (var i = 0; i < DEMO_CLOSINGS.length; i++) {
        var c = DEMO_CLOSINGS[i];
        if (!c.closed) { closedAll = false; continue; }
      }
      var missing = DEMO_CLOSINGS.filter(function(c) { return !c.closed; }).map(function(c) { return c.name; });
      demoBotAddLog('🔒 Chiusura turno — mancanti: ' + (missing.length ? missing.join(', ') : 'nessuno'));
      if (missing.length > 0) {
        await sb.from('office_items').insert({
          source: 'ai_scan',
          from_user: 'system',
          priority: 'orange',
          title: 'Turno non chiuso da: ' + missing.join(', '),
          body: 'Fine servizio. ' + missing.join(', ') + ' non hanno completato la chiusura turno.',
          ai_analysis: 'Chiusura incompleta — contatta ' + missing.join(' e ') + ' per verifica.',
          ai_options: [{ label: 'Ignora' }, { label: 'Contatta staff' }],
          status: 'open',
          is_demo: true,
        });
      }

    } else if (eventType === 'daily_summary') {
      var bills = randomInt(28, 68);
      var net = (bills * randomInt(42, 58)).toFixed(2);
      demoBotAddLog('💰 Riepilogo giornata: ' + bills + ' bills, $' + net);
      if (bills > 60) {
        await sb.from('office_items').insert({
          source: 'ai_scan',
          from_user: 'system',
          priority: 'blue',
          title: 'Record giornata — ' + bills + ' bills',
          body: 'Servizio di stasera: ' + bills + ' bills, $' + net + ' netti.',
          ai_analysis: 'Ottima serata. Considera di analizzare il menu per identificare i best seller.',
          ai_options: [{ label: 'Visto, grazie' }],
          status: 'open',
          is_demo: true,
        });
      }
    }

    // Bug Tracker — verifica che office_items sia accessibile
    await demoBotCheckHealth(sb);

  } catch(e) {
    demoBotAddLog('❌ Errore: ' + e.message);
    await demoBotBugReport('Errore al tick ' + _demoBotDay + ': ' + e.message, 'red');
  }

  if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
}

// ── BUG TRACKER — crea card rossa in office_items ──
async function demoBotBugReport(msg, priority) {
  var sb = window.supa;
  if (!sb) return;
  try {
    await sb.from('office_items').insert({
      source: 'ai_scan',
      from_user: 'Bug Tracker',
      priority: priority || 'red',
      title: '🐛 ' + msg.slice(0, 80),
      body: msg,
      ai_analysis: 'Rilevato dal Bug Tracker durante simulazione Demo Bot.',
      ai_options: [{ label: 'Ignora' }, { label: 'Investiga' }],
      status: 'open',
      is_demo: true,
    });
    demoBotAddLog('🐛 Bug: ' + msg.slice(0, 50));
  } catch(e) { console.error('[DemoBot] bugReport failed:', e.message); }
}

// ── HEALTH CHECK — verifica che il sistema funzioni ──
async function demoBotCheckHealth(sb) {
  try {
    var { data, error } = await sb.from('office_items').select('id').eq('is_demo', true).limit(1);
    if (error) await demoBotBugReport('office_items non accessibile: ' + error.message, 'red');
  } catch(e) {
    await demoBotBugReport('Health check fallito: ' + e.message, 'red');
  }
}

// ── RESET — cancella tutti i dati demo ──
window.demoBotReset = async function() {
  if (!confirm('Cancellare TUTTI i dati demo? (chef_reports, prep_log, operation_notes, office_items con is_demo=true)')) return;
  var sb = window.supa;
  if (!sb) return;
  demoBotStop();
  var log = document.getElementById('demoBotLog');
  if (log) log.innerHTML = '<div style="color:#ef4444;">Cancellazione in corso...</div>';
  try {
    await sb.from('office_items').delete().eq('is_demo', true);
    await sb.from('chef_reports').delete().eq('is_demo', true);
    await sb.from('prep_log').delete().eq('is_demo', true);
    await sb.from('operation_notes').delete().eq('is_demo', true);
    _demoBotLog = [];
    _demoBotDay = 0;
    if (log) log.innerHTML = '<div style="color:#22c55e;">✅ Reset completato. DB pulito.</div>';
    if (typeof officeBadgeUpdate === 'function') officeBadgeUpdate();
    if (typeof showScToast === 'function') showScToast('✅ Demo reset — DB pulito');
  } catch(e) {
    if (log) log.innerHTML = '<div style="color:#ef4444;">❌ Errore reset: ' + e.message + '</div>';
  }
};
