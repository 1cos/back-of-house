// BOH OS v2 — Router
// In-memory page registry. No URL changes. No history. No window writes.
// Pages are renderers: () => string (HTML to inject into the content area).

/** @type {Map<string, () => string>} */
const _pages = new Map();

/** @type {string | null} */
let _current = null;

/** @type {HTMLElement | null} */
let _outlet = null;

/**
 * Binds the router to a DOM element that will receive page content.
 * Must be called once before navigate().
 *
 * @param {HTMLElement} outlet
 */
function init(outlet) {
  _outlet = outlet;
}

/**
 * Registers a named page with its renderer function.
 * The renderer must return an HTML string.
 *
 * @param {string} name
 * @param {() => string} renderer
 */
function register(name, renderer) {
  _pages.set(name, renderer);
}

/**
 * Navigates to a registered page.
 * Calls the renderer exactly once and injects the result into the outlet.
 *
 * @param {string} name
 * @returns {boolean} true if the page was found and rendered, false otherwise
 */
function navigate(name) {
  const renderer = _pages.get(name);
  if (!renderer || !_outlet) return false;

  _current = name;
  _outlet.innerHTML = renderer();
  return true;
}

/**
 * Returns the name of the currently active page, or null.
 *
 * @returns {string | null}
 */
function current() {
  return _current;
}

export const router = { init, register, navigate, current };
