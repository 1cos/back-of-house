// BOH OS v2 — i18n core
// Minimal implementation for Task 002A: English only, no DOM engine, no localStorage.
// API: t(key) → string

import { en } from '../locales/en.js';

/**
 * Returns the translated string for the given key.
 * Falls back to the key itself when no translation exists.
 *
 * @param {string} key - Translation key, e.g. 'app.name'
 * @returns {string}
 */
export function t(key) {
  return Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key;
}
