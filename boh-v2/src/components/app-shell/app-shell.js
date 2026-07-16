// BOH OS v2 — App Shell component
// WS-05: Bottom bar retired. navMount and legacyOutlet removed.
//        Single workspaceOutlet only — WorkspaceManager owns it exclusively.
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

  // ── Panel Strip mount point ──────────────────────────────────────────
  const panelStripMount = document.createElement('div');
  panelStripMount.className = 'app-shell__panel-strip';

  // ── Main ────────────────────────────────────────────────────────────
  const main = document.createElement('main');
  main.className = 'app-shell__main';

  // Single workspace outlet — WorkspaceManager writes here exclusively.
  const workspaceOutlet = document.createElement('div');
  workspaceOutlet.id = 'app-content';
  workspaceOutlet.className = 'app-shell__outlet';

  main.appendChild(workspaceOutlet);

  // ── Assemble ────────────────────────────────────────────────────────
  shell.appendChild(header);
  shell.appendChild(panelStripMount);
  shell.appendChild(main);

  return { shell, panelStripMount, workspaceOutlet };
}
