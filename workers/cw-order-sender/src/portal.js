'use strict';
// XCF-CW — Chef's Warehouse via Playwright, profilo Chrome persistente e
// locale (come bek-entree-sync). Nessuna password e nessun cookie passano
// da qui: la sessione vive solo nel profilo sul Mac Mini, Max la apre con
// cw-login.command. Le chiamate partono DALL'INTERNO della pagina CW
// (stessa sessione, stessi header del sito), con redirect:'manual': un
// rimando al login e' AuthExpired, non un errore generico.

const { chromium } = require('playwright-core');
const { AuthExpired } = require('./cw');

const BASE = 'https://order.chefswarehouse.com';

async function openContext(profileDir, { headless = false } = {}) {
  return chromium.launchPersistentContext(profileDir, {
    channel: 'chrome', headless, viewport: { width: 1400, height: 900 }, acceptDownloads: false,
  });
}

async function openPage(context) {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  return page;
}

function pageApi(page, { timeoutMs = 45000 } = {}) {
  const call = async (method, path, body) => {
    const r = await page.evaluate(async ({ method, path, body, timeoutMs }) => {
      if (location.hostname !== 'order.chefswarehouse.com') return { __auth: true, why: 'pagina fuori dal portale' };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetch(path, { method, credentials: 'same-origin', redirect: 'manual', signal: ctl.signal,
          headers: Object.assign({ Accept: 'application/json' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          body: body !== undefined ? JSON.stringify(body) : undefined });
        if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) return { __auth: true, why: 'rimando al login (' + res.status + ')' };
        const t = await res.text();
        if (!res.ok) return { __error: method + ' ' + path + ': ' + res.status };
        if (!t) return { __empty: true };
        try { return { __json: JSON.parse(t) }; } catch (e) { return { __auth: true, why: 'risposta non JSON (' + res.status + ')' }; }
      } catch (e) {
        return { __error: method + ' ' + path + ': ' + (e.name === 'AbortError' ? 'timeout' : String(e.message || e)) };
      } finally { clearTimeout(timer); }
    }, { method, path, body, timeoutMs });
    if (r.__auth) throw new AuthExpired(r.why + ' su ' + path);
    if (r.__error) throw new Error(r.__error);
    return r.__empty ? null : r.__json;
  };
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b === undefined ? {} : b) };
}

// Sessione valida? Solo ok/motivo: nessun valore della sessione viene letto.
async function sessionCheck(page) {
  try {
    const cart = await pageApi(page, { timeoutMs: 15000 }).get('/web-api/cart/current-or-new');
    return cart && cart.id ? { ok: true, reason: 'carrello leggibile' } : { ok: false, reason: 'carrello non leggibile' };
  } catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 120) }; }
}

module.exports = { BASE, openContext, openPage, pageApi, sessionCheck };
