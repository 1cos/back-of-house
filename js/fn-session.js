// B-54 F5 (sicurezza) — le chiamate alle funzioni del server portano la sessione della persona collegata
// (intestazione x-brigade-token). Così le funzioni possono rifiutare chi ha solo la chiave pubblica.
// Solo per le funzioni dell'elenco: le altre restano esattamente come prima.
(function () {
  var SLUGS = ['ai-translate', 'notifications', 'sc-nightly-brief', 'office-ai', 'bot-price-guard', 'bot-chat-analyst',
    'bot-preplist-builder', 'bot-tell-chef-reader', 'bot-food-cost-guard', 'bot-recipe-guardian', 'bot-preplist-sim',
    'bot-preplist-v2', 'process-invoice', 'souschef-classify', 'transcribe-audio', 'souschef-scan', 'jarvis-reason',
    'bot-prep-accuracy', 'bot-prep-count-reconciler'];
  if (!window.fetch) return;
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var m = String(url).match(/\/functions\/v1\/([a-z0-9-]+)/);
      if (m && SLUGS.indexOf(m[1]) >= 0) {
        var tok = null;
        try { tok = localStorage.getItem('brigade_token'); } catch (e) { tok = null; }
        if (tok) {
          init = Object.assign({}, init || {});
          var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
          if (!h.has('x-brigade-token')) h.set('x-brigade-token', tok);
          init.headers = h;
        }
      }
    } catch (e) { /* in caso di problemi la chiamata parte come prima */ }
    return orig(input, init);
  };
})();
