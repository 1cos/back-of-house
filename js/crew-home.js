// ══════════════════════════════════════════════════════════════════════════
// CREW HOME V1 — PILOT (CREW-UX 05)
//
// A second Home body, shown ONLY to the users in CREW_HOME_PILOT_IDS.
// Every other user keeps the existing Home, byte for byte: this file never
// runs past its first guard for them.
//
// ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
// This is NOT Dinner Readiness. It does not model service time, it has no
// thresholds, and it deliberately leaves prep_type='checklist' tasks out of
// Block 1. It therefore would NOT have caught the missing mashed-potato
// backup of Saturday 2026-09-13: that item is a checklist/refill check, not
// a production suggestion. Documented on purpose — see CREW-UX 04 §2.6.
//
// ── WHAT IT READS ─────────────────────────────────────────────────────────
// Nothing new. The same globals the legacy Home already has in memory:
//   items                    prep_tasks, loaded by init()
//   window._suggestions      prep_suggestions_daily, loaded by loadSuggestions()
//   window._suggestionsDate  the valid run date, or null
//   window._recentCounts     prep_stock_counts (<24h), loaded by loadRecentCounts()
//   _computeStockVerified()  the production predicate, defined in prep.js
//   humanQty()               the production formatter, defined in prep.js
//   goToStation()            the production navigation, defined in briefing.js
//
// ── WHAT IT WRITES ────────────────────────────────────────────────────────
// Nothing. No Supabase call, no Edge Function, no push, no schema change.
// Block 2 keeps its drafts in sessionStorage on this device only.
//
// ── PILOT GATE ────────────────────────────────────────────────────────────
// One allowlist, one predicate, one mount point. No bare id comparison is
// scattered anywhere else in the codebase. Emptying the allowlist below
// reverts the pilot completely; nothing else has to change.
// ══════════════════════════════════════════════════════════════════════════

// TEMPORARY — pilot allowlist. Same shape as the existing _PO_ALLOWED_IDS /
// _EXP_QUICK_ALLOWED_IDS precedents in purchase-order.js and expenses.js.
// Delete the id to turn the pilot off for everyone.
var CREW_HOME_PILOT_IDS = [38]; // Pablo (Salad Station) — CREW-UX 05 pilot

function crewHomeEnabled(u) {
  if (!u) return false;
  return CREW_HOME_PILOT_IDS.indexOf(u.id) >= 0;
}

// ── COPY ──────────────────────────────────────────────────────────────────
// Every new string the pilot introduces lives here and nowhere else, so
// translating the Crew Home later is a translation and not a refactor.
// English by decision (CREW-UX 05 / D2) — users.lang is not read here and
// is not modified by this pilot.
var CREW_COPY = {
  attention_title:      'What needs your attention',
  attention_all_good:   'Your station looks good',
  attention_nothing:    'Nothing urgent right now.',
  attention_no_run:     "Today's plan isn't ready yet.",
  attention_no_run_cta: 'Open Prep',
  attention_no_station: 'No station assigned. Ask the Chef.',
  attention_more:       '+ {n} more',
  attention_see_all:    'See all {n}',

  label_in_progress:    'IN PROGRESS',
  label_do_first:       'DO FIRST',
  label_prep_today:     'PREP TODAY',
  label_count_first:    'COUNT FIRST',
  label_check_first:    'CHECK FIRST',

  why_nothing_in_stock: 'Nothing in stock right now.',
  why_running_low:      'Running low for today.',
  why_check_cooler:     'Check the cooler before prepping.',
  why_count:            "The recorded amount may be wrong. Count what's in the cooler.",
  why_started_at:       'Started at {time}.',
  why_started_by:       'Started by {who} at {time}.',

  cta_open:             'Open',
  cta_count:            'Count',
  cta_finish:           'Finish',
  cta_review:           'Review',

  unknown_one:          '1 item needs a quick check',
  unknown_many:         '{n} items need a quick check',

  batch_one:            '1 batch',
  batch_many:           '{n} batches',

  made_title:           'What did you make?',
  made_placeholder:     'Tell me what you made...',
  made_send:            'Save',
  made_pilot_note:      "You'll confirm before anything is recorded.",
  made_noted:           'Noted on this phone',
  made_clear:           'Clear',

  // ── CREW-UX 10 — the production flow ──────────────────────────────────
  made_choose:          'Which one?',
  made_choose_none:     'None of these',
  made_no_match:        "I couldn't find that prep.",
  made_not_production:  "I couldn't read that as a production.",
  made_kept_locally:    'Kept on this phone.',
  made_how_much:        'How much?',
  made_cant_convert:    "I can't convert {unit} for this prep.",
  made_no_batch:        "This prep doesn't have a batch size.",
  made_record:          'Record',
  made_cancel:          'Cancel',
  made_recording:       'Recording…',
  made_recorded:        'Recorded · {name} {qty}',
  made_plan_updating:   'Recorded. The plan is still updating.',
  made_err_network:     "Couldn't reach the kitchen system.",
  made_err_auth:        'Session expired — sign in again.',
  made_err_conflict:    'Something changed. Start again.',
  made_err_generic:     "That didn't go through.",
  made_try_again:       'Try again',
  made_start_again:     'Start again',
  made_batch_one:       '1 batch',
  made_batch_many:      '{n} batches'
};

function _crewT(key, vars) {
  var s = CREW_COPY[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function (k) {
      s = s.replace('{' + k + '}', vars[k]);
    });
  }
  return s;
}

// ── DOM ids the pilot hides from the Home body for the pilot user only.
// The elements stay in the document and keep their own logic; they are just
// not part of this user's Home. Nothing global is deleted.
var CREW_HIDDEN_HOME_IDS = [
  'homeTodoWidget',       // Today's to-do (already feature-flagged off)
  'warningsBanner',       // empty container
  'invoiceSection',       // admin only
  'expQuickWidget',       // allowlist only
  'poEntryWidget',        // allowlist only
  'antoPurchasingWidget', // allowlist only
  'telaPurchasingWidget', // allowlist only
  'homeBriefingSection',  // Briefing AI
  'homeUpcomingWidget',   // Upcoming Demand
  'homeStationsWidget',   // Your Station + Other Stations
  'homeChecklistSection'  // admin only
];
// NOTE: homeHighlightsWidget (Yesterday) is NOT hidden. It is moved, unchanged,
// into the third slot of the Crew Home — same node, same query, same copy,
// same "View all". See _crewMountYesterday().

// ── Classification ────────────────────────────────────────────────────────
// Pure translation of the statuses the bot already writes. No new rule, no
// new threshold, no inference from stock alone.
//
// Returns one of:
//   'in_progress' | 'do_first' | 'prep_today' | 'count_first' | 'check_first'
//   'unknown'            → counted in the honest line, never rendered as a card
//   'hidden_ok'          → bot says it is covered
//   'hidden_verified'    → a valid physical count covers demand
//   'hidden_checklist'   → no suggestion BY DESIGN (bot skips checklist tasks)
function crewClassify(task) {
  if (!task) return 'unknown';
  if (task.in_progress === true) return 'in_progress';

  var sugg = (window._suggestions || {})[task.id];

  if (!sugg) {
    // The bot deliberately skips prep_type='checklist' (chef_ai_bible
    // 01_database_map.md). Absence of a row is by design, not ignorance,
    // so it must not inflate the "can't be checked" counter.
    if (task.prep_type === 'checklist') return 'hidden_checklist';
    return 'unknown';
  }

  // Production's own predicate: valid unexpired count AND stock covers demand.
  if (typeof _computeStockVerified === 'function' && _computeStockVerified(task)) {
    return 'hidden_verified';
  }

  var s = sugg.status;
  if (s === 'looks_ok' || s === 'defer_to_tomorrow') return 'hidden_ok';
  if (s === 'no_demand_path' || s === 'out_of_scope') return 'unknown';
  if (s === 'count_first') return 'count_first';

  if (s === 'do_first' || s === 'prep_today') {
    var po = sugg.planned_output != null ? parseFloat(sugg.planned_output) : NaN;
    // The bot says something is needed but cannot say how much. Never invent
    // a number — CREW-UX 05 / D5.
    if (!isFinite(po) || po <= 0) return 'check_first';
    return s;
  }

  // Unknown status string — do not pretend it is fine.
  return 'unknown';
}

var CREW_ORDER = {
  in_progress: 0,
  do_first:    1,
  prep_today:  2,
  count_first: 3,
  check_first: 4
};

function _crewIsCard(kind) {
  return Object.prototype.hasOwnProperty.call(CREW_ORDER, kind);
}

// ── Data assembly ─────────────────────────────────────────────────────────
function crewCollect(user) {
  var station = (user && typeof user.default_station === 'string')
    ? user.default_station.trim() : '';

  var out = { station: station, cards: [], unknown: [], hasRun: false, noStation: !station };
  if (!station) return out;

  // A run is valid when loadSuggestions() found one. Same source of truth the
  // Prep tab uses; no second opinion.
  out.hasRun = (window._suggestionsDate != null) && !window._suggestionsError;

  var list = (typeof items !== 'undefined' && items) ? items : [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || t.archived) continue;
    if (t.category !== station) continue;

    var kind = crewClassify(t);
    if (kind === 'unknown') { out.unknown.push(t); continue; }
    if (!_crewIsCard(kind)) continue;

    out.cards.push({ task: t, kind: kind, sugg: (window._suggestions || {})[t.id] || null });
  }

  out.cards.sort(function (a, b) {
    var d = CREW_ORDER[a.kind] - CREW_ORDER[b.kind];
    if (d !== 0) return d;
    return String(a.task.name).localeCompare(String(b.task.name));
  });

  return out;
}

// ── Formatting helpers ────────────────────────────────────────────────────
function _crewQtyLine(entry) {
  var sugg = entry.sugg;
  if (!sugg) return '';
  var po = sugg.planned_output != null ? parseFloat(sugg.planned_output) : NaN;
  if (!isFinite(po) || po <= 0) return '';

  var unit = sugg.output_unit || entry.task.unit || '';
  var qty = (typeof humanQty === 'function') ? humanQty(po, unit) : null;
  if (!qty) qty = po + (unit ? ' ' + unit : '');

  var mi = sugg.minimum_increment != null ? parseFloat(sugg.minimum_increment) : NaN;
  if (sugg.production_constraint_quality === 'valid_fixed_batch' && isFinite(mi) && mi > 0) {
    var n = po / mi;
    var nFmt = (n === Math.floor(n)) ? String(Math.floor(n)) : String(parseFloat(n.toFixed(2)));
    var batch = (parseFloat(nFmt) === 1)
      ? _crewT('batch_one')
      : _crewT('batch_many', { n: nFmt });
    return qty + '  ·  ' + batch;
  }
  return qty;
}

function _crewTimeCDT(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago'
    });
  } catch (e) { return ''; }
}

function _crewWhy(entry) {
  var t = entry.task;
  switch (entry.kind) {
    case 'in_progress': {
      var time = _crewTimeCDT(t.in_progress_at);
      if (!time) return '';
      var who = t.in_progress_by;
      var me = (window.user && window.user.name) || '';
      if (who && who !== me) return _crewT('why_started_by', { who: who, time: time });
      return _crewT('why_started_at', { time: time });
    }
    case 'count_first':
      return _crewT('why_count');
    case 'check_first':
      return _crewT('why_check_cooler');
    case 'do_first':
    case 'prep_today': {
      var stock = (t.current_stock === null || t.current_stock === undefined)
        ? null : parseFloat(t.current_stock);
      if (stock === 0) return _crewT('why_nothing_in_stock');
      return _crewT('why_running_low');
    }
    default:
      return '';
  }
}

function _crewLabel(kind) {
  return _crewT('label_' + kind);
}

var CREW_ACCENT = {
  in_progress: '#1d4ed8',
  do_first:    '#b3392b',
  prep_today:  '#9a6410',
  count_first: '#9a6410',
  check_first: '#64748b'
};

// ── Navigation — reuses the production Prep workflow, never duplicates it ──
window.crewOpenTask = function (id) {
  var t = (typeof tasks !== 'undefined' && tasks) ? tasks[id] : null;
  var station = t && t.category ? t.category : ((window.user && window.user.default_station) || 'All');
  if (typeof goToStation === 'function') goToStation(station);
  // Bring the card into view. The Prep grid is already rendered for this
  // station, so this is scrolling, not a second render.
  setTimeout(function () {
    var el = document.querySelector('[data-audit-id="' + id + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }, 80);
};

window.crewOpenCount = function (id) {
  if (typeof openStockCountSheet === 'function') { openStockCountSheet(id); return; }
  window.crewOpenTask(id);
};

window.crewOpenStation = function () {
  var station = (window.user && window.user.default_station) || 'All';
  if (typeof goToStation === 'function') goToStation(station);
};

// ══════════════════════════════════════════════════════════════════════════
// CREW-UX 10 — "What did you make?" becomes a real production
//
// Three pure functions, then a small state machine, then one write.
// No model, no provider, no prompt: a deterministic parser turns a sentence
// into four fields, the client turns those into a payload using rows it
// already holds, and the cook turns that into a write with one tap.
// None of the three can do the others' job.
// ══════════════════════════════════════════════════════════════════════════

// ── 1. PARSER ─────────────────────────────────────────────────────────────
// Requires a production verb at the start. That single rule is what keeps
// "we're out of ranch" and "we only have half a pan left" from ever being
// read as production — they are not rejected by a keyword blocklist, they
// simply never match (CREW-UX 10 §12).

var CREW_VERB_RE = /^(?:i\s+|we\s+)?(?:have\s+|'ve\s+|just\s+)*(?:made|make|did|done|prepped|prepared)\s+/i;

// Spoken unit → { token, kind }. 'native' means it can reach the write path
// as-is; 'batch' needs the prep's own batch size; 'unsupported' never writes.
var CREW_UNITS = {
  g:'g', gr:'g', gram:'g', grams:'g',
  kg:'kg', kilo:'kg', kilos:'kg', kilogram:'kg', kilograms:'kg',
  pz:'pz', pc:'pz', pcs:'pz', piece:'pz', pieces:'pz', each:'pz', pezzi:'pz',
  nest:'nests', nests:'nests',
  cup:'cup', cups:'cup',
  busta:'buste', buste:'buste',
  filetto:'filetto', filetti:'filetto',
  mazzo:'mazzi', mazzi:'mazzi',
  porzione:'porzioni', porzioni:'porzioni', portion:'porzioni', portions:'porzioni',
  batch:'batch', batches:'batch'
};
// Named so the rejection can say which unit it was. Never converted.
var CREW_UNSUPPORTED_UNITS = {
  oz:'oz', ounce:'oz', ounces:'oz',
  lb:'lb', lbs:'lb', pound:'lb', pounds:'lb',
  l:'liters', lt:'liters', liter:'liters', liters:'liters', litre:'liters', litres:'liters',
  quart:'quarts', quarts:'quarts',
  pan:'pans', pans:'pans',
  container:'containers', containers:'containers',
  tray:'trays', trays:'trays'
};

function _crewNorm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @returns {{intent:'production', raw_item:string, quantity:number|null,
 *            unit:string|null, unit_kind:'native'|'batch'|'unsupported'|null,
 *            spoken_unit:string|null} | {intent:'unknown'}}
 */
function crewParseMade(text) {
  var s = _crewNorm(text);
  if (!s) return { intent: 'unknown' };
  if (!CREW_VERB_RE.test(s)) return { intent: 'unknown' };

  s = s.replace(CREW_VERB_RE, '').trim();
  if (!s) return { intent: 'unknown' };

  var quantity = null, unit = null, unitKind = null, spokenUnit = null;

  // "<number> [unit] [of] <item>"
  var m = s.match(/^(\d+(?:[.,]\d+)?)\s*([a-z]+)?\s*(?:of\s+)?(.*)$/i);
  if (m) {
    var n = parseFloat(String(m[1]).replace(',', '.'));
    var word = m[2] ? m[2].toLowerCase() : null;
    var rest = (m[3] || '').trim();

    if (word && Object.prototype.hasOwnProperty.call(CREW_UNITS, word)) {
      quantity = n; spokenUnit = word;
      unit = CREW_UNITS[word];
      unitKind = (unit === 'batch') ? 'batch' : 'native';
      s = rest;
    } else if (word && Object.prototype.hasOwnProperty.call(CREW_UNSUPPORTED_UNITS, word)) {
      quantity = n; spokenUnit = word;
      unit = CREW_UNSUPPORTED_UNITS[word];
      unitKind = 'unsupported';
      s = rest;
    } else if (word) {
      // The word after the number is part of the item, not a unit.
      // A number with no unit is not interpretable — ask for the quantity.
      quantity = null; s = (word + ' ' + rest).trim();
    } else {
      quantity = null; s = rest;
    }
  }

  s = s.replace(/^of\s+/, '').trim();
  if (!s) return { intent: 'unknown' };

  return {
    intent: 'production',
    raw_item: s,
    quantity: quantity,
    unit: unit,
    unit_kind: unitKind,
    spoken_unit: spokenUnit
  };
}
window.crewParseMade = crewParseMade;

// ── 2. PREP MATCHING ──────────────────────────────────────────────────────
// Only rows already in memory. checklist tasks are never production targets.
// The user's own station is searched first; a match elsewhere is legitimate
// but carries its station into the confirmation.

function crewMatchPrep(rawItem, user) {
  var q = _crewNorm(rawItem);
  if (!q) return [];

  var station = (user && typeof user.default_station === 'string')
    ? user.default_station.trim() : '';

  var pool = ((typeof items !== 'undefined' && items) ? items : []).filter(function (t) {
    return t && !t.archived && t.prep_type !== 'checklist' && t.name;
  });

  function pick(list) {
    var exact = list.filter(function (t) { return _crewNorm(t.name) === q; });
    if (exact.length) return exact;
    return list.filter(function (t) { return _crewNorm(t.name).indexOf(q) !== -1; });
  }

  if (station) {
    var mine = pick(pool.filter(function (t) { return t.category === station; }));
    if (mine.length) return mine;
  }
  return pick(pool);
}
window.crewMatchPrep = crewMatchPrep;

// ── 3. QUANTITY / UNIT RESOLUTION ─────────────────────────────────────────
// Never estimates. Three accepted shapes and nothing else.

function crewResolveQuantity(task, sugg, quantity, unit, unitKind) {
  var native = _crewNorm(task && task.unit);
  if (['pz','pezzi','each','pieces','pcs','piece','checklist'].indexOf(native) !== -1) native = 'pz';
  if (!native) return { ok: false, reason: 'no_native_unit' };

  if (quantity == null || !isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: 'need_quantity', native_unit: native };
  }

  if (unitKind === 'unsupported') {
    return { ok: false, reason: 'unit_unsupported', unit: unit, native_unit: native };
  }

  // C. batch — only with a bot-declared fixed batch size
  if (unitKind === 'batch') {
    var pcq = sugg && sugg.production_constraint_quality;
    var mi  = sugg && sugg.minimum_increment != null ? parseFloat(sugg.minimum_increment) : NaN;
    if (pcq !== 'valid_fixed_batch' || !isFinite(mi) || mi <= 0) {
      return { ok: false, reason: 'batch_unavailable', native_unit: native };
    }
    var outUnit = _crewNorm(sugg.output_unit) || native;
    return {
      ok: true,
      quantity: quantity * mi,
      unit: outUnit,
      native_quantity: quantity * mi,
      batches: quantity,
      basis: 'minimum_increment=' + mi
    };
  }

  // A. the task's own unit
  if (unit === native) {
    return { ok: true, quantity: quantity, unit: unit, native_quantity: quantity, batches: null, basis: 'native' };
  }
  // B. kg ↔ g — the only conversion the write path knows
  if (unit === 'kg' && native === 'g') {
    return { ok: true, quantity: quantity, unit: 'kg', native_quantity: quantity * 1000, batches: null, basis: 'kg_to_g' };
  }
  if (unit === 'g' && native === 'kg') {
    return { ok: true, quantity: quantity, unit: 'g', native_quantity: quantity / 1000, batches: null, basis: 'g_to_kg' };
  }

  return { ok: false, reason: 'unit_unsupported', unit: unit, native_unit: native };
}
window.crewResolveQuantity = crewResolveQuantity;

// ── 4. FLOW STATE ─────────────────────────────────────────────────────────
// One draft at a time. The client_operation_id is created exactly once, when
// the confirmation appears, and survives every retry of that same operation.

var _crewMade = null;

function _crewUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _crewFmt(qty, unit) {
  if (typeof humanQty === 'function') {
    var h = humanQty(qty, unit);
    if (h) return h;
  }
  return qty + (unit ? ' ' + unit : '');
}

window.crewMadeCancel = function () {
  _crewMade = null;
  _crewRenderMadeFlow();
};

window.crewSubmitMade = function () {
  var input = document.getElementById('crewMadeInput');
  if (!input) return;
  var text = (input.value || '').trim();
  if (!text) return;

  var parsed = crewParseMade(text);
  if (parsed.intent !== 'production') {
    // Not a production. Nothing is written and nothing is thrown away:
    // the words stay on the phone, exactly as before CREW-UX 10.
    var drafts = _crewLoadDrafts();
    drafts.push({ text: text, at: new Date().toISOString() });
    _crewSaveDrafts(drafts);
    input.value = '';
    _crewMade = { stage: 'error', error: 'not_production', retryable: false, text: text };
    _crewRenderMadeFlow();
    _crewRenderDrafts();
    return;
  }

  _crewMade = { stage: 'init', text: text, parsed: parsed };
  var cands = crewMatchPrep(parsed.raw_item, window.user);

  if (cands.length === 0) {
    _crewMade.stage = 'error';
    _crewMade.error = 'no_match';
    _crewMade.retryable = false;
  } else if (cands.length > 1) {
    _crewMade.stage = 'choose';
    _crewMade.candidates = cands.slice(0, 4);
  } else {
    _crewPickTask(cands[0].id);
  }
  _crewRenderMadeFlow();
};

window.crewMadePick = function (id) {
  _crewPickTask(id);
  _crewRenderMadeFlow();
};

function _crewPickTask(id) {
  if (!_crewMade) return;
  var task = (typeof tasks !== 'undefined' && tasks) ? tasks[id] : null;
  if (!task) { _crewMade.stage = 'error'; _crewMade.error = 'no_match'; _crewMade.retryable = false; return; }

  var sugg = (window._suggestions || {})[id] || null;
  var p = _crewMade.parsed;
  var res = crewResolveQuantity(task, sugg, p.quantity, p.unit, p.unit_kind);

  _crewMade.task = task;
  _crewMade.sugg = sugg;

  if (!res.ok) {
    _crewMade.stage = 'need_qty';
    _crewMade.reason = res.reason;
    _crewMade.rejected_unit = res.unit || null;
    _crewMade.native_unit = res.native_unit || _crewNorm(task.unit);
    return;
  }
  _crewEnterConfirm(res);
}

// The one place a client_operation_id is born.
function _crewEnterConfirm(res) {
  _crewMade.resolved = res;
  _crewMade.stage = 'confirm';
  _crewMade.opId = _crewUuid();
  _crewMade.inFlight = false;
  _crewMade.error = null;
}

window.crewMadeQtySubmit = function () {
  if (!_crewMade || !_crewMade.task) return;
  var el = document.getElementById('crewMadeQty');
  if (!el) return;
  var n = parseFloat(String(el.value || '').replace(',', '.'));
  if (!isFinite(n) || n <= 0) return;

  var native = _crewMade.native_unit || _crewNorm(_crewMade.task.unit);
  var res = crewResolveQuantity(_crewMade.task, _crewMade.sugg, n, native, 'native');
  if (!res.ok) { _crewMade.reason = res.reason; _crewRenderMadeFlow(); return; }
  _crewEnterConfirm(res);
  _crewRenderMadeFlow();
};

// ── 5. WRITE ──────────────────────────────────────────────────────────────
// record-prep-production-v2 only. No v1, no Tell Chef, no stock count, no
// direct Supabase write, no client-side prep_log insert.

var CREW_PRODUCTION_EF = '/functions/v1/record-prep-production-v2';
var CREW_REFRESH_EF    = '/functions/v1/refresh-prep-suggestion';

function _crewBaseUrl() {
  return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : window.SUPABASE_URL);
}

window.crewMadeRecord = async function () {
  if (!_crewMade || _crewMade.stage === 'recording') return;
  if (_crewMade.inFlight) return;              // double tap: one request, ever
  if (!_crewMade.task || !_crewMade.resolved || !_crewMade.opId) return;

  var m = _crewMade;
  m.inFlight = true;
  m.stage = 'recording';
  m.error = null;
  _crewRenderMadeFlow();

  var sugg = m.sugg;
  var planned = sugg && sugg.planned_output != null ? parseFloat(sugg.planned_output) : NaN;
  var isSuggested = isFinite(planned) && planned > 0 &&
                    Math.abs(m.resolved.native_quantity - planned) < 1e-9;

  var payload = {
    brigade_token:       localStorage.getItem('brigade_token'),
    task_id:             m.task.id,
    quantity:            m.resolved.quantity,
    unit:                m.resolved.unit,
    client_operation_id: m.opId,
    occurred_at:         new Date().toISOString(),
    in_progress_at:      null,
    is_suggested_qty:    isSuggested
  };

  var raw, data;
  try {
    raw = await fetch(_crewBaseUrl() + CREW_PRODUCTION_EF, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    data = await raw.json();
  } catch (e) {
    m.inFlight = false;
    m.stage = 'error';
    m.error = 'network';
    m.retryable = true;                        // same opId on Try again
    _crewRenderMadeFlow();
    return;
  }

  m.inFlight = false;

  if (!raw.ok || !data || data.ok !== true) {
    var reason = (data && (data.reason || data.error)) || ('http_' + raw.status);
    m.stage = 'error';
    if (raw.status === 401 || reason === 'AUTH_ERROR') { m.error = 'auth';     m.retryable = false; }
    else if (reason === 'IDEMPOTENCY_KEY_CONFLICT')    { m.error = 'conflict'; m.retryable = false; }
    else if (raw.status >= 500)                        { m.error = 'network';  m.retryable = true;  }
    else { m.error = 'validation'; m.detail = (data && data.detail) || reason; m.retryable = false; }
    _crewRenderMadeFlow();
    return;
  }

  // ok:true — the production exists. idempotent:true counts as success.
  _crewApplyProduction(m.task.id, data);

  var label = _crewFmt(m.resolved.native_quantity, _crewNorm(m.task.unit));
  m.stage = 'done';
  m.doneMsg = _crewT('made_recorded', { name: m.task.name, qty: label });
  m.planUpdating = (data.suggestion_recalculated !== true);

  var input = document.getElementById('crewMadeInput');
  if (input) input.value = '';

  renderCrewHome();

  // Production is already saved. This only chases the plan — it must never
  // retry the production.
  if (data.suggestion_recalculated !== true) {
    _crewRefreshSuggestion(m.task.id);
  }
};

// ── 6. HOME REFRESH ───────────────────────────────────────────────────────
// `items` and `tasks` hold the same objects (init.js), so mutating the task
// is what the Crew Home reads on the next render. No page reload, no refetch.

function _crewApplySuggestion(taskId, s) {
  if (!s) return;
  window._suggestions = window._suggestions || {};
  var prev = window._suggestions[taskId] || {};
  var next = Object.assign({}, prev, s);
  // The EF's suggestion payload does not carry minimum_increment; the Crew
  // Home needs it to say "N batches". Keep what we already had.
  if (s.minimum_increment === undefined || s.minimum_increment === null) {
    next.minimum_increment = prev.minimum_increment;
  }
  window._suggestions[taskId] = next;
}

function _crewApplyProduction(taskId, data) {
  var t = (typeof tasks !== 'undefined' && tasks) ? tasks[taskId] : null;
  if (t && data.task) {
    if (data.task.current_stock !== undefined) t.current_stock = data.task.current_stock;
    t.in_progress    = data.task.in_progress === true;
    t.in_progress_at = data.task.in_progress_at || null;
    t.in_progress_by = data.task.in_progress_by || null;
    if (data.task.need_tomorrow !== undefined) t.need_tomorrow = data.task.need_tomorrow;
  }
  if (data.suggestion_recalculated === true && data.suggestion) {
    _crewApplySuggestion(taskId, data.suggestion);
  }
}

async function _crewRefreshSuggestion(taskId) {
  var raw, data;
  try {
    raw = await fetch(_crewBaseUrl() + CREW_REFRESH_EF, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brigade_token: localStorage.getItem('brigade_token'),
        task_id: taskId
      })
    });
    data = await raw.json();
  } catch (e) { return; }              // the stale plan line already shows

  if (raw.ok && data && data.ok === true && data.suggestion) {
    _crewApplySuggestion(taskId, data.suggestion);
    if (_crewMade && _crewMade.stage === 'done') _crewMade.planUpdating = false;
    renderCrewHome();
  }
}
window._crewRefreshSuggestion = _crewRefreshSuggestion;

// ── 7. FLOW UI — compact, inside Block 2 only ─────────────────────────────

function _crewRenderMadeFlow() {
  var host = document.getElementById('crewMadeFlow');
  if (!host) return;
  var m = _crewMade;
  if (!m) { host.innerHTML = ''; return; }

  var h = '';

  if (m.stage === 'choose') {
    h += '<p class="crew-made__ask">' + _crewEsc(_crewT('made_choose')) + '</p>' +
         '<div class="crew-made__options">' +
         m.candidates.map(function (t) {
           var station = (t.category && window.user && t.category !== window.user.default_station)
             ? ' · ' + t.category : '';
           return '<button type="button" class="crew-made__opt" onclick="crewMadePick(' +
             JSON.stringify(t.id) + ')">' + _crewEsc(t.name + station) + '</button>';
         }).join('') +
         '<button type="button" class="crew-made__opt crew-made__opt--none" onclick="crewMadeCancel()">' +
           _crewEsc(_crewT('made_choose_none')) + '</button>' +
         '</div>';

  } else if (m.stage === 'need_qty') {
    var ask = _crewT('made_how_much');
    if (m.reason === 'unit_unsupported') {
      ask = _crewT('made_cant_convert', { unit: m.rejected_unit }) + ' ' + ask;
    } else if (m.reason === 'batch_unavailable') {
      ask = _crewT('made_no_batch') + ' ' + ask;
    }
    h += '<p class="crew-made__ask"><b>' + _crewEsc(m.task.name) + '</b> — ' + _crewEsc(ask) + '</p>' +
         '<div class="crew-made__row">' +
           '<input id="crewMadeQty" class="crew-made__input crew-made__input--qty" type="number" ' +
             'inputmode="decimal" step="any" min="0" placeholder="0" ' +
             'onkeydown="if(event.key===\'Enter\'){event.preventDefault();crewMadeQtySubmit();}">' +
           '<span class="crew-made__unit">' + _crewEsc(m.native_unit) + '</span>' +
           '<button type="button" class="crew-made__btn" onclick="crewMadeQtySubmit()">OK</button>' +
         '</div>';

  } else if (m.stage === 'confirm' || m.stage === 'recording') {
    var r = m.resolved;
    var qtyLine = _crewFmt(r.native_quantity, _crewNorm(m.task.unit));
    if (r.batches) {
      var b = r.batches === 1 ? _crewT('made_batch_one') : _crewT('made_batch_many', { n: r.batches });
      qtyLine = b + ' · ' + qtyLine;
    }
    var offStation = (m.task.category && window.user && m.task.category !== window.user.default_station)
      ? '<p class="crew-made__station">' + _crewEsc(m.task.category) + '</p>' : '';
    var busy = (m.stage === 'recording');
    h += '<div class="crew-made__confirm">' +
           '<p class="crew-made__name">' + _crewEsc(m.task.name) + '</p>' + offStation +
           '<p class="crew-made__qty">' + _crewEsc(qtyLine) + '</p>' +
           '<div class="crew-made__actions">' +
             '<button type="button" class="crew-made__btn crew-made__btn--go"' +
               (busy ? ' disabled' : '') + ' onclick="crewMadeRecord()">' +
               _crewEsc(busy ? _crewT('made_recording') : _crewT('made_record')) +
             '</button>' +
             (busy ? '' : '<button type="button" class="crew-made__btn crew-made__btn--ghost" ' +
               'onclick="crewMadeCancel()">' + _crewEsc(_crewT('made_cancel')) + '</button>') +
           '</div>' +
         '</div>';

  } else if (m.stage === 'done') {
    h += '<p class="crew-made__ok">' + _crewEsc(m.doneMsg) + '</p>';
    if (m.planUpdating) {
      h += '<p class="crew-made__ask">' + _crewEsc(_crewT('made_plan_updating')) + '</p>';
    }

  } else if (m.stage === 'error') {
    var msg, btn = null, call = null;
    switch (m.error) {
      case 'not_production': msg = _crewT('made_not_production') + ' ' + _crewT('made_kept_locally'); break;
      case 'no_match':       msg = _crewT('made_no_match'); break;
      case 'network':        msg = _crewT('made_err_network');
                             btn = _crewT('made_try_again'); call = 'crewMadeRecord()'; break;
      case 'auth':           msg = _crewT('made_err_auth'); break;
      case 'conflict':       msg = _crewT('made_err_conflict');
                             btn = _crewT('made_start_again'); call = 'crewMadeCancel()'; break;
      default:               msg = _crewT('made_err_generic') + (m.detail ? ' (' + m.detail + ')' : '');
                             btn = _crewT('made_start_again'); call = 'crewMadeCancel()';
    }
    h += '<p class="crew-made__err">' + _crewEsc(msg) + '</p>';
    if (btn) {
      h += '<button type="button" class="crew-made__btn crew-made__btn--ghost" onclick="' + call + '">' +
             _crewEsc(btn) + '</button>';
    }
  }

  host.innerHTML = h;
}
window._crewRenderMadeFlow = _crewRenderMadeFlow;

// ── Block 2 drafts — this device only, never sent anywhere ────────────────
// In-memory is the source of truth so a cook's words survive every re-render
// even where sessionStorage is unavailable (private window, blocked storage).
// sessionStorage is a best-effort mirror so an accidental reload does not
// lose them either. Neither ever leaves the device.
var CREW_DRAFT_KEY = 'crew_made_drafts_v1';
var _crewDrafts = null;

function _crewLoadDrafts() {
  if (_crewDrafts) return _crewDrafts;
  _crewDrafts = [];
  try {
    var raw = sessionStorage.getItem(CREW_DRAFT_KEY);
    var arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) _crewDrafts = arr;
  } catch (e) { /* storage unavailable — memory still holds the drafts */ }
  return _crewDrafts;
}

function _crewSaveDrafts(arr) {
  _crewDrafts = Array.isArray(arr) ? arr : [];
  try { sessionStorage.setItem(CREW_DRAFT_KEY, JSON.stringify(_crewDrafts)); } catch (e) {}
}

// CREW-UX 10: the Save button now goes through crewSubmitMade(), which
// parses the sentence first. Only a sentence that is NOT a production still
// lands here, as a local note.

window.crewClearMade = function () {
  _crewSaveDrafts([]);
  _crewRenderDrafts();
};

function _crewEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _crewRenderDrafts() {
  var el = document.getElementById('crewMadeDrafts');
  if (!el) return;
  var drafts = _crewLoadDrafts();
  if (!drafts.length) { el.innerHTML = ''; return; }

  var rows = drafts.map(function (d) {
    return '<div class="crew-draft-row">' +
      '<span class="crew-draft-text">' + _crewEsc(d.text) + '</span>' +
      '<span class="crew-draft-time">' + _crewEsc(_crewTimeCDT(d.at)) + '</span>' +
      '</div>';
  }).join('');

  el.innerHTML =
    '<div class="crew-draft-head">' + _crewEsc(_crewT('made_noted')) + '</div>' +
    rows +
    '<button type="button" class="crew-draft-clear" onclick="crewClearMade()">' +
      _crewEsc(_crewT('made_clear')) +
    '</button>';
}

// ── Block 1 render ────────────────────────────────────────────────────────
var CREW_MAX_CARDS = 3;

function _crewRenderAttention(data) {
  var host = document.getElementById('crewAttention');
  if (!host) return;

  if (data.noStation) {
    host.innerHTML = '<p class="crew-calm">' + _crewEsc(_crewT('attention_no_station')) + '</p>';
    return;
  }

  // No valid bot run: say so, do not fabricate a list.
  if (!data.hasRun) {
    host.innerHTML =
      '<p class="crew-calm">' + _crewEsc(_crewT('attention_no_run')) + '</p>' +
      '<button type="button" class="crew-cta crew-cta--wide" onclick="crewOpenStation()">' +
        _crewEsc(_crewT('attention_no_run_cta')) +
      '</button>';
    return;
  }

  var html = '';
  var shown = data.cards.slice(0, CREW_MAX_CARDS);

  for (var i = 0; i < shown.length; i++) {
    var e = shown[i];
    var id = JSON.stringify(e.task.id);
    var qty = _crewQtyLine(e);
    var why = _crewWhy(e);
    var isCount = (e.kind === 'count_first');
    var isWip = (e.kind === 'in_progress');
    var ctaLabel = isCount ? _crewT('cta_count') : (isWip ? _crewT('cta_finish') : _crewT('cta_open'));
    var ctaCall = isCount ? ('crewOpenCount(' + id + ')') : ('crewOpenTask(' + id + ')');

    // CREW-UX 07: the text column and the action sit side by side, so the
    // CTA no longer owns a row of its own. Same elements, same classes,
    // same handlers — only the wrapper and the compact CTA modifier are new.
    html +=
      '<article class="crew-card" style="--crew-accent:' + CREW_ACCENT[e.kind] + '">' +
        '<div class="crew-card__main">' +
          '<div class="crew-card__label">' + _crewEsc(_crewLabel(e.kind)) + '</div>' +
          '<h3 class="crew-card__name">' + _crewEsc(e.task.name) + '</h3>' +
          (qty ? '<div class="crew-card__qty">' + _crewEsc(qty) + '</div>' : '') +
          (why ? '<p class="crew-card__why">' + _crewEsc(why) + '</p>' : '') +
        '</div>' +
        '<div class="crew-card__actions">' +
          '<button type="button" class="crew-cta crew-cta--compact" onclick="' + ctaCall + '">' +
            _crewEsc(ctaLabel) +
          '</button>' +
        '</div>' +
      '</article>';
  }

  var total = data.cards.length;
  if (total > shown.length) {
    html +=
      '<div class="crew-more">' +
        '<span>' + _crewEsc(_crewT('attention_more', { n: total - shown.length })) + '</span>' +
        '<button type="button" class="crew-link" onclick="crewOpenStation()">' +
          _crewEsc(_crewT('attention_see_all', { n: total })) +
        '</button>' +
      '</div>';
  }

  // Nothing to act on. Say "looks good" ONLY when there is also nothing the
  // system failed to check — CREW-UX 04 §2.5 / D3.
  if (total === 0) {
    html = (data.unknown.length === 0)
      ? '<p class="crew-calm crew-calm--good">' + _crewEsc(_crewT('attention_all_good')) + ' ✓</p>'
      : '<p class="crew-calm">' + _crewEsc(_crewT('attention_nothing')) + '</p>';
  }

  // The honest line. One row, never one card per unknown item.
  if (data.unknown.length > 0) {
    var msg = (data.unknown.length === 1)
      ? _crewT('unknown_one')
      : _crewT('unknown_many', { n: data.unknown.length });
    html +=
      '<div class="crew-unknown">' +
        '<span class="crew-unknown__text">' + _crewEsc(msg) + '</span>' +
        '<button type="button" class="crew-link" onclick="crewOpenStation()">' +
          _crewEsc(_crewT('cta_review')) +
        '</button>' +
      '</div>';
  }

  host.innerHTML = html;
}

// ── Yesterday — moved, never rebuilt ──────────────────────────────────────
// The existing #homeHighlightsWidget node is relocated into the third slot.
// Same element, same loadServiceUpdates() population, same query, same copy,
// same "View all", same Monday/weekly switch. Only its position changes.
function _crewMountYesterday() {
  var slot = document.getElementById('crewYesterdaySlot');
  var widget = document.getElementById('homeHighlightsWidget');
  if (!slot || !widget) return;
  if (widget.parentNode === slot) return; // already moved
  slot.appendChild(widget);
}

// ── Public render — called on the same triggers as the legacy Home ────────
function renderCrewHome() {
  if (!crewHomeEnabled(window.user)) return;
  var root = document.getElementById('crewHome');
  if (!root) return;

  var data = crewCollect(window.user);

  var label = document.getElementById('crewStationLabel');
  if (label) label.textContent = data.station || '';

  _crewRenderAttention(data);
  _crewMountYesterday();
  _crewRenderMadeFlow();
  _crewRenderDrafts();
}
window.renderCrewHome = renderCrewHome;

// ── Mount — single entry point, called once from doLogin() ────────────────
function mountCrewHome(u) {
  if (!crewHomeEnabled(u)) return;

  var root = document.getElementById('crewHome');
  if (!root) return;

  // Hide the legacy Home body for this user only. Nothing is removed from the
  // document and no global state is touched.
  for (var i = 0; i < CREW_HIDDEN_HOME_IDS.length; i++) {
    var el = document.getElementById(CREW_HIDDEN_HOME_IDS[i]);
    if (el) el.style.display = 'none';
  }

  root.style.display = 'block';
  document.body.classList.add('crew-home-pilot');

  _crewMountYesterday();
  renderCrewHome();
}
window.mountCrewHome = mountCrewHome;
