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
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding-top:env(safe-area-inset-top,0px);">
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
    <div style="padding:16px;max-width:640px;width:100%;margin:0 auto;padding-bottom:100px;">
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
        console.log('[VDR] rawText preview:', rawText.slice(0, 500));

        // Parse with Hardie's parser
        const parsed = parsers.parse(rawText);
        console.log('[VDR] parsed vendor:', parsed.vendor, 'items:', parsed.items?.length, 'warnings:', parsed.warnings?.length);

        let docNumber = parsed.invoice_number || parsed.order_number || parsed.credit_number || null;
        // Fallback: extract from email subject, e.g. "INVOICE - #06997941"
        if (!docNumber && doc.source_email_subject) {
          const sm = doc.source_email_subject.match(/#?\s*(\d{6,10})/);
          if (sm) docNumber = sm[1];
        }
        const docDate   = parsed.order_date   || parsed.credit_date   || parsed.delivery_date || null;

        // Duplicate check by doc number
        if (docNumber) {
          const { data: byNum } = await sb.from('vendor_documents').select('id').eq('vendor', parsed.vendor).eq('document_number', docNumber).eq('document_type', parsed.document_type).neq('id', doc.id).limit(1);
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

        // ── INSERT into invoice_warnings (persistent analytics) ──
        // BIOS-009: warnings are never deleted. This is the source of truth
        // for the home banner. vdrResolveQuestion will UPDATE status→resolved.
        if (allWarnings.length > 0) {
          const warnRows = allWarnings
            .filter(w => w.code && !['OQR-006'].includes(w.code)) // OQR-006 auto-resolves in UI
            .map(w => ({
              document_id:      doc.id,
              vendor:           parsed.vendor || "Hardie's Fresh Foods / Dairyland Produce",
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
        ${vdrDetailHTMLNoApprove(doc)}
      </div>
      <!-- Sticky Approve footer -->
      <div style="flex-shrink:0;padding:12px 16px;border-top:1px solid #f1f5f9;background:white;">
        <div id="vdrActionStatus-${doc.id}" style="display:none;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:8px;"></div>
        <button onclick="vdrApprove('${doc.id}',this)" style="width:100%;height:48px;border-radius:14px;background:#1e293b;color:white;font-size:14px;font-weight:600;border:none;cursor:pointer;">Approve Document</button>
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
window.vdrCalcPack = function(pack, catchweight, actualWeightLb, ingredientName) {
  if (!pack) return null;
  var p = pack.trim();
  if (catchweight) {
    if (actualWeightLb) return actualWeightLb.toFixed(1) + 'lb (catchweight)';
    var lbm = p.match(/(\d+(?:\.\d+)?)\s*#/);
    if (lbm) return lbm[1] + 'lb';
    return null;
  }
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

    var rows = items.map(function(item, idx) {
      var hasWarning  = (item.warnings || []).length > 0;
      var name        = item.description || item.raw_description || '-';
      var mismatch    = isInvoice && item.qty_ordered !== item.qty_received && item.qty_received != null;

      // Valori iniziali (da edits store se gia modificati, altrimenti da item)
      var edits     = window._vdrEdits[docId][idx] || {};
      var qtyVal    = edits.qty      != null ? edits.qty      : (isCredit ? (item.qty_credited || '') : (item.qty_ordered || ''));
      var packVal   = edits.pack     != null ? edits.pack     : (item.pack_description || '');
      var unitVal   = edits.unitPrice!= null ? edits.unitPrice: (item.unit_price != null ? parseFloat(item.unit_price).toFixed(2) : (item.price_per_lb != null ? parseFloat(item.price_per_lb).toFixed(2) : ''));
      var extVal    = edits.ext      != null ? edits.ext      : (item.amount != null ? Math.abs(item.amount).toFixed(2) : '');

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
      var scText    = scParts.length ? scParts.join(' · ') : '—';
      var scColor   = scParts.length ? '#0369a1' : '#94a3b8';

      // Stili riga
      var labelColor  = hasWarning ? '#b45309' : '#059669';
      var labelBg     = hasWarning ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.07)';
      var labelBorder = hasWarning ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)';
      var labelIcon   = hasWarning ? 'Warning' : 'OK';
      var rowBorder   = hasWarning ? 'border-left:3px solid #f59e0b;' : 'border-left:3px solid #10b981;';
      var qtyColor    = mismatch ? '#ef4444' : '#1e293b';
      var rid         = docId + '-' + idx;
      var onInput     = 'window.vdrRecalcRow(\'' + docId + '\',' + idx + ',this)';

      return '<div data-vdr-row="' + rid + '" style="padding:10px 14px;border-bottom:1px solid #f1f5f9;' + rowBorder + '">' +

        // Riga 1: label + nome
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
          '<span style="font-size:10px;font-weight:700;color:' + labelColor + ';background:' + labelBg + ';border:1px solid ' + labelBorder + ';padding:1px 7px;border-radius:6px;white-space:nowrap;">' + labelIcon + '</span>' +
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
      '<div style="padding:4px 14px 6px;font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;">Items (' + items.length + ')</div>' +
      rows +
    '</div>';
  }

  // -- Approve --
  var approveHTML = '<div style="padding:12px 14px 14px;">' +
    '<div id="vdrActionStatus-' + docId + '" style="display:none;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:8px;"></div>' +
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
async function vdrPreflight(docId, doc) {
  const sb = window.supabaseClient;
  const pj = doc.parsed_json || {};
  const vendor = pj.vendor || doc.vendor || '';
  const items = pj.items || [];

  // 1. Unresolved warnings → count ACTIONABLE questions, not raw warnings.
  // Some warnings (e.g. pure-count OQR-006) are auto-resolved by the question
  // builder and produce no question — they must not block approval.
  const fakeDoc = { id: docId, warnings: doc.warnings, parsed_json: doc.parsed_json };
  const openQuestions = vdrBuildQuestions(fakeDoc).filter(q => !q.infoOnly);
  if (openQuestions.length > 0) {
    return { ok: false, reason: `${openQuestions.length} question${openQuestions.length>1?'s':''} to answer before approving — open the document detail.` };
  }

  // 2. Check ingredient_links — are all items matched?
  const descs = items.map(i => i.description || i.raw_description).filter(Boolean);
  const skus  = items.map(i => i.vendor_sku || i.item_code).filter(Boolean);

  // Fetch existing SKU matches
  const { data: skuRows } = skus.length ? await sb.from('ingredient_vendors')
    .select('vendor_sku').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] };
  const matchedSkus = new Set((skuRows || []).map(r => r.vendor_sku));

  // Fetch confirmed links
  const { data: linkRows } = descs.length ? await sb.from('ingredient_links')
    .select('invoice_description').eq('vendor', vendor).eq('confirmed', true)
    .in('invoice_description', descs) : { data: [] };
  const matchedDescs = new Set((linkRows || []).map(r => r.invoice_description));

  // Find unmatched items
  const unmatched = items.filter(item => {
    const sku  = item.vendor_sku || item.item_code;
    const desc = item.description || item.raw_description;
    return !(sku && matchedSkus.has(sku)) && !(desc && matchedDescs.has(desc));
  });

  if (unmatched.length > 0) {
    return { ok: false, reason: 'match_needed', unmatched, items, vendor };
  }

  return { ok: true, items, vendor };
}

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
      .from('vendor_documents').select('parsed_json,vendor,warnings,status,document_number').eq('id', docId).single();
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
    const invoiceDate = pj.invoice_date || null;
    const items = pj.items || [];

    // Batch fetch all needed data
    const skus = items.map(i => i.vendor_sku || i.item_code).filter(Boolean);
    const descs = items.map(i => i.description || i.raw_description).filter(Boolean);

    const [skuRes, ingrVendorRes, linkRes] = await Promise.all([
      skus.length ? sb.from('ingredient_vendors').select('id,ingredient_id,vendor_sku').eq('vendor', vendor).in('vendor_sku', skus) : { data: [] },
      sb.from('ingredient_vendors').select('id,ingredient_id').eq('vendor', vendor),
      descs.length ? sb.from('ingredient_links').select('invoice_description,ingredient_id').eq('vendor', vendor).eq('confirmed', true).in('invoice_description', descs) : { data: [] },
    ]);

    const skuMap = {};
    (skuRes.data || []).forEach(r => { skuMap[r.vendor_sku] = r; });
    const ingrVendorMap = {};
    (ingrVendorRes.data || []).forEach(r => { ingrVendorMap[r.ingredient_id] = r.id; });
    const linkMap = {};
    (linkRes.data || []).forEach(l => { linkMap[l.invoice_description] = l.ingredient_id; });

    const toUpdate = [];
    const toInsert = [];
    const processedIds = new Set();

    const docEdits = (window._vdrEdits && window._vdrEdits[docId]) || {};

    for (const [itemIdx, item] of items.entries()) {
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

      if (ingrVendorMap[linkedId]) {
        toUpdate.push({ id: ingrVendorMap[linkedId], ...fields });
      } else {
        toInsert.push({ ingredient_id: linkedId, vendor, vendor_sku: sku, active: true, ...fields });
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


    // ── Populate invoice_lines (invoices only) ────────────────────
    if (pj.document_type === 'invoice') {
      const invoiceLineRows = items.map((item, itemIdx) => {
        const edits       = docEdits[itemIdx] || {};
        const desc        = item.description || item.raw_description || null;
        const sku         = item.vendor_sku || item.item_code || null;
        const qty         = (edits.qty != null && !isNaN(edits.qty)) ? edits.qty : (item.qty_ordered || item.qty_received || null);
        const pack        = (edits.pack != null && edits.pack !== '') ? edits.pack : (item.pack_description || null);
        const unitPrice   = (edits.unitPrice != null && !isNaN(edits.unitPrice)) ? edits.unitPrice : (item.unit_price != null ? parseFloat(item.unit_price) : null);
        const lineTotal   = (edits.ext != null && !isNaN(edits.ext)) ? edits.ext : (item.amount != null ? Math.abs(item.amount) : null);

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

        // ingredient_id — look up from skuMap or linkMap built earlier
        const matchedId = (sku && skuMap[sku]) ? skuMap[sku].ingredient_id
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
        if (ilErr) console.warn('invoice_lines insert warning:', ilErr.message);
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

    const statsLine = [
      toInsert.length ? `${toInsert.length} nuovo${toInsert.length !== 1 ? 'i' : ''}` : '',
      toUpdate.length ? `${toUpdate.length} aggiornato${toUpdate.length !== 1 ? 'i' : ''}` : '',
    ].filter(Boolean).join(' · ') || `${items.length} articoli`;

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
          <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Articoli importati</div>
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

