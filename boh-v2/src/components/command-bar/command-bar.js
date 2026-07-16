// BOH OS v2 — Command Bar component
// UI-06.4: CSS-first. Zero JS keyboard positioning.
//
// HISTORY OF FAILURES AND WHY THEY FAILED:
//
//   UI-06.1  bar.style.bottom = window.innerHeight - vv.offsetTop - vv.height
//            ✗ vv.scroll listener rewrote on every Prep scroll → vibration
//
//   UI-06.2  bar.style.top = vv.offsetTop + vv.height - barH
//            ✗ vv.offsetTop changes during scroll → vibration
//
//   UI-06.3  bar.style.bottom = window.innerHeight - vv.height  (capture-once)
//            ✗ COORDINATE SPACE BUG: in PWA standalone mode, window.innerHeight
//              includes safe-area/status-bar space that vv.height does not.
//              e.g. iPhone 14 Pro: innerHeight=932, vv.height(keyboard)=390
//              → dockHeight=542px → bar jumps 200px above keyboard → huge gap.
//              window.innerHeight and visualViewport.height are not comparable.
//
// CORRECT APPROACH (UI-06.4):
//
//   position:fixed; bottom:0 in CSS only.
//
//   iOS Safari (both browser and installed PWA) raises position:fixed elements
//   when the software keyboard opens — PROVIDED the JS does not fight it with
//   simultaneous inline style writes. Every previous fix was actively preventing
//   the browser's correct native behavior by writing conflicting bottom/top values.
//
//   With all JS keyboard positioning removed, the browser handles it correctly:
//   - bar stays attached above the keyboard
//   - Prep content scrolls behind the bar
//   - keyboard close restores the bar to bottom
//
//   JS ROLE (minimal):
//   - Add .command-bar--focused class on textarea focus (for optional CSS styling)
//   - Remove it on blur
//   - Call scrollIntoView once on focus if the bar is obscured
//   - No visualViewport listeners
//   - No continuous position writes
//   - No dock element
//   - No keyboard-height math
//
//   SCROLL CONTAINER PADDING:
//   Static CSS only. No JS-written padding. Bar height ≈ 60px + safe-area.
//   The CSS in command-bar.css sets padding-bottom on .app-shell__main.
//
//   DIAGNOSTICS:
//   A hidden diagnostic logger is included. Activate by setting:
//     localStorage.setItem('cb_diag', '1')
//   in Safari console before focusing the input. On first focus, it logs
//   window.innerHeight, documentElement.clientHeight, vv.height, vv.offsetTop,
//   vv.pageTop, bar.getBoundingClientRect(), and display-mode to console.
//   It does NOT produce any visible UI in production.
//
// INVARIANTS:
//   - One instance per session. destroy() removes all listeners.
//   - No Supabase, no AI, no router, no WorkspaceManager.
//   - Returns { el, destroy }.

/**
 * @param {{
 *   translate:     (key: string) => string,
 *   scrollTarget?: HTMLElement,   // kept for API compat; not used for padding
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

  // ── Textarea height sync ──────────────────────────────────────────
  function _syncTextareaHeight() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
  }

  // ── Diagnostics (dev only — activate via localStorage) ────────────
  // Does nothing unless localStorage.getItem('cb_diag') === '1'.
  // No visible UI. Console output only.
  let _diagFired = false;

  function _runDiagnostics() {
    try {
      if (localStorage.getItem('cb_diag') !== '1') return;
      if (_diagFired) return;
      _diagFired = true;

      const vv  = window.visualViewport || null;
      const dm  = window.matchMedia('(display-mode: standalone)').matches
                    ? 'standalone/PWA'
                    : window.matchMedia('(display-mode: browser)').matches
                      ? 'browser'
                      : 'unknown';

      console.group('[CB-DIAG] Command Bar focus diagnostics');
      console.log('display-mode:               ', dm);
      console.log('window.innerHeight:         ', window.innerHeight);
      console.log('documentElement.clientHeight:', document.documentElement.clientHeight);
      console.log('document.body.clientHeight: ', document.body.clientHeight);
      if (vv) {
        console.log('visualViewport.height:      ', vv.height);
        console.log('visualViewport.offsetTop:   ', vv.offsetTop);
        console.log('visualViewport.pageTop:     ', vv.pageTop);
        console.log('visualViewport.width:       ', vv.width);
        console.log('visualViewport.scale:       ', vv.scale);
      } else {
        console.log('visualViewport:              not available');
      }
      console.log('bar.getBoundingClientRect():', bar.getBoundingClientRect());
      console.log('bar.offsetHeight:           ', bar.offsetHeight);
      console.groupEnd();
    } catch (_) {
      // Diagnostics must never throw in production
    }
  }

  // ── Focus / blur ──────────────────────────────────────────────────
  let _scrollViewDone = false;

  function _onFocus() {
    _scrollViewDone = false;
    bar.classList.add('command-bar--focused');

    // Run diagnostics (dev only)
    _diagFired = false;
    setTimeout(_runDiagnostics, 600);

    // Single scrollIntoView, only if input is actually below the visible area.
    // Fires after keyboard has time to settle (500ms).
    // Uses the bar element, not the textarea, so the whole bar is revealed.
    setTimeout(() => {
      if (document.activeElement !== textarea) return;
      if (_scrollViewDone) return;
      _scrollViewDone = true;
      const rect = bar.getBoundingClientRect();
      const vv   = window.visualViewport || null;
      // Check if bar's bottom is below the visual viewport bottom
      const vvBottom = vv ? vv.pageTop + vv.height : window.innerHeight;
      if (rect.bottom > vvBottom - 4) {
        bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 500);
  }

  function _onBlur() {
    _scrollViewDone = false;
    bar.classList.remove('command-bar--focused');
    // No position writes. CSS bottom:0 is always in effect.
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
  // No visualViewport listeners to remove — we never added any.
  // Clear focused class, remove overlays, remove bar.
  function destroy() {
    bar.classList.remove('command-bar--focused');
    _removeAllOverlays();
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }

  return { el: bar, destroy };
}
