// BOH OS Workspace — Permissions
// Demo only: roles are set via role switcher, not from DB.
// ──────────────────────────────────────────────────────────────────────────────

export const ROLES = ['executive', 'lead', 'coordinator', 'cook', 'dish_crew', 'viewer'];

const PERMISSIONS = {
  // Navigation
  can_see_home:           ['executive','lead','coordinator','cook','dish_crew','viewer'],
  can_see_bot_center:     ['executive','lead'],
  can_see_recipes:        ['executive','lead','coordinator','cook'],
  can_see_inventory:      ['executive','lead','coordinator'],
  can_see_pos:            ['executive','lead'],
  can_see_journal:        ['executive','lead','coordinator','viewer'],

  // Recipes
  can_view_bom:           ['executive','lead'],
  can_edit_recipes:       ['executive'],

  // Financial (NEVER for cook/dish_crew/viewer)
  can_view_food_cost:     ['executive'],
  can_view_margins:       ['executive'],
  can_view_prices:        ['executive','lead'],

  // Bots
  can_run_bots:           ['executive'],
  can_view_bot_logs:      ['executive','lead'],

  // Journal
  can_add_journal:        ['executive','lead','coordinator'],

  // Admin
  can_manage_users:       ['executive'],
};

/** Active role stored in sessionStorage (demo only, not from DB) */
export function getRole() {
  return sessionStorage.getItem('ws_demo_role') || 'executive';
}

export function setRole(role) {
  if (!ROLES.includes(role)) return;
  sessionStorage.setItem('ws_demo_role', role);
  document.dispatchEvent(new CustomEvent('ws:rolechange', { detail: { role } }));
}

/**
 * Returns true if the current demo role has the given permission.
 * @param {string} permission
 */
export function can(permission) {
  const role = getRole();
  return (PERMISSIONS[permission] ?? []).includes(role);
}
