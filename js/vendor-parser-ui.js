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

  // ── Router ──
  function detectVendor(text) {
    if (/dairyland produce|hardie'?s|chefs'?\s*wh?se/i.test(text)) return 'hardies';
    if (/freshpoint/i.test(text)) return 'freshpoint';
    if (/fruge/i.test(text)) return 'fruge';
    return 'unknown';
  }

  function detectDocumentType(text) {
    if (/CONFIRMATION OF SALE/i.test(text))  return 'order_confirmation';
    if (/\bCREDIT\s+\d{5,}/i.test(text))    return 'credit_memo';
    if (/INVOICE\/POD/i.test(text))          return 'invoice';
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
      if (vendor === 'hardies') {
        if (docType === 'order_confirmation') return parseHardiesOrder(rawText);
        if (docType === 'invoice')            return parseHardiesInvoice(rawText);
        if (docType === 'credit_memo')        return parseHardiesCredit(rawText);
      }
      return {vendor,document_type:docType,items:[],warnings:[{code:'NO_PARSER',message:`No parser for ${vendor}/${docType}`}]};
    } catch(e) {
      return {vendor,document_type:docType,items:[],warnings:[{code:'PARSER_ERROR',message:e.message}]};
    }
  }

  return { parse, detectVendor, detectDocumentType };
}