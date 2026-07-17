// BOH OS v2 — Recipe Panel
// Read-only inspection panel opened from an expanded Prep Card.
// Registered as 'recipe-detail' in WorkspaceManager.
//
// Spec: BOH OS v2 Recipe Trust — Phase 2
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
// Ingredient scaling:
//   scaleFactor = plannedOutput / base_weight_g
//   Only applied when BOTH values are valid positive numbers.
//   When scaling is impossible → render base recipe quantities + note.
//   Never guess a scale factor.
//
// Returns an HTMLElement synchronously (Workspace Engine R-21).
// All async work uses isConnected guards.

import { fetchRecipeData } from '../../services/recipe-service.js';

// ── Quantity formatting ───────────────────────────────────────────────
// Matches the formatting in legacy recipe-modal.js fmtQty.
// factor=1 renders the base quantity unchanged.

function _fmtQty(quantity, factor) {
  if (quantity === null || quantity === undefined || quantity === '') return '';
  const raw = parseFloat(quantity) * (factor || 1);
  if (isNaN(raw)) return String(quantity);
  if (raw >= 100) return Math.round(raw).toString();
  if (raw >= 10)  return (Math.round(raw * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return (Math.round(raw * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}

// ── Scale factor calculation ──────────────────────────────────────────
// Returns a valid positive number or null.
// null means "cannot scale — render base quantities."

function _computeScaleFactor(plannedOutput, baseWeightG) {
  const po  = parseFloat(plannedOutput);
  const bwg = parseFloat(baseWeightG);
  if (!isFinite(po) || po <= 0) return null;
  if (!isFinite(bwg) || bwg <= 0) return null;
  const f = po / bwg;
  // Sanity cap: >50× is almost certainly a unit mismatch
  if (f > 50) return null;
  return f;
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

// ── Section builders ──────────────────────────────────────────────────

function _buildIngredients(bomRows, scaleFactor, translate) {
  const section = _el('section', 'recipe-panel__section');
  section.appendChild(_el('h2', 'recipe-panel__section-heading', translate('recipe_panel.ingredients_heading')));

  if (!bomRows || bomRows.length === 0) {
    section.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.no_ingredients')));
    return section;
  }

  // Scale notice — shown when scaling is impossible
  if (scaleFactor === null) {
    const notice = _el('p', 'recipe-panel__scale-notice', translate('recipe_panel.base_quantities_notice'));
    section.appendChild(notice);
  }

  const factor = scaleFactor ?? 1;

  const list = _el('ul', 'recipe-panel__ingredient-list');
  list.setAttribute('role', 'list');

  for (const row of bomRows) {
    const li   = _el('li', 'recipe-panel__ingredient-row');
    const name = _el('span', 'recipe-panel__ingredient-name', _bomIngredientName(row));
    const qty  = _el('span', 'recipe-panel__ingredient-qty');

    if (row.quantity !== null && row.quantity !== undefined) {
      qty.textContent = _fmtQty(row.quantity, factor) + (row.unit ? ' ' + row.unit : '');
    }

    li.appendChild(name);
    li.appendChild(qty);
    list.appendChild(li);
  }

  section.appendChild(list);
  return section;
}

function _buildProcedure(prepSteps, recipeSteps, procedureEn, translate) {
  const section = _el('section', 'recipe-panel__section');
  section.appendChild(_el('h2', 'recipe-panel__section-heading', translate('recipe_panel.procedure_heading')));

  // ── Source precedence ─────────────────────────────────────────────
  // a. prep_steps when present
  if (prepSteps && prepSteps.length > 0) {
    const ol = _el('ol', 'recipe-panel__steps');
    for (const step of prepSteps) {
      const li = _el('li', 'recipe-panel__step');
      if (step.title) {
        li.appendChild(_el('p', 'recipe-panel__step-title', step.title));
      }
      if (step.note) {
        li.appendChild(_el('p', 'recipe-panel__step-instruction', step.note));
      }
      if (step.timer_minutes && step.timer_minutes > 0) {
        li.appendChild(_el('p', 'recipe-panel__step-timer', step.timer_minutes + ' min'));
      }
      ol.appendChild(li);
    }
    section.appendChild(ol);
    return section;
  }

  // b. recipe_steps
  if (recipeSteps && recipeSteps.length > 0) {
    const ol = _el('ol', 'recipe-panel__steps');
    for (const step of recipeSteps) {
      const li = _el('li', 'recipe-panel__step');
      const titleText = step.title ?? '';
      if (titleText) {
        li.appendChild(_el('p', 'recipe-panel__step-title', titleText));
      }
      const instrText = step.instruction_en ?? step.instruction_it ?? '';
      if (instrText) {
        li.appendChild(_el('p', 'recipe-panel__step-instruction', instrText));
      }
      if (step.timer_seconds && step.timer_seconds > 0) {
        const mins = Math.round(step.timer_seconds / 60);
        li.appendChild(_el('p', 'recipe-panel__step-timer', mins + ' min'));
      }
      ol.appendChild(li);
    }
    section.appendChild(ol);
    return section;
  }

  // c. procedure_en free-text
  const procText = typeof procedureEn === 'string' ? procedureEn.trim() : '';
  if (procText.length > 0) {
    const p = _el('p', 'recipe-panel__procedure-text', procText);
    section.appendChild(p);
    return section;
  }

  // d. empty state
  section.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.no_procedure')));
  return section;
}

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

    // Clear skeleton
    root.innerHTML = '';

    // ── Header ─────────────────────────────────────────────────────
    const header = _el('header', 'recipe-panel__header');

    const taskNameEl = _el('h1', 'recipe-panel__task-name', taskName ?? translate('recipe_panel.untitled'));
    header.appendChild(taskNameEl);

    // Production target — from suggestion (authoritative, pre-resolved by card)
    if (plannedOutput !== null && plannedOutput !== undefined) {
      const targetText = String(plannedOutput) + (plannedOutputUnit ? ' ' + plannedOutputUnit : '');
      const targetEl = _el('p', 'recipe-panel__target',
        translate('recipe_panel.target_label') + ' ' + targetText);
      header.appendChild(targetEl);
    }

    // Recipe title — only when different from task name
    const recipeTitle = data.recipe?.title ?? null;
    if (recipeTitle && recipeTitle !== taskName) {
      header.appendChild(_el('p', 'recipe-panel__recipe-name', recipeTitle));
    }

    root.appendChild(header);

    // ── No recipe content at all ───────────────────────────────────
    const hasAnyContent =
      data.bomRows.length > 0 ||
      data.recipeSteps.length > 0 ||
      data.prepSteps.length > 0 ||
      (data.recipe?.procedure_en ?? '').trim().length > 0 ||
      (data.recipe?.procedure    ?? '').trim().length > 0;

    if (!recipeId || !hasAnyContent) {
      root.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.no_content')));
      return;
    }

    // ── Scale factor ───────────────────────────────────────────────
    const scaleFactor = _computeScaleFactor(
      plannedOutput,
      data.recipe?.base_weight_g
    );

    // ── Body ───────────────────────────────────────────────────────
    const body = _el('div', 'recipe-panel__body');

    // 1. Ingredients
    body.appendChild(_buildIngredients(data.bomRows, scaleFactor, translate));

    // 2. Procedure
    body.appendChild(_buildProcedure(
      data.prepSteps,
      data.recipeSteps,
      data.recipe?.procedure_en ?? data.recipe?.procedure ?? '',
      translate
    ));

    // 3. Notes (only when useful content exists)
    if (data.recipe) {
      const notes = _buildNotes(data.recipe, translate);
      if (notes) body.appendChild(notes);
    }

    root.appendChild(body);
  }).catch(() => {
    if (!root.isConnected) return;
    root.innerHTML = '';
    root.appendChild(_el('p', 'recipe-panel__empty-state', translate('recipe_panel.load_error')));
  });
}

// ── Public: createRecipePanel ─────────────────────────────────────────
// Workspace Engine R-21: returns HTMLElement synchronously.
// Async fetch starts immediately; isConnected guards prevent stale writes.

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

  // Root element returned synchronously
  const root = document.createElement('article');
  root.className = 'recipe-panel';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', translate('recipe_panel.aria_label'));

  // Skeleton — replaced when data arrives
  const skeleton = _el('div', 'recipe-panel__skeleton');
  for (let i = 0; i < 4; i++) {
    skeleton.appendChild(_el('div', 'recipe-panel__skeleton-row'));
  }
  root.appendChild(skeleton);

  // Start async fetch
  _renderContent(root, context, translate);

  return root;
}
