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
  // Non mostrare se già aperto
  if (document.getElementById('_opNoteSheet')) return;

  const sheet = document.createElement('div');
  sheet.id = '_opNoteSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:flex-end;';

  sheet.innerHTML = `
    <div style="
      background:white;
      width:100%;
      max-width:480px;
      margin:0 auto;
      border-radius:28px 28px 0 0;
      padding:0 0 40px;
      animation:slideUp .3s ease;
      box-shadow:0 -8px 40px rgba(0,0,0,0.25);
    ">
      <!-- Handle -->
      <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;margin:14px auto 0;"></div>

      <!-- Header -->
      <div style="padding:20px 20px 0;">
        <div style="font-size:13px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">🌙 Fine Serata</div>
        <div style="font-size:24px;font-weight:800;color:#1e293b;line-height:1.2;margin-bottom:4px;">Come è andata stasera?</div>
        <div style="font-size:15px;color:#64748b;">Una frase. Qualsiasi lingua. Nessun formato.</div>
      </div>

      <!-- Esempi -->
      <div style="padding:14px 20px 0;display:flex;gap:8px;flex-wrap:wrap;">
        ${['Serata tranquilla 👌','Tutto ok ma lento','Super impegnati 🔥','Mancava personale'].map(ex => `
          <button onclick="document.getElementById('_opNoteText').value='${ex}'"
            style="padding:6px 12px;border-radius:20px;border:1.5px solid #e2e8f0;background:#f8fafc;font-size:13px;color:#475569;cursor:pointer;">
            ${ex}
          </button>`).join('')}
      </div>

      <!-- Input -->
      <div style="padding:14px 20px 0;">
        <textarea id="_opNoteText" placeholder="Es: serata tranquilla, mancava il salmone, tavolo 12 difficile..."
          style="
            width:100%;
            min-height:90px;
            padding:14px;
            border:2px solid #e2e8f0;
            border-radius:16px;
            font-size:17px;
            line-height:1.5;
            color:#1e293b;
            background:#f8fafc;
            outline:none;
            resize:none;
            box-sizing:border-box;
          "
          oninput="this.style.borderColor='#3b82f6';"
        ></textarea>
      </div>

      <!-- Bottoni -->
      <div style="padding:14px 20px 0;display:flex;gap:10px;">
        <button onclick="submitOperationNote()"
          style="
            flex:1;
            height:56px;
            border-radius:16px;
            background:#1e293b;
            color:white;
            font-size:18px;
            font-weight:700;
            border:none;
            cursor:pointer;
          ">
          ✓ Invia
        </button>
        <button onclick="document.getElementById('_opNoteSheet').remove()"
          style="
            height:56px;
            padding:0 20px;
            border-radius:16px;
            background:#f1f5f9;
            color:#64748b;
            font-size:15px;
            border:none;
            cursor:pointer;
          ">
          Dopo
        </button>
      </div>
    </div>`;

  document.body.appendChild(sheet);

  // Focus automatico dopo animazione
  setTimeout(() => {
    const ta = document.getElementById('_opNoteText');
    if (ta) ta.focus();
  }, 350);
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
