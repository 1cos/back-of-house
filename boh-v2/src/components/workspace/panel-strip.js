// BOH OS v2 — Panel Strip
// WS-02: pure DOM renderer for the workspace tab strip.
// Spec: BOH_OS_V2_WORKSPACE_ENGINE.md v1.1 §15.3
//
// Rules:
//   - Pure function: same inputs → same DOM. No internal state.
//   - role="tablist" on strip root.
//   - role="tab" + aria-selected on each activation button.
//   - Home chip has no close control.
//   - Close control is a SIBLING button, never a nested span.
//   - Close button has an accessible aria-label and a 44px touch target.
//   - Panel IDs are opaque: never parsed inside this module.
//   - Limit notification rendered inline when atLimit=true.
//   - + control hidden when atLimit=true.
//   - No Supabase. No app-state. No router.

import { iconForType } from './panel-icons.js';

const HOME_PANEL_ID = 'panel-home';
const MAX_CHIP_LABEL_MOBILE = 12; // chars before truncation

/**
 * Truncates a label to at most `max` characters, appending '…' if cut.
 *
 * @param {string} label
 * @param {number} max
 * @returns {string}
 */
function truncate(label, max) {
  if (label.length <= max) return label;
  return label.slice(0, max) + '\u2026';
}

/**
 * Renders the Panel Strip as a fresh HTMLElement.
 * Called by WorkspaceManager on every state change.
 *
 * @param {{
 *   panels:     Array<{ id: string, type: string, title: string }>,
 *   activeId:   string | null,
 *   onActivate: (panelId: string) => void,
 *   onClose:    (panelId: string) => void,
 *   onAdd:      () => void,
 *   atLimit:    boolean,
 * }} options
 * @returns {HTMLElement}
 */
export function renderPanelStrip({
  panels,
  activeId,
  onActivate,
  onClose,
  onAdd,
  atLimit,
}) {
  const strip = document.createElement('div');
  strip.className = 'ws-strip';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Open panels');

  for (const panel of panels) {
    const isActive = panel.id === activeId;
    const isHome   = panel.id === HOME_PANEL_ID;

    // Chip wrapper — groups activation button + optional close button.
    const chipGroup = document.createElement('div');
    chipGroup.className = 'ws-chip-group';

    // ── Activation button ──────────────────────────────────────────
    const activateBtn = document.createElement('button');
    activateBtn.type = 'button';
    activateBtn.className = isActive
      ? 'ws-chip ws-chip--active'
      : 'ws-chip';
    activateBtn.setAttribute('role', 'tab');
    activateBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    // Panel IDs are opaque — stored as data attribute, never parsed.
    activateBtn.dataset.panelId = panel.id;
    activateBtn.title = panel.title;

    const icon = document.createElement('span');
    icon.className = 'ws-chip__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = iconForType(panel.type);

    const label = document.createElement('span');
    label.className = 'ws-chip__label';
    label.textContent = truncate(panel.title, MAX_CHIP_LABEL_MOBILE);

    activateBtn.appendChild(icon);
    activateBtn.appendChild(label);

    activateBtn.addEventListener('click', () => {
      onActivate(panel.id);
    });

    chipGroup.appendChild(activateBtn);

    // ── Close button (sibling, not nested) — Home excluded ─────────
    if (!isHome) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'ws-chip__close';
      // Accessible label — spec §15.3 + Review Issue 7 fix.
      closeBtn.setAttribute('aria-label', `Close ${panel.title}`);
      closeBtn.textContent = '\u00D7'; // ×

      closeBtn.addEventListener('click', () => {
        onClose(panel.id);
      });

      chipGroup.appendChild(closeBtn);
    }

    strip.appendChild(chipGroup);
  }

  // ── Limit notification (inline, rendered by strip) ──────────────
  // Appears when atLimit=true; disappears when strip re-renders with
  // atLimit=false (first close). No separate injection needed.
  if (atLimit) {
    const notice = document.createElement('div');
    notice.className = 'ws-strip__limit-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.textContent = 'Close a panel to open a new one.';
    strip.appendChild(notice);
  }

  // ── Add button (present, hidden at limit) ──────────────────────
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'ws-chip ws-chip--add';
  addBtn.setAttribute('aria-label', 'Open another panel');
  addBtn.textContent = '+';
  if (atLimit) {
    addBtn.hidden = true;
    addBtn.setAttribute('aria-hidden', 'true');
  }
  addBtn.addEventListener('click', () => {
    if (!atLimit) onAdd();
  });
  strip.appendChild(addBtn);

  return strip;
}
