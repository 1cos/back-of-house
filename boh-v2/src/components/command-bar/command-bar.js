// BOH OS v2 — Command Bar component
// UI-06.2: Stable keyboard dock for iOS Safari.
//
// ROOT CAUSE OF UI-06.1 GAP + JITTER:
//
//   1. bottom-anchoring is unstable during keyboard animation.
//      bar.style.bottom = keyboardOffset means the bar's LOWER edge
//      is keyboardOffset px above the layout-viewport bottom. But the
//      keyboard's upper edge is also moving during animation. On any
//      frame where vv.height sample lags behind the actual keyboard
//      position, a fractional-pixel gap appears. Nothing fills it.
//
//   2. visualViewport 'scroll' fires on every px the user scrolls
//      the Prep list. vv.offsetTop changes on each scroll, which
//      re-wrote bar.style.bottom on every scroll event → oscillation.
//
//   3. _applyScrollInset() was called on every scroll event, causing
//      layout thrash and potential cumulative padding growth.
//
//   4. No dock/scrim element: during keyboard animation frames the
//      gap between bar bottom and keyboard top shows page content.
//
// FIX (UI-06.2):
//
//   POSITIONING: switch to `top` while keyboard is open.
//     barTop = vv.offsetTop + vv.height - barHeight
//   This is a layout-viewport-absolute position for the bar's top edge.
//   It is stable across vv.offsetTop changes (Prep scroll) because
//   offsetTop is already included in the formula. No re-write needed
//   on scroll — only on resize (keyboard open/close/height change).
//
//   DOCK SCRIM: a `position:fixed` element that sits below the bar,
//   filling from bar bottom → screen bottom (full safe-area height).
//   Same background as the bar. Covers any gap during animation.
//   Inserted into document.body; removed when keyboard closes.
//
//   RAF COALESCING: resize events request a single rAF; multiple
//   events in one frame collapse to one write.
//
//   JITTER GUARD: skip the write if new top differs < 1px from last.
//
//   SCROLL LISTENER REMOVED: vv 'scroll' is not needed and caused
//   the oscillation. resize() covers all keyboard state changes.
//
// INVARIANTS:
//   - One instance per authenticated session.
//   - destroy() removes ALL listeners, overlays, dock, inline styles.
//   - No Supabase. No AI. No WorkspaceManager. No router.
//   - Returns { el, destroy }.

/**
 * Creates the Command Bar DOM element and wires all interaction.
 *
 * @param {{
 *   translate:     (key: string) => string,
 *   scrollTarget?: HTMLElement,  // the real scroll container (.app-shell__main)
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

  // ── Dock scrim ────────────────────────────────────────────────────
  // Fills the space between bar's bottom edge and physical screen bottom
  // while keyboard is open. Prevents page content showing through gaps
  // during keyboard animation.
  const dock = document.createElement('div');
  dock.className = 'command-bar-dock';
  // Not added to DOM until keyboard opens.

  // ── Textarea auto-height ──────────────────────────────────────────
  function _syncTextareaHeight() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
  }

  // ── visualViewport keyboard handling ──────────────────────────────
  //
  // POSITIONING FORMULA (keyboard-open mode):
  //   barTop = vv.offsetTop + vv.height - barHeight
  //
  //   bar.style.top  = barTop + 'px'
  //   bar.style.bottom = 'auto'   (override the CSS bottom:0)
  //
  //   dock.style.top    = (barTop + barHeight) + 'px'
  //   dock.style.bottom = '0'
  //   dock.style.height = 'auto'   (stretches from dock top to 0)
  //
  // When keyboard closes:
  //   bar.style.top = bar.style.bottom = ''  (CSS bottom:0 takes over)
  //   dock removed from DOM

  const vv = window.visualViewport || null;

  let _keyboardOpen  = false;
  let _rafId         = null;
  let _lastBarTop    = -1;          // jitter guard
  let _scrollViewDone = false;      // scrollIntoView guard: fire at most once per focus

  function _getBarHeight() {
    // Use offsetHeight (layout height, no sub-pixel issues).
    return bar.offsetHeight || 60;
  }

  function _applyDock(barTop, barH) {
    const dockTop = barTop + barH;
    dock.style.top    = dockTop + 'px';
    dock.style.left   = '0';
    dock.style.right  = '0';
    dock.style.bottom = '0';
    dock.style.position = 'fixed';
    if (!dock.parentNode) document.body.appendChild(dock);
  }

  function _removeDock() {
    if (dock.parentNode) dock.parentNode.removeChild(dock);
  }

  function _applyScrollInset(barH, keyboardH) {
    const target = scrollTarget || bar.parentNode;
    if (!target) return;
    // Total inset = bar height + keyboard height above layout-viewport bottom.
    // We add sp-4 (16px) for visual breathing room.
    const inset = barH + keyboardH + 16;
    target.style.paddingBottom = inset + 'px';
  }

  function _resetScrollInset() {
    const target = scrollTarget || bar.parentNode;
    if (!target) return;
    target.style.paddingBottom = '';
  }

  function _enterKeyboardMode() {
    if (!vv) return;

    const layoutH = window.innerHeight;
    const barH    = _getBarHeight();
    const kbH     = Math.max(0, layoutH - vv.offsetTop - vv.height);
    const barTop  = Math.round(vv.offsetTop + vv.height - barH);

    // Jitter guard: skip if < 1px change
    if (Math.abs(barTop - _lastBarTop) < 1 && _keyboardOpen) return;
    _lastBarTop = barTop;

    // Switch bar from bottom-anchored to top-anchored
    bar.style.bottom = 'auto';
    bar.style.top    = barTop + 'px';

    // Fill the gap below the bar
    _applyDock(barTop, barH);

    // Update scroll container
    _applyScrollInset(barH, kbH);
  }

  function _exitKeyboardMode() {
    _lastBarTop = -1;
    // Restore CSS-driven bottom:0 positioning
    bar.style.top    = '';
    bar.style.bottom = '';
    // Remove dock
    _removeDock();
    // Restore scroll container
    _resetScrollInset();
  }

  // ── rAF-coalesced viewport update ─────────────────────────────────
  function _scheduleUpdate() {
    if (_rafId !== null) return;  // already scheduled
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      if (!vv) return;

      const layoutH = window.innerHeight;
      const kbH     = Math.max(0, layoutH - vv.offsetTop - vv.height);

      if (kbH > 50) {
        // Keyboard is open (or opening)
        if (!_keyboardOpen) {
          _keyboardOpen = true;
        }
        _enterKeyboardMode();
      } else {
        // Keyboard closed (or fully closed)
        if (_keyboardOpen) {
          _keyboardOpen = false;
          _exitKeyboardMode();
        }
      }
    });
  }

  function _onVVResize() {
    _scheduleUpdate();
  }

  // Fallback for browsers without visualViewport
  function _onWindowResize() {
    // No reliable keyboard detection — static CSS handles it.
  }

  // ── Focus / blur ──────────────────────────────────────────────────
  function _onFocus() {
    _scrollViewDone = false;
    if (vv) {
      // After keyboard is up (≈300ms), scroll the textarea into view
      // but only once per focus event and only if actually obscured.
      setTimeout(() => {
        if (document.activeElement !== textarea) return;
        if (_scrollViewDone) return;
        _scrollViewDone = true;
        const rect = textarea.getBoundingClientRect();
        const vvBottom = vv.offsetTop + vv.height;
        if (rect.bottom > vvBottom - 4) {
          textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 320);
    }
  }

  function _onBlur() {
    // Do nothing here. _scheduleUpdate handles keyboard close via resize.
    _scrollViewDone = false;
  }

  // Wire viewport listener — resize only (no scroll)
  if (vv) {
    vv.addEventListener('resize', _onVVResize);
  } else {
    window.addEventListener('resize', _onWindowResize);
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
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      const badge = document.createElement('span');
      badge.className = 'cb-action-sheet__badge';
      badge.textContent = translate('command_bar.coming_soon');
      btn.appendChild(labelSpan);
      btn.appendChild(badge);
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

  // ── '+' button ────────────────────────────────────────────────────
  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'command-bar__btn command-bar__btn--attach';
  attachBtn.setAttribute('aria-label', translate('command_bar.attach_label'));
  attachBtn.textContent = '+';
  attachBtn.addEventListener('click', () => {
    if (typeof onAttach === 'function') { onAttach(); } else { _showActionSheet(); }
  });

  // ── Textarea ──────────────────────────────────────────────────────
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

  // ── Mic button ────────────────────────────────────────────────────
  const micBtn = document.createElement('button');
  micBtn.type = 'button';
  micBtn.className = 'command-bar__btn command-bar__btn--mic';
  micBtn.setAttribute('aria-label', translate('command_bar.mic_label'));
  micBtn.textContent = '🎙';
  micBtn.addEventListener('click', () => {
    if (typeof onMic === 'function') { onMic(); } else { _showMicToast(); }
  });

  // ── Submit ────────────────────────────────────────────────────────
  function _handleSubmit() {
    const text = textarea.value.trim();
    if (!text) return;
    if (typeof onSubmit === 'function') { onSubmit(text); } else { _showPreview(text); }
  }

  // ── Assemble ──────────────────────────────────────────────────────
  bar.appendChild(attachBtn);
  bar.appendChild(textarea);
  bar.appendChild(micBtn);

  // ── destroy ───────────────────────────────────────────────────────
  function destroy() {
    // Cancel any pending rAF
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }

    // Remove viewport listener
    if (vv) {
      vv.removeEventListener('resize', _onVVResize);
    } else {
      window.removeEventListener('resize', _onWindowResize);
    }

    // Exit keyboard mode cleanly
    _exitKeyboardMode();

    // Remove dock
    _removeDock();

    // Remove overlays
    _removeAllOverlays();

    // Remove bar
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }

  return { el: bar, destroy };
}
