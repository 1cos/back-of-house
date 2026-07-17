// BOH OS v2 — Home Block: Station Focus
// HOME-01: up to 3 highest-priority prep items for the user's station.
//
// Role gate: staff, supervisor (NOT admin, executive_chef — they see station_overview).
// Trust & Clean: Supabase access moved to home-prep-service.js.
// No supabase import here.
//
// Content rules (per Composition Engine §BLOCK: station_focus):
//   - Eyebrow label "Today's focus" + station name header
//   - Up to 3 prep items ordered: do_first → in_progress → do_today
//   - Each item: name + suggestion status label + quantity/unit if known
//   - One narrative sentence derived from overall operational state
//   - One action: "Open station" → deps.openPanel('station-prep', { stationName })
//   - If no urgent prep: show calm "Station looks ready" text
//   - Always shown for station users with defaultStation (never empty for them)

import {
  BLOCK_DEFINITIONS,
  BLOCK_FETCHERS,
  BLOCK_RENDERERS,
} from '../home-block-registry.js';

import { fetchStationHomeFocus } from '../../services/home-prep-service.js';

// ── Registration ───────────────────────────────────────────────────────

BLOCK_DEFINITIONS['station_focus'] = {
  blockId:        'station_focus',
  basePriority:   2,
  sizeClass:      'M',
  financialFlag:  false,
  // BL-21: authoritative role gate — staff only (supervisor routes to station_overview)
  // Note: supervisor is listed here to satisfy BL-21's Set inclusion requirement,
  // but _permittedBlockIds in home-panel.js always routes supervisor to station_overview
  // via the isExecutive check (supervisor holds view_executive_mode).
  // This means station_focus is never instantiated for supervisor in practice.
  permittedRoles: new Set(['staff']),
  cacheTTL:       null,
  timeout:        8000,
};

BLOCK_FETCHERS['station_focus'] = async (user /*, signal */) => {
  const stationName = typeof user.defaultStation === 'string'
    ? user.defaultStation.trim()
    : null;

  // No station assigned
  if (!stationName) {
    return {
      hasContent:   true,
      urgencyScore: 0,
      data:         { stationName: null, items: [], noStation: true },
    };
  }

  try {
    const result = await fetchStationHomeFocus(stationName);

    if (!result.ok) {
      throw new Error('fetch failed');
    }

    if (!result.hasData) {
      return {
        hasContent:   true,
        urgencyScore: 0,
        data:         { stationName, items: [], noStation: false },
      };
    }

    // Sort by priority score, exclude looks_good (score=99), take top 3
    const sorted = result.items
      .filter((t) => t.score < 99)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);

    const hasUrgent = sorted.some((t) => t.status === 'do_first');

    return {
      hasContent:   true,
      urgencyScore: hasUrgent ? -2 : 0,
      data:         { stationName, items: sorted, noStation: false, allItems: result.items },
    };

  } catch (_err) {
    // Let createBlock catch handler render the error state
    throw _err;
  }
};

BLOCK_RENDERERS['station_focus'] = {
  skeleton() {
    const el = document.createElement('div');
    el.className = 'home-station-focus home-station-focus--skeleton';
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'home-station-focus__skeleton-row';
      el.appendChild(row);
    }
    return el;
  },

  content(data, deps) {
    const el = document.createElement('div');
    el.className = 'home-station-focus';

    const t = (key) => deps.translate(key);

    // ── Header: eyebrow + station name ────────────────────────────
    const header = document.createElement('div');
    header.className = 'home-station-focus__header';

    const eyebrow = document.createElement('p');
    eyebrow.className = 'home-station-focus__eyebrow';
    eyebrow.textContent = t('home.station_focus_eyebrow');
    header.appendChild(eyebrow);

    const stationLabel = document.createElement('p');
    stationLabel.className = 'home-station-focus__station-name';
    stationLabel.textContent = data.stationName ?? t('home.station_focus_no_station');
    header.appendChild(stationLabel);

    el.appendChild(header);

    if (data.noStation) {
      const msg = document.createElement('p');
      msg.className = 'home-station-focus__calm';
      msg.textContent = t('home.station_focus_no_station');
      el.appendChild(msg);
      return el;
    }

    // ── Prep items ────────────────────────────────────────────────
    if (data.items && data.items.length > 0) {
      const list = document.createElement('ul');
      list.className = 'home-station-focus__list';
      list.setAttribute('role', 'list');

      for (const item of data.items) {
        const li = document.createElement('li');
        li.className = 'home-station-focus__item';

        const nameEl = document.createElement('span');
        nameEl.className = 'home-station-focus__item-name';
        nameEl.textContent = item.name;

        const badge = document.createElement('span');
        badge.className = `home-station-focus__badge home-station-focus__badge--${_badgeClass(item.status)}`;
        badge.textContent = _statusLabel(item.status, deps);

        li.appendChild(nameEl);
        li.appendChild(badge);

        // Quantity when available
        if (item.plannedOutput != null && item.outputUnit) {
          const qty = document.createElement('span');
          qty.className = 'home-station-focus__qty';
          qty.textContent = `${item.plannedOutput} ${item.outputUnit}`;
          li.appendChild(qty);
        }

        list.appendChild(li);
      }
      el.appendChild(list);
    } else {
      // All prep in good state
      const calm = document.createElement('p');
      calm.className = 'home-station-focus__calm';
      calm.textContent = t('home.station_focus_ready');
      el.appendChild(calm);
    }

    // ── Narrative sentence ─────────────────────────────────────────
    // Derived from the overall operational state, not from individual counters.
    // Returns a locale key that the renderer resolves — future event-based
    // logic can replace _narrativeKey() without touching the UI contract.
    const narrativeKey = _narrativeKey(data);
    const narrative = document.createElement('p');
    narrative.className = 'home-station-focus__narrative';
    narrative.textContent = t(narrativeKey);
    el.appendChild(narrative);

    // ── Primary action ─────────────────────────────────────────────
    if (data.stationName) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'home-station-focus__cta';
      btn.textContent = t('home.station_focus_open');
      btn.addEventListener('click', () => {
        deps.openPanel('station-prep', { stationName: data.stationName });
      });
      el.appendChild(btn);
    }

    return el;
  },

  error(deps) {
    const el = document.createElement('div');
    el.className = 'home-station-focus';
    const msg = document.createElement('p');
    msg.className = 'home-station-focus__error';
    msg.textContent = deps.translate('home.block_error');
    el.appendChild(msg);
    return el;
  },
};

// ── Narrative key ──────────────────────────────────────────────────────
// Reads the overall operational state and returns the appropriate locale key.
// State priority (descending):
//   1. No items fetched at all → calm, nothing pending
//   2. Any item is do_first   → priority work before service
//   3. Any item is in_progress → active work underway, on track
//   4. Items exist but none are do_first / in_progress → scheduled work ahead
//   5. All visible items are looks_good → station is covered
//
// `data.allItems` carries the full unfiltered set (including looks_good).
// `data.items` carries only the top-3 display slice (looks_good excluded).
// The narrative reads `allItems` for the full picture.

function _narrativeKey(data) {
  const all = data.allItems ?? data.items ?? [];

  if (all.length === 0) {
    return 'home.station_focus_narrative_nothing_pending';
  }

  const hasUrgent     = all.some((t) => t.status === 'do_first');
  const hasInProgress = all.some((t) => t.status === 'in_progress');
  const allReady      = all.every((t) => t.status === 'looks_good' || t.status == null);

  if (hasUrgent)     return 'home.station_focus_narrative_priority';
  if (allReady)      return 'home.station_focus_narrative_ready';
  if (hasInProgress) return 'home.station_focus_narrative_in_progress';
  return 'home.station_focus_narrative_on_schedule';
}

// ── Helpers ────────────────────────────────────────────────────────────

function _badgeClass(status) {
  switch (status) {
    case 'do_first':    return 'urgent';
    case 'in_progress': return 'active';
    case 'do_today':    return 'normal';
    default:            return 'calm';
  }
}

function _statusLabel(status, deps) {
  const map = {
    do_first:    'station_prep.suggestion_do_first',
    do_today:    'station_prep.suggestion_do_today',
    in_progress: 'station_prep.status_in_progress',
    looks_good:  'station_prep.suggestion_looks_good',
    count_first: 'station_prep.suggestion_count_first',
    check:       'station_prep.suggestion_check',
  };
  const key = map[status];
  return key ? deps.translate(key) : (status ?? '—');
}
