// ══════════════════════════════════════════════════════════════════
// NAVIGAZIONE BRIGADE (FC04-UX)
//
// Tre regole, valide in tutta l'app:
//
// 1. Cio' che c'e' sempre (barra in basso, menu Admin) non si puo'
//    cancellare per sbaglio. Prima di FC04-UX, dopo un salvataggio
//    diverse schermate facevano document.querySelector('.fixed').remove():
//    il primo '.fixed' della pagina e' la barra di navigazione, e spariva.
//    Altre rimuovevano ogni '.fixed.inset-0', compreso il menu Admin, che
//    poi non si riapriva piu'. Ora si chiude solo cio' che e' transitorio.
//
// 2. Home e' sempre raggiungibile: brigadeHome() chiude le finestre
//    transitorie e le schermate a tutto schermo e torna alla Home.
//
// 3. Le finestre in basso (sheet) restano sopra la tastiera dell'iPhone:
//    brigadeSeguiTastiera(sheet) le sposta con il visualViewport.
// ══════════════════════════════════════════════════════════════════
'use strict';

// Gli elementi '.fixed' presenti nella pagina al caricamento sono permanenti.
window.brigadeMarcaPermanenti = function() {
  document.querySelectorAll('.fixed').forEach(function(el) {
    el.setAttribute('data-permanente', '1');
  });
};
// Subito (gli script stanno in fondo al body: la barra e il menu ci sono gia')
// e di nuovo a pagina caricata, per gli elementi statici dopo gli script.
window.brigadeMarcaPermanenti();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.brigadeMarcaPermanenti);
}

// Finestre transitorie: aggiunte dopo il caricamento, figlie dirette del body.
window.brigadeFinestreTransitorie = function() {
  return Array.prototype.slice.call(document.querySelectorAll('body > .fixed'))
    .filter(function(el) { return !el.hasAttribute('data-permanente'); });
};

// Chiude le finestre transitorie. Mai la barra, mai il menu Admin.
window.brigadeChiudiFinestre = function() {
  window.brigadeFinestreTransitorie().forEach(function(el) { el.remove(); });
};

// Le schermate a tutto schermo che non usano la classe .fixed.
const BRIGADE_SCHERMATE = [
  function() { if (typeof window.pmChiudi === 'function') window.pmChiudi(); },
  function() { if (typeof window.iwlChiudi === 'function') window.iwlChiudi(); },
];

window.brigadeHome = function() {
  window.brigadeChiudiFinestre();
  BRIGADE_SCHERMATE.forEach(function(f) { try { f(); } catch (e) {} });
  if (typeof window.hideAdminMenu === 'function') { try { window.hideAdminMenu(); } catch (e) {} }
  const home = document.querySelector('[data-t="h"]');
  if (home) home.click();
  try { window.scrollTo(0, 0); } catch (e) {}
};

// Un tocco su una voce della barra in basso porta in quella sezione: la
// scheda ingrediente (che ora lascia la barra visibile) si chiude.
document.addEventListener('click', function(e) {
  const t = e.target && e.target.closest && e.target.closest('.tab[data-t]');
  if (!t) return;
  document.querySelectorAll('[data-nav="ingr"],[data-nav="ingr-sheet"]').forEach(function(el) { el.remove(); });
  // una schermata nascosta mentre la scheda era aperta non deve restare appesa
  BRIGADE_SCHERMATE.forEach(function(f) { try { f(); } catch (x) {} });
}, true);

// Tastiera iPhone: la finestra in basso sale con la tastiera e il campo
// attivo resta visibile. Senza visualViewport (browser vecchi) non fa nulla.
window.brigadeSeguiTastiera = function(sheet) {
  const vv = window.visualViewport;
  if (!sheet || !vv) return;
  const pannello = sheet.firstElementChild;
  function adatta() {
    if (!sheet.isConnected) { vv.removeEventListener('resize', adatta); vv.removeEventListener('scroll', adatta); return; }
    const sotto = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    sheet.style.bottom = sotto + 'px';
    sheet.style.top = vv.offsetTop + 'px';
    if (pannello) pannello.style.maxHeight = Math.round(vv.height * 0.94) + 'px';
  }
  vv.addEventListener('resize', adatta);
  vv.addEventListener('scroll', adatta);
  sheet.addEventListener('focusin', function(e) {
    const el = e.target;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    setTimeout(function() { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) {} }, 300);
  });
  adatta();
};

// Il bottone Home standard delle schermate (stessa forma ovunque).
window.brigadeBottoneHome = function(stile) {
  return '<button type="button" onclick="brigadeHome()" aria-label="Torna alla Home" style="'
    + (stile || 'height:36px;padding:0 12px;border-radius:10px;border:none;background:#f1f5f9;color:#1e293b;font:600 13px -apple-system,sans-serif;cursor:pointer;flex-shrink:0;')
    + '">⌂ Home</button>';
};
