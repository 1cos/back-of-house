// ── VENDOR DOCUMENTS REVIEW ───────────────────────────────────
// Admin-only. Shows all vendor_documents with status='pending'.
// Each warning becomes a Question (One Question Rule).
// No delete. No archive. No inventory integration.
//
// Warning codes (OQR = One Question Rule):
//   OQR-001  Credit memo missing original order → direct text input
//   OQR-002  Substitution: did you accept it?
//   OQR-006  Count-based pack: is count correct?
//   OQR-007  Qty mismatch (3 cases: unexpected / short / over)
//   OQR-008  Pack not parseable → enter weight manually (blocking)
//   PARSE_ERROR / UNKNOWN_VENDOR / NO_PARSER → red error card (info only)

window.openVendorDocumentsReview = function() {
  if (!isAdmin()) return;

  const modal = document.createElement('div');
  modal.id = 'vdrModal';
  modal.className = 'fixed inset-0 z-[65] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;">
      <button onclick="this.closest('#vdrModal').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:600;color:#1e293b;">📋 Vendor Documents</div>
        <div style="font-size:11px;color:#94a3b8;">Pending review</div>
      </div>
      <button onclick="vdrLoad()" style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">↻ Refresh</button>
    </div>
    <div style="padding:16px;max-width:640px;width:100%;margin:0 auto;">
      <div id="vdrList">
        <div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  vdrLoad();
};

// ── Load pending documents ────────────────────────────────────
window.vdrLoad = async function() {
  const list = document.getElementById('vdrList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const { data, error } = await sb
      .from('vendor_documents')
      .select('id,vendor,document_type,document_number,document_date,delivery_date,parsed_json,warnings,status,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:48px 0;">
          <div style="font-size:32px;margin-bottom:10px;">✅</div>
          <div style="font-size:14px;font-weight:500;color:#1e293b;margin-bottom:4px;">All clear</div>
          <div style="font-size:12px;color:#94a3b8;">No pending documents</div>
        </div>`;
      return;
    }

    list.innerHTML = data.map(doc => vdrCardHTML(doc)).join('');
    // Register all questions in the global map
    for (const doc of data) vdrRegisterQuestions(doc);

  } catch(e) {
    list.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#991b1b;font-size:13px;">✗ ${e.message}</div>`;
  }
};

// ── Document card (collapsed) ─────────────────────────────────
function vdrCardHTML(doc) {
  const pj        = doc.parsed_json || {};
  const docLabel  = vdrDocTypeLabel(doc.document_type);
  const docNum    = doc.document_number || '—';
  const dateStr   = vdrFmtDate(doc.document_date);
  const total     = pj.total != null ? '$' + Math.abs(pj.total).toFixed(2) : '—';
  const allQ      = vdrBuildQuestions(doc);
  const qCount    = allQ.length;
  const itemCount = (pj.items || []).length;

  // Check for parse errors (blocking, shown differently)
  const hasParseError = vdrHasParseError(doc);

  const typeColor = { invoice:'#3B82F6', order_confirmation:'#8b5cf6', credit_memo:'#ef4444' }[doc.document_type] || '#64748b';

  let qBadge;
  if (hasParseError) {
    qBadge = `<span style="background:rgba(239,68,68,0.1);color:#991b1b;border:1px solid rgba(239,68,68,0.3);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;">🔴 Parse error</span>`;
  } else if (qCount > 0) {
    qBadge = `<span style="background:rgba(245,158,11,0.1);color:#92400e;border:1px solid rgba(245,158,11,0.3);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;">❓ ${qCount} question${qCount > 1 ? 's' : ''}</span>`;
  } else {
    qBadge = `<span style="background:rgba(16,185,129,0.08);color:#065f46;border:1px solid rgba(16,185,129,0.2);padding:2px 8px;border-radius:20px;font-size:11px;">✓ Ready to approve</span>`;
  }

  // Border color: red for parse errors, amber for questions, normal otherwise
  const cardBorder = hasParseError ? '1px solid rgba(239,68,68,0.35)' : '1px solid #f1f5f9';

  return `
    <div id="vdrCard-${doc.id}" style="border:${cardBorder};border-radius:14px;margin-bottom:10px;overflow:hidden;">
      <div style="padding:12px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="vdrToggle('${doc.id}')">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-size:11px;font-weight:700;color:${typeColor};background:${typeColor}12;padding:2px 8px;border-radius:6px;white-space:nowrap;">${docLabel}</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">#${docNum}</span>
            ${qBadge}
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <span style="font-size:11px;color:#64748b;">${doc.vendor || '—'}</span>
            <span style="font-size:11px;color:#94a3b8;">${dateStr}</span>
            <span style="font-size:11px;color:#94a3b8;">${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
            <span style="font-size:11px;color:#1e293b;font-weight:500;">${total}</span>
          </div>
        </div>
        <span id="vdrChevron-${doc.id}" style="color:#94a3b8;font-size:18px;flex-shrink:0;transition:transform .2s;">›</span>
      </div>
      <div id="vdrDetail-${doc.id}" style="display:none;border-top:1px solid #f8fafc;">
        ${vdrDetailHTML(doc)}
      </div>
    </div>`;
}

window.vdrToggle = function(id) {
  const detail  = document.getElementById('vdrDetail-' + id);
  const chevron = document.getElementById('vdrChevron-' + id);
  if (!detail) return;
  const open = detail.style.display === 'none';
  detail.style.display = open ? 'block' : 'none';
  chevron.style.transform = open ? 'rotate(90deg)' : '';
};

// ── Check if doc has a blocking parse error ───────────────────
function vdrHasParseError(doc) {
  const docWarn = Array.isArray(doc.warnings) ? doc.warnings : [];
  const errorCodes = ['PARSE_ERROR','UNKNOWN_VENDOR','UNKNOWN_DOC_TYPE','NO_PARSER','PARSER_ERROR'];
  return docWarn.some(w => errorCodes.includes(w.code));
}

// ── Detail panel ──────────────────────────────────────────────
function vdrDetailHTML(doc) {
  const pj    = doc.parsed_json || {};
  const items = pj.items || [];
  const isInvoice = doc.document_type === 'invoice';
  const isCredit  = doc.document_type === 'credit_memo';
  const questions = vdrBuildQuestions(doc);

  // ── Header ──
  const headerFields = [
    ['Vendor',        doc.vendor],
    ['Type',          vdrDocTypeLabel(doc.document_type)],
    ['Document #',    doc.document_number],
    ['Doc Date',      vdrFmtDate(doc.document_date)],
    ['Delivery',      vdrFmtDate(doc.delivery_date)],
    ['Subtotal',      pj.subtotal != null ? '$' + pj.subtotal.toFixed(2) : null],
    ['Tax',           pj.tax      != null ? '$' + pj.tax.toFixed(2)      : null],
    ['Total',         pj.total    != null ? '$' + Math.abs(pj.total).toFixed(2) : null],
  ].filter(([, v]) => v != null && v !== '');

  const headerHTML = `
    <div style="padding:12px 14px;background:#f8fafc;display:flex;flex-wrap:wrap;gap:6px 20px;">
      ${headerFields.map(([label, val]) => `
        <div>
          <div style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
          <div style="font-size:12px;color:#1e293b;font-weight:500;">${val}</div>
        </div>`).join('')}
    </div>`;

  // ── Questions (OQR) ──
  const questionsHTML = questions.length ? `
    <div style="padding:12px 14px 0;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Review Required</div>
      ${questions.map((q, idx) => vdrQuestionHTML(doc.id, q, idx)).join('')}
    </div>` : '';

  // ── Items table ──
  const itemsHTML = items.length ? `
    <div style="padding:10px 14px 0;">
      <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Parsed Items (${items.length})</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="border-bottom:2px solid #f1f5f9;text-align:left;">
              <th style="padding:5px 7px;color:#94a3b8;font-weight:500;white-space:nowrap;">SKU</th>
              <th style="padding:5px 7px;color:#94a3b8;font-weight:500;">Description</th>
              <th style="padding:5px 7px;color:#94a3b8;font-weight:500;white-space:nowrap;">Pack</th>
              ${isInvoice ? '<th style="padding:5px 7px;color:#94a3b8;font-weight:500;text-align:center;white-space:nowrap;">Ord/Shp</th>' : ''}
              ${!isInvoice ? '<th style="padding:5px 7px;color:#94a3b8;font-weight:500;text-align:right;">Qty</th>' : ''}
              <th style="padding:5px 7px;color:#94a3b8;font-weight:500;text-align:right;">Price</th>
              <th style="padding:5px 7px;color:#94a3b8;font-weight:500;text-align:right;">Ext.</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
              const isSubst  = item.is_substitution;
              const hasW008  = (item.warnings || []).some(w => w.code === 'OQR-008');
              const mismatch = isInvoice && item.qty_ordered !== item.qty_received && item.qty_received != null;
              const rowBg    = isSubst ? 'rgba(245,158,11,0.05)' : hasW008 ? 'rgba(239,68,68,0.04)' : mismatch ? 'rgba(239,68,68,0.04)' : '';
              const qty      = isInvoice ? `${item.qty_ordered}/${item.qty_received}`
                             : isCredit  ? (item.qty_credited || '-')
                                         : (item.qty_ordered  || '-');
              const amt      = item.amount != null
                ? (item.amount < 0 ? `-$${Math.abs(item.amount).toFixed(2)}` : `$${item.amount.toFixed(2)}`) : '-';
              const rc       = isCredit && item.return_code
                ? ` <span style="color:#ef4444;font-size:10px;">[${item.return_code}]</span>` : '';
              const packWarning = hasW008
                ? ` <span style="font-size:9px;color:#ef4444;font-weight:700;margin-left:2px;">⚠</span>` : '';
              return `<tr style="border-bottom:0.5px solid #f8fafc;background:${rowBg}">
                <td style="padding:4px 7px;color:#94a3b8;white-space:nowrap;">${item.vendor_sku || '-'}</td>
                <td style="padding:4px 7px;color:#1e293b;max-width:160px;">
                  ${isSubst ? '<span style="font-size:9px;color:#f59e0b;font-weight:700;margin-right:3px;">SUB</span>' : ''}
                  ${item.description || item.raw_description || '-'}${rc}
                </td>
                <td style="padding:4px 7px;color:#64748b;white-space:nowrap;">${item.pack_description || '-'}${packWarning}</td>
                <td style="padding:4px 7px;text-align:${isInvoice ? 'center' : 'right'};color:${mismatch ? '#ef4444' : '#1e293b'};">${qty}</td>
                <td style="padding:4px 7px;text-align:right;color:#1e293b;">${item.unit_price != null ? '$' + item.unit_price.toFixed(2) : '-'}</td>
                <td style="padding:4px 7px;text-align:right;color:${item.amount < 0 ? '#ef4444' : '#1e293b'};font-weight:500;">${amt}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  // ── Approve ──
  const approveHTML = `
    <div style="padding:12px 14px 14px;">
      <div id="vdrActionStatus-${doc.id}" style="display:none;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:8px;"></div>
      <button onclick="vdrApprove('${doc.id}',this)"
        style="width:100%;height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">
        ✓ Approve Document
      </button>
    </div>`;

  const parseErrorHTML = vdrHasParseError(doc) ? vdrParseErrorBannerHTML(doc) : '';
  return headerHTML + parseErrorHTML + questionsHTML + itemsHTML + approveHTML;
}

// ── Build question objects from a document ────────────────────
// Each question: { id, code, item, title, emoji, question, meaning, warnRef }
function vdrBuildQuestions(doc) {
  const pj      = doc.parsed_json || {};
  const docWarn = Array.isArray(doc.warnings) ? doc.warnings : [];
  const questions = [];
  let idx = 0;

  // Document-level warnings
  for (const w of docWarn) {
    // Skip item-level warnings already stored in parsed_json.items[].warnings.
    // They include an item reference and will be rendered with full item context below.
    if (w.item) continue;

    const q = vdrWarningToQuestion(w, null, doc.id, idx++);
    if (q) questions.push(q);
  }

  // Item-level warnings
  for (const item of (pj.items || [])) {
    for (const w of (item.warnings || [])) {
      const q = vdrWarningToQuestion(w, item, doc.id, idx++);
      if (q) questions.push(q);
    }
  }

  return questions;
}

// ── Convert a warning into a structured OQR question ─────────
function vdrWarningToQuestion(w, item, docId, idx) {
  const qid = `${docId}-${idx}`;
  const name = item ? (item.description || item.raw_description || 'Item') : null;

  // ── OQR-006: Count-based pack ──────────────────────────────
  if (w.code === 'OQR-006') {
    const pack = item ? (item.pack_description || '') : '';
    const m = pack.match(/^(\d+)\s*([A-Z]+)/i);
    const qty  = m ? m[1] : '?';
    const unit = m ? m[2].toUpperCase() : 'CT';
    const meaning = `1 case = ${qty} ${name ? name.toLowerCase() + (parseInt(qty) > 1 ? 's' : '') : unit.toLowerCase() + (parseInt(qty) > 1 ? 's' : '')}`;
    return {
      qid, code: 'OQR-006', item, docId, idx,
      emoji: vdrItemEmoji(name),
      title: name || 'Item',
      detected: pack,
      question: `Is this pack correct?`,
      meaning,
      yesLabel: 'Yes, correct',
      noLabel: 'No, fix it',
      noNextQuestion: `How many ${name ? name.toLowerCase() + 's' : 'units'} are in one case?`,
      noPlaceholder: `e.g. 24`,
      noUnit: unit,
      warnRef: w,
    };
  }

  // ── OQR-002: Substitution ──────────────────────────────────
  if (w.code === 'OQR-002') {
    const subName  = name || 'this item';
    const prevItem = item && item.substituted_sku ? `SKU ${item.substituted_sku}` : 'the original item';
    return {
      qid, code: 'OQR-002', item, docId, idx,
      emoji: '🔄',
      title: name || 'Substitution',
      detected: item ? `Ordered 0 · Received ${item.qty_received}` : w.message,
      question: `Was this substitution accepted?`,
      meaning: `${subName} replaced ${prevItem}`,
      yesLabel: 'Yes, accepted',
      noLabel: 'No, reject it',
      noNextQuestion: `What should happen with this item?`,
      noPlaceholder: `e.g. Return to vendor, remove from invoice`,
      noUnit: null,
      warnRef: w,
    };
  }

  // ── OQR-007: Qty mismatch — three distinct cases ──────────
  if (w.code === 'OQR-007') {
    const ord = item ? (item.qty_ordered  ?? '?') : '?';
    const shp = item ? (item.qty_received ?? '?') : '?';
    const ordN = parseFloat(ord);
    const shpN = parseFloat(shp);

    // Case A: ordered 0, received > 0 → unexpected / substitution
    if (!isNaN(ordN) && !isNaN(shpN) && ordN === 0 && shpN > 0) {
      return {
        qid, code: 'OQR-007', item, docId, idx,
        emoji: '⚠️',
        title: name || 'Item',
        detected: `Ordered ${ord} · Received ${shp}`,
        question: `This item was received but was not expected.`,
        meaning: `Not on original order — received ${shp}`,
        yesLabel: 'Substitution',
        noLabel: 'More options',
        noNextQuestion: `What should happen with this item?`,
        noPlaceholder: `e.g. Extra item received, vendor mistake, accept it`,
        noUnit: null,
        warnRef: w,
      };
    }

    // Case B: ordered > received → short shipment
    if (!isNaN(ordN) && !isNaN(shpN) && ordN > shpN) {
      return {
        qid, code: 'OQR-007', item, docId, idx,
        emoji: '📦',
        title: name || 'Item',
        detected: `Ordered ${ord} · Received ${shp}`,
        question: `What happened with the missing quantity?`,
        meaning: `Expected ${ord}, got ${shp} — short by ${ordN - shpN}`,
        yesLabel: 'Short ship — OK',
        noLabel: 'Back order / other',
        noNextQuestion: `What is the reason for the short shipment?`,
        noPlaceholder: `e.g. Back ordered, refused delivery`,
        noUnit: null,
        warnRef: w,
      };
    }

    // Case C: ordered < received → over-delivery
    return {
      qid, code: 'OQR-007', item, docId, idx,
      emoji: '📦',
      title: name || 'Item',
      detected: `Ordered ${ord} · Received ${shp}`,
      question: `More items were received than ordered.`,
      meaning: `Ordered ${ord}, received ${shp}`,
      yesLabel: 'Accept extra',
      noLabel: 'Return excess',
      noNextQuestion: `What should happen with the extra quantity?`,
      noPlaceholder: `e.g. Return to vendor, keep for prep`,
      noUnit: null,
      warnRef: w,
    };
  }

  // ── OQR-008: Pack not parseable — enter weight manually ────
  // Blocking: without weight, price_per_100g cannot be calculated.
  // UI: show pack_description as detected, ask total case weight.
  if (w.code === 'OQR-008') {
    const pack = item ? (item.pack_description || w.message || '') : (w.message || '');
    // Try to extract a unit hint from the pack string (lb, oz, kg…)
    const unitHint = /\d\s*(oz|lb|kg|g)\b/i.test(pack) ? pack.match(/\d\s*(oz|lb|kg|g)\b/i)[1].toLowerCase() : 'lb';
    return {
      qid, code: 'OQR-008', item, docId, idx,
      emoji: '⚖️',
      title: name || 'Item',
      detected: pack,
      question: `Pack format not recognised — enter total case weight:`,
      meaning: `Without weight, cost-per-100g cannot be calculated`,
      yesLabel: null,
      noLabel: null,
      noNextQuestion: null,
      noPlaceholder: null,
      noUnit: null,
      warnRef: w,
      // OQR-008 uses a numeric weight input, not yes/no
      weightInput: true,
      weightUnit: unitHint,
    };
  }

  // ── DOC-TOTAL-001: Quadratura — lines don't reconcile with total ──
  // Blocking (red). Data Priority P1: the document total is truth.
  // If the parsed lines don't add up, lines are missing or misread.
  if (w.code === 'DOC-TOTAL-001') {
    const sum  = w.sum_of_lines   != null ? '$' + Number(w.sum_of_lines).toFixed(2)   : '?';
    const decl = w.declared_total != null ? '$' + Number(w.declared_total).toFixed(2) : '?';
    const pct  = (w.sum_of_lines != null && w.declared_total)
      ? Math.round(Math.abs(w.sum_of_lines / w.declared_total) * 100) + '%' : '?';
    return {
      qid, code: 'DOC-TOTAL-001', item: null, docId, idx,
      emoji: '🧮',
      title: 'Totals don\'t add up',
      detected: `Lines ${sum} · Document total ${decl} (${pct} read)`,
      question: `The lines don't add up to the document total. Lines may be missing.`,
      meaning: `Approving as-is would put incomplete data into food cost`,
      yesLabel: 'Accept as-is',
      noLabel: 'Needs re-scan',
      noNextQuestion: `What's wrong with this document?`,
      noPlaceholder: `e.g. Bad scan, lines cut off, will re-upload`,
      noUnit: null,
      warnRef: w,
      blocking: true,
    };
  }

  // ── OQR-001: Credit missing original order ─────────────────
  if (w.code === 'OQR-001') {
    return {
      qid, code: 'OQR-001', item: null, docId, idx,
      emoji: '🧾',
      title: 'Credit Reference',
      detected: 'No original order number found',
      question: `What is the original order number for this credit?`,
      meaning: 'Credit memos must reference the original invoice',
      yesLabel: null,
      noLabel: null,
      noNextQuestion: null,
      noPlaceholder: `Enter order number`,
      noUnit: null,
      warnRef: w,
      directInput: true,
    };
  }

  // ── Parse/technical errors — red card, no action needed ────
  // These are shown as prominent red banners, not amber questions.
  // They do NOT appear in the question queue — handled by vdrHasParseError().
  if (['PARSE_ERROR','UNKNOWN_VENDOR','UNKNOWN_DOC_TYPE','NO_PARSER','PARSER_ERROR'].includes(w.code)) {
    return null; // rendered separately as red error banner
  }

  return null; // unknown code — skip
}

// ── Render a single OQR question card ────────────────────────
function vdrQuestionHTML(docId, q, idx) {
  const cardId = `vdrQ-${q.qid}`;

  // ── OQR-008: Weight input card (red border, blocking) ──────
  if (q.weightInput) {
    return `
      <div id="${cardId}" style="background:#fff5f5;border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:14px;margin-bottom:8px;">
        <div style="display:flex;gap:10px;align-items:start;margin-bottom:10px;">
          <span style="font-size:22px;flex-shrink:0;">${q.emoji}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:#1e293b;">${q.title}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:1px;">Pack: ${q.detected}</div>
            <div style="font-size:11px;color:#ef4444;margin-top:2px;font-weight:500;">${q.meaning}</div>
          </div>
        </div>
        <div style="font-size:12px;color:#475569;margin-bottom:8px;font-weight:500;">${q.question}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="vdrW008-${q.qid}" type="number" min="0" step="0.1"
            placeholder="e.g. 4.5"
            style="width:80px;height:36px;padding:0 10px;border:1px solid #fca5a5;border-radius:8px;font-size:13px;outline:none;text-align:center;" />
          <select id="vdrW008unit-${q.qid}"
            style="height:36px;padding:0 8px;border:1px solid #fca5a5;border-radius:8px;font-size:12px;outline:none;background:white;">
            <option value="lb" ${q.weightUnit==='lb'?'selected':''}>lb</option>
            <option value="oz" ${q.weightUnit==='oz'?'selected':''}>oz</option>
            <option value="kg" ${q.weightUnit==='kg'?'selected':''}>kg</option>
            <option value="g"  ${q.weightUnit==='g' ?'selected':''}>g</option>
          </select>
          <button onclick="vdrAnswer008('${docId}','${q.qid}',${idx})"
            style="height:36px;padding:0 14px;border-radius:8px;background:#ef4444;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;">
            Save weight
          </button>
        </div>
      </div>`;
  }

  // ── OQR-001: direct text input (no yes/no) ─────────────────
  if (q.directInput) {
    return `
      <div id="${cardId}" style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:14px;margin-bottom:8px;">
        <div style="display:flex;gap:10px;align-items:start;margin-bottom:10px;">
          <span style="font-size:22px;flex-shrink:0;">${q.emoji}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:#1e293b;">${q.title}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:1px;">${q.detected}</div>
          </div>
        </div>
        <div style="font-size:12px;color:#475569;margin-bottom:8px;font-weight:500;">${q.question}</div>
        <div style="display:flex;gap:8px;">
          <input id="vdrInput-${q.qid}" type="text" placeholder="${q.noPlaceholder}"
            style="flex:1;height:36px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;" />
          <button onclick="vdrAnswerDirect('${docId}','${q.qid}',${idx})"
            style="height:36px;padding:0 14px;border-radius:8px;background:#1e293b;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;">
            Save
          </button>
        </div>
      </div>`;
  }

  // ── Standard OQR yes/no question ───────────────────────────
  // Blocking questions render red; decision/insight questions amber.
  const cardBg     = q.blocking ? '#fff5f5'                  : '#fefce8';
  const cardBorder = q.blocking ? 'rgba(239,68,68,0.3)'      : 'rgba(234,179,8,0.3)';
  return `
    <div id="${cardId}" style="background:${cardBg};border:1px solid ${cardBorder};border-radius:12px;padding:14px;margin-bottom:8px;">
      <div style="display:flex;gap:10px;align-items:start;margin-bottom:10px;">
        <span style="font-size:22px;flex-shrink:0;">${q.emoji}</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:#1e293b;">${q.title}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:1px;">Detected: ${q.detected}</div>
          ${q.meaning ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Meaning: ${q.meaning}</div>` : ''}
        </div>
      </div>
      <div style="font-size:12px;color:#475569;font-weight:500;margin-bottom:10px;">${q.question}</div>
      <div id="vdrQButtons-${q.qid}" style="display:flex;gap:8px;">
        <button onclick="vdrAnswerYes('${docId}','${q.qid}',${idx})"
          style="flex:1;height:38px;border-radius:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:12px;font-weight:500;cursor:pointer;">
          ${q.yesLabel}
        </button>
        <button onclick="vdrAnswerNo('${docId}','${q.qid}',${idx})"
          style="flex:1;height:38px;border-radius:10px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-size:12px;font-weight:500;cursor:pointer;">
          ${q.noLabel}
        </button>
      </div>
      <!-- Follow-up input, hidden until No -->
      <div id="vdrQFollowup-${q.qid}" style="display:none;margin-top:10px;">
        <div style="font-size:12px;color:#475569;margin-bottom:6px;font-weight:500;" id="vdrQFollowupLabel-${q.qid}"></div>
        <div style="display:flex;gap:8px;">
          <input id="vdrQFollowupInput-${q.qid}" type="text"
            style="flex:1;height:36px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;" />
          <button onclick="vdrAnswerFollowup('${docId}','${q.qid}',${idx})"
            style="height:36px;padding:0 14px;border-radius:8px;background:#1e293b;color:white;font-size:12px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;">
            Save
          </button>
        </div>
      </div>
    </div>`;
}

// ── Render parse error banner (red, no action) ────────────────
// Called from vdrDetailHTML if vdrHasParseError is true.
// Shown above questions section.
function vdrParseErrorBannerHTML(doc) {
  const docWarn = Array.isArray(doc.warnings) ? doc.warnings : [];
  const errorCodes = ['PARSE_ERROR','UNKNOWN_VENDOR','UNKNOWN_DOC_TYPE','NO_PARSER','PARSER_ERROR'];
  const errors = docWarn.filter(w => errorCodes.includes(w.code));
  if (!errors.length) return '';
  return `
    <div style="margin:12px 14px 0;padding:12px 14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:12px;">
      <div style="font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">🔴 Parse Error — cannot import</div>
      ${errors.map(w => `
        <div style="font-size:12px;color:#7f1d1d;margin-bottom:3px;">
          <span style="font-weight:600;font-family:monospace;font-size:11px;background:rgba(239,68,68,0.1);padding:1px 5px;border-radius:4px;">${w.code}</span>
          &nbsp;${w.message || ''}
        </div>`).join('')}
      <div style="font-size:11px;color:#94a3b8;margin-top:8px;">Re-upload the document or process manually.</div>
    </div>`;
}

// Patch vdrDetailHTML to include parse error banner
const _origVdrDetailHTML = vdrDetailHTML;
// Note: overwrite directly since it's a function declaration (hoisted)
// We inject the parse error banner inline by redefining:
{
  const _inner = vdrDetailHTML;
  // vdrDetailHTML is already defined above — we patch it to prepend the banner
  // by redefining the function in the same scope isn't possible with declarations,
  // so we gate the banner inside vdrDetailHTML itself.
  // (Banner injection is already handled inside vdrDetailHTML via questionsHTML placement)
}

// ── Answer: OQR-008 weight input ─────────────────────────────
window.vdrAnswer008 = async function(docId, qid, idx) {
  const weightEl = document.getElementById('vdrW008-' + qid);
  const unitEl   = document.getElementById('vdrW008unit-' + qid);
  const weight   = weightEl ? parseFloat(weightEl.value) : NaN;
  const unit     = unitEl ? unitEl.value : 'lb';

  if (isNaN(weight) || weight <= 0) {
    if (weightEl) { weightEl.style.borderColor = '#ef4444'; weightEl.focus(); }
    return;
  }

  // Convert to grams for storage
  const toG = { lb: 453.592, oz: 28.3495, kg: 1000, g: 1 };
  const totalGrams = weight * (toG[unit] || 453.592);

  await vdrResolveQuestion(docId, qid, idx, {
    answered: true,
    answer: `${weight} ${unit}`,
    weight_g: totalGrams,
    // Store on item so price_per_100g can be recalculated downstream
    corrected_weight_g: totalGrams,
  });
};

// ── Answer: Yes ───────────────────────────────────────────────
window.vdrAnswerYes = async function(docId, qid, idx) {
  await vdrResolveQuestion(docId, qid, idx, { answered: true, answer: 'yes' });
};

// ── Answer: No → show follow-up ──────────────────────────────
window.vdrAnswerNo = function(docId, qid, idx) {
  const buttons  = document.getElementById('vdrQButtons-' + qid);
  const followup = document.getElementById('vdrQFollowup-' + qid);
  const label    = document.getElementById('vdrQFollowupLabel-' + qid);
  const input    = document.getElementById('vdrQFollowupInput-' + qid);

  if (!followup) return;

  const q = window._vdrQuestions && window._vdrQuestions[qid];
  if (label && q) label.textContent = q.noNextQuestion || 'Please describe:';
  if (input && q) input.placeholder = q.noPlaceholder || '';

  if (buttons) buttons.style.display = 'none';
  followup.style.display = 'block';
  if (input) input.focus();
};

// ── Answer: Follow-up text submitted ─────────────────────────
window.vdrAnswerFollowup = async function(docId, qid, idx) {
  const input = document.getElementById('vdrQFollowupInput-' + qid);
  const value = input ? input.value.trim() : '';
  if (!value) { input && input.focus(); return; }
  await vdrResolveQuestion(docId, qid, idx, { answered: true, answer: 'no', correction: value });
};

// ── Answer: Direct input submitted ───────────────────────────
window.vdrAnswerDirect = async function(docId, qid, idx) {
  const input = document.getElementById('vdrInput-' + qid);
  const value = input ? input.value.trim() : '';
  if (!value) { input && input.focus(); return; }
  await vdrResolveQuestion(docId, qid, idx, { answered: true, answer: value });
};

// ── Resolve a question: remove warning from DB, fade card ─────
async function vdrResolveQuestion(docId, qid, idx, resolution) {
  const card = document.getElementById('vdrQ-' + qid);
  if (card) {
    card.style.transition = 'opacity .25s';
    card.style.opacity = '0.4';
    card.style.pointerEvents = 'none';
  }

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const { data, error: fetchErr } = await sb
      .from('vendor_documents')
      .select('warnings, parsed_json')
      .eq('id', docId)
      .single();

    if (fetchErr) throw new Error(fetchErr.message);

    const q = window._vdrQuestions && window._vdrQuestions[qid];
    const warnCode = q ? q.code : null;

    // Remove matching warning from doc-level warnings
    const currentWarn = Array.isArray(data.warnings) ? data.warnings : [];
    let removed = false;
    const updatedWarn = currentWarn.filter(w => {
      if (!removed && w.code === warnCode) { removed = true; return false; }
      return true;
    });

    // If item-level warning, also remove from parsed_json.items[n].warnings
    // For OQR-008, also store the corrected weight on the item
    let updatedPj = data.parsed_json;
    if (q && q.item && updatedPj && Array.isArray(updatedPj.items)) {
      updatedPj = JSON.parse(JSON.stringify(updatedPj)); // deep clone
      for (const it of updatedPj.items) {
        if ((it.description || it.raw_description) === (q.item.description || q.item.raw_description)) {
          let itemRemoved = false;
          it.warnings = (it.warnings || []).filter(w => {
            if (!itemRemoved && w.code === warnCode) { itemRemoved = true; return false; }
            return true;
          });
          // OQR-008: store corrected weight so price_per_100g can be computed
          if (warnCode === 'OQR-008' && resolution.corrected_weight_g) {
            it.corrected_weight_g = resolution.corrected_weight_g;
            it.weight_g = resolution.corrected_weight_g;
            // Recalculate price_per_100g if unit_price is available
            if (it.unit_price != null && resolution.corrected_weight_g > 0) {
              it.price_per_100g = (it.unit_price / resolution.corrected_weight_g) * 100;
            }
          }
          break;
        }
      }
    }

    const { error: updateErr } = await sb
      .from('vendor_documents')
      .update({
        warnings:    updatedWarn,
        parsed_json: updatedPj,
        updated_at:  new Date().toISOString()
      })
      .eq('id', docId);

    if (updateErr) throw new Error(updateErr.message);

    // Also mark resolved in invoice_warnings table (analytics history — BIOS-009)
    if (warnCode) {
      const { data: iw } = await sb
        .from('invoice_warnings')
        .select('id')
        .eq('document_id', docId)
        .eq('code', warnCode)
        .eq('status', 'open')
        .limit(1);

      if (iw && iw.length > 0) {
        await sb
          .from('invoice_warnings')
          .update({
            status:      'resolved',
            resolution:  JSON.stringify(resolution),
            resolved_by: 'admin',
            resolved_at: new Date().toISOString(),
          })
          .eq('id', iw[0].id);
      }
    }

    // Fade out and remove question card
    if (card) {
      card.style.opacity = '0';
      setTimeout(() => {
        card.remove();
        vdrRefreshBadge(docId);
      }, 250);
    }

  } catch(e) {
    if (card) { card.style.opacity = '1'; card.style.pointerEvents = ''; }
    showScToast('Error: ' + e.message);
  }
}

// ── Refresh the question count badge on the card header ───────
function vdrRefreshBadge(docId) {
  const detail = document.getElementById('vdrDetail-' + docId);
  if (!detail) return;
  const remaining = detail.querySelectorAll('[id^="vdrQ-"]').length;

  const headerRow = document.querySelector(`#vdrCard-${docId} > div:first-child > div > div:first-child`);
  if (!headerRow) return;
  const spans = headerRow.querySelectorAll('span');
  const badge = spans[spans.length - 1];
  if (!badge) return;
  if (remaining > 0) {
    badge.style.background = 'rgba(245,158,11,0.1)';
    badge.style.color = '#92400e';
    badge.style.border = '1px solid rgba(245,158,11,0.3)';
    badge.textContent = `❓ ${remaining} question${remaining > 1 ? 's' : ''}`;
  } else {
    badge.style.background = 'rgba(16,185,129,0.08)';
    badge.style.color = '#065f46';
    badge.style.border = '1px solid rgba(16,185,129,0.2)';
    badge.textContent = '✓ Ready to approve';
  }
}

// ── Approve document ──────────────────────────────────────────
window.vdrApprove = async function(docId, btn) {
  const statusEl = document.getElementById('vdrActionStatus-' + docId);
  btn.disabled = true;
  btn.textContent = '⏳ Approving…';
  btn.style.background = '#94a3b8';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    const { error } = await sb
      .from('vendor_documents')
      .update({ status: 'imported', updated_at: new Date().toISOString() })
      .eq('id', docId);

    if (error) throw new Error(error.message);

    const card = document.getElementById('vdrCard-' + docId);
    if (card) {
      card.style.transition = 'opacity .3s';
      card.style.opacity = '0';
      setTimeout(() => {
        card.remove();
        const list = document.getElementById('vdrList');
        if (list && list.querySelectorAll('[id^="vdrCard-"]').length === 0) vdrLoad();
      }, 300);
    }
  } catch(e) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239,68,68,0.06)';
      statusEl.style.border = '1px solid rgba(239,68,68,0.25)';
      statusEl.style.color = '#991b1b';
      statusEl.textContent = '✗ ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = '✓ Approve Document';
    btn.style.background = '#1e293b';
  }
};

// ── Store question map when detail panel is rendered ─────────
const _vdrQMap = {};
window._vdrQuestions = _vdrQMap;

// Register questions for a doc into the global map (called after render)
function vdrRegisterQuestions(doc) {
  const qs = vdrBuildQuestions(doc);
  for (const q of qs) {
    _vdrQMap[q.qid] = q;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function vdrDocTypeLabel(t) {
  return { invoice: 'Invoice', order_confirmation: 'Order Conf.', credit_memo: 'Credit Memo' }[t] || (t || 'Unknown');
}

function vdrFmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function vdrItemEmoji(name) {
  if (!name) return '📦';
  const n = name.toUpperCase();
  if (/AVOCADO/.test(n))    return '🥑';
  if (/LEMON/.test(n))      return '🍋';
  if (/LIME/.test(n))       return '🍋';
  if (/TOMATO/.test(n))     return '🍅';
  if (/LETTUCE|ROMAINE|SPINACH|ARUGULA/.test(n)) return '🥬';
  if (/WATERMELON/.test(n)) return '🍉';
  if (/STRAWBERR/.test(n))  return '🍓';
  if (/MUSHROOM/.test(n))   return '🍄';
  if (/FLOWER|MARIGOLD/.test(n)) return '🌸';
  if (/EGG/.test(n))        return '🥚';
  if (/CHEESE|CHZ/.test(n)) return '🧀';
  if (/BEEF|RIB|STEAK/.test(n)) return '🥩';
  if (/ASPARAGUS/.test(n))  return '🥦';
  if (/BRUSSEL/.test(n))    return '🥦';
  if (/PEPPER/.test(n))     return '🫑';
  if (/ONION/.test(n))      return '🧅';
  if (/GARLIC/.test(n))     return '🧄';
  if (/CARROT/.test(n))     return '🥕';
  if (/POTATO/.test(n))     return '🥔';
  if (/FISH|SALMON|TUNA|SEA/.test(n)) return '🐟';
  if (/SHRIMP|PRAWN/.test(n)) return '🍤';
  if (/HERB|BASIL|ROSEMARY|SAGE|TARRAGON|PARSLEY/.test(n)) return '🌿';
  if (/RASPBERRY|MELON|CANTALOUPE/.test(n)) return '🍈';
  return '📦';
}
