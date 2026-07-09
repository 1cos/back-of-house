// BOH OS Workspace — i18n Engine
// ──────────────────────────────────────────────────────────────────────────────

import { translations } from './translations.js';

const SUPPORTED = ['it', 'en', 'es'];
const DEFAULT   = 'it';

/** Returns the currently active language code */
export function getLang() {
  return sessionStorage.getItem('ws_lang') || DEFAULT;
}

/** Sets the active language and triggers a full re-render */
export function setLang(code) {
  if (!SUPPORTED.includes(code)) return;
  sessionStorage.setItem('ws_lang', code);
  document.dispatchEvent(new CustomEvent('ws:langchange', { detail: { lang: code } }));
}

/**
 * Translate a key with optional interpolation params.
 * Falls back: requested lang → 'it' → raw key
 *
 * @param {string} key   e.g. 'tab.recipe'
 * @param {Object} params  e.g. { name: 'Tiramisu' }
 * @returns {string}
 */
export function t(key, params = {}) {
  const lang = getLang();
  const str =
    translations[lang]?.[key] ??
    translations[DEFAULT]?.[key] ??
    key;
  return str.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

/** Retranslate all elements with data-t attribute */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-t]').forEach(el => {
    const key    = el.dataset.t;
    const params = el.dataset.tParams ? JSON.parse(el.dataset.tParams) : {};
    const attr   = el.dataset.tAttr;
    const text   = t(key, params);
    if (attr) {
      el.setAttribute(attr, text);
    } else {
      el.textContent = text;
    }
  });
  root.querySelectorAll('[data-t-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.tPlaceholder);
  });
}
