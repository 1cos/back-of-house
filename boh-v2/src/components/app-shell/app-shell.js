// BOH OS v2 — App Shell component
// UI-06.5: Contained viewport model.
//   - App Shell is a contained flex column sized to visualViewport.height.
//   - Command Bar is the final flex child (not position:fixed).
//   - Only .app-shell__main scrolls.
//   - document/body cannot scroll while shell is mounted.
//
// Returns { shell, panelStripMount, workspaceOutlet }.
// Also returns { destroy } to remove the visualViewport listener on logout.

/**
 * Creates the authenticated App Shell DOM element and wires the
 * visualViewport resize listener that keeps --app-visible-height current.
 *
 * @param {{ appName: string, modeLabel: string, userName: string }} options
 * @returns {{
 *   shell:            HTMLElement,
 *   panelStripMount:  HTMLElement,
 *   workspaceOutlet:  HTMLElement,
 *   destroy:          () => void,    // removes vv listener + rAF on logout
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

  // ── Command Bar slot ──────────────────────────────────────────────
  // The command bar placeholder slot — app.js appends the real bar here.
  // This is just the structural position; the bar element is appended by
  // app.js via shell.appendChild(_commandBar.el) AFTER this function returns.
  // The flex order is: header → panelStrip → main(flex:1) → commandBar.

  // ── Assemble ──────────────────────────────────────────────────────
  shell.appendChild(header);
  shell.appendChild(panelStripMount);
  shell.appendChild(main);
  // Command bar is appended by app.js after this returns.

  // ── visualViewport height tracker ─────────────────────────────────
  // Sets --app-visible-height on the shell element.
  // This is the ONLY visualViewport interaction in the entire app.
  // No scroll listener. No keyboard geometry. No offsets.
  // Only HEIGHT is tracked, and only when it changes materially (> 20px).

  const vv = window.visualViewport || null;
  let _rafId     = null;
  let _lastH     = -1;
  const THRESHOLD = 20; // px — ignore tiny changes (address bar micro-collapse)

  function _applyHeight(h) {
    shell.style.setProperty('--app-visible-height', h + 'px');
  }

  function _onVVResize() {
    if (_rafId !== null) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      const h = vv ? Math.round(vv.height) : window.innerHeight;
      if (Math.abs(h - _lastH) < THRESHOLD) return; // sub-threshold → ignore
      _lastH = h;
      _applyHeight(h);
    });
  }

  // Initialize immediately
  const initialH = vv ? Math.round(vv.height) : window.innerHeight;
  _lastH = initialH;
  _applyHeight(initialH);

  // Wire listener
  if (vv) {
    vv.addEventListener('resize', _onVVResize);
  } else {
    window.addEventListener('resize', _onVVResize);
  }

  // ── Destroy ───────────────────────────────────────────────────────
  function destroy() {
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (vv) {
      vv.removeEventListener('resize', _onVVResize);
    } else {
      window.removeEventListener('resize', _onVVResize);
    }
    shell.style.removeProperty('--app-visible-height');
  }

  return { shell, panelStripMount, workspaceOutlet, destroy };
}
