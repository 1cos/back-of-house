// BOH OS v2 — App Shell component
// Task 003A: authenticated shell structure.
// Task 003B: adds bottom navigation mount target.
// WS-01: adds panel strip mount point between header and main.
// WS-03.1: adds separate legacy router outlet (#app-content-legacy)
//           so WorkspaceManager and router never share a DOM node.
// Returns a single DOM element. Does not mount itself.
// Does not read app state. Does not query Supabase. No window writes.

/**
 * Creates the authenticated App Shell DOM element.
 *
 * @param {{ appName: string, modeLabel: string, userName: string }} options
 * @returns {{
 *   shell:            HTMLElement,
 *   panelStripMount:  HTMLElement,
 *   workspaceOutlet:  HTMLElement,   // owned by WorkspaceManager
 *   legacyOutlet:     HTMLElement,   // owned by the router
 * }}
 */
export function createAppShell({ appName, modeLabel, userName }) {
  // ── Root ────────────────────────────────────────────────────────────
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  // ── Header ──────────────────────────────────────────────────────────
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

  // ── Panel Strip mount point (WS-01) ──────────────────────────────────
  const panelStripMount = document.createElement('div');
  panelStripMount.className = 'app-shell__panel-strip';

  // ── Main ────────────────────────────────────────────────────────────
  const main = document.createElement('main');
  main.className = 'app-shell__main';

  // Workspace outlet — WorkspaceManager writes here exclusively.
  // Hidden by default; shown when a workspace panel is active.
  const workspaceOutlet = document.createElement('div');
  workspaceOutlet.id = 'app-content';
  workspaceOutlet.className = 'app-shell__outlet app-shell__outlet--workspace';

  // Legacy router outlet — the router writes here exclusively.
  // Visible by default so Station Home loads as before.
  const legacyOutlet = document.createElement('div');
  legacyOutlet.id = 'app-content-legacy';
  legacyOutlet.className = 'app-shell__outlet app-shell__outlet--legacy app-shell__outlet--visible';

  main.appendChild(workspaceOutlet);
  main.appendChild(legacyOutlet);

  // ── Bottom navigation mount target ───────────────────────────────────
  const navMount = document.createElement('div');
  navMount.className = 'app-shell__nav-mount';

  // ── Assemble ────────────────────────────────────────────────────────
  shell.appendChild(header);
  shell.appendChild(panelStripMount);
  shell.appendChild(main);
  shell.appendChild(navMount);

  return { shell, panelStripMount, workspaceOutlet, legacyOutlet };
}
