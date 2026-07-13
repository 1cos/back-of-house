// BOH OS v2 — Permissions
// Pure module. No side effects. No network. No storage. No UI.
// Export: can(permission, user) → boolean

// ── Role normalization ───────────────────────────────────────────────
// Private. Converts raw role strings from the database to canonical form.

function normalizeRole(raw) {
  if (typeof raw !== 'string') return null;
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// ── Permission matrix ────────────────────────────────────────────────
// Explicit table: permission → set of roles that hold it.
// Not exported. Add permissions here when approved.

const MATRIX = {
  view_station_mode:   new Set(['admin', 'executive_chef', 'supervisor', 'staff']),
  view_executive_mode: new Set(['admin', 'executive_chef', 'supervisor']),
  view_studio:         new Set(['admin']),
  manage_prep:         new Set(['admin', 'executive_chef', 'supervisor']),
  manage_recipes:      new Set(['admin', 'executive_chef']),
  view_food_cost:      new Set(['admin', 'executive_chef']),
};

// ── Public API ───────────────────────────────────────────────────────

/**
 * Returns true when the given user holds the named permission.
 * Returns false for any invalid, unknown, or missing input.
 *
 * @param {string} permission
 * @param {{ role?: string } | null | undefined} user
 * @returns {boolean}
 */
export function can(permission, user) {
  if (!user || !user.role) return false;

  const roles = MATRIX[permission];
  if (!roles) return false;

  return roles.has(normalizeRole(user.role));
}
