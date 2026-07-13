// BOH OS v2 — Station Prep page component
// Task 004B: read-only list of active prep tasks for the user's station.
// Task 004D: merges bot suggestions into each task row.
// Task 004E: adds data-suggestion-status attribute for CSS styling.
// Task 004F: operational sorting by suggestion priority then name ascending.
// Task 004G: groups sorted tasks into five priority sections.
// Returns an HTMLElement immediately; loads data asynchronously.
// No router import. No app-state import. No Supabase import. No window writes.

// ── Task state label ──────────────────────────────────────────────────

function taskStateKey(task) {
  if (task.inProgress === true) return 'station_prep.status_in_progress';
  if (task.needTomorrow === true) return 'station_prep.status_to_do';
  return 'station_prep.status_ready';
}

// ── Suggestion status mapping ─────────────────────────────────────────

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

function suggestionPriority(status) {
  switch (status) {
    case 'DO_FIRST':          return 1;
    case 'PREP_TODAY':        return 2;
    case 'DO_TODAY':          return 3;
    case 'COUNT_FIRST':       return 4;
    case 'VERIFY':            return 5;
    case 'UNAVAILABLE':       return 6;
    default:                  return 7;
    case 'LOOKS_OK':
    case 'LOOKS_GOOD':        return 8;
    case 'DEFER_TO_TOMORROW': return 9;
    case 'DEFER':             return 10;
  }
}

function sortedTasks(tasks, suggestionsMap) {
  return tasks.slice().sort((a, b) => {
    const aInProgress = a.inProgress === true;
    const bInProgress = b.inProgress === true;
    if (aInProgress !== bInProgress) return aInProgress ? 1 : -1;

    const aSug = suggestionsMap[a.id] ?? null;
    const bSug = suggestionsMap[b.id] ?? null;
    const aPri = suggestionPriority(aSug ? aSug.status : null);
    const bPri = suggestionPriority(bSug ? bSug.status : null);
    if (aPri !== bPri) return aPri - bPri;

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

// ── Section assignment ────────────────────────────────────────────────

// Five section keys in render order.
const SECTION_KEYS = [
  'do_first',
  'do_today',
  'check',
  'looks_good',
  'in_progress',
];

// Maps section key → its translation key.
const SECTION_LABEL_KEY = {
  do_first:    'station_prep.section_do_first',
  do_today:    'station_prep.section_do_today',
  check:       'station_prep.section_check',
  looks_good:  'station_prep.section_looks_good',
  in_progress: 'station_prep.section_in_progress',
};

/**
 * Returns the section key for a task.
 * inProgress === true always → 'in_progress', overriding suggestion status.
 *
 * @param {object} task
 * @param {object|null} suggestion
 * @returns {string}
 */
function taskSectionKey(task, suggestion) {
  if (task.inProgress === true) return 'in_progress';
  const status = suggestion ? suggestion.status : null;
  switch (status) {
    case 'DO_FIRST':                        return 'do_first';
    case 'PREP_TODAY':
    case 'DO_TODAY':                        return 'do_today';
    case 'LOOKS_OK':
    case 'LOOKS_GOOD':
    case 'DEFER_TO_TOMORROW':
    case 'DEFER':                           return 'looks_good';
    case 'COUNT_FIRST':
    case 'VERIFY':
    case 'UNAVAILABLE':
    default:                                return 'check';
  }
}

/**
 * Groups the sorted tasks array into section buckets.
 * Preserves sorted order within each bucket.
 * Does not mutate the input array or suggestions object.
 *
 * @param {Array<object>} sorted   — already sorted via sortedTasks()
 * @param {Object} suggestionsMap
 * @returns {Object}  — { do_first: [], do_today: [], check: [], looks_good: [], in_progress: [] }
 */
function groupedTasks(sorted, suggestionsMap) {
  const groups = {};
  for (const key of SECTION_KEYS) groups[key] = [];
  for (const task of sorted) {
    const suggestion = suggestionsMap[task.id] ?? null;
    groups[taskSectionKey(task, suggestion)].push(task);
  }
  return groups;
}

// ── Task row builder ──────────────────────────────────────────────────

function buildTaskRow(task, suggestion, translate) {
  const item = document.createElement('li');
  item.className = 'station-prep__task';

  const nameEl = document.createElement('span');
  nameEl.className = 'station-prep__task-name';
  nameEl.textContent = task.name;

  const rawStatus = suggestion ? suggestion.status : null;
  const botStatusEl = document.createElement('span');
  botStatusEl.className = 'station-prep__task-bot-status';
  botStatusEl.dataset.suggestionStatus = suggestionStatusAttr(rawStatus);
  botStatusEl.textContent = translate(suggestionStatusKey(rawStatus));

  const qtyEl = document.createElement('span');
  qtyEl.className = 'station-prep__task-qty';
  if (suggestion !== null && suggestion.plannedOutput !== null &&
      suggestion.plannedOutput !== undefined) {
    let qtyText = String(suggestion.plannedOutput);
    if (suggestion.outputUnit !== null && suggestion.outputUnit !== undefined) {
      qtyText += ' ' + suggestion.outputUnit;
    }
    qtyEl.textContent = qtyText;
  }

  const stateEl = document.createElement('span');
  stateEl.className = 'station-prep__task-status';
  stateEl.textContent = translate(taskStateKey(task));

  item.appendChild(nameEl);
  item.appendChild(botStatusEl);
  if (qtyEl.textContent.length > 0) item.appendChild(qtyEl);
  item.appendChild(stateEl);

  return item;
}

// ── Section group builder ─────────────────────────────────────────────

/**
 * Builds one section.station-prep__group element for a section key.
 * Returns null when the tasks array is empty (section is not rendered).
 *
 * @param {string} sectionKey
 * @param {Array<object>} tasks
 * @param {Object} suggestionsMap
 * @param {(key: string) => string} translate
 * @returns {HTMLElement|null}
 */
function buildGroup(sectionKey, tasks, suggestionsMap, translate) {
  if (tasks.length === 0) return null;

  const group = document.createElement('section');
  group.className = 'station-prep__group';
  group.dataset.section = sectionKey;

  // Heading row: label + count.
  const headingRow = document.createElement('div');
  headingRow.className = 'station-prep__group-heading';

  const label = document.createElement('h2');
  label.className = 'station-prep__group-label';
  label.textContent = translate(SECTION_LABEL_KEY[sectionKey]);

  const count = document.createElement('span');
  count.className = 'station-prep__group-count';
  count.textContent = String(tasks.length);

  headingRow.appendChild(label);
  headingRow.appendChild(count);

  // Task list.
  const list = document.createElement('ul');
  list.className = 'station-prep__list';

  for (const task of tasks) {
    const suggestion = suggestionsMap[task.id] ?? null;
    list.appendChild(buildTaskRow(task, suggestion, translate));
  }

  group.appendChild(headingRow);
  group.appendChild(list);

  return group;
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
  const section = document.createElement('section');
  section.className = 'station-prep';

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

  const content = document.createElement('div');
  content.className = 'station-prep__content';
  section.appendChild(content);

  if (!stationName || typeof stationName !== 'string' || stationName.trim().length === 0) {
    subtitle.textContent = '';
    const msg = document.createElement('p');
    msg.className = 'station-prep__unassigned';
    msg.textContent = translate('station_prep.station_unassigned');
    content.appendChild(msg);
    return section;
  }

  const loadingEl = document.createElement('p');
  loadingEl.className = 'station-prep__loading';
  loadingEl.textContent = translate('station_prep.loading');
  content.appendChild(loadingEl);

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

      // Total count — unchanged from 004F.
      const countEl = document.createElement('p');
      countEl.className = 'station-prep__count';
      countEl.textContent = translate('station_prep.task_count')
        .replace('{count}', String(taskResult.tasks.length));
      content.appendChild(countEl);

      // Sort then group, without mutating originals.
      const ordered = sortedTasks(taskResult.tasks, suggestionsMap);
      const groups  = groupedTasks(ordered, suggestionsMap);

      // Render non-empty sections in approved order.
      for (const key of SECTION_KEYS) {
        const groupEl = buildGroup(key, groups[key], suggestionsMap, translate);
        if (groupEl) content.appendChild(groupEl);
      }
    });
  });

  return section;
}
