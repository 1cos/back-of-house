// ── OPERATION NOTES — commento serale della brigata ──────────
// Pop-up alle 22:30 per tutta la brigata.
// "Come è andata stasera?" — una frase, 30 secondi.
// Le note alimentano il briefing mattutino del Sous Chef.

const OPERATION_NOTES_HOUR = 22; // 10pm CDT
const OPERATION_NOTES_MIN  = 30;

// Controlla se mostrare il pop-up (una volta sola per serata)
window.checkOperationNotePrompt = async function() {
  if (!window.user) return;

  // Orario Dallas
  const now = getNowDallas ? getNowDallas() : new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  // Finestra: 22:30 → 23:59
  if (h < OPERATION_NOTES_HOUR || (h === OPERATION_NOTES_HOUR && m < OPERATION_NOTES_MIN)) return;
  if (h >= 24) return;

  // Controlla se ha già lasciato una nota stasera
  const todayKey = `op_note_done_${now.toLocaleDateString('en-CA')}_${window.user.name}`;
  if (localStorage.getItem(todayKey)) return;

  // Controlla anche nel DB
  const today = now.toLocaleDateString('en-CA');
  const { data: existing } = await window.supabaseClient
    .from('operation_notes')
    .select('id')
    .eq('note_date', today)
    .eq('user_name', window.user.name)
    .maybeSingle();

  if (existing) {
    localStorage.setItem(todayKey, '1');
    return;
  }

  // Mostra il pop-up dopo 3 secondi
  setTimeout(() => showOperationNotePrompt(), 3000);
};

function showOperationNotePrompt() {
  if (document.getElementById('_opNoteModal')) return;

  const modal = document.createElement('div');
  modal.id = '_opNoteModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9700;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.6);';

  const userName = window.user?.name || 'Chef';
  const greetings = ['Come è andata stasera?', 'Una parola sulla serata?', 'Raccontami la serata.'];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];

  modal.innerHTML = `
    <div style="background:white;border-radius:24px 24px 0 0;padding:24px 20px 32px;width:100%;max-width:480px;margin:0 auto;">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 20px;"></div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <span style="font-size:36px;">🌙</span>
        <div>
          <div style="font-size:20px;font-weight:700;color:#1e293b;">Hey ${userName}</div>
          <div style="font-size:15px;color:#64748b;margin-top:2px;">${greeting}</div>
        </div>
      </div>

      <textarea id="_opNoteText"
        placeholder="Una frase va benissimo. In italiano, inglese o spagnolo."
        style="width:100%;height:100px;padding:14px;border:2px solid #e2e8f0;border-radius:16px;font-size:16px;font-family:inherit;resize:none;outline:none;box-sizing:border-box;line-height:1.5;"
        onfocus="this.style.borderColor='#3b82f6';"
        onblur="this.style.borderColor='#e2e8f0';"></textarea>

      <div style="display:flex;gap:10px;margin-top:14px;">
        <button onclick="saveOperationNote()"
          style="flex:1;height:52px;border-radius:16px;background:#1e293b;color:white;font-size:17px;font-weight:700;border:none;cursor:pointer;">
          ✓ Invia
        </button>
        <button onclick="document.getElementById('_opNoteModal')?.remove()"
          style="height:52px;padding:0 20px;border-radius:16px;background:#f1f5f9;color:#64748b;font-size:15px;border:none;cursor:pointer;">
          Dopo
        </button>
      </div>
    </div>`;

  // Focus automatico sulla textarea
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('_opNoteText')?.focus(), 300);
}

window.saveOperationNote = async function() {
  const text = document.getElementById('_opNoteText')?.value?.trim();
  if (!text) {
    document.getElementById('_opNoteText')?.focus();
    return;
  }

  const btn = document.querySelector('#_opNoteModal button');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  const sb = window.supabaseClient;
  const now = getNowDallas ? getNowDallas() : new Date();
  const today = now.toLocaleDateString('en-CA');

  const { error } = await sb.from('operation_notes').insert({
    note_date:  today,
    user_name:  window.user?.name || 'Unknown',
    note:       text,
    service:    now.getHours() < 15 ? 'lunch' : 'dinner',
  });

  if (error) {
    if (typeof showScToast === 'function') showScToast('❌ Errore: ' + error.message);
    if (btn) { btn.textContent = '✓ Invia'; btn.disabled = false; }
    return;
  }

  // Segna come fatto per oggi
  const todayKey = `op_note_done_${today}_${window.user?.name}`;
  localStorage.setItem(todayKey, '1');

  // Chiudi con animazione
  const modal = document.getElementById('_opNoteModal');
  if (modal) {
    modal.style.transition = 'opacity .3s';
    modal.style.opacity = '0';
    setTimeout(() => modal.remove(), 300);
  }

  if (typeof showScToast === 'function') showScToast('✓ Grazie — buona notte!');
};

// ── ADMIN: visualizza note della brigata ─────────────────────
window.openOperationNotes = async function() {
  if (!isAdmin()) return;

  const sb = window.supabaseClient;
  const { data: notes } = await sb
    .from('operation_notes')
    .select('*')
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9400;display:flex;flex-direction:column;background:white;overflow-y:auto;';

  // Raggruppa per data
  const byDate = {};
  for (const n of (notes || [])) {
    if (!byDate[n.note_date]) byDate[n.note_date] = [];
    byDate[n.note_date].push(n);
  }

  const datesHtml = Object.entries(byDate).map(([date, dayNotes]) => {
    const d = new Date(date + 'T12:00:00');
    const label = d.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
    const notesHtml = dayNotes.map(n => `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:0.5px solid #f1f5f9;">
        <div style="width:32px;height:32px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#475569;flex-shrink:0;">
          ${(n.user_name||'?')[0].toUpperCase()}
        </div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;color:#1e293b;">${n.user_name || '?'}</div>
          <div style="font-size:14px;color:#475569;margin-top:2px;line-height:1.5;">${n.note}</div>
        </div>
      </div>`).join('');

    return `
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">${label}</div>
        ${notesHtml}
      </div>`;
  }).join('');

  modal.innerHTML = `
    <div style="position:sticky;top:0;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;z-index:10;">
      <button onclick="this.closest('[style*=z-index]').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;">‹</button>
      <div>
        <div style="font-size:15px;font-weight:600;color:#1e293b;">🌙 Note della brigata</div>
        <div style="font-size:11px;color:#94a3b8;">Commenti post-servizio</div>
      </div>
    </div>
    <div style="padding:16px;max-width:480px;width:100%;margin:0 auto;">
      ${datesHtml || '<div style="text-align:center;padding:40px;color:#94a3b8;">Nessuna nota ancora</div>'}
    </div>`;

  document.body.appendChild(modal);
};
