// BOH OS v2 — App Shell component
// UI-06.6: Visual viewport anchor model.
//   - App Shell is position:fixed, anchored to the VISUAL viewport rect.
//   - JS tracks visualViewport.height  → --app-visible-height
//   - JS tracks visualViewport.offsetTop → --app-visible-top
//   - Both resize and scroll events are coalesced through one rAF.
//   - Result: the shell follows iOS when it pans the visual viewport
//     to reveal the focused textarea, so nothing appears to jump.
//   - Only .app-shell__main scrolls.
//   - document/body cannot scroll while shell is mounted.
//
// Returns { shell, panelStripMount, workspaceOutlet, destroy }.

/**
 * Creates the authenticated App Shell DOM element and wires the
 * visualViewport resize + scroll listeners that keep
 * --app-visible-height and --app-visible-top current.
 *
 * @param {{ appName: string, modeLabel: string, userName: string }} options
 * @returns {{
 *   shell:            HTMLElement,
 *   panelStripMount:  HTMLElement,
 *   workspaceOutlet:  HTMLElement,
 *   destroy:          () => void,    // removes vv listeners + rAF on logout
 * }}
 */
export function createAppShell({ appName, modeLabel, userName }) {

  // ── Root shell ────────────────────────────────────────────────────
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  // ── Header ────────────────────────────────────────────────────────
  const header = document.createElement('header');
  header.className = 'app-shell__header';

  const identity = document.createElement('div');
  identity.className = 'app-shell__identity';

  const nameEl = document.createElement('span');
  nameEl.className = 'app-shell__app-name';
  nameEl.textContent = appName;

  const modeEl = document.createElement('span');
  modeEl.className = 'app-shell__mode-label';
  modeEl.textContent = modeLabel;

  identity.appendChild(nameEl);
  identity.appendChild(modeEl);

  const userEl = document.createElement('div');
  userEl.className = 'app-shell__user';
  userEl.textContent = userName;

  header.appendChild(identity);
  header.appendChild(userEl);

  // ── Panel Strip ───────────────────────────────────────────────────
  const panelStripMount = document.createElement('div');
  panelStripMount.className = 'app-shell__panel-strip';

  // ── Main scroll area ──────────────────────────────────────────────
  const main = document.createElement('main');
  main.className = 'app-shell__main';

  const workspaceOutlet = document.createElement('div');
  workspaceOutlet.id = 'app-content';
  workspaceOutlet.className = 'app-shell__outlet';
  main.appendChild(workspaceOutlet);

  // ── Assemble ──────────────────────────────────────────────────────
  shell.appendChild(header);
  shell.appendChild(panelStripMount);
  shell.appendChild(main);
  // Command bar is appended by app.js after this returns.

  // ── Visual Viewport tracker ───────────────────────────────────────
  // Sets --app-visible-height and --app-visible-top on the shell element.
  //
  // --app-visible-height: visualViewport.height (rounded to integer px).
  //   Controls the shell's height so the flex column fills exactly the
  //   visible area.
  //
  // --app-visible-top: visualViewport.offsetTop (rounded to integer px).
  //   Controls the shell's CSS top so it follows iOS when it pans the
  //   visual viewport upward to reveal the focused textarea.
  //   Without this, the shell stays at the layout viewport top while
  //   iOS slides the visual viewport upward — the shell appears to jump.
  //
  // Both height and scroll events are coalesced through a single rAF.
  // Values are compared against last-written integers; unchanged values
  // are not re-applied (avoids redundant style writes during momentum
  // scrolling inside .app-shell__main).

  const vv = window.visualViewport || null;
  let _rafId  = null;
  let _lastH  = -1;
  let _lastT  = -1;   // last offsetTop written

  function _apply() {
    _rafId = null;

    const h = vv ? Math.round(vv.height)    : window.innerHeight;
    const t = vv ? Math.round(vv.offsetTop) : 0;

    if (h !== _lastH) {
      _lastH = h;
      shell.style.setProperty('--app-visible-height', h + 'px');
    }
    if (t !== _lastT) {
      _lastT = t;
      shell.style.setProperty('--app-visible-top', t + 'px');
    }
  }

  function _schedule() {
    if (_rafId !== null) return;   // already queued
    _rafId = requestAnimationFrame(_apply);
  }

  // Initialize immediately (synchronous — no rAF needed at startup)
  const initH = vv ? Math.round(vv.height)    : window.innerHeight;
  const initT = vv ? Math.round(vv.offsetTop) : 0;
  _lastH = initH;
  _lastT = initT;
  shell.style.setProperty('--app-visible-height', initH + 'px');
  shell.style.setProperty('--app-visible-top',    initT + 'px');

  // Wire listeners — both resize (keyboard open/close) and scroll
  // (iOS panning the visual viewport to reveal the focused element)
  if (vv) {
    vv.addEventListener('resize', _schedule);
    vv.addEventListener('scroll', _schedule);
  } else {
    window.addEventListener('resize', _schedule);
  }

  // ── Destroy ───────────────────────────────────────────────────────
  function destroy() {
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (vv) {
      vv.removeEventListener('resize', _schedule);
      vv.removeEventListener('scroll', _schedule);
    } else {
      window.removeEventListener('resize', _schedule);
    }
    shell.style.removeProperty('--app-visible-height');
    shell.style.removeProperty('--app-visible-top');
  }

  return { shell, panelStripMount, workspaceOutlet, destroy };
}
