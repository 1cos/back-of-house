// BOH OS v2 — Command Bar component
// UI-06: Persistent bottom input bar for the BOH OS workspace.
//
// Anatomy: [ + ]  [ How can I help?  ]  [ 🎙 ]
//
// Phase 1 scope (this task):
//   - Visual shell and interaction container only.
//   - No Supabase. No AI. No backend. No operational actions.
//   - Submit → temporary command preview sheet (no-op).
//   - '+' → temporary action sheet with disabled future entries.
//   - Microphone → non-blocking "coming soon" toast.
//   - Expand to 3 lines on focus.
//   - Keyboard-safe on iPhone (bar stays above keyboard via position:fixed).
//   - One instance per authenticated session. destroy() cleans up fully.
//
// Integration:
//   - Mounted once at the App Shell level by app.js.
//   - Receives all callbacks via dependency injection.
//   - Returns { el, destroy }.
//
// No window writes. No storage. No router. No WorkspaceManager import.

/**
 * Creates the Command Bar DOM element and wires all interaction.
 *
 * @param {{
 *   translate:   (key: string) => string,
 *   onSubmit?:   (text: string) => void,   // future: AI / command handler
 *   onAttach?:   () => void,               // future: attachment handler
 *   onMic?:      () => void,               // future: voice handler
 * }} options
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createCommandBar({ translate, onSubmit, onAttach, onMic }) {
  // ── Overlays (action sheet, preview sheet, mic toast) ─────────────
  // These are appended to document.body so they escape any overflow:hidden.
  // destroy() removes all of them.
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

  // ── Mic toast ─────────────────────────────────────────────────────
  function _showMicToast() {
    // Remove any existing toast first
    const existing = document.querySelector('.cb-mic-toast');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const toast = document.createElement('div');
    toast.className = 'cb-mic-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = translate('command_bar.mic_coming_soon');
    _addOverlay(toast);

    // Auto-dismiss after 2.5 s
    const tid = setTimeout(() => _removeOverlay(toast), 2500);
    toast._tid = tid;
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

    function dismiss() {
      _removeOverlay(backdrop);
      // Clear the textarea when preview is explicitly dismissed via Close
    }

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
    closeBtn.addEventListener('click', () => {
      dismiss();
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cb-preview-sheet__btn cb-preview-sheet__btn--primary';
    clearBtn.textContent = translate('command_bar.preview_clear');
    clearBtn.addEventListener('click', () => {
      dismiss();
      // Clear the textarea
      textarea.value = '';
      _syncTextareaHeight();
    });

    actions.appendChild(closeBtn);
    actions.appendChild(clearBtn);
    sheet.appendChild(actions);

    backdrop.appendChild(sheet);
    _addOverlay(backdrop);
  }

  // ── Textarea auto-height ──────────────────────────────────────────
  // Shrinks/grows between 1 and 3 lines.
  function _syncTextareaHeight() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + 'px';
  }

  // ── Bar root ──────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'command-bar';
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', translate('command_bar.bar_label'));

  // ── '+' button ────────────────────────────────────────────────────
  const attachBtn = document.createElement('button');
  attachBtn.type = 'button';
  attachBtn.className = 'command-bar__btn command-bar__btn--attach';
  attachBtn.setAttribute('aria-label', translate('command_bar.attach_label'));
  attachBtn.textContent = '+';
  attachBtn.addEventListener('click', () => {
    if (typeof onAttach === 'function') {
      onAttach();
    } else {
      _showActionSheet();
    }
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
  // Microphone unicode glyph — visually clear, no external dependency
  micBtn.textContent = '🎙';
  micBtn.addEventListener('click', () => {
    if (typeof onMic === 'function') {
      onMic();
    } else {
      _showMicToast();
    }
  });

  // ── Submit handler ────────────────────────────────────────────────
  function _handleSubmit() {
    const text = textarea.value.trim();
    if (!text) return;

    if (typeof onSubmit === 'function') {
      onSubmit(text);
    } else {
      _showPreview(text);
    }
  }

  // ── Assemble ──────────────────────────────────────────────────────
  bar.appendChild(attachBtn);
  bar.appendChild(textarea);
  bar.appendChild(micBtn);

  // ── destroy ───────────────────────────────────────────────────────
  function destroy() {
    _removeAllOverlays();
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }

  return { el: bar, destroy };
}
