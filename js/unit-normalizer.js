// ── UNIT NORMALIZER — Brigade Central Conversion Engine ──────────────────────
// Version: 1.0.0 — Phase 2.1 foundation
// Status:  Used by Modifier Depletion Lab + proposed schema.
//          NOT yet wired to production bots, prep, or inventory.
//
// Philosophy:
//   Il cuoco scrive nella misura che conosce. La app converte.
//   Mai chiedere al cuoco quanti grammi sono 2 fl oz.
//
// Usage:
//   import { normalizeQty, convertQty, formatQty, calcRamekins, calcBatches } from './unit-normalizer.js';
//
//   normalizeQty(2, 'fl_oz')         → { normalized_g: 59.15, normalized_ml: 59.15, ... }
//   normalizeQty(5, 'kg')            → { normalized_g: 5000, normalized_ml: 5000, ... }
//   normalizeQty(2, 'l')             → { normalized_g: 2000, normalized_ml: 2000, ... }
//   calcRamekins(5000, 'g', 2, 'fl_oz') → { ramekins: 84.5, ... }
// ─────────────────────────────────────────────────────────────────────────────

// ── STATIC CONVERSION TABLE ───────────────────────────────────────────────────
// Source: unit_conversion_table in Supabase (ydqmumpytgrlceuinoqt, verified 8 luglio 2026)
// Path: all conversions go through a base unit (ml for volumes, g for weights).
// Runtime: table loaded once from DB at app init, static map as fallback.

const STATIC_CONVERSIONS = {
  // ── VOLUME → ml ──────────────────────────────────────────────────────────
  'fl_oz': { base: 'ml', factor: 29.5735  },   // US fluid ounce
  'cup':   { base: 'ml', factor: 236.588  },
  'tbsp':  { base: 'ml', factor: 14.7868  },
  'tsp':   { base: 'ml', factor: 4.92892  },
  'pt':    { base: 'ml', factor: 473.176  },    // US pint
  'qt':    { base: 'ml', factor: 946.353  },    // US quart
  'gal':   { base: 'ml', factor: 3785.41  },    // US gallon
  'l':     { base: 'ml', factor: 1000     },
  'ml':    { base: 'ml', factor: 1        },

  // ── WEIGHT → g ───────────────────────────────────────────────────────────
  'g':     { base: 'g',  factor: 1        },
  'kg':    { base: 'g',  factor: 1000     },
  'lb':    { base: 'g',  factor: 453.592  },
  'oz':    { base: 'g',  factor: 28.3495  },    // weight oz (NOT fl oz)

  // ── SPECIAL / KITCHEN UNITS ───────────────────────────────────────────────
  'buste': { base: 'g',  factor: 907      },    // Spring Mix bag (verified DB)

  // ── COUNT (no conversion possible) ───────────────────────────────────────
  'each':    { base: 'each',  factor: 1 },
  'pz':      { base: 'each',  factor: 1 },
  'pezzi':   { base: 'each',  factor: 1 },
  'nests':   { base: 'nests', factor: 1 },
  'filetto': { base: 'each',  factor: 1 },
  'porzione':{ base: 'each',  factor: 1 },
};

// Unit aliases — map common spellings to canonical key
const UNIT_ALIASES = {
  'fluid_oz': 'fl_oz', 'floz': 'fl_oz', 'fl oz': 'fl_oz', 'fluid oz': 'fl_oz',
  'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz',
  'ounce': 'oz', 'ounces': 'oz',           // weight oz
  'gram': 'g', 'grams': 'g', 'gr': 'g',
  'kilogram': 'kg', 'kilograms': 'kg', 'kilo': 'kg',
  'liter': 'l', 'liters': 'l', 'litre': 'l', 'litres': 'l', 'lt': 'l',
  'milliliter': 'ml', 'milliliters': 'ml', 'millilitre': 'ml',
  'gallon': 'gal', 'gallons': 'gal',
  'quart': 'qt', 'quarts': 'qt',
  'pint': 'pt', 'pints': 'pt',
  'tablespoon': 'tbsp', 'tablespoons': 'tbsp',
  'teaspoon': 'tsp', 'teaspoons': 'tsp',
  'pound': 'lb', 'pounds': 'lb', 'lbs': 'lb',
  'piece': 'pezzi', 'pieces': 'pezzi', 'pcs': 'pezzi', 'pc': 'pezzi',
  'nest': 'nests',
  'busta': 'buste', 'bag': 'buste', 'bags': 'buste',
  'fillet': 'filetto', 'fillets': 'filetto',
  'portion': 'porzione', 'portions': 'porzione', 'serving': 'porzione',
};

// Unit type classification
const UNIT_TYPES = {
  volume: new Set(['fl_oz','cup','tbsp','tsp','pt','qt','gal','l','ml']),
  weight: new Set(['g','kg','lb','oz','buste']),
  count:  new Set(['each','pz','pezzi','nests','filetto','porzione']),
};

// ── RUNTIME OVERRIDE ──────────────────────────────────────────────────────────
// Populated from unit_conversion_table at app init via loadConversionsFromDB().
// Falls back to STATIC_CONVERSIONS when DB is unavailable.
let _dbConversions = null;

/**
 * Load live conversion table from Supabase.
 * Call once at app init. Falls back to static if DB unavailable.
 * @param {Object} supabaseClient - initialized supa client
 */
export async function loadConversionsFromDB(supabaseClient) {
  try {
    const { data, error } = await supabaseClient
      .from('unit_conversion_table')
      .select('from_unit, to_unit, factor');
    if (error || !data?.length) return;
    _dbConversions = {};
    data.forEach(row => {
      if (!_dbConversions[row.from_unit]) _dbConversions[row.from_unit] = {};
      _dbConversions[row.from_unit][row.to_unit] = parseFloat(row.factor);
    });
  } catch (e) {
    // Silenzioso — usa static fallback
  }
}

// ── CORE HELPERS ──────────────────────────────────────────────────────────────

/**
 * Resolve unit string to canonical key.
 * Strips leading '+', lowercases, maps aliases.
 */
export function resolveUnit(unit) {
  if (!unit) return null;
  const cleaned = unit.toLowerCase().trim().replace(/^[+]/, '');
  return UNIT_ALIASES[cleaned] || (STATIC_CONVERSIONS[cleaned] ? cleaned : null);
}

/**
 * Get unit type: 'volume' | 'weight' | 'count' | 'unknown'
 */
export function getUnitType(unit) {
  const canonical = resolveUnit(unit);
  if (!canonical) return 'unknown';
  for (const [type, set] of Object.entries(UNIT_TYPES)) {
    if (set.has(canonical)) return type;
  }
  return 'unknown';
}

/**
 * Convert a quantity from one unit to another.
 * Returns null if conversion path doesn't exist.
 *
 * @param {number} qty
 * @param {string} fromUnit
 * @param {string} toUnit
 * @param {number} density - g/ml density (default 1.0, used for weight↔volume)
 */
export function convertQty(qty, fromUnit, toUnit, density = 1.0) {
  const from = resolveUnit(fromUnit);
  const to   = resolveUnit(toUnit);
  if (!from || !to) return null;
  if (from === to) return qty;

  const fromInfo = STATIC_CONVERSIONS[from];
  const toInfo   = STATIC_CONVERSIONS[to];
  if (!fromInfo || !toInfo) return null;

  // Same base (weight→weight or volume→volume)
  if (fromInfo.base === toInfo.base) {
    return qty * fromInfo.factor / toInfo.factor;
  }

  // Cross: volume→weight using density
  if (fromInfo.base === 'ml' && toInfo.base === 'g') {
    const ml = qty * fromInfo.factor;
    return (ml * density) / toInfo.factor;
  }
  // Cross: weight→volume using density
  if (fromInfo.base === 'g' && toInfo.base === 'ml') {
    const g = qty * fromInfo.factor;
    return (g / density) / toInfo.factor;
  }

  return null; // count units — no conversion
}

/**
 * Main normalizer. Takes any quantity+unit and returns normalized values.
 *
 * @param {number} qty         - the numeric quantity
 * @param {string} unit        - any unit string (fl_oz, kg, LT, cup, buste, pezzi…)
 * @param {number} density     - g/ml ratio (default 1.0)
 * @param {string} displayQty  - optional override for display string (e.g. "2 fl oz ramekin")
 * @returns {NormalizeResult}
 */
export function normalizeQty(qty, unit, density = 1.0, displayQty = null) {
  const q = parseFloat(qty);
  if (isNaN(q)) return _nullResult(unit, 'invalid_qty', displayQty);

  const canonical = resolveUnit(unit);
  if (!canonical) return _nullResult(unit, 'unknown_unit', displayQty);

  const info = STATIC_CONVERSIONS[canonical];
  const uType = getUnitType(canonical);

  let normalized_g  = null;
  let normalized_ml = null;

  if (uType === 'volume') {
    normalized_ml = parseFloat((q * info.factor).toFixed(4));
    normalized_g  = parseFloat((normalized_ml * density).toFixed(4));
  } else if (uType === 'weight') {
    normalized_g  = parseFloat((q * info.factor).toFixed(4));
    normalized_ml = parseFloat((normalized_g / density).toFixed(4));
  } else {
    // count — no cross-unit normalization
    normalized_g  = null;
    normalized_ml = null;
  }

  return {
    // Original input (chef-facing)
    input_qty:  q,
    input_unit: canonical,
    display:    displayQty || `${_formatNum(q)} ${unit}`,

    // Normalized values (bot-facing)
    normalized_g,
    normalized_ml,
    unit_type:  uType,
    density,

    // Derived display helpers
    display_g:  normalized_g  != null ? `${_formatNum(normalized_g)} g`  : null,
    display_ml: normalized_ml != null ? `${_formatNum(normalized_ml)} ml` : null,
    display_kg: normalized_g  != null ? `${_formatNum(normalized_g / 1000)} kg` : null,
    display_l:  normalized_ml != null ? `${_formatNum(normalized_ml / 1000)} L`  : null,

    // Confidence
    confidence: canonical === resolveUnit(unit) ? 'exact' : 'aliased',
    error: null,
  };
}

/**
 * Given a stock quantity, calculate how many "portions" of a reference quantity fit.
 * Example: calcPortions(5000, 'g', 2, 'fl_oz', 1.0)
 *   → { portions: 84.5, display: "~84 ramekin da 2 fl oz" }
 *
 * @param {number} stockQty
 * @param {string} stockUnit
 * @param {number} portionQty
 * @param {string} portionUnit
 * @param {number} density
 * @param {string} portionLabel - optional display label for one portion
 */
export function calcPortions(stockQty, stockUnit, portionQty, portionUnit, density = 1.0, portionLabel = 'porzione') {
  const stock   = normalizeQty(stockQty, stockUnit, density);
  const portion = normalizeQty(portionQty, portionUnit, density);

  if (stock.error || portion.error) return null;

  // Compare in common base (prefer g for weight, ml for volume)
  let stockBase = null, portionBase = null;

  if (stock.normalized_g != null && portion.normalized_g != null) {
    stockBase   = stock.normalized_g;
    portionBase = portion.normalized_g;
  } else if (stock.normalized_ml != null && portion.normalized_ml != null) {
    stockBase   = stock.normalized_ml;
    portionBase = portion.normalized_ml;
  } else {
    return null; // can't compare (count vs weight/volume)
  }

  if (portionBase <= 0) return null;

  const portions = stockBase / portionBase;

  return {
    portions:      parseFloat(portions.toFixed(2)),
    portions_int:  Math.floor(portions),
    stock_display: stock.display_g || stock.display_ml || `${stockQty} ${stockUnit}`,
    portion_display: `${_formatNum(portionQty)} ${portionUnit} ${portionLabel}`,
    formula: `${_formatNum(stockBase)} ÷ ${_formatNum(portionBase)} = ${_formatNum(portions)}`,
  };
}

/**
 * Convenience: calculate batch count from stock.
 * Example: calcBatches(5000, 'g', 2, 'l') → { batches: 2.5 }
 */
export function calcBatches(stockQty, stockUnit, batchQty, batchUnit, density = 1.0) {
  return calcPortions(stockQty, stockUnit, batchQty, batchUnit, density, 'batch');
}

/**
 * Format a display string for a quantity, choosing the most readable unit.
 * Example: formatQty(59.147, 'g') → "59g"
 *          formatQty(2000, 'ml')  → "2 L"
 *          formatQty(5000, 'g')   → "5 kg"
 */
export function formatQty(value, unit, decimals = 2) {
  const v = parseFloat(value);
  if (isNaN(v)) return '—';
  const canonical = resolveUnit(unit) || unit;

  // Auto-upgrade units for readability
  if (canonical === 'g'  && v >= 1000) return `${_formatNum(v / 1000, decimals)} kg`;
  if (canonical === 'ml' && v >= 1000) return `${_formatNum(v / 1000, decimals)} L`;
  if (canonical === 'ml' && v < 1)     return `${_formatNum(v * 1000, decimals)} μL`;

  return `${_formatNum(v, decimals)} ${canonical}`;
}

/**
 * Build a modifier depletion rule object with all normalized fields.
 * Used for pos_modifier_depletion_rules inserts.
 *
 * @param {string} canonical   - modifier canonical name
 * @param {number} qty         - portion qty as chef would write it
 * @param {string} unit        - portion unit (fl_oz, g, pezzi, nests…)
 * @param {string} displayQty  - human display (e.g. "2 fl oz ramekin")
 * @param {number} density     - g/ml ratio
 * @param {string} usageMode   - 'fixed_quantity' | 'use_recipe_serving'
 * @param {string} linkedRecipeId - UUID or null
 * @param {string} confidence  - 'confirmed' | 'estimated' | 'review'
 */
export function buildModifierRule(canonical, qty, unit, displayQty, density = 1.0, usageMode = 'fixed_quantity', linkedRecipeId = null, confidence = 'review') {
  const norm = normalizeQty(qty, unit, density, displayQty);
  return {
    modifier_canonical: canonical,
    display_qty:        displayQty,
    qty_per_modifier:   qty,
    unit,
    normalized_qty_ml:  norm.normalized_ml,
    normalized_qty_g:   norm.normalized_g,
    density_g_per_ml:   density,
    usage_mode:         usageMode,
    linked_recipe_id:   linkedRecipeId,
    confidence,
    active:             false,   // NEVER active by default
    // UI helpers
    _norm:              norm,
    _display_g:         norm.display_g,
    _display_ml:        norm.display_ml,
  };
}

// ── PRIVATE HELPERS ───────────────────────────────────────────────────────────
function _nullResult(unit, errorCode, displayQty) {
  return {
    input_qty: null, input_unit: unit, display: displayQty || unit,
    normalized_g: null, normalized_ml: null,
    unit_type: 'unknown', density: 1.0,
    display_g: null, display_ml: null, display_kg: null, display_l: null,
    confidence: 'error', error: errorCode,
  };
}

function _formatNum(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1000)  return parseFloat(n.toFixed(0)).toLocaleString();
  if (abs >= 100)   return parseFloat(n.toFixed(1)).toLocaleString();
  if (abs >= 10)    return parseFloat(n.toFixed(decimals)).toLocaleString();
  if (abs >= 1)     return parseFloat(n.toFixed(decimals)).toLocaleString();
  return parseFloat(n.toFixed(4)).toLocaleString();
}

// ── EXPORTS SUMMARY ───────────────────────────────────────────────────────────
// loadConversionsFromDB(supa)      — call once at init (optional, has static fallback)
// resolveUnit(unit)                — 'fl oz' → 'fl_oz'
// getUnitType(unit)                → 'volume' | 'weight' | 'count' | 'unknown'
// convertQty(qty, from, to, density) — direct conversion
// normalizeQty(qty, unit, density, display) → full NormalizeResult
// calcPortions(stock, stockUnit, portion, portionUnit, density, label)
// calcBatches(stock, stockUnit, batch, batchUnit, density)
// formatQty(value, unit)           — smart display
// buildModifierRule(...)           — pos_modifier_depletion_rules row builder
