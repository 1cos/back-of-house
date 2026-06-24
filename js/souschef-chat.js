// ══════════════════════════════════════════════════════════════
// SOUS CHEF CHAT — chat privata Max ↔ Sous Chef
// Accesso completo DB, può scrivere ovunque (v15 Edge Function)
// ══════════════════════════════════════════════════════════════

let _scChatHistory = [];

// Azione in attesa di conferma Max
let _scPendingAction = null;

window.openSousChefChat = function() {
  if (document.getElementById('_scChatSheet')) return;

  const sheet = document.createElement('div');
  sheet.id = '_scChatSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);display:flex;flex-direction:column;justify-content:flex-end;';

  sheet.innerHTML = `
    <div id="_scChatInner" style="
      background:white;width:100%;max-width:480px;margin:0 auto;
      border-radius:28px 28px 0 0;height:80vh;
      display:flex;flex-direction:column;
      box-shadow:0 -8px 40px rgba(0,0,0,0.2);animation:slideUp .25s ease;
    ">
      <!-- Header -->
      <div style="padding:12px 16px 8px;border-bottom:1px solid #f1f5f9;flex-shrink:0;">
        <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 10px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:12px;background:#f0f9ff;border:1.5px solid #bae6fd;display:flex;align-items:center;justify-content:center;font-size:20px;">🤖</div>
            <div>
              <div style="font-size:16px;font-weight:700;color:#1e293b;">Sous Chef</div>
              <div style="font-size:12px;color:#10b981;">● Online — accesso completo al DB</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="document.getElementById('_scChatSheet').remove();setTimeout(()=>{localStorage.removeItem('sc_last_scan');runSousChefScan();},100)"
              style="width:36px;height:36px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:16px;cursor:pointer;" title="Lancia scan">🔍</button>
            <button onclick="document.getElementById('_scChatSheet').remove()"
              style="width:36px;height:36px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:18px;color:#64748b;cursor:pointer;">✕</button>
          </div>
        </div>
      </div>

      <!-- Messaggi -->
      <div id="_scChatMsgs" style="flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;">
        ${_scChatHistory.length === 0 ? `
          <div style="text-align:center;padding:24px 16px;color:#94a3b8;">
            <div style="font-size:32px;margin-bottom:8px;">👨‍🍳</div>
            <div style="font-size:15px;font-weight:600;color:#475569;margin-bottom:4px;">Ciao Chef.</div>
            <div style="font-size:13px;line-height:1.5;">Chiedimi qualsiasi cosa — prezzi, fornitori, vendite, ricette.<br>Posso anche aggiornare il database.</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:0 8px;">
            ${['Quanto costa la burrata?','Cosa ho venduto ieri?','Warning aperti','Modifica la ricetta X'].map(s => `
              <button onclick="scChatSend('${s}')"
                style="padding:8px 14px;border-radius:20px;border:1.5px solid #e2e8f0;background:#f8fafc;font-size:13px;color:#475569;cursor:pointer;">
                ${s}
              </button>`).join('')}
          </div>` : _scChatHistory.map(m => scChatRenderMsg(m)).join('')}
      </div>

      <!-- Input -->
      <div style="padding:10px 12px 20px;border-top:1px solid #f1f5f9;flex-shrink:0;">
        <div style="display:flex;gap:8px;align-items:flex-end;">
          <textarea id="_scChatInput" placeholder="Chiedi al Sous Chef..."
            rows="1"
            style="flex:1;padding:12px 14px;border:2px solid #e2e8f0;border-radius:16px;font-size:16px;line-height:1.4;resize:none;outline:none;max-height:100px;overflow-y:auto;background:#f8fafc;"
            oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px';this.style.borderColor='#3b82f6';"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();scChatSend();}"></textarea>
          <button onclick="scChatSend()"
            style="width:48px;height:48px;border-radius:14px;background:#1e293b;color:white;border:none;cursor:pointer;font-size:20px;flex-shrink:0;">↑</button>
          <button onclick="scChatVoice()"
            style="width:48px;height:48px;border-radius:14px;background:#3b82f6;color:white;border:none;cursor:pointer;font-size:20px;flex-shrink:0;">🎙</button>
        </div>
      </div>
    </div>`;

  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
  setTimeout(() => document.getElementById('_scChatInput')?.focus(), 300);
};

// ── RENDER MESSAGGIO ──
function scChatRenderMsg(m) {
  const isMe = m.role === 'user';
  return `
    <div style="display:flex;${isMe ? 'justify-content:flex-end;' : 'justify-content:flex-start;'}">
      <div style="
        max-width:82%;padding:11px 14px;
        border-radius:${isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};
        font-size:15px;line-height:1.5;
        ${isMe ? 'background:linear-gradient(135deg,#0369a1,#0284c7);color:white;' : 'background:#f1f5f9;color:#1e293b;'}
        ${m.isError ? 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;' : ''}
      ">
        ${m.content}
      </div>
    </div>`;
}

// ── CARD CONFERMA AZIONE ──
function scChatRenderConfirmCard(action, replyText) {
  // Descrizione leggibile dell'azione
  let desc = '';
  switch (action.type) {
    case 'update_recipe_ingredient':
      desc = `Modifico <b>${action.ingredient_name}</b> nella ricetta <b>${action.recipe_title}</b>`;
      if (action.updates) {
        const changes = Object.entries(action.updates).map(([k,v]) => `${k}: <b>${v}</b>`).join(', ');
        desc += `<br><span style="font-size:13px;color:#64748b;">${changes}</span>`;
      }
      break;
    case 'update_ingredient_vendor':
      desc = `Aggiorno <b>${action.ingredient_name}</b> da <b>${action.vendor}</b>`;
      if (action.updates) {
        const changes = Object.entries(action.updates).map(([k,v]) => `${k}: <b>${v}</b>`).join(', ');
        desc += `<br><span style="font-size:13px;color:#64748b;">${changes}</span>`;
      }
      break;
    case 'block_ingredient_vendor':
      desc = `Blocco <b>${action.ingredient_name}</b> da <b>${action.vendor}</b>`;
      if (action.reason) desc += `<br><span style="font-size:13px;color:#64748b;">${action.reason}</span>`;
      break;
    case 'block_ingredient_all_vendors':
      desc = `Blocco <b>${action.ingredient_name}</b> da <b>tutti i fornitori</b>`;
      break;
    case 'block_all_from_vendor':
      desc = `Blocco <b>tutto</b> da <b>${action.vendor}</b>`;
      break;
    case 'unblock_ingredient_vendor':
      desc = `Sblocco <b>${action.ingredient_name}</b> da <b>${action.vendor}</b>`;
      break;
    case 'unblock_ingredient_all_vendors':
      desc = `Sblocco <b>${action.ingredient_name}</b> da tutti i fornitori`;
      break;
    case 'unblock_all_from_vendor':
      desc = `Sblocco tutto da <b>${action.vendor}</b>`;
      break;
    case 'resolve_warning':
      desc = `Chiudo il warning <b>${action.warning_id}</b>`;
      break;
    case 'add_prep_log':
      desc = `Registro prep: <b>${action.qty} ${action.unit}</b> di <b>${action.item}</b>`;
      break;
    case 'create_office_item':
      desc = `Creo nota in L'Ufficio: <b>${action.title}</b>`;
      break;
    default:
      desc = `Azione: <b>${action.type}</b>`;
  }

  return `
    <div style="display:flex;justify-content:flex-start;">
      <div style="max-width:92%;width:100%;">
        <!-- Risposta AI -->
        <div style="background:#f1f5f9;color:#1e293b;padding:11px 14px;border-radius:18px 18px 4px 18px;font-size:15px;line-height:1.5;margin-bottom:10px;">
          ${replyText}
        </div>
        <!-- Card conferma -->
        <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:16px;padding:14px 16px;">
          <div style="font-size:12px;font-weight:700;color:#c2410c;letter-spacing:.05em;margin-bottom:8px;">⚠️ AZIONE DB — CONFERMA RICHIESTA</div>
          <div style="font-size:15px;color:#1e293b;margin-bottom:14px;line-height:1.5;">${desc}</div>
          <div style="display:flex;gap:10px;">
            <button onclick="scChatConfirm()" style="flex:1;height:48px;border-radius:14px;background:#16a34a;color:white;font-size:16px;font-weight:700;border:none;cursor:pointer;">✅ Sì Chef</button>
            <button onclick="scChatCancel()" style="flex:1;height:48px;border-radius:14px;background:#f8fafc;color:#64748b;font-size:16px;font-weight:600;border:1px solid #e2e8f0;cursor:pointer;">❌ No</button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── AGGIUNGI MESSAGGIO ──
function scChatAddMsg(role, content, extra = {}) {
  const msg = { role, content, ...extra };
  _scChatHistory.push(msg);
  const container = document.getElementById('_scChatMsgs');
  if (!container) return;
  const empty = container.querySelector('[style*="text-align:center"]');
  if (empty) empty.closest('div')?.remove();
  const el = document.createElement('div');
  el.innerHTML = scChatRenderMsg(msg);
  container.appendChild(el.firstElementChild);
  container.scrollTop = container.scrollHeight;
}

// ── MOSTRA CARD CONFERMA ──
function scChatShowConfirm(action, replyText) {
  _scPendingAction = action;
  const container = document.getElementById('_scChatMsgs');
  if (!container) return;
  const empty = container.querySelector('[style*="text-align:center"]');
  if (empty) empty.closest('div')?.remove();
  // Rimuovi eventuale card precedente
  const old = document.getElementById('_scConfirmCard');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = '_scConfirmCard';
  el.innerHTML = scChatRenderConfirmCard(action, replyText);
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ── CONFERMA ──
window.scChatConfirm = async function() {
  if (!_scPendingAction) return;
  const action = _scPendingAction;
  _scPendingAction = null;

  // Rimuovi card conferma
  document.getElementById('_scConfirmCard')?.remove();

  // Aggiungi "Sì Chef" come messaggio utente
  scChatAddMsg('user', '✅ Sì Chef');

  // Typing indicator
  const typingId = '_scTyping_' + Date.now();
  const container = document.getElementById('_scChatMsgs');
  if (container) {
    const typing = document.createElement('div');
    typing.id = typingId;
    typing.style.cssText = 'display:flex;justify-content:flex-start;';
    typing.innerHTML = `<div style="padding:12px 16px;background:#f1f5f9;border-radius:18px 18px 18px 4px;color:#94a3b8;font-size:15px;">⏳ eseguo...</div>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/souschef-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        message: '__execute_confirmed__',
        confirmed_action: action,
        history: [],
      }),
    });
    const data = await res.json();
    document.getElementById(typingId)?.remove();

    if (data.error) {
      scChatAddMsg('assistant', '❌ ' + data.error, { isError: true });
      return;
    }
    scChatAddMsg('assistant', data.reply);
    if (typeof loadWarningsBanner === 'function') loadWarningsBanner();
  } catch(e) {
    document.getElementById(typingId)?.remove();
    scChatAddMsg('assistant', '❌ Errore: ' + e.message, { isError: true });
  }
};

// ── ANNULLA ──
window.scChatCancel = function() {
  _scPendingAction = null;
  document.getElementById('_scConfirmCard')?.remove();
  scChatAddMsg('assistant', 'Ok Chef, non faccio niente.');
};

// ── INVIA MESSAGGIO ──
window.scChatSend = async function(prefill) {
  const input = document.getElementById('_scChatInput');
  const text = (prefill || input?.value || '').trim();
  if (!text) return;
  if (input) { input.value = ''; input.style.height = 'auto'; }

  // Comando test: domenica
  if (text.toLowerCase().includes('test domenica')) {
    scChatAddMsg('user', text);
    scChatAddMsg('assistant', 'Genero il messaggio domenicale...');
    try {
      if (typeof scSundayGreeting === 'function') {
        const texas = new Date(Date.now() - 5*60*60*1000);
        await scSundayGreeting(texas);
        scChatAddMsg('assistant', 'Messaggio domenicale inviato in Service Updates. Controlla la home!');
      } else {
        scChatAddMsg('assistant', 'Funzione scSundayGreeting non trovata — ricarica l app.');
      }
    } catch(e) {
      scChatAddMsg('assistant', 'Errore: ' + e.message);
    }
    return;
  }

  // Comando test: briefing
  if (text.toLowerCase().includes('test briefing')) {
    scChatAddMsg('user', text);
    scChatAddMsg('assistant', 'Genero il briefing mattutino...');
    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/sc-nightly-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.points && data.points.length) {
        const pts = data.points.map(function(p, i) { return (i+1) + '. ' + p; }).join('\n\n');
        scChatAddMsg('assistant', 'Briefing generato:\n\n' + pts);
      } else {
        scChatAddMsg('assistant', 'Nessun punto generato: ' + JSON.stringify(data));
      }
    } catch(e) {
      scChatAddMsg('assistant', 'Errore: ' + e.message);
    }
    return;
  }

  scChatAddMsg('user', text);
  await scChatProcess(text);
};

// ── VOCE IN CHAT ──
window.scChatVoice = async function() {
  if (isRecording) { stopRecording(); return; }
  window._scChatVoiceMode = true;
  await startRecording();
};

// ── PROCESSA MESSAGGIO ──
async function scChatProcess(userText) {
  // Typing indicator
  const typingId = '_scTyping_' + Date.now();
  const container = document.getElementById('_scChatMsgs');
  if (container) {
    const typing = document.createElement('div');
    typing.id = typingId;
    typing.style.cssText = 'display:flex;justify-content:flex-start;';
    typing.innerHTML = `<div style="padding:12px 16px;background:#f1f5f9;border-radius:18px 18px 18px 4px;color:#94a3b8;font-size:15px;">⏳ sto cercando...</div>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/souschef-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        message: userText,
        history: _scChatHistory.slice(-10).map(m => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await res.json();
    document.getElementById(typingId)?.remove();

    if (data.error) { scChatAddMsg('assistant', '❌ ' + data.error, { isError: true }); return; }

    // Se c'è un'azione proposta → mostra card conferma, NON eseguire
    if (data.action && data.pending) {
      scChatShowConfirm(data.action, data.reply);
    } else {
      // Solo risposta testuale, nessuna azione
      scChatAddMsg('assistant', data.reply);
      if (data.action && typeof loadWarningsBanner === 'function') {
        loadWarningsBanner();
      }
    }

  } catch(e) {
    document.getElementById(typingId)?.remove();
    scChatAddMsg('assistant', '❌ Errore: ' + e.message, { isError: true });
  }
}
