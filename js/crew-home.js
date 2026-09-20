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

  unknown_one:          "1 item can't be checked automatically",
  unknown_many:         "{n} items can't be checked automatically",

  batch_one:            '1 batch',
  batch_many:           '{n} batches',

  made_title:           'What did you make?',
  made_placeholder:     'Tell me what you made...',
  made_send:            'Save',
  made_pilot_note:      'Pilot: this is kept on your phone only. Nothing is recorded yet.',
  made_noted:           'Noted on this phone',
  made_clear:           'Clear'
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

window.crewSaveMade = function () {
  var input = document.getElementById('crewMadeInput');
  if (!input) return;
  var text = (input.value || '').trim();
  if (!text) return;
  var drafts = _crewLoadDrafts();
  drafts.push({ text: text, at: new Date().toISOString() });
  _crewSaveDrafts(drafts);
  input.value = '';
  _crewRenderDrafts();
};

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

    html +=
      '<article class="crew-card" style="--crew-accent:' + CREW_ACCENT[e.kind] + '">' +
        '<div class="crew-card__label">' + _crewEsc(_crewLabel(e.kind)) + '</div>' +
        '<h3 class="crew-card__name">' + _crewEsc(e.task.name) + '</h3>' +
        (qty ? '<div class="crew-card__qty">' + _crewEsc(qty) + '</div>' : '') +
        (why ? '<p class="crew-card__why">' + _crewEsc(why) + '</p>' : '') +
        '<div class="crew-card__actions">' +
          '<button type="button" class="crew-cta" onclick="' + ctaCall + '">' +
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
