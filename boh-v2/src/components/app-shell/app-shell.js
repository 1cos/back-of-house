// BOH OS v2 — App Shell component
// Task 003A: authenticated shell structure.
// Task 003B: adds bottom navigation mount target.
// Returns a single DOM element. Does not mount itself.
// Does not read app state. Does not query Supabase. No window writes.
// Does not import or create the bottom navigation — only provides the mount point.

/**
 * Creates the authenticated App Shell DOM element.
 *
 * @param {{ appName: string, modeLabel: string, userName: string }} options
 * @returns {HTMLElement}
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
  shell.appendChild(main);
  shell.appendChild(navMount);

  return shell;
}
