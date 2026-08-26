// Testability: in a real browser `window` always exists, so this is a no-op there.
// It only kicks in when this file is require()'d from plain Node (see tests/).
if (typeof window === 'undefined') { global.window = global; }

// ══════════════════════════════════════════════════════════════
// PURCHASE ORDER — Compila Ordine (Multi-vendor Draft v2)
// Dictate/type a shopping list, resolve each item's real vendor from
// proven product-level evidence, match against that vendor's catalog,
// review and correct, save into one draft per vendor.
// NOT in scope here: Tell Chef integration, vendor portal logins,
// browser automation, sending orders, receiving goods.
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

  var sb = window.supabaseClient;
  var { data, error } = await sb.from('purchase_order_lines')
    .select('purchase_order_id, purchase_orders!inner(vendor_name,status)')
    .eq('purchase_orders.status', 'draft');
  if(error){ console.error('[purchase-order] home panel error', error); return; }

  var counts = {};
  (data || []).forEach(function(r){
    var v = r.purchase_orders && r.purchase_orders.vendor_name;
    if(!v) return;
    counts[v] = (counts[v] || 0) + 1;
  });

  if(isAnto && antoEl){
    var n = counts['Walmart'] || 0;
    if(n > 0){
      antoEl.style.display = 'block';
      var body = antoEl.querySelector('[data-role="body"]');
      if(body) body.textContent = n + (n === 1 ? ' item' : ' items') + ' to review';
    }
  }

  if(isTela && telaEl){
    var rows = Object.keys(counts).filter(function(v){ return v !== 'Walmart'; }).sort();
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
      sb.from('ingredient_vendors').select('id,vendor,vendor_sku,ingredient_id,ingredients(name)').eq('active', true).eq('do_not_order', false),
      sb.from('ingredient_links').select('id,vendor,invoice_description,ingredient_name,ingredient_id,confidence,confirmed'),
      sb.from('invoice_lines').select('vendor,ingredient_id').not('ingredient_id', 'is', null)
    ]);
    _poAliasCatalog = alias.data || [];
    _poIngVendorCatalog = (iv.data || []).map(function(r){
      return { id:r.id, vendor:r.vendor, vendor_sku:r.vendor_sku, ingredient_id:r.ingredient_id, name: r.ingredients ? r.ingredients.name : null };
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
window.poLineSetUnit = function(i, val){ _poDraftLines[i].unit = val.trim() || null; };
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
        vendor: PO_VENDOR,
        vendor_sku: l.vendor_sku || null,
        vendor_description: l.requested_text,
        ingredient_id: l.ingredient_id,
        confirmed_by: (window.user && window.user.name) || 'Unknown',
        notes: 'Auto-creato da correzione manuale in Compila Ordine'
      });
      if(!ins.error){
        // keep in-memory catalog in sync so a second correction in the same
        // session doesn't try to insert the same alias again
        _poAliasCatalog.push({ vendor_sku: l.vendor_sku, vendor_description: l.requested_text, ingredient_id: l.ingredient_id });
      } else {
        console.error('[purchase-order] alias learn failed for', l.requested_text, ins.error);
      }
    }catch(e){
      console.error('[purchase-order] alias learn error', e);
    }
  }
}

// ── FIND-OR-CREATE DRAFT PER VENDOR ─────────────────────────────────
// Only ever reuses status='draft'. 'ready'/'sent'/'cancelled' orders are
// never appended to — they've moved past normal compilation.
async function poFindLatestDraftForVendor(vendor){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('purchase_orders')
    .select('id').eq('vendor_name', vendor).eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(1);
  if(error){ console.error('[purchase-order] find draft error', error); return null; }
  return (data && data.length > 0) ? data[0].id : null;
}

async function poFetchDraftLines(orderId){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('purchase_order_lines')
    .select('*').eq('purchase_order_id', orderId).order('created_at', { ascending: true });
  if(error) throw error;
  return data || [];
}

function poLineToRow(l, orderId, vendor){
  return {
    purchase_order_id: orderId,
    ingredient_id: l.ingredient_id || null,
    vendor_name: vendor,
    vendor_sku: l.vendor_sku || null,
    requested_text: l.requested_text,
    matched_name: l.matched_name || null,
    quantity: l.quantity,
    unit: l.unit || null,
    match_confidence: l.match_confidence,
    match_source: l.match_source || 'manual'
  };
}

// ── SAVE DRAFT ─────────────────────────────────────────────────────
// Correction: never invent a vendor. Only lines whose vendor_status is
// 'resolved' get persisted — anything 'ambiguous' or 'unresolved' stays
// in the review screen untouched, waiting for a human to pick a vendor.
window.poSaveDraft = async function(){
  var resolved = _poDraftLines.filter(function(l){ return l.vendor_status === 'resolved' && l.vendor; });
  var pendingCount = _poDraftLines.length - resolved.length;

  if(resolved.length === 0){
    poToast(pendingCount > 0
      ? 'Nessuna riga pronta — scegli il vendor per le righe segnalate.'
      : 'Nessuna riga da salvare.');
    return;
  }

  var sb = window.supabaseClient;
  var btn = document.getElementById('poSaveBtn');
  if(btn){ btn.disabled = true; btn.textContent = '…'; }

  var byVendor = {};
  resolved.forEach(function(l){ (byVendor[l.vendor] = byVendor[l.vendor] || []).push(l); });

  try{
    for(var vendor in byVendor){
      var orderId, existingRows;
      if(vendor === _poEditingVendor && _poEditingOrderId){
        // This is the exact draft the user opened — _poDraftLines already IS
        // its full authoritative line set, so replace cleanly (no re-fetch,
        // matches the original single-vendor semantics exactly).
        orderId = _poEditingOrderId;
        var del = await sb.from('purchase_order_lines').delete().eq('purchase_order_id', orderId);
        if(del.error) throw del.error;
        existingRows = [];
      } else {
        // A vendor we're touching for the first time this session — find or
        // create its draft, and if one already exists, preserve its lines
        // (append, never replace-with-only-the-new-item).
        orderId = await poFindLatestDraftForVendor(vendor);
        if(!orderId){
          var ins = await sb.from('purchase_orders').insert({
            vendor_name: vendor, status: 'draft',
            created_by: (window.user && window.user.name) || 'Unknown'
          }).select('id').single();
          if(ins.error) throw ins.error;
          orderId = ins.data.id;
          existingRows = [];
        } else {
          existingRows = (await poFetchDraftLines(orderId)).map(function(l){
            return { ingredient_id: l.ingredient_id, vendor_sku: l.vendor_sku, requested_text: l.requested_text,
              matched_name: l.matched_name, quantity: l.quantity, unit: l.unit,
              match_confidence: l.match_confidence, match_source: l.match_source };
          });
          var del2 = await sb.from('purchase_order_lines').delete().eq('purchase_order_id', orderId);
          if(del2.error) throw del2.error;
        }
      }

      var rows = existingRows.concat(byVendor[vendor]).map(function(l){ return poLineToRow(l, orderId, vendor); });
      var insLines = await sb.from('purchase_order_lines').insert(rows);
      if(insLines.error) throw insLines.error;
    }

    // If the opened draft's vendor now has zero resolved lines left (user
    // removed them all), clear it out rather than leaving stale lines behind.
    if(_poEditingOrderId && _poEditingVendor && !byVendor[_poEditingVendor]){
      var stillHasVendor = _poDraftLines.some(function(l){ return l.vendor === _poEditingVendor; });
      if(!stillHasVendor){
        await sb.from('purchase_order_lines').delete().eq('purchase_order_id', _poEditingOrderId);
      }
    }

    await poLearnAliasesFromCorrections();

    // Tell Chef bridge: only now — after every line above is actually
    // persisted — mark the source shortage as added to order. If anything
    // above threw, this never runs and _poPendingOfficeItemId stays set so
    // a retry of Save Draft still honors it.
    if(_poPendingOfficeItemId){
      var pendingOfficeItemId = _poPendingOfficeItemId;
      _poPendingOfficeItemId = null;
      try{
        await sb.from('office_items').update({
          chef_action: 'added_to_order',
          chef_action_at: new Date().toISOString(),
          chef_action_by: (window.user && window.user.name) || 'Unknown'
        }).eq('id', pendingOfficeItemId);
      }catch(ackErr){
        console.error('[purchase-order] tell-chef ack failed (order line still saved)', ackErr);
      }
    }

    poToast(pendingCount > 0
      ? ('Bozza salvata ✓ — ' + pendingCount + (pendingCount === 1 ? ' riga in sospeso (vendor da scegliere)' : ' righe in sospeso (vendor da scegliere)'))
      : 'Bozza salvata ✓');

    _poDraftLines = _poDraftLines.filter(function(l){ return l.vendor_status !== 'resolved'; });
    if(_poDraftLines.length === 0){
      _poView = 'list';
      _poEditingOrderId = null;
      _poEditingVendor = null;
    }
    poRenderPage();
    poLoadOpenDrafts();
  }catch(e){
    console.error('[purchase-order] save error', e);
    poToast('Errore nel salvataggio');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Salva bozza'; }
  }
};

// ── OPEN DRAFTS LIST (all vendors) ──────────────────────────────────
async function poLoadOpenDrafts(){
  var sb = window.supabaseClient;
  var { data, error } = await sb.from('purchase_orders')
    .select('id,vendor_name,status,created_by,created_at,notes')
    .in('status', ['draft', 'ready'])
    .order('created_at', { ascending: false });
  if(error){ console.error('[purchase-order] load drafts error', error); return; }
  _poOpenDrafts = data || [];
  if(_poView === 'list') poRenderPage();
}

window.poOpenDraft = async function(orderId){
  var sb = window.supabaseClient;
  var target = _poOpenDrafts.find(function(d){ return d.id === orderId; });
  var { data, error } = await sb.from('purchase_order_lines')
    .select('*').eq('purchase_order_id', orderId).order('created_at', { ascending: true });
  if(error){ poToast('Errore nel caricamento'); return; }
  _poDraftLines = (data || []).map(function(l){
    return {
      requested_text: l.requested_text, quantity: l.quantity, unit: l.unit,
      ingredient_id: l.ingredient_id, matched_name: l.matched_name, vendor_sku: l.vendor_sku,
      match_confidence: l.match_confidence, match_source: l.match_source,
      needs_review: !l.ingredient_id && l.match_source !== 'manual', candidates: [],
      vendor: l.vendor_name, vendor_status: 'resolved', vendor_candidates: []
    };
  });
  _poEditingOrderId = orderId;
  _poEditingVendor = target ? target.vendor_name : (data && data[0] ? data[0].vendor_name : null);
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
  html += '<textarea id="poInputText" rows="6" placeholder="heavy cream 2 cases\nparsley 3\nbrussels sprouts 10 lb\nshrimp 5 lb" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>';
  html += '<div style="display:flex;gap:8px;margin-top:10px;">';
  html += '<button id="poMicBtn" onclick="poToggleMic()" style="width:44px;height:44px;border-radius:12px;border:1px solid #e2e8f0;background:white;font-size:18px;cursor:pointer;flex-shrink:0;">🎙️</button>';
  html += '<button id="poCreateBtn" onclick="poParseAndMatch()" style="flex:1;height:44px;border-radius:12px;background:#1e3a5f;color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;">Crea ordine</button>';
  html += '</div></div>';
  html += '<style>.po-mic-active{background:#dbeafe !important;border-color:#3b82f6 !important;}</style>';

  html += '<div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:20px 0 8px;">Bozze aperte</div>';
  if(_poOpenDrafts.length === 0){
    html += '<div style="font-size:13px;color:#94a3b8;padding:12px 0;">Nessuna bozza aperta.</div>';
  } else {
    var byVendor = {};
    _poOpenDrafts.forEach(function(d){ (byVendor[d.vendor_name] = byVendor[d.vendor_name] || []).push(d); });
    Object.keys(byVendor).sort().forEach(function(vendor){
      html += '<div style="font-size:11px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.03em;margin:14px 0 6px;">' + _poEsc(vendor) + '</div>';
      byVendor[vendor].forEach(function(d){
        var date = new Date(d.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        html += '<div onclick="poOpenDraft(\'' + d.id + '\')" style="background:rgba(255,255,255,0.7);border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">';
        html += '<div><div style="font-size:13px;font-weight:600;color:#1e3a5f;">' + _poEsc(d.created_by || 'Unknown') + ' · ' + _poEsc(d.status) + '</div>';
        html += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + date + '</div></div>';
        html += '<span style="color:#94a3b8;">&#8250;</span></div>';
      });
    });
  }
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

    html += '<div style="background:rgba(255,255,255,0.7);border:1px solid ' + (l.needs_review || l.vendor_status !== 'resolved' ? '#fbbf24' : '#e2e8f0') + ';border-radius:12px;padding:12px;margin-bottom:10px;">';
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
    html += vendorBlock;

    html += '</div>';
  });

  html += '<button onclick="poLineAddManual()" style="width:100%;padding:10px;border:1px dashed #cbd5e1;border-radius:10px;background:none;color:#64748b;font-size:13px;cursor:pointer;margin-bottom:16px;">+ Aggiungi riga</button>';
  html += poRenderCheckBeforeOrdering();
  html += '<button id="poSaveBtn" onclick="poSaveDraft()" style="width:100%;height:46px;border-radius:12px;background:#1e3a5f;color:white;border:none;font-size:14px;font-weight:700;cursor:pointer;">Salva bozza</button>';
  return html;
}

// ── TEST-ONLY EXPORTS ────────────────────────────────────────────
// No-op in the browser (no `module` there). Lets tests/ require this
// file directly and exercise the real matching code — not a copy of it.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    poMatchItem: poMatchItem,
    poNormalize: poNormalize,
    poStem: poStem,
    poTokens: poTokens,
    poScore: poScore,
    poParseLine: poParseLine,
    poResolveVendorForIngredient: poResolveVendorForIngredient,
    poNormalizeVendorName: poNormalizeVendorName,
    poResponsibleFor: poResponsibleFor,
    poRenderCheckBeforeOrdering: poRenderCheckBeforeOrdering,
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
