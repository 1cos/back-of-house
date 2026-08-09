// BOH OS v2 — Recipe Book Panel
// Global recipe catalog browser. Opens as a workspace panel.
// Registered as 'recipe-book' in WorkspaceManager.
//
// Features:
//   - Full recipe list grouped by menu_group / category
//   - Client-side search on title and category
//   - Category pill filter (horizontal scroll)
//   - Tap recipe → opens existing recipe-detail panel
//
// No writes. No editing. No ingredient search (future).
// Returns HTMLElement synchronously (Workspace Engine R-21).

import { fetchRecipeCatalog } from '../../services/recipe-catalog-service.js';

// ── Preferred category order ──────────────────────────────────────────
// Categories not in this list appear after, sorted alphabetically.

const PREFERRED_ORDER = [
  'Antipasti', 'Primi', 'Secondi', 'Table Side', 'Salads',
  'Sides', 'Soups', 'Desserts', 'Sauces', 'Bases',
  'Finger Food', 'Catering', 'Add-ons',
];

function categorySort(a, b) {
  const ai = PREFERRED_ORDER.indexOf(a);
  const bi = PREFERRED_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

// ── Category resolution ───────────────────────────────────────────────

function resolveCategory(recipe) {
  return recipe.menuGroup || recipe.category || 'General';
}

// ── DOM helper ────────────────────────────────────────────────────────

function _el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── Debounced input handler ───────────────────────────────────────────

function onInputDebounced(inputEl, callback, delay) {
  let timer = null;
  inputEl.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback(inputEl.value);
    }, delay);
  });
}

// ── Recipe card builder ───────────────────────────────────────────────

function buildRecipeCard(recipe, translate, openPanel) {
  const card = _el('li', 'recipe-book__card');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const title = _el('span', 'recipe-book__card-title', recipe.title);
  card.appendChild(title);

  const meta = _el('span', 'recipe-book__card-meta');
  const parts = [];
  const cat = resolveCategory(recipe);
  if (cat) parts.push(cat);
  if (recipe.yieldText && recipe.yieldText.trim()) parts.push(recipe.yieldText.trim());
  meta.textContent = parts.join(' · ');
  card.appendChild(meta);

  function open() {
    openPanel('recipe-detail', {
      recipeId:   recipe.id,
      taskName:   recipe.title,
      recipeName: recipe.title,
      source:     'recipe-book',
    });
  }

  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  return card;
}

// ── Category section builder ──────────────────────────────────────────

function buildCategorySection(categoryName, recipes, translate, openPanel) {
  const section = _el('section', 'recipe-book__section');

  const heading = _el('div', 'recipe-book__section-heading');
  const label = _el('h2', 'recipe-book__section-label', categoryName);
  const count = _el('span', 'recipe-book__section-count', String(recipes.length));
  heading.appendChild(label);
  heading.appendChild(count);
  section.appendChild(heading);

  const list = _el('ul', 'recipe-book__list');
  list.setAttribute('role', 'list');

  for (const recipe of recipes) {
    list.appendChild(buildRecipeCard(recipe, translate, openPanel));
  }

  section.appendChild(list);
  return section;
}

// ── Content renderer ──────────────────────────────────────────────────

function renderContent(root, allRecipes, searchTerm, activeCategory, translate, openPanel) {
  // Clear previous content (keep header)
  const content = root.querySelector('.recipe-book__content');
  if (!content) return;
  content.innerHTML = '';

  // Filter by search
  const term = (searchTerm || '').toLowerCase().trim();
  let filtered = allRecipes;
  if (term.length > 0) {
    filtered = allRecipes.filter((r) => {
      const cat = resolveCategory(r).toLowerCase();
      return r.title.toLowerCase().includes(term) || cat.includes(term);
    });
  }

  // Filter by category
  if (activeCategory !== 'All') {
    filtered = filtered.filter((r) => resolveCategory(r) === activeCategory);
  }

  // Empty state
  if (filtered.length === 0) {
    content.appendChild(_el('p', 'recipe-book__empty', translate('recipe_book.empty')));
    return;
  }

  // Group by category
  const groups = {};
  for (const recipe of filtered) {
    const cat = resolveCategory(recipe);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(recipe);
  }

  // Sort category keys
  const sortedKeys = Object.keys(groups).sort(categorySort);

  // Render sections
  for (const key of sortedKeys) {
    content.appendChild(buildCategorySection(key, groups[key], translate, openPanel));
  }
}

// ── Public: createRecipeBookPanel ─────────────────────────────────────

/**
 * @param {{
 *   translate: (key: string) => string,
 *   openPanel: (type: string, context: object) => void,
 * }} context
 * @returns {HTMLElement}
 */
export function createRecipeBookPanel({ translate, openPanel }) {
  const root = _el('article', 'recipe-book');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', translate('recipe_book.title'));

  // ── Header ────────────────────────────────────────────────────────
  const header = _el('header', 'recipe-book__header');
  header.appendChild(_el('h1', 'recipe-book__title', translate('recipe_book.title')));

  // Search
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'recipe-book__search';
  searchInput.placeholder = translate('recipe_book.search_placeholder');
  searchInput.setAttribute('aria-label', translate('recipe_book.search_placeholder'));
  header.appendChild(searchInput);

  // Category pills container
  const pillStrip = _el('div', 'recipe-book__pills');
  pillStrip.setAttribute('role', 'tablist');
  pillStrip.setAttribute('aria-label', 'Category filter');
  header.appendChild(pillStrip);

  root.appendChild(header);

  // ── Content area ──────────────────────────────────────────────────
  const content = _el('div', 'recipe-book__content');
  root.appendChild(content);

  // ── Skeleton ──────────────────────────────────────────────────────
  const skeleton = _el('div', 'recipe-book__skeleton');
  for (let i = 0; i < 6; i++) {
    skeleton.appendChild(_el('div', 'recipe-book__skeleton-row'));
  }
  content.appendChild(skeleton);

  // ── State ─────────────────────────────────────────────────────────
  let allRecipes = [];
  let activeCategory = 'All';
  let searchTerm = '';

  function rerender() {
    renderContent(root, allRecipes, searchTerm, activeCategory, translate, openPanel);
  }

  // ── Build pill strip ──────────────────────────────────────────────
  function buildPills(categories) {
    pillStrip.innerHTML = '';

    const allCategories = ['All'].concat(categories);

    for (const cat of allCategories) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = cat === activeCategory
        ? 'recipe-book__pill recipe-book__pill--active'
        : 'recipe-book__pill';
      pill.setAttribute('role', 'tab');
      pill.setAttribute('aria-selected', cat === activeCategory ? 'true' : 'false');
      pill.textContent = cat === 'All' ? translate('recipe_book.all') : cat;

      pill.addEventListener('click', () => {
        activeCategory = cat;
        buildPills(categories);
        rerender();
      });

      pillStrip.appendChild(pill);
    }
  }

  // ── Search handler ────────────────────────────────────────────────
  onInputDebounced(searchInput, (value) => {
    searchTerm = value;
    rerender();
  }, 150);

  // ── Fetch data ────────────────────────────────────────────────────
  fetchRecipeCatalog().then((result) => {
    if (!root.isConnected) return;

    if (!result.ok) {
      content.innerHTML = '';
      content.appendChild(_el('p', 'recipe-book__error', translate('recipe_book.error')));
      return;
    }

    allRecipes = result.recipes;

    // Extract unique categories, sorted
    const catSet = new Set();
    for (const r of allRecipes) {
      catSet.add(resolveCategory(r));
    }
    const sortedCategories = [...catSet].sort(categorySort);

    buildPills(sortedCategories);
    rerender();
  }).catch(() => {
    if (!root.isConnected) return;
    content.innerHTML = '';
    content.appendChild(_el('p', 'recipe-book__error', translate('recipe_book.error')));
  });

  return root;
}
