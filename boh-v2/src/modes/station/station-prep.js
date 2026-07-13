// BOH OS v2 — Station Prep page component
// Task 004B: read-only list of active prep tasks for the user's station.
// Task 004D: merges bot suggestions into each task row.
// Returns an HTMLElement immediately; loads data asynchronously.
// No router import. No app-state import. No Supabase import. No window writes.

// ── Task state label ──────────────────────────────────────────────────

/**
 * Resolves the translation key for the task's current operational state.
 *
 * @param {{ inProgress: boolean|null, needTomorrow: boolean|null }} task
 * @returns {string}
 */
function taskStateKey(task) {
  if (task.inProgress === true) return 'station_prep.status_in_progress';
  if (task.needTomorrow === true) return 'station_prep.status_to_do';
  return 'station_prep.status_ready';
}

// ── Suggestion status mapping ─────────────────────────────────────────

/**
 * Maps a raw bot suggestion status string to its translation key.
 * Unknown or missing statuses fall back to CHECK.
 *
 * @param {string|null|undefined} status
 * @returns {string}
 */
function suggestionStatusKey(status) {
  switch (status) {
    case 'DO_FIRST':          return 'station_prep.suggestion_do_first';
    case 'PREP_TODAY':
    case 'DO_TODAY':          return 'station_prep.suggestion_do_today';
    case 'LOOKS_OK':
    case 'LOOKS_GOOD':        return 'station_prep.suggestion_looks_good';
    case 'COUNT_FIRST':       return 'station_prep.suggestion_count_first';
    case 'DEFER_TO_TOMORROW':
    case 'DEFER':             return 'station_prep.suggestion_check_tomorrow';
    case 'VERIFY':
    case 'UNAVAILABLE':       return 'station_prep.suggestion_check';
    default:                  return 'station_prep.suggestion_check';
  }
}

// ── Task row builder ──────────────────────────────────────────────────

/**
 * Builds a single task row <li> element.
 *
 * @param {object} task
 * @param {object|null} suggestion  — null when unavailable or failed
 * @param {(key: string) => string} translate
 * @returns {HTMLElement}
 */
function buildTaskRow(task, suggestion, translate) {
  const item = document.createElement('li');
  item.className = 'station-prep__task';

  // Task name — textContent, never innerHTML.
  const nameEl = document.createElement('span');
  nameEl.className = 'station-prep__task-name';
  nameEl.textContent = task.name;

  // Bot suggestion status.
  const botStatusEl = document.createElement('span');
  botStatusEl.className = 'station-prep__task-bot-status';
  botStatusEl.textContent = translate(
    suggestionStatusKey(suggestion ? suggestion.status : null)
  );

  // Planned quantity — shown only when plannedOutput is not null.
  const qtyEl = document.createElement('span');
  qtyEl.className = 'station-prep__task-qty';
  if (suggestion !== null && suggestion.plannedOutput !== null &&
      suggestion.plannedOutput !== undefined) {
    let qtyText = String(suggestion.plannedOutput);
    if (suggestion.outputUnit !== null && suggestion.outputUnit !== undefined) {
      qtyText += ' ' + suggestion.outputUnit;
    }
    qtyEl.textContent = qtyText;   // textContent — never innerHTML
  }

  // Task state label (In progress / To do / Ready).
  const stateEl = document.createElement('span');
  stateEl.className = 'station-prep__task-status';
  stateEl.textContent = translate(taskStateKey(task));

  item.appendChild(nameEl);
  item.appendChild(botStatusEl);
  if (qtyEl.textContent.length > 0) {
    item.appendChild(qtyEl);
  }
  item.appendChild(stateEl);

  return item;
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Creates the Station Prep page DOM element.
 * Calls fetchTasks then fetchSuggestions asynchronously;
 * updates its own DOM when both complete.
 *
 * @param {{
 *   stationName:      string | null | undefined,
 *   translate:        (key: string) => string,
 *   fetchTasks:       (station: string) => Promise<{ ok: boolean, tasks: Array }>,
 *   fetchSuggestions: (ids: number[]) => Promise<{ ok: boolean, suggestions: Object }>
 * }} options
 * @returns {HTMLElement}
 */
export function createStationPrep({ stationName, translate, fetchTasks, fetchSuggestions }) {
  // ── Root ─────────────────────────────────────────────────────────────
  const section = document.createElement('section');
  section.className = 'station-prep';

  // ── Header ────────────────────────────────────────────────────────────
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

  // ── Content area ──────────────────────────────────────────────────────
  const content = document.createElement('div');
  content.className = 'station-prep__content';
  section.appendChild(content);

  // ── Missing station: skip both service calls, show message ────────────
  if (!stationName || typeof stationName !== 'string' || stationName.trim().length === 0) {
    subtitle.textContent = '';
    const msg = document.createElement('p');
    msg.className = 'station-prep__unassigned';
    msg.textContent = translate('station_prep.station_unassigned');
    content.appendChild(msg);
    return section;
  }

  // ── Loading state (shown until both requests complete) ─────────────────
  const loadingEl = document.createElement('p');
  loadingEl.className = 'station-prep__loading';
  loadingEl.textContent = translate('station_prep.loading');
  content.appendChild(loadingEl);

  // ── Async data-loading sequence ────────────────────────────────────────
  // 1. Load tasks.
  // 2. On success + non-empty: collect IDs, load suggestions.
  // 3. Merge suggestions into rows (fallback to CHECK on suggestion failure).
  // Loading state remains until both requests have settled.

  fetchTasks(stationName).then((taskResult) => {
    // Async safety: stop if navigated away.
    if (!section.isConnected) return;

    // Task loading failed.
    if (!taskResult.ok) {
      content.innerHTML = '';
      const errorEl = document.createElement('p');
      errorEl.className = 'station-prep__error';
      errorEl.textContent = translate('station_prep.error');
      content.appendChild(errorEl);
      return;
    }

    // No tasks for this station.
    if (taskResult.tasks.length === 0) {
      content.innerHTML = '';
      const emptyEl = document.createElement('p');
      emptyEl.className = 'station-prep__empty';
      emptyEl.textContent = translate('station_prep.empty');
      content.appendChild(emptyEl);
      return;
    }

    // Collect numeric task IDs for the suggestion request.
    const taskIds = taskResult.tasks.map((t) => t.id);

    // Load suggestions for the collected IDs.
    fetchSuggestions(taskIds).then((sugResult) => {
      // Async safety: stop if navigated away.
      if (!section.isConnected) return;

      // On suggestion failure, suggestions object is empty — rows fall back to CHECK.
      const suggestionsMap = (sugResult.ok && sugResult.suggestions)
        ? sugResult.suggestions
        : {};

      // Clear loading indicator.
      content.innerHTML = '';

      // Task count.
      const countEl = document.createElement('p');
      countEl.className = 'station-prep__count';
      countEl.textContent = translate('station_prep.task_count')
        .replace('{count}', String(taskResult.tasks.length));
      content.appendChild(countEl);

      // Task list — order preserved from service (name ascending).
      const list = document.createElement('ul');
      list.className = 'station-prep__list';

      for (const task of taskResult.tasks) {
        const suggestion = suggestionsMap[task.id] ?? null;
        list.appendChild(buildTaskRow(task, suggestion, translate));
      }

      content.appendChild(list);
    });
    // No .catch(): fetchSuggestions never throws for normal failures.
  });
  // No .catch(): fetchTasks never throws for normal failures.

  return section;
}
