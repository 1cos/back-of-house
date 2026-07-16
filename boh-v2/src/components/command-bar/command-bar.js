// BOH OS v2 — Command Bar component
// UI-06.3: Zero-vibration keyboard dock.
//
// DIAGNOSIS OF PREVIOUS BUGS:
//
//   UI-06.1: bar.style.bottom = layoutH - vv.offsetTop - vv.height
//     ✗ vv 'scroll' listener fired on every Prep scroll px
//     ✗ rewrote bottom on every scroll event → oscillation
//
//   UI-06.2: bar.style.top = vv.offsetTop + vv.height - barH
//     ✗ claimed offsetTop+height cancels during scroll — FALSE
//     ✗ vv.offsetTop changes when iOS address bar collapses during scroll
//     ✗ each change fires vv 'resize' → _scheduleUpdate → new top write
//     ✗ result: bar vibrates vertically while user scrolls Prep
//
// ROOT CAUSE OF VIBRATION:
//   In iOS Safari, scrolling content (even inside a sub-element with
//   overflow:auto) can cause the Safari chrome (address bar) to
//   collapse/expand. This changes vv.offsetTop, which fires vv 'resize'.
//   Any formula that reads vv.offsetTop live will produce a moving bar.
//
// FIX (UI-06.3) — CAPTURE-ONCE MODEL:
//
//   1. On vv 'resize': measure vv.height.
//   2. If vv.height < window.innerHeight - 50 → keyboard is open.
//   3. If this is a MATERIAL height change (> 20px from last settled
//      value), capture it and reposition. Otherwise ignore.
//   4. Dock position = window.innerHeight - capturedVvHeight (constant).
//      bar.style.bottom = dockHeight + 'px'  (constant while KB open).
//   5. scrollTarget padding written once, never again until KB closes.
//   6. No further writes during Prep scroll — the position is frozen.
//   7. Only re-evaluate if vv.height changes > 20px (keyboard type
//      switch, split keyboard, etc.).
//
//   DOCK: solid background element from bar-bottom to screen-bottom.
//   Hides any fractional gap created by the iOS accessory toolbar.
//   Also hides any safe-area gap. Not animated. Constant position.
//
//   NATIVE iOS ACCESSORY TOOLBAR:
//   The prev/next/Done toolbar that appears above the keyboard is
//   native iOS UI. It is included in the space vv.height gives up.
//   Our Command Bar sits above it. The gap between our bar's bottom
//   and the keyboard top IS the native accessory toolbar. We cannot
//   remove it for a textarea without inputmode="none". Our dock
//   fills this area with a solid background so page content is hidden.
//
// INVARIANTS:
//   - One instance per session. destroy() removes everything.
//   - No Supabase, no AI, no router, no WorkspaceManager.
//   - Returns { el, destroy }.

/**
 * @param {{
 *   translate:     (key: string) => string,
 *   scrollTarget?: HTMLElement,
 *   onSubmit?:    (text: string) => void,
 *   onAttach?:    () => void,
 *   onMic?:       () => void,
 * }} options
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createCommandBar({ translate, scrollTarget, onSubmit, onAttach, onMic }) {

  // ── Overlays registry ─────────────────────────────────────────────
  const _overlays = new Set();
  function _addOverlay(el)    { document.body.appendChild(el); _overlays.add(el); }
  function _removeOverlay(el) { if (el.parentNode) el.parentNode.removeChild(el); _overlays.delete(el); }
  function _removeAllOverlays() {
    for (const el of _overlays) if (el.parentNode) el.parentNode.removeChild(el);
    _overlays.clear();
  }

  // ── Bar root ──────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'command-bar';
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', translate('command_bar.bar_label'));

  // ── Dock ──────────────────────────────────────────────────────────
  // Solid background element that fills bar-bottom → screen-bottom.
  // Hides the native iOS accessory toolbar area and any sub-pixel gap.
  // Position is set once when keyboard opens and never updated during scroll.
  const dock = document.createElement('div');
  dock.className = 'command-bar-dock';

  // ── Textarea height sync ──────────────────────────────────────────
  function _syncTextareaHeight() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
  }

  // ── Keyboard-open model ───────────────────────────────────────────
  // _settledVvHeight: the vv.height value we last positioned from.
  // We only reposition if the new vv.height differs by > THRESHOLD.
  // This makes the bar immune to vv.height micro-changes caused by
  // iOS address bar collapse/expand during Prep scroll.

  const vv = window.visualViewport || null;
  const THRESHOLD  = 20;   // px — min height change to trigger reposition
  const KB_MIN     = 100;  // px — min keyboard size to consider KB open

  let _keyboardOpen   = false;
  let _settledVvH     = -1;    // last vv.height we positioned from
  let _rafId          = null;
  let _scrollViewDone = false;

  function _getBarHeight() {
    return bar.offsetHeight || 60;
  }

  // Position bar and dock from a captured vv.height snapshot.
  // Called at most once per keyboard-open event (or once per >20px shift).
  // NEVER called during Prep scroll.
  function _applyKeyboardPosition(capturedVvH) {
    const layoutH    = window.innerHeight;
    const dockHeight = Math.max(0, layoutH - capturedVvH);  // keyboard + accessory area
    const barH       = _getBarHeight();

    // bar: fixed-bottom offset = dockHeight (constant integer)
    bar.style.bottom = dockHeight + 'px';
    bar.style.top    = '';   // clear any leftover from UI-06.2

    // dock: fills from (layoutH - dockHeight) to screen bottom
    // This is a constant position — not recomputed on scroll.
    dock.style.bottom   = '0';
    dock.style.top      = (layoutH - dockHeight) + 'px';
    dock.style.left     = '0';
    dock.style.right    = '0';
    dock.style.position = 'fixed';
    if (!dock.parentNode) document.body.appendChild(dock);

    // Scroll container inset: bar height + full keyboard+accessory area
    // Written once per keyboard-open. Never updated during scroll.
    const target = scrollTarget || bar.parentNode;
    if (target) {
      target.style.paddingBottom = (barH + dockHeight + 16) + 'px';
    }
  }

  function _exitKeyboardMode() {
    _keyboardOpen = false;
    _settledVvH   = -1;

    bar.style.bottom = '';
    bar.style.top    = '';

    if (dock.parentNode) dock.parentNode.removeChild(dock);

    const target = scrollTarget || bar.parentNode;
    if (target) target.style.paddingBottom = '';
  }

  // ── rAF-gated vv.resize handler ───────────────────────────────────
  // Purpose: determine keyboard open/close state and reposition once.
  // Ignores micro-changes in vv.height (< THRESHOLD) — these are caused
  // by iOS address bar collapse during Prep scroll, not by keyboard events.

  function _onVVResize() {
    if (_rafId !== null) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      if (!vv) return;

      const currentVvH = vv.height;
      const layoutH    = window.innerHeight;
      const dockH      = Math.max(0, layoutH - currentVvH);
      const isKbOpen   = dockH > KB_MIN;

      if (!isKbOpen) {
        // Keyboard closed (or fully closed after animation)
        if (_keyboardOpen) {
          _exitKeyboardMode();
        }
        return;
      }

      // Keyboard is open. Check if this is a material height change.
      const delta = Math.abs(currentVvH - _settledVvH);
      if (delta < THRESHOLD && _keyboardOpen) {
        // Sub-threshold change (address bar micro-resize) — ignore.
        // Bar position stays frozen at last settled value.
        return;
      }

      // Material change (keyboard just opened, or keyboard type changed).
      // Capture this height and reposition once.
      _keyboardOpen  = true;
      _settledVvH    = currentVvH;
      _applyKeyboardPosition(currentVvH);
    });
  }

  function _onWindowResize() {
    // Fallback for browsers without visualViewport. No action needed:
    // static CSS bottom:0 is the correct behavior on non-iOS.
  }

  // Wire listener — resize only, no scroll
  if (vv) {
    vv.addEventListener('resize', _onVVResize);
  } else {
    window.addEventListener('resize', _onWindowResize);
  }

  // ── Focus / blur ──────────────────────────────────────────────────
  // scrollIntoView fires at most once per focus, only if obscured.
  // Never called during scroll.

  function _onFocus() {
    _scrollViewDone = false;
    if (!vv) return;
    setTimeout(() => {
      if (document.activeElement !== textarea) return;
      if (_scrollViewDone) return;
      _scrollViewDone = true;
      // Only scroll if the textarea is actually hidden below the visual viewport
      const rect     = textarea.getBoundingClientRect();
      const vvBottom = vv.height;  // in layout-viewport coordinates from top = 0
      if (rect.bottom > vvBottom - 4) {
        textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 400);  // wait for keyboard to fully settle
  }

  function _onBlur() {
    _scrollViewDone = false;
    // No other action. _onVVResize handles keyboard-close cleanup.
  }

  // ── Mic toast ─────────────────────────────────────────────────────
  function _showMicToast() {
    const existing = document.querySelector('.cb-mic-toast');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    const toast = document.createElement('div');
    toast.className = 'cb-mic-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = translate('command_bar.mic_coming_soon');
    _addOverlay(toast);
    setTimeout(() => _removeOverlay(toast), 2500);
  }

  // ── '+' action sheet ──────────────────────────────────────────────
  function _showActionSheet() {
    const backdrop = document.createElement('div');
    backdrop.className = 'cb-sheet-backdrop';
    function dismiss() { _removeOverlay(backdrop); }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) dismiss(); });

    const sheet = document.createElement('div');
    sheet.className = 'cb-action-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', translate('command_bar.attach_label'));

    const title = document.createElement('p');
    title.className = 'cb-action-sheet__title';
    title.textContent = translate('command_bar.attach_label');
    sheet.appendChild(title);

    for (const label of [
      translate('command_bar.attach_photo'),
      translate('command_bar.attach_image'),
      translate('command_bar.attach_note'),
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cb-action-sheet__item cb-action-sheet__item--disabled';
      btn.disabled = true;
      const ls = document.createElement('span'); ls.textContent = label;
      const badge = document.createElement('span');
      badge.className = 'cb-action-sheet__badge';
      badge.textContent = translate('command_bar.coming_soon');
      btn.appendChild(ls); btn.appendChild(badge);
      sheet.appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'cb-action-sheet__cancel';
    cancelBtn.textContent = translate('command_bar.cancel');
    cancelBtn.addEventListener('click', dismiss);
    sheet.appendChild(cancelBtn);
    backdrop.appendChild(sheet);
    _addOverlay(backdrop);
  }

  // ── Command preview sheet ─────────────────────────────────────────
  function _showPreview(text) {
    const backdrop = document.createElement('div');
    backdrop.className = 'cb-sheet-backdrop';
    function dismiss() { _removeOverlay(backdrop); }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) dismiss(); });

    const sheet = document.createElement('div');
    sheet.className = 'cb-preview-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', translate('command_bar.preview_title'));

    const heading = document.createElement('p');
    heading.className = 'cb-preview-sheet__heading';
    heading.textContent = translate('command_bar.preview_title');
    sheet.appendChild(heading);

    const quote = document.createElement('blockquote');
    quote.className = 'cb-preview-sheet__quote';
    quote.textContent = `"${text}"`;
    sheet.appendChild(quote);

    const notice = document.createElement('p');
    notice.className = 'cb-preview-sheet__notice';
    notice.textContent = translate('command_bar.preview_notice');
    sheet.appendChild(notice);

    const actions = document.createElement('div');
    actions.className = 'cb-preview-sheet__actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cb-preview-sheet__btn cb-preview-sheet__btn--secondary';
    closeBtn.textContent = translate('command_bar.preview_close');
    closeBtn.addEventListener('click', dismiss);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cb-preview-sheet__btn cb-preview-sheet__btn--primary';
    clearBtn.textContent = translate('command_bar.preview_clear');
    clearBtn.addEventListener('click', () => {
      dismiss();
      textarea.value = '';
      _syncTextareaHeight();
    });

    actions.appendChild(closeBtn);
    actions.appendChild(clearBtn);
    sheet.appendChild(actions);
    backdrop.appendChild(sheet);
    _addOverlay(backdrop);
  }

  // ── Buttons ───────────────────────────────────────────────────────
  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'command-bar__btn command-bar__btn--attach';
  attachBtn.setAttribute('aria-label', translate('command_bar.attach_label'));
  attachBtn.textContent = '+';
  attachBtn.addEventListener('click', () => {
    if (typeof onAttach === 'function') { onAttach(); } else { _showActionSheet(); }
  });

  const textarea = document.createElement('textarea');
  textarea.className = 'command-bar__input';
  textarea.placeholder = translate('command_bar.placeholder');
  textarea.rows = 1;
  textarea.setAttribute('aria-label', translate('command_bar.input_label'));
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('spellcheck', 'false');
  textarea.addEventListener('input', _syncTextareaHeight);
  textarea.addEventListener('focus', _onFocus);
  textarea.addEventListener('blur',  _onBlur);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _handleSubmit(); }
  });

  const micBtn = document.createElement('button');
  micBtn.type = 'button';
  micBtn.className = 'command-bar__btn command-bar__btn--mic';
  micBtn.setAttribute('aria-label', translate('command_bar.mic_label'));
  micBtn.textContent = '🎙';
  micBtn.addEventListener('click', () => {
    if (typeof onMic === 'function') { onMic(); } else { _showMicToast(); }
  });

  function _handleSubmit() {
    const text = textarea.value.trim();
    if (!text) return;
    if (typeof onSubmit === 'function') { onSubmit(text); } else { _showPreview(text); }
  }

  bar.appendChild(attachBtn);
  bar.appendChild(textarea);
  bar.appendChild(micBtn);

  // ── destroy ───────────────────────────────────────────────────────
  function destroy() {
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (vv) {
      vv.removeEventListener('resize', _onVVResize);
    } else {
      window.removeEventListener('resize', _onWindowResize);
    }
    _exitKeyboardMode();
    _removeAllOverlays();
    if (bar.parentNode) bar.parentNode.removeChild(bar);
    if (dock.parentNode) dock.parentNode.removeChild(dock);
  }

  return { el: bar, destroy };
}
