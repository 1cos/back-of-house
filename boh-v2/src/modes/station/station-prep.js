// BOH OS v2 — Station Prep page component
// Task 004B: read-only list of active prep tasks for the user's station.
// Task 004D: merges bot suggestions into each task row.
// Task 004E: adds data-suggestion-status attribute for CSS styling.
// Task 004F: operational sorting by suggestion priority then name ascending.
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

/**
 * Maps a raw bot suggestion status string to the data-suggestion-status
 * attribute value. Derives from the same switch as suggestionStatusKey
 * so styling never depends on translated text.
 *
 * @param {string|null|undefined} status
 * @returns {string}
 */
function suggestionStatusAttr(status) {
  switch (status) {
    case 'DO_FIRST':          return 'do-first';
    case 'PREP_TODAY':
    case 'DO_TODAY':          return 'do-today';
    case 'LOOKS_OK':
    case 'LOOKS_GOOD':        return 'looks-good';
    case 'COUNT_FIRST':       return 'count-first';
    case 'DEFER_TO_TOMORROW':
    case 'DEFER':             return 'check-tomorrow';
    case 'VERIFY':
    case 'UNAVAILABLE':       return 'check';
    default:                  return 'check';
  }
}

// ── Operational sorting ───────────────────────────────────────────────

/**
 * Returns the numeric sort priority for a raw suggestion status.
 * Lower number = higher in the list.
 * In-progress override is applied at the comparator level, not here.
 *
 * @param {string|null|undefined} status
 * @returns {number}
 */
function suggestionPriority(status) {
  switch (status) {
    case 'DO_FIRST':          return 1;
    case 'PREP_TODAY':        return 2;
    case 'DO_TODAY':          return 3;
    case 'COUNT_FIRST':       return 4;
    case 'VERIFY':            return 5;
    case 'UNAVAILABLE':       return 6;
    // missing / unknown
    default:                  return 7;
    case 'LOOKS_OK':
    case 'LOOKS_GOOD':        return 8;
    case 'DEFER_TO_TOMORROW': return 9;
    case 'DEFER':             return 10;
  }
}

/**
 * Returns a sorted copy of the tasks array using operational kitchen order.
 * Does not mutate the original array or the suggestions object.
 *
 * Sort key (primary to tertiary):
 *   1. inProgress === true → always last
 *   2. suggestion priority (numeric, lower = higher)
 *   3. task name ascending, case-insensitive
 *
 * @param {Array<object>} tasks
 * @param {Object} suggestionsMap  — keyed by task.id
 * @returns {Array<object>}
 */
function sortedTasks(tasks, suggestionsMap) {
  return tasks.slice().sort((a, b) => {
    // In-progress tasks always sink to the bottom.
    const aInProgress = a.inProgress === true;
    const bInProgress = b.inProgress === true;
    if (aInProgress !== bInProgress) {
      return aInProgress ? 1 : -1;
    }

    // Within the same in-progress bucket, sort by suggestion priority.
    const aSuggestion = suggestionsMap[a.id] ?? null;
    const bSuggestion = suggestionsMap[b.id] ?? null;
    const aPriority = suggestionPriority(aSuggestion ? aSuggestion.status : null);
    const bPriority = suggestionPriority(bSuggestion ? bSuggestion.status : null);
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Tie-break: task name ascending, case-insensitive.
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
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

  // Bot suggestion status pill.
  const rawStatus = suggestion ? suggestion.status : null;
  const botStatusEl = document.createElement('span');
  botStatusEl.className = 'station-prep__task-bot-status';
  botStatusEl.dataset.suggestionStatus = suggestionStatusAttr(rawStatus);
  botStatusEl.textContent = translate(suggestionStatusKey(rawStatus));

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
  fetchTasks(stationName).then((taskResult) => {
    if (!section.isConnected) return;

    if (!taskResult.ok) {
      content.innerHTML = '';
      const errorEl = document.createElement('p');
      errorEl.className = 'station-prep__error';
      errorEl.textContent = translate('station_prep.error');
      content.appendChild(errorEl);
      return;
    }

    if (taskResult.tasks.length === 0) {
      content.innerHTML = '';
      const emptyEl = document.createElement('p');
      emptyEl.className = 'station-prep__empty';
      emptyEl.textContent = translate('station_prep.empty');
      content.appendChild(emptyEl);
      return;
    }

    const taskIds = taskResult.tasks.map((t) => t.id);

    fetchSuggestions(taskIds).then((sugResult) => {
      if (!section.isConnected) return;

      const suggestionsMap = (sugResult.ok && sugResult.suggestions)
        ? sugResult.suggestions
        : {};

      content.innerHTML = '';

      const countEl = document.createElement('p');
      countEl.className = 'station-prep__count';
      countEl.textContent = translate('station_prep.task_count')
        .replace('{count}', String(taskResult.tasks.length));
      content.appendChild(countEl);

      const list = document.createElement('ul');
      list.className = 'station-prep__list';

      // Sort into operational kitchen order without mutating the originals.
      const ordered = sortedTasks(taskResult.tasks, suggestionsMap);

      for (const task of ordered) {
        const suggestion = suggestionsMap[task.id] ?? null;
        list.appendChild(buildTaskRow(task, suggestion, translate));
      }

      content.appendChild(list);
    });
  });

  return section;
}
