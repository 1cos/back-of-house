// Testability: in a real browser `window` always exists, so this is a no-op there.
// It only kicks in when this file is require()'d from plain Node (see tests/).
if (typeof window === 'undefined') { global.window = global; }

// ══════════════════════════════════════════════════════════════
// PURCHASE ORDER — Compila Ordine (Multi-vendor Draft v2)
// Dictate/type a shopping list, resolve each item's real vendor from
// proven product-level evidence, match against that vendor's catalog,
// review and correct, save into one draft per vendor.
// XCF-ORDINI (02/10/2026): bozza -> riepilogo con hash -> conferma Max ->
// invio (edge send-purchase-order, SOLO SIMULAZIONE finche' Max non decide)
// o invio manuale registrato -> conferma fornitore -> ricevimento. Tutte le
// scritture passano dalle RPC po_* (sessione Brigade + ruolo sul server).
// NOT in scope here: vendor portal logins, browser automation.
// Access: admin + allowlisted staff ids (Tela, Anto) — see _PO_ALLOWED_IDS.
// ══════════════════════════════════════════════════════════════

// Canonical vendor name normalization — code-only map, no migration.
// Real production data uses these exact canonical strings; the keys
// below are known real-world variants that should converge to them.
// BEK and Marro are documented here for display/normalization only —
// see _poEligibleVendors below for why they don't get product routing yet.
var PO_VENDOR_CANONICAL = {
  "hardie's": "Hardie's Fresh Foods / Dairyland Produce",
  "hardies": "Hardie's Fresh Foods / Dairyland Produce",
  "hardie's fresh foods": "Hardie's Fresh Foods / Dairyland Produce",
  "hardie's fresh foods / dairyland produce": "Hardie's Fresh Foods / Dairyland Produce",
  "chef's warehouse": "Hardie's Fresh Foods / Dairyland Produce",
  "chefs warehouse": "Hardie's Fresh Foods / Dairyland Produce",
  "the chefs' warehouse": "Hardie's Fresh Foods / Dairyland Produce",
  "fruge seafood": "Fruge Seafood",
  "frugé seafood": "Fruge Seafood",
  "freshpoint dallas": "FreshPoint Dallas",
  "freshpoint": "FreshPoint Dallas",
  "h-e-b": "H-E-B",
  "heb": "H-E-B",
  "walmart": "Walmart",
  "bek": "Ben E. Keith",
  "ben e keith": "Ben E. Keith",
  "ben e. keith": "Ben E. Keith",
  "marro": "Marro",
  "mauro": "Marro" // real production data uses "Marro" — documented alias only
};
function poNormalizeVendorName(raw){
  if(!raw) return null;
  var key = raw.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
  return PO_VENDOR_CANONICAL[key] || raw.trim();
}

// Responsibility — centralized, derived from canonical vendor name (v1, no schema field).
function poResponsibleFor(vendorName){
  return vendorName === 'Walmart' ? 'Anto' : 'Tela';
}

var _PO_ALLOWED_IDS = [2, 3]; // Anto (Chef Rover), Tela (Kitchen Operation Coordinator) — Max covered by isAdmin()

var PO_KNOWN_UNITS = ['case','cases','lb','lbs','kg','g','oz','box','boxes','bunch','bunches',
  'each','ea','dozen','doz','pack','packs','bag','bags','gallon','gal','qt','pt','can','cans','case(s)'];

var _poAliasCatalog = [];
var _poIngVendorCatalog = [];
var _poLinkCatalog = [];
var _poInvoiceLineRows = [];  // ingredient_id+vendor rows, all vendors — tier-3 evidence + dominance tie-break
var _poPurchaseFreq = {};     // ingredient_id -> total purchase count across all vendors (existing text-match tiebreak)
var _poPurchaseFreqByVendor = {}; // "ingredientId|vendor" -> count (new — vendor dominance tie-break)
var _poEligibleVendors = {};  // vendor -> true, only vendors with cross-table product-level corroboration
var _poCatalogLoaded = false;
var _poCatalogLoading = null;

var _poDraftLines = [];      // working lines currently in the review screen (may span multiple vendors)
var _poEditingOrderId = null; // set when reopening one existing single-vendor draft
var _poEditingVendor = null;  // the vendor of that opened draft (null if composing fresh)

// Tell Chef bridge: office_items.id awaiting "added_to_order" ack. Set only
// when review was entered from a Tell Chef shortage; cleared after a
// successful poSaveDraft() (or when the user leaves without saving). Never
// set chef_action on tap alone — only after real persistence.
var _poPendingOfficeItemId = null;
var _poView = 'list';         // 'list' (composer + open drafts) | 'review'

// ── PURCHASE RHYTHM — "Check Before Ordering" (readonly, non-blocking) ────
// Wired to js/purchase-rhythm.js (window.PurchaseRhythm bridge, since that
// file is a native ES module and this one is a classic script). No formula
// or equivalence config lives here — this only fetches data and renders.
var _poRhythmResults = null;   // null = not loaded yet; [] = loaded, nothing useful
var _poRhythmLoading = false;
var _poOpenDrafts = [];       // all open drafts (draft+ready), any vendor

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

// ── HOME PURCHASING PANELS (Anto: Walmart only / Tela: everything else) ──
// Built only from real open drafts — an empty vendor never gets a fabricated
// row just to make a panel non-empty (e.g. Walmart today, per the audit).
window.initVendorHomePanels = async function(){
  var antoEl = document.getElementById('antoPurchasingWidget');
  var telaEl = document.getElementById('telaPurchasingWidget');
  if(antoEl) antoEl.style.display = 'none';
  if(telaEl) telaEl.style.display = 'none';

  var name = window.user && window.user.name;
  var isAnto = name === 'Anto';
  var isTela = name === 'Tela';
  if((!isAnto && !isTela) || !poAllowed()) return;

  // XCF-ORDINI: contatori via RPC (sessione Brigade), non piu' select diretta.
  var r = await poRpc('po_home_counts', {});
  if(!r.ok){ console.error('[purchase-order] home panel error', r); return; }
  var counts = r.draft_lines_by_vendor || {};

  if(isAnto && antoEl){
    var n = (counts['Walmart'] || 0) + (counts['Walmart Business'] || 0);
    if(n > 0){
      antoEl.style.display = 'block';
      var body = antoEl.querySelector('[data-role="body"]');
      if(body) body.textContent = n + (n === 1 ? ' item' : ' items') + ' to review';
    }
  }

  if(isTela && telaEl){
    var rows = Object.keys(counts).filter(function(v){ return v !== 'Walmart' && v !== 'Walmart Business'; }).sort();
    if(rows.length > 0){
      telaEl.style.display = 'block';
      var telaBody = telaEl.querySelector('[data-role="body"]');
      if(telaBody){
        telaBody.innerHTML = rows.map(function(v){
          return '<div style="display:flex;justify-content:space-between;font-size:13px;color:#475569;padding:3px 0;"><span>' +
            _poEsc(v) + '</span><span style="color:#94a3b8;">' + counts[v] + '</span></div>';
        }).join('');
      }
    }
  }
};

// ── TELL CHEF → COMPILA ORDINE BRIDGE ──────────────────────────────
// Entry point called from office.js when an authorized user taps
// "🛒 Add to Order" on an INVENTORY_SHORTAGE card. Reuses poMatchItem()
// as-is — including its built-in v808 vendor resolution — plus the
// existing review screen and poSaveDraft(). No parallel matcher, no
// parallel vendor logic, no parallel persistence. Does not touch
// office_items itself; that only happens inside poSaveDraft() after a
// real successful save (see _poPendingOfficeItemId).
window.poAddTellChefShortage = async function(officeItemId, ingredientName){
  if(!poAllowed()) return false; // safety net — button shouldn't render otherwise

  var text = (ingredientName || '').trim();
  if(!text){
    poToast('Nessun ingrediente rilevato — usa Compila Ordine manualmente.');
    return false;
  }

  await poLoadCatalog();
  var m = poMatchItem(text);

  // No product match at all, or a product matched but with no safe vendor
  // evidence (v808's own resolution said 'unresolved') — never guess a
  // vendor for a Tell Chef-originated line. Ambiguous (real candidates,
  // no dominance) is different: that still gets a human vendor picker
  // in review, same as manual Compila Ordine entry.
  if(!m.ingredient_id || m.vendorStatus === 'unresolved'){
    poToast('No supported vendor match yet — ' + text);
    return false;
  }

  var newLine = {
    requested_text: text, quantity: null, unit: null,
    ingredient_id: m.ingredient_id, matched_name: m.matched_name, vendor_sku: m.vendor_sku,
    match_confidence: m.confidence, match_source: m.source, needs_review: !!m.needsReview,
    candidates: m.candidates || [],
    vendor: m.vendor || null, vendor_status: m.vendorStatus, vendor_candidates: m.vendorCandidates || []
  };

  // Fresh single-line review session — poSaveDraft() already knows how to
  // find-or-create the resolved vendor's draft and preserve its existing
  // lines (same path as any first-touch vendor in a normal session), so
  // the bridge does not need to preload anything itself.
  _poDraftLines = [newLine];
  _poEditingOrderId = null;
  _poEditingVendor = null;
  _poPendingOfficeItemId = officeItemId; // set now; office_items written only after real poSaveDraft() success

  if(typeof showSection === 'function') showSection('vpo');
  _poView = 'review';
  poRenderPage();
  return true;
};

window.poBackToList = function(){
  // Leaving without saving must not leave a stale ack pending — entering
  // review is not persistence; if abandoned, nothing changed.
  _poPendingOfficeItemId = null;
  _poRhythmResults = null;
  _poRhythmLoading = false;
  _poEditingOrderId = null;
  _poEditingVendor = null;
  _poEditingRevision = null;
  _poCurrentOrder = null;
  _poCandidates = null;
  _poView = 'list';
  poRenderPage();
  poLoadOpenDrafts();
};

// ── OPEN PAGE ────────────────────────────────────────────────────
window.openPurchaseOrder = function(){
  if(!poAllowed()) return;
  if(typeof showSection === 'function') showSection('vpo');
  _poView = 'list';
  _poDraftLines = [];
  _poEditingOrderId = null;
  _poEditingVendor = null;
  _poEditingRevision = null;
  _poCurrentOrder = null;
  _poDeliveryDate = '';
  _poPendingOfficeItemId = null; // manual entry — not a Tell Chef bridge session
  poRenderPage();
  poLoadOpenDrafts();
};

// ── CATALOG LOADING (once per session, all vendors) ──────────────
async function poLoadCatalog(){
  if(_poCatalogLoaded) return;
  if(_poCatalogLoading) return _poCatalogLoading;
  _poCatalogLoading = (async function(){
    var sb = window.supabaseClient;
    var [alias, iv, links, invLines] = await Promise.all([
      sb.from('vendor_item_aliases').select('id,vendor,vendor_sku,vendor_description,ingredient_id').eq('active', true),
      sb.from('ingredient_vendors').select('id,vendor,vendor_sku,ingredient_id,purchase_unit,ingredients(name,name_it)').eq('active', true).eq('do_not_order', false),
      sb.from('ingredient_links').select('id,vendor,invoice_description,ingredient_name,ingredient_id,confidence,confirmed'),
      sb.from('invoice_lines').select('vendor,ingredient_id,purchase_unit,invoice_date').not('ingredient_id', 'is', null)
    ]);
    _poAliasCatalog = alias.data || [];
    _poIngVendorCatalog = (iv.data || []).map(function(r){
      return { id:r.id, vendor:r.vendor, vendor_sku:r.vendor_sku, ingredient_id:r.ingredient_id, purchase_unit: r.purchase_unit || null,
               name: r.ingredients ? r.ingredients.name : null, name_it: r.ingredients ? r.ingredients.name_it : null };
    });
    _poLinkCatalog = links.data || [];
    _poInvoiceLineRows = invLines.data || [];

    _poPurchaseFreq = {};
    _poPurchaseFreqByVendor = {};
    _poInvoiceLineRows.forEach(function(r){
      if(!r.ingredient_id) return;
      _poPurchaseFreq[r.ingredient_id] = (_poPurchaseFreq[r.ingredient_id] || 0) + 1;
      var key = r.ingredient_id + '|' + r.vendor;
      _poPurchaseFreqByVendor[key] = (_poPurchaseFreqByVendor[key] || 0) + 1;
    });

    // Vendor eligibility: a vendor may receive automatic product routing
    // only if it has BOTH a catalog presence (ingredient_vendors) AND
    // corroborating evidence elsewhere (ingredient_links or invoice_lines).
    // This is purely data-driven — no vendor name is special-cased. It's
    // why Hardie's/Fruge/FreshPoint/H-E-B qualify today and Walmart/BEK/
    // Marro don't: those three currently have zero rows in at least one
    // of the corroborating tables (see audit).
    var ivVendors = {}, linkVendors = {}, invVendors = {};
    _poIngVendorCatalog.forEach(function(r){ if(r.vendor) ivVendors[r.vendor] = true; });
    _poLinkCatalog.forEach(function(r){ if(r.vendor) linkVendors[r.vendor] = true; });
    _poInvoiceLineRows.forEach(function(r){ if(r.vendor) invVendors[r.vendor] = true; });
    _poEligibleVendors = {};
    Object.keys(ivVendors).forEach(function(v){
      if(linkVendors[v] || invVendors[v]) _poEligibleVendors[v] = true;
    });

    _poCatalogLoaded = true;
  })();
  return _poCatalogLoading;
}

// Fetches real Hardie's invoice_lines (invoice_date, never created_at) and
// pending/pdf_received vendor_documents, then computes rhythm per
// functional ingredient via window.PurchaseRhythm — same engine, same
// equivalence config, nothing duplicated here. Never blocks Compila
// Ordine: any failure just leaves the section absent.
async function poLoadPurchaseRhythmData(){
  if(!window.PurchaseRhythm){ _poRhythmResults = []; return; }
  var sb = window.supabaseClient;
  var HARDIES = "Hardie's Fresh Foods / Dairyland Produce";
  try{
    var _t = new Date();
    var todayISO = _t.getFullYear() + '-' + String(_t.getMonth()+1).padStart(2,'0') + '-' + String(_t.getDate()).padStart(2,'0');

    var [ilRes, vdRes] = await Promise.all([
      sb.from('invoice_lines').select('ingredient_id,invoice_date,vendor_sku,qty,pack_description')
        .eq('vendor', HARDIES).not('ingredient_id','is',null).not('invoice_date','is',null),
      sb.from('vendor_documents').select('document_date,status')
        .eq('vendor', HARDIES).in('status', ['pending','pdf_received'])
    ]);

    var pendingSince = null;
    (vdRes.data || []).forEach(function(d){
      var ds = d.document_date || todayISO; // undated pending doc: assume it could be as recent as today
      if(!pendingSince || ds < pendingSince) pendingSince = ds;
    });

    var byIngredient = {};
    (ilRes.data || []).forEach(function(r){
      (byIngredient[r.ingredient_id] = byIngredient[r.ingredient_id] || []).push(r);
    });

    var ingredientIds = Object.keys(byIngredient);
    var namesRes = ingredientIds.length ? await sb.from('ingredients').select('id,name').in('id', ingredientIds) : { data: [] };
    var nameById = {};
    (namesRes.data || []).forEach(function(r){ nameById[r.id] = r.name; });

    var out = [];
    ingredientIds.forEach(function(ingredientId){
      var rows = byIngredient[ingredientId];
      var cfg = window.PurchaseRhythm.resolveEquivalenceConfig(ingredientId);
      var rhythm = window.PurchaseRhythm.computeIngredientRhythm(ingredientId, rows, { asOfDate: todayISO, pendingSince: pendingSince });
      var eligibleRows = rows.filter(function(r){ return window.PurchaseRhythm.isEventEligible(ingredientId, r.vendor_sku); });
      var qty = window.PurchaseRhythm.computeQuantitySignal(eligibleRows);
      out.push({ ingredient_id: ingredientId, name: cfg.name || nameById[ingredientId] || 'Unknown', rhythm: rhythm, qty: qty });
    });

    _poRhythmResults = out;
  } catch(e){
    console.warn('[Purchase Rhythm] non-blocking failure:', e && e.message);
    _poRhythmResults = [];
  }
  poRenderPage();
}

function poUniq(arr){
  var seen = {}, out = [];
  arr.forEach(function(v){ if(v && !seen[v]){ seen[v] = true; out.push(v); } });
  return out;
}

// ── VENDOR RESOLUTION (Correction: never invent a vendor) ──────────
// Tiered evidence, most reliable first. Never uses Expenses history,
// fuzzy vendor-name guessing, or an LLM. If two eligible vendors tie on
// a tier, only a real invoice-history dominance signal breaks the tie —
// otherwise the ingredient stays "ambiguous" for a human to resolve.
function poResolveVendorForIngredient(ingredientId){
  function decide(vendorList, tier){
    var candidates = poUniq(vendorList).filter(function(v){ return _poEligibleVendors[v]; });
    if(candidates.length === 0) return null;
    if(candidates.length === 1) return { status: 'resolved', vendor: candidates[0], tier: tier };
    var withHits = candidates.map(function(v){
      return { vendor: v, hits: _poPurchaseFreqByVendor[ingredientId + '|' + v] || 0 };
    }).sort(function(a, b){ return b.hits - a.hits; });
    if(withHits[0].hits > 0 && withHits[0].hits > withHits[1].hits){
      return { status: 'resolved', vendor: withHits[0].vendor, tier: tier, note: 'invoice-history dominance' };
    }
    return { status: 'ambiguous', candidates: withHits.map(function(x){ return x.vendor; }), tier: tier };
  }

  var tier1 = _poIngVendorCatalog.filter(function(r){ return r.ingredient_id === ingredientId; }).map(function(r){ return r.vendor; });
  var r1 = decide(tier1, 1);
  if(r1) return r1;

  var tier2 = _poLinkCatalog.filter(function(r){ return r.ingredient_id === ingredientId && r.confirmed === true; }).map(function(r){ return r.vendor; });
  var r2 = decide(tier2, 2);
  if(r2) return r2;

  var tier3 = _poInvoiceLineRows.filter(function(r){ return r.ingredient_id === ingredientId; }).map(function(r){ return r.vendor; });
  var r3 = decide(tier3, 3);
  if(r3) return r3;

  return { status: 'unresolved' };
}

// ── TEXT NORMALIZATION / MATCHING ─────────────────────────────────
// Deterministic, no LLM per line: normalize -> stem tokens -> token
// containment + Levenshtein fuzz for typos -> vendor-history tiebreak.
// Confidence has three tiers (see poMatchItem): HIGH (auto-select),
// MEDIUM (auto-select but flagged "da verificare"), LOW/ambiguous
// (no auto-selection, 2-5 candidates shown), or no candidate at all.

var PO_HIGH_THRESHOLD = 0.82;
var PO_MEDIUM_THRESHOLD = 0.55;
var PO_CANDIDATE_FLOOR = 0.30;
var PO_AMBIGUITY_GAP = 0.08; // if #1 and #2 are this close, treat as ambiguous regardless of raw score

var PO_ABBREVIATIONS = { 'lg':'large', 'sm':'small', 'med':'medium', 'org':'organic', 'ea':'each', 'pkg':'package' };

function poNormalize(s){
  return (s || '').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}

// Very light singularizer — collapses simple plurals so "brussels"/"brussel"
// and "sprouts"/"sprout" land on the same stem without a dictionary.
function poStem(w){
  if(w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
  if(w.length > 4 && /(ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2);
  if(w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}

function poTokens(s){
  return poNormalize(s).split(' ').filter(Boolean).map(function(w){
    return poStem(PO_ABBREVIATIONS[w] || w);
  });
}

function poLevenshtein(a, b){
  if(a === b) return 0;
  var m = a.length, n = b.length;
  if(m === 0) return n;
  if(n === 0) return m;
  var prev = new Array(n + 1), cur = new Array(n + 1);
  for(var j = 0; j <= n; j++) prev[j] = j;
  for(var i = 1; i <= m; i++){
    cur[0] = i;
    for(var jj = 1; jj <= n; jj++){
      var cost = a[i-1] === b[jj-1] ? 0 : 1;
      cur[jj] = Math.min(prev[jj] + 1, cur[jj-1] + 1, prev[jj-1] + cost);
    }
    var tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

// Similarity between two already-stemmed tokens: 1.0 if identical,
// else Levenshtein-based ratio (typo tolerance), floored so unrelated
// short words don't accidentally score as "similar".
function poTokenSim(a, b){
  if(a === b) return 1;
  if(a.length < 3 || b.length < 3) return 0; // too short to fuzz reliably
  var dist = poLevenshtein(a, b);
  var sim = 1 - dist / Math.max(a.length, b.length);
  return sim >= 0.65 ? sim : 0;
}

// How well does `query`'s tokens get covered by `candidate`'s tokens, and
// vice versa. Returns {queryCoverage, candidateCoverage}, each 0..1.
function poCoverage(queryTokens, candTokens){
  if(queryTokens.length === 0 || candTokens.length === 0) return { queryCoverage: 0, candidateCoverage: 0 };
  var usedCand = new Array(candTokens.length).fill(false);
  var qMatchSum = 0;
  queryTokens.forEach(function(qt){
    var best = 0, bestIdx = -1;
    candTokens.forEach(function(ct, ci){
      if(usedCand[ci]) return;
      var s = poTokenSim(qt, ct);
      if(s > best){ best = s; bestIdx = ci; }
    });
    if(bestIdx >= 0) usedCand[bestIdx] = true;
    qMatchSum += best;
  });
  var candMatchSum = 0;
  var usedQ = new Array(queryTokens.length).fill(false);
  candTokens.forEach(function(ct){
    var best = 0, bestIdx = -1;
    queryTokens.forEach(function(qt, qi){
      if(usedQ[qi]) return;
      var s = poTokenSim(ct, qt);
      if(s > best){ best = s; bestIdx = qi; }
    });
    if(bestIdx >= 0) usedQ[bestIdx] = true;
    candMatchSum += best;
  });
  return {
    queryCoverage: qMatchSum / queryTokens.length,
    candidateCoverage: candMatchSum / candTokens.length
  };
}

function poScore(queryText, candidateText){
  var qNorm = poNormalize(queryText), cNorm = poNormalize(candidateText);
  if(!qNorm || !cNorm) return 0;
  if(qNorm === cNorm) return 1;
  var qTok = poTokens(queryText), cTok = poTokens(candidateText);
  if(qTok.join(' ') === cTok.join(' ')) return 1; // exact after stemming (e.g. singular/plural)
  var cov = poCoverage(qTok, cTok);
  // Weighted toward how much of the (usually short, dictated) query is explained
  // by the candidate, with a smaller contribution from how much of the candidate
  // name is "used up" — keeps very generic short queries from over-matching long names.
  return 0.7 * cov.queryCoverage + 0.3 * cov.candidateCoverage;
}

// Fallback: once we know an ingredient_id via ingredient_links, see if the
// same ingredient also has a vendor SKU in ingredient_vendors (already loaded).
// If vendor is given, only that vendor's row counts — avoids borrowing a
// SKU from an unrelated vendor once vendor resolution has happened.
function poSkuForIngredient(ingredientId, vendor){
  if(!ingredientId) return null;
  var hit = _poIngVendorCatalog.find(function(r){ return r.ingredient_id === ingredientId && (!vendor || r.vendor === vendor); });
  return hit ? hit.vendor_sku : null;
}

// Source priors reflect trust order from the spec: confirmed aliases first,
// then the vendor's own catalog, then the fuzzy invoice-derived links table.
var PO_SOURCE_PRIOR = { vendor_item_aliases: 0.05, ingredient_vendors: 0.02, ingredient_links: 0 };

function poPurchaseBoost(ingredientId){
  var n = _poPurchaseFreq[ingredientId] || 0;
  if(n === 0) return 0;
  return Math.min(0.05, 0.012 * Math.log2(1 + n)); // small, bounded — tiebreaker, not a trump card
}

// Whatever source scored the match, always DISPLAY the canonical product
// name/SKU when the ingredient exists in the vendor's real catalog — an
// alias or a fuzzy invoice-link is a signal that we found the right
// ingredient_id, not necessarily good display text on its own.
function poCanonicalDisplay(ingredientId, fallbackName, fallbackSku, vendor){
  var ivHit = _poIngVendorCatalog.find(function(r){ return r.ingredient_id === ingredientId && (!vendor || r.vendor === vendor); });
  if(ivHit) return { name: ivHit.name || fallbackName, sku: ivHit.vendor_sku || fallbackSku };
  var lkHit = _poLinkCatalog.find(function(r){ return r.ingredient_id === ingredientId && (!vendor || r.vendor === vendor); });
  if(lkHit) return { name: lkHit.ingredient_name || fallbackName, sku: fallbackSku };
  return { name: fallbackName, sku: fallbackSku };
}

function poBuildCandidate(item, source, itemText){
  var name = source === 'vendor_item_aliases' ? item.vendor_description
           : source === 'ingredient_vendors' ? item.name
           : item.ingredient_name;
  var rawScore = poScore(itemText, name);
  // XCF-ORDINI-UX: Max scrive in italiano ("basilico"): vale anche ingredients.name_it.
  if(source === 'ingredient_vendors' && item.name_it){ rawScore = Math.max(rawScore, poScore(itemText, item.name_it)); }
  if(rawScore === 0) return null;
  var score = rawScore + PO_SOURCE_PRIOR[source] + poPurchaseBoost(item.ingredient_id);
  score = Math.min(1, score);
  var sku = item.vendor_sku || poSkuForIngredient(item.ingredient_id);
  var disp = poCanonicalDisplay(item.ingredient_id, name, sku);
  return {
    ingredient_id: item.ingredient_id,
    matched_name: disp.name,
    vendor_sku: disp.sku || null,
    confidence: Math.round(score * 100) / 100,
    source: source
  };
}

function poMatchItem(itemText){
  if(!itemText || !itemText.trim()) return { matched: false, needsReview: true, candidates: [], vendorStatus: 'unresolved', vendor: null };

  var pool = [];
  _poAliasCatalog.forEach(function(item){
    var c = poBuildCandidate(item, 'vendor_item_aliases', itemText);
    if(c) pool.push(c);
  });
  _poIngVendorCatalog.forEach(function(item){
    var c = poBuildCandidate(item, 'ingredient_vendors', itemText);
    if(c) pool.push(c);
  });
  _poLinkCatalog.forEach(function(item){
    var c = poBuildCandidate(item, 'ingredient_links', itemText);
    if(c) pool.push(c);
  });

  // Dedupe by ingredient_id, keeping the best-scoring source for each product
  // (an item can legitimately appear in more than one of the three tables,
  // now across multiple vendors too). This decides PRODUCT identity only —
  // vendor is resolved separately below from the full evidence for that
  // ingredient_id, never inherited from whichever single row scored highest.
  var byIngredient = {};
  pool.forEach(function(c){
    var key = c.ingredient_id || ('noid:' + c.matched_name);
    if(!byIngredient[key] || c.confidence > byIngredient[key].confidence) byIngredient[key] = c;
  });
  var candidates = Object.keys(byIngredient).map(function(k){ return byIngredient[k]; })
    .filter(function(c){ return c.confidence >= PO_CANDIDATE_FLOOR; })
    .sort(function(a, b){ return b.confidence - a.confidence; });

  if(candidates.length === 0) return { matched: false, needsReview: true, candidates: [], vendorStatus: 'unresolved', vendor: null };

  var top = candidates[0];
  var second = candidates[1];
  var tooClose = second && (top.confidence - second.confidence) < PO_AMBIGUITY_GAP && second.confidence >= PO_MEDIUM_THRESHOLD;

  // Explicit vendor-history tiebreak: when the top two are effectively tied
  // on text alone, the one actually purchased before wins outright rather
  // than falling into "ambiguous" — a real, previously-bought product should
  // beat a theoretical lookalike that's never been ordered.
  if(tooClose){
    var topFreq = _poPurchaseFreq[top.ingredient_id] || 0;
    var secondFreq = _poPurchaseFreq[second.ingredient_id] || 0;
    if(topFreq !== secondFreq){
      if(secondFreq > topFreq){ var swap = top; top = second; second = swap; }
      tooClose = false;
    }
  }

  var result;
  if(top.confidence >= PO_HIGH_THRESHOLD && !tooClose){
    result = { matched: true, needsReview: false, ingredient_id: top.ingredient_id,
      matched_name: top.matched_name, vendor_sku: top.vendor_sku, confidence: top.confidence,
      source: top.source, candidates: candidates.slice(0, 5) };
  } else if(top.confidence >= PO_MEDIUM_THRESHOLD && !tooClose){
    result = { matched: true, needsReview: true, ingredient_id: top.ingredient_id,
      matched_name: top.matched_name, vendor_sku: top.vendor_sku, confidence: top.confidence,
      source: top.source, candidates: candidates.slice(0, 5) };
  } else {
    // Low confidence or ambiguous (close race) — no auto-selection, human picks
    result = { matched: false, needsReview: true, candidates: candidates.slice(0, 5) };
  }

  // Vendor resolution — independent of the text score above. A product can
  // be identified with high confidence and still have no safe vendor (e.g.
  // "Milk" resolves fine as an ingredient, but Walmart lacks corroborating
  // evidence, so vendor stays unresolved — the line must not be guessed
  // into any draft).
  if(result.ingredient_id){
    var vr = poResolveVendorForIngredient(result.ingredient_id);
    result.vendorStatus = vr.status;
    result.vendor = vr.vendor || null;
    result.vendorCandidates = vr.candidates || [];
    result.vendorTier = vr.tier || null;
    if(vr.status === 'resolved'){
      var disp = poCanonicalDisplay(result.ingredient_id, result.matched_name, result.vendor_sku, vr.vendor);
      result.matched_name = disp.name;
      result.vendor_sku = poSkuForIngredient(result.ingredient_id, vr.vendor) || disp.sku;
    }
  } else {
    result.vendorStatus = 'unresolved';
    result.vendor = null;
    result.vendorCandidates = [];
  }
  return result;
}

// ── LINE PARSING ("1 basilico", "basilico 1", "2 casse panna", no invented data) ──
// Unita' in italiano e inglese ricondotte a una parola canonica; un numero
// senza unita' resta senza unita' (la propone poi lo storico, dichiarandolo).
var PO_UNIT_WORDS = {
  'case': 'case', 'cases': 'case', 'case(s)': 'case', 'cs': 'case', 'cassa': 'case', 'casse': 'case', 'cartone': 'case', 'cartoni': 'case',
  'each': 'each', 'ea': 'each', 'pz': 'each', 'pezzo': 'each', 'pezzi': 'each',
  'lb': 'lb', 'lbs': 'lb', 'libbra': 'lb', 'libbre': 'lb', 'kg': 'kg', 'g': 'g', 'oz': 'oz',
  'box': 'box', 'boxes': 'box', 'scatola': 'box', 'scatole': 'box',
  'bunch': 'bunch', 'bunches': 'bunch', 'mazzo': 'bunch', 'mazzi': 'bunch',
  'dozen': 'dozen', 'doz': 'dozen', 'dozzina': 'dozen', 'dozzine': 'dozen',
  'pack': 'pack', 'packs': 'pack', 'confezione': 'pack', 'confezioni': 'pack',
  'bag': 'bag', 'bags': 'bag', 'sacco': 'bag', 'sacchi': 'bag', 'busta': 'bag', 'buste': 'bag',
  'gallon': 'gallon', 'gal': 'gallon', 'gallone': 'gallon', 'galloni': 'gallon', 'qt': 'qt', 'pt': 'pt',
  'can': 'can', 'cans': 'can', 'latta': 'can', 'latte': 'can', 'barattolo': 'can', 'barattoli': 'can'
};
var PO_FILLER = { 'di': 1, 'de': 1, 'of': 1, 'x': 1 };
function poParseLine(raw){
  var line = (raw || '').trim().replace(/\s+/g, ' ');
  if(!line) return null;
  var words = line.split(' ');
  // "00" (farina 00) o "0" non sono quantita'; "0,5" si'.
  var num = function(w){
    if(!/^\d+(?:[.,]\d+)?$/.test(w) || /^0\d/.test(w)) return null;
    var n = parseFloat(w.replace(',', '.'));
    return n > 0 ? n : null;
  };
  var unitOf = function(w){ return PO_UNIT_WORDS[(w || '').toLowerCase()] || null; };
  var qty = null, unit = null, rest = words;
  if(words.length > 1 && num(words[0]) !== null){                       // "1 basilico", "2 casse (di) panna"
    qty = num(words[0]); rest = words.slice(1);
    if(rest.length > 1 && unitOf(rest[0])){ unit = unitOf(rest[0]); rest = rest.slice(1); }
    if(rest.length > 1 && PO_FILLER[rest[0].toLowerCase()]) rest = rest.slice(1);
  } else if(words.length > 1 && num(words[words.length - 1]) !== null){ // "basilico 1"
    qty = num(words[words.length - 1]); rest = words.slice(0, -1);
  } else if(words.length > 2 && num(words[words.length - 2]) !== null && unitOf(words[words.length - 1])){ // "panna 2 casse"
    qty = num(words[words.length - 2]); unit = unitOf(words[words.length - 1]); rest = words.slice(0, -2);
  }
  return { requested_text: rest.join(' '), quantity: qty, unit: unit };
}

// Unita' dell'ultimo acquisto di quell'ingrediente da quel fornitore (fattura
// piu' recente, poi ingredient_vendors). Mai inventata: null se non c'e'.
function poLastUnit(ingredientId, vendor){
  if(!ingredientId || !vendor) return null;
  var best = null;
  _poInvoiceLineRows.forEach(function(r){
    if(r.ingredient_id === ingredientId && r.vendor === vendor && r.purchase_unit && (!best || (r.invoice_date || '') > (best.invoice_date || ''))) best = r;
  });
  if(best) return String(best.purchase_unit).toLowerCase();
  var iv = _poIngVendorCatalog.find(function(r){ return r.ingredient_id === ingredientId && r.vendor === vendor && r.purchase_unit; });
  return iv ? String(iv.purchase_unit).toLowerCase() : null;
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
    var histUnit = (!parsed.unit && m.matched && m.vendorStatus === 'resolved') ? poLastUnit(m.ingredient_id, m.vendor) : null;
    return {
      requested_text: parsed.requested_text,
      quantity: parsed.quantity,
      unit: parsed.unit || histUnit,
      unit_from_history: !!histUnit,
      ingredient_id: m.matched ? m.ingredient_id : null,
      matched_name: m.matched ? m.matched_name : null,
      vendor_sku: m.matched ? m.vendor_sku : null,
      match_confidence: m.matched ? m.confidence : null,
      match_source: m.matched ? m.source : 'manual',
      needs_review: !!m.needsReview,
      candidates: m.candidates || [],
      vendor: m.vendor || null,
      vendor_status: m.vendorStatus || 'unresolved',
      vendor_candidates: m.vendorCandidates || []
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
window.poLineSetUnit = function(i, val){ _poDraftLines[i].unit = val.trim() || null; _poDraftLines[i].unit_from_history = false; };
window.poLineSetText = function(i, val){ _poDraftLines[i].requested_text = val.trim(); };

window.poLineSetProduct = function(i, encoded){
  var line = _poDraftLines[i];
  if(encoded === '__manual__'){
    line.ingredient_id = null; line.matched_name = null; line.vendor_sku = null;
    line.match_confidence = null; line.match_source = 'manual'; line.needs_review = false;
    line._userCorrected = false; // "no product" isn't something to learn as an alias
    line.vendor = null; line.vendor_status = 'unresolved'; line.vendor_candidates = [];
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
  line._userCorrected = true; // a human deliberately picked this product — candidate for a learned alias on save

  // Product changed — vendor must be re-resolved for the newly chosen
  // ingredient, never inherited from the previous candidate.
  var vr = poResolveVendorForIngredient(cand.ingredient_id);
  line.vendor = vr.vendor || null;
  line.vendor_status = vr.status;
  line.vendor_candidates = vr.candidates || [];
  if(vr.status === 'resolved'){
    var disp = poCanonicalDisplay(cand.ingredient_id, line.matched_name, line.vendor_sku, vr.vendor);
    line.matched_name = disp.name;
    line.vendor_sku = poSkuForIngredient(cand.ingredient_id, vr.vendor) || disp.sku;
  }
  poRenderPage();
};

// Human picks the vendor directly — used when vendor_status is 'ambiguous'
// (two eligible vendors, no dominance signal) or for a fully manual line.
// An explicit human choice here is not BOH OS guessing.
window.poLineSetVendor = function(i, vendorValue){
  var line = _poDraftLines[i];
  var v = poNormalizeVendorName(vendorValue);
  line.vendor = v || null;
  line.vendor_status = v ? 'resolved' : 'unresolved';
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
    match_source: 'manual', needs_review: false, candidates: [],
    vendor: null, vendor_status: 'unresolved', vendor_candidates: []
  });
  poRenderPage();
  setTimeout(function(){
    var inputs = document.querySelectorAll('.po-line-text');
    if(inputs.length) inputs[inputs.length - 1].focus();
  }, 30);
};

// ── LEARNING: a deliberate manual correction becomes a persistent alias ──
// Only fires for lines where the user actually picked a product from the
// dropdown (line._userCorrected) — never for untouched auto-matches, and
// never for "Nessun prodotto (manuale)". Skips anything already known.
async function poLearnAliasesFromCorrections(){
  var toLearn = _poDraftLines.filter(function(l){
    return l._userCorrected && l.ingredient_id && l.requested_text;
  });
  if(toLearn.length === 0) return;

  var sb = window.supabaseClient;
  var seen = {}; // avoid inserting the same requested_text twice within one save
  for(var i = 0; i < toLearn.length; i++){
    var l = toLearn[i];
    var normText = poNormalize(l.requested_text);
    if(seen[normText]) continue;
    seen[normText] = true;

    var already = _poAliasCatalog.some(function(a){ return poNormalize(a.vendor_description) === normText; });
    if(already) continue;

    try{
      var ins = await sb.from('vendor_item_aliases').insert({
        vendor: l.vendor, // fix XCF-ORDINI: prima usava una costante inesistente (ReferenceError silenziosa, alias mai salvati)
        vendor_sku: l.vendor_sku || null,
        vendor_description: l.requested_text,
        ingredient_id: l.ingredient_id,
        confirmed_by: (window.user && window.user.name) || 'Unknown',
        notes: 'Auto-creato da correzione manuale in Compila Ordine'
      });
      if(!ins.error){
        // keep in-memory catalog in sync so a second correction in the same
        // session doesn't try to insert the same alias again
        _poAliasCatalog.push({ vendor: l.vendor, vendor_sku: l.vendor_sku, vendor_description: l.requested_text, ingredient_id: l.ingredient_id });
      } else {
        console.error('[purchase-order] alias learn failed for', l.requested_text, ins.error);
      }
    }catch(e){
      console.error('[purchase-order] alias learn error', e);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// XCF-ORDINI (02/10/2026) — flusso completo via RPC po_* (sessione
// Brigade + ruolo verificati sul server). Nessuna scrittura diretta su
// purchase_orders / purchase_order_lines dal browser.
// richiesta → righe verificate → bozza → pronto (riepilogo + hash) →
// conferma Max (sull'hash) → invio (edge, SOLO SIMULAZIONE) | invio
// manuale registrato → conferma fornitore → ricevimento (+ bozza reclamo).
// ══════════════════════════════════════════════════════════════

var _poEditingRevision = null; // revision dell'ordine aperto in modifica (controllo concorrenza)
var _poDeliveryDate = '';      // data consegna scelta nella revisione (YYYY-MM-DD)
var _poCurrentOrder = null;    // dettaglio caricato da po_get
var _poMe = null;              // {user_id, name, is_admin, can_compile} dal server
var _poSettings = null;        // {price_stale_days, duplicate_window_hours, real_send_enabled}
var _poCandidates = null;      // conferme fornitore candidate per l'ordine aperto
var _poReceiveDraft = {};      // line_id -> {status, received_qty, note, photo_url}
var _poIdemKeys = {};          // "azione|orderId|hash" -> chiave idempotente (riusata nei retry)
var _poBusy = false;

var PO_STATUS_LABEL = {
  draft: 'Bozza', ready: 'Da confermare (Max)', confirmed: 'Confermato — da inviare',
  sent: 'Inviato', sent_manual: 'Inviato a mano', acknowledged: 'Confermato dal fornitore',
  received: 'Ricevuto', cancelled: 'Annullato'
};
function poStatusLabel(s){ return PO_STATUS_LABEL[s] || s; }

var PO_REASON_TEXT = {
  AUTH_ERROR: 'Sessione scaduta — rientra con il PIN.',
  FORBIDDEN: 'Non autorizzato per questa azione.',
  CONFLICT: 'L\'ordine è stato modificato da qualcun altro — ricaricato.',
  NOT_FOUND: 'Ordine non trovato.',
  ORDER_NOT_EDITABLE: 'Ordine già inviato: non si modifica più.',
  VENDOR_MISMATCH: 'Fornitore diverso da quello dell\'ordine.',
  DELIVERY_DATE_MISSING: 'Manca la data di consegna.',
  DELIVERY_DATE_PAST: 'La data di consegna è nel passato.',
  NO_LINES: 'Nessuna riga nell\'ordine.',
  LINES_NOT_READY: 'Ci sono righe da sistemare (quantità, confezione, prodotto da chiarire o "non ordinare").',
  SUMMARY_CHANGED: 'Il riepilogo è cambiato: rileggilo prima di confermare.',
  CONFIRMATION_STALE: 'L\'ordine è cambiato dopo la conferma di Max: serve una nuova conferma.',
  NOT_CONFIRMED: 'Serve prima la conferma di Max.',
  ALREADY_SENT: 'Ordine già inviato — nessun secondo invio.',
  IN_FLIGHT: 'Un invio è già in corso per questo ordine.',
  IDEMPOTENCY_KEY_REUSED: 'Richiesta duplicata rifiutata.',
  DUPLICATE_SUSPECTED: 'Possibile doppio ordine a questo fornitore.',
  DO_NOT_ORDER: 'Un prodotto è marcato "non ordinare".',
  RECEIPT_INCOMPLETE: 'Segna tutte le righe prima di chiudere il ricevimento.',
  INVALID_STATE: 'Azione non valida in questo stato.',
  INVALID_INPUT: 'Dati non validi.',
  DOCUMENT_MISMATCH: 'Il documento non è una conferma di questo fornitore.',
  DOCUMENT_ALREADY_LINKED: 'Questa conferma è già collegata a un altro ordine.',
  REAL_TRANSPORT_NOT_IMPLEMENTED: 'Invio reale non disponibile: nulla è partito.'
};
function poReasonText(reason){ return PO_REASON_TEXT[reason] || ('Errore: ' + (reason || 'sconosciuto')); }

function _poToken(){ try { return localStorage.getItem('brigade_token'); } catch(e){ return null; } }

async function poRpc(fn, args){
  var sb = window.supabaseClient;
  var payload = Object.assign({ p_token: _poToken() }, args || {});
  var res = await sb.rpc(fn, payload);
  if(res.error){
    console.error('[purchase-order] rpc ' + fn, res.error);
    return { ok: false, reason: 'NETWORK', detail: res.error.message };
  }
  var data = res.data || { ok: false, reason: 'EMPTY' };
  if(data.me) _poMe = data.me;
  if(data.settings) _poSettings = data.settings;
  return data;
}

function poIdemKey(action, orderId, hash){
  var k = action + '|' + orderId + '|' + (hash || '');
  if(!_poIdemKeys[k]){
    var rnd = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    _poIdemKeys[k] = action + '-' + rnd;
  }
  return _poIdemKeys[k];
}

// ── problemi lato client (stessa logica bloccante del server, solo per UI) ──
function poLineClientIssues(l){
  var out = [];
  if(!(l.requested_text || '').trim() && !l.ingredient_id) out.push({ code: 'LINE_EMPTY', blocking: true, msg: 'Riga vuota' });
  if(l.quantity == null || !(Number(l.quantity) > 0)) out.push({ code: 'QTY_MISSING', blocking: true, msg: 'Quantità mancante' });
  if(!(l.unit || '').trim()) out.push({ code: 'UNIT_MISSING', blocking: true, msg: 'Confezione/unità mancante' });
  if(l.needs_review) out.push({ code: 'AMBIGUOUS', blocking: true, msg: 'Prodotto da chiarire' });
  return out;
}

// ── costruzione dei gruppi per po_save_draft (pura, testata) ──────────
// Solo righe con fornitore risolto. Il fornitore dell'ordine aperto in
// modifica viene sempre inviato in 'replace' (anche vuoto: l'utente ha
// tolto tutte le righe); gli altri fornitori in 'append' sulla loro bozza.
function poBuildSaveGroups(lines, editingOrderId, editingVendor, editingRevision, deliveryDate){
  var byVendor = {};
  (lines || []).forEach(function(l){
    if(l.vendor_status !== 'resolved' || !l.vendor) return;
    (byVendor[l.vendor] = byVendor[l.vendor] || []).push(l);
  });
  var vendors = Object.keys(byVendor);
  if(editingOrderId && editingVendor && vendors.indexOf(editingVendor) < 0) vendors.push(editingVendor);
  return vendors.map(function(vendor){
    var g = {
      vendor_name: vendor,
      lines: (byVendor[vendor] || []).map(function(l){
        return {
          requested_text: l.requested_text || '', ingredient_id: l.ingredient_id || null,
          matched_name: l.matched_name || null, vendor_sku: l.vendor_sku || null,
          quantity: l.quantity, unit: l.unit || null, pack_description: l.pack_description || null,
          match_confidence: l.match_confidence, match_source: l.match_source || 'manual',
          needs_review: !!l.needs_review
        };
      })
    };
    if(deliveryDate) g.delivery_date = deliveryDate;
    if(editingOrderId && vendor === editingVendor){
      g.mode = 'replace'; g.order_id = editingOrderId;
      if(editingRevision != null) g.expected_revision = editingRevision;
    } else {
      g.mode = 'append';
    }
    return g;
  });
}

// ── SAVE DRAFT (transazionale, RPC po_save_draft) ───────────────────
window.poSaveDraft = async function(){
  var groups = poBuildSaveGroups(_poDraftLines, _poEditingOrderId, _poEditingVendor, _poEditingRevision, _poDeliveryDate);
  var pendingCount = _poDraftLines.filter(function(l){ return !(l.vendor_status === 'resolved' && l.vendor); }).length;
  if(groups.length === 0){
    poToast(pendingCount > 0 ? 'Nessuna riga pronta — scegli il fornitore per le righe segnalate.' : 'Nessuna riga da salvare.');
    return;
  }
  var btn = document.getElementById('poSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = '…'; }
  try{
    var payload = { groups: groups };
    if(_poPendingOfficeItemId) payload.office_item_id = _poPendingOfficeItemId;
    var r = await poRpc('po_save_draft', { p_payload: payload });
    if(!r.ok){
      poToast(poReasonText(r.reason));
      if(r.reason === 'CONFLICT' && _poEditingOrderId) await poOpenOrder(_poEditingOrderId);
      return;
    }
    _poPendingOfficeItemId = null; // ack Tell Chef scritto nella stessa transazione
    await poLearnAliasesFromCorrections();

    var blocking = (r.orders || []).reduce(function(n, o){ return n + (o.blocking_count || 0); }, 0);
    var invalidated = (r.orders || []).some(function(o){ return o.previous_status === 'ready' || o.previous_status === 'confirmed'; });
    var msg = 'Bozza salvata ✓';
    if(invalidated) msg += ' — riepilogo/conferma precedenti annullati';
    if(blocking) msg += ' — ' + blocking + (blocking === 1 ? ' riga da sistemare' : ' righe da sistemare');
    if(pendingCount) msg += ' — ' + pendingCount + ' in sospeso (fornitore da scegliere)';
    poToast(msg);

    _poDraftLines = _poDraftLines.filter(function(l){ return !(l.vendor_status === 'resolved' && l.vendor); });
    // XCF-ORDINI-UX: un solo ordine, nessuna riga da sistemare -> riepilogo subito
    // (stesso po_mark_ready di prima, un tocco in meno). La conferma resta di Max.
    if(_poDraftLines.length === 0 && (r.orders || []).length === 1 && !blocking){
      var rr = await poRpc('po_mark_ready', { p_order_id: r.orders[0].id, p_expected_revision: r.orders[0].revision });
      if(rr.ok) poToast('Riepilogo pronto — controlla e conferma');
    }
    if(_poDraftLines.length === 0){
      var single = (r.orders || []).length === 1 ? r.orders[0].id : null;
      _poEditingOrderId = null; _poEditingVendor = null; _poEditingRevision = null;
      if(single){ await poOpenOrder(single); return; }
      _poView = 'list';
    }
    poRenderPage();
    poLoadOpenDrafts();
  }catch(e){
    console.error('[purchase-order] save error', e);
    poToast('Errore nel salvataggio');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Prepara riepilogo'; }
  }
};

// ── LISTA ORDINI APERTI ─────────────────────────────────────────────
async function poLoadOpenDrafts(){
  var r = await poRpc('po_list', { p_include_closed: false, p_include_test: false });
  if(!r.ok){ console.error('[purchase-order] po_list', r); return; }
  _poOpenDrafts = r.orders || [];
  if(_poView === 'list') poRenderPage();
}

// Compat: vecchio nome usato da altre parti dell'app.
window.poOpenDraft = function(orderId){ return poOpenOrder(orderId); };

window.poOpenOrder = async function(orderId){
  var r = await poRpc('po_get', { p_order_id: orderId });
  if(!r.ok){ poToast(poReasonText(r.reason)); return; }
  _poCurrentOrder = r.order;
  _poCandidates = null;
  _poReceiveDraft = {};
  _poView = 'order';
  if(typeof showSection === 'function') showSection('vpo');
  poRenderPage();
};
var poOpenOrder = window.poOpenOrder;

window.poEditOrderLines = function(){
  var o = _poCurrentOrder;
  if(!o) return;
  _poDraftLines = (o.lines || []).map(function(l){
    return {
      requested_text: l.requested_text, quantity: l.quantity, unit: l.unit,
      ingredient_id: l.ingredient_id, matched_name: l.matched_name, vendor_sku: l.vendor_sku,
      pack_description: l.pack_description, match_confidence: l.match_confidence, match_source: l.match_source,
      needs_review: !!l.needs_review, candidates: [],
      vendor: l.vendor_name || o.vendor_name, vendor_status: 'resolved', vendor_candidates: []
    };
  });
  _poEditingOrderId = o.id;
  _poEditingVendor = o.vendor_name;
  _poEditingRevision = o.revision;
  _poDeliveryDate = o.delivery_date || '';
  _poView = 'review';
  poRenderPage();
};

window.poSetDeliveryDate = function(val){ _poDeliveryDate = val || ''; };

async function poAfterAction(r, okMsg){
  if(!r.ok){
    poToast(poReasonText(r.reason));
    if(_poCurrentOrder) await poOpenOrder(_poCurrentOrder.id);
    return false;
  }
  if(okMsg) poToast(okMsg);
  if(_poCurrentOrder) await poOpenOrder(_poCurrentOrder.id);
  poLoadOpenDrafts();
  return true;
}

window.poSaveOrderDeliveryDate = async function(){
  var o = _poCurrentOrder; if(!o || _poBusy) return;
  var el = document.getElementById('poOrderDelivery');
  var val = el ? el.value : '';
  if(!val){ poToast('Scegli una data di consegna.'); return; }
  _poBusy = true;
  try{
    var lines = (o.lines || []).map(function(l){
      return { requested_text: l.requested_text, ingredient_id: l.ingredient_id, matched_name: l.matched_name,
        vendor_sku: l.vendor_sku, quantity: l.quantity, unit: l.unit, pack_description: l.pack_description,
        match_confidence: l.match_confidence, match_source: l.match_source, needs_review: !!l.needs_review };
    });
    var r = await poRpc('po_save_draft', { p_payload: { groups: [{ mode: 'replace', order_id: o.id, expected_revision: o.revision,
      vendor_name: o.vendor_name, delivery_date: val, lines: lines }] } });
    await poAfterAction(r, 'Data di consegna salvata');
  } finally { _poBusy = false; }
};

window.poMarkReady = async function(){
  var o = _poCurrentOrder; if(!o || _poBusy) return;
  _poBusy = true;
  try{
    var r = await poRpc('po_mark_ready', { p_order_id: o.id, p_expected_revision: o.revision });
    await poAfterAction(r, 'Riepilogo pronto — in attesa della conferma di Max');
  } finally { _poBusy = false; }
};

window.poConfirmOrder = async function(){
  var o = _poCurrentOrder; if(!o || _poBusy || !o.summary_hash) return;
  if(!confirm('Confermi esattamente questo riepilogo (#' + o.summary_hash.slice(0, 8) + ')?\nQualsiasi modifica successiva annulla la conferma.')) return;
  _poBusy = true;
  try{
    var r = await poRpc('po_confirm', { p_order_id: o.id, p_summary_hash: o.summary_hash });
    await poAfterAction(r, 'Confermato da Max ✓');
  } finally { _poBusy = false; }
};

function _poAckDuplicates(){
  var el = document.getElementById('poAckDup');
  return !!(el && el.checked);
}

// Invio tramite edge function. 'simulate': nulla parte. 'real' (XCF-CW): solo
// per un canale Chef's Warehouse con tutti gli interruttori accesi; l'edge lo
// mette in coda e il worker del Mac Mini lo invia. Il server decide sempre:
// senza interruttori anche una richiesta 'real' resta simulazione.
async function poSend(mode){
  var o = _poCurrentOrder; if(!o || _poBusy) return;
  _poBusy = true;
  try{
    var key = poIdemKey(mode === 'real' ? 'send-real' : 'send', o.id, o.confirmed_hash);
    var res = await fetch(SUPABASE_URL + '/functions/v1/send-purchase-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ brigade_token: _poToken(), order_id: o.id, idempotency_key: key,
        summary_hash: o.confirmed_hash, ack_duplicates: _poAckDuplicates(), mode: mode === 'real' ? 'real' : 'simulate' })
    });
    var r = await res.json().catch(function(){ return { ok: false, reason: 'NETWORK' }; });
    if(r.ok && r.queued){
      // In coda per il worker: la chiave resta (un ritento e' la stessa richiesta).
      await poAfterAction(r, 'In coda: il Mac Mini lo invia a Chef\'s Warehouse entro un minuto');
      poWatchSend(o.id);
    } else if(r.ok){
      // Simulazione registrata: la prossima prova usa una chiave nuova.
      delete _poIdemKeys['send|' + o.id + '|' + o.confirmed_hash];
      await poAfterAction(r, r.transmitted ? 'Inviato' : 'SIMULAZIONE registrata — nessun messaggio è partito');
    } else {
      if(r.reason !== 'NETWORK') delete _poIdemKeys['send|' + o.id + '|' + o.confirmed_hash];
      await poAfterAction(r);
    }
  } catch(e){
    poToast('Errore di rete — riprova (stessa richiesta, nessun doppio invio)');
  } finally { _poBusy = false; }
}
window.poSendSimulated = function(){ return poSend('simulate'); };

// XCF-CW: conferma finale di Max prima dell'invio reale, sul riepilogo esatto.
window.poSendRealCw = function(){
  var o = _poCurrentOrder; if(!o || !o.confirmed_hash) return;
  var n = (o.lines || []).length;
  if(!confirm('ORDINE REALE a Chef\'s Warehouse\n\nRiepilogo #' + o.confirmed_hash.slice(0, 8) + ' · ' + n + ' righe · consegna ' + (o.delivery_date || '?') +
    '\n\nParte davvero e verrà addebitato. Confermi?')) return;
  return poSend('real');
};

// Dopo la messa in coda: ricarica l'ordine finche' il worker non chiude l'esito (max 4 minuti).
var _poWatchTimer = null;
function poWatchSend(orderId){
  if(_poWatchTimer) clearInterval(_poWatchTimer);
  var until = Date.now() + 4 * 60 * 1000;
  _poWatchTimer = setInterval(async function(){
    if(Date.now() > until || !_poCurrentOrder || _poCurrentOrder.id !== orderId || _poView !== 'order'){ clearInterval(_poWatchTimer); _poWatchTimer = null; return; }
    await poOpenOrder(orderId);
    var at = poLastRealAttempt(_poCurrentOrder);
    if(!at || at.state !== 'pending' || (at.result && at.result.uncertain)){ clearInterval(_poWatchTimer); _poWatchTimer = null; }
  }, 5000);
}

function poLastRealAttempt(o){
  var xs = ((o && o.send_attempts) || []).filter(function(a){ return a.mode === 'real'; });
  return xs.length ? xs[xs.length - 1] : null;
}

function poCwRealAvailable(o){
  var ch = (o && o.channel_info) || {};
  var on = _poSettings && (_poSettings.real_send_enabled === true || _poSettings.real_send_enabled === 'true');
  return !!(on && ch.channel === 'portal' && ch.transport === 'cw_portal' && ch.real_send_allowed && !o.is_test);
}

function poRenderRealAttempt(o){
  var at = poLastRealAttempt(o);
  if(!at) return '';
  var r = at.result || {};
  if(at.state === 'pending' && r.uncertain){
    return '<div style="margin-top:12px;padding:10px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;font-size:12px;color:#92400e;">' +
      '⚠️ <b>Esito NON certo</b> (' + _poEsc(r.error || '') + '): l\'ordine potrebbe essere partito. Controlla lo storico ordini su Chef\'s Warehouse. ' +
      'Brigade non lo rimanda da solo: se c\'è, registralo come invio manuale con il numero; se non c\'è, annulla e rifai l\'ordine.</div>';
  }
  if(at.state === 'pending'){
    return '<div style="margin-top:12px;padding:10px;border:1px solid #93c5fd;border-radius:10px;background:#eff6ff;font-size:12px;color:#1e40af;">' +
      (at.claimed_at ? '⏳ Il Mac Mini sta inviando l\'ordine a Chef\'s Warehouse…' : '⏳ In coda per il Mac Mini…') + '</div>';
  }
  if(at.state === 'failed' && o.status === 'confirmed'){
    return '<div style="margin-top:12px;padding:10px;border:1px solid #fca5a5;border-radius:10px;background:#fef2f2;font-size:12px;color:#991b1b;">' +
      '⛔ Ultimo invio a Chef\'s Warehouse NON partito (' + _poEsc(r.error || 'errore') + '). Nulla è stato inviato.' +
      (r.error === 'OUT_OF_STOCK' ? ' Esaurito su CW: <b>' + _poEsc((((r.detail || []).filter(function(d){ return d.code === 'OUT_OF_STOCK'; })[0] || {}).items || [])
        .map(function(x){ return x.name || x.sku; }).join(', ')) + '</b>. Togli o sostituisci l\'articolo e rimanda.' : '') +
      (r.cart_touched ? ' Il carrello su CW può contenere righe aggiunte: svuotalo prima di riprovare.' : '') +
      (r.error === 'CW_SESSION_EXPIRED' ? ' Serve il login sul Mac Mini (cw-login.command).' : '') + '</div>';
  }
  return '';
}

window.poRegisterManualSend = async function(){
  var o = _poCurrentOrder; if(!o || _poBusy) return;
  var ch = (document.getElementById('poManualChannel') || {}).value || '';
  var num = (document.getElementById('poManualNumber') || {}).value || '';
  var note = (document.getElementById('poManualNote') || {}).value || '';
  if(!ch){ poToast('Scegli come è stato inviato.'); return; }
  _poBusy = true;
  try{
    var r = await poRpc('po_register_manual_send', { p_order_id: o.id, p_idempotency_key: poIdemKey('manual', o.id, o.confirmed_hash),
      p_summary_hash: o.confirmed_hash, p_channel: ch, p_vendor_order_number: num || null, p_note: note || null,
      p_ack_duplicates: _poAckDuplicates() });
    if(!r.ok && r.reason !== 'NETWORK') delete _poIdemKeys['manual|' + o.id + '|' + o.confirmed_hash];
    await poAfterAction(r, 'Invio manuale registrato ✓');
  } finally { _poBusy = false; }
};

window.poCopySummary = function(){
  var t = document.getElementById('poSummaryText');
  if(!t) return;
  var text = t.textContent;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ poToast('Riepilogo copiato'); }, function(){ poToast('Copia non riuscita'); });
  }
};

window.poLoadCandidates = async function(){
  var o = _poCurrentOrder; if(!o) return;
  var r = await poRpc('po_confirmation_candidates', { p_order_id: o.id });
  if(!r.ok){ poToast(poReasonText(r.reason)); return; }
  _poCandidates = r.candidates || [];
  poRenderPage();
};

window.poLinkConfirmation = async function(docId){
  var o = _poCurrentOrder; if(!o || _poBusy) return;
  _poBusy = true;
  try{
    var r = await poRpc('po_link_confirmation', { p_order_id: o.id, p_vendor_document_id: docId });
    var diffs = r.ok && r.differences ? r.differences.length : 0;
    await poAfterAction(r, 'Conferma collegata' + (diffs ? ' — ' + diffs + ' differenze da controllare' : ''));
  } finally { _poBusy = false; }
};

window.poStartReceive = function(){
  var o = _poCurrentOrder; if(!o) return;
  _poReceiveDraft = {};
  (o.lines || []).forEach(function(l){ _poReceiveDraft[l.id] = { status: 'received', received_qty: l.quantity, note: '', photo_url: null }; });
  _poView = 'receive';
  poRenderPage();
};
window.poRecvSet = function(lineId, field, val){
  var d = _poReceiveDraft[lineId]; if(!d) return;
  d[field] = val;
  if(field === 'status') poRenderPage();
};
window.poRecvPhoto = async function(lineId, input){
  var f = input && input.files && input.files[0];
  if(!f || !_poCurrentOrder) return;
  try{
    var path = 'purchase-orders/' + _poCurrentOrder.id + '/' + lineId + '-' + Date.now() + '.jpg';
    var up = await window.supabaseClient.storage.from('app').upload(path, f, { upsert: true, contentType: f.type || 'image/jpeg' });
    if(up.error) throw up.error;
    var pub = window.supabaseClient.storage.from('app').getPublicUrl(path);
    _poReceiveDraft[lineId].photo_url = pub && pub.data ? pub.data.publicUrl : null;
    poToast('Foto allegata');
    poRenderPage();
  }catch(e){ console.error('[purchase-order] photo', e); poToast('Foto non caricata (facoltativa)'); }
};
window.poSubmitReceive = async function(){
  var o = _poCurrentOrder; if(!o || _poBusy) return;
  var lines = Object.keys(_poReceiveDraft).map(function(id){
    var d = _poReceiveDraft[id];
    return { line_id: id, status: d.status, received_qty: d.received_qty, note: d.note || null, photo_url: d.photo_url || null };
  });
  _poBusy = true;
  try{
    var r = await poRpc('po_receive', { p_order_id: o.id, p_lines: lines, p_note: null });
    await poAfterAction(r, r.ok && r.complaint_draft_id ? 'Ricevuto — bozza di reclamo pronta (NON inviata)' : 'Ricevuto ✓');
  } finally { _poBusy = false; }
};

window.poCancelOrder = async function(){
  var o = _poCurrentOrder; if(!o || _poBusy) return;
  var reason = prompt('Motivo dell\'annullamento' + (['draft','ready'].indexOf(o.status) >= 0 ? ' (facoltativo)' : '') + ':') ;
  if(reason === null) return;
  _poBusy = true;
  try{
    var r = await poRpc('po_cancel', { p_order_id: o.id, p_reason: reason });
    if(r.ok && r.warning) alert(r.warning);
    await poAfterAction(r, 'Ordine annullato');
  } finally { _poBusy = false; }
};

window.poRegisterExternalSend = async function(){
  var v = (document.getElementById('poExtVendor') || {}).value || '';
  var ch = (document.getElementById('poExtChannel') || {}).value || '';
  var note = (document.getElementById('poExtNote') || {}).value || '';
  if(!v.trim() || !ch){ poToast('Fornitore e canale obbligatori.'); return; }
  var r = await poRpc('po_register_external_send', { p_vendor: poNormalizeVendorName(v), p_channel: ch, p_note: note || null,
    p_idempotency_key: poIdemKey('ext', v, String(Math.floor(Date.now() / 60000))) });
  if(!r.ok){ poToast(poReasonText(r.reason)); return; }
  poToast('Registrato: ordine fatto fuori da Brigade (usato contro i doppioni)');
  var box = document.getElementById('poExtBox'); if(box) box.open = false;
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
  el.innerHTML = _poView === 'review' ? poRenderReview()
               : _poView === 'order' ? poRenderOrder()
               : _poView === 'receive' ? poRenderReceive()
               : _poView === 'vendor' ? poRenderVendor()
               : poRenderList();
}

// ── XCF-ORDINI-UX 02: un fornitore → Lista / Suggeriti / Abituali / Cerca ──
// Dati dal server (po_vendor_list / po_vendor_catalog): storico fatture
// reale, regola "Suggerito" provata sullo storico, calendario in DB.
// Niente stock, niente quantita' proposte: Max mette le quantita'.
var _poVendors = null, _poVendorsLoading = false;
var _poVendorSel = null, _poCatalog = null, _poCatQty = {}, _poCatSearch = '', _poCatDate = '';
var PO_DOW = ['dom','lun','mar','mer','gio','ven','sab'];

function poFmtDay(d){
  if(!d) return '';
  var x = new Date(String(d).slice(0, 10) + 'T12:00:00');
  return PO_DOW[x.getDay()] + ' ' + String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0');
}
function poShortVendor(v){
  return ({ "Hardie's Fresh Foods / Dairyland Produce": "Hardie's / CW", 'Global Gourmet Foods': 'Global Gourmet',
            'Ben E. Keith': 'Ben E. Keith', 'Fruge Seafood': 'Frugé' })[v] || v;
}
async function poLoadVendors(){
  if(_poVendors || _poVendorsLoading) return;
  _poVendorsLoading = true;
  try{
    var r = await poRpc('po_vendor_list', {});
    _poVendors = r.ok ? (r.vendors || []) : [];
  } finally { _poVendorsLoading = false; }
  if(_poView === 'list') poRenderPage();
}
function poRenderVendorChips(){
  if(!_poVendors){ poLoadVendors(); return ''; }
  if(!_poVendors.length) return '';
  var html = '<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">Ordina per fornitore</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">';
  _poVendors.forEach(function(v, i){
    var nd = (v.next_deliveries || [])[0];
    html += '<button onclick="poOpenVendor(' + i + ')" style="text-align:left;padding:10px 12px;border-radius:12px;border:1px solid #e2e8f0;background:white;cursor:pointer;">' +
      '<div style="font-size:14px;font-weight:700;color:#1e3a5f;">' + _poEsc(poShortVendor(v.vendor_name)) + '</div>' +
      '<div style="font-size:11px;color:#64748b;">' + (nd ? 'consegna ' + _poEsc(poFmtDay(nd)) + (v.calendar_source === 'to_verify' ? ' (da verificare)' : '') : 'calendario non impostato') + '</div></button>';
  });
  return html + '</div>';
}
window.poOpenVendor = async function(i){
  var v = (_poVendors || [])[i]; if(!v) return;
  _poVendorSel = v.vendor_name; _poCatalog = null; _poCatQty = {}; _poCatSearch = '';
  _poCatDate = (v.next_deliveries || [])[0] || '';
  _poView = 'vendor'; poRenderPage();
  var r = await poRpc('po_vendor_catalog', { p_vendor: v.vendor_name });
  if(!r.ok){ poToast(poReasonText(r.reason)); _poView = 'list'; poRenderPage(); return; }
  _poCatalog = r;
  if(!_poCatDate && (r.next_deliveries || [])[0]) _poCatDate = r.next_deliveries[0];
  poRenderPage();
};
window.poCatSetQty = function(idx, val){
  var it = _poCatalog && (_poCatalog.items || [])[idx]; if(!it) return;
  var key = it.key;
  var n = parseFloat(String(val).replace(',', '.'));
  if(isNaN(n) || n <= 0) delete _poCatQty[key]; else _poCatQty[key] = n;
  var b = document.getElementById('poCatGo');
  if(b) b.textContent = poCatGoLabel();
};
window.poCatSearch = function(val){ _poCatSearch = val || ''; poRenderPage(); var el = document.getElementById('poCatSearchBox'); if(el){ el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
window.poCatSetDate = function(val){ _poCatDate = val || ''; };
window.poBackToHome = function(){ _poView = 'list'; _poVendorSel = null; _poCatalog = null; poRenderPage(); };
function poCatGoLabel(){
  var n = Object.keys(_poCatQty).length;
  return n ? 'Prepara riepilogo (' + n + (n === 1 ? ' articolo)' : ' articoli)') : 'Metti almeno una quantità';
}
function poCatReason(it){
  var p = [];
  if(it.weeks_8) p.push(it.weeks_8 + ' delle ultime 8 settimane');
  if(it.days_since != null) p.push('ultimo ' + it.days_since + ' gg fa');
  if(it.interval_days) p.push('di solito ogni ' + it.interval_days + ' gg');
  return p.join(' · ');
}
function poCatRow(it, showReason){
  var q = _poCatQty[it.key];
  var price = it.last_price != null ? '$' + Number(it.last_price).toFixed(2) + (it.last_unit ? '/' + it.last_unit : '') : '';
  var html = '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f1f5f9;">';
  html += '<div style="flex:1;min-width:0;">';
  html += '<div style="font-size:14px;font-weight:600;color:#1e3a5f;">' + _poEsc(it.name_it && it.name_it !== it.name ? it.name_it + ' · ' + it.name : (it.name || '')) + '</div>';
  html += '<div style="font-size:11px;color:#64748b;">' + _poEsc([it.vendor_sku ? 'SKU ' + it.vendor_sku : '', it.pack || '', price, it.last_date ? 'ult. ' + poFmtDay(it.last_date) : ''].filter(Boolean).join(' · ')) + '</div>';
  if(showReason) html += '<div style="font-size:11px;color:#166534;">' + _poEsc(poCatReason(it)) + '</div>';
  html += '</div>';
  html += '<input type="number" inputmode="decimal" min="0" step="1" value="' + (q != null ? q : '') + '" placeholder="0" oninput="poCatSetQty(' + (_poCatalog.items || []).indexOf(it) + ',this.value)" style="width:56px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:15px;text-align:center;">';
  html += '<div style="width:34px;font-size:11px;color:#64748b;">' + _poEsc(it.last_unit || '') + '</div>';
  return html + '</div>';
}
function poCatSection(title, items, showReason, empty){
  var html = '<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 4px;">' + _poEsc(title) + ' (' + items.length + ')</div>';
  if(!items.length) return html + '<div style="font-size:12px;color:#94a3b8;">' + _poEsc(empty) + '</div>';
  items.forEach(function(it){ html += poCatRow(it, showReason); });
  return html;
}
function poRenderVendor(){
  var html = '<button onclick="poBackToHome()" style="font-size:12px;color:#3B82F6;background:none;border:none;cursor:pointer;padding:0;margin-bottom:8px;">&#8249; Compila Ordine</button>';
  html += '<div style="font-size:18px;font-weight:700;color:#1e3a5f;">' + _poEsc(poShortVendor(_poVendorSel || '')) + '</div>';
  if(!_poCatalog) return html + '<div style="font-size:13px;color:#94a3b8;margin-top:12px;">Carico gli articoli…</div>';
  var c = _poCatalog, ch = c.channel || {};
  var opts = (c.next_deliveries || []).map(function(d){ return '<option value="' + _poEsc(d) + '"' + (d === _poCatDate ? ' selected' : '') + '>' + _poEsc(poFmtDay(d)) + '</option>'; }).join('');
  html += '<div style="display:flex;align-items:center;gap:8px;margin:8px 0 4px;"><span style="font-size:13px;color:#475569;">Consegna</span>';
  html += opts ? '<select onchange="poCatSetDate(this.value)" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">' + opts + '</select>'
               : '<input type="date" value="' + _poEsc(_poCatDate) + '" onchange="poCatSetDate(this.value)" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
  if(ch.calendar_source === 'to_verify') html += '<span style="font-size:11px;color:#b45309;">da verificare</span>';
  html += '</div>';
  if(ch.calendar_note) html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">' + _poEsc(ch.calendar_note) + '</div>';
  var items = c.items || [];
  if(!items.length) html += '<div style="font-size:13px;color:#94a3b8;margin-top:12px;">Nessun acquisto in fattura per questo fornitore. Scrivi la lista nella pagina principale.</div>';
  else if(ch.order_view === 'list'){
    html += poCatSection('Articoli comprati da Zeno', items, false, '');
  } else {
    var sug = items.filter(function(it){ return it.suggested; });
    var hab = items.filter(function(it){ return it.habitual && !it.suggested; });
    html += poCatSection('Suggeriti', sug, true, 'Niente di dovuto oggi secondo lo storico.');
    html += poCatSection('Acquistati abitualmente', hab, false, '');
    html += '<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 4px;">Tutti / cerca</div>';
    html += '<input id="poCatSearchBox" value="' + _poEsc(_poCatSearch) + '" oninput="poCatSearch(this.value)" placeholder="Cerca (nome, SKU…)" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;">';
    var qs = _poCatSearch.trim().toLowerCase();
    if(qs){
      var found = items.filter(function(it){ return [it.name, it.name_it, it.vendor_sku, it.invoice_description].join(' ').toLowerCase().indexOf(qs) >= 0; });
      found.slice(0, 30).forEach(function(it){ html += poCatRow(it, false); });
      if(!found.length) html += '<div style="font-size:12px;color:#94a3b8;margin-top:6px;">Nessun articolo trovato nello storico.</div>';
    }
  }
  html += '<div style="position:sticky;bottom:0;background:linear-gradient(transparent,#f8fafc 30%);padding-top:16px;">';
  html += '<button id="poCatGo" onclick="poCatPrepare()" style="width:100%;height:48px;border-radius:12px;background:#1e3a5f;color:white;border:none;font-size:15px;font-weight:700;cursor:pointer;">' + _poEsc(poCatGoLabel()) + '</button></div>';
  return html;
}
// Le quantita' scelte diventano righe di bozza gia' risolte (fornitore, SKU,
// ingrediente, unita' dell'ultima fattura) e passano dallo STESSO percorso
// di prima: po_save_draft → riepilogo con hash → conferma di Max.
function poCatalogToDraftLines(catalog, qtyMap, vendor){
  return (catalog.items || []).filter(function(it){ return qtyMap[it.key] > 0; }).map(function(it){
    return {
      requested_text: it.name_it || it.name || it.invoice_description, quantity: qtyMap[it.key], unit: it.last_unit || null,
      unit_from_history: !!it.last_unit, ingredient_id: it.ingredient_id || null, matched_name: it.name || null,
      vendor_sku: it.vendor_sku || null, match_confidence: it.ingredient_id ? 1 : null,
      match_source: it.ingredient_id ? 'ingredient_vendors' : 'manual', needs_review: !it.ingredient_id,
      candidates: [], vendor: vendor, vendor_status: 'resolved', vendor_candidates: [], pack_description: it.pack || null
    };
  });
}
window.poCatPrepare = async function(){
  if(!_poCatalog || !Object.keys(_poCatQty).length){ poToast('Metti almeno una quantità.'); return; }
  _poDraftLines = poCatalogToDraftLines(_poCatalog, _poCatQty, _poVendorSel);
  _poEditingOrderId = null; _poEditingVendor = null; _poEditingRevision = null;
  _poDeliveryDate = _poCatDate || '';
  _poView = 'review';
  await poSaveDraft();
};

function poRenderList(){
  // FIX (Show Purchase Rhythm on Compile Order Home task, Part B): same
  // guarded fire-and-forget trigger poRenderReview() already uses below —
  // starts the load once, never blocks this render, poRenderPage() (the
  // existing re-render-on-completion mechanism) already re-renders
  // whichever view is current when the data arrives.
  if(_poRhythmResults === null && !_poRhythmLoading){
    _poRhythmLoading = true;
    poLoadPurchaseRhythmData();
  }

  var html = '';
  html += poRenderChefAISuggests();
  html += '<div style="background:rgba(255,255,255,0.7);border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-bottom:16px;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:8px;">Detta o scrivi la lista</div>';
  html += '<textarea id="poInputText" rows="4" placeholder="1 basilico\n2 casse panna\nburrata 1" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>';
  html += '<div style="display:flex;gap:8px;margin-top:10px;">';
  html += '<button id="poMicBtn" onclick="poToggleMic()" style="width:44px;height:44px;border-radius:12px;border:1px solid #e2e8f0;background:white;font-size:18px;cursor:pointer;flex-shrink:0;">🎙️</button>';
  html += '<button id="poCreateBtn" onclick="poParseAndMatch()" style="flex:1;height:44px;border-radius:12px;background:#1e3a5f;color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;">Crea ordine</button>';
  html += '</div></div>';
  html += '<style>.po-mic-active{background:#dbeafe !important;border-color:#3b82f6 !important;}</style>';
  html += poRenderVendorChips();

  html += poRenderOrdersList();
  return html;
}

// ── CHEF AI SUGGESTS (initial view) ─────────────────────────────────────
// Same engine, same data (_poRhythmResults), same rankCandidates()
// filtering as poRenderCheckBeforeOrdering() below — this is just an
// earlier surface for the SAME actionable signals, visible the moment
// Chef opens Compila Ordine, before composing anything. Never shows
// NORMAL/SUPPRESSED_VARIABLE/INSUFFICIENT_HISTORY/CROSS_VENDOR_BLIND_SPOT
// — rankCandidates() already filters to OVERDUE/STRONGLY_OVERDUE/
// CHECK_SOON only (SEVERITY_RANK in purchase-rhythm.js). No new formula,
// no new query — same _poRhythmResults the review view already computes,
// loaded once (poRenderList()'s own fire-and-forget trigger, above).
function poRenderChefAISuggests(){
  if(!window.PurchaseRhythm) return '';
  // Still loading (null): say nothing yet — the list renders immediately
  // regardless, suggestions appear only once real data exists, avoiding
  // a flash of an empty-state card before the fetch even resolves.
  if(_poRhythmResults === null) return '';

  var draftIngredientIds = {};
  _poDraftLines.forEach(function(l){ if(l.ingredient_id) draftIngredientIds[l.ingredient_id] = true; });
  var relevant = _poRhythmResults.filter(function(r){ return !draftIngredientIds[r.ingredient_id]; });
  var actionable = window.PurchaseRhythm.rankCandidates(relevant, 10);

  var html = '<div style="margin-bottom:18px;padding:14px;background:rgba(255,255,255,0.6);border:1px solid #e2e8f0;border-radius:12px;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:2px;">Chef AI Suggests</div>';
  // FIX (Hardie's scope, Part G): the engine only ever analyzes Hardie's
  // purchase history today — this note must always be present whenever
  // this section renders (with or without actionable items) so the UI
  // never implies coverage of Walmart/FreshPoint/Frugé/BEK.
  html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Based on Hardie\'s purchase history</div>';

  if(!actionable.length){
    // FIX (Part E): discreet, single line — never a big empty card, no
    // false alarm implied by its absence either.
    html += '<div style="font-size:12px;color:#94a3b8;">Nothing unusual to check today</div>';
    html += '</div>';
    return html;
  }

  actionable.forEach(function(r){
    var rh = r.rhythm;
    var rhythmDays = Math.round(rh.median_gap_days);
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:13px;font-weight:600;color:#1e3a5f;">Check ' + _poEsc(r.name) + '</div>';
    html += '<div style="font-size:12px;color:#64748b;">Usually every ' + rhythmDays + (rhythmDays===1?' day':' days') +
      ' · last bought ' + rh.days_since_last + (rh.days_since_last===1?' day':' days') + ' ago</div>';
    // FIX (Part D): only ever the existing RELIABLE quantity signal,
    // verbatim — never an invented "order N cases" suggestion.
    if(r.qty && r.qty.quantity_status === 'RELIABLE' && r.qty.median_qty != null){
      html += '<div style="font-size:12px;color:#64748b;">Usually ' + r.qty.median_qty + (r.qty.dominant_pack ? ' (' + _poEsc(r.qty.dominant_pack) + ')' : '') + '</div>';
    }
    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ── CHECK BEFORE ORDERING ────────────────────────────────────────────────
// Readonly. Never adds items, never suggests a quantity to buy, never says
// "order this" — only "check stock before closing the order". Returns ''
// (nothing rendered) when there is nothing useful to say.
function poCheckBeforeOrderingWording(status){
  if(status === 'STRONGLY_OVERDUE') return 'Strong check — well beyond the normal purchase rhythm';
  if(status === 'OVERDUE') return 'Worth checking — later than the usual purchase rhythm';
  return 'Check stock before closing the order';
}

function poRenderCheckBeforeOrdering(){
  if(!_poRhythmResults || !_poRhythmResults.length) return '';

  // Never remind about something already in the current draft.
  var draftIngredientIds = {};
  _poDraftLines.forEach(function(l){ if(l.ingredient_id) draftIngredientIds[l.ingredient_id] = true; });
  var relevant = _poRhythmResults.filter(function(r){ return !draftIngredientIds[r.ingredient_id]; });

  var actionable = window.PurchaseRhythm.rankCandidates(relevant, 10);
  var provisional = relevant.filter(function(r){ return r.rhythm.status === 'DATA_INCOMPLETE'; });
  // CROSS_VENDOR_BLIND_SPOT is deliberately never surfaced here — the engine
  // itself already flags it as unreliable; showing it as a check-item would
  // look like a normal overdue signal, which it explicitly is not (T7).

  if(!actionable.length && !provisional.length) return '';

  var html = '<div style="margin-top:18px;margin-bottom:16px;padding:14px;background:rgba(255,255,255,0.6);border:1px solid #e2e8f0;border-radius:12px;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:10px;">Check Before Ordering</div>';

  actionable.forEach(function(r){
    var rh = r.rhythm;
    var rhythmDays = Math.round(rh.median_gap_days);
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="font-size:13px;font-weight:600;color:#1e3a5f;">' + _poEsc(r.name) + '</div>';
    html += '<div style="font-size:12px;color:#64748b;">Usually purchased about every ' + rhythmDays + (rhythmDays===1?' day':' days') +
      ' · Last known purchase ' + rh.days_since_last + (rh.days_since_last===1?' day':' days') + ' ago</div>';
    if(r.qty && r.qty.quantity_status === 'RELIABLE' && r.qty.median_qty != null){
      html += '<div style="font-size:12px;color:#64748b;">Usually ' + r.qty.median_qty + (r.qty.dominant_pack ? ' (' + _poEsc(r.qty.dominant_pack) + ')' : '') + '</div>';
    }
    html += '<div style="font-size:12px;color:#3B82F6;">' + poCheckBeforeOrderingWording(rh.status) + '</div>';
    html += '</div>';
  });

  if(provisional.length){
    html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;">';
    html += '<div style="font-size:12px;font-weight:600;color:#64748b;">Recent invoices still processing</div>';
    html += '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px;">Purchase Rhythm found possible items to check, but recent Chef\'s Warehouse invoices are not complete yet.</div>';
    provisional.forEach(function(r){
      html += '<div style="font-size:12px;color:#94a3b8;">' + _poEsc(r.name) + ' — provisional</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function poRenderReview(){
  if(_poRhythmResults === null && !_poRhythmLoading){
    _poRhythmLoading = true;
    poLoadPurchaseRhythmData(); // fire-and-forget; re-renders itself on completion, never blocks this render
  }

  var html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;">Revisiona ' + _poDraftLines.length + ' righe</div>';
  html += '<button onclick="poBackToList()" style="font-size:12px;color:#3B82F6;background:none;border:none;cursor:pointer;">&#8249; Indietro</button>';
  html += '</div>';
  if(_poEditingOrderId){
    html += '<div style="font-size:12px;color:#92400e;background:#fef3c7;border-radius:8px;padding:6px 10px;margin-bottom:10px;">Modifica ordine ' + _poEsc(_poEditingVendor || '') +
      ' — salvando, riepilogo e conferma di Max vengono annullati.</div>';
  }
  // XCF-ORDINI: data di consegna (obbligatoria per il riepilogo)
  html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">';
  html += '<label style="font-size:12px;color:#475569;white-space:nowrap;">Consegna</label>';
  html += '<input type="date" value="' + _poEsc(_poDeliveryDate || '') + '" onchange="poSetDeliveryDate(this.value)" style="flex:1;padding:8px;border:1px solid ' + (_poDeliveryDate ? '#e2e8f0' : '#fbbf24') + ';border-radius:8px;font-size:13px;">';
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

    // Vendor state — never silently guessed. Resolved shows a badge;
    // ambiguous shows a picker among the real eligible candidates;
    // unresolved shows a manual vendor field and blocks that line from
    // being saved until one is set.
    var vendorBlock = '';
    if(l.vendor_status === 'resolved' && l.vendor){
      vendorBlock = '<div style="font-size:11px;color:#1e40af;margin-top:4px;">→ ' + _poEsc(l.vendor) + '</div>';
    } else if(l.vendor_status === 'ambiguous' && (l.vendor_candidates||[]).length){
      vendorBlock = '<select onchange="poLineSetVendor(' + i + ',this.value)" style="width:100%;margin-top:6px;padding:6px 8px;border:1px solid #fbbf24;border-radius:8px;font-size:12px;background:#fffbeb;color:#92400e;">' +
        '<option value="" selected>⚠ Vendor da verificare — scegli</option>' +
        (l.vendor_candidates||[]).map(function(v){ return '<option value="' + _poEsc(v) + '">' + _poEsc(v) + '</option>'; }).join('') +
        '</select>';
    } else {
      vendorBlock = '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">' +
        '<span style="font-size:10px;color:#92400e;background:#fef3c7;padding:2px 6px;border-radius:6px;white-space:nowrap;">⚠ vendor sconosciuto</span>' +
        '<input type="text" placeholder="vendor…" oninput="poLineSetVendor(' + i + ',this.value)" style="flex:1;padding:5px 8px;border:1px solid #fbbf24;border-radius:8px;font-size:12px;background:#fffbeb;">' +
        '</div>';
    }

    var clientIssues = poLineClientIssues(l);
    var hasBlocking = clientIssues.some(function(x){ return x.blocking; });
    html += '<div style="background:rgba(255,255,255,0.7);border:1px solid ' + (hasBlocking ? '#fca5a5' : (l.needs_review || l.vendor_status !== 'resolved' ? '#fbbf24' : '#e2e8f0')) + ';border-radius:12px;padding:12px;margin-bottom:10px;">';
    html += '<input class="po-line-text" value="' + _poEsc(l.requested_text) + '" oninput="poLineSetText(' + i + ',this.value)" style="width:100%;border:none;font-size:14px;font-weight:600;color:#1e3a5f;padding:0 0 6px;background:transparent;">';

    html += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">';
    html += '<input type="number" value="' + (l.quantity != null ? l.quantity : '') + '" oninput="poLineSetQty(' + i + ',this.value)" onchange="poRenderPage()" placeholder="qty" style="width:64px;padding:6px 8px;border:1px solid ' + (l.quantity != null && l.quantity > 0 ? '#e2e8f0' : '#fca5a5') + ';border-radius:8px;font-size:13px;">';
    html += '<input type="text" value="' + _poEsc(l.unit || '') + '" oninput="poLineSetUnit(' + i + ',this.value)" onchange="poRenderPage()" placeholder="case/lb/ea" style="width:80px;padding:6px 8px;border:1px solid ' + ((l.unit || '').trim() ? '#e2e8f0' : '#fca5a5') + ';border-radius:8px;font-size:13px;">';
    if(l.unit_from_history) html += '<span style="font-size:11px;color:#64748b;margin-left:4px;">come l\'ultima fattura</span>';
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
    html += vendorBlock;
    // Problemi che impediscono il riepilogo (la bozza si salva comunque).
    var shown = clientIssues.filter(function(x){ return x.code !== 'AMBIGUOUS' || !l.needs_review; });
    if(shown.length) html += '<div style="margin-top:4px;">' + poIssueBadges(shown) + '</div>';

    html += '</div>';
  });

  html += '<button onclick="poLineAddManual()" style="width:100%;padding:10px;border:1px dashed #cbd5e1;border-radius:10px;background:none;color:#64748b;font-size:13px;cursor:pointer;margin-bottom:16px;">+ Aggiungi riga</button>';
  html += poRenderCheckBeforeOrdering();
  html += '<button id="poSaveBtn" onclick="poSaveDraft()" style="width:100%;height:46px;border-radius:12px;background:#1e3a5f;color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;">Prepara riepilogo</button>';
  return html;
}

// ── RENDER: lista ordini per stato ───────────────────────────────────
var PO_LIST_SECTIONS = [
  { title: 'Bozze', statuses: ['draft'] },
  { title: 'Da confermare (Max)', statuses: ['ready'] },
  { title: 'Confermati — da inviare', statuses: ['confirmed'] },
  { title: 'Inviati — in attesa', statuses: ['sent', 'sent_manual', 'acknowledged'] },
  { title: 'Chiusi di recente', statuses: ['received', 'cancelled'] }
];

function poStatusPill(status){
  var c = { draft: ['#475569','#f1f5f9'], ready: ['#92400e','#fef3c7'], confirmed: ['#1e40af','#dbeafe'],
            sent: ['#166534','#dcfce7'], sent_manual: ['#166534','#dcfce7'], acknowledged: ['#166534','#dcfce7'],
            received: ['#334155','#e2e8f0'], cancelled: ['#991b1b','#fee2e2'] }[status] || ['#475569','#f1f5f9'];
  return '<span style="font-size:10px;font-weight:700;color:' + c[0] + ';background:' + c[1] + ';padding:2px 7px;border-radius:6px;white-space:nowrap;">' + _poEsc(poStatusLabel(status)) + '</span>';
}

function poRenderOrdersList(){
  var html = '';
  if(_poOpenDrafts.length === 0){
    html += '<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px;">Ordini</div>';
    html += '<div style="font-size:13px;color:#94a3b8;padding:12px 0;">Nessun ordine aperto.</div>';
  }
  PO_LIST_SECTIONS.forEach(function(sec){
    var rows = _poOpenDrafts.filter(function(d){ return sec.statuses.indexOf(d.status) >= 0; });
    if(!rows.length) return;
    html += '<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px;">' + _poEsc(sec.title) + '</div>';
    rows.forEach(function(d){
      var date = new Date(d.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      html += '<div onclick="poOpenOrder(\'' + d.id + '\')" style="background:rgba(255,255,255,0.7);border:1px solid ' + (d.blocking_count ? '#fbbf24' : '#e2e8f0') + ';border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;">';
      html += '<div style="min-width:0;"><div style="font-size:13px;font-weight:600;color:#1e3a5f;">' + _poEsc(d.vendor_name) + '</div>';
      html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + _poEsc(d.created_by || 'Unknown') + ' · ' + date + ' · ' + (d.line_count || 0) + ' righe' +
        (d.delivery_date ? ' · consegna ' + _poEsc(d.delivery_date) : '') + '</div>';
      if(d.blocking_count) html += '<div style="font-size:11px;color:#92400e;margin-top:2px;">⚠ ' + d.blocking_count + ' da sistemare</div>';
      html += '</div><div style="display:flex;align-items:center;gap:6px;">' + poStatusPill(d.status) + '<span style="color:#94a3b8;">&#8250;</span></div></div>';
    });
  });

  // Ordine fatto fuori da Brigade (email/telefono/portale): lo registriamo
  // perché il controllo doppioni lo veda.
  html += '<details id="poExtBox" style="margin-top:18px;font-size:12px;color:#64748b;">';
  html += '<summary style="cursor:pointer;">Hai ordinato fuori da Brigade? Registralo</summary>';
  html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">';
  html += '<input id="poExtVendor" placeholder="Fornitore" style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
  html += '<select id="poExtChannel" style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;"><option value="">Come?</option><option value="email">Email</option><option value="portal">Portale</option><option value="phone">Telefono</option><option value="manual">Altro</option></select>';
  html += '<input id="poExtNote" placeholder="Nota (facoltativa)" style="padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
  html += '<button onclick="poRegisterExternalSend()" style="height:38px;border-radius:10px;border:1px solid #1e3a5f;background:white;color:#1e3a5f;font-weight:700;cursor:pointer;">Registra</button>';
  html += '</div></details>';
  return html;
}

// ── RENDER: righe con problemi / prezzo ─────────────────────────────
function poIssueBadges(issues){
  return (issues || []).map(function(i){
    var col = i.blocking ? 'color:#991b1b;background:#fee2e2;' : 'color:#92400e;background:#fef3c7;';
    return '<span style="font-size:10px;' + col + 'padding:2px 6px;border-radius:6px;margin-right:4px;display:inline-block;margin-top:3px;">' + (i.blocking ? '⛔ ' : '⚠ ') + _poEsc(i.msg || i.code) + '</span>';
  }).join('');
}

function poPriceText(l){
  if(l.reference_price == null) return '';
  var s = 'Rif. $' + Number(l.reference_price).toFixed(2) + (l.reference_price_unit ? '/' + _poEsc(l.reference_price_unit) : '');
  if(l.reference_price_date) s += ' · ' + _poEsc(l.reference_price_date);
  return '<span style="font-size:11px;color:' + (l.price_stale ? '#b45309' : '#64748b') + ';">' + s + (l.price_stale ? ' (vecchio)' : '') + '</span>';
}

function poRenderOrderLines(o){
  var html = '';
  (o.lines || []).forEach(function(l){
    var bad = ['incomplete','ambiguous','blocked'].indexOf(l.line_status) >= 0;
    html += '<div style="background:rgba(255,255,255,0.7);border:1px solid ' + (bad ? '#fca5a5' : '#e2e8f0') + ';border-radius:12px;padding:10px 12px;margin-bottom:8px;">';
    html += '<div style="display:flex;justify-content:space-between;gap:8px;"><div style="font-size:14px;font-weight:600;color:#1e3a5f;">' +
      _poEsc(l.matched_name || l.requested_text) + '</div><div style="font-size:14px;font-weight:700;color:#1e3a5f;white-space:nowrap;">' +
      (l.quantity != null ? _poEsc(String(l.quantity)) : '?') + ' ' + _poEsc(l.unit || '?') + '</div></div>';
    var meta = [];
    if(l.vendor_sku) meta.push('SKU ' + _poEsc(l.vendor_sku));
    if(l.pack_description) meta.push(_poEsc(l.pack_description));
    if(l.matched_name && l.requested_text && l.matched_name !== l.requested_text) meta.push('richiesto: "' + _poEsc(l.requested_text) + '"');
    if(meta.length) html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + meta.join(' · ') + '</div>';
    var price = poPriceText(l);
    if(price) html += '<div style="margin-top:2px;">' + price + '</div>';
    html += poIssueBadges((l.issues || []).filter(function(i){ return i.code !== 'PRICE_STALE'; }));
    if(l.received_status){
      html += '<div style="font-size:11px;color:' + (l.received_status === 'received' ? '#166534' : '#991b1b') + ';margin-top:4px;">Ricevimento: ' +
        _poEsc(l.received_status) + (l.received_qty != null ? ' (' + _poEsc(String(l.received_qty)) + ')' : '') + (l.received_note ? ' — ' + _poEsc(l.received_note) : '') +
        (l.received_photo_url ? ' · <a href="' + _poEsc(l.received_photo_url) + '" target="_blank" rel="noopener">foto</a>' : '') + '</div>';
    }
    html += '</div>';
  });
  return html;
}

function poRenderDuplicates(o, allowAck){
  var d = o.duplicates;
  if(!d || !d.items || !d.items.length) return '';
  var html = '<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:12px;padding:12px;margin:12px 0;">';
  html += '<div style="font-size:13px;font-weight:700;color:#9a3412;">⚠ Possibile doppio ordine (ultime ' + d.window_hours + ' ore)</div>';
  d.items.forEach(function(it){
    var when = it.at ? new Date(it.at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    var kind = it.kind === 'vendor_confirmation' ? 'Conferma ricevuta dal fornitore' : it.kind === 'manual_send' ? 'Invio manuale registrato' : 'Altro ordine inviato';
    html += '<div style="font-size:12px;color:#9a3412;margin-top:4px;">• ' + kind + ' · ' + _poEsc(when) + (it.detail ? ' · ' + _poEsc(it.detail) : '') + '</div>';
  });
  if(allowAck){
    html += '<label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#9a3412;margin-top:8px;"><input type="checkbox" id="poAckDup"> So che può essere un doppione: procedo lo stesso</label>';
  } else {
    html += '<div style="font-size:12px;color:#9a3412;margin-top:8px;">Solo Max può procedere comunque.</div>';
  }
  html += '</div>';
  return html;
}

function poSummaryPlainText(o){
  var s = o.summary || {};
  var lines = (s.lines || []).map(function(l){
    return l.quantity + ' ' + (l.unit || '') + ' — ' + (l.name || '') + (l.vendor_sku ? ' (SKU ' + l.vendor_sku + ')' : '') + (l.pack_description ? ' [' + l.pack_description + ']' : '');
  });
  return 'Order — Zeno\'s\nVendor: ' + (s.vendor || o.vendor_name) + '\nRequested delivery: ' + (s.delivery_date || '-') + '\n\n' +
    lines.join('\n') + (s.notes ? '\n\nNotes: ' + s.notes : '') + '\n\nPlease confirm by reply with your order number. Thank you.';
}

var _PO_BTN = 'width:100%;height:46px;border-radius:12px;border:none;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px;';
var _PO_BTN_PRIMARY = _PO_BTN + 'background:#1e3a5f;color:white;';
var _PO_BTN_SECOND = _PO_BTN + 'background:white;color:#1e3a5f;border:1px solid #1e3a5f;';
var _PO_BTN_DANGER = 'width:100%;height:40px;border-radius:12px;border:none;background:none;color:#ef4444;font-size:13px;cursor:pointer;margin-top:12px;';

function poRenderOrder(){
  var o = _poCurrentOrder;
  if(!o) return '';
  var me = _poMe || {};
  var isAdmin = !!me.is_admin;
  var html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  html += '<button onclick="poBackToList()" style="font-size:12px;color:#3B82F6;background:none;border:none;cursor:pointer;padding:0;">&#8249; Ordini</button>';
  html += poStatusPill(o.status) + '</div>';
  html += '<div style="font-size:18px;font-weight:700;color:#1e3a5f;">' + _poEsc(o.vendor_name) + '</div>';
  html += '<div style="font-size:12px;color:#94a3b8;margin-bottom:12px;">' + _poEsc(o.created_by || '') + ' · revisione ' + o.revision +
    (o.is_test ? ' · <b style="color:#b45309;">ORDINE DI PROVA</b>' : '') +
    (o.channel_info ? ' · canale: ' + _poEsc(o.channel_info.channel) : ' · canale: manuale') + '</div>';

  // data consegna
  if(o.status === 'draft'){
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">';
    html += '<label style="font-size:12px;color:#475569;white-space:nowrap;">Consegna</label>';
    html += '<input type="date" id="poOrderDelivery" value="' + _poEsc(o.delivery_date || '') + '" style="flex:1;padding:8px;border:1px solid ' + (o.delivery_date ? '#e2e8f0' : '#fbbf24') + ';border-radius:8px;font-size:13px;">';
    html += '<button onclick="poSaveOrderDeliveryDate()" style="height:36px;padding:0 12px;border-radius:8px;border:1px solid #1e3a5f;background:white;color:#1e3a5f;font-size:12px;font-weight:700;cursor:pointer;">Salva</button></div>';
  } else {
    html += '<div style="font-size:13px;color:#475569;margin-bottom:12px;">Consegna richiesta: <b>' + _poEsc(o.delivery_date || '—') + '</b></div>';
  }

  html += poRenderOrderLines(o);

  if(o.status === 'draft'){
    html += '<button onclick="poEditOrderLines()" style="' + _PO_BTN_SECOND + '">Modifica righe</button>';
    html += '<button onclick="poMarkReady()" style="' + _PO_BTN_PRIMARY + '">Prepara riepilogo per Max</button>';
  }

  if(o.status === 'ready' || o.status === 'confirmed'){
    var valid = o.status === 'ready' ? o.summary_valid : o.confirmation_valid;
    html += '<div style="margin-top:14px;padding:12px;border:1px solid ' + (valid ? '#cbd5e1' : '#fca5a5') + ';border-radius:12px;background:#f8fafc;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-size:13px;font-weight:700;color:#1e3a5f;">Riepilogo #' + _poEsc((o.summary_hash || '').slice(0, 8)) + '</div>' +
      '<button onclick="poCopySummary()" style="font-size:12px;color:#3B82F6;background:none;border:none;cursor:pointer;">Copia</button></div>';
    html += '<pre id="poSummaryText" style="white-space:pre-wrap;font-size:12px;color:#334155;margin:8px 0 0;font-family:inherit;">' + _poEsc(poSummaryPlainText(o)) + '</pre>';
    if(!valid) html += '<div style="font-size:12px;color:#991b1b;margin-top:6px;">⛔ L\'ordine è cambiato dopo il riepilogo: va rifatto.</div>';
    if(o.status === 'confirmed') html += '<div style="font-size:12px;color:#166534;margin-top:6px;">✓ Confermato da ' + _poEsc(o.confirmed_by || '') + '</div>';
    html += '</div>';
    html += poRenderDuplicates(o, isAdmin && o.status === 'confirmed');
  }

  if(o.status === 'ready'){
    if(isAdmin){
      html += '<button onclick="poConfirmOrder()" style="' + _PO_BTN_PRIMARY + '">Confermo questo riepilogo</button>';
    } else {
      html += '<div style="font-size:12px;color:#92400e;margin-top:8px;">In attesa della conferma di Max.</div>';
    }
    html += '<button onclick="poEditOrderLines()" style="' + _PO_BTN_SECOND + '">Modifica (annulla il riepilogo)</button>';
  }

  if(o.status === 'confirmed'){
    var ch = o.channel_info || { channel: 'manual' };
    html += poRenderRealAttempt(o);
    var lastReal = poLastRealAttempt(o);
    var realBusy = lastReal && lastReal.state === 'pending';
    if(isAdmin && poCwRealAvailable(o) && !realBusy){
      html += '<button onclick="poSendRealCw()" style="' + _PO_BTN_PRIMARY + 'background:#b91c1c;">Invia a Chef\'s Warehouse (ORDINE REALE)</button>';
      html += '<div style="font-size:11px;color:#64748b;margin-top:4px;">Parte solo questo riepilogo (#' + _poEsc((o.confirmed_hash || '').slice(0, 8)) + '). Il Mac Mini lo invia e salva il numero d\'ordine CW.</div>';
    }
    if(!realBusy){
      html += '<button onclick="poEditOrderLines()" style="' + _PO_BTN_SECOND + '">Modifica (annulla la conferma)</button>';
    }
    if(isAdmin && !realBusy){
      html += '<button onclick="poSendSimulated()" style="' + (poCwRealAvailable(o) ? _PO_BTN_SECOND : _PO_BTN_PRIMARY) + '">Prova invio (SIMULAZIONE — nulla parte)</button>';
      if(!poCwRealAvailable(o)) html += '<div style="font-size:11px;color:#64748b;margin-top:4px;">L\'invio automatico ai fornitori non è attivo: serve la decisione di Max.</div>';
    }
    html += '<div style="margin-top:14px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;">';
    html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;margin-bottom:6px;">Inviato a mano?</div>';
    if(ch.portal_url) html += '<div style="font-size:12px;margin-bottom:6px;"><a href="' + _poEsc(ch.portal_url) + '" target="_blank" rel="noopener">Apri portale</a></div>';
    if(ch.notes) html += '<div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">' + _poEsc(ch.notes) + '</div>';
    html += '<select id="poManualChannel" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:6px;">' +
      ['portal','email','phone','manual'].map(function(c){
        var lbl = { portal: 'Portale', email: 'Email', phone: 'Telefono', manual: 'Altro' }[c];
        return '<option value="' + c + '"' + (ch.channel === c ? ' selected' : '') + '>' + lbl + '</option>';
      }).join('') + '</select>';
    html += '<input id="poManualNumber" placeholder="Numero ordine del fornitore (se c\'è)" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:6px;">';
    html += '<input id="poManualNote" placeholder="Nota (facoltativa)" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
    html += '<button onclick="poRegisterManualSend()" style="' + _PO_BTN_SECOND + '">Registra invio manuale</button>';
    html += '</div>';
  }

  if(o.status === 'sent' || o.status === 'sent_manual'){
    html += '<div style="font-size:12px;color:#475569;margin-top:10px;">Inviato ' + (o.send_mode === 'simulated' ? '<b style="color:#b45309;">(SIMULATO — ordine di prova)</b> ' : '') +
      'da ' + _poEsc(o.sent_by || '') + (o.sent_at ? ' il ' + _poEsc(new Date(o.sent_at).toLocaleString('en-US')) : '') +
      (o.vendor_order_number ? ' · n. ' + _poEsc(o.vendor_order_number) : '') + '</div>';
    html += '<button onclick="poLoadCandidates()" style="' + _PO_BTN_SECOND + '">Cerca conferma del fornitore</button>';
    if(_poCandidates){
      if(!_poCandidates.length) html += '<div style="font-size:12px;color:#94a3b8;margin-top:6px;">Nessuna conferma trovata per ora.</div>';
      _poCandidates.forEach(function(c){
        html += '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-top:6px;font-size:12px;color:#334155;">';
        html += '<b>#' + _poEsc(c.document_number || '?') + '</b> · ' + _poEsc(c.document_date || '') + ' · ' + c.item_count + ' righe' +
          (c.number_match ? ' · <span style="color:#166534;">numero corrisponde</span>' : '') + (c.sku_overlap ? ' · ' + c.sku_overlap + ' SKU in comune' : '');
        html += '<button onclick="poLinkConfirmation(\'' + c.vendor_document_id + '\')" style="display:block;margin-top:6px;font-size:12px;color:#3B82F6;background:none;border:none;cursor:pointer;padding:0;">Collega a questo ordine</button></div>';
      });
    }
  }

  if(o.status === 'acknowledged'){
    html += '<div style="font-size:12px;color:#166534;margin-top:10px;">Confermato dal fornitore · n. ' + _poEsc(o.vendor_order_number || '?') + '</div>';
    var ack = (o.events || []).filter(function(e){ return e.event === 'acknowledged'; }).pop();
    var diffs = ack && ack.detail && ack.detail.differences;
    if(diffs && diffs.length){
      html += '<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:10px;margin-top:6px;font-size:12px;color:#9a3412;">Differenze ordinato/confermato:';
      diffs.forEach(function(d){ html += '<div>• ' + _poEsc(d.name || d.vendor_sku) + ': ordinato ' + (d.ordered != null ? d.ordered : '—') + ', confermato ' + (d.confirmed != null ? d.confirmed : '—') + '</div>'; });
      html += '</div>';
    }
  }

  if(['sent','sent_manual','acknowledged'].indexOf(o.status) >= 0){
    html += '<button onclick="poStartReceive()" style="' + _PO_BTN_PRIMARY + '">Check-in ricevimento</button>';
  }

  (o.complaint_drafts || []).forEach(function(c){
    html += '<div style="margin-top:14px;padding:12px;border:1px solid #fca5a5;border-radius:12px;background:#fef2f2;">';
    html += '<div style="font-size:13px;font-weight:700;color:#991b1b;">Bozza reclamo — NON inviata</div>';
    html += '<div style="font-size:12px;color:#7f1d1d;margin-top:4px;">' + _poEsc(c.subject || '') + '</div>';
    html += '<pre style="white-space:pre-wrap;font-size:12px;color:#334155;margin:8px 0 0;font-family:inherit;">' + _poEsc(c.body || '') + '</pre></div>';
  });

  if(['draft','ready'].indexOf(o.status) >= 0 || (isAdmin && ['confirmed','sent','sent_manual','acknowledged'].indexOf(o.status) >= 0)){
    html += '<button onclick="poCancelOrder()" style="' + _PO_BTN_DANGER + '">Annulla ordine</button>';
  }

  // storico
  if((o.events || []).length){
    html += '<details style="margin-top:14px;font-size:11px;color:#94a3b8;"><summary style="cursor:pointer;">Storico</summary>';
    o.events.forEach(function(e){
      html += '<div style="margin-top:3px;">' + _poEsc(new Date(e.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })) +
        ' · ' + _poEsc(e.event) + ' · ' + _poEsc(e.actor || '') + '</div>';
    });
    html += '</details>';
  }
  return html;
}

function poRenderReceive(){
  var o = _poCurrentOrder;
  if(!o) return '';
  var html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1e3a5f;">Ricevimento — ' + _poEsc(o.vendor_name) + '</div>';
  html += '<button onclick="poOpenOrder(\'' + o.id + '\')" style="font-size:12px;color:#3B82F6;background:none;border:none;cursor:pointer;">&#8249; Indietro</button></div>';
  (o.lines || []).forEach(function(l){
    var d = _poReceiveDraft[l.id] || { status: 'received' };
    html += '<div style="background:rgba(255,255,255,0.7);border:1px solid ' + (d.status === 'received' ? '#e2e8f0' : '#fca5a5') + ';border-radius:12px;padding:10px 12px;margin-bottom:8px;">';
    html += '<div style="font-size:14px;font-weight:600;color:#1e3a5f;">' + _poEsc(l.matched_name || l.requested_text) + ' <span style="font-weight:400;color:#64748b;">· ordinati ' + _poEsc(String(l.quantity)) + ' ' + _poEsc(l.unit || '') + '</span></div>';
    html += '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">';
    [['received','Ricevuto'],['partial','Parziale'],['missing','Mancante'],['damaged','Danneggiato']].forEach(function(s){
      var on = d.status === s[0];
      html += '<button onclick="poRecvSet(\'' + l.id + '\',\'status\',\'' + s[0] + '\')" style="padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer;border:1px solid ' + (on ? '#1e3a5f' : '#e2e8f0') + ';background:' + (on ? '#1e3a5f' : 'white') + ';color:' + (on ? 'white' : '#475569') + ';">' + s[1] + '</button>';
    });
    html += '</div>';
    if(d.status !== 'received'){
      if(d.status !== 'missing'){
        html += '<input type="number" value="' + (d.received_qty != null ? d.received_qty : '') + '" oninput="poRecvSet(\'' + l.id + '\',\'received_qty\',this.value)" placeholder="qtà ricevuta" style="width:110px;margin-top:6px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
      }
      html += '<input value="' + _poEsc(d.note || '') + '" oninput="poRecvSet(\'' + l.id + '\',\'note\',this.value)" placeholder="nota" style="width:100%;box-sizing:border-box;margin-top:6px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">';
      html += '<label style="display:inline-block;margin-top:6px;font-size:12px;color:#3B82F6;cursor:pointer;">📷 ' + (d.photo_url ? 'Foto allegata ✓' : 'Foto (facoltativa)') +
        '<input type="file" accept="image/*" capture="environment" onchange="poRecvPhoto(\'' + l.id + '\',this)" style="display:none;"></label>';
    }
    html += '</div>';
  });
  html += '<div style="font-size:11px;color:#64748b;margin-top:4px;">Se qualcosa manca o è danneggiato viene preparata una BOZZA di reclamo: non parte nessun messaggio.</div>';
  html += '<button onclick="poSubmitReceive()" style="' + _PO_BTN_PRIMARY + '">Chiudi ricevimento</button>';
  return html;
}

// ── TEST-ONLY EXPORTS ────────────────────────────────────────────
// No-op in the browser (no `module` there). Lets tests/ require this
// file directly and exercise the real matching code — not a copy of it.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    poMatchItem: poMatchItem,
    poLastUnit: poLastUnit,
    poNormalize: poNormalize,
    poStem: poStem,
    poTokens: poTokens,
    poScore: poScore,
    poParseLine: poParseLine,
    poResolveVendorForIngredient: poResolveVendorForIngredient,
    poNormalizeVendorName: poNormalizeVendorName,
    poResponsibleFor: poResponsibleFor,
    poRenderCheckBeforeOrdering: poRenderCheckBeforeOrdering,
    poRenderChefAISuggests: poRenderChefAISuggests,
    poRenderList: poRenderList,
    poBuildSaveGroups: poBuildSaveGroups,
    poLineClientIssues: poLineClientIssues,
    poReasonText: poReasonText,
    poStatusLabel: poStatusLabel,
    poIdemKey: poIdemKey,
    poRenderOrder: poRenderOrder,
    poRenderReceive: poRenderReceive,
    poRenderOrdersList: poRenderOrdersList,
    poSummaryPlainText: poSummaryPlainText,
    poSetOrderForTest: function(o, me){ _poCurrentOrder = o; _poMe = me || null; },
    poCatalogToDraftLines: poCatalogToDraftLines,
    poRenderVendor: poRenderVendor,
    poSetVendorViewForTest: function(vendor, catalog, qty, search){ _poVendorSel = vendor; _poCatalog = catalog; _poCatQty = qty || {}; _poCatSearch = search || ''; },
    poSetSettingsForTest: function(st){ _poSettings = st || null; },
    poCwRealAvailable: poCwRealAvailable,
    poSetOpenOrdersForTest: function(list){ _poOpenDrafts = list || []; },
    poSetReceiveDraftForTest: function(d){ _poReceiveDraft = d || {}; },
    poCheckBeforeOrderingWording: poCheckBeforeOrderingWording,
    poSetRhythmResultsForTest: function(results){ _poRhythmResults = results; },
    poSetDraftLinesForTest: function(lines){ _poDraftLines = lines || []; },
    poSetCatalogsForTest: function(alias, ingVendor, links, purchaseFreq, invoiceLines){
      _poAliasCatalog = alias || [];
      _poIngVendorCatalog = ingVendor || [];
      _poLinkCatalog = links || [];
      _poPurchaseFreq = purchaseFreq || {};
      _poInvoiceLineRows = invoiceLines || [];
      _poPurchaseFreqByVendor = {};
      _poInvoiceLineRows.forEach(function(r){
        if(!r.ingredient_id) return;
        var key = r.ingredient_id + '|' + r.vendor;
        _poPurchaseFreqByVendor[key] = (_poPurchaseFreqByVendor[key] || 0) + 1;
      });
      // Same eligibility derivation as poLoadCatalog — a vendor needs both
      // ingredient_vendors presence and corroboration elsewhere.
      var ivVendors = {}, linkVendors = {}, invVendors = {};
      _poIngVendorCatalog.forEach(function(r){ if(r.vendor) ivVendors[r.vendor] = true; });
      _poLinkCatalog.forEach(function(r){ if(r.vendor) linkVendors[r.vendor] = true; });
      _poInvoiceLineRows.forEach(function(r){ if(r.vendor) invVendors[r.vendor] = true; });
      _poEligibleVendors = {};
      Object.keys(ivVendors).forEach(function(v){
        if(linkVendors[v] || invVendors[v]) _poEligibleVendors[v] = true;
      });
    }
  };
}
