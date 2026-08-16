// ══════════════════════════════════════════════════════════════
// PURCHASE ORDER — Compila Ordine (Draft v1)
// Dictate/type a shopping list, match against existing vendor catalog,
// review and correct, save as a draft purchase_order.
// NOT in scope here: Tell Chef integration, Chef's Warehouse login,
// browser automation, sending the order, receiving goods.
// Access: admin + allowlisted staff ids (Tela, Anto) — see _PO_ALLOWED_IDS.
// ══════════════════════════════════════════════════════════════

var PO_VENDOR = "Hardie's Fresh Foods / Dairyland Produce"; // Chef's Warehouse / Hardie's — normalized vendor string used across the DB

var _PO_ALLOWED_IDS = [2, 3]; // Anto (Chef Rover), Tela (Kitchen Operation Coordinator) — Max covered by isAdmin()

var PO_KNOWN_UNITS = ['case','cases','lb','lbs','kg','g','oz','box','boxes','bunch','bunches',
  'each','ea','dozen','doz','pack','packs','bag','bags','gallon','gal','qt','pt','can','cans','case(s)'];

var _poAliasCatalog = [];
var _poIngVendorCatalog = [];
var _poLinkCatalog = [];
var _poCatalogLoaded = false;
var _poCatalogLoading = null;

var _poDraftLines = [];      // working lines currently in the review screen
var _poEditingOrderId = null; // set when reopening an existing draft
var _poView = 'list';         // 'list' (composer + open drafts) | 'review'
var _poOpenDrafts = [];

var _poRecording = false;
var _poMediaRecorder = null;
var _poAudioChunks = [];

// ── ACCESS ──────────────────────────────────────────────────────
function poAllowed(){
  if(!window.user) return false;
  if(window.user.is_admin === true || window.user.role === 'admin') return true;
  return _PO_ALLOWED_IDS.indexOf(window.user.id) >= 0;
}

// ── HOME ENTRY WIDGET ───────────────────────────────────────────
window.initPurchaseOrderEntry = function(){
  var el = document.getElementById('poEntryWidget');
  if(!el) return;
  el.style.display = poAllowed() ? 'block' : 'none';
};

// ── OPEN PAGE ────────────────────────────────────────────────────
window.openPurchaseOrder = function(){
  if(!poAllowed()) return;
  if(typeof showSection === 'function') showSection('vpo');
  _poView = 'list';
  _poDraftLines = [];
  _poEditingOrderId = null;
  poRenderPage();
  poLoadOpenDrafts();
};

// ── CATALOG LOADING (once per session) ──────────────────────────
async function poLoadCatalog(){
  if(_poCatalogLoaded) return;
  if(_poCatalogLoading) return _poCatalogLoading;
  _poCatalogLoading = (async function(){
    var sb = window.supabaseClient;
    var [alias, iv, links] = await Promise.all([
      sb.from('vendor_item_aliases').select('id,vendor_sku,vendor_description,ingredient_id')
        .eq('vendor', PO_VENDOR).eq('active', true),
      sb.from('ingredient_vendors').select('id,vendor_sku,ingredient_id,ingredients(name)')
        .eq('vendor', PO_VENDOR).eq('active', true).eq('do_not_order', false),
      sb.from('ingredient_links').select('id,invoice_description,ingredient_name,ingredient_id,confidence')
        .eq('vendor', PO_VENDOR)
    ]);
    _poAliasCatalog = alias.data || [];
    _poIngVendorCatalog = (iv.data || []).map(function(r){
      return { id:r.id, vendor_sku:r.vendor_sku, ingredient_id:r.ingredient_id, name: r.ingredients ? r.ingredients.name : null };
    });
    _poLinkCatalog = links.data || [];
    _poCatalogLoaded = true;
  })();
  return _poCatalogLoading;
}

// ── TEXT NORMALIZATION / MATCHING (simple, no NLP) ───────────────
function poNormalize(s){
  return (s || '').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}

function poScore(a, b){
  if(!a || !b) return 0;
  if(a === b) return 1;
  if(b.indexOf(a) >= 0 || a.indexOf(b) >= 0){
    var shorter = Math.min(a.length, b.length), longer = Math.max(a.length, b.length);
    return 0.6 + 0.3 * (shorter / longer);
  }
  var at = a.split(' '), bt = b.split(' ');
  var common = at.filter(function(w){ return w.length > 2 && bt.indexOf(w) >= 0; });
  if(common.length === 0) return 0;
  return 0.25 + 0.25 * (common.length / Math.max(at.length, bt.length));
}

function poBestInCatalog(qNorm, catalog, field){
  var best = null, bestScore = 0;
  catalog.forEach(function(item){
    var s = poScore(qNorm, poNormalize(item[field]));
    if(s > bestScore){ bestScore = s; best = item; }
  });
  return best ? { item: best, score: bestScore } : null;
}

// Fallback: once we know an ingredient_id via ingredient_links, see if the
// same ingredient also has a vendor SKU in ingredient_vendors (already loaded).
function poSkuForIngredient(ingredientId){
  if(!ingredientId) return null;
  var hit = _poIngVendorCatalog.find(function(r){ return r.ingredient_id === ingredientId; });
  return hit ? hit.vendor_sku : null;
}

function poMatchItem(itemText){
  var q = poNormalize(itemText);
  var aBest = poBestInCatalog(q, _poAliasCatalog, 'vendor_description');
  var ivBest = poBestInCatalog(q, _poIngVendorCatalog, 'name');
  var lkBest = poBestInCatalog(q, _poLinkCatalog, 'ingredient_name');

  function build(match, source){
    var item = match.item;
    var name = source === 'vendor_item_aliases' ? item.vendor_description
             : source === 'ingredient_vendors' ? item.name
             : item.ingredient_name;
    var sku = item.vendor_sku || poSkuForIngredient(item.ingredient_id);
    return {
      matched: true,
      needsReview: false,
      ingredient_id: item.ingredient_id,
      matched_name: name,
      vendor_sku: sku || null,
      confidence: Math.round(match.score * 100) / 100,
      source: source
    };
  }

  // Tier 1: confirmed vendor aliases — trust a strong hit outright
  if(aBest && aBest.score >= 0.85) return build(aBest, 'vendor_item_aliases');
  // Tier 2: known vendor catalog
  if(ivBest && ivBest.score >= 0.85) return build(ivBest, 'ingredient_vendors');

  // Nothing confidently above threshold — gather every plausible candidate
  // across all three tiers and let the human decide. Never silently pick.
  var candidates = [];
  if(aBest && aBest.score >= 0.3) candidates.push({ match: aBest, source: 'vendor_item_aliases' });
  if(ivBest && ivBest.score >= 0.3) candidates.push({ match: ivBest, source: 'ingredient_vendors' });
  if(lkBest && lkBest.score >= 0.3) candidates.push({ match: lkBest, source: 'ingredient_links' });
  candidates.sort(function(x, y){ return y.match.score - x.match.score; });

  if(candidates.length === 0) return { matched: false, needsReview: true, candidates: [] };

  var top = candidates[0];
  var clearWinner = candidates.length === 1 || (top.match.score - candidates[1].match.score) > 0.15;
  if(top.match.score >= 0.85 && clearWinner) return build(top.match, top.source);

  // Ambiguous or low confidence — flag for manual review, keep candidates for the picker
  var built = candidates.slice(0, 3).map(function(c){ return build(c.match, c.source); });
  return { matched: false, needsReview: true, candidates: built };
}

// ── LINE PARSING (trailing "<item> <qty> [<unit>]", no invented data) ──
function poParseLine(raw){
  var line = (raw || '').trim();
  if(!line) return null;
  var m = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z()]+)?$/);
  if(m){
    var itemText = m[1].trim();
    var qty = parseFloat(m[2].replace(',', '.'));
    var unitWord = (m[3] || '').toLowerCase();
    var unit = PO_KNOWN_UNITS.indexOf(unitWord) >= 0 ? unitWord : null;
    if(m[3] && !unit) itemText = itemText + ' ' + m[3]; // not a recognized unit — keep it as part of the text, don't discard
    return { requested_text: itemText, quantity: isNaN(qty) ? null : qty, unit: unit };
  }
  return { requested_text: line, quantity: null, unit: null }; // no recognizable qty — leave fully editable
}

// ── PARSE + MATCH → build review lines ───────────────────────────
window.poParseAndMatch = async function(){
  var ta = document.getElementById('poInputText');
  var text = ta ? ta.value : '';
  var rawLines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  if(rawLines.length === 0){ poToast('Scrivi o detta almeno una riga.'); return; }

  var btn = document.getElementById('poCreateBtn');
  if(btn){ btn.disabled = true; btn.textContent = '…'; }

  await poLoadCatalog();

  _poDraftLines = rawLines.map(function(raw){
    var parsed = poParseLine(raw);
    var m = poMatchItem(parsed.requested_text);
    return {
      requested_text: parsed.requested_text,
      quantity: parsed.quantity,
      unit: parsed.unit,
      ingredient_id: m.matched ? m.ingredient_id : null,
      matched_name: m.matched ? m.matched_name : null,
      vendor_sku: m.matched ? m.vendor_sku : null,
      match_confidence: m.matched ? m.confidence : null,
      match_source: m.matched ? m.source : 'manual',
      needs_review: !m.matched,
      candidates: m.candidates || []
    };
  });

  if(btn){ btn.disabled = false; btn.textContent = 'Crea ordine'; }
  _poView = 'review';
  poRenderPage();
};

// ── REVIEW LINE EDITS ─────────────────────────────────────────────
window.poLineSetQty = function(i, val){
  var n = parseFloat(String(val).replace(',', '.'));
  _poDraftLines[i].quantity = isNaN(n) ? null : n;
};
window.poLineSetUnit = function(i, val){ _poDraftLines[i].unit = val.trim() || null; };
window.poLineSetText = function(i, val){ _poDraftLines[i].requested_text = val.trim(); };

window.poLineSetProduct = function(i, encoded){
  var line = _poDraftLines[i];
  if(encoded === '__manual__'){
    line.ingredient_id = null; line.matched_name = null; line.vendor_sku = null;
    line.match_confidence = null; line.match_source = 'manual'; line.needs_review = false;
    poRenderPage();
    return;
  }
  var cand = line.candidates[parseInt(encoded, 10)];
  if(!cand) return;
  line.ingredient_id = cand.ingredient_id;
  line.matched_name = cand.matched_name;
  line.vendor_sku = cand.vendor_sku;
  line.match_confidence = cand.confidence;
  line.match_source = cand.source;
  line.needs_review = false;
  poRenderPage();
};

window.poLineRemove = function(i){
  _poDraftLines.splice(i, 1);
  poRenderPage();
};

window.poLineAddManual = function(){
  _poDraftLines.push({
    requested_text: '', quantity: null, unit: null, ingredient_id: null,
    matched_name: null, vendor_sku: null, match_confidence: null,
    match_source: 'manual', needs_review: false, candidates: []
  });
  poRenderPage();
  setTimeout(function(){
    var inputs = document.querySelectorAll('.po-line-text');
    if(inputs.length) inputs[inputs.length - 1].focus();
  }, 30);
};

// ── SAVE DRAFT ─────────────────────────────────────────────────────
window.poSaveDraft = async function(){
  if(_poDraftLines.length === 0){ poToast('Nessuna riga da salvare.'); return; }
  var sb = window.supabaseClient;
  var btn = document.getElementById('poSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = '…'; }

  try{
    var orderId = _poEditingOrderId;
    if(!orderId){
      var ins = await sb.from('purchase_orders').insert({
        vendor_name: PO_VENDOR,
        status: 'draft',
        created_by: (window.user && window.user.name) || 'Unknown'
      }).select('id').single();
      if(ins.error) throw ins.error;
      orderId = ins.data.id;
    } else {
      // Reopened draft — replace its lines cleanly rather than trying to diff them
      var del = await sb.from('purchase_order_lines').delete().eq('purchase_order_id', orderId);
      if(del.error) throw del.error;
    }

    var rows = _poDraftLines.map(function(l){
      return {
        purchase_order_id: orderId,
        ingredient_id: l.ingredient_id || null,
        vendor_name: PO_VENDOR,
        vendor_sku: l.vendor_sku || null,
        requested_text: l.requested_text,
        matched_name: l.matched_name || null,
        quantity: l.quantity,
        unit: l.unit || null,
        match_confidence: l.match_confidence,
        match_source: l.match_source || 'manual'
      };
    });
    var insLines = await sb.from('purchase_order_lines').insert(rows);
    if(insLines.error) throw insLines.error;

    poToast('Bozza salvata ✓');
    _poView = 'list';
    _poDraftLines = [];
    _poEditingOrderId = null;
    poRenderPage();
    poLoadOpenDrafts();
  }catch(e){
    console.error('[purchase-order] save error', e);
    poToast('Errore nel salvataggio');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Salva bozza'; }
  }
};

// ── OPEN DRAFTS LIST ────────────────────────────────────────────────
async function poLoadOpenDrafts(){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('purchase_orders')
    .select('id,status,created_by,created_at,notes')
    .eq('vendor_name', PO_VENDOR)
    .in('status', ['draft', 'ready'])
    .order('created_at', { ascending: false });
  if(error){ console.error('[purchase-order] load drafts error', error); return; }
  _poOpenDrafts = data || [];
  if(_poView === 'list') poRenderPage();
}

window.poOpenDraft = async function(orderId){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('purchase_order_lines')
    .select('*').eq('purchase_order_id', orderId).order('created_at', { ascending: true });
  if(error){ poToast('Errore nel caricamento'); return; }
  _poDraftLines = (data || []).map(function(l){
    return {
      requested_text: l.requested_text, quantity: l.quantity, unit: l.unit,
      ingredient_id: l.ingredient_id, matched_name: l.matched_name, vendor_sku: l.vendor_sku,
      match_confidence: l.match_confidence, match_source: l.match_source,
      needs_review: !l.ingredient_id && l.match_source !== 'manual', candidates: []
    };
  });
  _poEditingOrderId = orderId;
  _poView = 'review';
  poRenderPage();
};

// ── VOICE INPUT (reuses transcribe-audio, same call pattern as Sous Chef) ──
window.poToggleMic = function(){
  if(_poRecording) poStopRecording(); else poStartRecording();
};

async function poStartRecording(){
  if(_poRecording) return;
  try{
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _poAudioChunks = [];
    var mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' :
                   MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    _poMediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType } : {});
    _poMediaRecorder.ondataavailable = function(e){ _poAudioChunks.push(e.data); };
    _poMediaRecorder.start();
    _poRecording = true;
    var btn = document.getElementById('poMicBtn');
    if(btn) btn.classList.add('po-mic-active');
    poToast('🎙️ Sto ascoltando...');
  }catch(e){
    poToast('❌ Microfono non disponibile');
  }
}

function poStopRecording(){
  if(!_poRecording || !_poMediaRecorder) return;
  _poRecording = false;
  var btn = document.getElementById('poMicBtn');
  if(btn) btn.classList.remove('po-mic-active');
  _poMediaRecorder.stop();
  _poMediaRecorder.stream.getTracks().forEach(function(t){ t.stop(); });
  poToast('⏳ Trascrizione...');
  _poMediaRecorder.onstop = async function(){
    var mt = _poMediaRecorder.mimeType || 'audio/mp4';
    var blob = new Blob(_poAudioChunks, { type: mt });
    await poTranscribeAudio(blob, mt);
  };
}

async function poTranscribeAudio(blob, mimeType){
  try{
    var base64Audio = await new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(reader.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    var res = await fetch(SUPABASE_URL + '/functions/v1/transcribe-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ audio: base64Audio, mimeType: mimeType, language: (window.user && window.user.lang) || 'en' })
    });
    var data = await res.json();
    var transcript = (data.text || '').trim();
    if(!transcript){ poToast('❌ Non ho sentito nulla. Riprova.'); return; }
    var ta = document.getElementById('poInputText');
    if(ta){ ta.value = (ta.value ? ta.value + '\n' : '') + transcript; }
    poToast('Aggiunto: "' + transcript.slice(0, 40) + '"');
  }catch(e){
    poToast('❌ Errore trascrizione');
  }
}

// ── TOAST (falls back to Sous Chef toast if present) ─────────────
function poToast(msg){
  if(typeof showScToast === 'function') showScToast(msg);
  else console.log('[purchase-order]', msg);
}

// ── RENDER ─────────────────────────────────────────────────────────
function _poEsc(s){ return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

function poRenderPage(){
  var el = document.getElementById('poContent');
  if(!el) return;
  el.innerHTML = _poView === 'review' ? poRenderReview() : poRenderList();
}

function poRenderList(){
  var html = '';
  html += '<div style="background:rgba(255,255,255,0.7);border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-bottom:16px;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:8px;">Detta o scrivi la lista</div>';
  html += '<textarea id="poInputText" rows="6" placeholder="heavy cream 2 cases\nparsley 3\nbrussels sprouts 10 lb\nlemons 1 case" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>';
  html += '<div style="display:flex;gap:8px;margin-top:10px;">';
  html += '<button id="poMicBtn" onclick="poToggleMic()" style="width:44px;height:44px;border-radius:12px;border:1px solid #e2e8f0;background:white;font-size:18px;cursor:pointer;flex-shrink:0;">🎙️</button>';
  html += '<button id="poCreateBtn" onclick="poParseAndMatch()" style="flex:1;height:44px;border-radius:12px;background:#1e3a5f;color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;">Crea ordine</button>';
  html += '</div></div>';
  html += '<style>.po-mic-active{background:#dbeafe !important;border-color:#3b82f6 !important;}</style>';

  html += '<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px;">Bozze aperte — ' + _poEsc(PO_VENDOR) + '</div>';
  if(_poOpenDrafts.length === 0){
    html += '<div style="font-size:13px;color:#94a3b8;padding:12px 0;">Nessuna bozza aperta.</div>';
  } else {
    _poOpenDrafts.forEach(function(d){
      var date = new Date(d.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      html += '<div onclick="poOpenDraft(\'' + d.id + '\')" style="background:rgba(255,255,255,0.7);border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">';
      html += '<div><div style="font-size:13px;font-weight:600;color:#1e3a5f;">' + _poEsc(d.created_by || 'Unknown') + ' · ' + _poEsc(d.status) + '</div>';
      html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + date + '</div></div>';
      html += '<span style="color:#94a3b8;">&#8250;</span></div>';
    });
  }
  return html;
}

function poRenderReview(){
  var html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;">Revisiona ' + _poDraftLines.length + ' righe</div>';
  html += '<button onclick="_poView=\'list\';poRenderPage();poLoadOpenDrafts();" style="font-size:12px;color:#3B82F6;background:none;border:none;cursor:pointer;">&#8249; Indietro</button>';
  html += '</div>';

  _poDraftLines.forEach(function(l, i){
    var badge = '';
    if(l.match_source === 'manual' && !l.matched_name){
      badge = '<span style="font-size:10px;color:#92400e;background:#fef3c7;padding:2px 6px;border-radius:6px;">manuale</span>';
    } else if(l.needs_review){
      badge = '<span style="font-size:10px;color:#92400e;background:#fef3c7;padding:2px 6px;border-radius:6px;">⚠ da verificare</span>';
    } else if(l.match_confidence >= 0.85){
      badge = '<span style="font-size:10px;color:#166534;background:#dcfce7;padding:2px 6px;border-radius:6px;">✓ ' + l.match_source.replace(/_/g,' ') + '</span>';
    } else if(l.matched_name){
      badge = '<span style="font-size:10px;color:#1e40af;background:#dbeafe;padding:2px 6px;border-radius:6px;">~ simile</span>';
    }

    html += '<div style="background:rgba(255,255,255,0.7);border:1px solid ' + (l.needs_review ? '#fbbf24' : '#e2e8f0') + ';border-radius:12px;padding:12px;margin-bottom:10px;">';
    html += '<input class="po-line-text" value="' + _poEsc(l.requested_text) + '" oninput="poLineSetText(' + i + ',this.value)" style="width:100%;border:none;font-size:14px;font-weight:600;color:#1e3a5f;padding:0 0 6px;background:transparent;">';

    html += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">';
    html += '<input type="number" value="' + (l.quantity != null ? l.quantity : '') + '" oninput="poLineSetQty(' + i + ',this.value)" placeholder="qty" style="width:64px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
    html += '<input type="text" value="' + _poEsc(l.unit || '') + '" oninput="poLineSetUnit(' + i + ',this.value)" placeholder="unit" style="width:80px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
    html += badge;
    html += '<button onclick="poLineRemove(' + i + ')" style="margin-left:auto;background:none;border:none;color:#ef4444;font-size:16px;cursor:pointer;padding:4px;">🗑</button>';
    html += '</div>';

    // Product select — current match + candidates + manual
    html += '<select onchange="poLineSetProduct(' + i + ',this.value)" style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;background:white;">';
    if(l.matched_name){
      html += '<option value="current" selected>' + _poEsc(l.matched_name) + (l.vendor_sku ? ' · SKU ' + _poEsc(l.vendor_sku) : '') + '</option>';
    } else {
      html += '<option value="__manual__" selected>Nessun prodotto (manuale)</option>';
    }
    (l.candidates || []).forEach(function(c, ci){
      if(c.matched_name === l.matched_name) return;
      html += '<option value="' + ci + '">' + _poEsc(c.matched_name) + (c.vendor_sku ? ' · SKU ' + _poEsc(c.vendor_sku) : '') + ' (' + Math.round(c.confidence*100) + '%)</option>';
    });
    if(l.matched_name) html += '<option value="__manual__">Nessun prodotto (manuale)</option>';
    html += '</select>';

    html += '</div>';
  });

  html += '<button onclick="poLineAddManual()" style="width:100%;padding:10px;border:1px dashed #cbd5e1;border-radius:10px;background:none;color:#64748b;font-size:13px;cursor:pointer;margin-bottom:16px;">+ Aggiungi riga</button>';
  html += '<button id="poSaveBtn" onclick="poSaveDraft()" style="width:100%;height:46px;border-radius:12px;background:#1e3a5f;color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;">Salva bozza</button>';
  return html;
}
