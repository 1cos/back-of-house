// BOH OS v2 — Bottom Navigation component
// Task 003B: Station Mode bottom navigation, mobile-first.
// Returns a single DOM element. Does not mount itself.
// No global state. No window. No Supabase. No router import. No app-state import.

/**
 * Creates the bottom navigation DOM element.
 *
 * @param {{
 *   items:      Array<{ id: string, label: string, icon: string, disabled: boolean }>,
 *   activeItem: string,
 *   onSelect:   (id: string) => void
 * }} options
 * @returns {HTMLElement}
 */
export function createBottomNavigation({ items, activeItem, onSelect }) {
  // ── Root: semantic nav ───────────────────────────────────────────────
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', items._navLabel || '');

  // ── Items ────────────────────────────────────────────────────────────
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'bottom-nav__item';
    btn.type = 'button';

    const isActive = item.id === activeItem;

    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    }

    if (item.disabled) {
      // Native disabled attribute — prevents click events and focus.
      btn.disabled = true;
    }

    // ── Icon (hidden from assistive technology) ──────────────────────
    const iconEl = document.createElement('span');
    iconEl.className = 'bottom-nav__icon';
    iconEl.textContent = item.icon;
    iconEl.setAttribute('aria-hidden', 'true');

    // ── Label ────────────────────────────────────────────────────────
    const labelEl = document.createElement('span');
    labelEl.className = 'bottom-nav__label';
    labelEl.textContent = item.label;

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);

    // ── Click handler ────────────────────────────────────────────────
    // Only registered for enabled items.
    // Disabled buttons will not fire click events due to disabled attribute,
    // but we guard here for belt-and-suspenders safety.
    if (!item.disabled) {
      btn.addEventListener('click', () => {
        onSelect(item.id);
      });
    }

    nav.appendChild(btn);
  }

  return nav;
}
