// ─────────────────────────────────────────────────────────────────────
// B-86 — MONITORS in Brigade (Max 29/10/2026)
//
// Pagina a tutto schermo dal menu admin: i 3 monitor con ON/OFF + editor del
// Monitor 3 (camerieri). La schermata è js/service-board-ui.js, la stessa di
// Brigade 2.0. Si scrive SOLO con la funzione sb_tok (sessione Brigade di uno
// Chef / Sous-Chef): le tabelle service_board non si scrivono direttamente.
// Il pulsante «TV» di prima resta com'è (stesso interruttore display_active).
// ─────────────────────────────────────────────────────────────────────
(function () {
  const WAITER_URL = 'https://1cos.github.io/back-of-house/waiter.html';
  const token = () => { try { return localStorage.getItem('brigade_token'); } catch (_) { return null; } };
  async function call(op, args) {
    const r = await window.supa.rpc('sb_tok', { p_token: token(), p_op: op, p_args: args || {} });
    if (r.error) return { ok: false, error: r.error.message || 'server_error' };
    return r.data;
  }
  window.openServiceMonitor = function () {
    let ov = document.getElementById('sbOverlay');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'sbOverlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#f8fafc;overflow:auto;-webkit-overflow-scrolling:touch;';
      ov.innerHTML = '<div style="position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;padding:14px 16px;background:#0f172a;color:#fff;">'
        + '<div style="flex:1;font-weight:900;letter-spacing:.12em;font-size:14px;">📺 MONITORS</div>'
        + '<button id="sbClose" style="border:0;background:#334155;color:#fff;font-weight:800;border-radius:10px;padding:8px 14px;">Close</button></div>'
        + '<div id="sbRoot" style="padding:14px 16px 0;"></div>';
      document.body.appendChild(ov);
      ov.querySelector('#sbClose').onclick = () => { ov.style.display = 'none'; if (typeof updateTVButtonState === 'function') window.supa.from('settings').select('value').eq('key', 'display_active').maybeSingle().then((r) => updateTVButtonState(!r.data || r.data.value === 'true')).catch(() => {}); };
    }
    ov.style.display = 'block';
    window.ServiceBoardUI.mount(ov.querySelector('#sbRoot'), call, { waiterUrl: WAITER_URL });
  };
  // ── Ingresso per gli editor della lavagna (Max 19/11/2026) ──
  // Chi non è admin ma è nell'elenco service_board_editors non vede il menu admin: gli compare solo un pulsante
  // «Monitors». Il permesso VERO lo decide il server (sb_tok_user): qui si prova 'state' una volta per sessione;
  // se risponde ok il pulsante appare, altrimenti non compare niente.
  let probed = null;
  async function probeEditor() {
    const t = token();
    if (!t) { probed = null; const o = document.getElementById('sbEditorBtn'); if (o) o.remove(); return; }
    if (t === probed) return;
    probed = t;
    const old = document.getElementById('sbEditorBtn'); if (old) old.remove();
    let r; try { r = await call('state', {}); } catch (_) { return; }
    if (!r || !r.ok) return;
    const menu = document.getElementById('tabMenu');
    if (menu && menu.style.display !== 'none') return;   // admin: ha già il menu
    const b = document.createElement('button'); b.id = 'sbEditorBtn';
    b.textContent = '📺 Monitors';
    b.style.cssText = 'position:fixed;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:8000;border:0;border-radius:999px;background:#c2410c;color:#fff;font-weight:800;font-size:14px;padding:12px 18px;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    b.onclick = () => window.openServiceMonitor();
    document.body.appendChild(b);
  }
  setInterval(() => { try { probeEditor(); } catch (_) {} }, 4000);
})();
