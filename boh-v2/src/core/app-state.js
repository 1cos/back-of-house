// BOH OS v2 — Application state
// In-memory only. Cleared on reload. No window writes. No storage APIs.
// Provides a single controlled access point for the authenticated user.

let _currentUser = null;

/**
 * Stores the authenticated user.
 * Call once, immediately after a successful login.
 *
 * @param {{ id, name, role, language, defaultStation }} user
 */
export function setCurrentUser(user) {
  _currentUser = user;
}

/**
 * Returns the currently authenticated user, or null if not logged in.
 *
 * @returns {{ id, name, role, language, defaultStation } | null}
 */
export function getCurrentUser() {
  return _currentUser;
}

/**
 * Clears the authenticated user.
 * State returns to the pre-login condition.
 */
export function clearCurrentUser() {
  _currentUser = null;
}
