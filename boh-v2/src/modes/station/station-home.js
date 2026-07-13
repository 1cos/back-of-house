// BOH OS v2 — Station Home component
// Task 003D: identity and shift entry screen.
// Task 003E: onOpenToday wired directly; no serialization workaround needed.
// Returns a single DOM element. Does not mount itself.
// No router import. No Supabase. No app-state. No window writes.

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
 *   user:        { name?: string, defaultStation?: string },
 *   translate:   (key: string) => string,
 *   onOpenToday: () => void
 * }} options
 * @returns {HTMLElement}
 */
export function createStationHome({ user, translate, onOpenToday }) {
  const hasStation = typeof user.defaultStation === 'string' &&
                     user.defaultStation.trim().length > 0;

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

  // ── Station card ───────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'station-home__station-card';

  const stationLabel = document.createElement('span');
  stationLabel.className = 'station-home__station-label';
  stationLabel.textContent = translate('station_home.your_station');

  const stationName = document.createElement('span');
  stationName.className = 'station-home__station-name';
  stationName.textContent = hasStation
    ? user.defaultStation
    : translate('station_home.station_unassigned');

  card.appendChild(stationLabel);
  card.appendChild(stationName);

  // ── Primary action ─────────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.className = 'station-home__open-today';
  btn.type = 'button';
  btn.textContent = translate('station_home.open_today');

  if (!hasStation) {
    btn.disabled = true;
  } else {
    btn.addEventListener('click', () => {
      onOpenToday();
    });
  }

  // ── Assemble ───────────────────────────────────────────────────────────
  section.appendChild(greeting);
  section.appendChild(nameEl);
  section.appendChild(card);
  section.appendChild(btn);

  return section;
}
