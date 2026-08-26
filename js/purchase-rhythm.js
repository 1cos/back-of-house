// ── PURCHASE RHYTHM v1 — Deterministic reorder-check engine ──────────────────
// Version: 1.0.0 — read-only analytical engine, no ML, no DB writes.
// Status:  Standalone module, not yet wired into purchase-order.js or any UI.
//          Placement rationale: purchase-order.js already owns SKU/vendor
//          matching (poMatchItem, poResolveVendorForIngredient) — Purchase
//          Rhythm is a different concern (WHEN to check, not WHICH vendor/SKU)
//          and has its own equivalence config, so it gets its own file rather
//          than growing purchase-order.js. Same pattern already established
//          by unit-normalizer.js: a small, focused, framework-free module.
//
// Philosophy:
//   Non dire "ORDINA QUESTO". Dire "CONTROLLA QUESTO PRIMA DI CHIUDERE
//   L'ORDINE". Preferire silenzio a falsi allarmi.
//
// Usage:
//   import { computeIngredientRhythm, computePurchaseRhythmSnapshot,
//            FUNCTIONAL_INGREDIENT_EQUIVALENCE } from './purchase-rhythm.js';
// ───────────────────────────────────────────────────────────────────────────

// ── FUNCTIONAL INGREDIENT EQUIVALENCE CONFIG (Chef-confirmed only) ─────────
// Explicit, readable, per-ingredient. Never auto-aggregate blindly by
// ingredient_id — this table is the single source of truth for which SKUs
// count toward the same "need" and which don't.
//
// included_skus: null  → no restriction, any SKU under this ingredient_id counts
// included_skus: [...] → ONLY these SKUs count (allowlist)
// excluded_skus: [...] → these SKUs never count, even if included_skus is null
// canonical_sku:        the preferred/ordering SKU (informational only here)
// cross_vendor_blind_spot: true → this ingredient is known to also be bought
//   outside Hardie's/CW (e.g. Walmart), so Hardie's-only data can never prove
//   the ingredient is actually missing.
export const FUNCTIONAL_INGREDIENT_EQUIVALENCE = {
  '28bd0f90-c1ca-462e-8936-efee74cf9bd6': { // Stew Meat
    name: 'Stew Meat',
    included_skus: ['24171', '29554'],
    excluded_skus: ['23278'],
    canonical_sku: '24171',
    cross_vendor_blind_spot: false,
  },
  '9dc8b439-79fb-4fa5-8a89-48c89a300231': { // Heavy Cream
    name: 'Heavy Cream',
    included_skus: ['03744', '10068', '13405'],
    excluded_skus: [],
    canonical_sku: '03744',
    cross_vendor_blind_spot: false,
  },
  'c77db80e-4f35-4835-a14d-007fe9ec1a03': { // Cherry Tomatoes
    name: 'Cherry Tomatoes',
    included_skus: ['07673'],
    excluded_skus: ['22520', '33536'],
    canonical_sku: '07673',
    cross_vendor_blind_spot: false,
  },
  '719e8b11-8703-4372-9d43-46c100ecc8f3': { // Blanched Almonds
    name: 'Blanched Almonds',
    included_skus: ['25035'],
    excluded_skus: ['02138'],
    canonical_sku: '25035',
    cross_vendor_blind_spot: false,
  },
  '643c5766-ba37-4f61-a165-2e264048fd69': { // Watermelon
    name: 'Watermelon',
    included_skus: null,
    excluded_skus: [],
    canonical_sku: '05446',
    cross_vendor_blind_spot: true,
  },
};

const DEFAULT_EQUIVALENCE = { name: null, included_skus: null, excluded_skus: [], canonical_sku: null, cross_vendor_blind_spot: false };

export function resolveEquivalenceConfig(ingredientId) {
  return FUNCTIONAL_INGREDIENT_EQUIVALENCE[ingredientId] || DEFAULT_EQUIVALENCE;
}

// Does this specific invoice_lines row count toward the functional ingredient?
export function isEventEligible(ingredientId, vendorSku) {
  const cfg = resolveEquivalenceConfig(ingredientId);
  if (cfg.excluded_skus && cfg.excluded_skus.includes(vendorSku)) return false;
  if (cfg.included_skus && !cfg.included_skus.includes(vendorSku)) return false;
  return true;
}

// ── DATE HELPERS ────────────────────────────────────────────────────────────
// 'YYYY-MM-DD' strings only. Date.UTC keeps this immune to local-timezone
// drift (same class of bug documented in the Journal timezone hotfix).
function toUTCDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function daysBetween(fromYmd, toYmd) {
  return Math.round((toUTCDate(toYmd) - toUTCDate(fromYmd)) / 86400000);
}

// ── ROBUST STATS (no ML — plain percentile/median, linear interpolation,
// same method as Postgres percentile_cont, so results match the audits) ────
function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = p * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}
function median(arr) {
  return percentile([...arr].sort((a, b) => a - b), 0.5);
}

// ── CORE ENGINE ─────────────────────────────────────────────────────────────
// rawEvents: array of { invoice_date: 'YYYY-MM-DD', vendor_sku, qty, pack_description }
//            — already filtered to a single vendor (e.g. Hardie's) by the caller.
// opts.asOfDate: 'YYYY-MM-DD' — reference "today". Required.
// opts.pendingSince: 'YYYY-MM-DD' | null — earliest document_date among
//            vendor_documents with status IN ('pending','pdf_received') for
//            this vendor. If set and >= last purchase date (i.e. there is
//            unprocessed data that could change the picture), any check-tier
//            status gets downgraded to DATA_INCOMPLETE.
export function computeIngredientRhythm(ingredientId, rawEvents, opts) {
  const cfg = resolveEquivalenceConfig(ingredientId);
  const asOf = opts.asOfDate;
  const pendingSince = opts.pendingSince || null;

  // STEP 4/5: filter by equivalence config, then dedupe same-day events.
  const eligible = rawEvents.filter(r => isEventEligible(ingredientId, r.vendor_sku));
  const dateSet = new Set(eligible.map(r => r.invoice_date));
  const dates = [...dateSet].sort();

  const event_count = dates.length;

  const result = {
    ingredient_id: ingredientId,
    ingredient_name: cfg.name,
    event_count,
    confidence: event_count >= 5 ? 'HIGH' : event_count >= 3 ? 'MEDIUM' : 'LOW',
    median_gap_days: null, p75_gap_days: null, min_gap: null, max_gap: null,
    mad_gap: null, mad_ratio: null, max_median_ratio: null,
    regularity: null,
    last_purchase_date: dates.length ? dates[dates.length - 1] : null,
    days_since_last: null,
    check_threshold_days: null,
    cross_vendor_blind_spot: cfg.cross_vendor_blind_spot,
    status: null,
    _raw_status: null, // pre-override status, kept for transparency/tests
  };

  if (result.last_purchase_date) {
    result.days_since_last = daysBetween(result.last_purchase_date, asOf);
  }

  // Not enough history at all → nothing else matters.
  if (event_count < 3) {
    result.status = 'INSUFFICIENT_HISTORY';
    result._raw_status = 'INSUFFICIENT_HISTORY';
    return result;
  }

  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const sortedGaps = [...gaps].sort((a, b) => a - b);

  const medianGap = median(sortedGaps);
  const p75 = percentile(sortedGaps, 0.75);
  const minGap = sortedGaps[0];
  const maxGap = sortedGaps[sortedGaps.length - 1];
  const madGap = median(gaps.map(g => Math.abs(g - medianGap)));
  const madRatio = medianGap > 0 ? madGap / medianGap : null;
  const maxMedianRatio = medianGap > 0 ? maxGap / medianGap : null;

  result.median_gap_days = medianGap;
  result.p75_gap_days = p75;
  result.min_gap = minGap;
  result.max_gap = maxGap;
  result.mad_gap = madGap;
  result.mad_ratio = madRatio;
  result.max_median_ratio = maxMedianRatio;

  // Regularity — simplest classification compatible with the rule: what
  // matters operationally is RECURRING vs "not recurring" (never CHECK).
  const isRecurring = madRatio !== null && madRatio < 0.5 && maxMedianRatio !== null && maxMedianRatio < 3;
  if (isRecurring) {
    result.regularity = 'RECURRING';
  } else if (maxMedianRatio !== null && maxMedianRatio >= 5) {
    result.regularity = 'SPORADIC';
  } else {
    result.regularity = 'VARIABLE';
  }

  if (result.regularity !== 'RECURRING') {
    result.status = 'SUPPRESSED_VARIABLE';
    result._raw_status = 'SUPPRESSED_VARIABLE';
    return result;
  }

  const checkThreshold = Math.max(1.5 * medianGap, p75);
  result.check_threshold_days = checkThreshold;

  const daysSince = result.days_since_last;
  let status = 'NORMAL';
  if (daysSince >= 2 * medianGap && daysSince > maxGap) {
    status = 'STRONGLY_OVERDUE'; // priority over OVERDUE/CHECK_SOON when overlapping
  } else if (daysSince > maxGap && daysSince >= checkThreshold) {
    status = 'OVERDUE';
  } else if (daysSince >= checkThreshold && daysSince <= maxGap) {
    status = 'CHECK_SOON';
  } else {
    status = 'NORMAL';
  }
  result._raw_status = status;

  // Cross-vendor blind spot: never let Hardie's-only data produce a strong
  // "it's missing" claim.
  if (cfg.cross_vendor_blind_spot && (status === 'OVERDUE' || status === 'STRONGLY_OVERDUE')) {
    status = 'CROSS_VENDOR_BLIND_SPOT';
  }

  // Data incomplete: an unprocessed document could already contain the
  // purchase we'd otherwise be flagging as overdue/check.
  if (
    pendingSince && result.last_purchase_date && pendingSince >= result.last_purchase_date &&
    (status === 'CHECK_SOON' || status === 'OVERDUE' || status === 'STRONGLY_OVERDUE')
  ) {
    status = 'DATA_INCOMPLETE';
  }

  result.status = status;
  return result;
}

// ── QUANTITY SIGNAL (STEP 8) — no prediction, just an honest pack signal ───
// lines: array of { pack_description, qty } already filtered to this
// functional ingredient (not deduped by day — every line counts).
export function computeQuantitySignal(lines) {
  if (!lines.length) return { quantity_status: 'INSUFFICIENT_DATA', dominant_pack: null, dominant_pct: null, median_qty: null };

  const counts = {};
  for (const l of lines) {
    const key = l.pack_description || '(unknown)';
    counts[key] = (counts[key] || 0) + 1;
  }
  const [dominantPack, dominantCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const pct = dominantCount / lines.length;

  if (lines.length < 3) return { quantity_status: 'INSUFFICIENT_DATA', dominant_pack: dominantPack, dominant_pct: pct, median_qty: null };
  if (pct < 0.8) return { quantity_status: 'MIXED_PACKS', dominant_pack: dominantPack, dominant_pct: pct, median_qty: null };

  const qtysOnDominantPack = lines.filter(l => (l.pack_description || '(unknown)') === dominantPack).map(l => Number(l.qty));
  return { quantity_status: 'RELIABLE', dominant_pack: dominantPack, dominant_pct: pct, median_qty: median(qtysOnDominantPack) };
}

// ── HUMAN-READABLE EXPLANATION (STEP 10) — deterministic, no free text ─────
export function explainRhythm(r) {
  const name = r.ingredient_name || '(ingredient)';
  if (r.status === 'INSUFFICIENT_HISTORY') {
    return `${name}: not enough purchase history yet (${r.event_count} event${r.event_count === 1 ? '' : 's'}).`;
  }
  if (r.status === 'SUPPRESSED_VARIABLE') {
    return `${name}: purchase timing is too irregular to predict reliably. No check suggested.`;
  }
  if (r.status === 'CROSS_VENDOR_BLIND_SPOT') {
    return `${name}: rhythm looks overdue on this vendor alone, but recent purchases may exist outside Chef's Warehouse. Not a reliable signal.`;
  }
  if (r.status === 'DATA_INCOMPLETE') {
    return `${name}: recent invoices are still being processed — this check is provisional, not final.`;
  }
  const rhythm = `about every ${Math.round(r.median_gap_days)} day${Math.round(r.median_gap_days) === 1 ? '' : 's'}`;
  const since = `${r.days_since_last} day${r.days_since_last === 1 ? '' : 's'} since last purchase`;
  if (r.status === 'NORMAL') return `${name}: last purchase ${r.last_purchase_date}. Typical rhythm ${rhythm}. ${since}. Within normal range.`;
  return `${name}: last purchase ${r.last_purchase_date}. Typical rhythm ${rhythm}. ${since}. Check stock before closing the order.`;
}

// ── SNAPSHOT / RANKING (STEP 9) ─────────────────────────────────────────────
// entries: array of { ingredient_id, rhythm: <computeIngredientRhythm result> }
const SEVERITY_RANK = { STRONGLY_OVERDUE: 3, OVERDUE: 2, CHECK_SOON: 1 };
export function rankCandidates(entries, maxResults = 10) {
  const candidates = entries.filter(e => SEVERITY_RANK[e.rhythm.status] !== undefined);
  candidates.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.rhythm.status] - SEVERITY_RANK[a.rhythm.status];
    if (sevDiff !== 0) return sevDiff;
    const ratioA = a.rhythm.days_since_last / a.rhythm.median_gap_days;
    const ratioB = b.rhythm.days_since_last / b.rhythm.median_gap_days;
    return ratioB - ratioA;
  });
  return candidates.slice(0, maxResults);
}

// ── BROWSER BRIDGE ───────────────────────────────────────────────────────
// This file is loaded as a native ES module (script type="module") so the
// `export` syntax above works, but every other file in this app (including
// purchase-order.js, its only consumer so far) is a plain classic script.
// Plain scripts can't `import` a module, so the module exposes itself on
// `window` here — same functions, no reimplementation, no formula change.
if (typeof window !== 'undefined') {
  window.PurchaseRhythm = {
    FUNCTIONAL_INGREDIENT_EQUIVALENCE,
    resolveEquivalenceConfig,
    isEventEligible,
    computeIngredientRhythm,
    computeQuantitySignal,
    explainRhythm,
    rankCandidates,
  };
}
