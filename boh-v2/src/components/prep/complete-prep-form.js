// BOH OS v2 — Complete Prep Form component
// Task 004O: collects quantity and unit for completing a prep task.
// UI-only. Does not query or write to any database.
// No window writes. No storage. No service imports.

// ── Instance ID generator ─────────────────────────────────────────────
// Produces unique DOM ids per component instance so multiple forms
// on the same page do not share label targets.

let _instanceCount = 0;

function nextInstanceId() {
  _instanceCount += 1;
  return 'cpf-' + _instanceCount;
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Creates the Complete Prep Form component.
 *
 * @param {{
 *   taskName:    string | null | undefined,
 *   defaultUnit: string | null | undefined,
 *   translate:   (key: string) => string,
 *   onConfirm:   ((opts: { quantity: number, unit: string }) => void) | undefined,
 *   onCancel:    (() => void) | undefined
 * }} options
 * @returns {HTMLElement}
 * @throws {Error} if translate is not a function
 */
export function createCompletePrepForm({ taskName, defaultUnit, translate, onConfirm, onCancel }) {
  if (typeof translate !== 'function') {
    throw new Error('createCompletePrepForm: translate must be a function.');
  }

  const iid = nextInstanceId();
  const qtyInputId  = iid + '-qty';
  const unitInputId = iid + '-unit';
  const errorId     = iid + '-error';

  // ── Resolve display values ──
  const displayName = (typeof taskName === 'string' && taskName.trim().length > 0)
    ? taskName.trim()
    : translate('station_prep.complete_form_fallback_task');

  const initialUnit = (typeof defaultUnit === 'string' && defaultUnit.trim().length > 0)
    ? defaultUnit.trim()
    : '';

  // ── Root wrapper ──
  const wrapper = document.createElement('div');
  wrapper.className = 'cpf';

  // ── Heading ──
  const heading = document.createElement('h2');
  heading.className = 'cpf__title';
  heading.textContent = translate('station_prep.complete_form_title');

  // ── Task name ──
  const taskEl = document.createElement('p');
  taskEl.className = 'cpf__task-name';
  taskEl.textContent = displayName;

  // ── Form ──
  const form = document.createElement('form');
  form.className = 'cpf__form';
  form.noValidate = true;

  // ── Error area ──
  const errorEl = document.createElement('p');
  errorEl.className = 'cpf__error';
  errorEl.id = errorId;
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  // ── Quantity field ──
  const qtyGroup = document.createElement('div');
  qtyGroup.className = 'cpf__field';

  const qtyLabel = document.createElement('label');
  qtyLabel.className = 'cpf__label';
  qtyLabel.htmlFor = qtyInputId;
  qtyLabel.textContent = translate('station_prep.complete_form_quantity');

  const qtyInput = document.createElement('input');
  qtyInput.className = 'cpf__input';
  qtyInput.type = 'number';
  qtyInput.id = qtyInputId;
  qtyInput.name = 'quantity';
  qtyInput.setAttribute('inputmode', 'decimal');
  qtyInput.setAttribute('min', '0.0001');
  qtyInput.setAttribute('step', 'any');
  qtyInput.required = true;
  qtyInput.value = '';           // starts empty — no default quantity

  qtyGroup.appendChild(qtyLabel);
  qtyGroup.appendChild(qtyInput);

  // ── Unit field ──
  const unitGroup = document.createElement('div');
  unitGroup.className = 'cpf__field';

  const unitLabel = document.createElement('label');
  unitLabel.className = 'cpf__label';
  unitLabel.htmlFor = unitInputId;
  unitLabel.textContent = translate('station_prep.complete_form_unit');

  const unitInput = document.createElement('input');
  unitInput.className = 'cpf__input';
  unitInput.type = 'text';
  unitInput.id = unitInputId;
  unitInput.name = 'unit';
  unitInput.required = true;
  unitInput.value = initialUnit;

  unitGroup.appendChild(unitLabel);
  unitGroup.appendChild(unitInput);

  // ── Buttons ──
  const btnGroup = document.createElement('div');
  btnGroup.className = 'cpf__actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'cpf__btn cpf__btn--confirm';
  confirmBtn.type = 'submit';
  confirmBtn.textContent = translate('station_prep.complete_form_confirm');

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cpf__btn cpf__btn--cancel';
  cancelBtn.type = 'button';
  cancelBtn.textContent = translate('station_prep.complete_form_cancel');

  btnGroup.appendChild(confirmBtn);
  btnGroup.appendChild(cancelBtn);

  // ── Assemble form ──
  form.appendChild(errorEl);
  form.appendChild(qtyGroup);
  form.appendChild(unitGroup);
  form.appendChild(btnGroup);

  // ── Validation helper ──
  function showError(message, focusTarget) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    if (focusTarget) focusTarget.focus();
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  // ── Submit handler ──
  // _submitting: prevents a second tap firing onConfirm while the first
  // request is in flight. Reset via wrapper._resetSubmit() on failure.
  let _submitting = false;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Duplicate-submission guard: ignore all taps while a request is in flight.
    if (_submitting) return;

    // Remove previous error before each validation attempt.
    clearError();

    const rawQty  = parseFloat(qtyInput.value);
    const rawUnit = unitInput.value.trim();

    const qtyValid  = isFinite(rawQty) && rawQty > 0;
    const unitValid = rawUnit.length > 0;

    if (!qtyValid) {
      showError(translate('station_prep.complete_form_quantity_error'), qtyInput);
      return;
    }

    if (!unitValid) {
      showError(translate('station_prep.complete_form_unit_error'), unitInput);
      return;
    }

    // Valid — lock immediately before the async call so rapid taps are ignored.
    _submitting = true;
    confirmBtn.disabled = true;
    cancelBtn.disabled  = true;
    confirmBtn.textContent = translate('station_prep.completing');

    if (typeof onConfirm === 'function') {
      onConfirm({ quantity: rawQty, unit: rawUnit });
    }
  });

  // ── Reset helper (called by parent on failure) ──
  // Restores button state so the cook can correct and resubmit.
  wrapper._resetSubmit = function () {
    _submitting = false;
    confirmBtn.disabled = false;
    cancelBtn.disabled  = false;
    confirmBtn.textContent = translate('station_prep.complete_form_confirm');
  };

  // ── Cancel handler ──
  cancelBtn.addEventListener('click', () => {
    if (typeof onCancel === 'function') {
      onCancel();
    }
  });

  // ── Assemble wrapper ──
  wrapper.appendChild(heading);
  wrapper.appendChild(taskEl);
  wrapper.appendChild(form);

  return wrapper;
}
