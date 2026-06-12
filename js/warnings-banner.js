// ── WARNINGS BANNER ───────────────────────────────────────────
// Legge invoice_warnings (status=open) + vendor_documents.warnings JSONB
// Mostra banner colorato in home page per severity.
// Un tap → OQR question → risposta → warning sparisce.
// Visibilità per ruolo: Admin tutto, Chef/Sous Chef alerts only, Cooks niente.

async function loadWarningsBanner() {
  const container = document.getElementById('warningsBanner');
  if (!container) return;

  // Cooks non vedono niente (BIOS-002)
  const role = window.user?.role || '';
  if (role === 'cook') { container.style.display = 'none'; return; }

  try {
    const sb = window.supabaseClient;
    if (!sb) return;

    // ── 1. Leggi invoice_warnings status=open ──
    let query = sb.from('invoice_warnings')
      .select('id,code,severity,vendor,document_id,item_description,message,created_at')
      .eq('status', 'open')
      .order('severity', { ascending: true }) // blocking first
      .order('created_at', { ascending: false })
      .limit(50);

    // Chef/Sous Chef: solo alert (no blocking da invoice pipeline)
    if (role !== 'admin') {
      query = query.eq('severity', 'alert');
    }

    const { data: warnings } = await query;

    // ── 2. Leggi vendor_documents.warnings JSONB (solo admin) ──
    let vdWarnings = [];
    if (role === 'admin') {
      const { data: docs } = await sb
        .from('vendor_documents')
        .select('id,vendor,document_number,document_date,warnings')
        .in('status', ['pending', 'error'])
        .not('warnings', 'is', null);

      for (const doc of (docs || [])) {
        const wArr = Array.isArray(doc.warnings) ? doc.warnings : [];
        for (const w of wArr) {
          if (!w.code) continue;
          vdWarnings.push({
            _source: 'vd',
            _docId: doc.id,
            _docNumber: doc.document_number,
            code: w.code,
            severity: warnSeverity(w.code),
            vendor: doc.vendor,
            item_description: w.item || null,
            message: w.message || '',
            created_at: doc.document_date || null,
          });
        }
      }
    }

    const allWarnings = [...(warnings || []), ...vdWarnings];

    if (!allWarnings.length) {
      container.style.display = 'none';
      return;
    }

    // ── 3. Raggruppa per severity ──
    const blocking = allWarnings.filter(w => w.severity === 'blocking');
    const alert    = allWarnings.filter(w => w.severity === 'alert');
    const insight  = allWarnings.filter(w => w.severity === 'insight');

    let html = '';

    if (blocking.length) html += renderBannerGroup('blocking', blocking);
    if (alert.length)    html += renderBannerGroup('alert', alert);
    if (insight.length)  html += renderBannerGroup('insight', insight);

    container.innerHTML = html;
    container.style.display = 'block';

  } catch(e) {
    console.error('[WarningsBanner] Error:', e.message);
  }
}

function warnSeverity(code) {
  const blocking = ['INV-PACK-001','OQR-008','DOC-PARSE-001','DOC-VENDOR-001','DOC-TYPE-001','DOC-NOPARSER-001','INV-MATCH-001','INV-DUP-001','INV-OCR-001','PARSE_ERROR','UNKNOWN_VENDOR','UNKNOWN_DOC_TYPE','NO_PARSER','PARSER_ERROR','DOC-TOTAL-001'];
  const insight  = ['INV-SUB-001','OQR-002','INV-PACKCT-001','OQR-006','INV-PRICE-001','INV-UNUSED-001'];
  if (blocking.includes(code)) return 'blocking';
  if (insight.includes(code))  return 'insight';
  return 'alert'; // default: alert
}

function renderBannerGroup(severity, warnings) {
  const cfg = {
    blocking: { bg:'rgba(239,68,68,0.07)',  border:'rgba(239,68,68,0.25)',  dot:'#ef4444', label:'🔴', title:'Needs attention' },
    alert:    { bg:'rgba(245,158,11,0.07)', border:'rgba(245,158,11,0.25)', dot:'#f59e0b', label:'🟡', title:'Review needed' },
    insight:  { bg:'rgba(59,130,246,0.06)', border:'rgba(59,130,246,0.2)',  dot:'#3B82F6', label:'🔵', title:'FYI' },
  }[severity];

  // Mostra massimo 3, poi "N more"
  const shown = warnings.slice(0, 3);
  const extra = warnings.length - shown.length;

  const items = shown.map(w => {
    const name = w.item_description
      ? `<span style="font-weight:600;color:#1e293b;">${w.item_description}</span>`
      : `<span style="color:#475569;">${w.vendor || ''}</span>`;
    const msg = warnShortMessage(w);
    const dataId   = w.id     ? `data-warn-id="${w.id}"`         : '';
    const dataDoc  = w.document_id  ? `data-doc-id="${w.document_id}"` : '';
    const dataVDoc = w._docId ? `data-vd-doc-id="${w._docId}"`   : '';
    const dataCode = `data-code="${w.code}"`;

    return `
      <div ${dataId} ${dataDoc} ${dataVDoc} ${dataCode}
        onclick="warnBannerTap(this)"
        style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:0.5px solid ${cfg.border};active:opacity:.7;">
        <span style="font-size:16px;flex-shrink:0;">${warnEmoji(w.code)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
          <div style="font-size:11px;color:#64748b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${msg}</div>
        </div>
        <span style="font-size:16px;color:#94a3b8;flex-shrink:0;">›</span>
      </div>`;
  }).join('');

  const extraRow = extra > 0
    ? `<div onclick="warnBannerViewAll('${severity}')" style="padding:8px 12px;font-size:12px;color:#64748b;cursor:pointer;text-align:center;">+${extra} more — tap to see all</div>`
    : '';

  return `
    <div style="background:${cfg.bg};border:1px solid ${cfg.border};border-radius:14px;overflow:hidden;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:0.5px solid ${cfg.border};">
        <span style="width:8px;height:8px;border-radius:50%;background:${cfg.dot};flex-shrink:0;display:inline-block;"></span>
        <span style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.07em;flex:1;">${cfg.title}</span>
        <span style="font-size:11px;color:#94a3b8;">${warnings.length}</span>
      </div>
      ${items}
      ${extraRow}
    </div>`;
}

function warnEmoji(code) {
  const map = {
    'OQR-008': '⚖️', 'INV-PACK-001': '⚖️',
    'OQR-007': '📦', 'INV-QTY-001': '📦',
    'OQR-002': '🔄', 'INV-SUB-001': '🔄',
    'OQR-006': '📦', 'INV-PACKCT-001': '📦',
    'DOC-TOTAL-001': '🧮',
    'PARSE_ERROR': '⚠️', 'DOC-PARSE-001': '⚠️',
    'INV-PRICE-001': '📈',
    'OQR-001': '🧾', 'DOC-CREDIT-001': '🧾',
  };
  return map[code] || '⚠️';
}

function warnShortMessage(w) {
  const code = w.code;
  if (code === 'OQR-008' || code === 'INV-PACK-001') return 'Pack weight unknown — tap to answer';
  if (code === 'OQR-007' || code === 'INV-QTY-001')  return 'Quantity mismatch — tap to review';
  if (code === 'OQR-002' || code === 'INV-SUB-001')  return 'Substitution received — tap to confirm';
  if (code === 'OQR-006' || code === 'INV-PACKCT-001') return 'Count pack — tap to confirm';
  if (code === 'DOC-TOTAL-001') return 'Lines don\'t match document total';
  if (code === 'INV-PRICE-001') return 'Price changed — tap to accept';
  return w.message ? w.message.slice(0, 60) : 'Tap to review';
}

// ── Tap handler: apre OQR direttamente ──────────────────────
window.warnBannerTap = async function(el) {
  const warnId  = el.dataset.warnId;
  const docId   = el.dataset.docId || el.dataset.vdDocId;
  const code    = el.dataset.code;

  // Se c'è un documento vendor → apri Vendor Documents Review su quel doc
  if (docId) {
    // Apri Vendor Documents Review filtrato su questo documento
    openVendorDocumentsReview();
    // Aspetta che la modale sia nel DOM, poi triggera il toggle del documento
    setTimeout(() => {
      if (typeof vdrLoad === 'function') {
        vdrLoad().then(() => {
          setTimeout(() => {
            if (typeof vdrToggle === 'function') vdrToggle(docId);
          }, 400);
        });
      }
    }, 300);
    return;
  }

  // Se è solo un invoice_warning senza documento vivo → mostra OQR inline
  if (warnId) {
    showBannerOQR(warnId, code, el);
  }
};

// ── OQR inline dal banner (per warning senza documento padre vivo) ──
async function showBannerOQR(warnId, code, triggerEl) {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: w } = await sb.from('invoice_warnings')
    .select('*').eq('id', warnId).single();
  if (!w) return;

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';

  const emoji = warnEmoji(code);
  const question = warnOQRQuestion(w);

  modal.innerHTML = `
    <div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;">${emoji} WARNING</div>
      <div style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:6px;line-height:1.4;">${question.title}</div>
      <div style="font-size:12px;color:#64748b;background:#f8fafc;padding:8px 10px;border-radius:8px;margin-bottom:14px;">${w.message || ''}</div>
      <div style="font-size:13px;color:#475569;font-weight:500;margin-bottom:10px;">${question.question}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${question.options.map(opt => `
          <button data-answer="${opt.value}"
            onclick="bannerOQRAnswer('${warnId}','${opt.value}',this)"
            style="padding:12px 14px;border-radius:12px;border:1.5px solid #e2e8f0;background:white;font-size:13px;color:#1e293b;cursor:pointer;text-align:left;font-weight:500;">
            ${opt.label}
          </button>`).join('')}
        <button onclick="this.closest('[style*=z-index]').remove()"
          style="padding:10px;border-radius:12px;border:none;background:#f1f5f9;color:#64748b;font-size:12px;cursor:pointer;">
          Later
        </button>
      </div>
    </div>`;

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function warnOQRQuestion(w) {
  const code = w.code;
  const item = w.item_description || 'This item';

  if (code === 'OQR-008' || code === 'INV-PACK-001') {
    return {
      title: item,
      question: 'What is the total weight of this case?',
      options: [
        { label: '1 lb (453g)',   value: '453' },
        { label: '5 lb (2268g)',  value: '2268' },
        { label: '10 lb (4536g)', value: '4536' },
        { label: '25 lb (11340g)',value: '11340' },
        { label: 'Skip for now',  value: 'skip' },
      ]
    };
  }
  if (code === 'OQR-007' || code === 'INV-QTY-001') {
    return {
      title: item,
      question: 'What happened with this quantity?',
      options: [
        { label: 'Short ship — OK', value: 'short_ok' },
        { label: 'Back ordered',    value: 'backorder' },
        { label: 'Skip for now',    value: 'skip' },
      ]
    };
  }
  if (code === 'OQR-002' || code === 'INV-SUB-001') {
    return {
      title: item,
      question: 'Was this substitution accepted?',
      options: [
        { label: 'Yes, accepted',   value: 'accepted' },
        { label: 'No, reject it',   value: 'rejected' },
        { label: 'Skip for now',    value: 'skip' },
      ]
    };
  }
  if (code === 'DOC-TOTAL-001') {
    return {
      title: 'Totals don\'t add up',
      question: 'Lines may be missing. Accept as-is?',
      options: [
        { label: 'Accept as-is',  value: 'accept' },
        { label: 'Needs re-scan', value: 'rescan' },
        { label: 'Skip for now',  value: 'skip' },
      ]
    };
  }
  // Default
  return {
    title: item,
    question: 'What should happen?',
    options: [
      { label: 'Resolved — mark done', value: 'resolved' },
      { label: 'Skip for now',         value: 'skip' },
    ]
  };
}

window.bannerOQRAnswer = async function(warnId, answer, btn) {
  if (answer === 'skip') { btn.closest('[style*=z-index]').remove(); return; }

  btn.textContent = 'Saving…'; btn.disabled = true;
  const sb = window.supabaseClient;
  if (!sb) return;

  await sb.from('invoice_warnings').update({
    status: 'resolved',
    resolution: answer,
    resolved_by: window.user?.name || 'Admin',
    resolved_at: new Date().toISOString(),
  }).eq('id', warnId);

  btn.closest('[style*=z-index]').remove();

  // Rimuovi la riga dal banner e ricarica
  if (typeof showScToast === 'function') showScToast('✓ Warning resolved');
  loadWarningsBanner();
};

window.warnBannerViewAll = function(severity) {
  // Apri Vendor Documents Review come shortcut
  if (typeof openVendorDocumentsReview === 'function') openVendorDocumentsReview();
};

// Esponi per init.js
window.loadWarningsBanner = loadWarningsBanner;
