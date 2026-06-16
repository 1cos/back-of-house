// ── OPERATION NOTES — Prompt serale brigata ──────────────────
// Appare dopo le 22:30 CDT se l'utente non ha ancora risposto oggi.
// Appare anche subito dopo doCloseTurn() in closing.js.
// Salva in tabella operation_notes.
// Ricontrolla ogni 30 minuti.

const ON_PROMPT_HOUR_CDT   = 22; // 22:30 CDT
const ON_PROMPT_MIN_CDT    = 30;
const ON_RECHECK_MS        = 30 * 60 * 1000; // ogni 30 minuti

let _onCheckTimer = null;

// ── Testi multilingua ─────────────────────────────────────────
const ON_STRINGS = {
  it: {
    pushTitle: 'Come è andata stasera? 🌙',
    pushBody: 'Chef vuole sentire la tua voce. Il tuo feedback resta privato e ci aiuta a crescere insieme.',
    greeting21: 'Buona notte',
    greeting17: 'Buona serata',
    greetingDefault: 'Ciao',
    question: 'Come è andata stasera?',
    subtitle: 'Una frase. Qualsiasi lingua.',
    privacy: '🔒 Solo Max lo vede. Non viene condiviso con la crew. Usato in forma anonima per migliorare il lavoro.',
    placeholder: 'Scrivi liberamente — anche una parola va bene…',
    placeholderEmpty: 'Scrivi qualcosa — anche una parola va bene!',
    submit: '✓ Invia commento',
    skip: 'Dopo',
    toast: 'Grazie — buona notte! 🌙',
    quickReplies: ['Serata tranquilla 👌','Super impegnati 🔥','Tutto ok','Mancava personale','Cucina sotto pressione','Ottimo servizio ⭐'],
  },
  en: {
    pushTitle: 'How did tonight go? 🌙',
    pushBody: 'Your voice matters. Your feedback is private and helps the whole team grow.',
    greeting21: 'Good night',
    greeting17: 'Good evening',
    greetingDefault: 'Hey',
    question: 'How did tonight go?',
    subtitle: 'One sentence. Any language.',
    privacy: '🔒 Only Max sees this. Never shared with the crew. Used anonymously to improve how we work.',
    placeholder: 'Write freely — even one word is fine…',
    placeholderEmpty: 'Write something — even one word is fine!',
    submit: '✓ Send feedback',
    skip: 'Later',
    toast: 'Thanks — good night! 🌙',
    quickReplies: ['Quiet night 👌','Super busy 🔥','All good','Short staffed','Kitchen under pressure','Great service ⭐'],
  },
  es: {
    pushTitle: '¿Cómo estuvo esta noche? 🌙',
    pushBody: 'Tu opinión importa. Tu comentario es privado y ayuda a todo el equipo a crecer.',
    greeting21: 'Buenas noches',
    greeting17: 'Buenas tardes',
    greetingDefault: 'Hola',
    question: '¿Cómo estuvo esta noche?',
    subtitle: 'Una frase. Cualquier idioma.',
    privacy: '🔒 Solo Max lo ve. No se comparte con el equipo. Se usa de forma anónima para mejorar el trabajo.',
    placeholder: 'Escribe libremente — incluso una palabra está bien…',
    placeholderEmpty: '¡Escribe algo — incluso una palabra está bien!',
    submit: '✓ Enviar comentario',
    skip: 'Después',
    toast: 'Gracias — ¡buenas noches! 🌙',
    quickReplies: ['Noche tranquila 👌','Super ocupados 🔥','Todo bien','Faltó personal','Cocina bajo presión','Excelente servicio ⭐'],
  },
};

function _onLang() {
  const l = window.user?.lang || 'en';
  return ON_STRINGS[l] || ON_STRINGS['en'];
}

// ── Entry point — chiamata da init.js e da doCloseTurn() ─────
window.checkOperationNotePrompt = async function(forceShow) {
  if (!window.user) return;

  const now = getNowCDT();
  const h = now.getHours();
  const m = now.getMinutes();

  // Se chiamata da chiusura turno (forceShow=true) salta il controllo orario
  if (!forceShow) {
    // Troppo presto — aspetta e ricontrolla
    if (h < ON_PROMPT_HOUR_CDT || (h === ON_PROMPT_HOUR_CDT && m < ON_PROMPT_MIN_CDT)) {
      const msUntil = msUntilPrompt(now);
      clearTimeout(_onCheckTimer);
      _onCheckTimer = setTimeout(() => window.checkOperationNotePrompt(), msUntil);
      return;
    }
    // Dopo le 3 di notte — non mostrare più
    if (h >= 3 && h < 12) return;
  }

  // Controlla se ha già risposto oggi
  const alreadyAnswered = await hasAnsweredToday();
  if (alreadyAnswered) return;

  // Push reale via send-push Edge Function (raggiunge anche con app chiusa)
  if (!forceShow) {
    try {
      const s = _onLang();
      await fetch(SUPABASE_URL + '/functions/v1/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify({
          title: s.pushTitle,
          body: s.pushBody,
        }),
      });
    } catch(e) { console.warn('[OperationNote] Push failed:', e.message); }
  }

  // Mostra il prompt (con piccolo delay se viene da chiusura turno)
  const delay = forceShow ? 800 : 0;
  setTimeout(() => showOperationNoteSheet(), delay);

  // Ricontrolla tra 30 min se non risponde (solo per il flusso orario)
  if (!forceShow) {
    clearTimeout(_onCheckTimer);
    _onCheckTimer = setTimeout(() => window.checkOperationNotePrompt(), ON_RECHECK_MS);
  }
};

// ── Orario CDT (UTC-5 estate, UTC-6 inverno) ─────────────────
function getNowCDT() {
  const now = new Date();
  const month = now.getUTCMonth();
  const isCDT = month >= 2 && month <= 10;
  const offsetH = isCDT ? 5 : 6;
  return new Date(now.getTime() - offsetH * 60 * 60 * 1000);
}

function msUntilPrompt(nowCDT) {
  const target = new Date(nowCDT);
  target.setHours(ON_PROMPT_HOUR_CDT, ON_PROMPT_MIN_CDT, 0, 0);
  const diff = target.getTime() - nowCDT.getTime();
  return diff > 0 ? diff : ON_RECHECK_MS;
}

async function hasAnsweredToday() {
  const sb = window.supabaseClient;
  if (!sb || !window.user) return false;
  const todayCDT = getNowCDT().toISOString().slice(0, 10);
  const { data } = await sb
    .from('operation_notes')
    .select('id')
    .eq('note_date', todayCDT)
    .eq('user_name', window.user.name)
    .limit(1);
  return !!(data && data.length > 0);
}

// ── Bottom sheet serale ──────────────────────────────────────
function showOperationNoteSheet() {
  if (document.getElementById('_opNoteSheet')) return;

  const s = _onLang();
  const userName = window.user?.name || '';
  const hour = getNowCDT().getHours();
  const greeting = hour >= 21 ? s.greeting21 : hour >= 17 ? s.greeting17 : s.greetingDefault;

  const sheet = document.createElement('div');
  sheet.id = '_opNoteSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);display:flex;align-items:flex-end;';

  const qrButtons = s.quickReplies.map(function(ex) {
    const escaped = ex.replace(/'/g, "\\'");
    return '<button onclick="' +
      "document.getElementById('_opNoteText').value='" + escaped + "';" +
      "document.getElementById('_opNoteText').style.borderColor='#3b82f6';" +
      "document.querySelectorAll('._qr').forEach(function(b){b.style.background='#f8fafc';b.style.borderColor='#e2e8f0';});" +
      "this.style.background='#eff6ff';this.style.borderColor='#3b82f6';" +
      '" class="_qr" style="padding:8px 14px;border-radius:20px;border:1.5px solid #e2e8f0;background:#f8fafc;font-size:13px;color:#475569;cursor:pointer;transition:all .15s;font-weight:500;">' +
      ex + '</button>';
  }).join('');

  sheet.innerHTML =
    '<div style="background:white;width:100%;max-width:480px;margin:0 auto;border-radius:28px 28px 0 0;padding:0 0 44px;max-height:90vh;overflow-y:auto;animation:slideUp .3s cubic-bezier(.34,1.56,.64,1);box-shadow:0 -12px 60px rgba(0,0,0,0.3);">' +

      // Handle
      '<div style="width:44px;height:5px;background:#e2e8f0;border-radius:3px;margin:14px auto 0;"></div>' +

      // Header
      '<div style="padding:22px 20px 0;text-align:center;">' +
        '<div style="font-size:44px;margin-bottom:8px;">🌙</div>' +
        '<div style="font-size:22px;font-weight:800;color:#1e293b;line-height:1.2;">' +
          greeting + (userName ? ', ' + userName.split(' ')[0] : '') + '!' +
        '</div>' +
        '<div style="font-size:15px;color:#64748b;margin-top:6px;line-height:1.4;">' +
          s.question + '<br>' +
          '<span style="font-size:13px;opacity:.7;">' + s.subtitle + '</span>' +
        '</div>' +
      '</div>' +

      // Privacy badge
      '<div style="margin:14px 20px 0;padding:10px 14px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:14px;font-size:12px;color:#166534;line-height:1.4;text-align:center;">' +
        s.privacy +
      '</div>' +

      // Quick replies
      '<div style="padding:14px 20px 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">' +
        qrButtons +
      '</div>' +

      // Textarea
      '<div style="padding:14px 20px 0;">' +
        '<textarea id="_opNoteText" placeholder="' + s.placeholder + '" rows="3" ' +
          'style="width:100%;padding:16px;border:2px solid #e2e8f0;border-radius:18px;font-size:17px;line-height:1.5;color:#1e293b;background:#f8fafc;outline:none;resize:none;box-sizing:border-box;transition:border-color .2s;" ' +
          'oninput="this.style.borderColor=\'#3b82f6\';this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight,160)+\'px\';">' +
        '</textarea>' +
      '</div>' +

      // Bottoni
      '<div style="padding:14px 20px 0;display:flex;gap:10px;">' +
        '<button id="_opNoteSubmit" onclick="submitOperationNote()" ' +
          'style="flex:1;height:58px;border-radius:18px;background:linear-gradient(135deg,#1e293b,#334155);color:white;font-size:18px;font-weight:700;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(30,41,59,0.3);transition:transform .1s;" ' +
          'onmousedown="this.style.transform=\'scale(0.98)\'" onmouseup="this.style.transform=\'scale(1)\'">' +
          s.submit +
        '</button>' +
        '<button onclick="document.getElementById(\'_opNoteSheet\').remove()" ' +
          'style="height:58px;padding:0 20px;border-radius:18px;background:#f1f5f9;color:#94a3b8;font-size:15px;border:none;cursor:pointer;">' +
          s.skip +
        '</button>' +
      '</div>' +

    '</div>';

  sheet.addEventListener('click', function(e) { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);

  setTimeout(function() {
    var ta = document.getElementById('_opNoteText');
    if (ta) { ta.focus(); ta.click(); }
  }, 400);
}

// ── Salva nota ───────────────────────────────────────────────
window.submitOperationNote = async function() {
  const s = _onLang();
  const ta = document.getElementById('_opNoteText');
  const note = ta?.value?.trim();
  if (!note) {
    ta.style.borderColor = '#ef4444';
    ta.placeholder = s.placeholderEmpty;
    return;
  }

  const btn = document.getElementById('_opNoteSubmit');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  const sb = window.supabaseClient;
  const todayCDT = getNowCDT().toISOString().slice(0, 10);

  const { error } = await sb.from('operation_notes').insert({
    note_date: todayCDT,
    user_name: window.user?.name || 'Unknown',
    note: note,
    lang: window.user?.lang || 'en',
    service: 'dinner',
  });

  if (error) {
    if (btn) { btn.textContent = s.submit; btn.disabled = false; }
    if (typeof showScToast === 'function') showScToast('❌ ' + error.message);
    return;
  }

  const sheet = document.getElementById('_opNoteSheet');
  if (sheet) {
    sheet.style.transition = 'opacity .3s';
    sheet.style.opacity = '0';
    setTimeout(function() { sheet.remove(); }, 300);
  }

  if (typeof showScToast === 'function') showScToast('✅ ' + (window.user?.name?.split(' ')[0] || '') + ' — ' + s.toast);
};
