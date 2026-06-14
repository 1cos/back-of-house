// ══════════════════════════════════════════════════════════════
// SOUS CHEF CHAT — chat privata Max ↔ Sous Chef
// Accesso completo DB, può scrivere ovunque (v15 Edge Function)
// ══════════════════════════════════════════════════════════════

let _scChatHistory = [];

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
          <button onclick="document.getElementById('_scChatSheet').remove()"
            style="width:36px;height:36px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:18px;color:#64748b;cursor:pointer;">✕</button>
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
            ${['Quanto costa la burrata?','Stew Meat: 12 lb a cassa, $3.29/lb','Cosa ho venduto ieri?','Warning aperti'].map(s => `
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
        ${m.dbAction ? `<div style="font-size:12px;margin-top:6px;opacity:0.7;">✅ ${m.dbAction}</div>` : ''}
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

// ── INVIA MESSAGGIO ──
window.scChatSend = async function(prefill) {
  const input = document.getElementById('_scChatInput');
  const text = (prefill || input?.value || '').trim();
  if (!text) return;
  if (input) { input.value = ''; input.style.height = 'auto'; }
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
  const sb = window.supabaseClient;

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

    // La Edge Function v15 esegue già le azioni — il risultato è in data.reply
    scChatAddMsg('assistant', data.reply, {
      dbAction: data.action ? `Azione: ${data.action.type}` : null
    });

    // Aggiorna banner se c'è stata un'azione DB
    if (data.action && typeof loadWarningsBanner === 'function') {
      loadWarningsBanner();
    }

  } catch(e) {
    document.getElementById(typingId)?.remove();
    scChatAddMsg('assistant', '❌ Errore: ' + e.message, { isError: true });
  }
}
