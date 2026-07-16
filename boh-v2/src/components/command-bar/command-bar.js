// BOH OS v2 — Command Bar component
// UI-06: Persistent bottom command input bar.
// UI-06.1: visualViewport keyboard fix for iOS Safari.
//
// ROOT CAUSE OF ORIGINAL BUG:
//   position:fixed anchors to the LAYOUT viewport in iOS Safari.
//   When the software keyboard opens, the visual viewport shrinks but
//   the layout viewport does NOT. So bottom:0 on a fixed element
//   sits behind the keyboard. The "fixed rises with keyboard" assumption
//   only holds in older iOS behaviour and is not reliable.
//
// FIX (UI-06.1):
//   Use window.visualViewport when available. On resize/scroll, compute:
//     barBottom = layoutViewportHeight - (vv.offsetTop + vv.height)
//   and apply it as `bar.style.bottom`. This pins the bar to the VISUAL
//   viewport bottom — i.e., right above the keyboard at all times.
//
//   The real scroll container (.app-shell__main) receives a CSS variable
//   --cb-bottom-inset that matches the current bar height + keyboard offset,
//   so the last Prep card is always reachable.
//
// ANATOMY: [ + ]  [ How can I help?  ]  [ 🎙 ]
//
// INVARIANTS:
//   - One instance per authenticated session.
//   - destroy() removes ALL listeners, overlays, inline styles, CSS vars.
//   - No Supabase. No AI. No WorkspaceManager. No router.
//   - All callbacks via dependency injection.
//   - Returns { el, destroy }.

/**
 * Creates the Command Bar DOM element and wires all interaction.
 *
 * @param {{
 *   translate:    (key: string) => string,
 *   scrollTarget?: HTMLElement,  // the real scroll container; receives --cb-bottom-inset
 *   onSubmit?:   (text: string) => void,
 *   onAttach?:   () => void,
 *   onMic?:      () => void,
 * }} options
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createCommandBar({ translate, scrollTarget, onSubmit, onAttach, onMic }) {

  // ── Overlays registry ─────────────────────────────────────────────
  const _overlays = new Set();

  function _addOverlay(el) {
    document.body.appendChild(el);
    _overlays.add(el);
  }
  function _removeOverlay(el) {
    if (el.parentNode) el.parentNode.removeChild(el);
    _overlays.delete(el);
  }
  function _removeAllOverlays() {
    for (const el of _overlays) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    _overlays.clear();
  }

  // ── Bar root ──────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'command-bar';
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', translate('command_bar.bar_label'));

  // ── Textarea auto-height ──────────────────────────────────────────
  function _syncTextareaHeight() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
  }

  // ── visualViewport keyboard handling ─────────────────────────────
  //
  // STRATEGY:
  //   Normal state  → bar.style.bottom = '' (CSS position:fixed bottom:0 owns it)
  //   Keyboard open → bar.style.bottom = `${offsetFromLayoutBottom}px`
  //
  // layoutViewportHeight = window.innerHeight (the full layout viewport, fixed).
  // vv.height      = the visible part of the layout viewport (shrinks with keyboard).
  // vv.offsetTop   = how many px of the layout viewport are above the visual viewport
  //                  (usually 0 on iPhone; non-zero when the page is scrolled above).
  //
  // The bar needs to sit at the BOTTOM of the visual viewport:
  //   bar.style.bottom = (layoutViewportHeight - vv.offsetTop - vv.height) + 'px'
  //
  // When keyboard is fully closed: vv.offsetTop + vv.height ≈ window.innerHeight
  // → bottom ≈ 0 → same as CSS default. Clean restore.
  //
  // Bottom inset for scroll container:
  //   The bar's rendered height + the keyboard compensation.
  //   We use bar.getBoundingClientRect().height after each update.

  const vv = window.visualViewport || null;

  function _getBarHeight() {
    return bar.getBoundingClientRect().height || 60;
  }

  function _updateViewport() {
    if (!vv) return;

    const layoutH = window.innerHeight;
    const keyboardOffset = Math.max(0, layoutH - vv.offsetTop - vv.height);

    // Reposition bar above the keyboard
    bar.style.bottom = keyboardOffset + 'px';

    // Update scroll-container inset
    const inset = _getBarHeight() + keyboardOffset;
    _applyScrollInset(inset);
  }

  function _applyScrollInset(pxValue) {
    // Set on the real scroll container if provided, otherwise fall back to bar's parent.
    const target = scrollTarget || bar.parentNode;
    if (!target) return;
    target.style.setProperty('--cb-bottom-inset', pxValue + 'px');
    // Also set padding-bottom directly so it works without the CSS var support
    target.style.paddingBottom = `calc(${pxValue}px + max(var(--sp-4), env(safe-area-inset-bottom, 0px)))`;
  }

  function _resetViewport() {
    bar.style.bottom = '';
    const target = scrollTarget || bar.parentNode;
    if (!target) return;
    target.style.removeProperty('--cb-bottom-inset');
    // Restore the static CSS padding-bottom (set in command-bar.css)
    target.style.paddingBottom = '';
  }

  // Track whether keyboard is open to avoid double-resets
  let _keyboardOpen = false;

  function _onVVResize() {
    if (!vv) return;
    const layoutH = window.innerHeight;
    const keyboardOffset = Math.max(0, layoutH - vv.offsetTop - vv.height);

    if (keyboardOffset > 50) {
      // Keyboard is open
      _keyboardOpen = true;
      _updateViewport();
    } else {
      // Keyboard closed
      if (_keyboardOpen) {
        _keyboardOpen = false;
        _resetViewport();
      }
    }
  }

  // visualViewport scroll fires when the user pans inside the keyboard area
  function _onVVScroll() {
    if (_keyboardOpen) _updateViewport();
  }

  // Fallback for browsers without visualViewport
  function _onWindowResize() {
    if (vv) return; // handled by vv events
    // No reliable keyboard detection without vv — do nothing to avoid jitter.
    // The static CSS bottom:0 remains in effect.
  }

  // ── Focus / blur ──────────────────────────────────────────────────
  // On focus: small delay to let the keyboard finish animating before
  // scrollIntoView, so we don't fight the animation.

  function _onFocus() {
    if (vv) {
      // The resize event will fire once the keyboard is up.
      // scrollIntoView after a short delay so the bar is already repositioned.
      setTimeout(() => {
        if (document.activeElement === textarea) {
          textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 350);
    }
  }

  function _onBlur() {
    // Blur fires BEFORE the keyboard fully closes.
    // The visualViewport resize will fire when the keyboard is actually gone
    // and _onVVResize will call _resetViewport() at the right time.
    // No eager reset here — avoids layout flash.
  }

  // Wire viewport listeners
  if (vv) {
    vv.addEventListener('resize', _onVVResize);
    vv.addEventListener('scroll', _onVVScroll);
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

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) dismiss();
    });

    const sheet = document.createElement('div');
    sheet.className = 'cb-action-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', translate('command_bar.attach_label'));

    const title = document.createElement('p');
    title.className = 'cb-action-sheet__title';
    title.textContent = translate('command_bar.attach_label');
    sheet.appendChild(title);

    const entries = [
      translate('command_bar.attach_photo'),
      translate('command_bar.attach_image'),
      translate('command_bar.attach_note'),
    ];

    for (const label of entries) {
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

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) dismiss();
    });

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      _handleSubmit();
    }
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
    // Remove viewport listeners
    if (vv) {
      vv.removeEventListener('resize', _onVVResize);
      vv.removeEventListener('scroll', _onVVScroll);
    } else {
      window.removeEventListener('resize', _onWindowResize);
    }

    // Reset scroll container styles
    _resetViewport();

    // Remove overlays
    _removeAllOverlays();

    // Remove bar from DOM
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }

  return { el: bar, destroy };
}
