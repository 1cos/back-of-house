// BOH OS v2 — Home Block: Greeting
// HOME-01: time-aware greeting with user first name.
//
// No Supabase call — data comes from deps.user (already in memory).
// BLOCK_FETCHERS['greeting'] is a synchronous-equivalent function that
// constructs BlockRawData from deps.user without network (Appendix A3).
//
// Content rules (per Composition Engine §BLOCK: greeting):
//   - Time-based salutation (morning / afternoon / evening)
//   - User's first name only
//   - No role label, no date, no dashboard title
//   - Always visible (never EMPTY)

import {
  BLOCK_DEFINITIONS,
  BLOCK_FETCHERS,
  BLOCK_RENDERERS,
} from '../home-block-registry.js';

// ── Registration ───────────────────────────────────────────────────────

BLOCK_DEFINITIONS['greeting'] = {
  blockId:        'greeting',
  basePriority:   0,
  sizeClass:      'XS',
  financialFlag:  false,
  // All roles — greeting is always first (BL-21 authoritative gate)
  permittedRoles: new Set(['admin', 'executive_chef', 'supervisor', 'staff']),
  cacheTTL:       null,
  timeout:        4000, // fast — no network call
};

// Fetcher: synchronous data from deps.user, wrapped in Promise (BL-spec §10.3 pattern)
BLOCK_FETCHERS['greeting'] = async (user /*, signal */) => {
  const firstName = _extractFirstName(user.name);
  const greetKey  = _greetingKey();
  return {
    hasContent:   true,    // greeting is NEVER empty
    urgencyScore: 0,
    data:         { firstName, greetKey },
  };
};

BLOCK_RENDERERS['greeting'] = {
  skeleton() {
    const el = document.createElement('div');
    el.className = 'home-greeting home-greeting--skeleton';
    const line = document.createElement('div');
    line.className = 'home-greeting__skeleton-line';
    el.appendChild(line);
    return el;
  },

  content({ firstName, greetKey }, deps) {
    const el = document.createElement('div');
    el.className = 'home-greeting';

    const salutation = deps.translate(greetKey);
    const displayName = firstName || deps.translate('home.greeting_fallback');

    const text = document.createElement('p');
    text.className = 'home-greeting__text';
    // "Good morning, Cole." — salutation + first name + period
    text.textContent = `${salutation}, ${displayName}.`;

    el.appendChild(text);
    return el;
  },

  error(deps) {
    const el = document.createElement('div');
    el.className = 'home-greeting';
    const text = document.createElement('p');
    text.className = 'home-greeting__text';
    text.textContent = deps.translate('home.block_error');
    el.appendChild(text);
    return el;
  },
};

// ── Private helpers ───────────────────────────────────────────────────

/**
 * Extracts the first word of a name (first name only).
 * "Massimiliano Zubboli" → "Massimiliano"
 * @param {string|null|undefined} fullName
 * @returns {string}
 */
function _extractFirstName(fullName) {
  if (typeof fullName !== 'string' || fullName.trim().length === 0) return '';
  return fullName.trim().split(/\s+/)[0];
}

/**
 * Time-based greeting key matching station-home.js greetingKey() logic.
 * before 12:00 → morning
 * 12:00–17:59  → afternoon
 * 18:00+       → evening
 * @returns {string}
 */
function _greetingKey() {
  const hour = new Date().getHours();
  if (hour < 12) return 'home.good_morning';
  if (hour < 18) return 'home.good_afternoon';
  return 'home.good_evening';
}
