// BOH OS v2 — Recipe Panel
// Read-only inspection panel opened from an expanded Prep Card or Recipe Book.
// Registered as 'recipe-detail' in WorkspaceManager.
//
// Spec: BOH OS v2 Recipe Trust — Phase 2
// Manual ingredient-based scaling (Task 3A):
//   Tap any ingredient qty → inline editor → new factor applied to ALL rows.
//   Unit conversions: g↔kg, ml↔l only.
//
// No Start / Continue / Mark done here — those live on the Prep Card.
// No legacy recipe-modal.js import. No modal over Workspace.
// No writes to any table.
//
// Procedure source precedence (in order):
//   1. prep_steps when present  (kitchen-specific operational steps)
//   2. recipe_steps              (generic recipe method)
//   3. procedure_en              (free-text fallback)
//   4. neutral empty state       ("No procedure recorded.")
//
// Returns an HTMLElement synchronously (Workspace Engine R-21).
// All async work uses isConnected guards.

import { fetchRecipeData } from '../../services/recipe-service.js';

// ── Quantity formatting ───────────────────────────────────────────────
// factor=1 renders the base quantity unchanged.

function _fmtQty(quantity, factor) {
  if (quantity === null || quantity === undefined || quantity === '') return '';
  const raw = parseFloat(quantity) * (factor || 1);
  if (isNaN(raw)) return String(quantity);
  if (raw >= 100) return Math.round(raw).toString();
  if (raw >= 10)  return (Math.round(raw * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return (Math.round(raw * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}

// ── Scale factor calculation (from plannedOutput) ─────────────────────

function _computeScaleFactor(plannedOutput, baseWeightG) {
  const po  = parseFloat(plannedOutput);
  const bwg = parseFloat(baseWeightG);
  if (!isFinite(po) || po <= 0) return null;
  if (!isFinite(bwg) || bwg <= 0) return null;
  const f = po / bwg;
  if (f > 50) return null;
  return f;
}

// ── Unit conversion helpers ───────────────────────────────────────────
// Only safe conversions: g↔kg, ml↔l. Returns grams/ml base or null.

const UNIT_TO_BASE = {
  'g':  { base: 'g',  multiplier: 1 },
  'kg': { base: 'g',  multiplier: 1000 },
  'ml': { base: 'ml', multiplier: 1 },
  'l':  { base: 'ml', multiplier: 1000 },
};

function _normalizeToBase(qty, unit) {
  const u = (unit || '').trim().toLowerCase();
  const conv = UNIT_TO_BASE[u];
  if (!conv) return null;
  const q = parseFloat(qty);
  if (!isFinite(q) || q < 0) return null;
  return { value: q * conv.multiplier, baseUnit: conv.base };
}

function _unitsCompatible(unitA, unitB) {
  const a = UNIT_TO_BASE[(unitA || '').trim().toLowerCase()];
  const b = UNIT_TO_BASE[(unitB || '').trim().toLowerCase()];
  if (!a || !b) return false;
  return a.base === b.base;
}

// ── Format scale factor for display ───────────────────────────────────

function _fmtFactor(f) {
  if (f >= 10) return Math.round(f) + '×';
  const r = Math.round(f * 100) / 100;
  return r.toString().replace(/\.?0+$/, '') + '×';
}

// ── DOM helpers ───────────────────────────────────────────────────────

function _el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── Ingredient name resolution ────────────────────────────────────────

function _bomIngredientName(row) {
  if (row.component_type === 'RECIPE') {
    return row.recipes?.title ?? '—';
  }
  return row.ingredients?.name ?? '—';
}

// ── Inline qty editor ─────────────────────────────────────────────────
// Replaces the qty span with an input. On confirm, computes new factor.

function _openQtyEditor(qtyEl, row, currentFactor, onNewFactor) {
  if (qtyEl.querySelector('.recipe-panel__qty-input')) return; // already open

  const baseQty = parseFloat(row.quantity);
  if (!isFinite(baseQty) || baseQty <= 0) return;

  const currentScaled = baseQty * (currentFactor || 1);
  const unit = row.unit || '';

  // Save original content
  const originalContent = qtyEl.textContent;
  qtyEl.textContent = '';
  qtyEl.classList.add('recipe-panel__ingredient-qty--editing');

  // Input
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.className = 'recipe-panel__qty-input';
  input.value = _fmtQty(baseQty, currentFactor);
  input.setAttribute('aria-label', 'New quantity');

  // Unit label
  const unitLabel = _el('span', 'recipe-panel__qty-unit', unit);

  function cancel() {
    qtyEl.classList.remove('recipe-panel__ingredient-qty--editing');
    qtyEl.innerHTML = '';
    qtyEl.textContent = originalContent;
  }

  function confirm() {
    const rawVal = input.value.trim().replace(',', '.');
    const desired = parseFloat(rawVal);
    if (!isFinite(desired) || desired <= 0) {
      cancel();
      return;
    }

    // Attempt unit-aware factor calculation
    const baseNorm = _normalizeToBase(baseQty, unit);
    const desiredNorm = _normalizeToBase(desired, unit); // same unit as display

    let newFactor;
    if (baseNorm && desiredNorm && baseNorm.baseUnit === desiredNorm.baseUnit && baseNorm.value > 0) {
      newFactor = desiredNorm.value / baseNorm.value;
    } else {
      // Fallback: simple ratio
      newFactor = desired / baseQty;
    }

    if (!isFinite(newFactor) || newFactor <= 0 || newFactor > 50) {
      cancel();
      return;
    }

    onNewFactor(newFactor);
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  input.addEventListener('blur', () => {
    // Small delay to allow tap on other elements
    setTimeout(() => {
      if (qtyEl.contains(input)) confirm();
    }, 150);
  });

  qtyEl.appendChild(input);
  qtyEl.appendChild(unitLabel);

  // Focus and select
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

// ── Ingredients section (with tappable quantities) ────────────────────

function _buildIngredients(bomRows, factor, isManuallyScaled, translate, onTapQty) {
  const section = _el('section', 'recipe-panel__section');
  section.appendChild(_el('h2', 'recipe-panel__section-heading', translate('recipe_panel.ingredients_heading')));

  if (!bomRows || bomRows.length === 0) {
    section.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.no_ingredients')));
    return section;
  }

  // Scale notice
  if (factor === 1 && !isManuallyScaled) {
    // Could show base notice, but only when scaling was impossible
    // (kept clean — no notice for normal base view)
  }

  const list = _el('ul', 'recipe-panel__ingredient-list');
  list.setAttribute('role', 'list');

  for (let i = 0; i < bomRows.length; i++) {
    const row = bomRows[i];
    const li  = _el('li', 'recipe-panel__ingredient-row');
    const name = _el('span', 'recipe-panel__ingredient-name', _bomIngredientName(row));
    const qty  = _el('span', 'recipe-panel__ingredient-qty');

    if (row.quantity !== null && row.quantity !== undefined) {
      const hasQty = parseFloat(row.quantity) > 0;
      qty.textContent = _fmtQty(row.quantity, factor) + (row.unit ? ' ' + row.unit : '');

      if (hasQty) {
        qty.classList.add('recipe-panel__ingredient-qty--tappable');
        qty.setAttribute('role', 'button');
        qty.setAttribute('tabindex', '0');
        qty.setAttribute('aria-label', 'Edit quantity for ' + _bomIngredientName(row));

        const rowIndex = i;
        qty.addEventListener('click', () => onTapQty(rowIndex, qty));
        qty.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTapQty(rowIndex, qty);
          }
        });
      }
    }

    li.appendChild(name);
    li.appendChild(qty);
    list.appendChild(li);
  }

  section.appendChild(list);
  return section;
}

// ── Scale indicator bar ───────────────────────────────────────────────

function _buildScaleBar(factor, translate, onReset) {
  const bar = _el('div', 'recipe-panel__scale-bar');

  const label = _el('span', 'recipe-panel__scale-label',
    translate('recipe_panel.scaled_label') + ' ' + _fmtFactor(factor));

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'recipe-panel__scale-reset';
  resetBtn.textContent = translate('recipe_panel.reset_to_base');
  resetBtn.addEventListener('click', onReset);

  bar.appendChild(label);
  bar.appendChild(resetBtn);
  return bar;
}

// ── Procedure builder (unchanged) ─────────────────────────────────────

function _buildProcedure(prepSteps, recipeSteps, procedureEn, translate) {
  const section = _el('section', 'recipe-panel__section');
  section.appendChild(_el('h2', 'recipe-panel__section-heading', translate('recipe_panel.procedure_heading')));

  if (prepSteps && prepSteps.length > 0) {
    const ol = _el('ol', 'recipe-panel__steps');
    for (const step of prepSteps) {
      const li = _el('li', 'recipe-panel__step');
      if (step.title) li.appendChild(_el('p', 'recipe-panel__step-title', step.title));
      if (step.note) li.appendChild(_el('p', 'recipe-panel__step-instruction', step.note));
      if (step.timer_minutes && step.timer_minutes > 0) {
        li.appendChild(_el('p', 'recipe-panel__step-timer', step.timer_minutes + ' min'));
      }
      ol.appendChild(li);
    }
    section.appendChild(ol);
    return section;
  }

  if (recipeSteps && recipeSteps.length > 0) {
    const ol = _el('ol', 'recipe-panel__steps');
    for (const step of recipeSteps) {
      const li = _el('li', 'recipe-panel__step');
      const titleText = step.title ?? '';
      if (titleText) li.appendChild(_el('p', 'recipe-panel__step-title', titleText));
      const instrText = step.instruction_en ?? step.instruction_it ?? '';
      if (instrText) li.appendChild(_el('p', 'recipe-panel__step-instruction', instrText));
      if (step.timer_seconds && step.timer_seconds > 0) {
        const mins = Math.round(step.timer_seconds / 60);
        li.appendChild(_el('p', 'recipe-panel__step-timer', mins + ' min'));
      }
      ol.appendChild(li);
    }
    section.appendChild(ol);
    return section;
  }

  const procText = typeof procedureEn === 'string' ? procedureEn.trim() : '';
  if (procText.length > 0) {
    section.appendChild(_el('p', 'recipe-panel__procedure-text', procText));
    return section;
  }

  section.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.no_procedure')));
  return section;
}

// ── Notes builder (unchanged) ─────────────────────────────────────────

function _buildNotes(recipe, translate) {
  const notes = [];
  if (recipe.shelf_life_days) {
    notes.push(translate('recipe_panel.shelf_life_label') + ': ' + recipe.shelf_life_days + ' days');
  }
  if (recipe.yield_text && recipe.yield_text.trim()) {
    notes.push(translate('recipe_panel.yield_label') + ': ' + recipe.yield_text.trim());
  }
  if (recipe.equipment && recipe.equipment.trim()) {
    notes.push(translate('recipe_panel.equipment_label') + ': ' + recipe.equipment.trim());
  }
  if (notes.length === 0) return null;

  const section = _el('section', 'recipe-panel__section');
  section.appendChild(_el('h2', 'recipe-panel__section-heading', translate('recipe_panel.notes_heading')));
  for (const note of notes) {
    section.appendChild(_el('p', 'recipe-panel__note', note));
  }
  return section;
}

// ── Content renderer (async, fires after skeleton mount) ──────────────

function _renderContent(root, context, translate) {
  const { recipeId, prepTaskId, taskName, plannedOutput, plannedOutputUnit } = context;

  fetchRecipeData(recipeId ?? null, prepTaskId ?? null).then((data) => {
    if (!root.isConnected) return;

    root.innerHTML = '';

    // ── Header ─────────────────────────────────────────────────────
    const header = _el('header', 'recipe-panel__header');
    header.appendChild(_el('h1', 'recipe-panel__task-name', taskName ?? translate('recipe_panel.untitled')));

    if (plannedOutput !== null && plannedOutput !== undefined) {
      const targetText = String(plannedOutput) + (plannedOutputUnit ? ' ' + plannedOutputUnit : '');
      header.appendChild(_el('p', 'recipe-panel__target',
        translate('recipe_panel.target_label') + ' ' + targetText));
    }

    const recipeTitle = data.recipe?.title ?? null;
    if (recipeTitle && recipeTitle !== taskName) {
      header.appendChild(_el('p', 'recipe-panel__recipe-name', recipeTitle));
    }

    root.appendChild(header);

    // ── No content guard ───────────────────────────────────────────
    const hasAnyContent =
      data.bomRows.length > 0 ||
      data.recipeSteps.length > 0 ||
      data.prepSteps.length > 0 ||
      (data.recipe?.procedure_en ?? '').trim().length > 0;

    if (!recipeId || !hasAnyContent) {
      root.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.no_content')));
      return;
    }

    // ── Scale state ────────────────────────────────────────────────
    const contextFactor = _computeScaleFactor(plannedOutput, data.recipe?.base_weight_g);
    let activeFactor = contextFactor ?? 1;
    let isManuallyScaled = false;

    // ── Scale bar mount point (above ingredients) ──────────────────
    const scaleBarMount = _el('div', 'recipe-panel__scale-bar-mount');
    root.appendChild(scaleBarMount);

    // ── Body ───────────────────────────────────────────────────────
    const body = _el('div', 'recipe-panel__body');

    // Ingredients mount — will be rebuilt on scale change
    const ingredientsMount = _el('div', 'recipe-panel__ingredients-mount');
    body.appendChild(ingredientsMount);

    // Procedure (not affected by scaling)
    body.appendChild(_buildProcedure(
      data.prepSteps, data.recipeSteps,
      data.recipe?.procedure_en ?? '', translate
    ));

    if (data.recipe) {
      const notes = _buildNotes(data.recipe, translate);
      if (notes) body.appendChild(notes);
    }

    root.appendChild(body);

    // ── Render/rerender ingredients + scale bar ────────────────────
    function renderIngredients() {
      ingredientsMount.innerHTML = '';
      scaleBarMount.innerHTML = '';

      // Scale bar — show when factor ≠ 1
      if (activeFactor !== 1) {
        scaleBarMount.appendChild(_buildScaleBar(activeFactor, translate, () => {
          activeFactor = contextFactor ?? 1;
          isManuallyScaled = false;
          renderIngredients();
        }));
      } else if (contextFactor === null && data.bomRows.length > 0) {
        // Base quantities notice when no scaling is possible
        scaleBarMount.appendChild(
          _el('p', 'recipe-panel__scale-notice', translate('recipe_panel.base_quantities_notice'))
        );
      }

      ingredientsMount.appendChild(
        _buildIngredients(data.bomRows, activeFactor, isManuallyScaled, translate,
          (rowIndex, qtyEl) => {
            const row = data.bomRows[rowIndex];
            _openQtyEditor(qtyEl, row, activeFactor, (newFactor) => {
              activeFactor = newFactor;
              isManuallyScaled = true;
              renderIngredients();
            });
          }
        )
      );
    }

    renderIngredients();

  }).catch(() => {
    if (!root.isConnected) return;
    root.innerHTML = '';
    root.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.load_error')));
  });
}

// ── Public: createRecipePanel ─────────────────────────────────────────

/**
 * @param {{
 *   recipeId:           string | null,
 *   prepTaskId:         number | null,
 *   taskName:           string,
 *   plannedOutput:      number | null,
 *   plannedOutputUnit:  string | null,
 *   translate:          (key: string) => string,
 * }} context
 * @returns {HTMLElement}
 */
export function createRecipePanel(context) {
  const { translate } = context;

  const root = document.createElement('article');
  root.className = 'recipe-panel';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', translate('recipe_panel.aria_label'));

  const skeleton = _el('div', 'recipe-panel__skeleton');
  for (let i = 0; i < 4; i++) {
    skeleton.appendChild(_el('div', 'recipe-panel__skeleton-row'));
  }
  root.appendChild(skeleton);

  _renderContent(root, context, translate);

  return root;
}
