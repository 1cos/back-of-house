// BOH OS v2 — App Shell component
// Task 003A: authenticated shell structure.
// Task 003B: adds bottom navigation mount target.
// WS-01: adds panel strip mount point between header and main.
// Returns a single DOM element. Does not mount itself.
// Does not read app state. Does not query Supabase. No window writes.
// Does not import or create the bottom navigation — only provides the mount point.
// Does not import or create the WorkspaceManager — only provides the panelStripMount.

/**
 * Creates the authenticated App Shell DOM element.
 *
 * @param {{ appName: string, modeLabel: string, userName: string }} options
 * @returns {{ shell: HTMLElement, panelStripMount: HTMLElement }}
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
  // User name inserted as textContent — never innerHTML.
  userEl.textContent = userName;

  header.appendChild(identity);
  header.appendChild(userEl);

  // ── Panel Strip mount point (WS-01) ──────────────────────────────────
  // Positioned after the header, before the main content area.
  // The WorkspaceManager mounts the rendered strip here.
  // Initially empty — zero height until the first strip is rendered.
  const panelStripMount = document.createElement('div');
  panelStripMount.className = 'app-shell__panel-strip';

  // ── Main ────────────────────────────────────────────────────────────
  const main = document.createElement('main');
  main.className = 'app-shell__main';

  const outlet = document.createElement('div');
  outlet.id = 'app-content';

  main.appendChild(outlet);

  // ── Bottom navigation mount target ───────────────────────────────────
  // The App Shell provides the mount point only.
  // The navigation component is created and appended by app.js.
  const navMount = document.createElement('div');
  navMount.className = 'app-shell__nav-mount';

  // ── Assemble ────────────────────────────────────────────────────────
  shell.appendChild(header);
  shell.appendChild(panelStripMount);   // WS-01: strip lives here
  shell.appendChild(main);
  shell.appendChild(navMount);

  // Return both the shell element and the strip mount point so
  // app.js can pass panelStripMount to createWorkspaceManager.
  return { shell, panelStripMount };
}
