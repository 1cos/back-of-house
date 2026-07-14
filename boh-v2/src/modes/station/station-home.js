// BOH OS v2 — Station Home component
// Task 003D: identity and shift entry screen.
// Task 003E: onOpenToday wired directly; no serialization workaround needed.
// Task 004AI: admin/executive-chef selector — fetchStations injected from parent;
//             no Supabase import here. canChooseStation governs selector display.
// Returns a single DOM element. Does not mount itself.
// No router import. No Supabase. No app-state. No window writes.

import { createStationSelector } from '../../components/station/station-selector.js';

// ── Time-based greeting ───────────────────────────────────────────────

/**
 * Returns the appropriate greeting translation key for the current hour.
 * before 12:00 → morning
 * 12:00–17:59  → afternoon
 * 18:00+       → evening
 *
 * @returns {string}
 */
function greetingKey() {
  const hour = new Date().getHours();
  if (hour < 12) return 'station_home.good_morning';
  if (hour < 18) return 'station_home.good_afternoon';
  return 'station_home.good_evening';
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Creates the Station Home DOM element.
 *
 * @param {{
 *   user:            { name?: string, defaultStation?: string },
 *   stationName:     string | null,
 *   canChooseStation: boolean,
 *   translate:       (key: string) => string,
 *   fetchStations:   () => Promise<{ ok: boolean, stations: string[] }>,
 *   onStationSelect: (stationName: string) => void,
 *   onOpenToday:     () => void
 * }} options
 * @returns {HTMLElement}
 */
export function createStationHome({ user, stationName, canChooseStation, translate, fetchStations, onStationSelect, onOpenToday }) {
  const hasStation = typeof stationName === 'string' && stationName.trim().length > 0;
  // Show selector when: eligible role + no effective station.
  const showSelector = !hasStation && canChooseStation === true;

  // ── Root ─────────────────────────────────────────────────────────────
  const section = document.createElement('section');
  section.className = 'station-home';

  // ── Greeting ──────────────────────────────────────────────────────────
  const greeting = document.createElement('p');
  greeting.className = 'station-home__greeting';
  greeting.textContent = translate(greetingKey());

  // ── User name ─────────────────────────────────────────────────────────
  const nameEl = document.createElement('h1');
  nameEl.className = 'station-home__name';
  const displayName = typeof user.name === 'string' && user.name.trim().length > 0
    ? user.name
    : translate('station_home.greeting_fallback');
  nameEl.textContent = displayName;

  section.appendChild(greeting);
  section.appendChild(nameEl);

  // ── Station area ────────────────────────────────────────────────────

  if (hasStation) {
    // Normal path: station known — show station card and Open Today.
    const card = document.createElement('div');
    card.className = 'station-home__station-card';

    const stationLabel = document.createElement('span');
    stationLabel.className = 'station-home__station-label';
    stationLabel.textContent = translate('station_home.your_station');

    const stationNameEl = document.createElement('span');
    stationNameEl.className = 'station-home__station-name';
    stationNameEl.textContent = stationName;

    card.appendChild(stationLabel);
    card.appendChild(stationNameEl);

    const btn = document.createElement('button');
    btn.className = 'station-home__open-today';
    btn.type = 'button';
    btn.textContent = translate('station_home.open_today');
    btn.addEventListener('click', () => { onOpenToday(); });

    section.appendChild(card);
    section.appendChild(btn);

  } else if (showSelector) {
    // Eligible role, no station yet — show selector.
    const selectorArea = document.createElement('div');
    selectorArea.className = 'station-home__selector-area';

    const loadingEl = document.createElement('p');
    loadingEl.className = 'station-home__selector-loading';
    loadingEl.textContent = translate('station_selector.loading');
    selectorArea.appendChild(loadingEl);

    section.appendChild(selectorArea);

    // Fetch stations exactly once for this component instance.
    fetchStations().then((result) => {
      if (!section.isConnected) return;
      selectorArea.innerHTML = '';

      if (!result.ok) {
        const errEl = document.createElement('p');
        errEl.className = 'station-home__selector-error';
        errEl.setAttribute('role', 'alert');
        errEl.textContent = translate('station_selector.error');
        selectorArea.appendChild(errEl);
        return;
      }

      // result.ok: mount selector (handles empty list via createStationSelector).
      const selectorEl = createStationSelector({
        stations:  result.stations,
        translate,
        onSelect:  onStationSelect,
      });
      selectorArea.appendChild(selectorEl);
    }).catch(() => {
      if (!section.isConnected) return;
      selectorArea.innerHTML = '';
      const errEl = document.createElement('p');
      errEl.className = 'station-home__selector-error';
      errEl.setAttribute('role', 'alert');
      errEl.textContent = translate('station_selector.error');
      selectorArea.appendChild(errEl);
    });

  } else {
    // Ineligible or unknown role without station — preserve existing behavior.
    const card = document.createElement('div');
    card.className = 'station-home__station-card';

    const stationLabel = document.createElement('span');
    stationLabel.className = 'station-home__station-label';
    stationLabel.textContent = translate('station_home.your_station');

    const stationNameEl = document.createElement('span');
    stationNameEl.className = 'station-home__station-name';
    stationNameEl.textContent = translate('station_home.station_unassigned');

    card.appendChild(stationLabel);
    card.appendChild(stationNameEl);

    const btn = document.createElement('button');
    btn.className = 'station-home__open-today';
    btn.type = 'button';
    btn.textContent = translate('station_home.open_today');
    btn.disabled = true;

    section.appendChild(card);
    section.appendChild(btn);
  }

  return section;
}
