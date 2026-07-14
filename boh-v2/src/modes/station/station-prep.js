// BOH OS v2 — Station Prep page component
// Task 004B: read-only list of active prep tasks for the user's station.
// Task 004D: merges bot suggestions into each task row.
// Task 004E: adds data-suggestion-status attribute for CSS styling.
// Task 004F: operational sorting by suggestion priority then name ascending.
// Task 004G: groups sorted tasks into five priority sections.
// Task 004H: collapsible task detail panel (expand/collapse, no new DB query).
// Task 004K: shows today's production logs inside each expanded task detail.
// Task 004M: Start button inside expanded detail; connects to startPrepTask service.
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

// ── Time formatting ───────────────────────────────────────────────────

/**
 * Converts a createdAt ISO string to a local device time string (HH:MM AM/PM).
 * Returns the time_not_available fallback key string when missing or invalid.
 * Private — used only by buildMadeToday.
 *
 * @param {unknown} createdAt
 * @returns {string | null}  — formatted time string, or null to signal fallback
 */
function formatLocalTime(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ── Made today section builder ────────────────────────────────────────

/**
 * Builds the "Made today" section for the detail panel.
 * Uses only log entries already loaded by the component.
 * No database query. No writes.
 *
 * @param {Array<object> | undefined} logs   — entries from logsByTaskName[task.name]
 * @param {(key: string) => string} translate
 * @returns {HTMLElement}
 */
function buildMadeToday(logs, translate) {
  const section = document.createElement('div');
  section.className = 'station-prep__detail-made-today';

  // Section label
  const sectionLabel = document.createElement('span');
  sectionLabel.className = 'station-prep__detail-label';
  sectionLabel.textContent = translate('station_prep.detail_made_today');
  section.appendChild(sectionLabel);

  if (!logs || logs.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'station-prep__detail-value';
    empty.textContent = translate('station_prep.detail_nothing_made_today');
    section.appendChild(empty);
    return section;
  }

  // One card per log entry, in createdAt ascending order (preserved from service).
  for (const log of logs) {
    const card = document.createElement('div');
    card.className = 'station-prep__log-entry';

    // Quantity + unit
    const qtyEl = document.createElement('span');
    qtyEl.className = 'station-prep__log-qty';
    if (log.quantity !== null && log.quantity !== undefined) {
      let text = String(log.quantity);
      if (log.unit !== null && log.unit !== undefined) {
        text += ' ' + log.unit;
      }
      qtyEl.textContent = text;
    } else {
      qtyEl.textContent = translate('station_prep.detail_quantity_not_recorded');
    }

    // User name
    const userEl = document.createElement('span');
    userEl.className = 'station-prep__log-user';
    if (typeof log.userName === 'string' && log.userName.trim().length > 0) {
      userEl.textContent = log.userName;
    } else {
      userEl.textContent = translate('station_prep.detail_user_not_recorded');
    }

    // Local time
    const timeEl = document.createElement('span');
    timeEl.className = 'station-prep__log-time';
    const formatted = formatLocalTime(log.createdAt);
    timeEl.textContent = formatted !== null
      ? formatted
      : translate('station_prep.detail_time_not_available');

    card.appendChild(qtyEl);
    card.appendChild(userEl);
    card.appendChild(timeEl);
    section.appendChild(card);
  }

  return section;
}

// ── Start button builder ──────────────────────────────────────────────

/**
 * Builds a Start button for an eligible task (not already in progress).
 *
 * Eligibility: task.inProgress !== true
 * The button appears only inside the expanded detail panel.
 * If currentUser.name is missing/empty the button is rendered disabled.
 *
 * @param {{
 *   task:        object,               — working copy of the task
 *   currentUser: object,
 *   translate:   (key: string) => string,
 *   startTask:   Function,
 *   section:     HTMLElement,           — root section for isConnected checks
 *   onSuccess:   (result: object) => void,
 *   detailEl:    HTMLElement,           — detail panel to insert error into
 * }} opts
 * @returns {HTMLElement}
 */
function buildStartButton({ task, currentUser, translate, startTask, section, onSuccess, detailEl }) {
  const userName = (currentUser && typeof currentUser.name === 'string')
    ? currentUser.name.trim()
    : '';
  const canStart = userName.length > 0;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'station-prep__start-btn';
  btn.textContent = translate('station_prep.start');
  if (!canStart) btn.disabled = true;

  // Per-button submission guard (prevents duplicate clicks).
  let submitting = false;

  btn.addEventListener('click', () => {
    if (submitting || !canStart) return;
    submitting = true;

    // 1. Remove any previous inline start error for this task.
    const prevErr = detailEl.querySelector('.station-prep__start-error');
    if (prevErr) prevErr.remove();

    // 2. Disable button and show Starting… label.
    btn.disabled = true;
    btn.textContent = translate('station_prep.starting');

    // 3. Call service.
    startTask({ prepTaskId: task.id, startedBy: userName })
      .then((result) => {
        // 4. Disconnected-page safety.
        if (!section.isConnected) return;

        if (result.ok) {
          onSuccess(result);
        } else {
          // Failure: restore button and show inline error.
          submitting = false;
          btn.disabled = false;
          btn.textContent = translate('station_prep.start');

          // Only one error per task.
          const existing = detailEl.querySelector('.station-prep__start-error');
          if (existing) existing.remove();

          const errEl = document.createElement('p');
          errEl.className = 'station-prep__start-error';
          errEl.setAttribute('role', 'alert');
          errEl.textContent = translate('station_prep.start_error');
          detailEl.appendChild(errEl);
        }
      })
      .catch(() => {
        // Unexpected throw (should not happen — service catches internally).
        if (!section.isConnected) return;
        submitting = false;
        btn.disabled = false;
        btn.textContent = translate('station_prep.start');
      });
  });

  return btn;
}

// ── Detail panel builder ──────────────────────────────────────────────

/**
 * Builds the hidden detail panel for a task.
 * Uses only suggestion and log data already loaded by the page.
 * Appends a Start button when the task is not already in progress.
 * No database query. No writes (Start button delegates to startTask).
 *
 * @param {string} panelId
 * @param {object} task             — mutable working copy
 * @param {object|null} suggestion
 * @param {Array<object>|undefined} logs
 * @param {(key: string) => string} translate
 * @param {Function} startTask
 * @param {object} currentUser
 * @param {HTMLElement} section     — root section for isConnected checks
 * @param {(result: object) => void} onSuccess
 * @returns {HTMLElement}
 */
function buildDetailPanel(panelId, task, suggestion, logs, translate, startTask, currentUser, section, onSuccess) {
  const panel = document.createElement('div');
  panel.className = 'station-prep__task-detail';
  panel.id = panelId;
  panel.hidden = true;

  // ── Row builder helper ──
  function addRow(labelKey, valueEl) {
    const row = document.createElement('div');
    row.className = 'station-prep__detail-row';

    const label = document.createElement('span');
    label.className = 'station-prep__detail-label';
    label.textContent = translate(labelKey);

    row.appendChild(label);
    row.appendChild(valueEl);
    panel.appendChild(row);
  }

  // 1. Prepare today — plannedOutput + outputUnit
  const prepTodayVal = document.createElement('span');
  prepTodayVal.className = 'station-prep__detail-value';
  if (suggestion !== null &&
      suggestion.plannedOutput !== null &&
      suggestion.plannedOutput !== undefined) {
    let text = String(suggestion.plannedOutput);
    if (suggestion.outputUnit !== null && suggestion.outputUnit !== undefined) {
      text += ' ' + suggestion.outputUnit;
    }
    prepTodayVal.textContent = text;
  } else {
    prepTodayVal.textContent = translate('station_prep.detail_not_available');
  }
  addRow('station_prep.detail_prepare_today', prepTodayVal);

  // 2. In stock — suggestion.currentStock + stockUnit
  const stockVal = document.createElement('span');
  stockVal.className = 'station-prep__detail-value';
  if (suggestion !== null &&
      suggestion.currentStock !== null &&
      suggestion.currentStock !== undefined) {
    let text = String(suggestion.currentStock);
    if (suggestion.stockUnit !== null && suggestion.stockUnit !== undefined) {
      text += ' ' + suggestion.stockUnit;
    }
    stockVal.textContent = text;
  } else {
    stockVal.textContent = translate('station_prep.detail_not_recorded');
  }
  addRow('station_prep.detail_in_stock', stockVal);

  // 3. Why — reason (non-empty string only)
  const whyVal = document.createElement('span');
  whyVal.className = 'station-prep__detail-value station-prep__detail-value--reason';
  if (suggestion !== null &&
      typeof suggestion.reason === 'string' &&
      suggestion.reason.trim().length > 0) {
    whyVal.textContent = suggestion.reason;
  } else {
    whyVal.textContent = translate('station_prep.detail_no_explanation');
  }
  addRow('station_prep.detail_why_this_amount', whyVal);

  // 4. Made today — today's production log entries
  panel.appendChild(buildMadeToday(logs, translate));

  // 5. Start button — only for tasks not already in progress
  if (task.inProgress !== true) {
    panel.appendChild(buildStartButton({
      task,
      currentUser,
      translate,
      startTask,
      section,
      onSuccess,
      detailEl: panel,
    }));
  }

  return panel;
}

// ── Expand/collapse controller ────────────────────────────────────────

/**
 * Creates a private expand/collapse controller for one component instance.
 * Tracks the currently open panel. Expansion state lives in closure only.
 * No storage. No window writes.
 *
 * @returns {{ toggle: (button: HTMLButtonElement, panelId: string, taskName: string, translate: Function) => void }}
 */
function createExpandController() {
  // { button, panelId } of the currently open task, or null.
  let current = null;

  function collapse(btn, panelId) {
    const panel = document.getElementById(panelId);
    if (panel) panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    // Update chevron class
    const chevron = btn.querySelector('.station-prep__chevron');
    if (chevron) chevron.classList.remove('station-prep__chevron--open');
  }

  return {
    toggle(button, panelId, taskName, translate) {
      const isOpen = button.getAttribute('aria-expanded') === 'true';

      // Close the currently open task (if different).
      if (current && current.panelId !== panelId) {
        collapse(current.button, current.panelId);
        current = null;
      }

      if (isOpen) {
        // Collapse this task.
        collapse(button, panelId);
        current = null;
        button.setAttribute('aria-label',
          translate('station_prep.expand_details').replace('{name}', taskName));
      } else {
        // Expand this task.
        const panel = document.getElementById(panelId);
        if (panel) panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-label',
          translate('station_prep.collapse_details').replace('{name}', taskName));
        const chevron = button.querySelector('.station-prep__chevron');
        if (chevron) chevron.classList.add('station-prep__chevron--open');
        current = { button, panelId };
      }
    },
  };
}

// ── Task row builder ──────────────────────────────────────────────────

function buildTaskRow(task, suggestion, logs, translate, expandController, panelId, startTask, currentUser, section, onSuccess) {
  const item = document.createElement('li');
  item.className = 'station-prep__task';

  // ── Top row: name + expand button ──
  const topRow = document.createElement('div');
  topRow.className = 'station-prep__task-top';

  const nameEl = document.createElement('span');
  nameEl.className = 'station-prep__task-name';
  nameEl.textContent = task.name;

  // Expand/collapse button
  const expandBtn = document.createElement('button');
  expandBtn.className = 'station-prep__expand-btn';
  expandBtn.type = 'button';
  expandBtn.setAttribute('aria-expanded', 'false');
  expandBtn.setAttribute('aria-controls', panelId);
  expandBtn.setAttribute('aria-label',
    translate('station_prep.expand_details').replace('{name}', task.name));

  const chevron = document.createElement('span');
  chevron.className = 'station-prep__chevron';
  chevron.textContent = '\u203a'; // ›
  chevron.setAttribute('aria-hidden', 'true');
  expandBtn.appendChild(chevron);

  expandBtn.addEventListener('click', () => {
    expandController.toggle(expandBtn, panelId, task.name, translate);
  });

  topRow.appendChild(nameEl);
  topRow.appendChild(expandBtn);

  // ── Meta row: status pill + qty + state ──
  const metaRow = document.createElement('div');
  metaRow.className = 'station-prep__task-meta';

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

  metaRow.appendChild(botStatusEl);
  if (qtyEl.textContent.length > 0) metaRow.appendChild(qtyEl);
  metaRow.appendChild(stateEl);

  // ── Detail panel (hidden by default) ──
  const detailPanel = buildDetailPanel(panelId, task, suggestion, logs, translate, startTask, currentUser, section, onSuccess);

  item.appendChild(topRow);
  item.appendChild(metaRow);
  item.appendChild(detailPanel);

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
 * @param {object} expandController
 * @param {{ nextId: () => string }} idGen
 * @returns {HTMLElement|null}
 */
function buildGroup(sectionKey, tasks, suggestionsMap, logsMap, translate, expandController, idGen, startTask, currentUser, section, onSuccess) {
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
    const logs = logsMap[task.name] ?? undefined;
    const panelId = idGen.nextId();
    list.appendChild(buildTaskRow(task, suggestion, logs, translate, expandController, panelId, startTask, currentUser, section, onSuccess));
  }

  group.appendChild(headingRow);
  group.appendChild(list);

  return group;
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Creates the Station Prep page DOM element.
 * Calls fetchTasks, then fetchSuggestions and fetchLogs in parallel,
 * then renders when all three complete.
 *
 * @param {{
 *   stationName:      string | null | undefined,
 *   translate:        (key: string) => string,
 *   fetchTasks:       (station: string) => Promise<{ ok: boolean, tasks: Array }>,
 *   fetchSuggestions: (ids: number[]) => Promise<{ ok: boolean, suggestions: Object }>,
 *   fetchLogs:        (names: string[]) => Promise<{ ok: boolean, logsByTaskName: Object }>,
 *   startTask:        (opts: object) => Promise<object>,
 *   currentUser:      object
 * }} options
 * @returns {HTMLElement}
 */
export function createStationPrep({ stationName, translate, fetchTasks, fetchSuggestions, fetchLogs, startTask, currentUser }) {
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

    const taskIds   = taskResult.tasks.map((t) => t.id);
    const taskNames = taskResult.tasks.map((t) => t.name);

    // Suggestions and logs load in parallel after tasks are available.
    Promise.all([
      fetchSuggestions(taskIds),
      fetchLogs(taskNames),
    ]).then(([sugResult, logResult]) => {
      if (!section.isConnected) return;

      // Suggestion failure → empty map (existing behavior).
      const suggestionsMap = (sugResult.ok && sugResult.suggestions)
        ? sugResult.suggestions
        : {};

      // Log failure → empty map; does not produce a page-level error.
      const logsMap = (logResult.ok && logResult.logsByTaskName)
        ? logResult.logsByTaskName
        : {};

      // Mutable local working copies — do not mutate arrays or objects from fetchTasks.
      // Each object is a shallow copy; only updated task is replaced after successful Start.
      let workingTasks = taskResult.tasks.map((t) => Object.assign({}, t));

      // ── Render function ───────────────────────────────────────────
      // Called on initial load and after any successful Start.
      // Always collapses all panels (new expandController per render).
      function render() {
        content.innerHTML = '';

        // Fresh expand controller — all panels collapsed.
        const expandController = createExpandController();

        // Fresh panel ID generator.
        let idSeq = 0;
        const idGen = {
          nextId() {
            idSeq += 1;
            return 'prep-detail-' + idSeq;
          },
        };

        // Total count.
        const countEl = document.createElement('p');
        countEl.className = 'station-prep__count';
        countEl.textContent = translate('station_prep.task_count')
          .replace('{count}', String(workingTasks.length));
        content.appendChild(countEl);

        // Sort then group using current working copies.
        const ordered = sortedTasks(workingTasks, suggestionsMap);
        const groups  = groupedTasks(ordered, suggestionsMap);

        // onSuccess: update only the matching working task, then rerender.
        function onSuccess(result) {
          workingTasks = workingTasks.map((t) => {
            if (t.id !== result.task.id) return t;
            return Object.assign({}, t, {
              inProgress:   result.task.inProgress,
              inProgressAt: result.task.inProgressAt,
              inProgressBy: result.task.inProgressBy,
            });
          });
          if (section.isConnected) render();
        }

        // Render non-empty sections in approved order.
        for (const key of SECTION_KEYS) {
          const groupEl = buildGroup(key, groups[key], suggestionsMap, logsMap, translate, expandController, idGen, startTask, currentUser, section, onSuccess);
          if (groupEl) content.appendChild(groupEl);
        }
      }

      render();
    });
  });

  return section;
}

