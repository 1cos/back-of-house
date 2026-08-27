// ── VENDOR PARSER TEST HARNESS ───────────────────────────────
// Admin-only UI for testing vendor parsers.
// NO database writes. Parse and preview only.
// Uses js/vendor-parsers/index.js

// Dynamically load vendor-parsers if not already loaded
function ensureVendorParsers() {
  return new Promise((resolve, reject) => {
    if (window.VendorParsers) { resolve(window.VendorParsers); return; }
    // Load each module via script tags (browser-compatible CommonJS shim)
    loadVendorParserModules().then(resolve).catch(reject);
  });
}

// Browser-compatible shim — loads parser files and assembles VendorParsers
async function loadVendorParserModules() {
  // Inline the parsers as browser-compatible functions
  // (CommonJS require() doesn't work in browsers — we embed the logic directly)
  window.VendorParsers = buildVendorParsers();
  return window.VendorParsers;
}

// ── Main entry point ──────────────────────────────────────────
window.openVendorParserTest = function() {
  if (!isAdmin()) return;

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[65] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;display:flex;align-items:center;gap:10px;">
      <button onclick="this.closest('.fixed').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
      <div>
        <div style="font-size:15px;font-weight:600;color:#1e293b;">🧪 Vendor Parser Test</div>
        <div style="font-size:11px;color:#94a3b8;">Admin only — no DB writes</div>
      </div>
    </div>

    <div style="padding:16px;max-width:600px;width:100%;margin:0 auto;">

      <!-- Instructions -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#166534;">
        Paste raw text from a Hardie's document (Invoice, Order Confirmation, or Credit Memo).
        The parser will detect vendor and document type automatically.
        Nothing is saved to the database.
      </div>

      <!-- PDF upload -->
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">UPLOAD PDF</label>
        <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(59,130,246,0.05);border:1.5px dashed rgba(59,130,246,0.3);border-radius:10px;cursor:pointer;">
          <span style="font-size:22px;">📄</span>
          <div>
            <div style="font-size:13px;color:#3B82F6;font-weight:500;">Choose PDF file</div>
            <div style="font-size:11px;color:#94a3b8;">Text will be extracted and placed in the text area below</div>
          </div>
          <input type="file" accept=".pdf,application/pdf" style="display:none" onchange="extractPdfText(this)">
        </label>
        <div id="pdfStatus" style="display:none;font-size:12px;color:#64748b;margin-top:6px;padding:6px 10px;background:#f8fafc;border-radius:8px;"></div>
      </div>

      <!-- Paste area -->
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">RAW DOCUMENT TEXT</label>
        <textarea id="parserInput" rows="12" placeholder="Paste invoice/order/credit text here, or upload a PDF above..."
          style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;line-height:1.5;"></textarea>
      </div>

      <!-- Sample buttons -->
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <button onclick="loadSample('order')"
          style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">
          Load sample: Order Conf
        </button>
        <button onclick="loadSample('invoice')"
          style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">
          Load sample: Invoice
        </button>
        <button onclick="loadSample('credit')"
          style="font-size:11px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">
          Load sample: Credit
        </button>
        <button onclick="document.getElementById('parserInput').value=''"
          style="font-size:11px;color:#64748b;background:#f1f5f9;border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">
          Clear
        </button>
      </div>

      <!-- Parse button -->
      <button onclick="runParserTest()"
        style="width:100%;height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;margin-bottom:10px;">
        🔍 Parse Document
      </button>

      <!-- Save button (hidden until parse succeeds) -->
      <button id="parserSaveBtn" onclick="saveVendorDocument()"
        style="display:none;width:100%;height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;margin-bottom:6px;">
        💾 Save Parsed Document
      </button>

      <!-- Continue to Invoice Import button (hidden until parse succeeds) -->
      <button id="parserImportBtn" onclick="continueToInvoiceImport()"
        style="display:none;width:100%;height:44px;border-radius:14px;background:#059669;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;margin-bottom:6px;">
        ✓ Continue to Invoice Import
      </button>

      <!-- Save status message -->
      <div id="parserSaveStatus" style="display:none;margin-bottom:10px;padding:10px 12px;border-radius:10px;font-size:13px;"></div>

      <!-- Detection result -->
      <div id="parserDetection" style="display:none;margin-bottom:12px;"></div>

      <!-- Parsed items table -->
      <div id="parserItemsSection" style="display:none;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">
          Parsed Items
        </div>
        <div id="parserItemsTable"></div>
      </div>

      <!-- Warnings -->
      <div id="parserWarningsSection" style="display:none;margin-top:12px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">
          Warnings / OQR
        </div>
        <div id="parserWarningsList"></div>
      </div>

      <!-- Raw JSON -->
      <div id="parserJsonSection" style="display:none;margin-top:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;">Raw JSON Output</div>
          <button onclick="copyParserJson()" style="font-size:11px;color:#3B82F6;background:none;border:none;cursor:pointer;">Copy</button>
        </div>
        <pre id="parserJsonOut" style="font-size:10px;color:#475569;background:#f8fafc;border-radius:10px;padding:12px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto;"></pre>
      </div>

    </div>`;

  document.body.appendChild(modal);
};

// ── PDF text extraction ──────────────────────────────────────
window.extractPdfText = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('pdfStatus');
  status.style.display = 'block';
  status.textContent = '⏳ Extracting text from PDF...';

  try {
    // Use PDF.js from CDN if available, otherwise use FileReader text extraction
    const text = await readPdfAsText(file);
    if (!text || text.trim().length < 20) {
      status.textContent = '⚠️ PDF text not selectable — OCR needed later. Try pasting text manually.';
      status.style.color = '#f59e0b';
      return;
    }
    document.getElementById('parserInput').value = text;
    status.textContent = `✓ Extracted ${text.length} characters from PDF`;
    status.style.color = '#10b981';
  } catch(e) {
    status.textContent = 'PDF text not selectable — OCR needed later. Try pasting text manually.';
    status.style.color = '#f59e0b';
    console.warn('PDF extraction failed:', e.message);
  }
};

async function readPdfAsText(file) {
  // Method 1: Try PDF.js if loaded
  if (window.pdfjsLib) {
    return await extractWithPdfJs(file);
  }

  // Method 2: Load PDF.js dynamically from CDN
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return await extractWithPdfJs(file);
  } catch(e) {
    console.warn('PDF.js load failed:', e.message);
  }

  // Method 3: Try reading as text directly (works for some PDFs)
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      // Check if it looks like readable text (not binary)
      const readable = text.replace(/[^\x20-\x7E\r\n\t]/g, '').trim();
      if (readable.length > 100) resolve(readable);
      else reject(new Error('Not readable text'));
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function extractWithPdfJs(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines by grouping items with similar Y position
    const items = content.items;
    const lineMap = {};
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      if (!lineMap[y]) lineMap[y] = [];
      lineMap[y].push({ x: item.transform[4], text: item.str });
    }
    const sortedY = Object.keys(lineMap).map(Number).sort((a,b) => b - a);
    const lines = sortedY.map(y =>
      lineMap[y].sort((a,b) => a.x - b.x).map(i => i.text).join(' ')
    );
    pages.push(lines.join('\n'));
  }
  return pages.join('\n')
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Run the parser ────────────────────────────────────────────
window.runParserTest = function() {
  const raw = document.getElementById('parserInput')?.value?.trim();
  if (!raw) { showScToast('Paste some document text first'); return; }

  const parsers = buildVendorParsers();
  const vendor  = parsers.detectVendor(raw);
  const docType = parsers.detectDocumentType(raw);
  let result;

  try {
    result = parsers.parse(raw);
  } catch(e) {
    showScToast('Parser error: ' + e.message);
    console.error('Parser error:', e);
    return;
  }

  // ── Detection badge ──
  const detEl = document.getElementById('parserDetection');
  detEl.style.display = 'block';
  const vendorColor  = vendor  !== 'unknown' ? '#10b981' : '#ef4444';
  const docColor     = docType !== 'unknown' ? '#3B82F6' : '#ef4444';
  detEl.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <span style="background:${vendorColor}10;color:${vendorColor};border:1px solid ${vendorColor}30;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;">
        Vendor: ${vendor}
      </span>
      <span style="background:${docColor}10;color:${docColor};border:1px solid ${docColor}30;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;">
        Type: ${docType}
      </span>
      <span style="background:#f1f5f9;color:#64748b;padding:4px 10px;border-radius:20px;font-size:12px;">
        ${result.items?.length || 0} items · ${(result.warnings||[]).length} warnings
      </span>
      ${result.order_number ? `<span style="background:#f1f5f9;color:#64748b;padding:4px 10px;border-radius:20px;font-size:12px;">#${result.order_number}</span>` : ''}
      ${result.total != null ? `<span style="background:#f1f5f9;color:#1e293b;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;">$${Math.abs(result.total).toFixed(2)}</span>` : ''}
    </div>`;

  // ── Items table ──
  const items = result.items || [];
  const itemsSection = document.getElementById('parserItemsSection');
  const itemsTable   = document.getElementById('parserItemsTable');

  if (items.length) {
    itemsSection.style.display = 'block';
    const isInvoice = docType === 'invoice';
    const isCredit  = docType === 'credit_memo';
    itemsTable.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="border-bottom:2px solid #f1f5f9;text-align:left;">
              <th style="padding:6px 8px;color:#94a3b8;font-weight:500;white-space:nowrap;">SKU</th>
              <th style="padding:6px 8px;color:#94a3b8;font-weight:500;">Description</th>
              <th style="padding:6px 8px;color:#94a3b8;font-weight:500;white-space:nowrap;">Pack</th>
              ${isInvoice ? '<th style="padding:6px 8px;color:#94a3b8;font-weight:500;text-align:center;">Ord/Shp</th>' : ''}
              ${!isInvoice ? '<th style="padding:6px 8px;color:#94a3b8;font-weight:500;text-align:right;">Qty</th>' : ''}
              <th style="padding:6px 8px;color:#94a3b8;font-weight:500;text-align:right;">Price</th>
              <th style="padding:6px 8px;color:#94a3b8;font-weight:500;text-align:right;">Ext.</th>
              <th style="padding:6px 8px;color:#94a3b8;font-weight:500;text-align:center;">⚠️</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => {
              const hasWarning = item.warnings?.length > 0;
              const isSubst    = item.is_substitution;
              const mismatch   = isInvoice && item.qty_ordered !== item.qty_received && item.qty_received != null;
              const rowBg      = isSubst ? 'rgba(245,158,11,0.05)' : mismatch ? 'rgba(239,68,68,0.04)' : '';
              const qty = isInvoice
                ? `${item.qty_ordered}/${item.qty_received}`
                : isCredit
                  ? (item.qty_credited || '-')
                  : (item.qty_ordered || '-');
              const amount = item.amount != null ? (item.amount < 0 ? `-$${Math.abs(item.amount).toFixed(2)}` : `$${item.amount.toFixed(2)}`) : '-';
              const rc = isCredit && item.return_code ? ` <span style="color:#ef4444;font-size:10px;">[${item.return_code}]</span>` : '';
              return `<tr style="border-bottom:0.5px solid #f8fafc;background:${rowBg}">
                <td style="padding:5px 8px;color:#94a3b8;font-size:11px;white-space:nowrap;">${item.vendor_sku || '-'}</td>
                <td style="padding:5px 8px;color:#1e293b;max-width:180px;">
                  ${isSubst ? '<span style="font-size:9px;color:#f59e0b;font-weight:700;margin-right:4px;">SUB</span>' : ''}
                  ${item.description}${rc}
                </td>
                <td style="padding:5px 8px;color:#64748b;white-space:nowrap;font-size:11px;">${item.pack_description || '-'}</td>
                <td style="padding:5px 8px;text-align:${isInvoice?'center':'right'};color:${mismatch?'#ef4444':'#1e293b'};">${qty}</td>
                <td style="padding:5px 8px;text-align:right;color:#1e293b;">${item.unit_price != null ? '$'+item.unit_price.toFixed(2) : '-'}</td>
                <td style="padding:5px 8px;text-align:right;color:${item.amount < 0 ? '#ef4444' : '#1e293b'};font-weight:500;">${amount}</td>
                <td style="padding:5px 8px;text-align:center;">${hasWarning ? `<span title="${item.warnings.map(w=>w.code+': '+w.message).join('\n')}" style="cursor:help;">⚠️</span>` : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } else {
    itemsSection.style.display = 'none';
  }

  // ── Warnings ──
  const allWarnings = [
    ...(result.warnings || []),
    ...(items.flatMap(i => (i.warnings || []).map(w => ({...w, item: i.description}))))
  ];
  const warnSection = document.getElementById('parserWarningsSection');
  const warnList    = document.getElementById('parserWarningsList');

  if (allWarnings.length) {
    warnSection.style.display = 'block';
    warnList.innerHTML = allWarnings.map(w => {
      const codeColor = {
        'OQR-001':'#ef4444','OQR-002':'#f59e0b','OQR-003':'#f59e0b',
        'OQR-006':'#3B82F6','OQR-007':'#ef4444','OQR-008':'#94a3b8',
        'PARSE_ERROR':'#ef4444',
      }[w.code] || '#64748b';
      return `<div style="display:flex;gap:8px;align-items:start;padding:7px 10px;background:#f8fafc;border-radius:8px;margin-bottom:5px;">
        <span style="font-size:10px;font-weight:700;color:${codeColor};background:${codeColor}15;padding:2px 6px;border-radius:6px;white-space:nowrap;flex-shrink:0;">${w.code}</span>
        <div style="font-size:12px;color:#475569;">
          ${w.item ? `<span style="color:#94a3b8;">${w.item} — </span>` : ''}${w.message}
          ${w.possible_reasons?.length ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Possible: ${w.possible_reasons.join(', ')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  } else {
    warnSection.style.display = 'none';
  }

  // ── JSON output ──
  const jsonSection = document.getElementById('parserJsonSection');
  const jsonOut     = document.getElementById('parserJsonOut');
  jsonSection.style.display = 'block';
  jsonOut.textContent = JSON.stringify(result, null, 2);
  window._lastParserResult = result;
  window._lastRawText = raw;

  // Show the Save button now that we have a result
  const saveBtn = document.getElementById('parserSaveBtn');
  if (saveBtn) {
    saveBtn.style.display = 'block';
    saveBtn.textContent = '💾 Save Parsed Document';
    saveBtn.disabled = false;
    saveBtn.style.background = '#1e293b';
    saveBtn.style.color = 'white';
    saveBtn.style.cursor = 'pointer';
  }

  // Show Continue to Invoice Import button only for invoice/order docs with items
  const importBtn = document.getElementById('parserImportBtn');
  if (importBtn) {
    const isImportable = (result.items || []).length > 0 &&
      (result.document_type === 'invoice' || result.document_type === 'order_confirmation');
    importBtn.style.display = isImportable ? 'block' : 'none';
    importBtn.textContent = '✓ Continue to Invoice Import';
    importBtn.disabled = false;
    importBtn.style.background = '#059669';
    importBtn.style.cursor = 'pointer';
  }

  const saveStatus = document.getElementById('parserSaveStatus');
  if (saveStatus) saveStatus.style.display = 'none';
};


// ── Save parsed document to vendor_documents ─────────────────
window.saveVendorDocument = async function() {
  const result  = window._lastParserResult;
  const rawText = window._lastRawText;

  if (!result) { showScToast('Parse a document first'); return; }

  const saveBtn    = document.getElementById('parserSaveBtn');
  const saveStatus = document.getElementById('parserSaveStatus');

  // Resolve document_number — check all parser fields, then fall back to raw text scan
  let docNumber = result.document_number
    || result.invoice_number
    || result.order_number
    || result.credit_number
    || null;
  if (!docNumber && rawText) {
    // Try INVOICE/POD <number> or INVOICE <number> or CREDIT <number>
    const m = rawText.match(/(?:INVOICE\/POD|INVOICE|CREDIT)\s+(\d{5,10})/i);
    if (m) docNumber = m[1];
  }
  if (!docNumber && rawText) {
    // Last resort: first standalone 5-10 digit number in first 20 lines
    const top = rawText.split('\n').slice(0, 20).join('\n');
    const m2  = top.match(/\b(\d{5,10})\b/);
    if (m2) docNumber = m2[1];
  }

  // Resolve dates
  const docDate      = result.order_date  || result.credit_date  || result.invoice_date  || null;
  const deliveryDate = result.delivery_date || null;

  // Collect all warnings (document-level + item-level)
  const allWarnings = [
    ...(result.warnings || []),
    ...(result.items || []).flatMap(i =>
      (i.warnings || []).map(w => ({ ...w, item: i.description }))
    )
  ];

  // Disable button while saving
  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Saving…';
  saveBtn.style.background = '#94a3b8';
  saveBtn.style.cursor = 'default';
  saveStatus.style.display = 'none';

  try {
    const sb =

  window.supabaseClient ||

  window.supa ||

  (typeof supa !== 'undefined' ? supa : null);
    if (!sb) throw new Error('Supabase client not available');

    // ── Duplicate check ──────────────────────────────────────
    if (docNumber && result.vendor && result.document_type) {
      const { data: existing, error: chkErr } = await sb
        .from('vendor_documents')
        .select('id')
        .eq('vendor',          result.vendor)
        .eq('document_type',   result.document_type)
        .eq('document_number', docNumber)
        .maybeSingle();

      if (chkErr) throw new Error(chkErr.message);

      if (existing) {
        saveStatus.style.display = 'block';
        saveStatus.style.background = 'rgba(245,158,11,0.08)';
        saveStatus.style.border = '1px solid rgba(245,158,11,0.3)';
        saveStatus.style.color = '#92400e';
        saveStatus.textContent = `⚠️ Document already exists (${result.document_type} #${docNumber} — ${result.vendor})`;
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Parsed Document';
        saveBtn.style.background = '#1e293b';
        saveBtn.style.color = 'white';
        saveBtn.style.cursor = 'pointer';
        return;
      }
    }

    // ── Insert ───────────────────────────────────────────────
    const { error: insertErr } = await sb
      .from('vendor_documents')
      .insert({
        vendor:          result.vendor        || 'unknown',
        document_type:   result.document_type || 'unknown',
        document_number: docNumber,
        document_date:   docDate,
        delivery_date:   deliveryDate,
        raw_text:        rawText              || null,
        parsed_json:     result,
        warnings:        allWarnings.length ? allWarnings : null,
        status:          'pending',
      });

    if (insertErr) throw new Error(insertErr.message);

    // ── Success ──────────────────────────────────────────────
    saveStatus.style.display = 'block';
    saveStatus.style.background = 'rgba(16,185,129,0.08)';
    saveStatus.style.border = '1px solid rgba(16,185,129,0.3)';
    saveStatus.style.color = '#065f46';
    saveStatus.textContent = `✓ Saved successfully — ${result.document_type} #${docNumber || '(no number)'} · ${result.vendor}`;

    // Disable save button — already saved
    saveBtn.disabled = true;
    saveBtn.textContent = '✓ Saved';
    saveBtn.style.background = '#10b981';
    saveBtn.style.cursor = 'default';

  } catch(e) {
    saveStatus.style.display = 'block';
    saveStatus.style.background = 'rgba(239,68,68,0.06)';
    saveStatus.style.border = '1px solid rgba(239,68,68,0.25)';
    saveStatus.style.color = '#991b1b';
    saveStatus.textContent = `✗ Save error: ${e.message}`;

    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Parsed Document';
    saveBtn.style.background = '#1e293b';
    saveBtn.style.color = 'white';
    saveBtn.style.cursor = 'pointer';
  }
};

window.copyParserJson = function() {
  const text = document.getElementById('parserJsonOut')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => showScToast('JSON copied'));
};

// ── Sample fixtures ───────────────────────────────────────────
const SAMPLES = {
  order: `Dairyland Produce, LLC
(dba Hardie's Fresh Foods)
Hardie's Dallas/Chefs' Whse
CONFIRMATION OF SALE
INVOICE 06991299
DATE 06/06/26
CUSTOMER CODE ZEN102

1  70116  BRUSSEL SPROUTS MEDIUM        25#          47.92   47.92
2  25265  CHZ MOZZ SHRED GRANDE W/M     5#           24.96   49.92
2  29810  PASTURE RAISED LIQUID WHL EGGS  20#        81.39   162.78
1  71114  LETTUCE ROMAINE HEARTS        12/3 CT      79.17   79.17
1  71117  LIME #1 PERSIAN               110 CT       60.42   60.42
1  00108  ASPARAGUS LARGE               11/1#        59.03   59.03
1  04260  AVOCADO 1 HASS                6 CT         13.27   13.27
2  05840  FLOWER MARIGOLD               50 CT        23.44   46.88
1  71104  LEMON CHOICE                  95 CT        33.53   33.53
1  01866  WATERMELON SEEDLESS           1 CT         15.97   15.97
2  71898  SPINACH BABY                  4#           17.36   34.72
1  71904  TOMATO BEEFSTEAK RED          16-22 CT     39.02   39.02
1  22520  TOMATO HIIROS CHERRY ON VINE  8/12 OZ      39.63   39.63
1  13544  RWPR 103 RIB REF              1pc / 28#  USA  29.05  871.50

SUBTOTAL 1553.76
TAX .00
TOTAL $1,553.76 INVOICE`,

  invoice: `Dairyland Produce, LLC
(dba Hardie's Fresh Foods)
INVOICE/POD 06991299
DATE/TRIP 06/06/26 / 00636804
ROUTE/STOP DA110 / 9
CUSTOMER CODE ZEN102

1  1  70116  BRUSSEL SPROUTS MEDIUM        25#       47.92   47.92
2  2  25265  CHZ MOZZ SHRED GRANDE W/M     5#        24.96   49.92
2  2  29810  PASTURE RAISED LIQUID WHL EGGS  20#     81.39   162.78
1  1  71114  LETTUCE ROMAINE HEARTS        12/3 CT   79.17   79.17
1  1  71117  LIME #1 PERSIAN               110 CT    60.42   60.42
1  1  00108  ASPARAGUS LARGE               11/1#     59.03   59.03
1  1  04260  AVOCADO 1 HASS                6 CT      13.27   13.27
2  2  05840  FLOWER MARIGOLD               50 CT     23.44   46.88
1  1  71104  LEMON CHOICE                  95 CT     33.53   33.53
1  0  01866  WATERMELON SEEDLESS           1 CT      15.97   .00
0  1  05446  WATERMELON LOCAL 1 CT         1 CT      11.81   11.81
            SUBSTITUTION
2  2  71898  SPINACH BABY                  4#        17.36   34.72
1  1  71904  TOMATO BEEFSTEAK RED          16-22 CT  39.02   39.02
1  1  22520  TOMATO HIIROS CHERRY ON VINE  8/12 OZ   39.63   39.63
1  1  13544  RWPR 103 RIB REF              1pc / 28# 29.05   807.59

SUBTOTAL 1485.69
TAX/PCT. $.00
INVOICE $1,485.69`,

  credit: `Dairyland Produce, LLC
(dba Hardie's Fresh Foods)
CREDIT 00668419
DATE 06/06/26
ROUTE/STOP DA110 - 9 / 9
CUSTOMER CODE ZEN102

2  25265  CHZ MOZZ SHRED GRANDE W/M  5#  USA  24.96  -49.92  5A
Original Sales Order: 06991299

TOTAL $-49.92`,
};

window.loadSample = function(type) {
  const ta = document.getElementById('parserInput');
  if (ta) ta.value = SAMPLES[type] || '';
};

// ── Browser-compatible vendor parsers ────────────────────────
// Inlines the Node.js parsers as browser functions
// (avoids require() which doesn't work in browsers)
function buildVendorParsers() {
  // ── utils ──
  function parseDate(str) {
    if (!str) return null;
    str = String(str).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let y = parseInt(m[3]); if (y < 100) y += 2000;
      return `${y}-${String(parseInt(m[1])).padStart(2,'0')}-${String(parseInt(m[2])).padStart(2,'0')}`;
    }
    return null;
  }

  function parsePrice(str) {
    if (str === null || str === undefined) return null;
    const n = parseFloat(String(str).replace(/[$,\s]/g,''));
    return isNaN(n) ? null : n;
  }

  function parsePackSize(str) {
    if (!str) return null;
    const raw = str;
    let s = String(str).trim().replace(/#/g,'lb').toUpperCase();
    let m;
    m = s.match(/^(\d+)\s*(?:PC|PCS|EA|EACH)\s*\/\s*([\d.]+)\s*([A-Z]+)/i);
    if (m) return {count:parseFloat(m[1]),sizeEach:parseFloat(m[2]),unit:m[3].toLowerCase(),raw};
    m = s.match(/^(\d+)\s*\/\s*([\d.]+)\s*([A-Z]+)/);
    if (m) return {count:parseFloat(m[1]),sizeEach:parseFloat(m[2]),unit:m[3].toLowerCase(),raw};
    m = s.match(/^(\d+)-(\d+)\s*([A-Z]+)/);
    if (m) return {count:1,sizeEach:parseFloat(m[1]),sizeMax:parseFloat(m[2]),unit:m[3].toLowerCase(),raw};
    m = s.match(/^([\d.]+)\s*([A-Z]+)$/);
    if (m) return {count:1,sizeEach:parseFloat(m[1]),unit:m[2].toLowerCase(),raw};
    return null;
  }

  function cleanDescription(str) {
    return (str||'').replace(/\bUSA\b/gi,'').replace(/\s+/g,' ').trim();
  }

  function isSkipLine(line) {
    if (!line || line.trim().length < 3) return true;
    const l = line.trim().toUpperCase();
    return /^(QUANTITY|ORDERED|SHIPPED|ITEM CODE|DESCRIPTION|PACK|UNIT PRICE|EXTENDED|AMOUNT|ADJ|COOL|TERMS|SUBTOTAL|TAX|TOTAL|INVOICE|PAGE|ROUTE|CUSTOMER|BILL TO|SHIP TO|REMIT|PHONE|FAX|EMAIL|ORDER TAKER|ORDER DATE|DRIVER|SALESPERSON|INTEREST|PERISHABLE|COMMODITY|PACA|ADJUST|CREDIT CARD|SURCHARGE|WE WANT|HARDIE|DAIRYLAND|PROOF|DELIVERY WINDOW|DATE\/TRIP|CUSTOMER CODE|REPACKS|FULL CASES|WEIGHT|TOTAL PCS|NOTES|CREDIT CODES|RETURN REASON)/.test(l);
  }

  function isSubstitutionLine(line) { return /SUBSTITUTION/i.test(line); }

  function extractDocNumber(lines, keywords) {
    for (const line of lines) {
      for (const kw of keywords) {
        const m = line.match(new RegExp(kw + '\\s*[/#]?\\s*(\\d{5,10})','i'));
        if (m) return m[1];
      }
    }
    return null;
  }

  function extractDocDate(lines, keywords) {
    for (const line of lines) {
      for (const kw of keywords) {
        const m = line.match(new RegExp(kw + '[\\s:/]*([\\d]{1,2}/[\\d]{1,2}/[\\d]{2,4})','i'));
        if (m) return parseDate(m[1]);
      }
    }
    return null;
  }

  function inferPurchaseUnit(pack) {
    if (!pack) return null;
    const u = pack.unit;
    if (['ct','ea','each'].includes(u)) return 'each';
    if (['lb','lbs'].includes(u)) return 'lb';
    if (u === 'oz') return 'oz';
    return u || null;
  }

  // ── Hardie's order parser ──
  function parseHardiesOrder(rawText) {
    const warnings = [];
    const lines = rawText.split('\n').map(l => l.trim());
    const docNumber  = extractDocNumber(lines, ['INVOICE','CONFIRMATION']) || null;
    const orderDate  = extractDocDate(lines, ['DATE','ORDER DATE']) || null;
    let subtotal = null, tax = null, total = null;
    for (const line of lines) {
      let m;
      m = line.match(/SUBTOTAL\s+([\d,]+\.?\d*)/i); if (m) subtotal = parsePrice(m[1]);
      m = line.match(/^TAX(?:\/PCT\.?)?\s+\$([\d,.]+)/i); if (m) tax = parsePrice(m[1]);
      m = line.match(/INVOICE\s+\$([\d,]+\.?\d*)/i); if (m && !total) total = parsePrice(m[1]);
      m = line.match(/TOTAL\s+\$([\d,]+\.?\d*)/i); if (m && !total) total = parsePrice(m[1]);
    }
    const LINE_RE  = /^(\d+)\s+(\d{5})\s+(.+?)\s{2,}(.+?)\s{1,}(?:(USA|MEX|CAN|CHI|PER|COL|GUA|EC|NL)\s+)?([\d,.]+)\s+([\d,.]+)$/;
    const LINE_RE2 = /^(\d+)\s+(\d{5})\s+(.{8,})$/;
    const items = []; let nextSub = false; let prevSku = null;
    for (const line of lines) {
      if (isSkipLine(line)) continue;
      if (isSubstitutionLine(line)) { nextSub = true; continue; }
      let m = line.match(LINE_RE);
      if (m) {
        const [,qtyStr,sku,descRaw,packRaw,origin,upStr,amtStr] = m;
        const pack = parsePackSize(packRaw.trim());
        const desc = cleanDescription(descRaw.trim());
        const lw = [];
        if (nextSub) lw.push({code:'OQR-002',message:`Substitution: ${desc}`,field:'is_substitution'});
        if (pack && ['ct','ea','each'].includes(pack.unit)) lw.push({code:'OQR-006',message:`Count-based: ${desc} (${packRaw.trim()})`,field:'pack_unit'});
        items.push({vendor_sku:sku,raw_description:descRaw.trim(),description:desc,
          qty_ordered:parseFloat(qtyStr),qty_received:null,purchase_unit:inferPurchaseUnit(pack),
          pack_description:packRaw.trim(),pack_qty:pack?.count||null,pack_unit:pack?.unit||null,
          unit_price:parsePrice(upStr),amount:parsePrice(amtStr),
          is_substitution:nextSub,substituted_sku:nextSub?prevSku:null,origin:origin||null,warnings:lw});
        nextSub = false; prevSku = sku; continue;
      }
      m = line.match(LINE_RE2);
      if (m) {
        const [,qtyStr,sku,rest] = m;
        const pm = rest.match(/([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/);
        if (pm) {
          const rawDesc = rest.slice(0,rest.lastIndexOf(pm[0])).trim();
          const parts = rawDesc.split(/\s{2,}/);
          const packRaw = parts.length>1?parts[parts.length-1]:'';
          const pack = parsePackSize(packRaw);
          const desc = cleanDescription(parts.length>1?parts.slice(0,-1).join(' '):rawDesc);
          const lw = nextSub?[{code:'OQR-002',message:`Substitution: ${desc}`,field:'is_substitution'}]:[];
          if (pack&&['ct','ea','each'].includes(pack.unit)) lw.push({code:'OQR-006',message:`Count-based: ${desc}`,field:'pack_unit'});
          items.push({vendor_sku:sku,raw_description:rawDesc,description:desc,
            qty_ordered:parseFloat(qtyStr),qty_received:null,purchase_unit:inferPurchaseUnit(pack),
            pack_description:packRaw,pack_qty:pack?.count||null,pack_unit:pack?.unit||null,
            unit_price:parsePrice(pm[1]),amount:parsePrice(pm[2]),
            is_substitution:nextSub,substituted_sku:nextSub?prevSku:null,origin:null,warnings:lw});
          nextSub=false; prevSku=sku;
        }
      }
    }
    if (!items.length) warnings.push({code:'PARSE_ERROR',message:'No line items found'});
    return {vendor:"Hardie's Fresh Foods / Dairyland Produce",document_type:'order_confirmation',
      order_number:docNumber,order_date:orderDate,delivery_date:null,subtotal,tax,total,items,warnings};
  }

  // ── Hardie's invoice parser ──
  // SUBSTITUTION marker applies to PREVIOUS item, not next.
  function parseHardiesInvoice(rawText) {
    const warnings = [];
    const ls = rawText.split('\n').map(l=>l.trim());
    const docNumber = extractDocNumber(ls,['INVOICE/POD','INVOICE'])||null;
    const orderDate = extractDocDate(ls,['DATE/TRIP','ORDER DATE','DATE'])||null;
    let deliveryDate=null;
    for(const l of ls){const m=l.match(/DATE\/TRIP\s+([\d\/]+)/i);if(m){deliveryDate=parseDate(m[1]);break;}}
    let subtotal=null,tax=null,total=null;
    for(const l of ls){
      let m;
      m=l.match(/SUBTOTAL\s+([\d,]+\.?\d*)/i);if(m)subtotal=parsePrice(m[1]);
      m=l.match(/TAX\/PCT\.?\s+\$([\d,.]+)/i);if(m)tax=parsePrice(m[1]);
      m=l.match(/INVOICE\s+\$([\d,]+\.?\d*)/i);if(m&&!total)total=parsePrice(m[1]);
    }
    const LR  = /^(\d+)\s+(\d+)\s+(\d{5})\s+(.+?)\s{2,}(.+?)\s{1,}([\d,.]+)\s+([\d,.]+)(?:\s+.*)?$/;
    const LR2 = /^(\d+)\s+(\d+)\s+(\d{5})\s+(.{8,})$/;
    const items=[]; let prevSku=null;
    function push(sku,descRaw,packRaw,ord,shp,up,amt){
      const pack=parsePackSize(packRaw.trim());
      const desc=cleanDescription(descRaw.trim());
      const isSub=(ord===0&&shp>0);
      const lw=[];
      if(isSub)lw.push({code:'OQR-002',message:'Substitution: ordered 0, received '+shp+' of '+desc,field:'is_substitution'});
      if(ord!==shp)lw.push({code:'OQR-007',message:'Qty mismatch: ordered '+ord+', shipped '+shp+' of '+desc,field:'qty_received',possible_reasons:['Short shipped','Back ordered','Vendor error','Substitution']});
      if(pack&&['ct','ea','each'].includes(pack.unit))lw.push({code:'OQR-006',message:'Count-based: '+desc+' ('+packRaw.trim()+')',field:'pack_unit'});
      items.push({vendor_sku:sku,raw_description:descRaw.trim(),description:desc,
        qty_ordered:ord,qty_received:shp,purchase_unit:inferPurchaseUnit(pack),
        pack_description:packRaw.trim(),pack_qty:pack?pack.count:null,pack_unit:pack?pack.unit:null,
        pack_size_each:pack?pack.sizeEach:null,
        unit_price:up,amount:amt,
        is_substitution:isSub,substituted_sku:isSub?prevSku:null,origin:null,warnings:lw});
      prevSku=sku;
    }
    for(const line of ls){
      if(isSkipLine(line))continue;
      if(isSubstitutionLine(line)){
        if(items.length>0){
          const last=items[items.length-1];
          last.is_substitution=true;
          if(!last.substituted_sku){
            const p=items.slice(0,-1).reverse().find(i=>i.qty_received===0);
            last.substituted_sku=p?p.vendor_sku:null;
          }
          if(!last.warnings.some(w=>w.code==='OQR-002'))
            last.warnings.push({code:'OQR-002',message:'Substitution confirmed by marker',field:'is_substitution'});
        }
        continue;
      }
      let m=line.match(LR);
      if(m){const[,oS,sS,sku,dR,pR,uS,aS]=m;push(sku,dR,pR,parseFloat(oS),parseFloat(sS),parsePrice(uS),parsePrice(aS));continue;}
      m=line.match(LR2);
      if(m){
        const[,oS,sS,sku,rest]=m;
        const pm=rest.match(/([\d,]+\.\d{2})\s+([\d,]+\.\d{2})(?:\s+.*)?$/);
        if(pm){
          const rD=rest.slice(0,rest.lastIndexOf(pm[0])).trim();
          const pts=rD.split(/\s{2,}/);
          push(sku,pts.length>1?pts.slice(0,-1).join(' '):rD,pts.length>1?pts[pts.length-1]:'',
            parseFloat(oS),parseFloat(sS),parsePrice(pm[1]),parsePrice(pm[2]));
        }
      }
    }
    if(!items.length)warnings.push({code:'PARSE_ERROR',message:'No line items found'});
    return {vendor:"Hardie's Fresh Foods / Dairyland Produce",document_type:'invoice',
      order_number:docNumber,order_date:orderDate,delivery_date:deliveryDate,subtotal,tax,total,items,warnings};
  }

  // ── Hardie's credit parser ──
  function parseHardiesCredit(rawText) {
    const warnings=[];
    const lines=rawText.split('\n').map(l=>l.trim());
    const creditNumber=extractDocNumber(lines,['CREDIT'])||null;
    const creditDate=extractDocDate(lines,['DATE','ORDER DATE'])||null;
    let originalOrder=null;
    for(const l of lines){const m=l.match(/Original Sales Order[:\s]+([\d]+)/i);if(m){originalOrder=m[1];break;}}
    let total=null;
    for(const l of lines){const m=l.match(/TOTAL\s+\$(-?[\d,]+\.?\d*)/i);if(m){total=parsePrice(m[1]);break;}}
    const RC={'NN':'Do Not Need','SH':'Short on Truck','NO':'Did Not Order','OO':'Over Ordered','MS':'Mis-shipped','MK':'Mis-keyed','5A':'Quality/Other'};
    const LINE_RE=/^(\d+)\s+(\d{5})\s+(.+?)\s{2,}(.+?)\s{1,}(?:(USA|MEX|CAN|CHI)\s+)?([\d,.]+)\s+(-?[\d,.]+)\s+([A-Z0-9]{1,3})?.*$/;
    const LINE_RE2=/^(\d+)\s+(\d{5})\s+(.{8,})$/;
    const items=[];
    for(const line of lines){
      if(isSkipLine(line))continue;
      if(/Original Sales Order/i.test(line))continue;
      let m=line.match(LINE_RE);
      if(m){
        const[,qtyStr,sku,descRaw,packRaw,origin,upStr,amtStr,rc]=m;
        const pack=parsePackSize(packRaw.trim());
        items.push({vendor_sku:sku,raw_description:descRaw.trim(),description:cleanDescription(descRaw.trim()),
          qty_credited:parseFloat(qtyStr),purchase_unit:inferPurchaseUnit(pack),
          pack_description:packRaw.trim(),pack_qty:pack?.count||null,pack_unit:pack?.unit||null,
          unit_price:parsePrice(upStr),amount:parsePrice(amtStr),origin:origin||null,
          return_code:rc||null,return_reason:rc?(RC[rc.toUpperCase()]||rc):null,warnings:[]});
        continue;
      }
      m=line.match(LINE_RE2);
      if(m){
        const[,qtyStr,sku,rest]=m;
        const pm=rest.match(/([\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})(?:\s+([A-Z0-9]{1,3}))?$/);
        if(pm){
          const rawDesc=rest.slice(0,rest.lastIndexOf(pm[0])).trim();
          const parts=rawDesc.split(/\s{2,}/);
          const packRaw=parts.length>1?parts[parts.length-1]:'';
          const pack=parsePackSize(packRaw);
          const rc=pm[3]||null;
          items.push({vendor_sku:sku,raw_description:rawDesc,description:cleanDescription(parts.length>1?parts.slice(0,-1).join(' '):rawDesc),
            qty_credited:parseFloat(qtyStr),purchase_unit:inferPurchaseUnit(pack),
            pack_description:packRaw,pack_qty:pack?.count||null,pack_unit:pack?.unit||null,
            unit_price:parsePrice(pm[1]),amount:parsePrice(pm[2]),origin:null,
            return_code:rc,return_reason:rc?(RC[rc.toUpperCase()]||rc):null,warnings:[]});
        }
      }
    }
    if(!originalOrder)warnings.push({code:'OQR-001',message:'Credit memo has no original order reference',field:'original_order_number'});
    if(!items.length)warnings.push({code:'PARSE_ERROR',message:'No credit line items found'});
    return {vendor:"Hardie's Fresh Foods / Dairyland Produce",document_type:'credit_memo',
      credit_number:creditNumber,credit_date:creditDate,original_order_number:originalOrder,total,items,warnings};
  }

  // ── FreshPoint Dallas parser ──
  function parseFreshPointOrder(rawText) {
    const warnings = [];
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Reference number
    let refNumber = null;
    for (const line of lines) {
      const m = line.match(/Reference\s*#?\s*(\d{6,12})/i);
      if (m) { refNumber = m[1]; break; }
    }

    // Order date
    let orderDate = null;
    for (const line of lines) {
      const m = line.match(/Order Date[\/\s]Time[:\s]+([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i);
      if (m) { orderDate = parseDate(m[1]); break; }
    }

    // Delivery date
    let deliveryDate = null;
    for (const line of lines) {
      const m = line.match(/Delivery Date[:\s]+(?:\w+\s+)?([\d]{1,2}\/[\d]{1,2}\/[\d]{4})/i);
      if (m) { deliveryDate = parseDate(m[1]); break; }
    }

    // Total
    let total = null;
    for (const line of lines) {
      const m = line.match(/Total\s+([\d,]+\.\d{2})\s*$/i);
      if (m) { total = parsePrice(m[1]); break; }
    }

    // Line items
    // Format: ITEM#  PRODUCT DESCRIPTION  SIZE  QTY  PRICE  EXT.P
    // Example: 921068  LETTUCE ONECUT SPRING MIX TRUEMIX LOC TX  3/2# CS  1  33.95  33.95
    const LINE_RE = /^(\d{4,8})\s+(.+?)\s{2,}(.+?)\s{2,}(\d+)\s+([\d,.]+)\s+([\d,.]+)$/;
    // Fallback: item# then description ends before last 3 numbers
    const LINE_RE2 = /^(\d{4,8})\s+(.+?)\s+([\d,.]+)\s+([\d,.]+)\s*$/;

    const items = [];
    let inItems = false;

    for (const line of lines) {
      // Start parsing after header row
      if (/Item#.*Product.*Size.*Qty.*Price/i.test(line)) { inItems = true; continue; }
      // Stop at order summary
      if (/Order Summary|THANK YOU|This is not an invoice/i.test(line)) { inItems = false; continue; }
      if (!inItems) continue;

      let m = line.match(LINE_RE);
      if (m) {
        const [, sku, descRaw, sizeRaw, qtyStr, upStr, amtStr] = m;
        const pack = parsePackSize(sizeRaw.trim());
        const desc = cleanDescription(descRaw.trim());
        const lw = [];
        if (pack && ['ct','ea','each'].includes(pack.unit))
          lw.push({ code: 'OQR-006', message: `Count-based: ${desc} (${sizeRaw.trim()})`, field: 'pack_unit' });
        items.push({
          vendor_sku:       sku,
          raw_description:  descRaw.trim(),
          description:      desc,
          qty_ordered:      parseFloat(qtyStr),
          qty_received:     null,
          purchase_unit:    inferPurchaseUnit(pack),
          pack_description: sizeRaw.trim(),
          pack_qty:         pack ? pack.count    : null,
          pack_unit:        pack ? pack.unit     : null,
          pack_size_each:   pack ? pack.sizeEach : null,
          unit_price:       parsePrice(upStr),
          amount:           parsePrice(amtStr),
          is_substitution:  false,
          origin:           null,
          warnings:         lw,
        });
        continue;
      }

      // Fallback — line with just item# + description + price + ext
      m = line.match(LINE_RE2);
      if (m) {
        const [, sku, descRaw, upStr, amtStr] = m;
        const desc = cleanDescription(descRaw.trim());
        items.push({
          vendor_sku:       sku,
          raw_description:  descRaw.trim(),
          description:      desc,
          qty_ordered:      null,
          qty_received:     null,
          purchase_unit:    null,
          pack_description: null,
          pack_qty:         null,
          pack_unit:        null,
          pack_size_each:   null,
          unit_price:       parsePrice(upStr),
          amount:           parsePrice(amtStr),
          is_substitution:  false,
          origin:           null,
          warnings:         [{ code: 'OQR-008', message: `Could not parse size/qty for ${desc}`, field: 'pack_description' }],
        });
      }
    }

    if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });

    return {
      vendor:        'FreshPoint Dallas',
      document_type: 'order_confirmation',
      order_number:  refNumber,
      order_date:    orderDate,
      delivery_date: deliveryDate,
      subtotal:      total,
      tax:           null,
      total:         total,
      items,
      warnings,
    };
  }


  // ── Frugé Seafood Invoice Parser ──────────────────────────────
  // Format: PDF from system@netyield.com
  // Header: INVOICE 843487 / Taken 06/11/26 / Shipped 06/11/26 / Order 120948
  // Rows:   Ordered | Product Description | Shipped | Unit Price | Amount
  //         "8 LB   BRAFW8001000 - BRANZINI FR WHOLE 800-1000 1lb   8 LB  $11.25 LB  $90.00"
  // Total:  "Pay: $490.00"
  function parseFrugeInvoice(rawText) {
    // FRUGE PARSER v5
    // pack_description = peso reale in LB — cosi la UI calcola $/100g come Hardies
    // Es: "1 BG x 10 LB" -> pack_description = "10 LB"
    //     "1 GA x 8 LB"  -> pack_description = "8 LB"
    //     "7.85 LB"       -> pack_description = "7.85 LB"  (catchweight)
    //     "1 CA 5x2 LB"  -> pack_description = "10 LB"

    var invoiceNumber = null, invoiceDate = null, total = null;
    var invM = rawText.match(/INVOICE\s+(\d+)/i);           if (invM) invoiceNumber = invM[1];
    var takM = rawText.match(/Taken\s+([\d\/]+)/i);          if (takM) invoiceDate = parseDate(takM[1]);
    var payM = rawText.match(/Pay:\s*\$?([\d,]+\.\d{2})/i);  if (payM) total = parseFloat(payM[1].replace(/,/g, ''));

    var lines = rawText.split('\n').map(function(l) { return l.trim(); });
    var items = [];
    var warnings = [];

    var LINE_RE = /^\s*\d+(?:\.\d+)?\s+(LB|BG|GA|GAL|CA|CS|EA)\s+([A-Z0-9]{6,16})\s*[-\u2013]\s*(.+?)\s+(\d+(?:\.\d+)?)\s+(LB|BG|GA|GAL|CA|CS|EA)\s+\$?([\d,]+\.\d{2})\s+(?:LB|BG|GA|GAL|CA|CS|EA)\s+\$?([\d,]+\.\d{2})/i;

    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(LINE_RE);
      if (!m) continue;

      var sku       = m[2];
      var descRaw   = m[3].trim();
      var shpQty    = parseFloat(m[4]);
      var shpUnit   = m[5].toUpperCase();
      var unitPrice = parseFloat(m[6].replace(/,/g, ''));
      var amount    = parseFloat(m[7].replace(/,/g, ''));

      var totalLb = null;

      if (shpUnit === 'LB') {
        // TIPO 1: catchweight — shipped e gia in LB
        totalLb = shpQty;

      } else if (shpUnit === 'BG' || shpUnit === 'GA' || shpUnit === 'GAL') {
        // TIPO 2: cerca peso lb nella descrizione o righe successive
        var wm = descRaw.match(/(\d+(?:\.\d+)?)\s*lb\b/i);
        if (wm) {
          totalLb = shpQty * parseFloat(wm[1]);
        } else {
          for (var j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            var nxt = lines[j].trim();
            if (LINE_RE.test(nxt)) break;
            var wm2 = nxt.match(/(\d+(?:\.\d+)?)\s*lb\b/i);
            if (wm2) { totalLb = shpQty * parseFloat(wm2[1]); break; }
          }
        }

      } else if (shpUnit === 'CA' || shpUnit === 'CS') {
        // TIPO 3: moltiplicazione NxN
        var mxm = descRaw.match(/(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:LBS?|lb)/i);
        if (!mxm) {
          for (var k = i + 1; k < Math.min(i + 4, lines.length); k++) {
            var nxt2 = lines[k].trim();
            if (LINE_RE.test(nxt2)) break;
            mxm = nxt2.match(/(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:LBS?|lb)/i);
            if (mxm) break;
          }
        }
        if (mxm) {
          totalLb = shpQty * parseFloat(mxm[1]) * parseFloat(mxm[2]);
        }
      }

      // pack_description = peso totale in LB — la UI lo usa per calcolare $/100g
      var packDesc = totalLb ? (parseFloat(totalLb.toFixed(2)) + ' LB') : (shpQty + ' ' + shpUnit);

      var costPerLb  = totalLb ? (amount / totalLb) : null;
      var cost100g   = costPerLb ? parseFloat(((costPerLb / 453.592) * 100).toFixed(4)) : null;

      var desc = descRaw
        .replace(/\d+(?:\.\d+)?\s*lb\b/gi, '')
        .replace(/GALLON/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      items.push({
        vendor_sku:       sku,
        description:      desc,
        raw_description:  descRaw,
        qty_ordered:      null,
        qty_received:     shpQty,
        received_unit:    shpUnit,
        pack_description: packDesc,
        total_weight_lb:  totalLb ? parseFloat(totalLb.toFixed(4)) : null,
        unit_price:       unitPrice,
        amount:           amount,
        cost_per_lb:      costPerLb ? parseFloat(costPerLb.toFixed(4)) : null,
        _cost_per_100g:   cost100g,
        price_type:       'per_lb',
        catchweight:      shpUnit === 'LB',
        warnings:         [],
      });
    }

    if (items.length === 0) {
      console.log('[FRUGE v5] NO ITEMS. Lines:', lines.slice(0, 20).join(' || '));
      warnings.push({ code: 'NO_ITEMS', message: 'No line items parsed from Fruge invoice' });
    } else {
      console.log('[FRUGE v5] OK -', items.length, 'items');
    }

    return {
      vendor:          'Fruge Seafood',
      document_type:   'invoice',
      document_number: invoiceNumber,
      document_date:   invoiceDate,
      subtotal:        total,
      total:           total,
      items:           items,
      warnings:        warnings,
    };
  }

  // ── Ben E. Keith invoice parser ──────────────────────────────
  // FIX (BOH OS Task 9): ported from js/vendor-parsers/bek-invoice.js
  // (Node-only, never reachable from the browser — see Task 8 audit).
  // Logic, regex and field names kept as close to the original as possible;
  // only renamed (bekParseLine/bekPackToGrams) to avoid clashing with other
  // vendor sections in this shared closure. Reuses the parseDate/parsePrice
  // already defined above in this function — not redefined.
  //
  // Formato colonne originale:
  // Location(SKU) | Cases(Qty) | Pkgs | Item# | Brand | MfgCode | PackSize | Description | UnitPrice | Amount
  const BEK_SKIP_RE = /ben e\.? keith|invoice|sold to|ship to|customer|route|terms|due|section total|description\s+promo|^cases\s+pkg|please check|cash\/ck|amt paid|total invoice|continued|^this page|tax\b|^dry$|^frozen$/i;

  function bekPackToGrams(packStr) {
    if (!packStr) return null;
    const s = packStr.trim().toUpperCase().replace(/\s+/g, ' ');

    const fracM = s.match(/^(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|ML|L|KG|G)\s*$/);
    if (fracM) {
      const count = parseFloat(fracM[1]);
      const size  = parseFloat(fracM[2]);
      const unit  = fracM[3];
      if (unit === 'LB' || unit === 'LBS' || unit === '#') return count * size * 453.592;
      if (unit === 'OZ') return count * size * 28.3495;
      if (unit === 'GAL') return count * size * 3785.41;
      if (unit === 'ML') return count * size;
      if (unit === 'L') return count * size * 1000;
      if (unit === 'KG') return count * size * 1000;
      if (unit === 'G') return count * size;
    }

    const rangeM = s.match(/^(\d+)\s*\/\s*(\d+)-(\d+)\s*(LB|OZ|#)\s*$/);
    if (rangeM) {
      const count = parseFloat(rangeM[1]);
      const avg   = (parseFloat(rangeM[2]) + parseFloat(rangeM[3])) / 2;
      const unit  = rangeM[4];
      if (unit === 'LB' || unit === '#') return count * avg * 453.592;
      if (unit === 'OZ') return count * avg * 28.3495;
    }

    const simpleM = s.match(/^(\d+(?:\.\d+)?)\s*(LB|LBS|#|OZ|GAL|KG|G|ML|L)\s*$/);
    if (simpleM) {
      const size = parseFloat(simpleM[1]);
      const unit = simpleM[2];
      if (unit === 'LB' || unit === 'LBS' || unit === '#') return size * 453.592;
      if (unit === 'OZ') return size * 28.3495;
      if (unit === 'GAL') return size * 3785.41;
      if (unit === 'KG') return size * 1000;
      if (unit === 'G') return size;
      if (unit === 'ML') return size;
      if (unit === 'L') return size * 1000;
    }

    return null; // CT, EA, ecc. — conta, nessun peso
  }

  // Formato riga BEK:
  // DW07311  1  1  108509  MR CLEAN  1003700002621  3/1 GAL  Cleaner Floor & All Purpose  54.33  54.33
  function bekParseLine(line) {
    line = line.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();

    const amountM = line.match(/\$?([\d,]+\.\d{2})\s*$/);
    if (!amountM) return null;
    const amount = parsePrice(amountM[1]);

    const beforeAmount = line.slice(0, line.lastIndexOf(amountM[0])).trim();

    const priceM = beforeAmount.match(/\$?([\d,]+\.\d{2})\s*$/);
    if (!priceM) return null;
    const unitPrice = parsePrice(priceM[1]);
    if (!unitPrice) return null;

    const beforePrice = beforeAmount.slice(0, beforeAmount.lastIndexOf(priceM[0])).trim();

    const tokens = beforePrice.split(/\s+/);
    if (tokens.length < 5) return null;

    const sku = tokens[0];
    const qty = parseInt(tokens[1]) || 1;

    let packSize = null, descStart = -1;
    for (let i = 3; i < tokens.length; i++) {
      const chunk2 = tokens[i] + (tokens[i+1] ? ' ' + tokens[i+1] : '');
      const chunk1 = tokens[i];
      if (/^\d+\/\d+$/.test(chunk1) && tokens[i+1] && /^(GAL|LB|LBS|OZ|CT|ML|L|KG|G|#)$/i.test(tokens[i+1])) {
        packSize = chunk2;
        descStart = i + 2;
        break;
      }
      if (/^\d+\/\d+-\d+$/.test(chunk1) && tokens[i+1] && /^(OZ|LB|#)$/i.test(tokens[i+1])) {
        packSize = chunk2;
        descStart = i + 2;
        break;
      }
      if (/^\d+\/\d+(?:\.\d+)?(GAL|LB|OZ|ML|CT|KG|G|#)$/i.test(chunk1)) {
        packSize = chunk1;
        descStart = i + 1;
        break;
      }
    }

    if (descStart === -1 || descStart >= tokens.length) return null;

    const descRaw = tokens.slice(descStart).join(' ').trim();
    if (!descRaw || descRaw.length < 3) return null;

    if (/cleaner|floor|sanitiz|chemical|glove|bag|container|wrap|film|towel/i.test(descRaw)) {
      return null; // Skip non-food items
    }

    const desc   = cleanDescription(descRaw);
    const totalG = bekPackToGrams(packSize);
    const p100   = (totalG && unitPrice) ? parseFloat(((unitPrice / totalG) * 100).toFixed(4)) : null;

    const itemWarnings = [];
    if (!totalG && packSize && !/ct|ea|each|dz/i.test(packSize)) {
      itemWarnings.push({
        code: 'OQR-006',
        message: `Pack size "${packSize}" — peso non calcolabile per ${desc}`,
        field: 'pack_unit',
      });
    }

    return {
      vendor_sku:         sku,
      raw_description:    descRaw,
      description:        desc,
      qty_ordered:        qty,
      qty_received:       qty,
      pack_description:   packSize,
      unit_price:         unitPrice,
      amount:             amount,
      extended_price:     amount,
      price_type:         'per_case',
      conversion_to_base: totalG ? Math.round(totalG) : null,
      _cost_per_100g:     p100,
      catchweight:        false,
      warnings:           itemWarnings,
    };
  }

  function parseBekInvoice(rawText) {
    const text  = String(rawText || '');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    let invoiceNumber = null, invoiceDate = null, total = null;
    for (const line of lines) {
      let m;
      m = line.match(/Invoice\s*#?\s*:?\s*(\d+)/i);        if (m) invoiceNumber = m[1];
      m = line.match(/(?:Invoice|Order)\s+Date\s*:?\s*([\d\/]+)/i); if (m) invoiceDate = parseDate(m[1]);
      m = line.match(/Total\s+Invoice\s+([\d,]+\.\d{2})/i); if (m) total = parsePrice(m[1]);
    }

    const items = [];
    for (const line of lines) {
      if (BEK_SKIP_RE.test(line)) continue;
      if (line.length < 20) continue;
      const item = bekParseLine(line);
      if (item && item.unit_price) items.push(item);
    }

    return {
      vendor:         'Ben E. Keith',
      document_type:  'invoice',
      document_number: invoiceNumber,
      document_date:   invoiceDate,
      subtotal:       null,
      total,
      items,
      warnings: [],
    };
  }

  // ── Ben E. Keith Order Confirmation (email body, no PDF) ─────
  // FIX (BOH OS Task 10). Real Ben E. Keith "Order Confirmation" emails carry
  // no attachment — every field lives in the plain-text body, one multi-line
  // block per item (item#, name, brand, pack, price, ORDERED n, CONFIRMED n,
  // status), not the single-line table rows bek-invoice.js/parseBekInvoice
  // expect. No Node source of truth existed for this shape (see Task 8/9
  // audit — bek-invoice.js only ever produced document_type:'invoice'), so
  // this is new, following the same one-parser-per-document-type pattern
  // already used for Hardie's (parseHardiesOrder vs parseHardiesInvoice).
  // Reuses parseDate/parsePrice/cleanDescription already defined above.
  function parseBekOrderConfirmationEmail(rawText) {
    const text = String(rawText || '');
    const lines = text.split('\n').map(l => l.trim());
    const nonEmpty = lines.filter(l => l.length > 0);

    // Sales Order # — kept as a string, leading zeros preserved (never Number()).
    // FIX (BOH OS Task 11B, STEP 3): "#" made optional and an optional colon
    // added — mirrors the same defensive shape already used for Invoice
    // numbers in parseBekInvoice() (/Invoice\s*#?\s*:?\s*(\d+)/i) — plus
    // zero-width/invisible characters stripped first, since \s alone does not
    // match U+200B (confirmed empirically; \s already covers NBSP/CRLF/tabs).
    let salesOrder = null;
    const cleanText = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
    const soM = cleanText.match(/Sales\s*Order\s*#?\s*:?\s*(\d+)/i);
    if (soM) salesOrder = soM[1];

    let deliveryDate = null;
    const ddM = text.match(/Delivery\s*Date\s*:?\s*([\d\/]+)/i);
    if (ddM) deliveryDate = parseDate(ddM[1]);

    let orderTotal = null;
    const otM = text.match(/Order\s*Total\s*:?\s*\$?([\d,]+\.\d{2})/i);
    if (otM) orderTotal = parsePrice(otM[1]);

    // Items: scan for a bare item-code line (4-8 digits), then read the fixed
    // block of lines that follows it (description, brand, pack, price,
    // ORDERED n, CONFIRMED n, status) — matching the real format in the
    // task's sample email body.
    const items = [];
    for (let i = 0; i < nonEmpty.length; i++) {
      const line = nonEmpty[i];
      if (!/^\d{4,8}$/.test(line)) continue;

      const chunk = nonEmpty.slice(i, i + 8);
      const orderedIdx   = chunk.findIndex(l => /^ORDERED\s+(\d+)/i.test(l));
      const confirmedIdx = chunk.findIndex(l => /^CONFIRMED\s+(\d+)/i.test(l));
      if (orderedIdx === -1 || confirmedIdx === -1) continue; // not really an item block

      const description = chunk[1] || null;
      const brand        = chunk[2] || null;
      const packLine      = chunk[3] || null;
      const priceLine      = chunk[4] || '';
      const orderedM   = chunk[orderedIdx].match(/ORDERED\s+(\d+)/i);
      const confirmedM = chunk[confirmedIdx].match(/CONFIRMED\s+(\d+)/i);
      const statusLine  = chunk[confirmedIdx + 1] || null;

      const priceM = priceLine.match(/\$?([\d,]+\.\d{2})/);
      const unitPrice = priceM ? parsePrice(priceM[1]) : null;
      const ordered   = orderedM   ? parseInt(orderedM[1], 10)   : null;
      // FIX (BOH OS Task 10, STEP 7): ordered vs confirmed preserved using the
      // same qty_ordered/qty_received field names already used everywhere
      // else in this codebase (e.g. Hardie's OQR-007 qty-mismatch logic) —
      // no new field names introduced.
      const confirmed = confirmedM ? parseInt(confirmedM[1], 10) : null;

      items.push({
        vendor_sku:         line,
        raw_description:    description,
        description:        cleanDescription(description || ''),
        brand:               brand,
        pack_description:   packLine,
        unit_price:         unitPrice,
        qty_ordered:        ordered,
        qty_received:       confirmed,
        status:              statusLine,
        price_type:          'per_case',
        amount:              (unitPrice != null && confirmed != null) ? parseFloat((unitPrice * confirmed).toFixed(2)) : null,
        warnings:            [],
      });
    }

    return {
      vendor:          'Ben E. Keith',
      document_type:   'order_confirmation',
      document_number: salesOrder,
      document_date:   deliveryDate,
      // FIX (BOH OS Task 11L): vdrProcessAllPdf's docDate fallback chain
      // (js/vendor-documents-review.js) checks order_date/credit_date/
      // delivery_date — never document_date — and the DB delivery_date
      // column is populated straight from parsed.delivery_date. BEK has one
      // meaningful date (Delivery Date), so the same value is used for both
      // keys, matching how other order_confirmation-type parsers in this
      // file already provide both. No downstream change needed: this is the
      // key vdrProcessAllPdf's existing logic already reads.
      delivery_date:   deliveryDate,
      subtotal:        null,
      total:           orderTotal,
      items,
      warnings: [],
    };
  }

  // ── Ben E. Keith Order Confirmation (real HTML, msg.getBody()) ────
  // FIX (BOH OS Task 11F). getPlainBody() (Task 10) was confirmed against
  // real production data (Task 11E) to degrade the email: Sales Order/dates/
  // totals come out wrapped in stray asterisks, and — critically — the item
  // table rows are stripped entirely, leaving only the column headers. The
  // real MIME/HTML (msg.getBody()) still has the actual <table> rows.
  // Uses DOMParser (browser-native) instead of regex to strip/read HTML, as
  // requested — entities (&apos; etc.) are decoded for free via .textContent.
  function parseBekOrderConfirmationHtml(rawHtml) {
    const html = String(rawHtml || '');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bodyText = doc.body ? (doc.body.textContent || '') : '';

    // Header fields — same tolerant regex as the plain-body parser, run on
    // the DOM's decoded textContent (inline tags collapse away, entities are
    // already resolved).
    let salesOrder = null;
    const soM = bodyText.match(/Sales\s*Order\s*#?\s*:?\s*(\d+)/i);
    if (soM) salesOrder = soM[1];

    let deliveryDate = null;
    const ddM = bodyText.match(/Delivery\s*Date\s*:?\s*([\d\/]+)/i);
    if (ddM) deliveryDate = parseDate(ddM[1]);

    let orderTotal = null;
    // FIX (BOH OS Task 11H, Bug 2): the real production label is literally
    // "Order Total*" — a footnote marker ("*This is your order total without
    // taxes...") that's part of the actual text, not a bold-conversion
    // artifact. "*" made optional here so "Order Total", "Order Total*",
    // "Order Total:" and "Order Total*:" all match. Scoped to this HTML
    // parser only — parseBekOrderConfirmationEmail (plain-body path) is
    // untouched, per task scope.
    const otM = bodyText.match(/Order\s*Total\s*\*?\s*:?\s*\$?([\d,]+\.\d{2})/i);
    if (otM) orderTotal = parsePrice(otM[1]);

    // Items — read the actual HTML table rows (ITEM# / ITEM NAME / BRAND /
    // PACK/SIZE / PRICE / ORDERED / CONFIRMED / STATUS), not regex on
    // flattened text. Header rows use <th>, so a row with <8 <td> cells is
    // skipped naturally; a first-cell check guards against any other
    // non-item row shape.
    const items = [];
    const rows = doc.querySelectorAll('table tr');
    for (const row of rows) {
      // FIX (BOH OS Task 11H, Bug 1): direct children only — NOT a recursive
      // descendant selector. The real PRICE cell contains its own nested
      // <table> ("$40.98" / "per case" on separate rows); querySelectorAll('td')
      // matched those nested cells too (10 td found instead of 8), shifting
      // ORDERED/CONFIRMED/STATUS onto the wrong values. row.children already
      // stops at the row's own <td> cells — the nested table's text still
      // ends up inside that cell's own .textContent ("$40.98 per case"),
      // which unitPrice's regex below already handles.
      const cells = Array.from(row.children)
        .filter(el => el.tagName === 'TD')
        .map(td => (td.textContent || '').trim());
      if (cells.length < 8) continue;
      const [itemCode, descRaw, brand, pack, priceRaw, orderedRaw, confirmedRaw, status] = cells;
      if (!/^\d{4,8}$/.test(itemCode)) continue;

      const priceM = priceRaw.match(/\$?([\d,]+\.\d{2})/);
      const unitPrice = priceM ? parsePrice(priceM[1]) : null;
      const orderedN   = parseInt(orderedRaw, 10);
      const confirmedN = parseInt(confirmedRaw, 10);
      const ordered   = isNaN(orderedN)   ? null : orderedN;
      // FIX (Task 11F, T6): ordered and confirmed kept as two distinct
      // fields (qty_ordered/qty_received — same convention used everywhere
      // else in this codebase) even when they differ.
      const confirmed = isNaN(confirmedN) ? null : confirmedN;

      items.push({
        vendor_sku:         itemCode,
        raw_description:    descRaw,
        description:        cleanDescription(descRaw),
        brand:               brand,
        pack_description:   pack,
        unit_price:         unitPrice,
        qty_ordered:        ordered,
        qty_received:       confirmed,
        status:              status,
        price_type:          'per_case',
        amount:              (unitPrice != null && confirmed != null) ? parseFloat((unitPrice * confirmed).toFixed(2)) : null,
        warnings:            [],
      });
    }

    return {
      vendor:          'Ben E. Keith',
      document_type:   'order_confirmation',
      document_number: salesOrder,
      document_date:   deliveryDate,
      // FIX (BOH OS Task 11L): same fix as parseBekOrderConfirmationEmail
      // above — vdrProcessAllPdf's docDate fallback and the DB delivery_date
      // column never read document_date. BEK has one meaningful date, used
      // for both keys here.
      delivery_date:   deliveryDate,
      subtotal:        null,
      total:           orderTotal,
      items,
      warnings: [],
    };
  }

  // ── Walmart Business / TreviPay invoice parser ────────────────
  // Ported from js/vendor-parsers/walmart-trevipay-invoice.js (commit
  // aef7b5a) — same regexes, same algorithm, same field names. That
  // Node version is never actually loaded by the browser (no require()
  // here), so this is the real implementation used by vdrProcessAllPdf.
  // Any future fix to the parsing logic must land in BOTH places (see
  // tests/walmart-trevipay-parser-parity.test.js, same convention as
  // tests/bek-parser-parity.test.js for Ben E. Keith).
  //
  // Input contract: receives text already normalized by the TreviPay
  // preprocessing in vendor-documents-review.js (commit 8325ed5) — PUA
  // digit/decimal/minus decoding and gap-aware column joins already
  // applied. Does NOT re-implement any of that here.
  function walmartFirstMatch(text, re) {
    var m = text.match(re);
    return m ? m[1].trim() : null;
  }

  // "Buyer" the label and its value never sit on the same output line —
  // the Bill-To address block's line count varies relative to the
  // Buyer/Seller block, so by the time both reach the same PDF row, the
  // merge always lands on the Bill-To address's own "United States"
  // line (confirmed identical in all 4 real samples). A bare "United
  // States" line (the Seller's own address, further down) has nothing
  // after it, so requiring trailing content here is what keeps this
  // from ever matching the Seller's country line instead.
  //
  // FIX (empty-Buyer parity task): the gap must be horizontal
  // whitespace only ([ \t]+), never \s+ — \s matches newlines too, so a
  // genuinely blank Buyer field (nothing after "United States" on its
  // own line) let \s+ walk forward across the line break and grab
  // whatever non-blank text came next (e.g. "Seller") instead of
  // failing to match. Ported identically from
  // js/vendor-parsers/walmart-trevipay-invoice.js.
  function walmartExtractBuyer(text) {
    return walmartFirstMatch(text, /United States[ \t]+(\S.+)$/m);
  }

  function walmartValueAfterLabel(lines, label) {
    for (var i = 0; i < lines.length - 1; i++) {
      if (lines[i].trim() === label) return lines[i + 1].trim();
    }
    return null;
  }

  function walmartExtractHeader(text, lines) {
    var documentNumber =
      walmartFirstMatch(text, /Please Reference Invoice\s+(\S+)\s*\|/i) ||
      walmartFirstMatch(text, /Invoice\s+(\S+)\s+(?:How To Pay|Invoice Summary)/i);

    var invoiceDate = parseDate(walmartValueAfterLabel(lines, 'Invoice Date'));
    var dueDate     = parseDate(walmartValueAfterLabel(lines, 'Due Date'));
    var seller      = walmartValueAfterLabel(lines, 'Seller') || 'Walmart Business';
    var buyer       = walmartExtractBuyer(text);

    // "Order Number PO Number" is the label row; its value row is two
    // whitespace-separated tokens ("-" means no PO number on this invoice).
    var walmartOrderNumber = null;
    var poNumber = null;
    var labelIdx = -1;
    for (var li = 0; li < lines.length; li++) {
      if (/^Order Number\s+PO Number$/.test(lines[li].trim())) { labelIdx = li; break; }
    }
    if (labelIdx > -1 && lines[labelIdx + 1]) {
      var valueLine = lines[labelIdx + 1].trim();
      var m = valueLine.match(/^(\S+)\s+(\S+)$/);
      if (m) {
        walmartOrderNumber = m[1];
        poNumber = m[2] === '-' ? null : m[2];
      } else {
        walmartOrderNumber = valueLine || null;
      }
    }

    var subtotal = parsePrice(walmartFirstMatch(text, /Pre-Tax Subtotal\s+\$(-?[\d,.]+)/i));
    var tax      = parsePrice(walmartFirstMatch(text, /Taxes Subtotal\s+\$(-?[\d,.]+)/i));
    var total    = parsePrice(walmartFirstMatch(text, /Total Due as of\s+[\d/]+\s+\$(-?[\d,.]+)/i));

    return { documentNumber: documentNumber, invoiceDate: invoiceDate, dueDate: dueDate, seller: seller, buyer: buyer, walmartOrderNumber: walmartOrderNumber, poNumber: poNumber, subtotal: subtotal, tax: tax, total: total };
  }

  var WALMART_HEADER_ROW_RE  = /^SKU\s+Description\s+Quantity/;
  var WALMART_SUMMARY_ROW_RE = /Invoice Summary/;
  // A wrapped SKU continuation is a line containing ONLY digits, nothing
  // else — real example: "1350811700" then, alone on the next physical
  // line, "5". Bounded to 1–4 digits (the only real example is 1 digit;
  // this leaves headroom without being loose enough to ever swallow a
  // genuine 5+ digit SKU that starts its own row) and only merges into a
  // row whose own SKU is itself purely numeric (never onto a Shipping/
  // ALT_PAYMENT_METHODS row, whose SKU is text) and only up to a sane
  // total reconstructed length — real UPC/EAN-style codes top out at 13
  // digits, so 14 is used as a hard ceiling.
  var WALMART_SKU_FRAGMENT_RE = /^\d{1,4}$/;
  var WALMART_MAX_RECONSTRUCTED_SKU_LEN = 14;

  function walmartIsSkuFragmentContinuation(line, currentItem) {
    if (!WALMART_SKU_FRAGMENT_RE.test(line)) return false;
    if (!currentItem || currentItem.line_type !== 'product') return false;
    if (!/^\d+$/.test(currentItem.vendor_sku)) return false;
    return (currentItem.vendor_sku.length + line.length) <= WALMART_MAX_RECONSTRUCTED_SKU_LEN;
  }

  // Trailing numeric columns. The optional "Tax Details" column only
  // ever contributes its percentage (e.g. "0.0824%") to the FIRST
  // continuation line, never to the row-start line itself — confirmed
  // real in 6c246fda/12fd6860: the row-start line only ever contains
  // "...Tax1" followed directly by the SAME dollar amount twice (once
  // for the Tax Details column's own dollar sub-total, once for the
  // aggregate Tax column) and then Billed Total. The percentage is
  // picked up separately, from the continuation line, below.
  //
  // Every dollar column captures its sign SEPARATELY from its magnitude
  // (real data prints negative amounts as "-$21.26" — minus before the
  // dollar sign, e.g. the ALT_PAYMENT_METHODS adjustment — not "$-21.26").
  var WALMART_SIGNED_MONEY = '(-?)\\$([\\d,.]+)';
  var WALMART_TAIL_WITH_TAXDETAIL = new RegExp(
    '^(.*?)\\s+(\\d+)\\s+' + WALMART_SIGNED_MONEY + '\\s+' + WALMART_SIGNED_MONEY +
    '\\s+Tax1\\s+' + WALMART_SIGNED_MONEY + '\\s+' + WALMART_SIGNED_MONEY + '\\s+' + WALMART_SIGNED_MONEY + '\\s*$'
  );
  var WALMART_TAIL_PLAIN = new RegExp(
    '^(.*?)\\s+(\\d+)\\s+' + WALMART_SIGNED_MONEY + '\\s+' + WALMART_SIGNED_MONEY +
    '\\s+' + WALMART_SIGNED_MONEY + '\\s+' + WALMART_SIGNED_MONEY + '\\s*$'
  );

  function walmartSignedPrice(sign, magnitude) {
    var n = parsePrice(magnitude);
    return n === null ? null : (sign === '-' ? -n : n);
  }

  function walmartParseRowStart(line) {
    var m = line.match(WALMART_TAIL_WITH_TAXDETAIL);
    var hasTaxDetail = false;
    if (m) {
      hasTaxDetail = true;
    } else {
      m = line.match(WALMART_TAIL_PLAIN);
    }
    if (!m) return null;

    var skuAndDesc = m[1].trim();
    var qty        = parseInt(m[2], 10);
    var unitPrice, discount, tax, amount;
    if (hasTaxDetail) {
      // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount,
      // 7/8 tax-detail-dup (unused), 9/10 tax, 11/12 billed_total
      unitPrice = walmartSignedPrice(m[3], m[4]);
      discount  = walmartSignedPrice(m[5], m[6]);
      tax       = walmartSignedPrice(m[9], m[10]);
      amount    = walmartSignedPrice(m[11], m[12]);
    } else {
      // groups: 1 desc, 2 qty, 3/4 unit_price, 5/6 discount, 7/8 tax, 9/10 billed_total
      unitPrice = walmartSignedPrice(m[3], m[4]);
      discount  = walmartSignedPrice(m[5], m[6]);
      tax       = walmartSignedPrice(m[7], m[8]);
      amount    = walmartSignedPrice(m[9], m[10]);
    }

    // Known non-product placeholder rows (same real-template convention as
    // Shipping/ALT_PAYMENT_METHODS above), confirmed real in invoice
    // 26104552: an Express Fee (HANDLING) and, appearing multiple times,
    // a SubDown/FULFILL_VARIANCE fulfillment-substitution charge. Checked
    // against the FULL skuAndDesc blob, not the generic single-token split
    // below — unlike "Shipping" or "ALT_PAYME", their SKU-column
    // placeholder is itself multi-word ("Express Fee"), so splitting on
    // the first space alone would wrongly cut it as "Express" + "Fee
    // HANDLING". Before this fix, neither shape matched any recognised
    // row-start, so both fell through to continuation handling and were
    // silently absorbed into the PRECEDING product row's description —
    // losing $1.93/$10.29/$14.65 as structured line items and corrupting
    // that product's own description (confirmed against the real PDF).
    // Ported identically from js/vendor-parsers/walmart-trevipay-invoice.js.
    var handlingMatch = skuAndDesc.match(/^(Express\s+Fee)\s+(HANDLING)$/i);
    var fulfillVarianceMatch = skuAndDesc.match(/^(SubDown)\s+(FULFILL_VARIANCE)$/i);

    var lineType, vendorSku, description;
    if (handlingMatch) {
      lineType = 'handling';
      vendorSku = handlingMatch[1];
      description = handlingMatch[2];
    } else if (fulfillVarianceMatch) {
      lineType = 'fulfillment_variance';
      vendorSku = fulfillVarianceMatch[1];
      description = fulfillVarianceMatch[2];
    } else {
      var tokenMatch = skuAndDesc.match(/^(\S+)\s+(.*)$/);
      if (!tokenMatch) return null;
      var leadToken  = tokenMatch[1];
      var descFirst  = tokenMatch[2].trim();

      lineType = 'product';
      vendorSku = leadToken;
      description = descFirst;

      if (/^shipping$/i.test(leadToken)) {
        lineType = 'shipping';
      } else if (/^ALT_PAYME/i.test(leadToken)) {
        // The SKU-column text for this row wraps across several short
        // fragments across multiple lines; only the stable lead fragment
        // is used for detection. Reconstructing the exact wrapped
        // spelling is not attempted — a fixed canonical label is used
        // instead, since it is always this same placeholder text.
        lineType = 'adjustment';
        vendorSku = 'ALT_PAYMENT_METHODS';
        description = 'Alternative Payment Methods';
      } else if (!/^\d{5,}$/.test(leadToken)) {
        // Not a recognised row-start shape at all (neither a 5+ digit SKU,
        // Shipping, the adjustment placeholder, nor Handling/Fulfillment
        // Variance) — reject so the caller falls through to continuation
        // handling instead of misfiling unrelated text as a new product row.
        return null;
      }
    }

    return {
      vendor_sku:       vendorSku,
      raw_description:  description,
      description:      description,
      qty_ordered:      qty,
      qty_received:     qty,
      qty:              qty,
      unit_price:       unitPrice,
      discount:         discount || 0,
      tax:              tax || 0,
      tax_rate:         null,
      amount:           amount,
      line_total:       amount,
      line_type:        lineType,
      warnings:         [],
      // Adjustment row's SKU-column wrap fragments ("NT_METHO Methods",
      // "DS") are swallowed, never appended to description.
      _swallowContinuation: lineType === 'adjustment',
      _descParts: [description],
    };
  }

  function walmartFinalizeItem(item) {
    if (!item._swallowContinuation && item._descParts.length > 1) {
      item.raw_description = cleanDescription(item._descParts.join(' '));
      item.description = item.raw_description;
    }
    delete item._descParts;
    delete item._swallowContinuation;
    return item;
  }

  function walmartExtractItems(lines) {
    var items = [];
    var current = null;
    var inTable = false;

    for (var li2 = 0; li2 < lines.length; li2++) {
      var line = lines[li2].trim();
      if (!line) continue;

      if (WALMART_HEADER_ROW_RE.test(line)) {
        // Re-entering table mode is safe even if we were already in it
        // (a document whose table spans multiple PDF pages repeats
        // this header once per page — confirmed real in 30082536).
        inTable = true;
        continue;
      }
      if (!inTable) continue;
      if (WALMART_SUMMARY_ROW_RE.test(line)) {
        inTable = false;
        continue;
      }

      if (walmartIsSkuFragmentContinuation(line, current)) {
        current.vendor_sku += line;
        continue;
      }

      var rowStart = walmartParseRowStart(line);
      if (rowStart) {
        if (current) items.push(walmartFinalizeItem(current));
        current = rowStart;
        continue;
      }

      // Neither a new row nor a SKU fragment → wrapped description text
      // continuing the current row (or swallowed, for the adjustment row).
      if (current && !current._swallowContinuation) {
        // The optional "Tax Details" percentage (e.g. "0.0824%") wraps
        // onto whichever continuation line happens to be first — real
        // geometry confirmed in 6c246fda/12fd6860. It always sits at
        // the very end of that line; strip it out before treating the
        // rest (if any) as further description text.
        var pctMatch = line.match(/^(.*?)\s*([\d.]+)%$/);
        if (pctMatch && current.tax_rate === null) {
          // The printed number (e.g. "0.0824") already equals the tax
          // rate as a fraction of 1 (0.0824 = 8.24%) — confirmed by
          // cross-checking against the real tax dollar amounts (e.g.
          // 6c246fda row 1: $3.29 / (2 × $19.97) = 0.0824). No further
          // scaling.
          current.tax_rate = parseFloat(pctMatch[2]);
          var remainder = pctMatch[1].trim();
          if (remainder) current._descParts.push(remainder);
          continue;
        }
        current._descParts.push(line);
      }
    }
    if (current) items.push(walmartFinalizeItem(current));
    return items;
  }

  function parseWalmartInvoice(rawText) {
    var text  = String(rawText || '');
    var lines = text.split('\n');

    var header = walmartExtractHeader(text, lines);
    var items  = walmartExtractItems(lines);
    var warnings = [];

    if (!items.length) warnings.push({ code: 'PARSE_ERROR', message: 'No line items found' });

    return {
      vendor:                'Walmart Business',
      document_type:         'invoice',
      document_number:       header.documentNumber,
      invoice_number:        header.documentNumber, // alias — matches sibling invoice parsers' naming
      invoice_date:          header.invoiceDate,
      due_date:              header.dueDate,
      buyer:                 header.buyer,
      seller:                header.seller,
      walmart_order_number:  header.walmartOrderNumber,
      po_number:             header.poNumber,
      subtotal:              header.subtotal,
      tax:                   header.tax,
      total:                 header.total,
      items:                 items,
      warnings:              warnings,
    };
  }

  // ── Reconciliation check (Quadratura) — browser port ──────────────
  // FIX (browser reconciliation fail-safe task): ported verbatim from
  // js/vendor-parsers/index.js's checkTotals(), which the browser parser
  // never had at all — confirmed by a zero-hit search for "checkTotals"
  // in this file before this fix. Without it, any parser bug that drops
  // real line items (exactly the class of bug just fixed for HANDLING/
  // FULFILL_VARIANCE in commit 51cd96f) could leave sum(items.amount)
  // silently mismatched against the declared total with warnings: [] —
  // and vdrProcessAllPdf() only checks items.length > 0 to decide
  // pending/error, so a document missing real dollars would still reach
  // 'pending' looking completely healthy. Applied generically in the
  // Router below, wrapping every vendor's result — not just Walmart's —
  // so any future vendor parser gets the same protection automatically.
  // Data Priority: the document total is the source of truth. If the sum
  // of parsed line amounts does not match the declared subtotal OR total
  // (within tolerance), lines are missing or misread → blocking warning
  // DOC-TOTAL-001.
  var TOTAL_TOLERANCE = 0.02; // dollars

  function checkTotals(parsed) {
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return parsed; // empty docs are covered by PARSE_ERROR/UNKNOWN_VENDOR/etc.
    }

    var amounts = parsed.items
      .map(function(it) { return it.amount; })
      .filter(function(a) { return a !== null && a !== undefined && !isNaN(parseFloat(a)); });

    if (amounts.length === 0) return parsed;

    var sumLines = Math.round(amounts.reduce(function(s, a) { return s + parseFloat(a); }, 0) * 100) / 100;

    var candidates = [];
    if (parsed.subtotal !== null && parsed.subtotal !== undefined && !isNaN(parseFloat(parsed.subtotal))) {
      candidates.push(parseFloat(parsed.subtotal));
    }
    if (parsed.total !== null && parsed.total !== undefined && !isNaN(parseFloat(parsed.total))) {
      candidates.push(parseFloat(parsed.total));
    }

    if (candidates.length === 0) return parsed;

    var matches = candidates.some(function(c) { return Math.abs(c - sumLines) <= TOTAL_TOLERANCE; });
    if (matches) return parsed;

    // Never duplicate the warning if somehow already present.
    parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    if (parsed.warnings.some(function(w) { return w && w.code === 'DOC-TOTAL-001'; })) return parsed;

    var declared = candidates[candidates.length - 1];
    var pct = declared !== 0 ? Math.round(Math.abs(sumLines / declared) * 100) : 0;

    parsed.warnings.push({
      code:     'DOC-TOTAL-001',
      severity: 'blocking',
      message:  'Lines sum $' + sumLines.toFixed(2) + ' but document total is $' + declared.toFixed(2) + ' (' + pct + '% read) — possible missing lines',
      sum_of_lines:   sumLines,
      declared_total: declared,
    });

    return parsed;
  }

  // ── Router ──
  function detectVendor(text) {
    // Placed FIRST so it is tried before any other vendor's fallback —
    // Walmart/TreviPay text also contains the generic word "Invoice"
    // many times, so this must never fall through to Hardie's.
    // Combined-signal (not a single generic token): requires BOTH
    // "Walmart Business" and "TreviPay" to appear in the same document —
    // confirmed present in all 4 real sample invoices. Semantically
    // equivalent to the Node detection added in aef7b5a.
    if (/(?=[\s\S]*walmart\s*business)(?=[\s\S]*trevipay)/i.test(text)) return 'walmart';
    // Fallback combined signal, in case the "Walmart Business" wordmark
    // text is ever missing from the parseable region: still three
    // independent, unrelated signals together, never "Invoice" alone.
    if (/(?=[\s\S]*trevipay)(?=[\s\S]*\bBuyer\b)(?=[\s\S]*Invoice Details)/i.test(text)) return 'walmart';
    if (/dairyland produce|hardie'?s|chefs'?\s*wh?se/i.test(text)) return 'hardies';
    if (/freshpoint/i.test(text)) return 'freshpoint';
    if (/fruge|netyield/i.test(text)) return 'fruge';
    // FIX (BOH OS Task 9): specific to "Ben E[.] Keith" — not a bare "Keith" match.
    if (/ben\s+e\.?\s+keith/i.test(text)) return 'bek';
    return 'unknown';
  }

  function detectDocumentType(text) {
    if (/CONFIRMATION OF SALE/i.test(text))  return 'order_confirmation';
    if (/\bCREDIT\s+\d{5,}/i.test(text))    return 'credit_memo';
    if (/INVOICE\/POD/i.test(text))          return 'invoice';
    if (/\bINVOICE\b/i.test(text))           return 'invoice';
    // FreshPoint: order confirmation uses "Reference #" and "Order Confirmation"
    if (/Reference\s*#\s*\d{6,}/i.test(text) || /Order Confirmation/i.test(text)) return 'order_confirmation';
    // FIX (BOH OS Task 11B) — CONFIRMED root cause of the first real production
    // test (vendor_documents id d84e4d64..., landed in status='error' with
    // UNKNOWN_DOC_TYPE): the real Ben E. Keith Order Confirmation email BODY
    // does not contain the literal phrase "Order Confirmation" — that phrase
    // is only in the email subject, which this function never sees. "Sales
    // Order #" is BEK-specific wording that IS present in the real body and
    // reliably signals this document type.
    if (/Sales\s*Order/i.test(text))         return 'order_confirmation';
    if (/\bINVOICE\b/i.test(text))           return 'invoice';
    return 'unknown';
  }

  function parse(rawText) {
    const vendor  = detectVendor(rawText);
    const docType = detectDocumentType(rawText);
    if (vendor === 'unknown')
      return {vendor:null,document_type:docType,items:[],warnings:[{code:'UNKNOWN_VENDOR',message:'Vendor not recognised'}]};
    if (docType === 'unknown')
      return {vendor,document_type:null,items:[],warnings:[{code:'UNKNOWN_DOC_TYPE',message:'Document type not recognised'}]};
    try {
      var result = null;
      if (vendor === 'walmart') {
        if (docType === 'invoice') result = parseWalmartInvoice(rawText);
      }
      if (vendor === 'hardies') {
        if (docType === 'order_confirmation') result = parseHardiesOrder(rawText);
        if (docType === 'invoice')            result = parseHardiesInvoice(rawText);
        if (docType === 'credit_memo')        result = parseHardiesCredit(rawText);
      }
      if (vendor === 'freshpoint') {
        if (docType === 'order_confirmation') result = parseFreshPointOrder(rawText);
        if (docType === 'invoice')            result = parseFreshPointOrder(rawText); // same format
      }
      if (vendor === 'fruge') {
        result = parseFrugeInvoice(rawText); // try invoice parser for any doc type
      }
      if (vendor === 'bek') {
        if (docType === 'invoice') result = parseBekInvoice(rawText);
        if (docType === 'order_confirmation') result = parseBekOrderConfirmationEmail(rawText);
      }
      if (result) return checkTotals(result);
      return {vendor,document_type:docType,items:[],warnings:[{code:'NO_PARSER',message:`No parser for ${vendor}/${docType}`}]};
    } catch(e) {
      return {vendor,document_type:docType,items:[],warnings:[{code:'PARSER_ERROR',message:e.message}]};
    }
  }

  return { parse, detectVendor, detectDocumentType, parseBekOrderConfirmationHtml };
}

// ── BRIDGE: Parser result → Invoice Import pipeline ───────────

/**
 * Adapt a vendor parser result object into the shape expected by invoice.js.
 * Maps parser field names → invoice pipeline field names.
 * Safe to call on any parser result — missing fields become null.
 */
function convertParserResultToInvoiceData(result) {
  // Normalise items: parser uses qty_ordered/qty_received; invoice.js uses quantity
  const items = (result.items || []).map(item => ({
    ...item,
    // invoice.js reads item.quantity — map from whichever qty field is present
    quantity:    item.qty_received != null ? item.qty_received
                 : item.qty_ordered != null ? item.qty_ordered
                 : item.qty_credited != null ? item.qty_credited
                 : item.quantity != null ? item.quantity : null,
    // invoice.js reads item.unit — map from purchase_unit
    unit:        item.unit        || item.purchase_unit || null,
    // invoice.js reads item.amount — already present in parser output
    amount:      item.amount      != null ? item.amount : null,
    unit_price:  item.unit_price  != null ? item.unit_price : null,
    description: item.description || item.raw_description || '',
    // Pack info — pass through as-is
    pack_size:   item.pack_description || item.pack_size || null,
  }));

  return {
    vendor:         result.vendor         || 'Unknown',
    invoice_number: result.invoice_number || result.order_number || result.credit_number || null,
    invoice_date:   result.invoice_date   || result.order_date   || result.delivery_date || null,
    payment_terms:  result.payment_terms  || null,
    subtotal:       result.subtotal       != null ? result.subtotal : null,
    tax:            result.tax            != null ? result.tax : null,
    total:          result.total          != null ? result.total : null,
    items,
    warnings:       result.warnings       || [],
    // Preserve source metadata for debugging
    _document_type: result.document_type  || null,
    _source:        'vendor-parser',
  };
}

/**
 * Bridge handler — wired to the "Continue to Invoice Import" button.
 * Closes the parser modal and hands off to the existing invoice.js pipeline.
 */
window.continueToInvoiceImport = function() {
  console.log('[InvoiceImport] Button clicked');

  const result = window._lastParserResult;
  if (!result || !(result.items || []).length) {
    showScToast('No parsed items to import');
    return;
  }
  console.log('[InvoiceImport] Parser result:', result);

  // Verify all required pipeline functions before doing anything
  const missing = ['enrichInvoiceItems', 'runOneQuestionRule', 'showInvoicePreview']
    .filter(fn => typeof window[fn] !== 'function');
  if (missing.length) {
    showScToast('❌ Invoice pipeline not available — check script load order');
    console.error('[InvoiceImport] Missing functions:', missing.join(', '));
    return;
  }

  // Adapt parser result → invoice.js shape
  const invoiceData = convertParserResultToInvoiceData(result);
  console.log('[InvoiceImport] Adapted invoice data:', invoiceData);

  // Close parser modal only after all checks pass
  const parserModal = document.querySelector('.fixed.inset-0[style*="background:white"]');
  if (parserModal) parserModal.remove();

  console.log('[InvoiceImport] Calling OQR →', invoiceData.items.length, 'items');
  enrichInvoiceItems(invoiceData);
  runOneQuestionRule(invoiceData, showInvoicePreview);
};
