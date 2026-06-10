// ── VENDOR DOCUMENTS REVIEW ───────────────────────────────────
// Admin-only. Shows all vendor_documents with status='pending'.
// Each warning becomes a Question (One Question Rule).
// No delete. No archive. No inventory integration.

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

  const typeColor = { invoice:'#3B82F6', order_confirmation:'#8b5cf6', credit_memo:'#ef4444' }[doc.document_type] || '#64748b';

  const qBadge = qCount > 0
    ? `<span style="background:rgba(245,158,11,0.1);color:#92400e;border:1px solid rgba(245,158,11,0.3);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;">❓ ${qCount} question${qCount > 1 ? 's' : ''}</span>`
    : `<span style="background:rgba(16,185,129,0.08);color:#065f46;border:1px solid rgba(16,185,129,0.2);padding:2px 8px;border-radius:20px;font-size:11px;">✓ Ready to approve</span>`;

  return `
    <div id="vdrCard-${doc.id}" style="border:1px solid #f1f5f9;border-radius:14px;margin-bottom:10px;overflow:hidden;">
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
              const mismatch = isInvoice && item.qty_ordered !== item.qty_received && item.qty_received != null;
              const rowBg    = isSubst ? 'rgba(245,158,11,0.05)' : mismatch ? 'rgba(239,68,68,0.04)' : '';
              const qty      = isInvoice ? `${item.qty_ordered}/${item.qty_received}`
                             : isCredit  ? (item.qty_credited || '-')
                                         : (item.qty_ordered  || '-');
              const amt      = item.amount != null
                ? (item.amount < 0 ? `-$${Math.abs(item.amount).toFixed(2)}` : `$${item.amount.toFixed(2)}`) : '-';
              const rc       = isCredit && item.return_code
                ? ` <span style="color:#ef4444;font-size:10px;">[${item.return_code}]</span>` : '';
              return `<tr style="border-bottom:0.5px solid #f8fafc;background:${rowBg}">
                <td style="padding:4px 7px;color:#94a3b8;white-space:nowrap;">${item.vendor_sku || '-'}</td>
                <td style="padding:4px 7px;color:#1e293b;max-width:160px;">
                  ${isSubst ? '<span style="font-size:9px;color:#f59e0b;font-weight:700;margin-right:3px;">SUB</span>' : ''}
                  ${item.description || item.raw_description || '-'}${rc}
                </td>
                <td style="padding:4px 7px;color:#64748b;white-space:nowrap;">${item.pack_description || '-'}</td>
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

  return headerHTML + questionsHTML + itemsHTML + approveHTML;
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
  // "I found a count-based pack. Is this correct?"
  if (w.code === 'OQR-006') {
    const pack = item ? (item.pack_description || '') : '';
    // parse qty and unit from pack description
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
  // "This item was substituted. Did you accept it?"
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

  // ── OQR-007: Qty mismatch ──────────────────────────────────
  // "Ordered X, received Y. What happened?"
  if (w.code === 'OQR-007') {
    const ord = item ? item.qty_ordered : '?';
    const shp = item ? item.qty_received : '?';
    return {
      qid, code: 'OQR-007', item, docId, idx,
      emoji: '📦',
      title: name || 'Item',
      detected: `Ordered ${ord} · Received ${shp}`,
      question: `What happened with the missing quantity?`,
      meaning: `Expected ${ord}, got ${shp}`,
      yesLabel: 'Short ship — OK',
      noLabel: 'Back order / other',
      noNextQuestion: `What is the reason for the difference?`,
      noPlaceholder: `e.g. Back ordered, refused delivery`,
      noUnit: null,
      warnRef: w,
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
      yesLabel: null,  // no yes/no — goes straight to text input
      noLabel: null,
      noNextQuestion: null,
      noPlaceholder: `Enter order number`,
      noUnit: null,
      warnRef: w,
      directInput: true,
    };
  }

  // Technical errors — show as read-only info, no question needed
  if (['PARSE_ERROR','UNKNOWN_VENDOR','UNKNOWN_DOC_TYPE','NO_PARSER','PARSER_ERROR'].includes(w.code)) {
    return {
      qid, code: w.code, item, docId, idx,
      emoji: '⚠️',
      title: w.code,
      detected: w.message,
      question: null,   // no actionable question
      warnRef: w,
      infoOnly: true,
    };
  }

  return null; // unknown code — skip
}

// ── Render a single OQR question card ────────────────────────
function vdrQuestionHTML(docId, q, idx) {
  const cardId = `vdrQ-${q.qid}`;

  // Info-only (parse errors etc.)
  if (q.infoOnly) {
    return `
      <div id="${cardId}" style="background:#fff8f0;border:1px solid rgba(245,158,11,0.25);border-radius:12px;padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;gap:8px;align-items:start;">
          <span style="font-size:18px;flex-shrink:0;">⚠️</span>
          <div>
            <div style="font-size:12px;font-weight:600;color:#92400e;margin-bottom:2px;">${q.title}</div>
            <div style="font-size:12px;color:#78350f;">${q.detected}</div>
          </div>
        </div>
      </div>`;
  }

  // OQR-001: direct text input (no yes/no)
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

  // Standard OQR yes/no question
  return `
    <div id="${cardId}" style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:14px;margin-bottom:8px;">
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

// ── Answer: Yes ───────────────────────────────────────────────
window.vdrAnswerYes = async function(docId, qid, idx) {
  // Resolve the warning — mark it answered in the DB, then visually resolve the card
  await vdrResolveQuestion(docId, qid, idx, { answered: true, answer: 'yes' });
};

// ── Answer: No → show follow-up ──────────────────────────────
window.vdrAnswerNo = function(docId, qid, idx) {
  const buttons  = document.getElementById('vdrQButtons-' + qid);
  const followup = document.getElementById('vdrQFollowup-' + qid);
  const label    = document.getElementById('vdrQFollowupLabel-' + qid);
  const input    = document.getElementById('vdrQFollowupInput-' + qid);

  if (!followup) return;

  // Get the question data from the stored map
  const q = window._vdrQuestions && window._vdrQuestions[qid];
  if (label && q) label.textContent = q.noNextQuestion || 'Please describe:';
  if (input && q) input.placeholder = q.noPlaceholder || '';

  // Hide Yes/No buttons, show follow-up
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

    // Fetch current document warnings
    const { data, error: fetchErr } = await sb
      .from('vendor_documents')
      .select('warnings, parsed_json')
      .eq('id', docId)
      .single();

    if (fetchErr) throw new Error(fetchErr.message);

    // Get the question to know its code and whether it's item-level
    const q = window._vdrQuestions && window._vdrQuestions[qid];
    const warnCode = q ? q.code : null;

    // Remove the matching warning from doc-level warnings
    const currentWarn = Array.isArray(data.warnings) ? data.warnings : [];
    let removed = false;
    const updatedWarn = currentWarn.filter(w => {
      if (!removed && w.code === warnCode) { removed = true; return false; }
      return true;
    });

    // If it's an item-level warning, also remove from parsed_json.items[n].warnings
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

    // Fade out and remove question card
    if (card) {
      card.style.opacity = '0';
      setTimeout(() => {
        card.remove();
        // Update the badge on the collapsed card header
        vdrRefreshBadge(docId);
      }, 250);
    }

  } catch(e) {
    // Restore card on error
    if (card) { card.style.opacity = '1'; card.style.pointerEvents = ''; }
    showScToast('Error: ' + e.message);
  }
}

// ── Refresh the question count badge on the card header ───────
function vdrRefreshBadge(docId) {
  // Count remaining question cards inside this document's detail panel
  const detail = document.getElementById('vdrDetail-' + docId);
  if (!detail) return;
  const remaining = detail.querySelectorAll('[id^="vdrQ-"]').length;

  const badgeEl = document.querySelector(`#vdrCard-${docId} .vdrQBadge`);
  // Re-render only the badge span — find it by its position in the header row
  const headerRow = document.querySelector(`#vdrCard-${docId} > div:first-child > div > div:first-child`);
  if (!headerRow) return;
  // Replace the last span (badge) in the header row
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
// Needed by answer handlers to retrieve question data by qid
const _vdrQMap = {};
window._vdrQuestions = _vdrQMap;

// Patch vdrToggle to register questions on first open
const _origVdrToggle = window.vdrToggle;
window.vdrToggle = function(id) {
  _origVdrToggle(id);
  // After opening, register all questions for this doc into the map
  // We re-derive them from the stored doc data — look up via the card's detail panel
  // Questions are already rendered; we need the objects in memory.
  // vdrLoad re-registers them; for toggles we rely on vdrRegisterQuestions below.
};

// Register questions for a doc into the global map (called after render)
function vdrRegisterQuestions(doc) {
  const qs = vdrBuildQuestions(doc);
  for (const q of qs) {
    _vdrQMap[q.qid] = q;
  }
}

// Patch vdrLoad to register questions after render
const _origVdrLoad = window.vdrLoad;
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
  return '📦';
}