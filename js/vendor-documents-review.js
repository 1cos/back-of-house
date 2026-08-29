// ── VENDOR DOCUMENTS REVIEW ───────────────────────────────────
// Admin-only. Shows all vendor_documents with status='pending'.
// Each warning becomes a Question (One Question Rule).
// No delete. No archive. No inventory integration.

window.openVendorDocumentsReview = function() {
  if (!isAdmin()) return;
  if (typeof showVdrSection === 'function') showVdrSection();
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
// ── MARKER:VDR_MATCH_STATUS_START ───────────────────────────────────
// Batched ingredient-matching readiness for the document list — computed
// ONCE per vdrLoad() call across every visible invoice, never per-card
// (avoids the N+1 query pattern a per-card vdrPreflight() call would
// cause). Mirrors vdrPreflight's exact matching logic (same
// `!(line_type && line_type !== 'product')` exclusion for Shipping/
// adjustment/handling/fulfillment_variance rows) so a card can never
// claim "needs matching" or "ready" in a way that disagrees with what
// actually clicking Approve would find. Same convention already used a
// few lines below in vdrLoad for the known-conversions preload — one
// batched query per distinct vendor present in the list, not one per
// document.
async function vdrComputeMatchStatus(sb, docs) {
  const status = {};
  try {
    const bySkuByVendor = {};
    const byDescByVendor = {};
    for (const doc of (docs || [])) {
      if (doc.document_type !== 'invoice') continue;
      const pj = doc.parsed_json || {};
      const vendor = pj.vendor || doc.vendor || '';
      const matchableItems = (pj.items || []).filter(i => !(i.line_type && i.line_type !== 'product'));
      if (matchableItems.length === 0) continue;
      bySkuByVendor[vendor]  = bySkuByVendor[vendor]  || new Set();
      byDescByVendor[vendor] = byDescByVendor[vendor] || new Set();
      for (const item of matchableItems) {
        const sku  = item.vendor_sku || item.item_code;
        const desc = item.description || item.raw_description;
        if (sku)  bySkuByVendor[vendor].add(sku);
        if (desc) byDescByVendor[vendor].add(desc);
      }
    }

    const matchedSkusByVendor = {};
    for (const vendor of Object.keys(bySkuByVendor)) {
      const { data: rows } = await sb.from('ingredient_vendors')
        .select('vendor_sku').eq('vendor', vendor).in('vendor_sku', [...bySkuByVendor[vendor]]);
      matchedSkusByVendor[vendor] = new Set((rows || []).map(r => r.vendor_sku));
    }
    const matchedDescsByVendor = {};
    for (const vendor of Object.keys(byDescByVendor)) {
      const { data: rows } = await sb.from('ingredient_links')
        .select('invoice_description').eq('vendor', vendor).eq('confirmed', true).in('invoice_description', [...byDescByVendor[vendor]]);
      matchedDescsByVendor[vendor] = new Set((rows || []).map(r => r.invoice_description));
    }

    for (const doc of (docs || [])) {
      if (doc.document_type !== 'invoice') { status[doc.id] = { needsMatching: false }; continue; }
      const pj = doc.parsed_json || {};
      const vendor = pj.vendor || doc.vendor || '';
      const matchableItems = (pj.items || []).filter(i => !(i.line_type && i.line_type !== 'product'));
      if (matchableItems.length === 0) { status[doc.id] = { needsMatching: false }; continue; }
      const matchedSkus  = matchedSkusByVendor[vendor]  || new Set();
      const matchedDescs = matchedDescsByVendor[vendor] || new Set();
      const unmatchedItems = matchableItems.filter(item => {
        const sku  = item.vendor_sku || item.item_code;
        const desc = item.description || item.raw_description;
        return !(sku && matchedSkus.has(sku)) && !(desc && matchedDescs.has(desc));
      });
      const unmatchedCount = unmatchedItems.length;
      // FIX (Walmart semantics/UI fix task): matching is vendor+SKU, so
      // "15 unmatched lines" can genuinely mean "2 SKUs to resolve"
      // (e.g. 26104552's 15 chicken-tray rows are only 2 distinct SKUs).
      // unmatchedLineCount is the same number as unmatchedCount, kept
      // under both names — unmatchedCount stays for backward
      // compatibility with existing callers/tests, unmatchedLineCount is
      // the clearer name new UI code should prefer. unmatchedSkuCount is
      // new: the count of DISTINCT vendor_sku values among the unmatched
      // rows (falls back to description when a row has no sku, matching
      // the same identity the matching check itself uses).
      const unmatchedSkuSet = new Set(unmatchedItems.map(item => item.vendor_sku || item.item_code || item.description || item.raw_description));
      status[doc.id] = {
        needsMatching: unmatchedCount > 0,
        unmatchedCount,
        unmatchedLineCount: unmatchedCount,
        unmatchedSkuCount: unmatchedSkuSet.size,
        // FIX (Walmart visual fix 2 task, Part D): the actual Set, not
        // just its size — lets per-row rendering (vdrDetailHTML) show a
        // real "Matched"/"Needs match" badge per product row using data
        // already computed here, with zero new query and zero change to
        // vdrPreflight/vdrApprove's own, separate matching logic.
        unmatchedSkuSet,
      };
    }
  } catch (e) {
    // Read-only, best-effort — a failure here must never break the list
    // render. Falling back to an empty map makes every card fall through
    // to the pre-existing "Ready to approve" behavior (see vdrCardHTML),
    // same as before this task.
    return {};
  }
  return status;
}
// ── MARKER:VDR_MATCH_STATUS_END ─────────────────────────────────────

// ── MARKER:VDR_BACKFILL_START ───────────────────────────────────────
// Centralized backfill (deferred matching task, Part E): whenever a
// vendor+vendor_sku pair newly resolves to an ingredient_id — from
// EITHER real production write site (vdrApprove's own ingredient_vendors
// write loop above, or js/ingredients.js's saveNewVendorRow(), the
// Ingredient Card's "add vendor listing" UI) — this retroactively
// resolves any OLDER invoice_lines rows that were imported unmatched
// under that same vendor+SKU, so their economic history joins the
// ingredient's purchase history too. Scoped strictly to
// `ingredient_id IS NULL` — a line already linked to a (possibly
// different) ingredient is never touched. Never creates/deletes
// ingredient_vendors itself — that remains the sole responsibility of
// its two callers.
window.vdrBackfillInvoiceLines = async function(sb, vendor, vendorSku, ingredientId) {
  if (!sb || !vendor || !vendorSku || !ingredientId) return { backfilled: 0 };
  try {
    const { data, error } = await sb.from('invoice_lines')
      .update({ ingredient_id: ingredientId, match_status: 'matched' })
      .eq('vendor', vendor)
      .eq('vendor_sku', vendorSku)
      .is('ingredient_id', null)
      .select('id');
    if (error) {
      console.warn('[vdrBackfillInvoiceLines]', error.message);
      return { backfilled: 0, error };
    }
    return { backfilled: (data || []).length };
  } catch (e) {
    console.warn('[vdrBackfillInvoiceLines]', e && e.message);
    return { backfilled: 0, error: e };
  }
};
// ── MARKER:VDR_BACKFILL_END ─────────────────────────────────────────

// ── MARKER:VDR_SAVE_SKU_MAPPING_START ────────────────────────────────
// FIX (Manual SKU Match task): the single, shared core for "vendor+
// vendor_sku now resolves to an ingredient" — used by BOTH the
// Ingredient Card (window.saveNewVendorRow, js/ingredients.js) and
// Vendor Review's new inline Match action (vdrOpenMatchSelector below),
// so the two surfaces can never diverge on what "save a mapping"
// actually means, or on when vdrBackfillInvoiceLines() gets called.
// Conflict-safe by construction: a DIFFERENT ingredient_id already
// mapped to this exact vendor+vendor_sku is never silently overwritten
// — the caller gets an explicit 'conflict' result and must decide.
// extraFields (optional): additional ingredient_vendors columns to
// include only on a genuinely NEW insert (e.g. the Ingredient Card's
// own pricing fields) — never applied to an existing row, matching or
// not, to avoid this shared helper silently mutating price data nobody
// asked it to touch.
window.vdrSaveVendorSkuMapping = async function(sb, vendor, vendorSku, ingredientId, extraFields) {
  if (!sb || !vendor || !vendorSku || !ingredientId) return { status: 'error', message: 'Missing required field' };
  extraFields = extraFields || {};
  try {
    const { data: existingRows, error: selErr } = await sb
      .from('ingredient_vendors')
      .select('id,ingredient_id')
      .eq('vendor', vendor)
      .eq('vendor_sku', vendorSku);
    if (selErr) return { status: 'error', message: selErr.message };

    const existing = (existingRows || [])[0];
    if (existing) {
      if (existing.ingredient_id === ingredientId) {
        // Idempotent — already mapped correctly. Still safe to backfill:
        // vdrBackfillInvoiceLines only ever touches ingredient_id IS NULL
        // rows, so re-running it here can only help, never duplicate work.
        const bf = window.vdrBackfillInvoiceLines ? await window.vdrBackfillInvoiceLines(sb, vendor, vendorSku, ingredientId) : { backfilled: 0 };
        return { status: 'idempotent', row: existing, backfilled: bf.backfilled };
      }
      // A different ingredient_id is already mapped to this exact
      // vendor+vendor_sku — never silently overwritten.
      return { status: 'conflict', existing_ingredient_id: existing.ingredient_id };
    }

    const insertRow = Object.assign({ vendor: vendor, vendor_sku: vendorSku, ingredient_id: ingredientId, active: true }, extraFields);
    const { data: inserted, error: insErr } = await sb
      .from('ingredient_vendors')
      .insert(insertRow)
      .select('id')
      .single();
    if (insErr) return { status: 'error', message: insErr.message };

    const bf = window.vdrBackfillInvoiceLines ? await window.vdrBackfillInvoiceLines(sb, vendor, vendorSku, ingredientId) : { backfilled: 0 };
    return { status: 'created', row: inserted, backfilled: bf.backfilled };
  } catch (e) {
    return { status: 'error', message: e && e.message };
  }
};
// ── MARKER:VDR_SAVE_SKU_MAPPING_END ──────────────────────────────────

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
      .in('status', ['pending','error'])
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

    // ── Pre-compute ingredient-matching readiness (Parte C: "Ready to
    // approve" must never be shown for an invoice with unmatched product
    // lines) — one batched call, not one per card.
    window._vdrMatchStatus = await vdrComputeMatchStatus(sb, data || []);

    // ── Pre-load known conversions (BIOS-001: first time ask, second time learn) ──
    // Collect all SKUs from pending docs and fetch their conversion_to_base from DB.
    // vdrWarningToQuestion will skip OQR-006 if conversion already known.
    try {
      const allSkus = [];
      for (const doc of (data || [])) {
        for (const item of ((doc.parsed_json || {}).items || [])) {
          if (item.vendor_sku) allSkus.push(item.vendor_sku);
        }
      }
      if (allSkus.length > 0) {
        const { data: ivRows } = await sb
          .from('ingredient_vendors')
          .select('vendor_sku, conversion_to_base, pack_description')
          .in('vendor_sku', [...new Set(allSkus)])
          .not('conversion_to_base', 'is', null);
        window._vdrKnownConversions = {};
        for (const row of (ivRows || [])) {
          window._vdrKnownConversions[row.vendor_sku] = {
            conversion_to_base: row.conversion_to_base,
            pack_description: row.pack_description,
          };
        }
      } else {
        window._vdrKnownConversions = {};
      }
    } catch(_) {
      window._vdrKnownConversions = {};
    }

    // ── AUTO-IMPORT clean Hardie's invoices ─────────────────────
    // Reuses the exact same safety gate (vdrPreflight) and the exact same
    // write path (vdrApprove) already used for a manual click — no new
    // matching/warning logic, no new write logic. Only automates the
    // click itself, and only when that gate already says nothing needs
    // a human. Fire-and-forget: never blocks the list render.
    vdrAutoImportCleanHardiesInvoices().catch(function(e){ console.warn('[vdr auto-import] non-blocking failure:', e && e.message); });

    list.innerHTML = html;
    vdrRenderList();
    if (data) for (const doc of data) vdrRegisterQuestions(doc);

  } catch(e) {
    list.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#991b1b;font-size:13px;">✗ ${e.message}</div>`;
  }
};

// ── MARKER:VDR_TREVIPAY_NORMALIZE_START ────────────────────────────
// Walmart Business / TreviPay PDF text normalization — pure, DOM-free,
// used ONLY for documents detected as TreviPay (see call site below).
// Every other vendor (Hardie's, FreshPoint, Fruge, Ben E. Keith, ...)
// keeps the exact pre-existing extraction, byte for byte — this block
// changes nothing for them.
//
// Two independent problems were confirmed by a read-only audit against
// 4 real TreviPay invoices (c51dd720, 6c246fda, 12fd6860, 30082536):
//
// (1) TreviPay's PDF embeds a Type3 font whose digit/decimal/minus
//     glyphs decode, via PDF.js's standard getTextContent(), to Private
//     Use Area code points instead of normal characters. The exact same
//     /ToUnicode CMap (same character codes → same PUA targets) was
//     found byte-identical across all 4 independently generated
//     invoices, and the target values form a plain arithmetic run
//     (U+E071..U+E07A → 0..9) rather than an arbitrary per-document
//     assignment — this is why a formula is used below, not ten
//     hardcoded cases, and why it's safe to trust beyond the 4 samples.
// (2) TreviPay's PDF emits many small text-runs per line (sometimes one
//     per character); the legacy `.join(' ')` a few lines below inserts
//     a space between every item regardless of true adjacency, which
//     splits ordinary words ("Roth" → "R ot h") and, combined with (1),
//     numbers too. Fixed here with a gap-aware join using item.x +
//     item.width (already returned by the same getTextContent() call —
//     no new PDF.js API needed), with a threshold derived from each
//     item's own font size rather than a bare pixel constant.

const TREVIPAY_PUA_DIGIT_BASE = 0xE071; // U+E071..U+E07A → '0'..'9'
const TREVIPAY_PUA_DECIMAL    = 0xE094; // U+E094 → '.'
const TREVIPAY_PUA_MINUS      = 0xEE55; // U+EE55 → '-'

// Detection runs on RAW textContent.items, before any join — deliberately
// whitespace-insensitive (strip all whitespace, lowercase, then require
// BOTH signals as substrings) because problem (2) above means a single
// word/token can already be split across several items on the very
// document we're trying to detect; a check against already-joined text
// would inherit the same fragility this task exists to fix. Requires the
// combination of both signals — never a single generic token like
// "Invoice" — and both are verified present, in this fragmented form, in
// all 4 real sample PDFs.
function vdrIsTreviPayDocument(items) {
  if (!items || !items.length) return false;
  const flat = items.map(it => (it && it.str) || '').join('').replace(/\s+/g, '').toLowerCase();
  return flat.includes('walmartbusiness') && flat.includes('trevipay');
}

// Decodes ONLY the specific PUA code points demonstrated by the read-only
// audit to be TreviPay's fixed encoding. Any other Private Use Area
// character (U+E000–U+F8FF) is left completely untouched — never
// guessed, never silently dropped — since the audit never observed or
// confirmed a meaning for it; hasUnknownPua lets the caller raise a
// diagnostic instead of silently trusting an unverified value.
function decodeTreviPayPUA(str) {
  if (!str) return { text: str || '', hasUnknownPua: false };
  let text = '';
  let hasUnknownPua = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp >= TREVIPAY_PUA_DIGIT_BASE && cp <= TREVIPAY_PUA_DIGIT_BASE + 9) {
      text += String(cp - TREVIPAY_PUA_DIGIT_BASE);
    } else if (cp === TREVIPAY_PUA_DECIMAL) {
      text += '.';
    } else if (cp === TREVIPAY_PUA_MINUS) {
      text += '-';
    } else if (cp >= 0xE000 && cp <= 0xF8FF) {
      hasUnknownPua = true;
      text += ch; // preserved verbatim — never invented
    } else {
      text += ch;
    }
  }
  return { text, hasUnknownPua };
}

// Effective font size straight from the item's own text-rendering matrix
// (hypot of the matrix's first column) — robust to horizontal scaling or
// rotation, and derived per-item rather than assumed constant.
function vdrItemFontSize(item) {
  const t = (item && item.transform) || [1, 0, 0, 1, 0, 0];
  return Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 1;
}

// Gap-aware join for ONE Y-row of items (rows themselves are still grouped
// by rounded Y exactly like the legacy path — this only changes how items
// within a row are joined). Threshold: half an em of the CURRENT item's
// own font size. Calibrated against the 4 real invoices: intra-word and
// intra-number gaps measured 0–~1pt; real inter-column gaps measured
// ~24–65pt, at the same ~9–10pt font size used throughout every sampled
// document — half an em (~4.5–5pt) sits with wide margin between the two.
// Genuine inter-word spaces are unaffected either way: TreviPay already
// emits an explicit " " item there, which is copied through as-is; this
// threshold only decides whether to INSERT a space where none was
// emitted at all (column-to-column jumps).
const TREVIPAY_GAP_EM_FRACTION = 0.5;

function vdrTreviPayJoinRow(rowItems) {
  const sorted = (rowItems || []).slice().sort((a, b) => a.x - b.x);
  let out = '';
  let prevEnd = null;
  let hasUnknownPua = false;
  for (const it of sorted) {
    const decoded = decodeTreviPayPUA(it.text);
    if (decoded.hasUnknownPua) hasUnknownPua = true;
    if (!decoded.text) continue;
    if (prevEnd !== null) {
      const threshold = (it.fontSize || 1) * TREVIPAY_GAP_EM_FRACTION;
      if (it.x - prevEnd > threshold) out += ' ';
    }
    out += decoded.text;
    prevEnd = it.x + (it.width || 0);
  }
  return { text: out, hasUnknownPua };
}

// Full-page normalizer: same per-rounded-Y grouping the legacy path
// already does, rows joined with vdrTreviPayJoinRow instead of a flat
// `.join(' ')`. Only ever invoked for documents that already passed
// vdrIsTreviPayDocument() at the call site.
function vdrNormalizeTreviPayPage(items) {
  const lineMap = {};
  for (const item of (items || [])) {
    const y = Math.round(item.transform[5]);
    if (!lineMap[y]) lineMap[y] = [];
    lineMap[y].push({
      x: item.transform[4],
      text: item.str,
      width: item.width,
      fontSize: vdrItemFontSize(item),
    });
  }
  const sortedY = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
  let hasUnknownPua = false;
  const lines = sortedY.map(y => {
    const row = vdrTreviPayJoinRow(lineMap[y]);
    if (row.hasUnknownPua) hasUnknownPua = true;
    return row.text;
  });
  return { text: lines.join('\n'), hasUnknownPua };
}
// ── MARKER:VDR_TREVIPAY_NORMALIZE_END ──────────────────────────────

// ── MARKER:VDR_WALMART_BUYER_GUARD_START ────────────────────────────
// Walmart Business / TreviPay Buyer routing — pure, DOM-free, applies
// ONLY to documents already parsed as vendor === 'Walmart Business'.
// Every other vendor (Hardie's, FreshPoint, Fruge, Ben E. Keith, ...)
// is untouched: vdrDecideWalmartBuyer returns null for them, and both
// call sites below (processing AND approval) leave existing behavior
// alone in that case.
//
// Buyer is the SOLE authoritative signal — never SKU, product category,
// amount, order name, or email sender (see task spec). Only two buyers
// are known today; anything else — missing, empty, or any name that
// isn't an exact whitespace/case-normalized match — falls to 'review',
// never silently accepted and never silently ignored. Deliberately NO
// fuzzy/partial matching: "Zubboli" alone, "Massimiliano Zubboli", "Max
// Zubboli", "M. Zubboli" etc. are NOT accepted without an explicit,
// demonstrated identity mapping in code — none exists yet, so they all
// resolve to 'review' today, exactly like a genuinely unknown buyer.
//
// This same function is called from BOTH vdrProcessAllPdf() (processing
// guard, decides status) AND vdrApprove() (hard write-boundary guard,
// decides whether any invoice_lines/ingredient_vendors write may ever
// happen) — one rule, two enforcement points, never duplicated by hand.
const WALMART_KITCHEN_BUYER = 'Massimilajo Zubboli';
const WALMART_BAR_BUYER     = 'Zeno Russo';

function vdrNormalizeBuyerName(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

function vdrDecideWalmartBuyer(parsed) {
  if (!parsed || parsed.vendor !== 'Walmart Business') return null;
  const normalized = vdrNormalizeBuyerName(parsed.buyer);
  if (!normalized) return { action: 'review', reason: 'buyer_missing' };
  if (normalized === vdrNormalizeBuyerName(WALMART_KITCHEN_BUYER)) {
    return { action: 'accept', reason: 'buyer_kitchen' };
  }
  if (normalized === vdrNormalizeBuyerName(WALMART_BAR_BUYER)) {
    return { action: 'ignore', reason: 'buyer_bar' };
  }
  return { action: 'review', reason: 'buyer_unrecognized' };
}
// ── MARKER:VDR_WALMART_BUYER_GUARD_END ──────────────────────────────

// ── Process all pdf_received using the existing import pipeline ──
window.vdrProcessAllPdf = async function(docId) {
  const btn = document.getElementById('vdrProcessAllBtn');
  const log = document.getElementById('vdrProcessLog');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing…'; }
  if (log) { log.style.display = 'block'; log.textContent = 'Loading PDF.js…'; }

  try {
    const sb = window.supabaseClient;
    // FIX (BOH OS Task 11M): senza docId la query resta ESATTAMENTE quella di
    // sempre (solo status='pdf_received', comportamento batch invariato). Con
    // docId, il documento può essere riprocessato intenzionalmente anche se è
    // già pending (es. dopo un fix ai parser, come il mapping data BEK del
    // commit fa0effd7) — mai se è imported/ignored, per costruzione: lo
    // status ammesso con docId è un IN esplicito su tre soli valori, non una
    // condizione più permissiva applicata al caso batch.
    // FIX (safe reprocess for errored documents task): 'error' added to the
    // allowed set — a document that failed (parser error, Storage download
    // failure, Buyer Guard review) can now be retried the same way a
    // 'pending' one already could. This query remains the hard second
    // barrier independent of the UI: even a direct, non-UI call to
    // vdrProcessAllPdf(importedDocId) still returns zero rows for
    // 'imported'/'ignored', exactly as before this change.
    let query = sb
      .from('vendor_documents')
      .select('id,parsed_json,source_email_subject,raw_text');
    if (docId) {
      query = query.eq('id', docId).in('status', ['pdf_received', 'pending', 'error']);
    } else {
      query = query.eq('status', 'pdf_received');
    }
    const { data: queue } = await query.order('created_at', { ascending: true });

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
      // FIX (BOH OS Task 11N): vdrProcessLog only exists in the DOM while the
      // pdf_received banner is rendered. Reprocessing a document that's
      // already pending (Task 11M) — the exact case this task adds a UI
      // trigger for — typically means the banner isn't showing at all, so
      // `log` is null here. Aborting the loop on a missing log element was
      // the whole loop before processing anything in that situation. Log
      // output is best-effort progress text only; its absence must never
      // stop processing.
      if (log) log.textContent = `Processing ${done + 1}/${queue.length}: ${doc.source_email_subject || storagePath}…`;

      try {
        let rawText;
        let parsed;
        if (doc.parsed_json?.source === 'email_html' && doc.raw_text) {
          // FIX (BOH OS Task 11F): Ben E. Keith Order Confirmation HTML
          // (msg.getBody()) — the authoritative source once gmail-vendor-import
          // sends html_body (getPlainBody() was confirmed to strip the item
          // table and mangle values, Task 11E). Skip storage download AND the
          // generic text dispatcher (parsers.parse would try to run
          // detectVendor/detectDocumentType on raw HTML markup, which this
          // path doesn't need) — go straight to the dedicated DOM-based
          // table parser.
          rawText = doc.raw_text;
          parsed = parsers.parseBekOrderConfirmationHtml(rawText);
        } else if (doc.parsed_json?.source === 'email_body' && doc.raw_text) {
          // FIX (BOH OS Task 10): Ben E. Keith Order Confirmation emails have no
          // PDF attachment — gmail-vendor-import already stored the plain email
          // body directly in raw_text. Skip storage download/PDF.js extraction
          // entirely and parse that text as-is. Every other vendor keeps the
          // existing PDF path unchanged (parsed_json.source is only set for
          // this body-only path).
          rawText = doc.raw_text;
          parsed = parsers.parse(rawText);
        } else {
          // Download PDF from Storage
          // FIX (BOH OS Task 11S): storagePath can be undefined/null here —
          // e.g. an email_html/email_body document whose routing metadata
          // was lost (root cause fixed above, but this guard is defense in
          // depth for any other document that legitimately has none).
          // Calling sb.storage.from('app').download(undefined) crashes
          // SYNCHRONOUSLY inside the supabase-js client itself
          // (StorageFileApi._getFinalPath: path.replace(...) on undefined),
          // surfacing as an engine-specific, unreadable message ("undefined
          // is not an object (evaluating 'e.replace')" on Safari — confirmed
          // in production, Task 11R). Fail loud and readable instead, same
          // status='error' + warnings pattern already used for DUPLICATE
          // above, and skip this document without ever calling Storage.
          if (!storagePath) {
            await sb.from('vendor_documents').update({
              status: 'error',
              warnings: [{ code: 'MISSING_STORAGE_PATH', message: 'No storage_path in parsed_json — cannot download from Storage. This document has no PDF to process (e.g. an email_html/email_body document whose routing metadata was lost).' }],
            }).eq('id', doc.id);
            done++; continue;
          }
          const { data: fileData, error: dlErr } = await sb.storage.from('app').download(storagePath);
          if (dlErr || !fileData) throw new Error('Download failed: ' + dlErr?.message);

          // Extract text with PDF.js — same as vendor-parser-ui.js extractWithPdfJs
          const arrayBuffer = await fileData.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          // FIX (BOH OS Task: TreviPay PDF text normalization): detect on page 1's
          // raw items, before any join — see vdrIsTreviPayDocument for why. Every
          // vendor that isn't Walmart Business / TreviPay falls straight through
          // to the untouched legacy branch below.
          const page1Content = await (await pdf.getPage(1)).getTextContent();
          const isTreviPay = vdrIsTreviPayDocument(page1Content.items);

          const pages = [];
          let treviPayHasUnknownPua = false;
          for (let i = 1; i <= pdf.numPages; i++) {
            const content = i === 1 ? page1Content : await (await pdf.getPage(i)).getTextContent();

            if (isTreviPay) {
              const normalized = vdrNormalizeTreviPayPage(content.items);
              if (normalized.hasUnknownPua) treviPayHasUnknownPua = true;
              pages.push(normalized.text);
              continue;
            }

            // ── Legacy join — UNCHANGED for every non-TreviPay vendor ──
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
          rawText = pages.join('\n');
          if (isTreviPay && treviPayHasUnknownPua) {
            // Diagnostic only (Part C requirement) — no parser/business logic
            // exists yet for this vendor, so there is nothing else to gate here.
            console.warn('[VDR] TreviPay: unmapped Private Use Area codepoint encountered, doc', doc.id);
          }

          if (!rawText || rawText.trim().length < 30) throw new Error('No text extracted');
          parsed = parsers.parse(rawText);
        }
        console.log('[VDR] rawText preview:', rawText.slice(0, 500));
        console.log('[VDR] parsed vendor:', parsed.vendor, 'items:', parsed.items?.length, 'warnings:', parsed.warnings?.length);

        // FIX (BOH OS Task 10): also read parsed.document_number — Fruge/FreshPoint/
        // BEK parsers in this file return that field name (not invoice_number/
        // order_number/credit_number). Without this, a correct document_number
        // already set by gmail-vendor-import at intake could get silently
        // overwritten below by the much more ambiguous subject-regex fallback.
        let docNumber = parsed.invoice_number || parsed.order_number || parsed.credit_number || parsed.document_number || null;
        // Fallback: extract from email subject, e.g. "INVOICE - #06997941"
        if (!docNumber && doc.source_email_subject) {
          const sm = doc.source_email_subject.match(/#?\s*(\d{6,10})/);
          if (sm) docNumber = sm[1];
        }
        // FIX (Vendor Docs date audit): fallback chain never checked
        // parsed.document_date — the exact key the Fruge Seafood parser
        // returns (confirmed present and correct in parsed_json for every
        // affected document). Appended last so order_date/credit_date/
        // delivery_date-based vendors keep their current, already-correct
        // behavior unchanged.
        // FIX (DOC DATE + readiness task): the Walmart parser is the only
        // one that returns its date exclusively as invoice_date — every
        // other live browser parser (Hardie's order_date/credit_date/
        // delivery_date, FreshPoint order_date, Fruge/BEK document_date)
        // already resolves through one of the four fields above, confirmed
        // against real production data (39/39 Fruge invoices already have
        // document_date populated) — so appending invoice_date LAST changes
        // nothing for them; the chain only ever reaches it when all four
        // higher-precedence fields are absent, which today is Walmart only.
        const docDate   = parsed.order_date   || parsed.credit_date   || parsed.delivery_date || parsed.document_date || parsed.invoice_date || null;

        // Duplicate check by doc number
        if (docNumber) {
          const { data: byNum } = await sb.from('vendor_documents').select('id').eq('vendor', parsed.vendor).eq('document_number', docNumber).eq('document_type', parsed.document_type).neq('id', doc.id).limit(1);
          if (byNum && byNum.length > 0) {
            await sb.from('vendor_documents').update({ status: 'error', warnings: [{ code: 'DUPLICATE', message: `Document #${docNumber} already exists` }] }).eq('id', doc.id);
            if (storagePath) await sb.storage.from('app').remove([storagePath]);
            done++; continue;
          }
        }

        // ── Hardie's / Chef's Warehouse: order_confirmation <-> invoice reconciliation ──
        // FIX (BOH OS Task 3). order_confirmation and invoice are two phases of the
        // same purchase, not true duplicates — they have different document_type,
        // so the exact-duplicate check above never catches them (see BOH OS Task 3
        // audit). Business rule: the invoice is the canonical operational document.
        // A superseded confirmation is set to status='ignored' — already a supported
        // value in the vendor_documents_status_check constraint, currently unused
        // elsewhere in the codebase. That alone is enough to keep it out of Vendor
        // Review (this file, L40/L47: only pdf_received/pending/error are listed)
        // and out of the Home banner's vendor_documents.warnings source
        // (warnings-banner.js only reads pending/error) — no other file changed.
        // Scope: Hardie's/Chef's Warehouse only. Exact vendor + document_number
        // match, no fuzzy matching. Historical rows are never deleted, only their
        // status is updated; the confirmation's storage PDF is preserved.
        const RECONCILE_VENDORS = ["Hardie's Fresh Foods / Dairyland Produce", "Chef's Warehouse"];
        if (docNumber && RECONCILE_VENDORS.includes(parsed.vendor) &&
            (parsed.document_type === 'order_confirmation' || parsed.document_type === 'invoice')) {
          const counterpartType = parsed.document_type === 'invoice' ? 'order_confirmation' : 'invoice';
          const { data: counterpart } = await sb.from('vendor_documents')
            .select('id,status')
            .eq('vendor', parsed.vendor)
            .eq('document_number', docNumber)
            .eq('document_type', counterpartType)
            .neq('id', doc.id)
            .limit(1);

          if (counterpart && counterpart.length > 0) {
            if (parsed.document_type === 'invoice') {
              // Case A: the Invoice just arrived — supersede the existing Confirmation.
              // Skip an already-imported counterpart untouched: real invoice_lines may
              // already exist from it, and reconciling that is out of scope here.
              const other = counterpart[0];
              if (other.status !== 'imported' && other.status !== 'ignored') {
                await sb.from('vendor_documents').update({ status: 'ignored' }).eq('id', other.id);
              }
              // The Invoice itself proceeds below as the operational document.
            } else {
              // Case B: a Confirmation just arrived but the Invoice already exists —
              // the Confirmation never becomes operational. Invoice keeps winning.
              await sb.from('vendor_documents').update({ status: 'ignored' }).eq('id', doc.id);
              done++; continue;
            }
          }
        }

        const allWarnings = [
          ...(parsed.warnings || []),
          ...(parsed.items || []).flatMap(i => (i.warnings || []).map(w => ({ ...w, item: i.description }))),
        ];

        // FIX (Buyer Guard task): buyer is the sole authoritative signal
        // for routing a Walmart/TreviPay document — computed here, right
        // after parsing and before ANY status is written, so an
        // ignore/review decision can never leave a window where the
        // document could reach 'pending' even transiently. Returns null
        // for every non-Walmart vendor — no behavior change for them.
        const walmartBuyerDecision = vdrDecideWalmartBuyer(parsed);
        if (walmartBuyerDecision && walmartBuyerDecision.action === 'ignore') {
          allWarnings.push({
            code:    'BUYER-BAR-001',
            message: `Walmart/TreviPay buyer "${parsed.buyer}" is not a Kitchen buyer — document excluded from the Kitchen pipeline.`,
            field:   'buyer',
          });
        } else if (walmartBuyerDecision && walmartBuyerDecision.action === 'review') {
          allWarnings.push({
            code:    'BUYER-UNKNOWN-001',
            message: 'Walmart/TreviPay buyer is missing or not recognized; manual review required.',
            field:   'buyer',
          });
        }

        // Normal status computation, unchanged for every non-Walmart
        // vendor. For Walmart, the Buyer Guard can only ever make this
        // MORE restrictive (pending → ignored/error) — 'accept' leaves it
        // exactly as computed, matching "no regression"/"do not
        // auto-approve" requirements.
        let computedStatus = (parsed.items && parsed.items.length > 0) ? 'pending' : 'error';
        if (walmartBuyerDecision && walmartBuyerDecision.action === 'ignore') {
          computedStatus = 'ignored';
        } else if (walmartBuyerDecision && walmartBuyerDecision.action === 'review') {
          computedStatus = 'error';
        }

        await sb.from('vendor_documents').update({
          // FIX (silent Hardie's fallback task): a parser that couldn't
          // recognize the vendor at all (parsed.vendor === null) must
          // never silently become Hardie's — that actively mislabels a
          // document as a vendor it almost certainly isn't. 'unknown' is
          // not a new sentinel: it's the exact string
          // detectVendor()/detectDocumentType() already return in
          // vendor-parsers/index.js and vendor-parser-ui.js for this
          // same case, and the NOT NULL constraint on vendor_documents.
          // vendor rules out null/empty without a migration. Note:
          // doc.vendor (the intake-time value) is deliberately NOT
          // preserved here instead — the batch query above never selects
          // it, and an earlier subject/filename heuristic guess is no
          // more trustworthy than this full-document-text parser also
          // failing to recognize anything; masking that failure behind
          // a stale guess would reintroduce the same class of bug.
          // parsed.items is always [] whenever parsed.vendor is falsy
          // (both parser copies), so computedStatus below already
          // resolves to 'error', not 'pending' — this is purely a
          // labeling fix, not a status change.
          vendor:          parsed.vendor || 'unknown',
          document_type:   parsed.document_type || 'invoice',
          document_number: docNumber,
          document_date:   docDate,
          delivery_date:   parsed.delivery_date || null,
          raw_text:        rawText,
          // FIX (BOH OS Task 11S): parsed_json used to be replaced wholesale
          // with the parser's business-data output (parsed_json: parsed),
          // which silently dropped intake metadata the parser never returns
          // (parsed_json.source, parsed_json.storage_path — set only at
          // insert time by gmail-vendor-import / the PDF upload path). A
          // document reprocessed a second time then lost its routing marker
          // (doc.parsed_json?.source === 'email_html'/'email_body'), fell
          // through to the PDF-download branch below with storagePath
          // undefined, and crashed inside supabase-js's Storage client
          // (path.replace on undefined — root cause proven in Task 11R,
          // production doc 7aa702b1-...). Spreading doc.parsed_json first
          // preserves any pre-existing metadata keys (source, storage_path,
          // or anything else set at intake) while parsed's fields still win
          // on any actual overlap (vendor/document_type/document_number/...).
          // Walmart's buyer field rides along here too — no new column,
          // preserved exactly like any other parser-returned field.
          parsed_json:     { ...(doc.parsed_json || {}), ...parsed },
          status:          computedStatus,
          warnings:        allWarnings.length ? allWarnings : null,
          updated_at:      new Date().toISOString(),
        }).eq('id', doc.id);

        // ── INSERT into invoice_warnings (persistent analytics) ──
        // BIOS-009: warnings are never deleted. This is the source of truth
        // for the home banner. vdrResolveQuestion will UPDATE status→resolved.
        if (allWarnings.length > 0) {
          const warnRows = allWarnings
            .filter(w => w.code && !['OQR-006'].includes(w.code)) // OQR-006 auto-resolves in UI
            .map(w => ({
              document_id:      doc.id,
              vendor:           parsed.vendor || 'unknown',
              document_date:    docDate || null,
              document_number:  docNumber || null,
              code:             w.code,
              severity:         vdrCodeToSeverity(w.code),
              item_description: w.item || null,
              field:            w.field || null,
              message:          w.message || '',
              status:           'open',
            }));
          if (warnRows.length > 0) {
            // upsert: same document + code + item → don't duplicate on re-process
            await sb.from('invoice_warnings').insert(warnRows)
              .then(({ error: wErr }) => {
                if (wErr) console.warn('[VDR] invoice_warnings insert error:', wErr.message);
              });
          }
        }

        // FIX (Storage persistence task): the PDF used to be deleted from
        // Storage right here, immediately after any successful parse
        // (parsed.items.length > 0). That made the PDF a one-time-use
        // artifact instead of a persistent source: Reprocess, and any
        // future parser improvement, had nothing left to re-read for a
        // document that had ever been successfully parsed even once —
        // demonstrated on real production data, where 20 of 21
        // vendor_documents with a storage_path had already lost their PDF
        // this way, across every vendor and every status (pending/error/
        // ignored/imported alike), regardless of whether the document was
        // ever approved. The PDF is now the persistent, canonical source
        // for a vendor_document — it survives every parsing outcome
        // (success, parser error, Buyer Guard reject, DOC-TOTAL-001) and
        // is never automatically deleted here or anywhere else in this
        // codebase. No replacement policy (no timeout, no N-day retention,
        // no archive/move) was introduced — "PDF acquisito = PDF
        // persistente", exactly as scoped for this task.

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

// FIX (BOH OS Task 11N): thin single-document trigger for the "Reprocess"
// button on a pending document (e.g. after a parser fix, so a document can
// be re-run without DevTools). No new pipeline — this just calls the exact
// same vdrProcessAllPdf(docId) from Task 11M/11J with the button's own
// disable/re-enable for double-tap protection. vdrProcessAllPdf's own
// setTimeout(vdrLoad, 1000) after a successful run re-renders the whole list
// (removing/replacing this button along with everything else); the finally
// block here is just a safety net for the window before that happens, or if
// something throws before that point is ever reached.
window.vdrReprocessOne = async function(docId, btn) {
  if (!docId) return;
  if (btn) {
    if (btn.disabled) return; // double-tap guard
    btn.disabled = true;
    btn.dataset.origText = btn.textContent;
    btn.textContent = '⏳ Reprocessing…';
  }
  try {
    await vdrProcessAllPdf(docId);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText || '🔄 Reprocess'; }
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
// FIX (Walmart semantics/UI fix task, Part E): "24 items" was misleading
// for a document mixing product and accounting rows — Chef needs to see
// how many are real products (and distinct SKUs) vs. accounting noise
// (Shipping/handling/fulfillment_variance/adjustment). Driven entirely
// by item.line_type, never hardcoded to any vendor/document — a document
// where every item is a product (every non-Walmart vendor today, and
// Walmart credit memos with no accounting rows) falls back to the exact
// same plain "N items" wording as before, unchanged.
function vdrDescribeItemCounts(items) {
  const list = items || [];
  const productItems    = list.filter(i => !(i.line_type && i.line_type !== 'product'));
  const accountingItems = list.filter(i => i.line_type && i.line_type !== 'product');
  if (accountingItems.length === 0) {
    return list.length + ' item' + (list.length !== 1 ? 's' : '');
  }
  const distinctSkus = new Set(productItems.map(i => i.vendor_sku || i.item_code).filter(Boolean));
  return productItems.length + ' product line' + (productItems.length !== 1 ? 's' : '') +
    ' · ' + distinctSkus.size + ' SKU' + (distinctSkus.size !== 1 ? 's' : '') +
    ' · ' + accountingItems.length + ' accounting line' + (accountingItems.length !== 1 ? 's' : '');
}

// ── MARKER:VDR_DISPLAY_CLEAN_START ──────────────────────────────────
// Display-only cleanup of the unmapped TreviPay PUA range glyph (or a
// plain double-space, both confirmed real in 26104552) inside free-text
// description — turns "1.50<glyph>4.30 lb" / "2.75  7.0 lb" into a
// readable "1.50–4.30 lb" (en dash) for DISPLAY ONLY. Reuses the exact
// same "two numbers, short gap, then oz/lb" shape already validated
// safe against every real fixed-weight description (Task 19's
// isWeightRangePack sibling) — never touches item.description/
// item.raw_description themselves, only ever applied to a local display
// string built from them.
function vdrCleanDisplayDescription(text) {
  if (!text) return text;
  return text.replace(/(\d+(?:\.\d+)?)[^\d]{1,4}(\d+(?:\.\d+)?)(\s*(?:oz|lb)\b)/i, '$1\u2013$2$3');
}
// ── MARKER:VDR_DISPLAY_CLEAN_END ────────────────────────────────────

function vdrCardHTML(doc) {
  const pj        = doc.parsed_json || {};
  const docLabel  = vdrDocTypeLabel(doc.document_type);
  const docNum    = doc.document_number || '—';
  const dateStr   = vdrFmtDate(doc.document_date);
  const total     = pj.total != null ? '$' + Math.abs(pj.total).toFixed(2) : '—';
  const allQ      = vdrBuildQuestions(doc);
  const qCount    = allQ.length;
  const itemCountLabel = vdrDescribeItemCounts(pj.items);

  const typeColor = { invoice:'#3B82F6', order_confirmation:'#8b5cf6', credit_memo:'#ef4444' }[doc.document_type] || '#64748b';

  const matchStatus       = (window._vdrMatchStatus && window._vdrMatchStatus[doc.id]) || null;
  const unmatchedSkuCount  = (matchStatus && matchStatus.unmatchedSkuCount) || 0;
  const unmatchedLineCount = (matchStatus && matchStatus.unmatchedLineCount) || 0;

  // FIX (deferred matching task, Part D): an invoice with unmatched
  // product SKUs is genuinely approvable now (Chef Max can link them
  // later from inside the app) — the badge must say so plainly rather
  // than implying it's blocked. Same positive/green tone as "Ready to
  // approve" throughout, just with the extra count appended.
  // FIX (Walmart semantics/UI fix task, Part F): matching is vendor+SKU,
  // so the badge now leads with the SKU count — the number of decisions
  // Chef actually has to make — not the line count, which can vastly
  // overstate the work for a document with many repeated-SKU rows (e.g.
  // 26104552's 15 unmatched chicken-tray lines are only 2 SKUs).
  const qBadge = qCount > 0
    ? `<span style="background:rgba(245,158,11,0.1);color:#92400e;border:1px solid rgba(245,158,11,0.3);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;">❓ ${qCount} question${qCount > 1 ? 's' : ''}</span>`
    : unmatchedSkuCount > 0
      ? `<span style="background:rgba(16,185,129,0.08);color:#065f46;border:1px solid rgba(16,185,129,0.2);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;">✓ Ready — ${unmatchedSkuCount} SKU${unmatchedSkuCount !== 1 ? 's' : ''} unmatched</span>`
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
            <span style="font-size:11px;color:#94a3b8;">${itemCountLabel}</span>
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
  // FIX (Walmart visual fix 2 task, Part E): this top-bar badge was a
  // completely separate readiness indicator from the card's — it never
  // read unmatchedSkuCount, only qCount, so it always showed a bare
  // "✓ Ready" even when product SKUs still needed matching. Now uses the
  // exact same window._vdrMatchStatus data and priority order the card
  // badge already uses (vdrCardHTML) — card and sheet are now
  // guaranteed to say the same thing.
  const sheetMatchStatus = (window._vdrMatchStatus && window._vdrMatchStatus[doc.id]) || null;
  const sheetUnmatchedSkuCount = (sheetMatchStatus && sheetMatchStatus.unmatchedSkuCount) || 0;

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
        ${qCount > 0
          ? `<span style="background:rgba(245,158,11,0.1);color:#92400e;border:1px solid rgba(245,158,11,0.3);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0;">❓ ${qCount}</span>`
          : sheetUnmatchedSkuCount > 0
            ? `<span style="background:rgba(16,185,129,0.08);color:#065f46;border:1px solid rgba(16,185,129,0.2);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;flex-shrink:0;">✓ Ready — ${sheetUnmatchedSkuCount} SKU${sheetUnmatchedSkuCount !== 1 ? 's' : ''} unmatched</span>`
            : `<span style="background:rgba(16,185,129,0.08);color:#065f46;border:1px solid rgba(16,185,129,0.2);padding:3px 10px;border-radius:20px;font-size:11px;flex-shrink:0;">✓ Ready</span>`}
      </div>
      <!-- Scrollable content -->
      <div style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;">
        ${vdrDetailHTMLNoApprove(doc)}
      </div>
      <!-- Sticky Approve footer -->
      <div style="flex-shrink:0;padding:12px 16px;border-top:1px solid #f1f5f9;background:white;">
        <div id="vdrActionStatus-${doc.id}" style="display:none;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:8px;"></div>
        ${(doc.status === 'pending' || doc.status === 'error') ? `<button id="vdrReprocessBtn-${doc.id}" onclick="vdrReprocessOne('${doc.id}',this)" style="width:100%;height:38px;border-radius:12px;background:#f1f5f9;color:#475569;font-size:12px;font-weight:500;border:none;cursor:pointer;margin-bottom:8px;">🔄 Reprocess</button>` : ''}
        <button onclick="vdrApprove('${doc.id}',this)" style="width:100%;height:48px;border-radius:14px;background:#1e293b;color:white;font-size:14px;font-weight:600;border:none;cursor:pointer;">Approve Document</button>
      </div>
      <!-- Bottom safe area -->
      <div style="height:env(safe-area-inset-bottom,0px);background:white;flex-shrink:0;"></div>
    </div>`;

  document.body.appendChild(sheet);
  const _vdrPanel = sheet.querySelector('#vdrSheetPanel');
  if(_vdrPanel) addSwipeToClose(_vdrPanel, ()=>sheet.remove());
};

// ── Detail panel ──────────────────────────────────────────────
// -- Edits store: vdrEdits[docId][itemIdx] = {qty, pack, unitPrice, ext}
if (!window._vdrEdits) window._vdrEdits = {};

// -- Dizionario pesi standard per unita (USDA/industry) — zero AI, zero domande
window.VDR_UNIT_WEIGHTS = {
  'lemon':100,'lime':67,'orange':130,'grapefruit':230,'avocado':200,
  'banana':120,'apple':182,'pear':166,'peach':150,'plum':66,
  'mango':336,'pineapple':905,'strawberry':18,'blueberry':340,
  'raspberry':170,'blackberry':170,'fig':50,'watermelon':9000,'cantaloupe':1200,
  'tomato':123,'cherry tomato':17,'garlic head':50,'garlic clove':5,
  'onion':150,'shallot':30,'carrot':61,'celery':40,'bell pepper':119,
  'pepper':119,'jalapeno':25,'zucchini':196,'eggplant':458,'cucumber':201,
  'artichoke':128,'asparagus':20,'brussels':19,'potato':150,
  'sweet potato':130,'beet':82,'fennel':234,'romaine':626,'radicchio':100,
  'egg':57,'basil':30,'rosemary':3,'thyme':2,'parsley':60,
  'flower':2,'marigold':2,'truffle':30
};

window.vdrLookupUnitWeight = function(name) {
  if (!name) return null;
  var n = name.toLowerCase();
  if (window.VDR_UNIT_WEIGHTS[n]) return window.VDR_UNIT_WEIGHTS[n];
  var best = null, bestLen = 0;
  var keys = Object.keys(window.VDR_UNIT_WEIGHTS);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (n.indexOf(k) !== -1 && k.length > bestLen) {
      best = window.VDR_UNIT_WEIGHTS[k];
      bestLen = k.length;
    }
  }
  return best;
};

// -- Parser pack -> calcolo testuale (solo matematica, zero AI)
// ── MARKER:VDR_RANGE_GUARD_START ────────────────────────────────────
// Explicit, shared range detector (Walmart semantics/UI fix task) — used
// as an UNCONDITIONAL guard by both vdrCalcPack and vdrPackToGrams
// below, so a catch-weight range pack_description (e.g.
// "1.50-4.30lb Tray", the exact string the Walmart parser now writes
// for 19400236) can never be converted into a real single weight by
// either function — never by accident, never because some other
// pattern chain happens not to match it today. Matches "number [gap]
// number oz/lb" where the gap is an ASCII hyphen, an en/em dash, or any
// glyph in the Private Use Area (the exact unmapped TreviPay hyphen-like
// character seen before normalization, \u{e088}) — every real
// separator shape confirmed in production TreviPay text, plus the
// common Unicode dash variants a human might type when editing the
// field by hand.
function isWeightRangePack(pack) {
  if (!pack) return false;
  return /\d+(?:\.\d+)?\s*[-\u2012\u2013\u2014\uE000-\uF8FF]\s*\d+(?:\.\d+)?\s*(oz|lb)\b/i.test(pack);
}
window.isWeightRangePack = isWeightRangePack;
// ── MARKER:VDR_RANGE_GUARD_END ──────────────────────────────────────

window.vdrCalcPack = function(pack, catchweight, actualWeightLb, ingredientName) {
  if (!pack) return null;
  var p = pack.trim();
  if (catchweight) {
    if (actualWeightLb) return actualWeightLb.toFixed(1) + 'lb (catchweight)';
    // FIX (Walmart semantics/UI fix task): no real measured weight was
    // provided — before falling back to deriving one FROM the pack
    // text, an unconditional range guard: a range must never resolve
    // to a computed weight here.
    if (isWeightRangePack(p)) return null;
    var lbm = p.match(/(\d+(?:\.\d+)?)\s*#/);
    if (lbm) return lbm[1] + 'lb';
    return null;
  }
  // FIX (Walmart semantics/UI fix task): unconditional range guard for
  // the non-catchweight path too, before any other pattern below.
  if (isWeightRangePack(p)) return null;
  // Formato "Xpc / Y#" o "X PC/Y#" — es. "1pc / 28#" = 28lb
  var mpc = p.match(/\d+\s*pc\s*\/\s*(\d+(?:\.\d+)?)\s*#/i);
  if (mpc) return parseFloat(mpc[1]).toFixed(1) + 'lb';

  // Numero misto tipo "9-1/2 GAL" = 9.5 gal
  var mixedGal = p.match(/^(\d+)-(\d+)\/(\d+)\s*(GAL|gal)/i);
  if (mixedGal) {
    var whole = parseInt(mixedGal[1]), num = parseInt(mixedGal[2]), den = parseInt(mixedGal[3]);
    var gal = whole + num / den;
    var liters = (gal * 3785.41).toFixed(0);
    return gal.toFixed(2) + 'gal = ' + liters + 'ml';
  }
  // A-B/Coz o A/B/Coz — es. 6-4/2oz
  var m3 = p.match(/(\d+)[\-\/](\d+)\s*[\/\-]\s*(\d+(?:\.\d+)?)\s*(oz|lb|g|kg)/i);
  if (m3) {
    var a = parseInt(m3[1]), b = parseInt(m3[2]), c = parseFloat(m3[3]), u = m3[4].toLowerCase();
    return a + 'x' + b + 'x' + c + u + ' = ' + (a * b * c) + u;
  }
  // A/Boz — es. 12/8oz
  var m2 = p.match(/(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(oz|lb|g|kg)/i);
  if (m2) {
    var a2 = parseInt(m2[1]), b2 = parseFloat(m2[2]), u2 = m2[3].toLowerCase();
    return a2 + 'x' + b2 + u2 + ' = ' + (a2 * b2) + u2;
  }
  // X/Ylb
  var mxylb = p.match(/(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(lb|#)/i);
  if (mxylb) {
    var ax = parseInt(mxylb[1]), bx = parseFloat(mxylb[2]);
    return ax + 'x' + bx + 'lb = ' + (ax * bx) + 'lb';
  }
  // Xlb o X#
  var mlb = p.match(/^(\d+(?:\.\d+)?)\s*(lb|#)/i);
  if (mlb) return parseFloat(mlb[1]).toFixed(1) + 'lb';
  // CT — usa dizionario pesi standard se disponibile
  var mct2 = p.match(/^(\d+)\s*\/\s*(\d+)\s*CT/i);
  if (mct2) {
    var total2 = parseInt(mct2[1]) * parseInt(mct2[2]);
    var uw2 = ingredientName ? window.vdrLookupUnitWeight(ingredientName) : null;
    return uw2 ? (total2 + ' x ' + uw2 + 'g = ' + (total2 * uw2) + 'g') : (total2 + ' each');
  }
  var mct1 = p.match(/^(\d+)\s*CT/i);
  if (mct1) {
    var total1 = parseInt(mct1[1]);
    var uw1 = ingredientName ? window.vdrLookupUnitWeight(ingredientName) : null;
    return uw1 ? (total1 + ' x ' + uw1 + 'g = ' + (total1 * uw1) + 'g') : (total1 + ' each');
  }
  return null;
};

// -- Calcola totalG da pack string (per $/100g)
window.vdrPackToGrams = function(pack, catchweight, actualWeightLb, ingredientName) {
  if (!pack) return null;
  var p = pack.trim();
  if (catchweight && actualWeightLb) return actualWeightLb * 453.592;
  // FIX (Walmart semantics/UI fix task): unconditional range guard —
  // no real measured weight was provided above, so before deriving one
  // FROM the pack text, a range must never resolve to grams here.
  if (isWeightRangePack(p)) return null;
  // Formato "Xpc / Y#" o "X PC/Y#" — es. "1pc / 28#" = 28lb
  var mpc = p.match(/\d+\s*pc\s*\/\s*(\d+(?:\.\d+)?)\s*#/i);
  if (mpc) return parseFloat(mpc[1]) * 453.592;

  // Numero misto GAL
  var mixedGal = p.match(/^(\d+)-(\d+)\/(\d+)\s*(GAL|gal)/i);
  if (mixedGal) {
    var gal = parseInt(mixedGal[1]) + parseInt(mixedGal[2]) / parseInt(mixedGal[3]);
    return gal * 3785.41;
  }
  // oz cases
  var m3oz = p.match(/(\d+)[\-\/](\d+)\s*[\/\-]\s*(\d+(?:\.\d+)?)\s*oz/i);
  if (m3oz) return parseInt(m3oz[1]) * parseInt(m3oz[2]) * parseFloat(m3oz[3]) * 28.3495;
  var m2oz = p.match(/(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*oz/i);
  if (m2oz) return parseInt(m2oz[1]) * parseFloat(m2oz[2]) * 28.3495;
  var m1oz = p.match(/^(\d+(?:\.\d+)?)\s*oz/i);
  if (m1oz) return parseFloat(m1oz[1]) * 28.3495;
  // lb cases
  var mxylb = p.match(/(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*(lb|#)/i);
  if (mxylb) return parseInt(mxylb[1]) * parseFloat(mxylb[2]) * 453.592;
  var m3lb = p.match(/(\d+)[\-\/](\d+)\s*[\/\-]\s*(\d+(?:\.\d+)?)\s*(lb|#)/i);
  if (m3lb) return parseInt(m3lb[1]) * parseInt(m3lb[2]) * parseFloat(m3lb[3]) * 453.592;
  var m1lb = p.match(/^(\d+(?:\.\d+)?)\s*(lb|#)/i);
  if (m1lb) return parseFloat(m1lb[1]) * 453.592;
  // kg
  var m2kg = p.match(/(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*kg/i);
  if (m2kg) return parseInt(m2kg[1]) * parseFloat(m2kg[2]) * 1000;
  var m1kg = p.match(/^(\d+(?:\.\d+)?)\s*kg/i);
  if (m1kg) return parseFloat(m1kg[1]) * 1000;
  // g
  var m1g = p.match(/^(\d+(?:\.\d+)?)\s*g$/i);
  if (m1g) return parseFloat(m1g[1]);
  // CT — usa dizionario pesi standard se disponibile
  var mct2g = p.match(/^(\d+)\s*\/\s*(\d+)\s*CT/i);
  if (mct2g) {
    var totalCT2 = parseInt(mct2g[1]) * parseInt(mct2g[2]);
    var uw2g = ingredientName ? window.vdrLookupUnitWeight(ingredientName) : null;
    return uw2g ? totalCT2 * uw2g : null;
  }
  var mct1g = p.match(/^(\d+)\s*CT/i);
  if (mct1g) {
    var totalCT1g = parseInt(mct1g[1]);
    var uw1g = ingredientName ? window.vdrLookupUnitWeight(ingredientName) : null;
    return uw1g ? totalCT1g * uw1g : null;
  }
  return null;
};

// -- Ricalcola riga Sous Chef quando l'utente modifica un campo
window.vdrRecalcRow = function(docId, idx, btn) {
  if (!window._vdrEdits[docId]) window._vdrEdits[docId] = {};
  var rid = docId + '-' + idx;

  // Cerca gli elementi nel contenitore della riga (evita duplicati nel DOM)
  var row = btn ? btn.closest('[data-vdr-row]') : null;
  var scope = row || document;

  var qtyEl  = scope.querySelector('[id="vdrQty-'  + rid + '"]');
  var packEl = scope.querySelector('[id="vdrPack-' + rid + '"]');
  var unitEl = scope.querySelector('[id="vdrUnit-' + rid + '"]');
  var extEl  = scope.querySelector('[id="vdrExt-'  + rid + '"]');
  var scEl   = scope.querySelector('[id="vdrSC-'   + rid + '"]');

  if (!packEl || !scEl) return;

  var qty       = qtyEl  ? parseFloat(qtyEl.value)  : null;
  var pack      = packEl.value.trim();
  var unitPrice = unitEl ? parseFloat(unitEl.value) : null;
  var ext       = extEl  ? parseFloat(extEl.value)  : null;

  window._vdrEdits[docId][idx] = { qty: qty, pack: pack, unitPrice: unitPrice, ext: ext };

  // Recupera nome ingrediente dalla riga
  var nameEl = row ? row.querySelector('[data-ingr-name]') : null;
  var ingrName = nameEl ? nameEl.getAttribute('data-ingr-name') : null;
  var packCalc = window.vdrCalcPack(pack, false, null, ingrName);
  var totalG   = window.vdrPackToGrams(pack, false, null, ingrName);
  // $/100g usa ext/qty (prezzo reale per pack) come priorità, unitPrice come fallback
  var price    = (ext && qty && !isNaN(ext) && !isNaN(qty) && qty > 0) ? ext / qty
               : (unitPrice != null && !isNaN(unitPrice) ? unitPrice : null);
  var per100g  = (totalG && price) ? (price / totalG * 100).toFixed(2) : null;

  var parts = [];
  if (packCalc) parts.push(packCalc);
  if (per100g)  parts.push('$' + per100g + '/100g');

  scEl.textContent = parts.length ? parts.join(' · ') : '—';
  scEl.style.color = parts.length ? '#0369a1' : '#94a3b8';
};

function vdrDetailHTML(doc) {
  const pj        = doc.parsed_json || {};
  const items     = pj.items || [];
  const isInvoice = doc.document_type === 'invoice';
  const isCredit  = doc.document_type === 'credit_memo';
  const questions = vdrBuildQuestions(doc);
  const docId     = doc.id;
  const docVendor = pj.vendor || doc.vendor || '';

  // Init edits store per questo doc
  if (!window._vdrEdits[docId]) window._vdrEdits[docId] = {};

  // -- Header fattura --
  var headerFields = [
    ['Vendor',     doc.vendor],
    ['Type',       vdrDocTypeLabel(doc.document_type)],
    ['Document #', doc.document_number],
    ['Doc Date',   vdrFmtDate(doc.document_date)],
    ['Delivery',   vdrFmtDate(doc.delivery_date)],
    ['Subtotal',   pj.subtotal != null ? '$' + pj.subtotal.toFixed(2) : null],
    ['Tax',        pj.tax      != null ? '$' + pj.tax.toFixed(2)      : null],
    ['Total',      pj.total    != null ? '$' + Math.abs(pj.total).toFixed(2) : null],
  ].filter(function(pair) { return pair[1] != null && pair[1] !== ''; });

  var headerHTML = '<div style="padding:12px 14px;background:#f8fafc;display:flex;flex-wrap:wrap;gap:6px 20px;">' +
    headerFields.map(function(pair) {
      return '<div><div style="font-size:10px;color:#94a3b8;font-weight:500;text-transform:uppercase;letter-spacing:.05em;">' + pair[0] + '</div>' +
             '<div style="font-size:12px;color:#1e293b;font-weight:500;">' + pair[1] + '</div></div>';
    }).join('') + '</div>';

  // -- Domande OQR --
  var questionsHTML = questions.length ? (
    '<div style="padding:12px 14px 0;">' +
    '<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Review Required</div>' +
    questions.map(function(q, qi) { return vdrQuestionHTML(docId, q, qi); }).join('') +
    '</div>'
  ) : '';

  // -- Righe articoli con campi editabili --
  var itemsHTML = '';
  if (items.length) {
    var inputStyle = 'border:none;border-bottom:1px solid #e2e8f0;background:transparent;font-weight:600;color:#1e293b;outline:none;padding:0;font-size:12px;font-family:inherit;';

    // FIX (Walmart semantics/UI fix task, Part H): repeated-SKU rows
    // (e.g. 8 chicken trays under the same SKU, same description) look
    // identical in the list otherwise. Minimal, non-invasive context —
    // no new grouping UI — just "(tray N/M)" appended to the name when
    // a SKU appears more than once, computed generically from the real
    // vendor_sku values already on these items.
    // FIX (Walmart visual fix 2 task, Part C): scoped to PRODUCT rows
    // only — accounting rows (handling/fulfillment_variance/adjustment/
    // shipping) share a placeholder vendor_sku across all their
    // occurrences on purpose (e.g. Walmart's "SubDown" for every
    // FULFILL_VARIANCE row) and must never receive a tray index; only a
    // genuinely repeated PRODUCT vendor_sku should.
    var skuOccurrenceTotals = {};
    items.forEach(function(it) {
      var isProductRow = !(it.line_type && it.line_type !== 'product');
      var s = isProductRow ? (it.vendor_sku || it.item_code) : null;
      if (s) skuOccurrenceTotals[s] = (skuOccurrenceTotals[s] || 0) + 1;
    });
    var skuOccurrenceSeen = {};

    var rows = items.map(function(item, idx) {
      var hasWarning  = (item.warnings || []).length > 0;
      var name        = vdrCleanDisplayDescription(item.description || item.raw_description || '-');
      var isProductRow = !(item.line_type && item.line_type !== 'product');
      var repeatSku   = isProductRow ? (item.vendor_sku || item.item_code) : null;
      if (repeatSku && skuOccurrenceTotals[repeatSku] > 1) {
        skuOccurrenceSeen[repeatSku] = (skuOccurrenceSeen[repeatSku] || 0) + 1;
        name += ' (tray ' + skuOccurrenceSeen[repeatSku] + '/' + skuOccurrenceTotals[repeatSku] + ')';
      }
      var mismatch    = isInvoice && item.qty_ordered !== item.qty_received && item.qty_received != null;

      // Valori iniziali (da edits store se gia modificati, altrimenti da item)
      var edits     = window._vdrEdits[docId][idx] || {};
      var qtyVal    = edits.qty      != null ? edits.qty      : (isCredit ? (item.qty_credited || '') : (item.catchweight === true ? 1 : (item.qty_ordered != null ? item.qty_ordered : (item.qty_received != null ? item.qty_received : ''))));
      var packVal   = edits.pack     != null ? edits.pack     : (item.pack_description || '');
      var unitVal   = edits.unitPrice!= null ? edits.unitPrice: (item.unit_price != null ? parseFloat(item.unit_price).toFixed(2) : (item.price_per_lb != null ? parseFloat(item.price_per_lb).toFixed(2) : ''));
      // FIX (Walmart visual fix 2 task, Part B): Math.abs() here silently
      // flipped a negative amount (e.g. ALT_PAYMENT_METHODS = -49.88) to
      // display as positive, while Unit (unitVal, below) already
      // correctly preserved sign via plain parseFloat — a real, visible
      // asymmetry between the two fields on the same row. Ext must show
      // the real signed amount, exactly like Unit does. This only
      // affects display: the value stored in parsed_json/invoice_lines
      // remains item.amount itself (line_total below already used
      // Math.abs() too — left untouched here per this task's scope,
      // which is display rendering only).
      var extVal    = edits.ext      != null ? edits.ext      : (item.amount != null ? item.amount.toFixed(2) : '');

      // Calcolo Sous Chef iniziale — usa ext/qty come prezzo reale per pack
      var packCalc  = window.vdrCalcPack(packVal, item.catchweight, item.actual_weight_lb, name);
      var totalG    = window.vdrPackToGrams(packVal, item.catchweight, item.actual_weight_lb, name);
      var extNum    = parseFloat(extVal) || null;
      var qtyNum2   = parseFloat(qtyVal) || null;
      var price     = (extNum && qtyNum2 && qtyNum2 > 0) ? extNum / qtyNum2 : (parseFloat(unitVal) || null);
      var per100g   = (totalG && price) ? (price / totalG * 100).toFixed(2) : null;
      var scParts   = [];
      if (packCalc) scParts.push(packCalc);
      if (per100g)  scParts.push('$' + per100g + '/100g');
      // FIX (Walmart semantics/UI fix task): a catch-weight range pack
      // (e.g. "1.50-4.30lb Tray") must never show a mute "—" — Chef
      // needs to know WHY there's no cost/100g: the range is real and
      // visible in the Pack field above, the actual weight simply isn't
      // known from this invoice. window.isWeightRangePack is the exact
      // same guard vdrCalcPack/vdrPackToGrams already used to keep
      // packCalc/totalG null for this case — reused here only for
      // wording, never for any computation.
      var scText, scColor;
      if (scParts.length) {
        scText = scParts.join(' · ');
        scColor = '#0369a1';
      } else if (window.isWeightRangePack && window.isWeightRangePack(packVal)) {
        scText = 'Actual weight unavailable (range only)';
        scColor = '#94a3b8';
      } else {
        scText = '—';
        scColor = '#94a3b8';
      }

      // FIX (Walmart semantics/UI fix task, Part G): a non-product
      // accounting row (handling/fulfillment_variance/adjustment/
      // shipping) must never look like a normal, generic "OK" product
      // row — show its real line_type instead, so it reads as what it
      // is: never matchable, never an ingredient. A warning still takes
      // priority over the type label (more urgent to surface).
      var lineTypeLabels = { handling: 'Handling', fulfillment_variance: 'Fulfillment variance', adjustment: 'Adjustment', shipping: 'Shipping' };
      var isAccountingRow = item.line_type && item.line_type !== 'product';
      // FIX (Walmart visual fix 2 task, Part D): a product row now shows
      // its REAL match status instead of always "OK" — reuses the exact
      // Set already computed by vdrComputeMatchStatus for this document
      // (same identity as the matching check itself: vendor_sku falling
      // back to description) — zero new query, zero change to
      // vdrPreflight/vdrApprove's own matching/approval logic. Falls
      // back to the old generic 'OK' only when no match-status data
      // exists for this document (e.g. non-invoice types, where
      // ingredient matching never applies) — never invents a false
      // Matched/Needs match without real data.
      var docMatchStatus = (window._vdrMatchStatus && window._vdrMatchStatus[docId]) || null;
      var productKey = item.vendor_sku || item.item_code || item.description || item.raw_description;
      var rowNeedsMatch = !isAccountingRow && docMatchStatus && docMatchStatus.unmatchedSkuSet && docMatchStatus.unmatchedSkuSet.has(productKey);
      var labelIcon;
      if (hasWarning) labelIcon = 'Warning';
      else if (isAccountingRow) labelIcon = lineTypeLabels[item.line_type] || item.line_type;
      else if (docMatchStatus && docMatchStatus.unmatchedSkuSet) labelIcon = rowNeedsMatch ? 'Needs match' : 'Matched';
      else labelIcon = 'OK';

      // Stili riga — "Needs match" gets its own blue tone (same family
      // as the document-level "Ready — N SKUs unmatched" badge) so it
      // never looks identical to a genuinely matched/OK green row.
      var labelColor, labelBg, labelBorder, rowBorder;
      if (hasWarning) {
        labelColor = '#b45309'; labelBg = 'rgba(245,158,11,0.08)'; labelBorder = 'rgba(245,158,11,0.25)'; rowBorder = 'border-left:3px solid #f59e0b;';
      } else if (rowNeedsMatch) {
        labelColor = '#1e40af'; labelBg = 'rgba(59,130,246,0.08)'; labelBorder = 'rgba(59,130,246,0.25)'; rowBorder = 'border-left:3px solid #3b82f6;';
      } else {
        labelColor = '#059669'; labelBg = 'rgba(16,185,129,0.07)'; labelBorder = 'rgba(16,185,129,0.25)'; rowBorder = 'border-left:3px solid #10b981;';
      }
      var qtyColor    = mismatch ? '#ef4444' : '#1e293b';
      var rid         = docId + '-' + idx;
      var onInput     = 'window.vdrRecalcRow(\'' + docId + '\',' + idx + ',this)';

      var canMatchThisRow = rowNeedsMatch && !!item.vendor_sku;
      var matchOnclick = canMatchThisRow
        ? "window.vdrOpenMatchSelector('" + docId + "','" + String(docVendor).replace(/'/g, "\\'") + "','" + String(item.vendor_sku).replace(/'/g, "\\'") + "','" + String(name).replace(/'/g, "\\'") + "',this)"
        : '';
      var labelHtml = canMatchThisRow
        ? '<button onclick="' + matchOnclick + '" style="font-size:10px;font-weight:700;color:' + labelColor + ';background:' + labelBg + ';border:1px solid ' + labelBorder + ';padding:1px 7px 1px 8px;border-radius:6px;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;gap:3px;">' + labelIcon + ' <span style="text-decoration:underline;">· Match</span></button>'
        : '<span style="font-size:10px;font-weight:700;color:' + labelColor + ';background:' + labelBg + ';border:1px solid ' + labelBorder + ';padding:1px 7px;border-radius:6px;white-space:nowrap;">' + labelIcon + '</span>';

      return '<div data-vdr-row="' + rid + '" style="padding:10px 14px;border-bottom:1px solid #f1f5f9;' + rowBorder + '">' +

        // Riga 1: label + nome
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
          labelHtml +
          '<span data-ingr-name="' + name + '" style="font-size:13px;font-weight:600;color:#1e293b;">' + name + '</span>' +
          (item.is_substitution ? '<span style="font-size:9px;font-weight:700;color:#f59e0b;margin-left:2px;">SUB</span>' : '') +
        '</div>' +

        // Riga 2: 5 campi editabili
        '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;color:#64748b;margin-bottom:5px;">' +
          '<span>Qty</span>' +
          '<input id="vdrQty-' + rid + '" type="number" value="' + qtyVal + '" oninput="' + onInput + '" onchange="' + onInput + '" style="' + inputStyle + 'width:36px;color:' + qtyColor + ';">' +
          '<span style="color:#cbd5e1;">·</span>' +
          '<span>Pack</span>' +
          '<input id="vdrPack-' + rid + '" type="text" value="' + packVal.replace(/"/g, '&quot;') + '" oninput="' + onInput + '" onchange="' + onInput + '" style="' + inputStyle + 'width:80px;">' +
          '<span style="color:#cbd5e1;">·</span>' +
          '<span>Unit</span>' +
          '<input id="vdrUnit-' + rid + '" type="number" step="0.01" value="' + unitVal + '" oninput="' + onInput + '" onchange="' + onInput + '" style="' + inputStyle + 'width:56px;">' +
          '<span style="color:#cbd5e1;">·</span>' +
          '<span>Ext</span>' +
          '<input id="vdrExt-' + rid + '" type="number" step="0.01" value="' + extVal + '" oninput="' + onInput + '" onchange="' + onInput + '" style="' + inputStyle + 'width:56px;">' +
        '</div>' +

        // Riga 3: Sous Chef + bottone ricalcola
        '<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;">' +
          'Sous Chef: <span id="vdrSC-' + rid + '" style="color:' + scColor + ';">' + scText + '</span>' +
          '<button onclick="window.vdrRecalcRow(\'' + docId + '\',' + idx + ',this)" style="margin-left:4px;padding:2px 8px;border-radius:6px;background:#f1f5f9;border:none;font-size:11px;color:#475569;cursor:pointer;">↻</button>' +
        '</div>' +

      '</div>';
    }).join('');

    itemsHTML = '<div style="padding:6px 0 0;">' +
      '<div style="padding:4px 14px 6px;font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;">' + vdrDescribeItemCounts(items) + '</div>' +
      rows +
    '</div>';
  }

  // -- Approve --
  var reprocessHTML = (doc.status === 'pending' || doc.status === 'error')
    ? '<button id="vdrReprocessBtn-' + docId + '" onclick="vdrReprocessOne(\'' + docId + '\',this)" style="width:100%;height:36px;border-radius:12px;background:#f1f5f9;color:#475569;font-size:12px;font-weight:500;border:none;cursor:pointer;margin-bottom:8px;">🔄 Reprocess</button>'
    : '';
  var approveHTML = '<div style="padding:12px 14px 14px;">' +
    '<div id="vdrActionStatus-' + docId + '" style="display:none;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:8px;"></div>' +
    reprocessHTML +
    '<button onclick="vdrApprove(\'' + docId + '\',this)" style="width:100%;height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Approve Document</button>' +
  '</div>';

  return headerHTML + questionsHTML + itemsHTML + approveHTML;
}

// Same as vdrDetailHTML but without the approve button (used when approve is a sticky footer)
function vdrDetailHTMLNoApprove(doc) {
  var docId = doc.id;
  var pj = doc.parsed_json || {};
  var items = Array.isArray(pj.items) ? pj.items : [];
  var questions = vdrBuildQuestions(doc);
  var headerFields = [
    ['Vendor', doc.vendor || '—'],
    ['Date', vdrFmtDate(doc.document_date)],
    ['Invoice #', doc.document_number || '—'],
    ['Total', pj.total != null ? '$' + Math.abs(pj.total).toFixed(2) : '—']
  ];
  var headerHTML = '<div style="padding:12px 14px;background:#f8fafc;display:flex;flex-wrap:wrap;gap:6px 20px;">' +
    headerFields.map(function(pair) {
      return '<div><span style="font-size:10px;color:#94a3b8;">' + pair[0] + '</span> <span style="font-size:12px;font-weight:600;color:#1e293b;">' + pair[1] + '</span></div>';
    }).join('') +
    '</div>';
  // Get questions and items HTML by calling the full function and stripping the approve part
  var full = vdrDetailHTML(doc);
  // Strip the approve div from the end
  var approveStart = full.lastIndexOf('<div style="padding:12px 14px 14px;">');
  if (approveStart >= 0) return full.slice(0, approveStart);
  return full;
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
    // BIOS-001: "First time ask, second time learn."
    // If we already have conversion_to_base for this SKU in the DB → silent, no question.
    if (item && item.vendor_sku) {
      const known = window._vdrKnownConversions && window._vdrKnownConversions[item.vendor_sku];
      if (known && known.conversion_to_base) return null;
    }
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
    // Dozens → each: "15 DZ" = 180 pieces
    if (totalCount && (unit === 'DZ' || unit === 'DOZ')) {
      totalCount = totalCount * 12;
      unit = 'EA';
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

  // ── DOC-TOTAL-001: Quadratura — lines don't reconcile with total ──
  // Blocking (red). Data Priority P1: the document total is truth.
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
      warnRef: w,
      blocking: true,
    };
  }

  // ── OQR-008: Pack format not parseable ───────────────────────────
  // e.g. FreshPoint "3/2# CS", "11# BX", "5#(R) BX"
  if (w.code === 'OQR-008') {
    const rawDesc = item ? (item.pack_description || item.description || '') : (w.item || '');
    // Try to auto-resolve simple patterns before asking
    // "X# BX/CS/BG" → X lb → totalG = X * 453.6
    const lbMatch = rawDesc.match(/(\d+(?:\.\d+)?)#[^\d]/);
    if (lbMatch) {
      // Auto-resolvable — no question needed, just flag for parser fix
      return null;
    }
    // "X/Y# ..." → X bags of Y lb
    const bagMatch = rawDesc.match(/(\d+)\/(\d+(?:\.\d+)?)#/);
    if (bagMatch) {
      return null; // auto-resolvable
    }
    return {
      qid, code: 'OQR-008', item, docId, idx,
      emoji: '📦',
      title: w.item || rawDesc || 'Item',
      detected: rawDesc,
      question: 'What is the total weight of this case?',
      meaning: `Pack: ${rawDesc} — parser could not determine weight`,
      yesLabel: 'Enter weight',
      noLabel: 'Skip for now',
      isWeightInput: true,
      warnRef: w,
    };
  }

  // ── OQR-009: CT item — need price per each or weight ─────────────
  // Triggered when pack is CT but no weight/each price calculable
  if (w.code === 'OQR-009') {
    const EACH_ITEMS = ['FLOWER','LEMON','LIME','ARTICHOKE','AVOCADO','EGG'];
    const name = w.item || '';
    const isEach = EACH_ITEMS.some(k => name.toUpperCase().includes(k));
    const pack = item ? (item.pack_description || '') : '';
    // Parse units from pack
    const mSlash = pack.match(/^(\d+)\s*\/\s*(\d+)\s*CT/i);
    const mSimple = pack.match(/^(\d+)\s*CT/i);
    const totalUnits = mSlash ? parseInt(mSlash[1]) * parseInt(mSlash[2])
                    : mSimple ? parseInt(mSimple[1]) : null;

    if (isEach) {
      // OQR-009b: priced per each — just confirm units per case
      return {
        qid, code: 'OQR-009', item, docId, idx,
        emoji: vdrItemEmoji(name),
        title: name,
        detected: pack,
        question: `How many ${name.toLowerCase()}s per case?`,
        meaning: totalUnits ? `Detected ${totalUnits} units — confirm or correct` : `Pack: ${pack}`,
        yesLabel: totalUnits ? `Yes — ${totalUnits} each` : 'Enter count',
        noLabel: 'Different count',
        isEachInput: true,
        detectedUnits: totalUnits,
        warnRef: w,
      };
    } else {
      // OQR-009a: sold by weight — ask avg weight per piece
      return {
        qid, code: 'OQR-009', item, docId, idx,
        emoji: vdrItemEmoji(name),
        title: name,
        detected: pack,
        question: `Average weight of 1 ${name.toLowerCase()}?`,
        meaning: `Pack: ${pack}${totalUnits ? ` (${totalUnits} units)` : ''} — need unit weight to calculate $/100g`,
        yesLabel: 'Enter grams',
        noLabel: 'Skip — use each',
        isWeightInput: true,
        detectedUnits: totalUnits,
        warnRef: w,
      };
    }
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

  // OQR-009a: weight input
  if (q.isWeightInput) {
    return `
      <div id="${cardId}" style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:10px 12px;margin-bottom:6px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
          <span style="font-size:16px;flex-shrink:0;">${q.emoji}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:#1e293b;">${q.title}</div>
            <div style="font-size:10px;color:#94a3b8;">Pack: ${q.detected}</div>
            ${q.meaning ? `<div style="font-size:10px;color:#64748b;">${q.meaning}</div>` : ''}
          </div>
        </div>
        <div style="font-size:11px;color:#475569;font-weight:500;margin-bottom:6px;">${q.question}</div>
        <div style="display:flex;gap:6px;">
          <input id="vdrWInput-${q.qid}" type="number" placeholder="e.g. 150" min="1"
            style="flex:1;height:32px;padding:0 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;"/>
          <span style="line-height:32px;font-size:11px;color:#64748b;">g</span>
          <button onclick="vdrAnswerWeight('${docId}','${q.qid}',${idx})"
            style="height:32px;padding:0 12px;border-radius:8px;background:#1e293b;color:white;font-size:11px;font-weight:500;border:none;cursor:pointer;">Save</button>
          <button onclick="vdrAnswerSkip('${docId}','${q.qid}',${idx})"
            style="height:32px;padding:0 10px;border-radius:8px;background:#f1f5f9;color:#64748b;font-size:11px;border:none;cursor:pointer;">Skip</button>
        </div>
      </div>`;
  }

  // OQR-009b: each input — confirm units per case
  if (q.isEachInput) {
    return `
      <div id="${cardId}" style="background:#fefce8;border:1px solid rgba(234,179,8,0.3);border-radius:12px;padding:10px 12px;margin-bottom:6px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
          <span style="font-size:16px;flex-shrink:0;">${q.emoji}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:#1e293b;">${q.title}</div>
            <div style="font-size:10px;color:#64748b;">${q.meaning}</div>
          </div>
        </div>
        <div style="font-size:11px;color:#475569;font-weight:500;margin-bottom:6px;">${q.question}</div>
        <div style="display:flex;gap:6px;">
          ${q.detectedUnits ? `<button onclick="vdrAnswerEach('${docId}','${q.qid}',${idx},${q.detectedUnits})"
            style="flex:1;height:32px;border-radius:8px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;font-size:11px;font-weight:500;cursor:pointer;">
            ✓ ${q.detectedUnits} each</button>` : ''}
          <input id="vdrEInput-${q.qid}" type="number" placeholder="${q.detectedUnits || '50'}" min="1"
            style="width:80px;height:32px;padding:0 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;outline:none;"/>
          <button onclick="vdrAnswerEachCustom('${docId}','${q.qid}',${idx})"
            style="height:32px;padding:0 10px;border-radius:8px;background:#1e293b;color:white;font-size:11px;border:none;cursor:pointer;">Save</button>
        </div>
      </div>`;
  }

  // Standard OQR yes/no question
  // Blocking questions render red; decision/insight questions amber.
  const _qBg     = q.blocking ? '#fff5f5'             : '#fefce8';
  const _qBorder = q.blocking ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)';
  return `
    <div id="${cardId}" style="background:${_qBg};border:1px solid ${_qBorder};border-radius:12px;padding:10px 12px;margin-bottom:6px;">
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

// ── Answer: Weight input (OQR-009a) ──────────────────────────
window.vdrAnswerWeight = async function(docId, qid, idx) {
  const input = document.getElementById('vdrWInput-' + qid);
  const grams = input ? parseFloat(input.value) : null;
  if (!grams || grams <= 0) { input && input.focus(); return; }
  const q = window._vdrQuestions && window._vdrQuestions[qid];
  const totalUnits = q ? q.detectedUnits : null;
  // Save to invoice_warnings table
  const sb = window.supabaseClient;
  if (sb && q) {
    await sb.from('invoice_warnings')
      .update({ status: 'resolved', resolution: `unit_weight_g=${grams}`, resolved_by: window._currentUser || 'admin', resolved_at: new Date().toISOString() })
      .eq('document_id', docId).eq('item_description', q.title).eq('code', q.code);
    // Update ingredient_vendors if item is already matched
    if (q.item && q.item.vendor_sku) {
      const { data: iv } = await sb.from('ingredient_vendors').select('id,unit_price').eq('vendor_sku', q.item.vendor_sku).limit(1);
      if (iv && iv.length) {
        const price = iv[0].unit_price;
        const per100g = (price && grams && totalUnits) ? (price / (totalUnits * grams) * 100) : null;
        const convG = totalUnits ? Math.round(totalUnits * grams) : Math.round(grams);
        await sb.from('ingredient_vendors').update({
          conversion_to_base: convG,
          price_per_100g: per100g,
        }).eq('id', iv[0].id);
      }
    }
  }
  await vdrResolveQuestion(docId, qid, idx, { answered: true, answer: `${grams}g per unit` });
};

// ── Answer: Skip weight (OQR-009a) ───────────────────────────
window.vdrAnswerSkip = async function(docId, qid, idx) {
  const sb = window.supabaseClient;
  const q = window._vdrQuestions && window._vdrQuestions[qid];
  if (sb && q) {
    await sb.from('invoice_warnings')
      .update({ status: 'skipped', resolution: 'skipped by user', resolved_by: window._currentUser || 'admin', resolved_at: new Date().toISOString() })
      .eq('document_id', docId).eq('item_description', q.title).eq('code', q.code);
  }
  await vdrResolveQuestion(docId, qid, idx, { answered: true, answer: 'skipped' });
};

// ── Answer: Each confirmed (OQR-009b) ────────────────────────
window.vdrAnswerEach = async function(docId, qid, idx, units) {
  await vdrSaveEach(docId, qid, idx, units);
};

window.vdrAnswerEachCustom = async function(docId, qid, idx) {
  const input = document.getElementById('vdrEInput-' + qid);
  const units = input ? parseInt(input.value) : null;
  if (!units || units <= 0) { input && input.focus(); return; }
  await vdrSaveEach(docId, qid, idx, units);
};

async function vdrSaveEach(docId, qid, idx, units) {
  const sb = window.supabaseClient;
  const q = window._vdrQuestions && window._vdrQuestions[qid];
  if (sb && q) {
    await sb.from('invoice_warnings')
      .update({ status: 'resolved', resolution: `units_per_case=${units}`, resolved_by: window._currentUser || 'admin', resolved_at: new Date().toISOString() })
      .eq('document_id', docId).eq('item_description', q.title).eq('code', q.code);
    // Update ingredient_vendors
    if (q.item && q.item.vendor_sku) {
      const { data: iv } = await sb.from('ingredient_vendors').select('id,unit_price').eq('vendor_sku', q.item.vendor_sku).limit(1);
      if (iv && iv.length) {
        const priceEach = iv[0].unit_price ? iv[0].unit_price / units : null;
        await sb.from('ingredient_vendors').update({
          price_per_each: priceEach,
        }).eq('id', iv[0].id);
      }
    }
  }
  await vdrResolveQuestion(docId, qid, idx, { answered: true, answer: `${units} each per case` });
}

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
// ── PRE-FLIGHT: run before approve button is enabled ──────────
// ── MARKER:VDR_DECIDE_CANONICAL_UPDATE_START ────────────────────────
// Pure guard — no Supabase calls. Local to this file on purpose (Task:
// "non condividere decideVendorUpdate() cross-environment con
// process-invoice — stesso comportamento, non la stessa funzione").
//
// existingSku: the canonical row's current vendor_sku (may be null/'')
// incomingSku: this invoice line's item_code/vendor_sku (may be null/'')
// Returns: 'update' | 'populate_sku' | 'skip'
function vdrDecideCanonicalUpdate(existingSku, incomingSku) {
  const norm = v => { const s = (v == null ? '' : String(v)).trim(); return s || null; };
  const ex = norm(existingSku);
  const inc = norm(incomingSku);

  if (!inc) return 'skip';               // Caso D: incoming SKU mancante — non tocca il canonical
  if (!ex) return 'populate_sku';        // Caso C: canonical senza SKU — popolabile in sicurezza
  if (ex === inc) return 'update';       // Caso A: stesso SKU — refresh normale
  return 'skip';                         // Caso B: SKU diverso — canonical intoccato
}
// ── MARKER:VDR_DECIDE_CANONICAL_UPDATE_END ──────────────────────────

async function vdrPreflight(docId, doc) {
  const sb = window.supabaseClient;
  const pj = doc.parsed_json || {};
  const vendor = pj.vendor || doc.vendor || '';
  const items = pj.items || [];
  let unmatchedCount = 0;

  // 1. Unresolved warnings → count ACTIONABLE questions, not raw warnings.
  // Some warnings (e.g. pure-count OQR-006) are auto-resolved by the question
  // builder and produce no question — they must not block approval.
  const fakeDoc = { id: docId, warnings: doc.warnings, parsed_json: doc.parsed_json };
  const openQuestions = vdrBuildQuestions(fakeDoc).filter(q => !q.infoOnly);
  if (openQuestions.length > 0) {
    return { ok: false, reason: `${openQuestions.length} question${openQuestions.length>1?'s':''} to answer before approving — open the document detail.` };
  }

  // 2. Check ingredient_links — how many items are still unmatched?
  // FIX (deferred matching task): unmatched PRODUCT lines no longer BLOCK
  // approval — per Chef Max's decision, ingredient matching can happen
  // later from inside the app. The invoice_lines row builder in
  // vdrApprove() already writes ingredient_id=null/match_status=
  // 'unmatched' correctly whenever matchedId is falsy — the exact same
  // mechanism already used for non-product Shipping/adjustment rows —
  // so nothing downstream needed to change to support this; only this
  // gate. unmatchedCount is still computed and surfaced (never silently
  // dropped) so the UI/vdrApprove can be explicit about what remains.
  // NOTE: vdrAutoImportCleanHardiesInvoices() deliberately still treats
  // unmatchedCount > 0 as "leave for a human" — see its own comment —
  // this change only affects the manual Approve Document button path.
  if (pj.document_type === 'invoice') {
    // FIX (line_type task): rows the parser has already flagged as
    // non-product (Walmart's Shipping/adjustment placeholders — SKU
    // "Shipping"/"ALT_PAYMENT_METHODS" is never a real ingredient) must
    // never be asked about here at all — not filtered out of an
    // already-built "unmatched" list, excluded from the matching check
    // itself, so they can never accidentally create a confirmed
    // ingredient_links row in the first place. item.line_type is
    // undefined for every non-Walmart parser today, so this changes
    // nothing for them: `undefined && ...` is falsy, matchableItems ===
    // items exactly as before.
    const matchableItems = items.filter(i => !(i.line_type && i.line_type !== 'product'));
    const descs = matchableItems.map(i => i.description || i.raw_description).filter(Boolean);
    const skus  = matchableItems.map(i => i.vendor_sku || i.item_code).filter(Boolean);

    // Fetch existing SKU matches
    const { data: skuRows } = skus.length ? await sb.from('ingredient_vendors')
      .select('vendor_sku').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] };
    const matchedSkus = new Set((skuRows || []).map(r => r.vendor_sku));

    // Fetch confirmed links
    const { data: linkRows } = descs.length ? await sb.from('ingredient_links')
      .select('invoice_description').eq('vendor', vendor).eq('confirmed', true)
      .in('invoice_description', descs) : { data: [] };
    const matchedDescs = new Set((linkRows || []).map(r => r.invoice_description));

    // Find unmatched items — only among matchable (product) items
    const unmatched = matchableItems.filter(item => {
      const sku  = item.vendor_sku || item.item_code;
      const desc = item.description || item.raw_description;
      return !(sku && matchedSkus.has(sku)) && !(desc && matchedDescs.has(desc));
    });

    unmatchedCount = unmatched.length;
  }

  return { ok: true, items, vendor, unmatchedCount };
}

// ── AUTO-IMPORT (Hardie's invoices only) ────────────────────────
// Business target: a clean, already-matched Hardie's invoice should not
// need a daily manual click. This does NOT loosen any warning/matching
// rule — it only asks the exact same question vdrApprove's own gate
// already asks ("does vdrPreflight say ok:true right now?") and, if so,
// runs the exact same vdrApprove() write path a human click would have
// run. Any document with a real open question, an unmatched item, or a
// status of 'error' is left completely untouched — those still need a
// person, exactly as today. Never touches pdf_received (not parsed yet)
// or any non-Hardie's vendor.
// ── MARKER:VDR_AUTO_IMPORT_START ─────────────────────────────────
let _vdrAutoImportRunning = false;
const HARDIES_VENDOR_NAME = "Hardie's Fresh Foods / Dairyland Produce";

async function vdrAutoImportCleanHardiesInvoices() {
  if (_vdrAutoImportRunning) return;
  _vdrAutoImportRunning = true;
  try {
    const candidates = (window._vdrAllDocs || []).filter(function(doc){
      return doc.status === 'pending'
        && doc.vendor === HARDIES_VENDOR_NAME
        && doc.parsed_json && doc.parsed_json.document_type === 'invoice';
    });
    if (!candidates.length) return;

    const imported = [];
    for (const doc of candidates) {
      try {
        const pre = await vdrPreflight(doc.id, doc);
        // FIX (deferred matching task): vdrPreflight itself no longer
        // blocks on unmatched product lines (Chef Max can defer matching
        // from the manual Approve button) — but auto-import must keep its
        // original, stricter promise: only ever touch an ALREADY fully-
        // matched invoice, unattended, with zero human review. Checking
        // unmatchedCount here explicitly (rather than relying on pre.ok)
        // is what keeps that promise intact after this task's change.
        if (!pre.ok || pre.unmatchedCount > 0) continue; // real question or unmatched item — leave for a human, unchanged
        const noopBtn = { style: {} };
        await window.vdrApprove(doc.id, noopBtn);
        imported.push(doc.document_number || doc.id);
      } catch(e){
        console.warn('[vdr auto-import] skipped doc', doc.id, e && e.message);
      }
    }

    if (imported.length && typeof showScToast === 'function') {
      showScToast('✓ Auto-imported ' + imported.length + ' clean Hardie\'s invoice' + (imported.length>1?'s':'') + ': ' + imported.join(', '));
    }
    if (imported.length) {
      // Refresh so the list (and any open card) reflects the new status.
      // Safe against re-entrancy loops: every just-imported doc is no
      // longer 'pending', so the next pass finds nothing left to do.
      if (typeof window.vdrLoad === 'function') window.vdrLoad();
    }
  } finally {
    _vdrAutoImportRunning = false;
  }
}
// ── MARKER:VDR_AUTO_IMPORT_END ───────────────────────────────────

// ── APPROVE BUTTON ─────────────────────────────────────────────
window.vdrApprove = async function(docId, btn) {
  const statusEl = document.getElementById('vdrActionStatus-' + docId);
  btn.disabled = true;
  btn.textContent = '⏳ Checking…';
  btn.style.background = '#94a3b8';

  try {
    const sb = window.supabaseClient;
    if (!sb) throw new Error('Supabase not available');

    // Fetch document
    const { data: doc, error: fetchErr } = await sb
      .from('vendor_documents').select('parsed_json,vendor,warnings,status,document_number,document_date').eq('id', docId).single();
    if (fetchErr) throw new Error(fetchErr.message);

    // ── Guard: already imported — say so, close, done. No double work. ──
    if (doc.status === 'imported') {
      if (typeof showScToast === 'function') showScToast('✓ Already imported — nothing to do');
      const sheetEl = document.getElementById('vdrSheet');
      if (sheetEl) sheetEl.remove();
      const cardEl = document.getElementById('vdrCard-' + docId);
      if (cardEl) cardEl.remove();
      return;
    }

    // FIX (Buyer Guard task, Part D): hard write-boundary for Walmart
    // Business, independent of whatever status is currently stored.
    // vdrProcessAllPdf already computes this same decision and sets
    // status accordingly (ignored/error) — but re-deriving it here,
    // fresh from the just-fetched parsed_json.buyer, means a stale
    // status (old document, a manual status edit, or a future bug in
    // the processing phase) can never let a non-Kitchen Walmart invoice
    // reach invoice_lines/ingredient_vendors below. Reuses the exact
    // same vdrDecideWalmartBuyer() used at processing time — the rule
    // is never duplicated by hand. Scoped strictly to Walmart Business;
    // every other vendor's approve behavior is completely untouched.
    const pjForBuyerGuard = doc.parsed_json || {};
    if (pjForBuyerGuard.vendor === 'Walmart Business') {
      const buyerDecision = vdrDecideWalmartBuyer(pjForBuyerGuard);
      if (buyerDecision && buyerDecision.action !== 'accept') {
        if (typeof showScToast === 'function') {
          showScToast(`Cannot approve — Walmart buyer "${pjForBuyerGuard.buyer || '(missing)'}" is not Kitchen-authorized.`);
        }
        btn.disabled = false;
        btn.textContent = 'Approve Document';
        btn.style.background = '#1e293b';
        return;
      }
    }

    // ── PREFLIGHT ──
    const pre = await vdrPreflight(docId, doc);

    if (!pre.ok) {
      if (pre.reason === 'match_needed') {
        // Open match modal BEFORE approval — Approve will re-run after Done
        btn.disabled = false;
        btn.textContent = '✓ Approve Document';
        btn.style.background = '#1e293b';
        await vdrShowMatchModal(pre.unmatched, pre.items, pre.vendor, sb, docId);
        return; // match modal will re-trigger approve when Done
      }
      throw new Error(pre.reason);
    }

    // ── ALL CLEAR — save data ──
    btn.textContent = '⏳ Saving…';

    const pj    = doc.parsed_json || {};
    const vendor = pj.vendor || doc.vendor || 'Unknown';
    // FIX (invoice_date propagation audit): pj.invoice_date never exists in
    // the real parsed_json (the parser produces order_date/credit_date/
    // delivery_date/document_date, same as the header fallback at docDate
    // above). Reusing doc.document_date — already computed with that exact
    // fallback chain and already saved on this same document — guarantees
    // invoice_lines.invoice_date == vendor_documents.document_date by
    // construction, instead of duplicating the fallback logic here. No
    // created_at, no new Date() fallback.
    const invoiceDate = doc.document_date || null;
    const items = pj.items || [];

    // Batch fetch all needed data
    const skus = items.map(i => i.vendor_sku || i.item_code).filter(Boolean);
    const descs = items.map(i => i.description || i.raw_description).filter(Boolean);

    const [skuRes, ingrVendorRes, linkRes] = await Promise.all([
      skus.length ? sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] },
      sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku').eq('vendor', vendor),
      descs.length ? sb.from('ingredient_links').select('invoice_description,ingredient_id').eq('vendor', vendor).eq('confirmed', true).in('invoice_description', descs) : { data: [] },
    ]);

    const skuMap = {};
    (skuRes.data || []).forEach(r => { skuMap[r.vendor_sku] = r; });
    const ingrVendorMap = {};
    (ingrVendorRes.data || []).forEach(r => { ingrVendorMap[r.ingredient_id] = { id: r.id, vendor_sku: r.vendor_sku }; });
    const linkMap = {};
    (linkRes.data || []).forEach(l => { linkMap[l.invoice_description] = l.ingredient_id; });

    const toUpdate = [];
    const toInsert = [];
    // FIX (deferred matching task, Part E): every vendor+vendor_sku pair
    // that newly resolves to an ingredient_id here (either a brand new
    // ingredient_vendors row, or an existing canonical row that just had
    // its vendor_sku populated) is a candidate for backfilling any OLDER
    // invoice_lines rows that were imported unmatched under that same
    // vendor+SKU. Collected here, executed once after both writes below
    // succeed — see window.vdrBackfillInvoiceLines().
    const backfillTargets = [];

    const docEdits = (window._vdrEdits && window._vdrEdits[docId]) || {};

    // ── Populate/execute ingredient_vendors (price intelligence) — invoices only ──
    // FIX (BOH OS Task 11V): this block used to run identically for invoice
    // AND order_confirmation, writing unit_price/pack_description/price_type/
    // conversion_to_base/price_per_100g/last_invoice_date from an Order
    // Confirmation as if it were a final Invoice price. BEK's own Order
    // Confirmation states the total is "without taxes, fees and final weight
    // prices" — not guaranteed final (root cause: Task 11U audit). Gated the
    // same way invoice_lines already was below — a real Invoice is the only
    // source allowed to update price intelligence.
    if (pj.document_type === 'invoice') {
      const processedIds = new Set();

      for (const [itemIdx, item] of items.entries()) {
        // FIX (line_type task): hard write-boundary, independent of
        // vdrPreflight/the UI. Walmart's Shipping/adjustment placeholder
        // rows (vendor_sku "Shipping"/"ALT_PAYMENT_METHODS") must never
        // become ingredient_vendors, full stop — even if a stale or
        // manually-created ingredient_links/ingredient_vendors row
        // happened to match their SKU or description. item.line_type is
        // undefined for every non-Walmart parser today, so this changes
        // nothing for them: `undefined && ...` is falsy, the loop body
        // runs exactly as before.
        if (item.line_type && item.line_type !== 'product') continue;

        const sku  = item.vendor_sku || item.item_code || null;
        const desc = item.description || item.raw_description || null;
        if (!desc) continue;

        // Applica modifiche utente da _vdrEdits (sovrascrive i valori parsati)
        const edits = docEdits[itemIdx] || {};
        const effectivePack  = (edits.pack      != null && edits.pack !== '')      ? edits.pack                          : (item.pack_description || null);
        const effectivePrice = (edits.unitPrice  != null && !isNaN(edits.unitPrice)) ? edits.unitPrice                   : (item.unit_price != null ? parseFloat(item.unit_price) : null);
        const effectiveExt   = (edits.ext        != null && !isNaN(edits.ext))       ? edits.ext                         : (item.amount != null ? Math.abs(item.amount) : null);
        const effectiveQty   = (edits.qty        != null && !isNaN(edits.qty))       ? edits.qty                         : (item.qty_ordered || 1);

        // Calcola totalG dal pack effettivo
        // Use total_weight_lb from Fruge parser if available
        const totalG  = item.total_weight_lb
          ? item.total_weight_lb * 453.592
          : item.catchweight && item.actual_weight_lb
            ? item.actual_weight_lb * 453.592
            : (window.vdrPackToGrams ? window.vdrPackToGrams(effectivePack, false, null, desc)
              : (window.calcTotalWeightG ? window.calcTotalWeightG(item) : null));

        // Prezzo: Fruge parser -> cost_per_lb, altrimenti unit price, altrimenti ext/qty
        const price   = item.cost_per_lb != null ? item.cost_per_lb
                      : effectivePrice != null ? effectivePrice
                      : (effectiveExt && effectiveQty ? effectiveExt / effectiveQty : null);

        // Fruge parser produces _cost_per_100g and cost_per_lb directly — use them
        const per100g = item._cost_per_100g
          ? parseFloat(item._cost_per_100g)
          : (item.catchweight && item.price_per_lb)
            ? (item.price_per_lb / 453.592) * 100
            : (item.cost_per_lb)
              ? (item.cost_per_lb / 453.592) * 100
              : ((totalG && price) ? (price / totalG * 100) : null);

        const priceType = item.price_type || (item.catchweight ? 'per_lb' : 'per_case');
        const convBase  = priceType === 'per_lb' ? null : (item.conversion_to_base || totalG || null);

        const fields  = {
          unit_price:         price,
          pack_description:   effectivePack,
          price_type:         priceType,
          conversion_to_base: convBase ? Math.round(convBase) : null,
          price_per_100g:     per100g,
          last_invoice_date:  invoiceDate,
        };

        // Match by SKU first
        if (sku && skuMap[sku]) {
          const ingrId = skuMap[sku].ingredient_id;
          if (!processedIds.has(ingrId)) {
            processedIds.add(ingrId);
            toUpdate.push({ id: skuMap[sku].id, ...fields });
          }
          continue;
        }

        // Match by confirmed link
        const linkedId = linkMap[desc];
        if (!linkedId || processedIds.has(linkedId)) continue;
        processedIds.add(linkedId);

        const existingIv = ingrVendorMap[linkedId];
        if (existingIv) {
          const decision = vdrDecideCanonicalUpdate(existingIv.vendor_sku, sku);
          if (decision === 'update') {
            toUpdate.push({ id: existingIv.id, ...fields });
          } else if (decision === 'populate_sku') {
            toUpdate.push({ id: existingIv.id, vendor_sku: sku, ...fields });
            if (sku) backfillTargets.push({ vendor, vendor_sku: sku, ingredient_id: linkedId });
          }
          // decision === 'skip' → riga canonical intoccata di proposito
        } else {
          toInsert.push({ ingredient_id: linkedId, vendor, vendor_sku: sku, active: true, ...fields });
          if (sku) backfillTargets.push({ vendor, vendor_sku: sku, ingredient_id: linkedId });
        }
      }

      // Execute saves
      if (toUpdate.length) {
        const results = await Promise.all(toUpdate.map(r => {
          const { id, ...data } = r;
          return sb.from('ingredient_vendors').update(data).eq('id', id);
        }));
        const failed = results.find(r => r.error);
        if (failed) throw new Error('Update failed: ' + failed.error.message);
      }

      for (const row of toInsert) {
        const { error: insErr } = await sb.from('ingredient_vendors').insert(row);
        if (insErr && insErr.code !== '23505') {
          throw new Error('Insert failed for ' + (row.ingredient_id || '?') + ': ' + insErr.message);
        }
      }

      // FIX (deferred matching task, Part E/F): retroactively resolve any
      // older invoice_lines rows that were imported unmatched under the
      // same vendor+vendor_sku now newly linked to an ingredient — e.g.
      // a chef matching this document's SKU also fixes yesterday's
      // unmatched line for that same SKU, so its purchase enters the
      // ingredient's cost/purchase history too. Scoped strictly to
      // ingredient_id IS NULL rows — never touches a line already
      // linked to a (possibly different) ingredient.
      for (const t of backfillTargets) {
        await window.vdrBackfillInvoiceLines(sb, t.vendor, t.vendor_sku, t.ingredient_id);
      }
    }


    // ── Populate invoice_lines (invoices only) ────────────────────
    if (pj.document_type === 'invoice') {
      // FIX (BOH OS Task 7): if invoice_lines already exist for this document
      // (Manual Import writes them directly at save time — see js/invoice.js
      // saveToInvoiceLines()), reuse those instead of inserting a second,
      // duplicate set parsed fresh from parsed_json.items on every approve.
      // Gmail-imported documents never have pre-existing lines at this point,
      // so this leaves that path completely unchanged.
      const { data: existingLines } = await sb.from('invoice_lines')
        .select('id').eq('import_id', docId).limit(1);

      if (!existingLines || existingLines.length === 0) {
      const invoiceLineRows = items.map((item, itemIdx) => {
        const edits       = docEdits[itemIdx] || {};
        const desc        = item.description || item.raw_description || null;
        const sku         = item.vendor_sku || item.item_code || null;
        const qty         = (edits.qty != null && !isNaN(edits.qty)) ? edits.qty : (item.catchweight === true ? 1 : (item.qty_ordered != null ? item.qty_ordered : (item.qty_received != null ? item.qty_received : null)));
        const pack        = (edits.pack != null && edits.pack !== '') ? edits.pack : (item.pack_description || null);
        const unitPrice   = (edits.unitPrice != null && !isNaN(edits.unitPrice)) ? edits.unitPrice : (item.unit_price != null ? parseFloat(item.unit_price) : null);
        // FIX (Approval Economic Integrity Hotfix): lineTotal used to
        // apply Math.abs() to item.amount, silently flipping a real
        // negative economic value (e.g. ALT_PAYMENT_METHODS = -49.88)
        // to positive when WRITTEN to invoice_lines.line_total — a real
        // data bug, not just the display-only issue the prior task
        // fixed (that one only touched the row editor's extVal, never
        // this write). unitPrice (above) already correctly preserves
        // sign via plain parseFloat; lineTotal must too, or the two
        // columns on the same row silently disagree on sign and any
        // sum(line_total) reconciliation is wrong by 2x the adjustment
        // amount (demonstrated in production: 417.17 instead of 317.41,
        // a 99.76 = 2*49.88 discrepancy).
        const lineTotal   = (edits.ext != null && !isNaN(edits.ext)) ? edits.ext : (item.amount != null ? item.amount : null);

        // Weight
        const totalG = item.total_weight_lb
          ? item.total_weight_lb * 453.592
          : item.catchweight && item.actual_weight_lb
            ? item.actual_weight_lb * 453.592
            : (window.vdrPackToGrams ? window.vdrPackToGrams(pack, false, null, desc) : null);

        // Cost per 100g
        const per100g = item._cost_per_100g
          ? parseFloat(item._cost_per_100g)
          : item.cost_per_lb
            ? (item.cost_per_lb / 453.592) * 100
            : (totalG && unitPrice && qty && qty > 0) ? ((unitPrice / totalG) * 100) : null;

        // FIX (line_type task): a Shipping/adjustment row must never carry
        // an ingredient_id in invoice_lines either, even if a stale or
        // manually-created link/SKU match exists — it stays fully
        // preserved economically (raw_description/qty/unit_price/
        // line_total below) but is always match_status='unmatched',
        // never linked to a real ingredient. item.line_type is undefined
        // for every non-Walmart parser, so isNonProduct is always false
        // for them and this changes nothing.
        const isNonProduct = !!(item.line_type && item.line_type !== 'product');

        // ingredient_id — look up from skuMap or linkMap built earlier
        const matchedId = isNonProduct ? null : (sku && skuMap[sku]) ? skuMap[sku].ingredient_id
          : (desc && linkMap[desc]) ? linkMap[desc]
          : null;

        return {
          import_id:          docId,
          invoice_date:       invoiceDate,
          invoice_number:     pj.invoice_number || pj.document_number || null,
          vendor:             vendor,
          raw_description:    desc,
          vendor_sku:         sku,
          ingredient_id:      matchedId,
          match_status:       matchedId ? 'matched' : 'unmatched',
          qty:                qty,
          purchase_unit:      'case',
          pack_description:   pack,
          unit_price:         unitPrice,
          line_total:         lineTotal,
          estimated_total_g:  totalG ? Math.round(totalG) : null,
          cost_per_100g:      per100g ? parseFloat(per100g.toFixed(4)) : null,
        };
      }).filter(r => r.raw_description);

      if (invoiceLineRows.length) {
        const { error: ilErr } = await sb.from('invoice_lines').insert(invoiceLineRows);
        // FIX (Approval Safety task): a failed insert used to be only
        // console.warn'd, then execution fell through anyway all the way
        // to "Mark imported" below — a real false-success risk (status=
        // imported with zero real invoice_lines persisted). Now fails
        // closed: this throw is caught by vdrApprove's own catch (which
        // already shows a visible toast — see its final catch block),
        // and — because "Mark imported" is a later, separate statement
        // in this same sequential function — that update is structurally
        // unreachable once this throws. The document correctly stays
        // pending.
        if (ilErr) throw new Error('Failed to save invoice lines — approval aborted: ' + ilErr.message);

        // FIX (Post-Insert Reconciliation Guard, Approval Economic
        // Integrity Hotfix): before ever marking this document imported,
        // verify the SIGNED sum of what was just persisted actually
        // reconciles with the document's own declared total — reusing
        // the exact same $0.02 tolerance DOC-TOTAL-001 already uses at
        // parse time (TOTAL_TOLERANCE, js/vendor-parser-ui.js's
        // checkTotals), never a second, arbitrary convention. Uses
        // invoiceLineRows[].line_total (the real, signed values just
        // written to the DB), not item.amount again — this also catches
        // a bug in THIS write construction itself (exactly the sign bug
        // just fixed above), not only a parser-level total mismatch.
        // Demonstrated real case: a flipped adjustment sign silently
        // produced sum=417.17 vs declared 317.41 (a 99.76 discrepancy) —
        // this guard would have caught it before ever reaching "Mark
        // imported" below.
        if (pj.total != null && !isNaN(parseFloat(pj.total))) {
          const RECONCILIATION_TOLERANCE = 0.02; // same convention as DOC-TOTAL-001 (checkTotals, js/vendor-parser-ui.js) — never a second convention
          const sumLineTotals = Math.round(invoiceLineRows.reduce((s, r) => s + (r.line_total || 0), 0) * 100) / 100;
          const declaredTotal = parseFloat(pj.total);
          if (Math.abs(sumLineTotals - declaredTotal) > RECONCILIATION_TOLERANCE) {
            throw new Error(`Invoice lines sum $${sumLineTotals.toFixed(2)} but document total is $${declaredTotal.toFixed(2)} — approval aborted, document remains pending.`);
          }
        }
      } else {
        // FIX (BOH OS Task 7): no pre-existing lines and nothing extractable
        // from parsed_json — don't silently mark an incomplete document as
        // imported.
        throw new Error('No invoice lines found or extractable for this document — cannot approve.');
      }
      }
    }

    // Mark imported
    const { error: updErr } = await sb.from('vendor_documents')
      .update({ status: 'imported', updated_at: new Date().toISOString() }).eq('id', docId);
    if (updErr) throw new Error(updErr.message);

    const card = document.getElementById('vdrCard-' + docId);
    if (card) {
      card.style.transition = 'opacity .3s'; card.style.opacity = '0';
      setTimeout(() => { card.remove(); const list = document.getElementById('vdrList'); if (list && !list.querySelector('[id^="vdrCard-"]')) vdrLoad(); }, 300);
    }
    // ── Yes Chef modal — celebrativo, grande, leggibile ──────────
    const sheetEl = document.getElementById('vdrSheet');
    if (sheetEl) sheetEl.remove();

    const docLabel  = doc.document_number ? '#' + doc.document_number : 'Document';
    const vendorLabel = doc.vendor || vendor || 'Vendor';

    // Costruisci lista articoli
    const itemLines = items.slice(0, 12).map(item => {
      const name  = item.description || item.raw_description || '?';
      const price = item.unit_price ? '$' + parseFloat(item.unit_price).toFixed(2) : '';
      const p100  = item._cost_per_100g ? ` · $${parseFloat(item._cost_per_100g).toFixed(2)}/100g` : '';
      return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:14px;">
        <span style="color:#1e293b;font-weight:500;">${name}</span>
        <span style="color:#64748b;white-space:nowrap;margin-left:8px;">${price}${p100}</span>
      </div>`;
    }).join('');
    const moreCount = items.length > 12 ? `<div style="font-size:13px;color:#94a3b8;padding-top:8px;">+ altri ${items.length - 12} articoli</div>` : '';

    // FIX (BOH OS Task 11Y): a document_type='order_confirmation' approval is
    // purely documentary (Task 11V/11W: 0 ingredient_vendors writes, 0
    // invoice_lines) — the "Articoli importati" / "N nuovi · M aggiornati"
    // copy implied real price/ingredient writes that never happened, using
    // a price shown straight from parsed_json (Task 11X audit). Copy-only
    // change, no DB/business logic touched.
    const isInvoiceApproval = pj.document_type === 'invoice';
    const statsLine = isInvoiceApproval
      ? ([
          toInsert.length ? `${toInsert.length} nuovo${toInsert.length !== 1 ? 'i' : ''}` : '',
          toUpdate.length ? `${toUpdate.length} aggiornato${toUpdate.length !== 1 ? 'i' : ''}` : '',
        ].filter(Boolean).join(' · ') || `${items.length} articoli`)
      : 'Documento confermato';
    const itemsLabel = isInvoiceApproval ? 'Articoli importati' : "Articoli nell'ordine";

    const overlay = document.createElement('div');
    overlay.id = '_yesChefOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = `
      <div style="
        background:white;width:100%;max-width:480px;
        border-radius:28px 28px 0 0;
        max-height:85vh;
        display:flex;flex-direction:column;
        animation:slideUp .3s cubic-bezier(.34,1.56,.64,1);
        box-shadow:0 -8px 40px rgba(0,0,0,0.25);
      ">
        <!-- Handle -->
        <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;margin:14px auto 0;flex-shrink:0;"></div>

        <!-- Header celebrativo -->
        <div style="text-align:center;padding:24px 20px 16px;flex-shrink:0;">
          <div style="font-size:52px;margin-bottom:8px;">👨‍🍳</div>
          <div style="font-size:28px;font-weight:800;color:#1e293b;letter-spacing:-.5px;">Yes, Chef!</div>
          <div style="font-size:15px;color:#64748b;margin-top:6px;">${vendorLabel} · ${docLabel}</div>
          <div style="
            display:inline-block;
            margin-top:12px;padding:6px 16px;
            background:#f0fdf4;border:1.5px solid #86efac;
            border-radius:20px;font-size:13px;font-weight:600;color:#166534;
          ">✅ ${statsLine}</div>
        </div>

        <!-- Lista articoli — scrollabile -->
        <div style="padding:0 20px;overflow-y:auto;flex:1;">
          <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">${itemsLabel}</div>
          ${itemLines}
          ${moreCount}
        </div>

        <!-- Bottone chiudi — fisso in fondo, fuori dallo scroll -->
        <div style="padding:16px 20px 40px;flex-shrink:0;">
          <button onclick="document.getElementById('_yesChefOverlay').remove()"
            style="
              width:100%;height:56px;border-radius:18px;
              background:#1e293b;color:white;
              font-size:18px;font-weight:700;
              border:none;cursor:pointer;
              letter-spacing:.01em;
            ">
            🍽️ Fatto, Chef
          </button>
        </div>
      </div>`;

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

  } catch(e) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239,68,68,0.06)';
      statusEl.style.border = '1px solid rgba(239,68,68,0.25)';
      statusEl.style.color = '#991b1b';
      statusEl.textContent = '✗ ' + e.message;
    }
    // statusEl may not exist in the mobile sheet — always toast too
    if (typeof showScToast === 'function') showScToast('✗ ' + e.message);
    console.error('vdrApprove error:', e);
  } finally {
    btn.disabled = false;
    btn.textContent = '✓ Approve Document';
    btn.style.background = '#1e293b';
  }
};

// ── MATCH MODAL (opens BEFORE approve, not during) ─────────────
// ── MATCH SELECTOR (Manual SKU Match task) — per-SKU, ingredient_vendors only ──
// This is the ACTIVE match path, reachable from the real "Needs match ·
// Match" button on any unmatched product row (see labelHtml above).
// vdrShowMatchModal() below is the OLD, unreachable (dead-code) system —
// left untouched, never reactivated, never called from here.
//
// Contract: vendor + vendor_sku -> ingredient_id -> ingredient_vendors,
// via the shared window.vdrSaveVendorSkuMapping() helper (same one
// js/ingredients.js's saveNewVendorRow() uses) -> vdrBackfillInvoiceLines().
// Never writes ingredient_links. Never creates a new ingredient (search
// only, over the exact same `ingredients` table/columns
// js/ingredients.js's searchIngredient() already queries).
//
// Per-SKU, not per-row: the button only ever appears when item.vendor_sku
// is present (see canMatchThisRow above) — a single tap matches every
// row sharing that vendor_sku, since the underlying mapping (and the
// backfill it triggers) is keyed on vendor+vendor_sku, never a row index.
window.vdrOpenMatchSelector = async function(docId, vendor, vendorSku, description, btn) {
  const sb = window.supabaseClient;
  if (!sb) return;

  const existingModal = document.getElementById('_vdrMatchSelector');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = '_vdrMatchSelector';
  // z-index above the Vendor Review sheet (70) — this must always be
  // reachable from an already-open document detail.
  modal.style.cssText = 'position:fixed;inset:0;z-index:9400;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);';

  let selected = null; // {id, name, category}
  let results = [];
  let statusMsg = '';
  let statusColor = '#94a3b8';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function render() {
    const resultsHtml = results.length
      ? results.map(function(r, i) {
          const isSel = selected && selected.id === r.id;
          return '<button onclick="window.vdrMatchSelectorPick(' + i + ')" style="width:100%;text-align:left;padding:10px 12px;border-radius:10px;border:1px solid ' + (isSel ? '#3b82f6' : '#e2e8f0') + ';background:' + (isSel ? 'rgba(59,130,246,0.08)' : 'white') + ';margin-bottom:6px;cursor:pointer;display:block;">' +
            '<div style="font-size:13px;font-weight:600;color:#1e293b;">' + esc(r.name) + '</div>' +
            (r.category ? '<div style="font-size:11px;color:#94a3b8;">' + esc(r.category) + '</div>' : '') +
            '</button>';
        }).join('')
      : '<div style="font-size:12px;color:#94a3b8;padding:8px 0;">Type an ingredient name to search.</div>';

    modal.innerHTML =
      '<div style="background:white;border-radius:20px 20px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;display:flex;flex-direction:column;">' +
        '<div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 12px;"></div>' +
        '<div style="font-size:15px;font-weight:600;color:#1e293b;margin-bottom:2px;">Match ingredient</div>' +
        '<div style="font-size:12px;color:#64748b;margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(description) + ' · SKU ' + esc(vendorSku) + '</div>' +
        '<input id="_vdrMatchSearchInput" type="text" inputmode="search" placeholder="Search ingredients..." style="width:100%;height:44px;padding:0 12px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:10px;" />' +
        '<div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-bottom:10px;">' + resultsHtml + '</div>' +
        (statusMsg ? '<div style="font-size:12px;color:' + statusColor + ';margin-bottom:8px;">' + esc(statusMsg) + '</div>' : '') +
        '<div style="display:flex;gap:8px;">' +
          '<button onclick="document.getElementById(\'_vdrMatchSelector\').remove()" style="flex:1;height:44px;border-radius:12px;background:#f1f5f9;color:#475569;border:none;font-size:13px;cursor:pointer;">Cancel</button>' +
          '<button id="_vdrMatchConfirmBtn" onclick="window.vdrMatchSelectorConfirm()" ' + (selected ? '' : 'disabled') + ' style="flex:1;height:44px;border-radius:12px;background:' + (selected ? '#1e293b' : '#cbd5e1') + ';color:white;border:none;font-size:13px;font-weight:600;cursor:' + (selected ? 'pointer' : 'default') + ';">Confirm</button>' +
        '</div>' +
      '</div>';

    const input = document.getElementById('_vdrMatchSearchInput');
    if (input) {
      input.value = _vdrMatchSelectorLastQuery;
      input.focus();
      input.addEventListener('input', function() {
        _vdrMatchSelectorLastQuery = input.value;
        doSearch(input.value);
      });
    }
  }

  var _vdrMatchSelectorLastQuery = '';
  var searchDebounce = null;
  async function doSearch(q) {
    clearTimeout(searchDebounce);
    if (!q || q.trim().length < 2) { results = []; selected = null; render(); return; }
    searchDebounce = setTimeout(async function() {
      if (typeof window.searchIngredient !== 'function') {
        statusMsg = 'Ingredient search unavailable.'; statusColor = '#b45309'; render(); return;
      }
      results = await window.searchIngredient(q.trim());
      render();
    }, 200);
  }

  window.vdrMatchSelectorPick = function(i) {
    selected = results[i] || null;
    render();
  };

  window.vdrMatchSelectorConfirm = async function() {
    if (!selected) return;
    const confirmBtn = document.getElementById('_vdrMatchConfirmBtn');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving...'; }

    const result = await window.vdrSaveVendorSkuMapping(sb, vendor, vendorSku, selected.id);

    if (result.status === 'created' || result.status === 'idempotent') {
      modal.remove();
      if (typeof showScToast === 'function') {
        showScToast('✓ Matched to ' + selected.name + (result.backfilled ? ' — ' + result.backfilled + ' line' + (result.backfilled === 1 ? '' : 's') + ' updated' : ''));
      }
      // Re-render the open detail sheet safely: recompute this one
      // document's match status fresh (never a manual Set mutation),
      // then let vdrToggle's own remove-and-recreate do the redraw —
      // no manual refresh needed.
      const allDocs = window._vdrAllDocs || [];
      const freshDoc = allDocs.find(function(d) { return d.id === docId; });
      if (freshDoc && typeof vdrComputeMatchStatus === 'function') {
        const updatedStatus = await vdrComputeMatchStatus(sb, [freshDoc]);
        window._vdrMatchStatus = Object.assign({}, window._vdrMatchStatus, updatedStatus);
      }
      if (typeof window.vdrToggle === 'function') window.vdrToggle(docId);
      return;
    }

    if (result.status === 'conflict') {
      statusMsg = 'This SKU is already matched to a different ingredient. Choose a different ingredient, or resolve the existing mapping first — nothing was overwritten.';
      statusColor = '#b45309';
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm'; }
      render();
      return;
    }

    // status === 'error'
    statusMsg = 'Save failed: ' + (result.message || 'unknown error');
    statusColor = '#b91c1c';
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm'; }
    render();
  };

  document.body.appendChild(modal);
  render();
};

async function vdrShowMatchModal(unmatchedItems, allItems, vendor, sb, docId) {
  const { data: allIngr } = await sb.from('ingredients').select('id,name,category').eq('active', true);
  const ingrs = (allIngr || []).filter(i => i.category !== 'Supply');

  function findMatches(desc) {
    const stop = ['large','small','medium','fresh','whole','organic','baby','jumbo','wild','red','green','yellow','white','black','sliced','diced','dried','frozen','raw','salted','unsalted','ground','grated'];
    const kws = (desc||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/)
      .filter(w => w.length>2 && !stop.includes(w)).slice(0,3);
    if (!kws.length) return [];
    return ingrs.map(i => {
      const n = i.name.toLowerCase();
      const score = kws.filter(k => n.includes(k)).length;
      return {...i, score};
    }).filter(x => x.score>0).sort((a,b) => b.score-a.score || a.name.length-b.name.length).slice(0,3);
  }

  const itemStates = unmatchedItems.map(item => {
    const desc = item.description || item.raw_description || '';
    const matches = findMatches(desc);
    return { item, desc, status: matches.length?'suggest':'new', suggested: matches[0]||null, candidates: matches, linkedId: null, linkedName: null };
  });

  const existing = document.getElementById('_vdrMatchModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = '_vdrMatchModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9300;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);';

  function renderAll() {
    const done  = itemStates.filter(s => s.status==='done'||s.status==='skip').length;
    const total = itemStates.length;
    const allDone = done===total;
    const itemsHtml = itemStates.map((s,idx) => {
      if (s.status==='done') return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:0.5px solid #f8fafc;">
        <span>✅</span><div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:500;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.desc}</div>
        <div style="font-size:10px;color:#10b981;">→ ${s.linkedName}</div></div>
        <button onclick="vdrMatchUndo(${idx})" style="font-size:10px;padding:3px 8px;border-radius:8px;background:#f1f5f9;color:#64748b;border:none;cursor:pointer;">↩</button></div>`;
      if (s.status==='skip') return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:0.5px solid #f8fafc;opacity:0.4;">
        <span>⏭️</span><div style="font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.desc}</div>
        <button onclick="vdrMatchUndo(${idx})" style="font-size:10px;padding:3px 8px;border-radius:8px;background:#f1f5f9;color:#64748b;border:none;cursor:pointer;">↩</button></div>`;
      const btns = s.candidates.map((c,ci) => {
        const p = ci===0;
        return `<button onclick="vdrMatchLink(${idx},'${c.id}','${c.name.replace(/'/g,"\\'")}',this)" style="font-size:${p?12:11}px;padding:${p?'7px 12px':'5px 10px'};border-radius:${p?10:8}px;background:${p?'rgba(16,185,129,0.1)':'rgba(59,130,246,0.06)'};color:${p?'#065f46':'#1d4ed8'};border:1px solid ${p?'rgba(16,185,129,0.3)':'rgba(59,130,246,0.2)'};cursor:pointer;font-weight:${p?600:400};white-space:nowrap;">${p?'✓ ':''}${c.name}</button>`;
      }).join('');
      return `<div id="vdrMItem-${idx}" style="padding:8px 0;border-bottom:0.5px solid #f8fafc;">
        <div style="font-size:12px;font-weight:500;color:#1e293b;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.desc}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">${btns}
          <button onclick="vdrMatchSkip(${idx})" style="font-size:10px;padding:4px 8px;border-radius:8px;background:rgba(0,0,0,0.04);color:#94a3b8;border:1px solid #e2e8f0;cursor:pointer;">Skip</button>
          <button onclick="vdrMatchShowSearch(${idx})" style="font-size:10px;padding:4px 8px;border-radius:8px;background:rgba(245,158,11,0.08);color:#92400e;border:1px solid rgba(245,158,11,0.3);cursor:pointer;">🔍 Search</button>
        </div>
        <div id="vdrMSearch-${idx}" style="display:none;margin-top:6px;">
          <div style="display:flex;gap:6px;">
            <input id="vdrMInput-${idx}" type="text" placeholder="Type ingredient name..." list="vdrIngrList" style="flex:1;height:34px;padding:0 10px;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;outline:none;"/>
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
      <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Link each item to an ingredient. Then approve.</div>
      <div style="background:#f8fafc;border-radius:10px;height:4px;margin-bottom:12px;overflow:hidden;">
        <div style="width:${Math.round(done/total*100)}%;height:100%;background:#10b981;border-radius:10px;transition:width .3s;"></div>
      </div>
      <div style="flex:1;overflow-y:auto;">${itemsHtml}</div>
      <div style="margin-top:12px;">
        <button onclick="vdrMatchDone('${docId}')" style="width:100%;height:44px;border-radius:14px;background:${allDone?'#10b981':'#1e293b'};color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">
          ${allDone?'✓ Done — Approve Now':'Done'}
        </button>
      </div>
    </div>`;
  }

  // Datalist
  if (!document.getElementById('vdrIngrList')) {
    const dl = document.createElement('datalist'); dl.id = 'vdrIngrList';
    ingrs.forEach(i => { const o = document.createElement('option'); o.value = i.name; dl.appendChild(o); });
    document.body.appendChild(dl);
  }

  window.vdrMatchLink = async function(idx, ingrId, ingrName, btn) {
    if (btn) { btn.textContent = '...'; btn.disabled = true; }
    const s = itemStates[idx];
    await sb.from('ingredient_links').upsert({
      vendor, invoice_description: s.desc,
      ingredient_id: ingrId, ingredient_name: ingrName,
      confirmed: true, updated_at: new Date().toISOString()
    }, { onConflict: 'vendor,invoice_description' });
    s.status = 'done'; s.linkedId = ingrId; s.linkedName = ingrName;
    renderAll();
  };

  window.vdrMatchUndo = function(idx) {
    itemStates[idx].status = 'suggest'; itemStates[idx].linkedId = null; itemStates[idx].linkedName = null;
    renderAll();
  };

  window.vdrMatchSkip = function(idx) { itemStates[idx].status = 'skip'; renderAll(); };

  window.vdrMatchShowSearch = function(idx) {
    const el = document.getElementById('vdrMSearch-'+idx);
    if (el) { el.style.display='block'; document.getElementById('vdrMInput-'+idx)?.focus(); }
  };

  window.vdrMatchConfirmSearch = async function(idx) {
    const input = document.getElementById('vdrMInput-'+idx);
    const val = input?.value.trim();
    if (!val) return;
    const { data: found } = await sb.from('ingredients').select('id,name').ilike('name', val).limit(1);
    if (found?.length) {
      window.vdrMatchLink(idx, found[0].id, found[0].name, null);
    } else {
      const { data: created } = await sb.from('ingredients').insert({ name: val, base_unit: 'g', active: true }).select('id').single();
      if (created) window.vdrMatchLink(idx, created.id, val, null);
    }
  };

  window.vdrMatchDone = function(docId) {
    modal.remove();
    // Re-trigger approve now that all items are matched
    const btn = document.querySelector(`#vdrCard-${docId} button[onclick*="vdrApprove"]`);
    if (btn) btn.click();
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

// ── Warning severity lookup ───────────────────────────────────
function vdrCodeToSeverity(code) {
  const blocking = ['INV-PACK-001','OQR-008','DOC-PARSE-001','DOC-VENDOR-001','DOC-TYPE-001',
    'DOC-NOPARSER-001','INV-MATCH-001','INV-DUP-001','INV-OCR-001','PARSE_ERROR',
    'UNKNOWN_VENDOR','UNKNOWN_DOC_TYPE','NO_PARSER','PARSER_ERROR','DOC-TOTAL-001','PROCESS_ERROR'];
  const insight  = ['INV-SUB-001','OQR-002','INV-PACKCT-001','OQR-006','INV-PRICE-001','INV-UNUSED-001'];
  if (blocking.includes(code)) return 'blocking';
  if (insight.includes(code))  return 'insight';
  return 'alert';
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


