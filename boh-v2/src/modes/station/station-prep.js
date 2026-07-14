// BOH OS v2 — Station Prep page component
// Task 004B: read-only list of active prep tasks for the user's station.
// Task 004D: merges bot suggestions into each task row.
// Task 004E: adds data-suggestion-status attribute for CSS styling.
// Task 004F: operational sorting by suggestion priority then name ascending.
// Task 004G: groups sorted tasks into five priority sections.
// Task 004H: collapsible task detail panel (expand/collapse, no new DB query).
// Task 004K: shows today's production logs inside each expanded task detail.
// Task 004M: Start button inside expanded detail; connects to startPrepTask service.
// Task 004P: Complete button for in-progress tasks; mounts Complete Prep form in expanded detail.
// Task 004Q: Complete Prep form connected to completePrepTask service; local state updated on success.
// Task 004S: loads recent physical counts in parallel; displays Last physical count in expanded detail.
// Task 004V: Count button in every expanded detail; mounts prep-count form; connects to savePrepCount.
// Task 004X: reconcileCount called after saveCount when count exists; local count updated with reconciliation fields.
// Task 004Y: WIP detail section shown inside expanded panel for in-progress tasks (inProgress === true).
// Task 004Z: previous-shift warning inside WIP section when elapsed >= 480 minutes.
// Returns an HTMLElement immediately; loads data asynchronously.
// Task 004AI: canChooseStation, fetchStations, onStationSelect injected for admin selector.
// No router import. No app-state import. No Supabase import. No window writes.

import { createCompletePrepForm } from '../../components/prep/complete-prep-form.js';
import { createPrepCountForm } from '../../components/prep/prep-count-form.js';
import { createStationSelector } from '../../components/station/station-selector.js';

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

const SECTION_KEYS = [
  'do_first',
  'do_today',
  'check',
  'looks_good',
  'in_progress',
];

const SECTION_LABEL_KEY = {
  do_first:    'station_prep.section_do_first',
  do_today:    'station_prep.section_do_today',
  check:       'station_prep.section_check',
  looks_good:  'station_prep.section_looks_good',
  in_progress: 'station_prep.section_in_progress',
};

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

function formatLocalTime(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ── Made today section builder ────────────────────────────────────────

function buildMadeToday(logs, translate) {
  const section = document.createElement('div');
  section.className = 'station-prep__detail-made-today';

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

  for (const log of logs) {
    const card = document.createElement('div');
    card.className = 'station-prep__log-entry';

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

    const userEl = document.createElement('span');
    userEl.className = 'station-prep__log-user';
    if (typeof log.userName === 'string' && log.userName.trim().length > 0) {
      userEl.textContent = log.userName;
    } else {
      userEl.textContent = translate('station_prep.detail_user_not_recorded');
    }

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

// ── Last physical count section builder ──────────────────────────────

function buildLastPhysicalCount(count, translate) {
  const section = document.createElement('div');
  section.className = 'station-prep__detail-last-count';

  const sectionLabel = document.createElement('span');
  sectionLabel.className = 'station-prep__detail-label';
  sectionLabel.textContent = translate('station_prep.detail_last_physical_count');
  section.appendChild(sectionLabel);

  if (!count) {
    const empty = document.createElement('span');
    empty.className = 'station-prep__detail-value';
    empty.textContent = translate('station_prep.detail_no_recent_count');
    section.appendChild(empty);
    return section;
  }

  function addRow(labelText, valueEl) {
    const row = document.createElement('div');
    row.className = 'station-prep__detail-row';
    const label = document.createElement('span');
    label.className = 'station-prep__detail-label';
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(valueEl);
    section.appendChild(row);
  }

  const qtyEl = document.createElement('span');
  qtyEl.className = 'station-prep__detail-value';
  if (count.countedQuantity !== null && count.countedQuantity !== undefined) {
    let text = String(count.countedQuantity);
    if (count.unit !== null && count.unit !== undefined) {
      text += ' ' + count.unit;
    }
    qtyEl.textContent = text;
  } else {
    qtyEl.textContent = translate('station_prep.detail_quantity_not_recorded');
  }
  addRow(translate('station_prep.detail_prepare_today'), qtyEl);

  const byEl = document.createElement('span');
  byEl.className = 'station-prep__detail-value';
  if (typeof count.countedBy === 'string' && count.countedBy.trim().length > 0) {
    byEl.textContent = count.countedBy;
  } else {
    byEl.textContent = translate('station_prep.detail_user_not_recorded');
  }
  addRow(translate('station_prep.detail_counted_by'), byEl);

  const timeEl = document.createElement('span');
  timeEl.className = 'station-prep__detail-value';
  const formattedTime = formatLocalTime(count.countedAt);
  timeEl.textContent = formattedTime !== null
    ? formattedTime
    : translate('station_prep.detail_time_not_available');
  addRow(translate('station_prep.detail_counted_at'), timeEl);

  if (typeof count.reconcileStatus === 'string' && count.reconcileStatus.length > 0) {
    const rsEl = document.createElement('span');
    rsEl.className = 'station-prep__detail-value';
    rsEl.textContent = count.reconcileStatus;
    addRow(translate('station_prep.detail_reconciliation'), rsEl);
  }

  if (count.reconciledQuantity !== null && count.reconciledQuantity !== undefined) {
    const rqEl = document.createElement('span');
    rqEl.className = 'station-prep__detail-value';
    let rqText = String(count.reconciledQuantity);
    if (count.unit !== null && count.unit !== undefined) {
      rqText += ' ' + count.unit;
    }
    rqEl.textContent = rqText;
    addRow(translate('station_prep.detail_reconciled_quantity'), rqEl);
  }

  if (typeof count.reconciledNote === 'string' && count.reconciledNote.length > 0) {
    const rnEl = document.createElement('span');
    rnEl.className = 'station-prep__detail-value station-prep__detail-value--note';
    rnEl.textContent = count.reconciledNote;
    addRow(translate('station_prep.detail_reconciliation_note'), rnEl);
  }

  return section;
}

// ── Start button builder ──────────────────────────────────────────────

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

  let submitting = false;

  btn.addEventListener('click', () => {
    if (submitting || !canStart) return;
    submitting = true;

    const prevErr = detailEl.querySelector('.station-prep__start-error');
    if (prevErr) prevErr.remove();

    btn.disabled = true;
    btn.textContent = translate('station_prep.starting');

    startTask({ prepTaskId: task.id, startedBy: userName })
      .then((result) => {
        if (!section.isConnected) return;
        if (result.ok) {
          onSuccess(result);
        } else {
          submitting = false;
          btn.disabled = false;
          btn.textContent = translate('station_prep.start');
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
        if (!section.isConnected) return;
        submitting = false;
        btn.disabled = false;
        btn.textContent = translate('station_prep.start');
      });
  });

  return btn;
}

// ── Log sort helper ───────────────────────────────────────────────────

function sortedLogs(logs) {
  return logs.slice().sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt) : null;
    const db = b.createdAt ? new Date(b.createdAt) : null;
    const aValid = da && !isNaN(da.getTime());
    const bValid = db && !isNaN(db.getTime());
    if (aValid && bValid) return da.getTime() - db.getTime();
    if (aValid) return -1;
    if (bValid) return 1;
    return 0;
  });
}

// ── Complete button builder ───────────────────────────────────────────

/**
 * Opening Complete removes any open Count form.
 * countFormRef: { container, btn } — the Count button/container for this detail.
 */
function buildCompleteButton({ task, currentUser, translate, completeTask, section, onCompleteSuccess, detailEl, countFormRef }) {
  const userName = (currentUser && typeof currentUser.name === 'string')
    ? currentUser.name.trim()
    : '';
  const canComplete = userName.length > 0;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'station-prep__complete-btn';
  btn.textContent = translate('station_prep.complete');
  if (!canComplete) btn.disabled = true;

  let formContainer = null;
  let submitting = false;

  function clearFeedback() {
    if (!formContainer) return;
    const prev = formContainer.querySelector(
      '.station-prep__complete-submitting, .station-prep__complete-error'
    );
    if (prev) prev.remove();
  }

  function setFormDisabled(disabled) {
    if (!formContainer) return;
    formContainer.querySelectorAll('input, button').forEach((el) => {
      el.disabled = disabled;
    });
  }

  function showSubmitting() {
    clearFeedback();
    const el = document.createElement('p');
    el.className = 'station-prep__complete-submitting';
    el.setAttribute('role', 'status');
    el.textContent = translate('station_prep.completing');
    formContainer.appendChild(el);
  }

  function showError(msgKey) {
    clearFeedback();
    const el = document.createElement('p');
    el.className = 'station-prep__complete-error';
    el.setAttribute('role', 'alert');
    el.textContent = translate(msgKey);
    formContainer.appendChild(el);
  }

  function removeForm() {
    if (formContainer && formContainer.parentNode) {
      formContainer.remove();
    }
    formContainer = null;
    submitting = false;
    btn.hidden = false;
  }

  btn.addEventListener('click', () => {
    if (!canComplete) return;

    // Remove any open Count form and its feedback.
    if (countFormRef.container && countFormRef.container.parentNode) {
      countFormRef.container.remove();
      countFormRef.container = null;
    }
    const prevCountFb = detailEl.querySelector(
      '.station-prep__count-submitting, .station-prep__count-error'
    );
    if (prevCountFb) prevCountFb.remove();
    if (countFormRef.btn) countFormRef.btn.hidden = false;

    if (formContainer && formContainer.parentNode) {
      formContainer.remove();
    }
    submitting = false;
    btn.hidden = true;

    const form = createCompletePrepForm({
      taskName:    task.name,
      defaultUnit: task.unit ?? null,
      translate,

      onConfirm: ({ quantity, unit }) => {
        if (submitting) return;
        submitting = true;
        clearFeedback();
        setFormDisabled(true);
        showSubmitting();

        completeTask({
          prepTask: {
            id:           task.id,
            name:         task.name,
            station:      task.station,
            currentStock: task.currentStock,
            inProgressAt: task.inProgressAt,
          },
          quantity,
          unit,
          completedBy: userName,
        }).then((result) => {
          if (!section.isConnected) return;
          if (result.ok) {
            onCompleteSuccess({ ok: true, log: result.log, task: result.task });
          } else if (result.log !== null) {
            submitting = false;
            setFormDisabled(false);
            clearFeedback();
            onCompleteSuccess({ ok: false, log: result.log, task: null });
            showError('station_prep.complete_partial_error');
          } else {
            submitting = false;
            setFormDisabled(false);
            clearFeedback();
            showError('station_prep.complete_error');
          }
        }).catch(() => {
          if (!section.isConnected) return;
          submitting = false;
          setFormDisabled(false);
          clearFeedback();
          showError('station_prep.complete_error');
        });
      },

      onCancel: () => { removeForm(); },
    });

    formContainer = document.createElement('div');
    formContainer.className = 'station-prep__complete-form-container';
    formContainer.appendChild(form);
    detailEl.appendChild(formContainer);
  });

  return btn;
}

// ── Count button builder ──────────────────────────────────────────────

/**
 * Count button appears for every task (in-progress or not).
 * Opening Count removes any open Complete form.
 * completeFormRef: { container, btn } — the Complete form/button for this detail.
 * Returns { btn, containerRef } so the detail builder can wire cross-references.
 */
function buildCountButton({ task, currentUser, translate, saveCount, reconcileCount, section, onCountSuccess, detailEl, completeFormRef }) {
  const userName = (currentUser && typeof currentUser.name === 'string')
    ? currentUser.name.trim()
    : '';
  const canCount = userName.length > 0;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'station-prep__count-btn';
  btn.textContent = translate('station_prep.count');
  if (!canCount) btn.disabled = true;

  // containerRef is shared with the detail builder so Complete can reach this.
  const containerRef = { container: null };

  let submitting = false;

  function clearCountFeedback() {
    const prev = detailEl.querySelector(
      '.station-prep__count-submitting, .station-prep__count-error'
    );
    if (prev) prev.remove();
  }

  function setCountFormDisabled(disabled) {
    if (!containerRef.container) return;
    containerRef.container.querySelectorAll('input, button').forEach((el) => {
      el.disabled = disabled;
    });
  }

  function showCountSubmitting(msgKey) {
    clearCountFeedback();
    const el = document.createElement('p');
    el.className = 'station-prep__count-submitting';
    el.setAttribute('role', 'status');
    el.textContent = translate(msgKey || 'station_prep.count_saving');
    if (containerRef.container) containerRef.container.appendChild(el);
  }

  function updateCountSubmitting(msgKey) {
    const existing = containerRef.container
      ? containerRef.container.querySelector('.station-prep__count-submitting')
      : null;
    if (existing) {
      existing.textContent = translate(msgKey);
    } else {
      showCountSubmitting(msgKey);
    }
  }

  function showCountError(msgKey) {
    clearCountFeedback();
    const el = document.createElement('p');
    // Partial-reconciliation-failure gets an additional modifier class for
    // visual distinction from the simple stock-update-failure message.
    el.className = msgKey === 'station_prep.count_partial_reconciliation_error'
      ? 'station-prep__count-error station-prep__count-error--reconcile'
      : 'station-prep__count-error';
    el.setAttribute('role', 'alert');
    el.textContent = translate(msgKey);
    if (containerRef.container) containerRef.container.appendChild(el);
  }

  function removeCountForm() {
    clearCountFeedback();
    if (containerRef.container && containerRef.container.parentNode) {
      containerRef.container.remove();
    }
    containerRef.container = null;
    submitting = false;
    btn.hidden = false;
  }

  btn.addEventListener('click', () => {
    if (!canCount) return;

    // Remove any open Complete form and its feedback.
    if (completeFormRef.container && completeFormRef.container.parentNode) {
      completeFormRef.container.remove();
      completeFormRef.container = null;
    }
    const prevCompleteFb = detailEl.querySelector(
      '.station-prep__complete-submitting, .station-prep__complete-error'
    );
    if (prevCompleteFb) prevCompleteFb.remove();
    if (completeFormRef.btn) completeFormRef.btn.hidden = false;

    // Remove previous Count form + feedback.
    clearCountFeedback();
    if (containerRef.container && containerRef.container.parentNode) {
      containerRef.container.remove();
    }
    submitting = false;
    btn.hidden = true;

    const form = createPrepCountForm({
      taskName:    task.name,
      defaultUnit: task.unit ?? null,
      translate,

      onConfirm: ({ countedQuantity, unit }) => {
        if (submitting) return;
        submitting = true;
        // Remove page-level pending notice from any prior successful Count.
        const prevPending = section.querySelector('.station-prep__reconcile-pending');
        if (prevPending) prevPending.remove();
        clearCountFeedback();
        setCountFormDisabled(true);
        showCountSubmitting();

        saveCount({
          prepTaskId:     task.id,
          countedQuantity,
          unit,
          countedBy:      userName,
        }).then((result) => {
          if (!section.isConnected) return;

          // Full failure — no count was inserted.
          if (result.count === null || result.count === undefined) {
            submitting = false;
            setCountFormDisabled(false);
            clearCountFeedback();
            showCountError('station_prep.count_error');
            return;
          }

          // Count was inserted (full success or partial write failure).
          // Switch status message and call reconciler — form stays disabled.
          updateCountSubmitting('station_prep.count_reconciling');

          reconcileCount({
            prepTaskId: result.count.prepTaskId,
            countId:    result.count.id,
          }).then((reconcileResult) => {
            if (!section.isConnected) return;

            const saveOk = result.ok === true;

            // Notify parent with both saveCount and reconcileCount results.
            onCountSuccess({
              saveOk,
              saveTask:     result.task,    // non-null only when saveOk === true
              count:        result.count,   // never mutated
              reconcileOk:  reconcileResult.ok,
              reconciliation: reconcileResult.reconciliation,
              // Ref to form helpers for partial-path DOM update.
              _formHelpers: {
                submitting:       () => { submitting = false; },
                enableForm:       () => setCountFormDisabled(false),
                clearFeedback:    () => clearCountFeedback(),
                showError:        (key) => showCountError(key),
                containerRef,
                detailEl,
              },
            });
          }).catch(() => {
            if (!section.isConnected) return;
            // Reconciler threw unexpectedly — treat as reconciliation failure.
            const saveOk = result.ok === true;
            onCountSuccess({
              saveOk,
              saveTask:       result.task,
              count:          result.count,
              reconcileOk:    false,
              reconciliation: null,
              _formHelpers: {
                submitting:    () => { submitting = false; },
                enableForm:    () => setCountFormDisabled(false),
                clearFeedback: () => clearCountFeedback(),
                showError:     (key) => showCountError(key),
                containerRef,
                detailEl,
              },
            });
          });
        }).catch(() => {
          if (!section.isConnected) return;
          submitting = false;
          setCountFormDisabled(false);
          clearCountFeedback();
          showCountError('station_prep.count_error');
        });
      },

      onCancel: () => { removeCountForm(); },
    });

    const newContainer = document.createElement('div');
    newContainer.className = 'station-prep__count-form-container';
    newContainer.appendChild(form);
    containerRef.container = newContainer;
    detailEl.appendChild(newContainer);
  });

  return { btn, containerRef };
}

// ── WIP resolution panel builder (Task 004AA, updated Task 004AB, 004AC, 004AF) ─

function buildWipResolutionPanel({ translate, task, currentUser, startTask, onSuccess, passTask, completeTask, section, onCompleteSuccess, completeFormRef, countFormRef, detailEl }) {
  const panel = document.createElement('div');
  panel.className = 'station-prep__wip-resolution';

  const panelHeading = document.createElement('h4');
  panelHeading.className = 'station-prep__wip-resolution-heading';
  panelHeading.textContent = translate('station_prep.wip_resolution_title');
  panel.appendChild(panelHeading);

  // ── "I finished it" — connected to existing Complete Prep form flow ──
  const userName = (currentUser && typeof currentUser.name === 'string')
    ? currentUser.name.trim()
    : '';
  const canFinish = userName.length > 0;

  const finishedBtn = document.createElement('button');
  finishedBtn.type = 'button';
  finishedBtn.className = 'station-prep__wip-resolution-btn station-prep__wip-resolution-btn--finished';
  finishedBtn.textContent = translate('station_prep.wip_resolution_finished');
  if (!canFinish) finishedBtn.disabled = true;

  let finishedFormContainer = null;
  let finishedSubmitting = false;

  function clearFinishedFeedback() {
    if (!finishedFormContainer) return;
    const prev = finishedFormContainer.querySelector(
      '.station-prep__complete-submitting, .station-prep__complete-error'
    );
    if (prev) prev.remove();
  }

  function setFinishedFormDisabled(disabled) {
    if (!finishedFormContainer) return;
    finishedFormContainer.querySelectorAll('input, button').forEach(function (el) {
      el.disabled = disabled;
    });
  }

  function showFinishedSubmitting() {
    clearFinishedFeedback();
    const el = document.createElement('p');
    el.className = 'station-prep__complete-submitting';
    el.setAttribute('role', 'status');
    el.textContent = translate('station_prep.completing');
    finishedFormContainer.appendChild(el);
  }

  function showFinishedError(msgKey) {
    clearFinishedFeedback();
    const el = document.createElement('p');
    el.className = 'station-prep__complete-error';
    el.setAttribute('role', 'alert');
    el.textContent = translate(msgKey);
    finishedFormContainer.appendChild(el);
  }

  function removeFinishedForm() {
    if (finishedFormContainer && finishedFormContainer.parentNode) {
      finishedFormContainer.remove();
    }
    finishedFormContainer = null;
    finishedSubmitting = false;
    finishedBtn.hidden = false;
    // Restore the normal Complete button if it exists.
    if (completeFormRef.btn) completeFormRef.btn.hidden = false;
  }

  finishedBtn.addEventListener('click', function () {
    if (!canFinish) return;

    // Remove any open Count form and Count feedback.
    if (countFormRef.container && countFormRef.container.parentNode) {
      countFormRef.container.remove();
      countFormRef.container = null;
    }
    const prevCountFb = detailEl.querySelector(
      '.station-prep__count-submitting, .station-prep__count-error'
    );
    if (prevCountFb) prevCountFb.remove();
    if (countFormRef.btn) countFormRef.btn.hidden = false;

    // Remove any open Complete form and Complete feedback.
    if (completeFormRef.container && completeFormRef.container.parentNode) {
      completeFormRef.container.remove();
      completeFormRef.container = null;
    }
    const prevCompleteFb = detailEl.querySelector(
      '.station-prep__complete-submitting, .station-prep__complete-error'
    );
    if (prevCompleteFb) prevCompleteFb.remove();
    if (completeFormRef.btn) completeFormRef.btn.hidden = true;

    finishedBtn.hidden = true;

    const form = createCompletePrepForm({
      taskName:    task.name,
      defaultUnit: task.unit ?? null,
      translate,

      onConfirm: function ({ quantity, unit }) {
        if (finishedSubmitting) return;
        finishedSubmitting = true;
        clearFinishedFeedback();
        setFinishedFormDisabled(true);
        showFinishedSubmitting();

        completeTask({
          prepTask: {
            id:           task.id,
            name:         task.name,
            station:      task.station,
            currentStock: task.currentStock,
            inProgressAt: task.inProgressAt,
          },
          quantity,
          unit,
          completedBy: userName,
        }).then(function (result) {
          if (!section.isConnected) return;
          if (result.ok) {
            onCompleteSuccess({ ok: true, log: result.log, task: result.task });
          } else if (result.log !== null) {
            finishedSubmitting = false;
            setFinishedFormDisabled(false);
            clearFinishedFeedback();
            onCompleteSuccess({ ok: false, log: result.log, task: null });
            showFinishedError('station_prep.complete_partial_error');
          } else {
            finishedSubmitting = false;
            setFinishedFormDisabled(false);
            clearFinishedFeedback();
            showFinishedError('station_prep.complete_error');
          }
        }).catch(function () {
          if (!section.isConnected) return;
          finishedSubmitting = false;
          setFinishedFormDisabled(false);
          clearFinishedFeedback();
          showFinishedError('station_prep.complete_error');
        });
      },

      onCancel: function () { removeFinishedForm(); },
    });

    finishedFormContainer = document.createElement('div');
    finishedFormContainer.className = 'station-prep__complete-form-container station-prep__wip-resolution-form';
    finishedFormContainer.appendChild(form);
    detailEl.appendChild(finishedFormContainer);
  });

  panel.appendChild(finishedBtn);

  // ── "Continue this prep" — connected to existing startTask service ──
  const canContinue = userName.length > 0;

  const continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.className = 'station-prep__wip-resolution-btn station-prep__wip-resolution-btn--continue';
  continueBtn.textContent = translate('station_prep.wip_resolution_continue');
  if (!canContinue) continueBtn.disabled = true;

  // Disable Continue while a Complete or Count form is open.
  // Uses the shared mutable refs — evaluated at click time (closure).
  function isContinueBlocked() {
    return (completeFormRef.container !== null) || (countFormRef.container !== null);
  }

  let continueSubmitting = false;

  function clearContinueError() {
    const prev = panel.querySelector('.station-prep__wip-continue-error');
    if (prev) prev.remove();
  }

  continueBtn.addEventListener('click', function () {
    if (!canContinue) return;
    if (continueSubmitting) return;
    if (isContinueBlocked()) return;

    continueSubmitting = true;
    continueBtn.disabled = true;
    clearContinueError();
    continueBtn.textContent = translate('station_prep.wip_resolution_continuing');

    startTask({
      prepTaskId: task.id,
      startedBy:  userName,
    }).then(function (result) {
      if (!section.isConnected) return;
      if (result.ok) {
        onSuccess(result);
      } else {
        continueSubmitting = false;
        continueBtn.disabled = false;
        continueBtn.textContent = translate('station_prep.wip_resolution_continue');
        clearContinueError();
        const errEl = document.createElement('p');
        errEl.className = 'station-prep__wip-continue-error';
        errEl.setAttribute('role', 'alert');
        errEl.textContent = translate('station_prep.wip_resolution_continue_error');
        panel.appendChild(errEl);
      }
    }).catch(function () {
      if (!section.isConnected) return;
      continueSubmitting = false;
      continueBtn.disabled = false;
      continueBtn.textContent = translate('station_prep.wip_resolution_continue');
      clearContinueError();
      const errEl = document.createElement('p');
      errEl.className = 'station-prep__wip-continue-error';
      errEl.setAttribute('role', 'alert');
      errEl.textContent = translate('station_prep.wip_resolution_continue_error');
      panel.appendChild(errEl);
    });
  });

  panel.appendChild(continueBtn);

  // ── "Pass to this shift" — connected to passPrepToShift service ──
  const canPass = userName.length > 0;

  const passBtn = document.createElement('button');
  passBtn.type = 'button';
  passBtn.className = 'station-prep__wip-resolution-btn station-prep__wip-resolution-btn--pass';
  passBtn.textContent = translate('station_prep.wip_resolution_pass_shift');
  if (!canPass) passBtn.disabled = true;

  // Disable Pass while a Complete or Count form is open.
  function isPassBlocked() {
    return (completeFormRef.container !== null) || (countFormRef.container !== null);
  }

  // Once passed successfully, the button stays disabled for this DOM lifecycle.
  let passDone = false;
  let passSubmitting = false;

  function clearPassFeedback() {
    const prev = panel.querySelector('.station-prep__wip-pass-feedback');
    if (prev) prev.remove();
  }

  passBtn.addEventListener('click', function () {
    if (!canPass) return;
    if (passSubmitting) return;
    if (passDone) return;
    if (isPassBlocked()) return;

    passSubmitting = true;
    passBtn.disabled = true;
    clearPassFeedback();
    passBtn.textContent = translate('station_prep.wip_resolution_passing');

    passTask({
      prepTaskId: task.id,
      taskName:   task.name,
      station:    task.station,
      startedBy:  task.inProgressBy,
      startedAt:  task.inProgressAt,
      passedBy:   userName,
    }).then(function (result) {
      if (!section.isConnected) return;
      if (result.ok) {
        passDone = true;
        passBtn.textContent = translate('station_prep.wip_resolution_pass_shift');
        // Button stays disabled (passDone = true prevents re-entry).
        clearPassFeedback();
        const okEl = document.createElement('p');
        okEl.className = 'station-prep__wip-pass-feedback';
        okEl.setAttribute('role', 'status');
        okEl.textContent = translate('station_prep.wip_resolution_pass_success');
        panel.appendChild(okEl);
      } else {
        passSubmitting = false;
        passBtn.disabled = false;
        passBtn.textContent = translate('station_prep.wip_resolution_pass_shift');
        clearPassFeedback();
        const errEl = document.createElement('p');
        errEl.className = 'station-prep__wip-pass-feedback';
        errEl.setAttribute('role', 'alert');
        errEl.textContent = translate('station_prep.wip_resolution_pass_error');
        panel.appendChild(errEl);
      }
    }).catch(function () {
      if (!section.isConnected) return;
      passSubmitting = false;
      passBtn.disabled = false;
      passBtn.textContent = translate('station_prep.wip_resolution_pass_shift');
      clearPassFeedback();
      const errEl = document.createElement('p');
      errEl.className = 'station-prep__wip-pass-feedback';
      errEl.setAttribute('role', 'alert');
      errEl.textContent = translate('station_prep.wip_resolution_pass_error');
      panel.appendChild(errEl);
    });
  });

  panel.appendChild(passBtn);

  return panel;
}

// ── WIP section builder (Task 004Y, updated Task 004Z, 004AA, 004AC, 004AF) ─

const PREVIOUS_SHIFT_MINUTES = 480;

function buildWipSection(task, translate, currentUser, startTask, onSuccess, passTask, completeTask, section, onCompleteSuccess, completeFormRef, countFormRef, detailEl) {
  const section = document.createElement('div');
  section.className = 'station-prep__detail-wip';

  const heading = document.createElement('h3');
  heading.className = 'station-prep__detail-wip-heading';
  heading.textContent = translate('station_prep.detail_work_in_progress');
  section.appendChild(heading);

  // Parse timestamp and current time once — reused for elapsed display and
  // previous-shift detection. No second Date construction.
  const startedAt = task.inProgressAt ? new Date(task.inProgressAt) : null;
  const startedAtValid = startedAt !== null && !isNaN(startedAt.getTime());
  const now = new Date();
  const elapsedMinutes = startedAtValid
    ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000))
    : null;

  // Previous-shift warning — appears after heading, before Started by.
  // Shown only when elapsed >= PREVIOUS_SHIFT_MINUTES and timestamp is valid.
  if (startedAtValid && elapsedMinutes >= PREVIOUS_SHIFT_MINUTES) {
    const warning = document.createElement('p');
    warning.className = 'station-prep__detail-wip-previous-shift';
    warning.setAttribute('role', 'status');
    warning.textContent = translate('station_prep.detail_previous_shift');
    section.appendChild(warning);
  }

  function addRow(labelKey, valueText) {
    const row = document.createElement('div');
    row.className = 'station-prep__detail-row station-prep__detail-wip-row';
    const label = document.createElement('span');
    label.className = 'station-prep__detail-label';
    label.textContent = translate(labelKey);
    const value = document.createElement('span');
    value.className = 'station-prep__detail-value';
    value.textContent = valueText;
    row.appendChild(label);
    row.appendChild(value);
    section.appendChild(row);
  }

  // Started by
  const startedBy = (typeof task.inProgressBy === 'string' && task.inProgressBy.trim().length > 0)
    ? task.inProgressBy.trim()
    : translate('station_prep.detail_user_not_recorded');
  addRow('station_prep.detail_started_by', startedBy);

  // Started at — reuses startedAt already parsed above.
  const startedAtText = startedAtValid
    ? startedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : translate('station_prep.detail_time_not_available');
  addRow('station_prep.detail_started_at', startedAtText);

  // Elapsed — reuses elapsedMinutes already calculated above.
  let elapsedText;
  if (startedAtValid) {
    if (elapsedMinutes < 60) {
      elapsedText = elapsedMinutes + ' min';
    } else {
      const hours = Math.floor(elapsedMinutes / 60);
      const minutes = elapsedMinutes % 60;
      elapsedText = hours + ' hr ' + minutes + ' min';
    }
  } else {
    elapsedText = translate('station_prep.detail_elapsed_not_available');
  }
  addRow('station_prep.detail_elapsed', elapsedText);

  // Resolution panel — appears after Elapsed, only for previous-shift WIP.
  // Reuses startedAtValid and elapsedMinutes already calculated above.
  if (startedAtValid && elapsedMinutes >= PREVIOUS_SHIFT_MINUTES) {
    section.appendChild(buildWipResolutionPanel({ translate, task, currentUser, startTask, onSuccess, passTask, completeTask, section, onCompleteSuccess, completeFormRef, countFormRef, detailEl }));
  }

  return section;
}

// ── Detail panel builder ──────────────────────────────────────────────

function buildDetailPanel(panelId, task, suggestion, logs, count, translate, startTask, passTask, currentUser, section, onSuccess, completeTask, onCompleteSuccess, saveCount, reconcileCount, onCountSuccess) {
  const panel = document.createElement('div');
  panel.className = 'station-prep__task-detail';
  panel.id = panelId;
  panel.hidden = true;

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

  // 1. Prepare today
  const prepTodayVal = document.createElement('span');
  prepTodayVal.className = 'station-prep__detail-value';
  if (suggestion !== null && suggestion.plannedOutput !== null && suggestion.plannedOutput !== undefined) {
    let text = String(suggestion.plannedOutput);
    if (suggestion.outputUnit !== null && suggestion.outputUnit !== undefined) {
      text += ' ' + suggestion.outputUnit;
    }
    prepTodayVal.textContent = text;
  } else {
    prepTodayVal.textContent = translate('station_prep.detail_not_available');
  }
  addRow('station_prep.detail_prepare_today', prepTodayVal);

  // 2. In stock — always from suggestion, never replaced by physical count
  const stockVal = document.createElement('span');
  stockVal.className = 'station-prep__detail-value';
  if (suggestion !== null && suggestion.currentStock !== null && suggestion.currentStock !== undefined) {
    let text = String(suggestion.currentStock);
    if (suggestion.stockUnit !== null && suggestion.stockUnit !== undefined) {
      text += ' ' + suggestion.stockUnit;
    }
    stockVal.textContent = text;
  } else {
    stockVal.textContent = translate('station_prep.detail_not_recorded');
  }
  addRow('station_prep.detail_in_stock', stockVal);

  // 3. Why
  const whyVal = document.createElement('span');
  whyVal.className = 'station-prep__detail-value station-prep__detail-value--reason';
  if (suggestion !== null && typeof suggestion.reason === 'string' && suggestion.reason.trim().length > 0) {
    whyVal.textContent = suggestion.reason;
  } else {
    whyVal.textContent = translate('station_prep.detail_no_explanation');
  }
  addRow('station_prep.detail_why_this_amount', whyVal);

  // 4. Made today
  panel.appendChild(buildMadeToday(logs, translate));

  // 5. Last physical count
  panel.appendChild(buildLastPhysicalCount(count, translate));

  // ── Cross-form coordination refs ──
  // Created before WIP section so the resolution panel's "I finished it"
  // button can coordinate with the normal Complete button and Count form.
  // completeFormRef: Complete button exposes its formContainer here so Count can remove it.
  // countFormRef:    Count button exposes its containerRef here so Complete can remove it.
  const completeFormRef = { container: null, btn: null };
  const countFormRef    = { container: null, btn: null };

  // 6. Work in progress — only for in-progress tasks.
  // Refs passed so the resolution panel can coordinate form state.
  if (task.inProgress === true) {
    panel.appendChild(buildWipSection(task, translate, currentUser, startTask, onSuccess, passTask, completeTask, section, onCompleteSuccess, completeFormRef, countFormRef, panel));
  }

  // 7. Start — non-in-progress only
  if (task.inProgress !== true) {
    panel.appendChild(buildStartButton({ task, currentUser, translate, startTask, section, onSuccess, detailEl: panel }));
  }

  // 7. Complete — in-progress only
  if (task.inProgress === true) {
    const completeBtn = buildCompleteButton({
      task,
      currentUser,
      translate,
      completeTask,
      section,
      onCompleteSuccess,
      detailEl: panel,
      countFormRef,
    });
    completeFormRef.btn = completeBtn;
    panel.appendChild(completeBtn);
  }

  // 8. Count — every task

  const { btn: countBtn, containerRef } = buildCountButton({
    task,
    currentUser,
    translate,
    saveCount,
    reconcileCount,
    section,
    onCountSuccess,
    detailEl: panel,
    completeFormRef,
  });
  // Wire countFormRef so Complete can access Count's container and button.
  countFormRef.btn = countBtn;
  // Proxy container so Complete reads/writes the live value from containerRef.
  Object.defineProperty(countFormRef, 'container', {
    get() { return containerRef.container; },
    set(v) { containerRef.container = v; },
    configurable: true,
  });
  panel.appendChild(countBtn);

  return panel;
}

// ── Expand/collapse controller ────────────────────────────────────────

function createExpandController() {
  let current = null;

  function collapse(btn, panelId) {
    const panel = document.getElementById(panelId);
    if (panel) panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    const chevron = btn.querySelector('.station-prep__chevron');
    if (chevron) chevron.classList.remove('station-prep__chevron--open');
  }

  return {
    toggle(button, panelId, taskName, translate) {
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      if (current && current.panelId !== panelId) {
        collapse(current.button, current.panelId);
        current = null;
      }
      if (isOpen) {
        collapse(button, panelId);
        current = null;
        button.setAttribute('aria-label',
          translate('station_prep.expand_details').replace('{name}', taskName));
      } else {
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

function buildTaskRow(task, suggestion, logs, count, translate, expandController, panelId, startTask, passTask, currentUser, section, onSuccess, completeTask, onCompleteSuccess, saveCount, reconcileCount, onCountSuccess) {
  const item = document.createElement('li');
  item.className = 'station-prep__task';

  const topRow = document.createElement('div');
  topRow.className = 'station-prep__task-top';

  const nameEl = document.createElement('span');
  nameEl.className = 'station-prep__task-name';
  nameEl.textContent = task.name;

  const expandBtn = document.createElement('button');
  expandBtn.className = 'station-prep__expand-btn';
  expandBtn.type = 'button';
  expandBtn.setAttribute('aria-expanded', 'false');
  expandBtn.setAttribute('aria-controls', panelId);
  expandBtn.setAttribute('aria-label',
    translate('station_prep.expand_details').replace('{name}', task.name));

  const chevron = document.createElement('span');
  chevron.className = 'station-prep__chevron';
  chevron.textContent = '\u203a';
  chevron.setAttribute('aria-hidden', 'true');
  expandBtn.appendChild(chevron);

  expandBtn.addEventListener('click', () => {
    expandController.toggle(expandBtn, panelId, task.name, translate);
  });

  topRow.appendChild(nameEl);
  topRow.appendChild(expandBtn);

  const metaRow = document.createElement('div');
  metaRow.className = 'station-prep__task-meta';

  const rawStatus = suggestion ? suggestion.status : null;
  const botStatusEl = document.createElement('span');
  botStatusEl.className = 'station-prep__task-bot-status';
  botStatusEl.dataset.suggestionStatus = suggestionStatusAttr(rawStatus);
  botStatusEl.textContent = translate(suggestionStatusKey(rawStatus));

  const qtyEl = document.createElement('span');
  qtyEl.className = 'station-prep__task-qty';
  if (suggestion !== null && suggestion.plannedOutput !== null && suggestion.plannedOutput !== undefined) {
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

  const detailPanel = buildDetailPanel(panelId, task, suggestion, logs, count, translate, startTask, passTask, currentUser, section, onSuccess, completeTask, onCompleteSuccess, saveCount, reconcileCount, onCountSuccess);

  item.appendChild(topRow);
  item.appendChild(metaRow);
  item.appendChild(detailPanel);

  return item;
}

// ── Section group builder ─────────────────────────────────────────────

function buildGroup(sectionKey, tasks, suggestionsMap, logsMap, countsMap, translate, expandController, idGen, startTask, passTask, currentUser, section, onSuccess, completeTask, onCompleteSuccess, saveCount, reconcileCount, onCountSuccess) {
  if (tasks.length === 0) return null;

  const group = document.createElement('section');
  group.className = 'station-prep__group';
  group.dataset.section = sectionKey;

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

  const list = document.createElement('ul');
  list.className = 'station-prep__list';

  for (const task of tasks) {
    const suggestion = suggestionsMap[task.id] ?? null;
    const logs       = logsMap[task.name] ?? undefined;
    const taskCount  = countsMap[task.id] ?? null;
    const panelId    = idGen.nextId();
    list.appendChild(buildTaskRow(task, suggestion, logs, taskCount, translate, expandController, panelId, startTask, passTask, currentUser, section, onSuccess, completeTask, onCompleteSuccess, saveCount, reconcileCount, onCountSuccess));
  }

  group.appendChild(headingRow);
  group.appendChild(list);

  return group;
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Creates the Station Prep page DOM element.
 *
 * @param {{
 *   stationName:      string | null | undefined,
 *   translate:        (key: string) => string,
 *   fetchTasks:       Function,
 *   fetchSuggestions: Function,
 *   fetchLogs:        Function,
 *   fetchCounts:      Function,
 *   startTask:        Function,
 *   completeTask:     Function,
 *   saveCount:        Function,
 *   reconcileCount:   Function,
 *   passTask:         Function,
 *   currentUser:      object
 * }} options
 * @returns {HTMLElement}
 */
/**
 * Creates the Station Prep page DOM element.
 *
 * @param {{
 *   stationName:      string | null | undefined,
 *   canChooseStation: boolean,
 *   translate:        (key: string) => string,
 *   fetchStations:    () => Promise<{ ok: boolean, stations: string[] }>,
 *   onStationSelect:  (stationName: string) => void,
 *   fetchTasks:       Function,
 *   fetchSuggestions: Function,
 *   fetchLogs:        Function,
 *   fetchCounts:      Function,
 *   startTask:        Function,
 *   completeTask:     Function,
 *   saveCount:        Function,
 *   reconcileCount:   Function,
 *   passTask:         Function,
 *   currentUser:      object
 * }} options
 * @returns {HTMLElement}
 */
export function createStationPrep({ stationName, canChooseStation, translate, fetchStations, onStationSelect, fetchTasks, fetchSuggestions, fetchLogs, fetchCounts, startTask, completeTask, saveCount, reconcileCount, passTask, currentUser }) {
  // ── Selector branch: eligible role, no station yet ────────────────
  const hasStation = typeof stationName === 'string' && stationName.trim().length > 0;
  const showSelector = !hasStation && canChooseStation === true;

  if (showSelector) {
    const section = document.createElement('section');
    section.className = 'station-prep';

    const header = document.createElement('header');
    header.className = 'station-prep__header';

    const title = document.createElement('h1');
    title.className = 'station-prep__title';
    title.textContent = translate('station_prep.title');

    header.appendChild(title);
    section.appendChild(header);

    const content = document.createElement('div');
    content.className = 'station-prep__content';
    section.appendChild(content);

    const loadingEl = document.createElement('p');
    loadingEl.className = 'station-prep__selector-loading';
    loadingEl.textContent = translate('station_selector.loading');
    content.appendChild(loadingEl);

    // Fetch stations exactly once for this component instance.
    // None of the task-related services are called before selection.
    fetchStations().then((result) => {
      if (!section.isConnected) return;
      content.innerHTML = '';

      if (!result.ok) {
        const errEl = document.createElement('p');
        errEl.className = 'station-prep__selector-error';
        errEl.setAttribute('role', 'alert');
        errEl.textContent = translate('station_selector.error');
        content.appendChild(errEl);
        return;
      }

      const selectorEl = createStationSelector({
        stations:  result.stations,
        translate,
        onSelect:  onStationSelect,
      });
      content.appendChild(selectorEl);
    }).catch(() => {
      if (!section.isConnected) return;
      content.innerHTML = '';
      const errEl = document.createElement('p');
      errEl.className = 'station-prep__selector-error';
      errEl.setAttribute('role', 'alert');
      errEl.textContent = translate('station_selector.error');
      content.appendChild(errEl);
    });

    return section;
  }

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

    Promise.all([
      fetchSuggestions(taskIds),
      fetchLogs(taskNames),
      fetchCounts(taskIds),
    ]).then(([sugResult, logResult, countResult]) => {
      if (!section.isConnected) return;

      const suggestionsMap = (sugResult.ok && sugResult.suggestions)
        ? sugResult.suggestions
        : {};

      const logsMap = (logResult.ok && logResult.logsByTaskName)
        ? logResult.logsByTaskName
        : {};

      const fetchedCountsMap = (countResult.ok && countResult.countsByPrepTaskId)
        ? countResult.countsByPrepTaskId
        : {};

      // Mutable local working copies — originals never mutated.
      let workingTasks   = taskResult.tasks.map((t) => Object.assign({}, t));
      let workingLogsMap = Object.assign({}, logsMap);

      // Local copy of counts — shallow-copy each entry so originals are not mutated.
      let workingCountsMap = {};
      for (const [id, cnt] of Object.entries(fetchedCountsMap)) {
        workingCountsMap[id] = Object.assign({}, cnt);
      }

      // suggestionsMap is read-only throughout the page lifecycle.

      function render() {
        content.innerHTML = '';

        const expandController = createExpandController();

        let idSeq = 0;
        const idGen = {
          nextId() {
            idSeq += 1;
            return 'prep-detail-' + idSeq;
          },
        };

        const countEl = document.createElement('p');
        countEl.className = 'station-prep__count';
        countEl.textContent = translate('station_prep.task_count')
          .replace('{count}', String(workingTasks.length));
        content.appendChild(countEl);

        const ordered = sortedTasks(workingTasks, suggestionsMap);
        const groups  = groupedTasks(ordered, suggestionsMap);

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

        function onCompleteSuccess(result) {
          if (result.log) {
            const taskName = result.log.taskName;
            const existing = workingLogsMap[taskName]
              ? workingLogsMap[taskName].slice()
              : [];
            const newLog = Object.assign({}, result.log);
            workingLogsMap = Object.assign({}, workingLogsMap, {
              [taskName]: sortedLogs([...existing, newLog]),
            });
          }
          if (result.ok && result.task) {
            workingTasks = workingTasks.map((t) => {
              if (t.id !== result.task.id) return t;
              return Object.assign({}, t, {
                currentStock: result.task.currentStock,
                needTomorrow: result.task.needTomorrow,
                inProgress:   result.task.inProgress,
                inProgressAt: result.task.inProgressAt,
                inProgressBy: result.task.inProgressBy,
              });
            });
            if (section.isConnected) render();
          }
        }

        function onCountSuccess(result) {
          // result shape (from 004X buildCountButton):
          //   saveOk, saveTask, count, reconcileOk, reconciliation, _formHelpers

          const { saveOk, saveTask, count: savedCount, reconcileOk, reconciliation, _formHelpers } = result;
          const { submitting: resetSubmitting, enableForm, clearFeedback, showError, containerRef: fRef, detailEl: fPanel } = _formHelpers;

          // Build local count — never mutate savedCount or reconciliation.
          const localCount = savedCount ? {
            prepTaskId:         savedCount.prepTaskId,
            countedQuantity:    savedCount.countedQuantity,
            unit:               savedCount.unit,
            countedBy:          savedCount.countedBy,
            countedAt:          savedCount.countedAt,
            expiresAt:          reconcileOk && reconciliation ? (reconciliation.expiresAt          ?? null) : null,
            reconcileStatus:    reconcileOk && reconciliation ? (reconciliation.reconcileStatus    ?? null) : null,
            reconciledQuantity: reconcileOk && reconciliation ? (reconciliation.reconciledQuantity ?? null) : null,
            reconciledNote:     reconcileOk && reconciliation ? (reconciliation.reconciledNote     ?? null) : null,
          } : null;

          // Always store inserted count (if present) — do not mutate original map.
          if (localCount) {
            workingCountsMap = Object.assign({}, workingCountsMap, {
              [savedCount.prepTaskId]: localCount,
            });
          }

          if (saveOk) {
            // ── Full Count success ──────────────────────────────────────
            // Update local task stock.
            if (saveTask) {
              workingTasks = workingTasks.map((t) => {
                if (t.id !== saveTask.id) return t;
                return Object.assign({}, t, { currentStock: saveTask.currentStock });
              });
            }

            if (reconcileOk) {
              // Full success + reconcile success → rerender.
              if (section.isConnected) render();
            } else {
              // Full success + reconcile failure → rerender + show pending notice.
              if (section.isConnected) {
                render();
                // Append page-level pending notice above task sections.
                const countElRef = content.querySelector('.station-prep__count');
                const noticeEl = document.createElement('p');
                noticeEl.className = 'station-prep__reconcile-pending';
                noticeEl.setAttribute('role', 'status');
                noticeEl.textContent = translate('station_prep.count_reconciliation_pending');
                if (countElRef && countElRef.nextSibling) {
                  content.insertBefore(noticeEl, countElRef.nextSibling);
                } else {
                  content.appendChild(noticeEl);
                }
              }
            }
          } else {
            // ── Partial Count write (stock not updated) ──────────────────
            // Form stays open; re-enable controls.
            resetSubmitting();
            enableForm();
            clearFeedback();

            if (reconcileOk) {
              // Partial write + reconcile success.
              // Update DOM Last physical count section in the currently expanded detail.
              if (section.isConnected && localCount) {
                const lastCountSection = fPanel.querySelector('.station-prep__detail-last-count');
                if (lastCountSection) {
                  const newSection = buildLastPhysicalCount(localCount, translate);
                  lastCountSection.parentNode.replaceChild(newSection, lastCountSection);
                }
              }
              showError('station_prep.count_partial_error');
            } else {
              // Partial write + reconcile failure.
              if (section.isConnected && localCount) {
                const lastCountSection = fPanel.querySelector('.station-prep__detail-last-count');
                if (lastCountSection) {
                  const newSection = buildLastPhysicalCount(localCount, translate);
                  lastCountSection.parentNode.replaceChild(newSection, lastCountSection);
                }
              }
              showError('station_prep.count_partial_reconciliation_error');
            }
          }
        }

        for (const key of SECTION_KEYS) {
          const groupEl = buildGroup(key, groups[key], suggestionsMap, workingLogsMap, workingCountsMap, translate, expandController, idGen, startTask, passTask, currentUser, section, onSuccess, completeTask, onCompleteSuccess, saveCount, reconcileCount, onCountSuccess);
          if (groupEl) content.appendChild(groupEl);
        }
      }

      render();
    });
  });

  return section;
}

