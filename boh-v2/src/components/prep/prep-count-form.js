// BOH OS v2 — Prep Count Form component
// Task 004T: collects physically counted quantity and unit for a prep task.
// UI-only. Does not query or write to any database. No reconciler call.
// No window writes. No storage. No service imports.

// ── Instance ID generator ─────────────────────────────────────────────
// Produces unique DOM ids per component instance so multiple forms
// on the same page do not share label targets.

let _instanceCount = 0;

function nextInstanceId() {
  _instanceCount += 1;
  return 'pcf-' + _instanceCount;
}

// ── Exported API ──────────────────────────────────────────────────────

/**
 * Creates the Prep Count Form component.
 *
 * Collects a physically counted quantity (≥ 0) and unit.
 * Zero is a valid count. Does not write to any database.
 *
 * @param {{
 *   taskName:    string | null | undefined,
 *   defaultUnit: string | null | undefined,
 *   translate:   (key: string) => string,
 *   onConfirm:   ((opts: { countedQuantity: number, unit: string }) => void) | undefined,
 *   onCancel:    (() => void) | undefined
 * }} options
 * @returns {HTMLElement}
 * @throws {Error} if translate is not a function
 */
export function createPrepCountForm({ taskName, defaultUnit, translate, onConfirm, onCancel }) {
  if (typeof translate !== 'function') {
    throw new Error('createPrepCountForm: translate must be a function.');
  }

  const iid         = nextInstanceId();
  const qtyInputId  = iid + '-qty';
  const unitInputId = iid + '-unit';

  // ── Resolve display values ──
  const displayName = (typeof taskName === 'string' && taskName.trim().length > 0)
    ? taskName.trim()
    : translate('station_prep.count_form_fallback_task');

  const initialUnit = (typeof defaultUnit === 'string' && defaultUnit.trim().length > 0)
    ? defaultUnit.trim()
    : '';

  // ── Root wrapper ──
  const wrapper = document.createElement('div');
  wrapper.className = 'pcf';

  // ── Heading ──
  const heading = document.createElement('h2');
  heading.className = 'pcf__title';
  heading.textContent = translate('station_prep.count_form_title');

  // ── Task name ──
  const taskEl = document.createElement('p');
  taskEl.className = 'pcf__task-name';
  taskEl.textContent = displayName;

  // ── Form ──
  const form = document.createElement('form');
  form.className = 'pcf__form';
  form.noValidate = true;

  // ── Error area ──
  const errorEl = document.createElement('p');
  errorEl.className = 'pcf__error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  // ── Quantity field ──
  const qtyGroup = document.createElement('div');
  qtyGroup.className = 'pcf__field';

  const qtyLabel = document.createElement('label');
  qtyLabel.className = 'pcf__label';
  qtyLabel.htmlFor = qtyInputId;
  qtyLabel.textContent = translate('station_prep.count_form_quantity');

  const qtyInput = document.createElement('input');
  qtyInput.className = 'pcf__input';
  qtyInput.type = 'number';
  qtyInput.id = qtyInputId;
  qtyInput.name = 'countedQuantity';
  qtyInput.setAttribute('inputmode', 'decimal');
  qtyInput.setAttribute('min', '0');      // zero is a valid physical count
  qtyInput.setAttribute('step', 'any');
  qtyInput.required = true;
  qtyInput.value = '';                    // starts empty — no default quantity

  qtyGroup.appendChild(qtyLabel);
  qtyGroup.appendChild(qtyInput);

  // ── Unit field ──
  const unitGroup = document.createElement('div');
  unitGroup.className = 'pcf__field';

  const unitLabel = document.createElement('label');
  unitLabel.className = 'pcf__label';
  unitLabel.htmlFor = unitInputId;
  unitLabel.textContent = translate('station_prep.count_form_unit');

  const unitInput = document.createElement('input');
  unitInput.className = 'pcf__input';
  unitInput.type = 'text';
  unitInput.id = unitInputId;
  unitInput.name = 'unit';
  unitInput.required = true;
  unitInput.value = initialUnit;

  unitGroup.appendChild(unitLabel);
  unitGroup.appendChild(unitInput);

  // ── Buttons ──
  const btnGroup = document.createElement('div');
  btnGroup.className = 'pcf__actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'pcf__btn pcf__btn--confirm';
  confirmBtn.type = 'submit';
  confirmBtn.textContent = translate('station_prep.count_form_confirm');

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'pcf__btn pcf__btn--cancel';
  cancelBtn.type = 'button';
  cancelBtn.textContent = translate('station_prep.count_form_cancel');

  btnGroup.appendChild(confirmBtn);
  btnGroup.appendChild(cancelBtn);

  // ── Assemble form ──
  form.appendChild(errorEl);
  form.appendChild(qtyGroup);
  form.appendChild(unitGroup);
  form.appendChild(btnGroup);

  // ── Validation helpers ──
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
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Remove previous error before each validation attempt.
    clearError();

    const rawQty  = parseFloat(qtyInput.value);
    const rawUnit = unitInput.value.trim();

    // Valid quantity: finite number, zero or greater.
    const qtyValid  = Number.isFinite(rawQty) && rawQty >= 0;
    const unitValid = rawUnit.length > 0;

    // Quantity checked first; both invalid → quantity error shown.
    if (!qtyValid) {
      showError(translate('station_prep.count_form_quantity_error'), qtyInput);
      return;
    }

    if (!unitValid) {
      showError(translate('station_prep.count_form_unit_error'), unitInput);
      return;
    }

    // Valid — call onConfirm if it is a function.
    if (typeof onConfirm === 'function') {
      onConfirm({ countedQuantity: rawQty, unit: rawUnit });
    }
  });

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
