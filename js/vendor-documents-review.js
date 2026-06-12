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
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;">
      <div style="padding:14px 16px;display:flex;align-items:center;gap:10px;">
        <button onclick="this.closest('#vdrModal').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
        <div style="flex:1;">
          <div style="font-size:15px;font-weight:600;color:#1e293b;">📋 Vendor Documents</div>
          <div style="font-size:11px;color:#94a3b8;">Pending review</div>
        </div>
        <button onclick="vdrLoad()" style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">↻ Refresh</button>
      </div>
      <div id="vdrVendorTabs" style="display:flex;gap:6px;padding:0 16px 12px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;">
        <button onclick="vdrSetVendor('all')" id="vdrTab-all" style="flex-shrink:0;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:#1e3a5f;color:white;">All</button>
      </div>
    </div>
    <div style="padding:16px;max-width:640px;width:100%;margin:0 auto;">
      <div id="vdrList">
        <div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>
      </div>
    </div>`;

  document.body.appendChild(modal);
  vdrLoad();
};

// ── Vendor filter ─────────────────────────────────────────────
let vdrCurrentVendor = 'all';

window.vdrSetVendor = function(v) {
  vdrCurrentVendor = v;
  // Update tab styles
  document.querySelectorAll('[id^="vdrTab-"]').forEach(btn => {
    const active = btn.id === 'vdrTab-' + v;
    btn.style.background = active ? '#1e3a5f' : '#f1f5f9';
    btn.style.color = active ? 'white' : '#475569';
  });
  vdrRenderList();
};

// ── Load pending documents ────────────────────────────────────
window.vdrLoad = async function() {
  const list = document.getElementById('vdrList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:40px 0;color:#94a3b8;font-size:13px;">Loading…</div>';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    // Check for pdf_received (emails from Gmail not yet processed)
    const { data: pdfQueue } = await sb
      .from('vendor_documents')
      .select('id,parsed_json,source_email_subject,created_at')
      .eq('status', 'pdf_received')
      .order('created_at', { ascending: true });

    // Check for pending (parsed, ready for review)
    const { data, error } = await sb
      .from('vendor_documents')
      .select('id,vendor,document_type,document_number,document_date,delivery_date,parsed_json,warnings,status,created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    let html = '';

    // Banner PDF ricevuti da Gmail
    if (pdfQueue && pdfQueue.length > 0) {
      html += `
        <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:14px;padding:14px 16px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <div style="font-size:13px;font-weight:600;color:#1e3a5f;">📧 ${pdfQueue.length} PDF ricevuti da Hardie's</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;">Arrivati via email — non ancora processati</div>
            </div>
            <button onclick="vdrProcessAllPdf()" id="vdrProcessAllBtn"
              style="height:38px;padding:0 16px;border-radius:12px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;">
              ▶ Processa tutti
            </button>
          </div>
          <div id="vdrProcessLog" style="display:none;margin-top:10px;font-size:11px;color:#64748b;"></div>
        </div>`;
    }

    // Build vendor tabs
    if (data && data.length > 0) {
      const vendors = [...new Set(data.map(d => d.vendor).filter(Boolean))].sort();
      const tabsEl = document.getElementById('vdrVendorTabs');
      if (tabsEl && vendors.length > 1) {
        const shortName = v => {
          if (!v) return '?';
          if (v.toLowerCase().includes('freshpoint')) return 'FreshPoint';
          if (v.toLowerCase().includes('hardie')) return "Hardie's";
          if (v.toLowerCase().includes('global')) return 'Global';
          if (v.toLowerCase().includes('sysco')) return 'Sysco';
          if (v.toLowerCase().includes('frugé') || v.toLowerCase().includes('fruge')) return 'Frugé';
          if (v.toLowerCase().includes('keith')) return 'Ben E. Keith';
          return v.split('/')[0].trim().split(' ').slice(0,2).join(' ');
        };
        let tabsHTML = `<button onclick="vdrSetVendor('all')" id="vdrTab-all" style="flex-shrink:0;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:${vdrCurrentVendor==='all'?'#1e3a5f':'#f1f5f9'};color:${vdrCurrentVendor==='all'?'white':'#475569'};">All</button>`;
        vendors.forEach(v => {
          const key = v.replace(/[^a-z0-9]/gi,'_');
          const active = vdrCurrentVendor === key;
          tabsHTML += `<button onclick="vdrSetVendor('${key}')" id="vdrTab-${key}" style="flex-shrink:0;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:${active?'#1e3a5f':'#f1f5f9'};color:${active?'white':'#475569'};">${shortName(v)}</button>`;
        });
        tabsEl.innerHTML = tabsHTML;
      } else if (tabsEl && vendors.length <= 1) {
        tabsEl.style.display = 'none';
      }
    }

    // Store all docs for filtering
    window._vdrAllDocs = data || [];
    window._vdrPdfQueue = pdfQueue || [];

    list.innerHTML = html;
    vdrRenderList();
    if (data) for (const doc of data) vdrRegisterQuestions(doc);

  } catch(e) {
    list.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#991b1b;font-size:13px;">✗ ${e.message}</div>`;
  }
};

// ── Process all pdf_received using the existing import pipeline ──
window.vdrProcessAllPdf = async function() {
  const btn = document.getElementById('vdrProcessAllBtn');
  const log = document.getElementById('vdrProcessLog');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing…'; }
  if (log) { log.style.display = 'block'; log.textContent = 'Loading PDF.js…'; }

  try {
    const sb = window.supabaseClient;
    const { data: queue } = await sb
      .from('vendor_documents')
      .select('id,parsed_json,source_email_subject')
      .eq('status', 'pdf_received')
      .order('created_at', { ascending: true });

    if (!queue || queue.length === 0) { vdrLoad(); return; }

    // Ensure PDF.js loaded
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const parsers = buildVendorParsers();
    let done = 0;

    for (const doc of queue) {
      const storagePath = doc.parsed_json?.storage_path;
      if (!log) break;
      log.textContent = `Processing ${done + 1}/${queue.length}: ${doc.source_email_subject || storagePath}…`;

      try {
        // Download PDF from Storage
        const { data: fileData, error: dlErr } = await sb.storage.from('app').download(storagePath);
        if (dlErr || !fileData) throw new Error('Download failed: ' + dlErr?.message);

        // Extract text with PDF.js — same as vendor-parser-ui.js extractWithPdfJs
        const arrayBuffer = await fileData.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const lineMap = {};
          for (const item of content.items) {
            const y = Math.round(item.transform[5]);
            if (!lineMap[y]) lineMap[y] = [];
            lineMap[y].push({ x: item.transform[4], text: item.str });
          }
          const sortedY = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
          pages.push(sortedY.map(y =>
            lineMap[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' ')
          ).join('\n'));
        }
        const rawText = pages.join('\n');

        if (!rawText || rawText.trim().length < 30) throw new Error('No text extracted');

        // Parse with Hardie's parser
        const parsed = parsers.parse(rawText);

        const docNumber = parsed.order_number || parsed.credit_number || null;
        const docDate   = parsed.order_date   || parsed.credit_date   || parsed.delivery_date || null;

        // Duplicate check by doc number
        if (docNumber) {
          const { data: byNum } = await sb.from('vendor_documents').select('id').eq('vendor', parsed.vendor).eq('document_number', docNumber).neq('id', doc.id).limit(1);
          if (byNum && byNum.length > 0) {
            await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'DUPLICATE', message: `Document #${docNumber} already exists` }] }).eq('id', doc.id);
            await sb.storage.from('app').remove([storagePath]);
            done++; continue;
          }
        }

        const allWarnings = [
          ...(parsed.warnings || []),
          ...(parsed.items || []).flatMap(i => (i.warnings || []).map(w => ({ ...w, item: i.description }))),
        ];

        await sb.from('vendor_documents').update({
          vendor:          parsed.vendor || "Hardie's Fresh Foods / Dairyland Produce",
          document_type:   parsed.document_type || 'invoice',
          document_number: docNumber,
          document_date:   docDate,
          delivery_date:   parsed.delivery_date || null,
          raw_text:        rawText,
          parsed_json:     parsed,
          status:          (parsed.items && parsed.items.length > 0) ? 'pending' : 'error',
          warnings:        allWarnings.length ? allWarnings : null,
          updated_at:      new Date().toISOString(),
        }).eq('id', doc.id);

        // Remove PDF from storage after successful parse
        if (parsed.items && parsed.items.length > 0) {
          await sb.storage.from('app').remove([storagePath]);
        }

        done++;
      } catch(e) {
        console.warn('[VDR] Error processing', doc.id, e.message);
        await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'PROCESS_ERROR', message: e.message }] }).eq('id', doc.id);
        done++;
      }
    }

    if (log) log.textContent = `✓ Done — ${done} PDF processed.`;
    setTimeout(() => vdrLoad(), 1000);

  } catch(e) {
    if (log) log.textContent = '✗ Error: ' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = '▶ Processa tutti'; }
  }
};

// ── Render filtered list ──────────────────────────────────────
window.vdrRenderList = function() {
  const list = document.getElementById('vdrList');
  if (!list) return;
  const allDocs = window._vdrAllDocs || [];
  const pdfQueue = window._vdrPdfQueue || [];

  let html = '';

  // PDF banner
  if (pdfQueue.length > 0) {
    html += `<div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:14px;padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-size:13px;font-weight:600;color:#1e3a5f;">📧 ${pdfQueue.length} PDF ricevuti da Hardie's</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">Arrivati via email — non ancora processati</div>
        </div>
        <button onclick="vdrProcessAllPdf()" id="vdrProcessAllBtn" style="height:38px;padding:0 16px;border-radius:12px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;">▶ Processa tutti</button>
      </div>
      <div id="vdrProcessLog" style="display:none;margin-top:10px;font-size:11px;color:#64748b;"></div>
    </div>`;
  }

  // Filter by vendor
  const filtered = vdrCurrentVendor === 'all' ? allDocs
    : allDocs.filter(d => (d.vendor||'').replace(/[^a-z0-9]/gi,'_') === vdrCurrentVendor);

  if (filtered.length === 0 && pdfQueue.length === 0) {
    html += `<div style="text-align:center;padding:48px 0;">
      <div style="font-size:32px;margin-bottom:10px;">✅</div>
      <div style="font-size:14px;font-weight:500;color:#1e293b;margin-bottom:4px;">All clear</div>
      <div style="font-size:12px;color:#94a3b8;">${vdrCurrentVendor === 'all' ? 'No pending documents' : 'No pending documents for this vendor'}</div>
    </div>`;
  } else {
    html += filtered.map(doc => vdrCardHTML(doc)).join('');
  }

  list.innerHTML = html;
  for (const doc of filtered) vdrRegisterQuestions(doc);
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
  // Find doc from stored data
  const allDocs = window._vdrAllDocs || [];
  const doc = allDocs.find(d => d.id === id);
  if (!doc) return;

  // Remove existing sheet if any
  const existing = document.getElementById('vdrSheet');
  if (existing) existing.remove();

  // Create bottom sheet
  const sheet = document.createElement('div');
  sheet.id = 'vdrSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;justify-content:flex-end;';

  const pj = doc.parsed_json || {};
  const questions = vdrBuildQuestions(doc);
  const qCount = questions.length;
  const total = pj.total != null ? '$' + Math.abs(pj.total).toFixed(2) : '—';

  sheet.innerHTML = `
    <div onclick="document.getElementById('vdrSheet').remove()" style="flex:1;background:rgba(0,0,0,0.4);"></div>
    <div id="vdrSheetPanel" style="background:white;border-radius:20px 20px 0 0;max-height:88vh;display:flex;flex-direction:column;touch-action:pan-y;">
      <!-- Drag handle -->
      <div style="display:flex;justify-content:center;padding:12px 0 4px;" id="vdrSheetHandle">
        <div style="width:36px;height:4px;border-radius:2px;background:#e2e8f0;"></div>
      </div>
      <!-- Top bar -->
      <div style="display:flex;align-items:center;gap:10px;padding:8px 16px 12px;border-bottom:1px solid #f1f5f9;flex-shrink:0;">
        <button onclick="document.getElementById('vdrSheet').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${doc.vendor || '—'}</div>
          <div style="font-size:11px;color:#94a3b8;">#${doc.document_number || '—'} · ${vdrFmtDate(doc.document_date)} · ${total}</div>
        </div>
        ${qCount > 0 ? `<span style="background:rgba(245,158,11,0.1);color:#92400e;border:1px solid rgba(245,158,11,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0;">❓ ${qCount}</span>` : `<span style="background:rgba(16,185,129,0.08);color:#065f46;border:1px solid rgba(16,185,129,0.2);padding:3px 10px;border-radius:20px;font-size:11px;flex-shrink:0;">✓ Ready</span>`}
      </div>
      <!-- Scrollable content -->
      <div style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;">
        ${vdrDetailHTML(doc)}
      </div>
      <!-- Bottom safe area -->
      <div style="height:env(safe-area-inset-bottom,0px);background:white;flex-shrink:0;"></div>
    </div>`;

  // Swipe down to close
  let startY = 0;
  const panel = sheet.querySelector('#vdrSheetPanel');
  panel.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive:true });
  panel.addEventListener('touchmove', e => {
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive:true });
  panel.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80) {
      sheet.remove();
    } else {
      panel.style.transform = '';
    }
  });

  document.body.appendChild(sheet);
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
              <th style="padding:5px 7px;color:#94a3b8;font-weight:500;text-align:right;white-space:nowrap;">$/100g</th>
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
              // ── Weight & $/100g calculation ──
              const totalG   = window.calcTotalWeightG ? window.calcTotalWeightG(item) : null;
              const price    = item.unit_price != null ? parseFloat(item.unit_price) : null;
              const per100g  = (totalG && price) ? ((price / totalG) * 100) : null;
              const per100gHtml = per100g != null
                ? `<span style="color:#059669;font-weight:500;">$${per100g.toFixed(2)}</span>`
                : `<span style="color:#cbd5e1;font-size:10px;">—</span>`;
              const weightHtml = totalG
                ? `<span style="font-size:9px;color:#94a3b8;">${totalG>=1000?(totalG/1000).toFixed(1)+'kg':Math.round(totalG)+'g'}</span>`
                : '';
              return `<tr style="border-bottom:0.5px solid #f8fafc;background:${rowBg}">
                <td style="padding:4px 7px;color:#94a3b8;white-space:nowrap;">${item.vendor_sku || '-'}</td>
                <td style="padding:4px 7px;color:#1e293b;max-width:160px;">
                  ${isSubst ? '<span style="font-size:9px;color:#f59e0b;font-weight:700;margin-right:3px;">SUB</span>' : ''}
                  ${item.description || item.raw_description || '-'}${rc}
                  ${weightHtml ? `<br>${weightHtml}` : ''}
                </td>
                <td style="padding:4px 7px;color:#64748b;white-space:nowrap;">${item.pack_description || '-'}</td>
                <td style="padding:4px 7px;text-align:${isInvoice ? 'center' : 'right'};color:${mismatch ? '#ef4444' : '#1e293b'};">${qty}</td>
                <td style="padding:4px 7px;text-align:right;color:#1e293b;">${item.unit_price != null ? '$' + item.unit_price.toFixed(2) : '-'}</td>
                <td style="padding:4px 7px;text-align:right;color:${item.amount < 0 ? '#ef4444' : '#1e293b'};font-weight:500;">${amt}</td>
                <td style="padding:4px 7px;text-align:right;">${per100gHtml}</td>
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
    // Skip OQR-006 for pure count packs — no ambiguity
    // e.g. "50 CT", "4/20 CT", "95 CT", "110 CT"
    const isPureCount = /^\d+\s*(\/\s*\d+\s*)?CT$/i.test(pack.trim());
    if (isPureCount) return null;
    // Skip OQR-006 for CT range packs — auto-calculate average
    // e.g. "16-22 CT" → average = 19, show info-only, no question
    const isRangeCT = /^(\d+)-(\d+)\s*CT$/i.test(pack.trim());
    if (isRangeCT) {
      const rm = pack.match(/^(\d+)-(\d+)\s*CT$/i);
      const avg = Math.round((parseInt(rm[1]) + parseInt(rm[2])) / 2);
      const itemName = name ? name.toLowerCase() : 'item';
      return {
        qid, code: 'OQR-006', item, docId, idx,
        emoji: vdrItemEmoji(name),
        title: name || 'Item',
        detected: pack,
        question: null,
        meaning: `Range ${pack} → using avg ${avg} ${itemName}s per case`,
        warnRef: w,
        infoOnly: true,
      };
    }
    // Calculate total count: "4/20 CT" → 4×20 = 80
    let totalCount = null;
    let unit = 'CT';
    const mSlash = pack.match(/^(\d+)\s*\/\s*(\d+)\s*([A-Z]+)/i);
    const mSimple = pack.match(/^(\d+)\s*([A-Z]+)/i);
    if (mSlash) {
      totalCount = parseInt(mSlash[1]) * parseInt(mSlash[2]);
      unit = mSlash[3].toUpperCase();
    } else if (mSimple) {
      totalCount = parseInt(mSimple[1]);
      unit = mSimple[2].toUpperCase();
    }
    const itemName = name ? name.toLowerCase() : unit.toLowerCase();
    const meaning = totalCount
      ? `1 case = ${totalCount} ${itemName}${totalCount > 1 ? 's' : ''} (${pack})`
      : `1 case = ${pack}`;
    return {
      qid, code: 'OQR-006', item, docId, idx,
      emoji: vdrItemEmoji(name),
      title: name || 'Item',
      detected: pack,
      question: `Is this pack correct?`,
      meaning,
      yesLabel: 'Yes, correct',
      noLabel: 'No, fix it',
      noNextQuestion: `How many ${itemName}s are in one case?`,
      noPlaceholder: `e.g. ${totalCount || 24}`,
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

  // ── OQR-007: Qty mismatch — three distinct cases ─────────────
  // ordered = 0, received > 0 → unexpected item / substitution
  // ordered > received         → short shipment
  // ordered < received         → over-delivery
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

    // Case C: ordered < received → over-delivery (or fallback)
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
    <div id="${cardId}" style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:10px 12px;margin-bottom:6px;">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <span style="font-size:16px;flex-shrink:0;">${q.emoji}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:#1e293b;">${q.title}</div>
          <div style="font-size:10px;color:#94a3b8;">Detected: ${q.detected}</div>
          ${q.meaning ? `<div style="font-size:10px;color:#64748b;">Meaning: ${q.meaning}</div>` : ''}
        </div>
      </div>
      <div style="font-size:11px;color:#475569;font-weight:500;margin-bottom:6px;">${q.question}</div>
      <div id="vdrQButtons-${q.qid}" style="display:flex;gap:6px;">
        <button onclick="vdrAnswerYes('${docId}','${q.qid}',${idx})"
          style="flex:1;height:32px;border-radius:8px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:11px;font-weight:500;cursor:pointer;">
          ${q.yesLabel}
        </button>
        <button onclick="vdrAnswerNo('${docId}','${q.qid}',${idx})"
          style="flex:1;height:32px;border-radius:8px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-size:11px;font-weight:500;cursor:pointer;">
          ${q.noLabel}
        </button>
      </div>
      <!-- Follow-up input, hidden until No -->
      <div id="vdrQFollowup-${q.qid}" style="display:none;margin-top:8px;">
        <div style="font-size:11px;color:#475569;margin-bottom:4px;font-weight:500;" id="vdrQFollowupLabel-${q.qid}"></div>
        <div style="display:flex;gap:6px;">
          <input id="vdrQFollowupInput-${q.qid}" type="text"
            style="flex:1;height:32px;padding:0 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;outline:none;" />
          <button onclick="vdrAnswerFollowup('${docId}','${q.qid}',${idx})"
            style="height:32px;padding:0 12px;border-radius:8px;background:#1e293b;color:white;font-size:11px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;">
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
const _vdrQMap = {};
window._vdrQuestions = _vdrQMap;
window.vdrApprove = async function(docId, btn) {
  const statusEl = document.getElementById('vdrActionStatus-' + docId);
  btn.disabled = true;
  btn.textContent = '⏳ Approving…';
  btn.style.background = '#94a3b8';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase client not available');

    // Fetch document
    const { data: doc, error: fetchErr } = await sb
      .from('vendor_documents').select('parsed_json,vendor').eq('id', docId).single();
    if (fetchErr) throw new Error(fetchErr.message);

    const pj = doc.parsed_json || {};
    const vendor = pj.vendor || doc.vendor || 'Unknown';
    const invoiceDate = pj.invoice_date || null;
    const items = pj.items || [];

    // ── Batch: fetch all matching SKUs in one query ──
    const skus = items.map(i => i.vendor_sku || i.item_code).filter(Boolean);
    const { data: existingBySku } = skus.length ? await sb.from('ingredient_vendors')
      .select('id,ingredient_id,vendor_sku').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] };
    const skuMap = {};
    (existingBySku || []).forEach(r => { skuMap[r.vendor_sku] = r; });

    // ── Batch: fetch all active ingredients for fuzzy matching ──
    const { data: allIngr } = await sb.from('ingredients').select('id,name').eq('active', true);
    const ingrList = allIngr || [];

    // ── Batch: fetch all existing ingredient_vendors for this vendor ──
    const { data: existingByIngr } = await sb.from('ingredient_vendors')
      .select('id,ingredient_id').eq('vendor', vendor);
    const ingrVendorMap = {};
    (existingByIngr || []).forEach(r => { ingrVendorMap[r.ingredient_id] = r.id; });

    // ── Process each item ──
    const toInsert = [];
    const toUpdate = [];

    for (const item of items) {
      const sku   = item.vendor_sku || item.item_code || null;
      const desc  = item.description || item.raw_description || null;
      if (!desc) continue;

      const totalG  = window.calcTotalWeightG ? window.calcTotalWeightG(item) : null;
      const price   = item.unit_price != null ? parseFloat(item.unit_price) : null;
      const per100g = (totalG && price) ? ((price / totalG) * 100) : null;
      const fields  = {
        unit_price: price, pack_description: item.pack_description || null,
        pack_size: item.pack_size || null, purchase_unit: item.purchase_unit || item.unit || null,
        price_per_100g: per100g, last_invoice_date: invoiceDate,
        updated_at: new Date().toISOString(),
      };

      // 1. Match by SKU
      if (sku && skuMap[sku]) {
        toUpdate.push({ id: skuMap[sku].id, ...fields });
        continue;
      }

      // 2. Fuzzy match by ingredient name
      const keywords = desc.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/)
        .filter(w => w.length > 2 && !['the','and','for','large','small','fresh','whole','organic','baby','jumbo','wild'].includes(w))
        .slice(0,2);

      if (!keywords.length) continue;
      const best = ingrList.find(i => keywords.every(k => i.name.toLowerCase().includes(k)))
                || ingrList.find(i => i.name.toLowerCase().includes(keywords[0]));
      if (!best) continue;

      if (ingrVendorMap[best.id]) {
        toUpdate.push({ id: ingrVendorMap[best.id], ...fields });
      } else {
        toInsert.push({ ingredient_id: best.id, vendor, vendor_sku: sku, active: true, ...fields });
      }
    }

    // ── Execute batch updates ──
    if (toUpdate.length) {
      await Promise.all(toUpdate.map(r => {
        const { id, ...data } = r;
        return sb.from('ingredient_vendors').update(data).eq('id', id);
      }));
    }
    if (toInsert.length) {
      // Insert one by one — skip duplicates silently
      for (const row of toInsert) {
        const { error: insErr } = await sb.from('ingredient_vendors').insert(row);
        if (insErr && !insErr.message.includes('duplicate') && !insErr.code === '23505') {
          console.warn('ingredient_vendors insert skip:', insErr.message);
        }
      }
    }

    // ── Mark document as imported ──
    const { error: updErr } = await sb.from('vendor_documents')
      .update({ status: 'imported', updated_at: new Date().toISOString() }).eq('id', docId);
    if (updErr) throw new Error(updErr.message);

    const card = document.getElementById('vdrCard-' + docId);
    if (card) {
      card.style.transition = 'opacity .3s'; card.style.opacity = '0';
      setTimeout(() => {
        card.remove();
        const list = document.getElementById('vdrList');
        if (list && list.querySelectorAll('[id^="vdrCard-"]').length === 0) vdrLoad();
      }, 300);
    }
    // ── Open match modal ──
    await vdrShowMatchModal(items, vendor, sb);

  } catch(e) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239,68,68,0.06)';
      statusEl.style.border = '1px solid rgba(239,68,68,0.25)';
      statusEl.style.color = '#991b1b';
      statusEl.textContent = '✗ ' + e.message;
    }
    btn.disabled = false; btn.textContent = '✓ Approve Document'; btn.style.background = '#1e293b';
  }
};

// ── Post-Approve Match Modal ──────────────────────────────────
async function vdrShowMatchModal(items, vendor, sb) {
  // Fetch all active ingredients for matching
  const { data: allIngr } = await sb.from('ingredients').select('id,name,category').eq('active', true);
  const ingrs = (allIngr || []).filter(i => i.category !== 'Supply');

  // For each item, find best match
  function findMatches(desc) {
    const stop = ['large','small','medium','fresh','whole','organic','baby','jumbo','wild','red','green','yellow','white','black','blue','sliced','diced','chopped','dried','frozen','raw','salted','unsalted','ground','grated'];
    const kws = (desc || '').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/)
      .filter(w => w.length > 2 && !stop.includes(w)).slice(0, 3);
    if (!kws.length) return [];
    const scored = ingrs.map(i => {
      const n = i.name.toLowerCase();
      const score = kws.filter(k => n.includes(k)).length;
      return { ...i, score };
    }).filter(x => x.score > 0).sort((a,b) => b.score - a.score || a.name.length - b.name.length);
    return scored.slice(0, 3);
  }

  // Build item states
  const itemStates = items.map(item => {
    const desc = item.description || item.raw_description || '';
    const matches = findMatches(desc);
    return {
      item, desc,
      status: matches.length ? 'suggest' : 'new',
      suggested: matches[0] || null,
      candidates: matches,
      linkedId: null, linkedName: null,
    };
  });

  // ── Render modal ──
  const existing = document.getElementById('_vdrMatchModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = '_vdrMatchModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9300;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);';

  function renderAll() {
    const done = itemStates.filter(s => s.status === 'done' || s.status === 'skip').length;
    const total = itemStates.length;
    const allDone = done === total;

    const itemsHtml = itemStates.map((s, idx) => {
      if (s.status === 'done') {
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:0.5px solid #f8fafc;">
          <span style="font-size:16px;">✅</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.desc}</div>
            <div style="font-size:10px;color:#10b981;">→ ${s.linkedName}</div>
          </div>
          <button onclick="vdrMatchUndo(${idx})" style="font-size:10px;padding:3px 8px;border-radius:8px;background:#f1f5f9;color:#64748b;border:none;cursor:pointer;flex-shrink:0;">↩</button>
        </div>`;
      }
      if (s.status === 'skip') {
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:0.5px solid #f8fafc;opacity:0.4;">
          <span style="font-size:16px;">⏭️</span>
          <div style="font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.desc}</div>
        </div>`;
      }

      const suggestBtns = s.candidates.map((c,ci) => {
        const isPrimary = ci === 0;
        return `<button onclick="vdrMatchLink(${idx},'${c.id}','${c.name.replace(/'/g,"\'")}',this)"
          style="font-size:${isPrimary?'12':'11'}px;padding:${isPrimary?'7px 12px':'5px 10px'};border-radius:${isPrimary?10:8}px;
          background:${isPrimary?'rgba(16,185,129,0.1)':'rgba(59,130,246,0.06)'};
          color:${isPrimary?'#065f46':'#1d4ed8'};
          border:1px solid ${isPrimary?'rgba(16,185,129,0.3)':'rgba(59,130,246,0.2)'};
          cursor:pointer;font-weight:${isPrimary?600:400};white-space:nowrap;">
          ${isPrimary?'✓ ':''} ${c.name}
        </button>`;
      }).join('');

      return `<div id="vdrMItem-${idx}" style="padding:8px 0;border-bottom:0.5px solid #f8fafc;">
        <div style="font-size:12px;font-weight:500;color:#1e293b;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.desc}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
          ${suggestBtns}
          <button onclick="vdrMatchSkip(${idx})" style="font-size:10px;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,0.04);color:#94a3b8;border:1px solid #e2e8f0;cursor:pointer;">Skip</button>
          <button onclick="vdrMatchShowSearch(${idx})" style="font-size:10px;padding:4px 8px;border-radius:8px;background:rgba(245,158,11,0.08);color:#92400e;border:1px solid rgba(245,158,11,0.3);cursor:pointer;">🔍 Search</button>
        </div>
        <div id="vdrMSearch-${idx}" style="display:none;margin-top:6px;">
          <div style="display:flex;gap:6px;">
            <input id="vdrMInput-${idx}" type="text" placeholder="Type ingredient name..." list="vdrIngrList"
              style="flex:1;height:34px;padding:0 10px;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;outline:none;"/>
            <button onclick="vdrMatchConfirmSearch(${idx})" style="height:34px;padding:0 12px;border-radius:10px;background:#1e293b;color:white;font-size:12px;border:none;cursor:pointer;">Link</button>
          </div>
        </div>
      </div>`;
    }).join('');

    modal.innerHTML = `<div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;display:flex;flex-direction:column;">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 12px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div style="font-size:15px;font-weight:600;color:#1e293b;">🔗 Match Ingredients</div>
        <div style="font-size:11px;color:#94a3b8;">${done}/${total} done</div>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:12px;">Link each invoice item to an ingredient in your database.</div>
      <div style="background:#f8fafc;border-radius:10px;height:4px;margin-bottom:14px;overflow:hidden;">
        <div style="width:${Math.round((done/total)*100)}%;height:100%;background:#10b981;border-radius:10px;transition:width .3s;"></div>
      </div>
      <div style="flex:1;overflow-y:auto;padding-bottom:4px;">${itemsHtml}</div>
      <div style="margin-top:12px;">
        <button onclick="vdrMatchDone()" style="width:100%;height:44px;border-radius:14px;background:${allDone?'#10b981':'#1e293b'};color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">
          ${allDone?'✓ All matched — Done':'Done'}
        </button>
      </div>
    </div>`;
  }

  // ── Actions ──
  window.vdrMatchLink = async function(idx, ingrId, ingrName, btn) {
    btn.textContent = '...'; btn.disabled = true;
    const s = itemStates[idx];
    const sb2 = window.supabaseClient;
    // Save to ingredient_links
    await sb2.from('ingredient_links').upsert({
      vendor, invoice_description: s.desc,
      ingredient_id: ingrId, ingredient_name: ingrName,
      confirmed: true, updated_at: new Date().toISOString()
    }, { onConflict: 'vendor,invoice_description' });
    // Update invoice_lines match_status
    await sb2.from('invoice_lines')
      .update({ match_status: 'matched', ingredient_id: ingrId })
      .eq('vendor', vendor).eq('raw_description', s.desc);
    s.status = 'done'; s.linkedId = ingrId; s.linkedName = ingrName;
    renderAll();
  };

  window.vdrMatchSkip = function(idx) {
    itemStates[idx].status = 'skip';
    renderAll();
  };

  // Build datalist from all ingredients (once)
  if (!document.getElementById('vdrIngrList')) {
    const dl = document.createElement('datalist');
    dl.id = 'vdrIngrList';
    ingrs.forEach(i => { const o = document.createElement('option'); o.value = i.name; dl.appendChild(o); });
    document.body.appendChild(dl);
  }

  window.vdrMatchShowSearch = function(idx) {
    const el = document.getElementById('vdrMSearch-' + idx);
    if (el) { el.style.display = 'block'; document.getElementById('vdrMInput-' + idx)?.focus(); }
  };

  window.vdrMatchConfirmSearch = async function(idx) {
    const input = document.getElementById('vdrMInput-' + idx);
    const val = input ? input.value.trim() : '';
    if (!val) return;
    const sb2 = window.supabaseClient;
    // Check if ingredient exists
    const { data: found } = await sb2.from('ingredients').select('id,name').ilike('name', val).limit(1);
    if (found && found.length) {
      window.vdrMatchLink(idx, found[0].id, found[0].name, { textContent:'', disabled:false });
    } else {
      // Create new ingredient
      const { data: created } = await sb2.from('ingredients')
        .insert({ name: val, count_unit: 'weight', active: true }).select('id').single();
      if (created) window.vdrMatchLink(idx, created.id, val, { textContent:'', disabled:false });
    }
  };

  window.vdrMatchUndo = function(idx) {
    const s = itemStates[idx];
    s.status = 'suggest';
    s.linkedId = null; s.linkedName = null;
    renderAll();
  };

  window.vdrMatchDone = function() {
    modal.remove();
    showScToast('✓ Match complete');
  };

  document.body.appendChild(modal);
  renderAll();
}

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