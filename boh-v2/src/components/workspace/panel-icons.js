// BOH OS v2 — Panel Icons
// Maps workspace panel type strings to display glyphs.
// WS-02: panel strip icon support.
// Pure data module. No side effects.

/** @type {Record<string, string>} */
export const PANEL_ICONS = {
  'home':            '🏠',
  'station-prep':    '🍳',
  'station-recipes': '📖',
  'recipe-detail':   '📋',
  'journal':         '📓',
  'schedule':        '📅',
};

/**
 * Returns the icon glyph for the given panel type.
 * Falls back to '□' for unknown types so the strip never shows
 * raw undefined.
 *
 * @param {string} type
 * @returns {string}
 */
export function iconForType(type) {
  return PANEL_ICONS[type] ?? '□';
}
