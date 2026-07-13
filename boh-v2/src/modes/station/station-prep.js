// BOH OS v2 — Station Prep page component
// Task 004B: read-only list of active prep tasks for the user's station.
// Returns an HTMLElement immediately; loads data asynchronously.
// No router import. No app-state import. No Supabase import. No window writes.

// ── Status label ──────────────────────────────────────────────────────

/**
 * Resolves the status translation key for a task.
 *
 * @param {{ inProgress: boolean|null, needTomorrow: boolean|null }} task
 * @returns {string}
 */
function statusKey(task) {
  if (task.inProgress === true) return 'station_prep.status_in_progress';
  if (task.needTomorrow === true) return 'station_prep.status_to_do';
  return 'station_prep.status_ready';
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Creates the Station Prep page DOM element.
 * Calls fetchTasks asynchronously and updates its own DOM on completion.
 *
 * @param {{
 *   stationName: string | null | undefined,
 *   translate:   (key: string) => string,
 *   fetchTasks:  (station: string) => Promise<{ ok: boolean, tasks: Array }>
 * }} options
 * @returns {HTMLElement}
 */
export function createStationPrep({ stationName, translate, fetchTasks }) {
  // ── Root ────────────────────────────────────────────────────────────
  const section = document.createElement('section');
  section.className = 'station-prep';

  // ── Header ───────────────────────────────────────────────────────────
  const header = document.createElement('header');
  header.className = 'station-prep__header';

  const title = document.createElement('h1');
  title.className = 'station-prep__title';
  title.textContent = translate('station_prep.title');

  const subtitle = document.createElement('p');
  subtitle.className = 'station-prep__subtitle';
  subtitle.textContent = stationName || '';

  header.appendChild(title);
  header.appendChild(subtitle);
  section.appendChild(header);

  // ── Content area ─────────────────────────────────────────────────────
  const content = document.createElement('div');
  content.className = 'station-prep__content';
  section.appendChild(content);

  // ── Missing station: skip service call, show message ─────────────────
  if (!stationName || typeof stationName !== 'string' || stationName.trim().length === 0) {
    subtitle.textContent = '';
    const msg = document.createElement('p');
    msg.className = 'station-prep__unassigned';
    msg.textContent = translate('station_prep.station_unassigned');
    content.appendChild(msg);
    return section;
  }

  // ── Loading state (shown immediately) ────────────────────────────────
  const loadingEl = document.createElement('p');
  loadingEl.className = 'station-prep__loading';
  loadingEl.textContent = translate('station_prep.loading');
  content.appendChild(loadingEl);

  // ── Async data load ───────────────────────────────────────────────────
  fetchTasks(stationName).then((result) => {
    // Async safety: bail out if the component is no longer in the document.
    if (!section.isConnected) return;

    // Clear loading indicator.
    content.innerHTML = '';

    if (!result.ok) {
      // Error state.
      const errorEl = document.createElement('p');
      errorEl.className = 'station-prep__error';
      errorEl.textContent = translate('station_prep.error');
      content.appendChild(errorEl);
      return;
    }

    if (result.tasks.length === 0) {
      // Empty state.
      const emptyEl = document.createElement('p');
      emptyEl.className = 'station-prep__empty';
      emptyEl.textContent = translate('station_prep.empty');
      content.appendChild(emptyEl);
      return;
    }

    // Task count.
    const countEl = document.createElement('p');
    countEl.className = 'station-prep__count';
    // Replace {count} placeholder without modifying the i18n engine.
    countEl.textContent = translate('station_prep.task_count')
      .replace('{count}', String(result.tasks.length));
    content.appendChild(countEl);

    // Task list.
    const list = document.createElement('ul');
    list.className = 'station-prep__list';

    for (const task of result.tasks) {
      const item = document.createElement('li');
      item.className = 'station-prep__task';

      const nameEl = document.createElement('span');
      nameEl.className = 'station-prep__task-name';
      nameEl.textContent = task.name;   // textContent — never innerHTML

      const statusEl = document.createElement('span');
      statusEl.className = 'station-prep__task-status';
      statusEl.textContent = translate(statusKey(task));

      item.appendChild(nameEl);
      item.appendChild(statusEl);
      list.appendChild(item);
    }

    content.appendChild(list);
  });
  // Intentionally no .catch(): the service never throws for normal failures.

  return section;
}
