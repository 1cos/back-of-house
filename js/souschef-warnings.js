// ══════════════════════════════════════════════════════════════
// SOUS CHEF WARNINGS — banner, modal questionario, salvataggio
// Zero AI in questo file. Legge dal DB, salva nel DB. Basta.
// ══════════════════════════════════════════════════════════════

// ── BANNER HOME ──────────────────────────────────────────────
window.loadWarningsBanner = async function() {
  const sb = window.supabaseClient;
  if (!sb || !isAdmin()) return;

  const { data: warns } = await sb
    .from('invoice_warnings')
    .select('id, code, severity, category, vendor, item_description, message, question, options, status')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20);

  const container = document.getElementById('warningsBanner');
  if (!container) return;

  if (!warns || warns.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  // Raggruppa per severity
  const blocking = warns.filter(w => w.severity === 'blocking');
  const alert    = warns.filter(w => w.severity === 'alert');
  const insight  = warns.filter(w => w.severity === 'insight');

  const severityLabel = { blocking: '🔴 URGENTE', alert: '🟡 Attenzione', insight: '🔵 Info' };
  const severityBg    = { blocking: '#fef2f2', alert: '#fffbeb', insight: '#eff6ff' };
  const severityBorder= { blocking: '#fca5a5', alert: '#fcd34d', insight: '#93c5fd' };
  const severityText  = { blocking: '#dc2626', alert: '#d97706', insight: '#2563eb' };

  const groups = [
    { sev: 'blocking', items: blocking },
    { sev: 'alert',    items: alert    },
    { sev: 'insight',  items: insight  },
  ].filter(g => g.items.length > 0);

  container.innerHTML = groups.map(g => `
    <div style="margin-bottom:8px;">
      <div style="font-size:11px;font-weight:700;color:${severityText[g.sev]};margin-bottom:4px;letter-spacing:.05em;">
        ${severityLabel[g.sev]} — ${g.items.length}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${g.items.map(w => `
          <button onclick="openWarningModal('${w.id}')"
            style="
              width:100%;text-align:left;padding:10px 14px;
              background:${severityBg[g.sev]};
              border:1.5px solid ${severityBorder[g.sev]};
              border-radius:12px;cursor:pointer;
              display:flex;align-items:center;justify-content:space-between;gap:8px;
            ">
            <div>
              <div style="font-size:14px;font-weight:600;color:#1e293b;line-height:1.3;">${w.item_description || w.message}</div>
              ${w.vendor ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${w.vendor}</div>` : ''}
            </div>
            <div style="font-size:18px;flex-shrink:0;">›</div>
          </button>`).join('')}
      </div>
    </div>`).join('');
};

// ── MODAL WARNING — zero AI, legge dal DB ────────────────────
window.openWarningModal = async function(warningId) {
  const sb = window.supabaseClient;
  if (!sb) return;

  // Leggi il warning fresco dal DB
  const { data: w, error } = await sb
    .from('invoice_warnings')
    .select('*')
    .eq('id', warningId)
    .single();

  if (error || !w) { showScToast('❌ Warning non trovato'); return; }

  const severityColor = {
    blocking: { bg:'#fef2f2', border:'#fca5a5', text:'#dc2626', label:'🔴 URGENTE' },
    alert:    { bg:'#fffbeb', border:'#fcd34d', text:'#d97706', label:'🟡 Attenzione' },
    insight:  { bg:'#eff6ff', border:'#93c5fd', text:'#2563eb', label:'🔵 Info' },
  }[w.severity] || { bg:'#f8fafc', border:'#e2e8f0', text:'#64748b', label:'ℹ️ Info' };

  // Parse options dal DB
  let options = [];
  try { options = JSON.parse(w.options || '[]'); } catch(_) {}

  const modalId = '_scWarnModal_' + Date.now();
  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);display:flex;flex-direction:column;justify-content:flex-end;';

  overlay.innerHTML = `
    <div style="
      background:white;width:100%;max-width:480px;margin:0 auto;
      border-radius:28px 28px 0 0;padding-bottom:32px;
      max-height:85vh;overflow-y:auto;
      animation:slideUp .25s ease;box-shadow:0 -8px 40px rgba(0,0,0,0.2);
    ">
      <!-- Handle -->
      <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;margin:12px auto 0;"></div>

      <!-- Header severity -->
      <div style="padding:12px 16px 0;">
        <div style="font-size:11px;font-weight:700;color:${severityColor.text};letter-spacing:.06em;">${severityColor.label}</div>
      </div>

      <!-- Titolo problema -->
      <div style="padding:8px 16px 16px;">
        <div style="font-size:20px;font-weight:700;color:#1e293b;line-height:1.3;">${w.item_description || w.message}</div>
        ${w.vendor ? `<div style="font-size:13px;color:#64748b;margin-top:4px;">${w.vendor}</div>` : ''}
      </div>

      <!-- Messaggio dettaglio -->
      <div style="margin:0 16px 16px;padding:14px;background:${severityColor.bg};border:1.5px solid ${severityColor.border};border-radius:16px;">
        <div style="font-size:14px;color:#374151;line-height:1.5;">${w.message}</div>
      </div>

      <!-- Domanda OQR -->
      ${w.question ? `
      <div style="padding:0 16px 12px;">
        <div style="font-size:16px;font-weight:600;color:#1e293b;line-height:1.4;">${w.question}</div>
      </div>` : ''}

      <!-- Opzioni preconfigurate dall'AI -->
      ${options.length > 0 ? `
      <div style="padding:0 16px;display:flex;flex-direction:column;gap:8px;" id="_warnOptions_${warningId}">
        ${options.map((opt, idx) => `
          <button onclick="scApplyWarningOption('${warningId}', ${idx})"
            style="
              width:100%;padding:14px 16px;text-align:left;
              background:#f8fafc;border:2px solid #e2e8f0;
              border-radius:14px;cursor:pointer;font-size:15px;
              color:#1e293b;font-weight:500;transition:border-color .15s;
            "
            onmouseover="this.style.borderColor='#3b82f6'"
            onmouseout="this.style.borderColor='#e2e8f0'">
            ${opt.label}
          </button>`).join('')}
      </div>` : ''}

      <!-- Input libero (sempre disponibile) -->
      <div style="padding:${options.length > 0 ? '12px' : '0'} 16px 0;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">${options.length > 0 ? 'Oppure scrivi tu:' : 'La tua risposta:'}</div>
        <textarea id="_warnInput_${warningId}"
          placeholder="es. sono 12 lb in totale, non 48..."
          rows="2"
          style="width:100%;padding:12px 14px;border:2px solid #e2e8f0;border-radius:12px;font-size:15px;resize:none;outline:none;box-sizing:border-box;background:#f8fafc;"
          onfocus="this.style.borderColor='#3b82f6'"
          onblur="this.style.borderColor='#e2e8f0'"></textarea>
      </div>

      <!-- Azioni -->
      <div style="padding:12px 16px 0;display:flex;gap:8px;">
        <button onclick="scSendWarningToChat('${warningId}')"
          style="flex:1;padding:14px;border-radius:14px;background:#3b82f6;color:white;border:none;cursor:pointer;font-size:15px;font-weight:600;">
          💬 Chiedi al Sous Chef
        </button>
        <button onclick="scDismissWarning('${warningId}', '${modalId}')"
          style="padding:14px 18px;border-radius:14px;background:#f1f5f9;color:#64748b;border:none;cursor:pointer;font-size:15px;">
          Skip
        </button>
      </div>

      <!-- Chiudi -->
      <div style="padding:8px 16px 0;">
        <button onclick="document.getElementById('${modalId}').remove()"
          style="width:100%;padding:14px;border-radius:14px;background:#f8fafc;border:1.5px solid #e2e8f0;color:#94a3b8;font-size:14px;cursor:pointer;">
          ✕ Chiudi
        </button>
      </div>
    </div>`;

  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Salva opzioni in memoria per accederle da scApplyWarningOption
  window._scWarningOptions = window._scWarningOptions || {};
  window._scWarningOptions[warningId] = { warning: w, options, modalId };
};

// ── APPLICA OPZIONE PRECONFIGURATA — zero AI ─────────────────
window.scApplyWarningOption = async function(warningId, optIdx) {
  const ctx = window._scWarningOptions?.[warningId];
  if (!ctx) return;
  const opt = ctx.options[optIdx];
  if (!opt) return;

  const sb = window.supabaseClient;
  if (!sb) return;

  showScToast('⏳ Salvataggio...');

  try {
    const w = ctx.warning;

    // Esegui update sulla tabella target
    if (opt.updates && w.target_table && w.target_id) {
      const updates = { ...opt.updates, updated_at: new Date().toISOString() };

      // Ricalcola price_per_100g se stiamo aggiornando conversion_to_base o price_type
      if (w.target_table === 'ingredient_vendors' &&
          (opt.updates.conversion_to_base || opt.updates.price_type)) {
        const { data: existing } = await sb.from('ingredient_vendors')
          .select('unit_price, price_type, conversion_to_base')
          .eq('ingredient_id', w.ingredient_id)
          .ilike('vendor', `%${w.vendor || ''}%`)
          .single();
        if (existing) {
          const merged = { ...existing, ...opt.updates };
          const up = parseFloat(merged.unit_price) || 0;
          const pt = merged.price_type || 'per_case';
          const ctb = parseFloat(merged.conversion_to_base) || 0;
          let p100 = null;
          if (pt === 'per_lb' && up > 0) p100 = (up / 453.592) * 100;
          else if (pt === 'per_kg' && up > 0) p100 = (up / 1000) * 100;
          else if (ctb > 0 && up > 0) p100 = (up / ctb) * 100;
          if (p100 !== null) updates.price_per_100g = parseFloat(p100.toFixed(4));
        }
      }

      const { error: updateErr } = await sb.from(w.target_table)
        .update(updates)
        .eq('ingredient_id', w.ingredient_id || w.target_id);
      if (updateErr) { showScToast('❌ ' + updateErr.message); return; }
    }

    // Risolvi il warning
    await sb.from('invoice_warnings').update({
      status: 'resolved',
      resolution: opt.label,
      resolved_by: window.user?.name || 'Admin',
      resolved_at: new Date().toISOString(),
    }).eq('id', warningId);

    // Chiudi modal e aggiorna banner
    document.getElementById(ctx.modalId)?.remove();
    loadWarningsBanner();
    showScToast('✅ Risolto — ' + opt.label);

  } catch(e) {
    showScToast('❌ Errore: ' + e.message);
  }
};

// ── MANDA ALLA CHAT per risposta libera ──────────────────────
window.scSendWarningToChat = function(warningId) {
  const ctx = window._scWarningOptions?.[warningId];
  if (!ctx) return;
  const input = document.getElementById(`_warnInput_${warningId}`);
  const text = input?.value?.trim() || '';
  const w = ctx.warning;

  // Chiudi modal warning
  document.getElementById(ctx.modalId)?.remove();

  // Apri chat con contesto precaricato
  openSousChefChat();
  const prefill = text
    ? `Warning "${w.item_description}": ${text}`
    : `Aiutami a risolvere questo warning: "${w.item_description}". ${w.question || w.message}`;

  setTimeout(() => scChatSend(prefill), 400);
};

// ── SKIP WARNING ─────────────────────────────────────────────
window.scDismissWarning = async function(warningId, modalId) {
  const sb = window.supabaseClient;
  if (!sb) return;
  await sb.from('invoice_warnings').update({
    status: 'resolved',
    resolution: 'skip — rivisto manualmente',
    resolved_at: new Date().toISOString(),
  }).eq('id', warningId);
  document.getElementById(modalId)?.remove();
  loadWarningsBanner();
};
