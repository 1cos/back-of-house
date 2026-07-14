// BOH OS v2 — Admin Station Selector component
// Task 004AH: displays available stations for admin/executive-chef users.
// UI-only. No Supabase. No routing. No persistence. Does not mount itself.
// No window writes. No storage. No service imports.

/**
 * Normalizes the raw stations input into a clean, sorted, deduplicated array.
 * Does not mutate the input.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeStations(raw) {
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const result = [];

  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

/**
 * Creates the station selector DOM element.
 *
 * @param {{
 *   stations:  unknown,
 *   translate: (key: string) => string,
 *   onSelect:  ((stationName: string) => void) | unknown
 * }} options
 * @returns {HTMLElement}
 */
export function createStationSelector({ stations, translate, onSelect }) {
  // ── Translate validation ─────────────────────────────────────────────
  if (typeof translate !== 'function') {
    throw new Error(
      'createStationSelector: translate must be a function. ' +
      'Pass the translate helper from the parent component.'
    );
  }

  // ── Normalize stations ───────────────────────────────────────────────
  const normalized = normalizeStations(stations);
  const hasCallable = typeof onSelect === 'function';

  // ── Root ─────────────────────────────────────────────────────────────
  const section = document.createElement('section');
  section.className = 'station-selector';

  // ── Heading ──────────────────────────────────────────────────────────
  const heading = document.createElement('h2');
  heading.className = 'station-selector__title';
  heading.textContent = translate('station_selector.title');

  // ── Supporting text ───────────────────────────────────────────────────
  const description = document.createElement('p');
  description.className = 'station-selector__description';
  description.textContent = translate('station_selector.description');

  section.appendChild(heading);
  section.appendChild(description);

  // ── Station list or empty state ───────────────────────────────────────
  if (normalized.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'station-selector__empty';
    empty.textContent = translate('station_selector.empty');
    section.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'station-selector__list';

    for (const stationName of normalized) {
      const item = document.createElement('li');
      item.className = 'station-selector__item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'station-selector__button';
      btn.textContent = stationName;

      if (hasCallable) {
        btn.addEventListener('click', () => {
          onSelect(stationName);
        });
      }

      item.appendChild(btn);
      list.appendChild(item);
    }

    section.appendChild(list);
  }

  return section;
}
