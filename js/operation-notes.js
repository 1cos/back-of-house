// ── OPERATION NOTES — Prompt serale brigata ──────────────────
// Appare dopo le 22:30 CDT se l'utente non ha ancora risposto oggi.
// Salva in tabella operation_notes.
// Ricontrollla ogni 30 minuti.

const ON_PROMPT_HOUR_CDT   = 22; // 22:30 CDT
const ON_PROMPT_MIN_CDT    = 30;
const ON_RECHECK_MS        = 30 * 60 * 1000; // ogni 30 minuti

let _onCheckTimer = null;

// ── Entry point — chiamata da init.js ────────────────────────
window.checkOperationNotePrompt = async function() {
  if (!window.user) return; // non loggato

  const now = getNowCDT();
  const h = now.getHours();
  const m = now.getMinutes();

  // Troppo presto — aspetta e ricontrolla
  if (h < ON_PROMPT_HOUR_CDT || (h === ON_PROMPT_HOUR_CDT && m < ON_PROMPT_MIN_CDT)) {
    const msUntil = msUntilPrompt(now);
    clearTimeout(_onCheckTimer);
    _onCheckTimer = setTimeout(() => window.checkOperationNotePrompt(), msUntil);
    return;
  }

  // Dopo mezzanotte — non mostrare più (troppo tardi)
  if (h >= 3 && h < 12) return;

  // Controlla se ha già risposto oggi
  const alreadyAnswered = await hasAnsweredToday();
  if (alreadyAnswered) return;

  // Manda push notification a tutta la crew (anche con app chiusa)
  try {
    const sb = window.supabaseClient;
    if (sb) {
      await sb.from('alerts').insert({
        message: '🍽️ Fine servizio — lascia il tuo commento sulla serata in Brigade!',
        level: 'info',
        created_by: 'Sous Chef',
        source_lang: 'it',
      });
    }
  } catch(e) { console.warn('[OperationNote] Push failed:', e.message); }

  // Mostra il prompt
  showOperationNoteSheet();

  // Ricontrolla tra 30 min se non risponde
  clearTimeout(_onCheckTimer);
  _onCheckTimer = setTimeout(() => window.checkOperationNotePrompt(), ON_RECHECK_MS);
};

// ── Orario CDT (UTC-5 estate, UTC-6 inverno) ─────────────────
function getNowCDT() {
  // Texas è CDT (UTC-5) da marzo a novembre, CST (UTC-6) da novembre a marzo
  const now = new Date();
  const month = now.getUTCMonth(); // 0=Jan
  const isCDT = month >= 2 && month <= 10; // marzo–novembre
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

  const userName = window.user?.name || '';
  const hour = getNowCDT().getHours();
  const greeting = hour >= 21 ? 'Buona notte' : hour >= 17 ? 'Buona serata' : 'Ciao';

  const quickReplies = [
    'Serata tranquilla 👌',
    'Super impegnati 🔥',
    'Tutto ok',
    'Mancava personale',
    'Cucina sotto pressione',
    'Ottimo servizio ⭐',
  ];

  const sheet = document.createElement('div');
  sheet.id = '_opNoteSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);display:flex;align-items:flex-end;';

  sheet.innerHTML = `
    <div style="
      background:white;
      width:100%;max-width:480px;margin:0 auto;
      border-radius:28px 28px 0 0;
      padding:0 0 44px;
      max-height:90vh;overflow-y:auto;
      animation:slideUp .3s cubic-bezier(.34,1.56,.64,1);
      box-shadow:0 -12px 60px rgba(0,0,0,0.3);
    ">
      <!-- Handle -->
      <div style="width:44px;height:5px;background:#e2e8f0;border-radius:3px;margin:14px auto 0;"></div>

      <!-- Header -->
      <div style="padding:22px 20px 0;text-align:center;">
        <div style="font-size:44px;margin-bottom:8px;">🌙</div>
        <div style="font-size:22px;font-weight:800;color:#1e293b;line-height:1.2;">
          ${greeting}${userName ? ', ' + userName.split(' ')[0] : ''}!
        </div>
        <div style="font-size:15px;color:#64748b;margin-top:6px;line-height:1.4;">
          Come è andata stasera?<br>
          <span style="font-size:13px;opacity:.7;">Una frase. Qualsiasi lingua.</span>
        </div>
      </div>

      <!-- Quick replies -->
      <div style="padding:16px 20px 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
        ${quickReplies.map(ex => `
          <button onclick="
            document.getElementById('_opNoteText').value='${ex}';
            document.getElementById('_opNoteText').style.borderColor='#3b82f6';
            document.querySelectorAll('._qr').forEach(b=>b.style.background='#f8fafc');
            this.style.background='#eff6ff';this.style.borderColor='#3b82f6';"
            class="_qr"
            style="padding:8px 14px;border-radius:20px;border:1.5px solid #e2e8f0;
              background:#f8fafc;font-size:13px;color:#475569;cursor:pointer;
              transition:all .15s;font-weight:500;">
            ${ex}
          </button>`).join('')}
      </div>

      <!-- Input -->
      <div style="padding:14px 20px 0;">
        <textarea id="_opNoteText"
          placeholder="Scrivi liberamente — anche una parola va bene…"
          rows="3"
          style="
            width:100%;padding:16px;
            border:2px solid #e2e8f0;border-radius:18px;
            font-size:17px;line-height:1.5;color:#1e293b;
            background:#f8fafc;outline:none;resize:none;
            box-sizing:border-box;transition:border-color .2s;
          "
          oninput="this.style.borderColor='#3b82f6';this.style.height='auto';this.style.height=Math.min(this.scrollHeight,160)+'px';"
        ></textarea>
      </div>

      <!-- Bottoni -->
      <div style="padding:14px 20px 0;display:flex;gap:10px;">
        <button id="_opNoteSubmit" onclick="submitOperationNote()"
          style="
            flex:1;height:58px;border-radius:18px;
            background:linear-gradient(135deg,#1e293b,#334155);
            color:white;font-size:18px;font-weight:700;
            border:none;cursor:pointer;
            box-shadow:0 4px 16px rgba(30,41,59,0.3);
            transition:transform .1s,box-shadow .1s;
          "
          onmousedown="this.style.transform='scale(0.98)'"
          onmouseup="this.style.transform='scale(1)'">
          ✓ Invia commento
        </button>
        <button onclick="document.getElementById('_opNoteSheet').remove()"
          style="
            height:58px;padding:0 20px;border-radius:18px;
            background:#f1f5f9;color:#94a3b8;
            font-size:15px;border:none;cursor:pointer;
          ">
          Dopo
        </button>
      </div>
    </div>`;

  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);

  // Focus + tastiera aperta subito
  setTimeout(() => {
    const ta = document.getElementById('_opNoteText');
    if (ta) { ta.focus(); ta.click(); }
  }, 400);
}

// ── Salva nota ───────────────────────────────────────────────
window.submitOperationNote = async function() {
  const ta = document.getElementById('_opNoteText');
  const note = ta?.value?.trim();
  if (!note) {
    ta.style.borderColor = '#ef4444';
    ta.placeholder = 'Scrivi qualcosa — anche una parola va bene!';
    return;
  }

  const btn = ta.parentElement?.nextElementSibling?.querySelector('button');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  const sb = window.supabaseClient;
  const todayCDT = getNowCDT().toISOString().slice(0, 10);

  const { error } = await sb.from('operation_notes').insert({
    note_date: todayCDT,
    user_name: window.user?.name || 'Unknown',
    note: note,
    service: 'dinner',
  });

  if (error) {
    if (btn) { btn.textContent = '✓ Invia'; btn.disabled = false; }
    if (typeof showScToast === 'function') showScToast('❌ Errore: ' + error.message);
    return;
  }

  // Chiudi con animazione
  const sheet = document.getElementById('_opNoteSheet');
  if (sheet) {
    sheet.style.transition = 'opacity .3s';
    sheet.style.opacity = '0';
    setTimeout(() => sheet.remove(), 300);
  }

  if (typeof showScToast === 'function') showScToast('✅ Grazie ' + (window.user?.name || '') + ' — buona notte! 🌙');
};
