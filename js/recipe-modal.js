// ── RECIPE MODAL — Brigade v4 ─────────────────────────────
// Fullscreen · Font grandi per cucina · i18n · BOM fix
// v3: step tracking + wake lock timer
// v4: modal adattivo — ricetta completa / prep_steps / nota / bare
//     prep_steps usa timer_minutes (non timer_seconds)
//     BOM mai toccato
// v5: scaleTextQty — scala automaticamente numeri+unità nel testo degli steps
// ─────────────────────────────────────────────────────────

(function(){

const L = {
  shelf:      { it:'Conservazione', en:'Shelf life',  es:'Conservación'  },
  days:       { it:'giorni',        en:'days',         es:'días'          },
  day:        { it:'giorno',        en:'day',          es:'día'           },
  servings:   { it:'Porzioni',      en:'Servings',     es:'Porciones'     },
  stepOf:     { it:'Passo',         en:'Step',         es:'Paso'          },
  of:         { it:'di',            en:'of',           es:'de'            },
  timer:      { it:'Timer',         en:'Timer',        es:'Temporizador'  },
  running:    { it:'In corso',      en:'Running',      es:'En curso'      },
  done:       { it:'Fatto',         en:'Done',         es:'Hecho'         },
  prev:       { it:'← Indietro',   en:'← Prev',      es:'← Anterior'   },
  next:       { it:'Avanti →',     en:'Next →',      es:'Siguiente →'  },
  finish:     { it:'✓ Fatto',      en:'✓ Done',      es:'✓ Listo'      },
  noIng:      { it:'Nessun ingrediente.\nAggiungi BOM per vederli.', en:'No ingredients linked.\nAdd BOM entries to see them.', es:'Sin ingredientes.\nAgrega entradas BOM.' },
  noSteps:    { it:'Nessuno step aggiunto.', en:'No steps added yet.', es:'Sin pasos agregados.' },
  noNotes:    { it:'Nessuna nota.',           en:'No notes.',            es:'Sin notas.'           },
  yieldLbl:   { it:'Resa',          en:'Yield',        es:'Rendimiento'   },
  shelfLbl:   { it:'Conservazione', en:'Shelf life',   es:'Conservación'  },
  equipLbl:   { it:'Attrezzatura',  en:'Equipment',    es:'Equipamiento'  },
  ingredients:{ it:'Ingredienti',   en:'Ingredients',  es:'Ingredientes'  },
  steps:      { it:'Passi',         en:'Steps',        es:'Pasos'         },
  notes:      { it:'Note',          en:'Notes',        es:'Notas'         },
  doneBtn:    { it:'✓ Fatto',      en:'✓ Done',      es:'✓ Listo'      },
  noteLabel:  { it:'Note operative',en:'Operational notes', es:'Notas operativas' },
};
function t(key){ const lang=window.user?.lang||'en'; return (L[key]||{})[lang]||(L[key]||{}).en||key; }

// ── PREP SCROLL LOCK — shared, owner-tracked ─────────────────────────────────
// Defined outside IIFE so prep.js can call it without depending on recipe-modal load order.
window._prepScrollOwners = window._prepScrollOwners || [];
window._prepScrollSavedY = window._prepScrollSavedY || 0;

window.lockPrepScroll = function(owner) {
  if (!window._prepScrollOwners.includes(owner)) {
    window._prepScrollOwners.push(owner);
  }
  if (window._prepScrollOwners.length === 1) {
    window._prepScrollSavedY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + window._prepScrollSavedY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
  }
};

window.unlockPrepScroll = function(owner) {
  window._prepScrollOwners = (window._prepScrollOwners || []).filter(function(o){ return o !== owner; });
  if (window._prepScrollOwners.length === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.overflow = '';
    window.scrollTo(0, window._prepScrollSavedY || 0);
    window._prepScrollSavedY = 0;
  }
};

const STYLE=`<style id="rmStyle">
#rmOverlay{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,0.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;animation:rmFadeIn .2s ease;}
@keyframes rmFadeIn{from{opacity:0}to{opacity:1}}
@keyframes rmSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
#rmSheet{width:100%;max-width:480px;background:#f0f4f8;border-radius:24px 24px 0 0;height:94vh;display:flex;flex-direction:column;overflow:hidden;animation:rmSlideUp .28s cubic-bezier(.32,1.1,.5,1);padding-bottom:env(safe-area-inset-bottom,20px);}
#rmHeader{background:linear-gradient(135deg,#1e3a5f 0%,#1e40af 100%);padding:16px 18px 0;flex-shrink:0;}
.rm-drag{width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.25);margin:0 auto 14px;}
.rm-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;}
.rm-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:700;color:rgba(255,255,255,0.95);letter-spacing:.06em;text-transform:uppercase;}
.rm-close{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:white;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0;}
.rm-title{font-size:30px;font-weight:800;color:white;letter-spacing:-.5px;line-height:1.1;margin-bottom:6px;}
.rm-sub{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
.rm-sub-pill{font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);background:rgba(255,255,255,0.12);border-radius:20px;padding:4px 12px;}
.rm-bot-pill{background:rgba(5,150,105,0.85);color:white;border:1.5px solid rgba(255,255,255,0.3);cursor:pointer;}
.rm-tabs{display:flex;border-top:1px solid rgba(255,255,255,0.1);}
.rm-tab{flex:1;padding:12px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.45);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;letter-spacing:.04em;transition:all .18s;}
.rm-tab.active{color:white;border-bottom-color:#60a5fa;}
#rmBody{flex:1;overflow-y:auto;padding:18px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.rm-servings{display:flex;align-items:center;justify-content:space-between;background:white;border-radius:18px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 4px rgba(30,58,95,0.07);}
.rm-servings-label{font-size:16px;font-weight:700;color:#1e3a5f;}
.rm-stepper{display:flex;align-items:center;gap:12px;}
.rm-step-btn{width:36px;height:36px;border-radius:50%;background:#1e3a5f;border:none;color:white;font-size:20px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;}
.rm-servings-val{font-size:20px;font-weight:800;color:#1e3a5f;width:56px;text-align:center;border:none;background:transparent;outline:none;padding:0;-moz-appearance:textfield;appearance:textfield;cursor:text;}
.rm-servings-val::-webkit-inner-spin-button,.rm-servings-val::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
.rm-ing-list{display:flex;flex-direction:column;gap:10px;}
.rm-ing-row{display:flex;align-items:center;background:white;border-radius:16px;padding:14px 16px;box-shadow:0 1px 4px rgba(30,58,95,0.06);}
.rm-ing-icon{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;margin-right:14px;}
.rm-ing-name{flex:1;font-size:17px;font-weight:500;color:#1e3a5f;line-height:1.3;}
.rm-ing-qty{font-size:17px;font-weight:800;color:#2563eb;white-space:nowrap;}
.rm-ing-unit{font-size:13px;font-weight:500;color:#94a3b8;margin-left:3px;}
.rm-step-counter{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.rm-step-counter-lbl{font-size:14px;font-weight:700;color:#64748b;}
.rm-progress-bar{flex:1;height:4px;background:rgba(30,58,95,0.1);border-radius:2px;margin:0 12px;overflow:hidden;}
.rm-progress-fill{height:100%;background:linear-gradient(90deg,#2563eb,#60a5fa);border-radius:2px;transition:width .3s ease;}
.rm-dots{display:flex;align-items:center;justify-content:center;gap:7px;margin-bottom:16px;flex-wrap:wrap;}
.rm-dot{width:10px;height:10px;border-radius:50%;background:rgba(30,58,95,0.15);transition:all .2s;flex-shrink:0;}
.rm-dot.active{width:26px;border-radius:5px;background:#2563eb;}
.rm-dot.done{background:#60a5fa;}
.rm-step-card{background:white;border-radius:20px;padding:20px;box-shadow:0 2px 8px rgba(30,58,95,0.08);display:flex;flex-direction:column;gap:14px;margin-bottom:16px;}
.rm-step-num-row{display:flex;align-items:center;gap:12px;}
.rm-step-num{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.rm-step-title{font-size:19px;font-weight:800;color:#1e3a5f;}
.rm-step-text{font-size:17px;color:#334155;line-height:1.7;}
.rm-timer{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:16px;padding:14px 16px;border:1px solid rgba(59,130,246,0.15);}
.rm-timer.running{background:linear-gradient(135deg,#fff1f2,#fee2e2);border-color:rgba(239,68,68,0.2);}
.rm-timer.done-state{background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-color:rgba(5,150,105,0.2);}
.rm-timer-info{display:flex;flex-direction:column;gap:3px;}
.rm-timer-lbl{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;}
.rm-timer-lbl.idle{color:#60a5fa;}.rm-timer-lbl.running{color:#f87171;}.rm-timer-lbl.done{color:#059669;}
.rm-timer-display{font-size:36px;font-weight:800;color:#1e3a5f;letter-spacing:-.5px;font-variant-numeric:tabular-nums;}
.rm-timer-display.running{color:#dc2626;}.rm-timer-display.done{color:#059669;}
.rm-timer-btn{width:54px;height:54px;border-radius:16px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:22px;transition:all .15s;}
.rm-timer-btn.idle{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;box-shadow:0 4px 14px rgba(30,58,95,0.3);}
.rm-timer-btn.running{background:linear-gradient(135deg,#ef4444,#dc2626);color:white;box-shadow:0 4px 14px rgba(239,68,68,0.3);}
.rm-timer-btn.done{background:linear-gradient(135deg,#059669,#10b981);color:white;box-shadow:0 4px 14px rgba(5,150,105,0.3);}
.rm-nav{display:flex;gap:10px;}
.rm-nav-btn{flex:1;height:54px;border-radius:16px;border:none;font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s;}
.rm-nav-btn.prev{background:white;color:#1e3a5f;border:1.5px solid #e2e8f0;box-shadow:0 1px 3px rgba(30,58,95,0.07);}
.rm-nav-btn.prev:disabled{opacity:.35;cursor:default;}
.rm-nav-btn.next{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;box-shadow:0 4px 16px rgba(30,58,95,0.3);}
.rm-nav-btn.finish{background:linear-gradient(135deg,#059669,#10b981);color:white;box-shadow:0 4px 16px rgba(5,150,105,0.3);}
.rm-notes-card{background:white;border-radius:18px;padding:4px 18px;box-shadow:0 1px 4px rgba(30,58,95,0.07);}
.rm-note-row{display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid #f1f5f9;}
.rm-note-row:last-child{border-bottom:none;}
.rm-note-icon{font-size:20px;margin-top:1px;flex-shrink:0;}
.rm-note-text{font-size:16px;color:#334155;line-height:1.6;}
.rm-note-text strong{color:#1e3a5f;font-weight:700;}
.rm-empty{text-align:center;padding:48px 20px;color:#94a3b8;font-size:16px;line-height:1.7;}
.rm-empty-icon{font-size:42px;margin-bottom:12px;}
/* ── BARE MODAL (check/nota semplice) ── */
.rm-bare-body{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:24px 18px;}
.rm-bare-note{background:white;border-radius:20px;padding:24px;box-shadow:0 2px 8px rgba(30,58,95,0.08);font-size:18px;color:#334155;line-height:1.7;flex:1;margin-bottom:20px;}
.rm-bare-done{width:100%;height:58px;border-radius:18px;background:linear-gradient(135deg,#059669,#10b981);color:white;font-size:18px;font-weight:700;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(5,150,105,0.3);}
/* ── DONE FOOTER — ingredienti senza steps ── */
#rmDoneFooter{flex-shrink:0;padding:12px 18px 16px;background:#f0f4f8;border-top:0.5px solid rgba(30,58,95,0.1);}
#rmDoneFooter button{width:100%;height:54px;border-radius:16px;background:linear-gradient(135deg,#059669,#10b981);color:white;font-size:16px;font-weight:700;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(5,150,105,0.25);letter-spacing:0.02em;}
</style>`;

// ── INGREDIENT ICONS ──────────────────────────────────────
const ING_ICONS={potato:'🥔',butter:'🧈',cream:'🥛',rosemary:'🌿',thyme:'🌿',salt:'🧂',pepper:'⚫',garlic:'🧄',oil:'🫒',egg:'🥚',flour:'🌾',milk:'🥛',cheese:'🧀',tomato:'🍅',lemon:'🍋',orange:'🍊',onion:'🧅',carrot:'🥕',water:'💧',wine:'🍷',stock:'🍲',demi:'🍲',broth:'🍲',sugar:'🍬',chocolate:'🍫',parmesan:'🧀',pecorino:'🧀',mozzarella:'🧀',ricotta:'🧀',beef:'🥩',chicken:'🍗',salmon:'🐟',shrimp:'🦐',lobster:'🦞',scallop:'🐚',pasta:'🍝',rice:'🍚',bread:'🍞',truffle:'🍄',mushroom:'🍄',spinach:'🥬',arugula:'🥬',fennel:'🌿',basil:'🌿',bacon:'🥓',prosciutto:'🍖',sausage:'🌭'};
function ingIcon(name){if(!name)return '🥄';const n=name.toLowerCase();for(const[k,v]of Object.entries(ING_ICONS))if(n.includes(k))return v;return '🥄';}

function fmtQty(qty,factor){if(qty===null||qty===undefined||qty==='')return '';const raw=parseFloat(qty)*(factor||1);if(isNaN(raw))return qty;if(raw>=100)return Math.round(raw).toString();if(raw>=10)return(Math.round(raw*10)/10).toFixed(1).replace(/\.0$/,'');return(Math.round(raw*100)/100).toFixed(2).replace(/\.?0+$/,'');}

// ── SCALE TEXT QUANTITIES ────────────────────────────────
// Trova tutti i pattern "numero + unità" nel testo dello step e li scala.
// Ignora numeri senza unità (temperature, numeri di step, ecc.)
// oz → galloni automatico quando risultato ≥ 128oz (1 gallon = 128oz)
var _SCALE_UNITS = [
  'kg','ml','cl','dl','l',
  'galloni','gallone','gallon','gallons','galón','galones',
  'lb','lbs',
  'latte','barattoli','barattolo','buste','busta',
  'cucchiai','cucchiaio','cucchiaini','cucchiaino',
  'mazzi','mazzo','spicchi','spicchio','fette','fetta',
  'pezzi','pezzo','pz','oz','g'
];
function _fmtNum(n) {
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10)  return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}
function scaleTextQty(text, factor) {
  if (!text || !factor || factor === 1) return text;
  var unitPattern = _SCALE_UNITS.map(function(u) {
    return u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|');
  var re = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*(' + unitPattern + ')\\b', 'gi');
  return text.replace(re, function(match, num, unit) {
    var n = parseFloat(num.replace(',', '.'));
    if (isNaN(n)) return match;
    var scaled = n * factor;
    var displayUnit = unit;
    var displayVal = scaled;
    // oz → galloni se il risultato è multiplo netto di 128
    var unitLow = unit.toLowerCase();
    if (unitLow === 'oz') {
      var gallons = scaled / 128;
      if (gallons >= 1 && Math.abs(gallons - Math.round(gallons)) < 0.05) {
        displayVal = Math.round(gallons);
        // preserva il plurale nella lingua originale
        var isIt = unitLow === 'gallone' || unitLow === 'galloni';
        var isEs = unitLow === 'galón' || unitLow === 'galones';
        if (isIt) displayUnit = displayVal === 1 ? 'gallone' : 'galloni';
        else if (isEs) displayUnit = displayVal === 1 ? 'galón' : 'galones';
        else displayUnit = displayVal === 1 ? 'gallon' : 'gallons';
      } else if (gallons >= 0.5 && Math.abs(gallons * 2 - Math.round(gallons * 2)) < 0.05) {
        // mezzo gallone
        displayVal = Math.round(gallons * 2) / 2;
        displayUnit = 'gallon';
      }
    }
    return '<strong style="color:#2563eb">' + _fmtNum(displayVal) + ' ' + displayUnit + '</strong>';
  });
}

// ── TIMER ────────────────────────────────────────────────
// timers{}            = interval handles locali al modal (per onTick/onDone DOM)
// window._timerState  = stato persistente globale (sopravvive alla navigazione)
const timers={};
if(!window._timerState) window._timerState={};

function fmtTime(s){
  if(s<=0) return '00:00';
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}

function _timerRem(key){
  var st=window._timerState[key];
  if(!st) return 0;
  var elapsed=Math.floor((Date.now()-st.startedAt)/1000);
  return Math.max(0, st.totalSecs - elapsed);
}

function startTimer(key, secs, onTick, onDone, meta){
  // toggle: se interval locale esiste, lo fermo completamente
  if(timers[key]){
    clearInterval(timers[key].interval);
    delete timers[key];
    delete window._timerState[key];
    if(typeof window._prepTimerStopped==='function') window._prepTimerStopped();
    _timerBarUpdate();
    return false;
  }
  window._timerState[key]={ totalSecs:secs, startedAt:Date.now(), meta:meta||{} };
  if(typeof window._prepTimerStarted==='function') window._prepTimerStarted();
  timers[key]={};
  timers[key].interval=setInterval(function(){
    var rem=_timerRem(key);
    if(timers[key]) timers[key].rem=rem;
    _timerBarUpdate();
    if(rem<=0){
      clearInterval(timers[key] && timers[key].interval);
      delete timers[key];
      delete window._timerState[key];
      if(typeof window._prepTimerStopped==='function') window._prepTimerStopped();
      _timerBarUpdate();
      onDone&&onDone();
      return;
    }
    onTick&&onTick(rem);
  },1000);
  _timerBarUpdate();
  return true;
}

function stopTimer(key){
  // Ferma solo l'interval locale — _timerState rimane, timer bar continua
  if(timers[key]){ clearInterval(timers[key].interval); delete timers[key]; }
}

function stopTimerFully(key){
  // Ferma tutto: interval + stato globale (stop manuale dall'utente)
  if(timers[key]){ clearInterval(timers[key].interval); delete timers[key]; }
  delete window._timerState[key];
  if(typeof window._prepTimerStopped==='function') window._prepTimerStopped();
  _timerBarUpdate();
}

// ── TIMER BAR ─────────────────────────────────────────────────
function _timerBarUpdate(){
  // Rimuovi vecchio bar fixed (legacy) se esiste
  var oldBar=document.getElementById('_timerBar');
  if(oldBar) oldBar.remove();

  var bar=document.getElementById('topTimerBar');
  var keys=Object.keys(window._timerState||{});
  if(!bar||keys.length===0){
    if(bar) bar.style.display='none';
    return;
  }
  bar.style.display='block';
  bar.innerHTML=keys.map(function(key){
    var st=window._timerState[key];
    if(!st) return '';
    var rem=_timerRem(key);
    var pct=Math.max(0,Math.min(100,Math.round(((st.totalSecs-rem)/st.totalSecs)*100)));
    var taskName=st.meta&&st.meta.taskName||'';
    var stepTitle=st.meta&&st.meta.stepTitle||'';
    var label=taskName+(stepTitle?' \u00b7 '+stepTitle:'');
    var isUrgent=rem>0&&rem<60;
    var isDone=rem<=0;
    // Colori integrati con la top bar (no sfondo scuro full-width)
    var accent=isDone?'#059669':isUrgent?'#ef4444':'#2563eb';
    var bg=isDone?'rgba(5,150,105,0.06)':isUrgent?'rgba(239,68,68,0.06)':'rgba(37,99,235,0.05)';
    var timeStr=isDone?'Done \u2713':fmtTime(rem);
    return '<div data-tkey="'+key+'" style="padding:5px 16px 6px;display:flex;align-items:center;gap:10px;cursor:pointer;background:'+bg+';position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent;">'
      // Barra progresso sottile in fondo alla riga
      +'<div style="position:absolute;bottom:0;left:0;height:2px;background:'+accent+';opacity:0.25;width:100%;"></div>'
      +'<div style="position:absolute;bottom:0;left:0;height:2px;background:'+accent+';width:'+pct+'%;transition:width .5s linear;"></div>'
      // Icona timer SVG (niente emoji)
      +'<div style="flex-shrink:0;width:28px;height:28px;border-radius:8px;background:'+accent+';opacity:0.12;position:absolute;left:16px;"></div>'
      +'<svg style="flex-shrink:0;position:relative;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="'+accent+'" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>'
      // Label
      +'<span style="flex:1;font-size:12px;font-weight:500;color:#1e3a5f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">'+label+'</span>'
      // Countdown
      +'<span style="font-size:13px;font-weight:700;color:'+accent+';font-variant-numeric:tabular-nums;letter-spacing:-.3px;white-space:nowrap;flex-shrink:0;">'+timeStr+'</span>'
      // Chevron
      +'<svg style="flex-shrink:0;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="'+accent+'" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>'
      +'</div>';
  }).join('');
  bar.querySelectorAll('[data-tkey]').forEach(function(row){
    row.addEventListener('click',function(){
      var key=row.dataset.tkey;
      var st=window._timerState[key];
      if(!st) return;
      var meta=st.meta||{};
      if(window.recipeModal&&typeof window.recipeModal.open==='function'){
        window.recipeModal.open(meta.recipeId||null, meta.prepTaskId||null);
      }
    });
  });
}

// ── SHELL ─────────────────────────────────────────────────
function buildShell(title, category, pills, botPill, tabs){
  const tabsHtml = tabs.length>1
    ? `<div class="rm-tabs">${tabs.map((tb,i)=>`<button class="rm-tab${i===0?' active':''}" data-tab="${tb.key}">${tb.label}</button>`).join('')}</div>`
    : '';
  return `<div id="rmSheet">
    <div id="rmHeader">
      <div class="rm-drag"></div>
      <div class="rm-top">
        <span class="rm-badge">${category||'🍳'}</span>
        <button class="rm-close">×</button>
      </div>
      <div class="rm-title">${title||''}</div>
      ${pills.length?`<div class="rm-sub">${pills.map(p=>`<span class="rm-sub-pill">${p}</span>`).join('')}${botPill}</div>`:''}
      ${tabsHtml}
    </div>
    <div id="rmBody"></div>
  </div>`;
}

// ── STEP RENDERER (condiviso tra recipe_steps e prep_steps) ──
// ── v627: CHEF AI STEP 1 ─────────────────────────────────────────────────────
// Mostra dati strutturati da prep_suggestions_daily.
// Labels EN only. "Open recipe" rimosso — sostituito con "START PREP".
// "Reported stock" / "Suggested amount" come da spec.
function buildChefAiStep1Block(prepSugg, prepTask) {
  // Only show when we have a fresh suggestion from prep_suggestions_daily.
  // Legacy suggested_qty (bot-preplist-builder) is no longer surfaced.
  if (!prepSugg) return '';

  var unit = prepSugg.output_unit || (prepTask && prepTask.unit) || '';
  var prepTaskId = prepTask ? (prepTask.id || null) : null;

  function fmtVal(val, u) {
    if (val === null || val === undefined) return '\u2014';
    var n = parseFloat(val);
    if (isNaN(n)) return '\u2014';
    var ul = (u || '').toLowerCase();
    if (ul === 'g') {
      if (n >= 1000) return (n/1000).toLocaleString('en-US',{maximumFractionDigits:1}) + ' kg';
      return Math.round(n) + ' g';
    }
    if (['pezzi','pz'].includes(ul)) { var ni=Math.round(n); return ni + (ni===1?' piece':' pieces'); }
    if (ul === 'kg') return n.toLocaleString('en-US',{maximumFractionDigits:1}) + ' kg';
    if (ul === 'nests') return Math.round(n) + ' nests';
    if (ul === 'cup') return Math.round(n) + (n===1?' cup':' cups');
    return n + (u ? ' ' + u : '');
  }

  var pq = prepSugg.production_constraint_quality || 'missing';
  var stockVal   = fmtVal(prepSugg.current_stock, unit);
  var plannedVal = prepSugg.planned_output != null
    ? fmtVal(prepSugg.planned_output, unit)
    : fmtVal(prepSugg.net_requirement, unit);
  var batchWarning = (pq === 'missing' || pq === 'conflicting');

  // Store sheet data keyed by taskId — never embedded in HTML attributes
  var taskKey = 'pt_' + (prepTaskId || 'none');
  window._rmSuggData = window._rmSuggData || {};
  window._rmSuggData[taskKey] = { stockVal: stockVal, plannedVal: plannedVal, batchWarning: batchWarning, prepTaskId: prepTaskId };

  // Compact bar — text content only, click handler bound via addEventListener
  return '<div id="rmChefAiBar" data-task-key="' + taskKey + '" style="margin:8px 16px 0;padding:9px 12px;background:rgba(219,234,254,0.45);border:1px solid #bfdbfe;border-radius:12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;-webkit-tap-highlight-color:transparent;">'
    + '<span style="font-size:12px;font-weight:600;color:#1d4ed8;">Prep Suggestion \u00b7 Stock ' + stockVal + ' / Prepare ' + plannedVal + '</span>'
    + '<span style="font-size:10px;color:#93c5fd;font-weight:500;white-space:nowrap;margin-left:8px;">View details \u2193</span>'
    + '</div>';
}

// Bind click on rmChefAiBar — called once after DOM insertion
// Opens suggestion sheet via pure DOM construction — zero inline JS, zero innerHTML with dynamic content
function _bindRmChefAiBar() {
  var bar = document.getElementById('rmChefAiBar');
  if (!bar || bar._rmBound) return;
  bar._rmBound = true;
  bar.addEventListener('click', function() {
    var existing = document.getElementById('rmSuggSheet');
    if (existing) { existing.remove(); return; }

    var taskKey  = bar.dataset.taskKey || '';
    var d        = (window._rmSuggData || {})[taskKey] || {};
    var stockVal    = d.stockVal    || '\u2014';
    var plannedVal  = d.plannedVal  || '\u2014';
    var batchWarn   = !!d.batchWarning;
    var prepTaskId  = d.prepTaskId  || null;

    var sheet = document.createElement('div');
    sheet.id = 'rmSuggSheet';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,0.55);display:flex;align-items:flex-end;justify-content:center;-webkit-tap-highlight-color:transparent;';
    sheet.addEventListener('click', function(e){ if(e.target===sheet) sheet.remove(); });

    var inner = document.createElement('div');
    inner.style.cssText = 'width:100%;max-width:480px;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -4px 32px rgba(30,58,95,0.18);padding:20px 18px 40px;';

    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';
    var hdrT = document.createElement('div');
    hdrT.style.cssText = 'font-size:11px;font-weight:700;color:#1d4ed8;letter-spacing:0.6px;';
    hdrT.textContent = 'PREP SUGGESTION';
    var closeX = document.createElement('button');
    closeX.style.cssText = 'font-size:20px;color:#94a3b8;background:none;border:none;cursor:pointer;padding:0 4px;line-height:1;';
    closeX.textContent = '\u00d7';
    closeX.addEventListener('click', function(e){ e.stopPropagation(); sheet.remove(); });
    hdr.appendChild(hdrT); hdr.appendChild(closeX);

    function makeRow(label, value, bold) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;font-size:13px;color:#475569;';
      var l = document.createElement('span'); l.style.color='#94a3b8'; l.textContent=label;
      var v = document.createElement('span'); v.style.color='#1e3a5f'; if(bold) v.style.fontWeight='700'; v.textContent=value;
      row.appendChild(l); row.appendChild(v); return row;
    }
    var sep = document.createElement('div'); sep.style.cssText='height:1px;background:#f1f5f9;';

    inner.appendChild(hdr);
    inner.appendChild(makeRow('Stock', stockVal, false));
    inner.appendChild(sep);
    inner.appendChild(makeRow('Prepare today', plannedVal, true));

    if (batchWarn) {
      var bw = document.createElement('div');
      bw.style.cssText = 'margin-top:8px;font-size:12px;color:#854f0b;background:#fef3c7;border-radius:8px;padding:8px 10px;';
      bw.textContent = 'Quantity is an estimate \u2014 batch size not yet defined.';
      inner.appendChild(bw);
    }

    var rWrap = document.createElement('div'); rWrap.style.cssText='margin-top:14px;text-align:center;';
    var rBtn  = document.createElement('button');
    rBtn.style.cssText='font-size:12px;color:#94a3b8;background:none;border:none;cursor:pointer;text-decoration:underline;padding:4px 8px;';
    rBtn.textContent = 'Report an issue';
    rBtn.addEventListener('click', function(e){
      e.stopPropagation();
      sheet.remove();
      if (prepTaskId && typeof window.segnalaChef === 'function') {
        setTimeout(function(){ window.segnalaChef(prepTaskId); }, 80);
      }
    });
    rWrap.appendChild(rBtn);
    inner.appendChild(rWrap);
    sheet.appendChild(inner);
    document.body.appendChild(sheet);
  });
}
function renderStepView(steps, currentStep, prepTaskId, totalSteps, closeModal, bomRows, scaleFactor){
  if(!steps||steps.length===0) return `<div class="rm-empty"><div class="rm-empty-icon">👨‍🍳</div>${t('noSteps')}</div>`;
  const step=steps[currentStep];
  const total=steps.length;
  const pct=Math.round(((currentStep+1)/total)*100);
  const lang=window.user?.lang||'en';
  // Titolo localizzato
  const stepTitle=(lang==='it'&&step.title_it)?step.title_it
    :(lang==='es'&&step.title_es)?step.title_es
    :(step.title||'');
  // Supporta sia recipe_steps (instruction_en/it/es) che prep_steps (note)
  var rawInstruction=(lang==='it'&&step.instruction_it)?step.instruction_it
    :(lang==='es'&&step.instruction_es)?step.instruction_es
    :(step.instruction_en||step.instruction_it||step.note||'');
  const instruction=scaleTextQty(rawInstruction, scaleFactor||1);
  // Timer: recipe_steps usa timer_seconds, prep_steps usa timer_minutes
  const timerSecs = step.timer_seconds || (step.timer_minutes ? step.timer_minutes*60 : 0);
  const dots=steps.map((_,i)=>`<div class="rm-dot ${i===currentStep?'active':i<currentStep?'done':''}"></div>`).join('');
  const _tKey='step_'+currentStep;
  const _tRunning=!!(window._timerState&&window._timerState[_tKey]);
  const _tRem=_tRunning?_timerRem(_tKey):timerSecs;
  const _tDone=_tRunning&&_tRem<=0;
  const _tState=_tDone?'done':_tRunning?'running':'idle';
  const _tWrap=_tDone?' done-state':_tRunning?' running':'';
  const _tLbl=_tDone?'\u2713 DONE':_tRunning?'\u23f1 RUNNING':'\u23f1 '+t('timer').toUpperCase();
  const _tBtn=_tDone?'\u2713':_tRunning?'\u25a0':'\u25b6';
  const _tDisp=_tDone?t('done')+' \u2713':fmtTime(_tRem);
  const timerHtml=timerSecs?('<div class="rm-timer'+_tWrap+'" id="rmTimer_'+currentStep+'">'
    +'<div class="rm-timer-info">'
    +'<span class="rm-timer-lbl '+_tState+'" id="rmTlbl_'+currentStep+'">'+_tLbl+'</span>'
    +'<span class="rm-timer-display '+(_tState!=='idle'?_tState:'')+'" id="rmTdsp_'+currentStep+'">'+_tDisp+'</span>'
    +'</div>'
    +'<button class="rm-timer-btn '+_tState+'" id="rmTbtn_'+currentStep+'" data-secs="'+timerSecs+'">'+_tBtn+'</button>'
    +'</div>'):''
  const isLast=currentStep===total-1;
  return `
    <div class="rm-step-counter">
      <span class="rm-step-counter-lbl">${t('stepOf')} ${currentStep+1} ${t('of')} ${total}</span>
      <div class="rm-progress-bar"><div class="rm-progress-fill" style="width:${pct}%"></div></div>
      <span class="rm-step-counter-lbl">${pct}%</span>
    </div>
    <div class="rm-dots">${dots}</div>
    <div class="rm-step-card">
      <div class="rm-step-num-row">
        <div class="rm-step-num">${currentStep+1}</div>
        <div class="rm-step-title">${stepTitle}</div>
      </div>
      ${instruction?`<div class="rm-step-text">${instruction}</div>`:''}
      ${timerHtml}
    </div>
    <div class="rm-nav">
      <button class="rm-nav-btn prev" id="rmPrev" ${currentStep===0?'disabled':''}>${t('prev')}</button>
      <button class="rm-nav-btn ${isLast?'finish':'next'}" id="rmNext">${isLast?t('finish'):t('next')}</button>
    </div>`;
}

function bindStepEvents(steps, getCurrentStep, setCurrentStep, prepTaskId, totalSteps, renderFn, closeModalFn, getBomRows, getScaleFactor){
  var idx=getCurrentStep();
  var timerSecs = steps[idx].timer_seconds || (steps[idx].timer_minutes ? steps[idx].timer_minutes*60 : 0);
  var tBtn=document.getElementById('rmTbtn_'+idx);
  if(tBtn&&timerSecs){
    var key='step_'+idx;
    var dsp=document.getElementById('rmTdsp_'+idx);
    var lbl=document.getElementById('rmTlbl_'+idx);
    var wrap=document.getElementById('rmTimer_'+idx);
    // Riattacca interval se timer gia' in corso (sopravvissuto alla navigazione)
    if(window._timerState&&window._timerState[key]&&!timers[key]){
      timers[key]={};
      timers[key].interval=setInterval(function(){
        var rem=_timerRem(key);
        if(timers[key]) timers[key].rem=rem;
        if(dsp) dsp.textContent=fmtTime(rem);
        _timerBarUpdate();
        if(rem<=0){
          clearInterval(timers[key]&&timers[key].interval);
          delete timers[key];
          delete window._timerState[key];
          if(typeof window._prepTimerStopped==='function') window._prepTimerStopped();
          if(dsp){dsp.textContent=t('done')+' \u2713';dsp.className='rm-timer-display done';}
          if(lbl){lbl.textContent='\u2713 '+t('done').toUpperCase();lbl.className='rm-timer-lbl done';}
          if(wrap)wrap.className='rm-timer done-state';
          if(tBtn){tBtn.className='rm-timer-btn done';tBtn.textContent='\u2713';}
          if(navigator.vibrate)navigator.vibrate([200,100,200]);
          _timerBarUpdate();
        }
      },1000);
    }
    tBtn.addEventListener('click',function(){
      var dsp=document.getElementById('rmTdsp_'+idx);
      var lbl=document.getElementById('rmTlbl_'+idx);
      var wrap=document.getElementById('rmTimer_'+idx);
      if(timers[key]||window._timerState[key]){
        // Stop manuale: ferma tutto
        stopTimerFully(key);
        tBtn.className='rm-timer-btn idle';tBtn.textContent='\u25b6';
        if(lbl){lbl.className='rm-timer-lbl idle';lbl.textContent='\u23f1 '+t('timer').toUpperCase();}
        if(wrap)wrap.className='rm-timer';
        if(dsp){dsp.className='rm-timer-display';dsp.textContent=fmtTime(timerSecs);}
      } else {
        tBtn.className='rm-timer-btn running';tBtn.textContent='\u25a0';
        if(lbl){lbl.className='rm-timer-lbl running';lbl.textContent='\u23f1 '+t('running').toUpperCase();}
        if(wrap)wrap.className='rm-timer running';
        if(dsp)dsp.className='rm-timer-display running';
        var meta={
          taskName: (window._taskNames&&window._taskNames[prepTaskId])||prepTaskId||'',
          stepTitle: steps[idx]&&((window.user&&window.user.lang==='it'&&steps[idx].title_it)||steps[idx].title||''),
          prepTaskId: prepTaskId||null,
          recipeId: (steps[idx]&&steps[idx].recipe_id)||null
        };
        startTimer(key,timerSecs,
          function(rem){if(dsp)dsp.textContent=fmtTime(rem);},
          function(){
            if(dsp){dsp.textContent=t('done')+' \u2713';dsp.className='rm-timer-display done';}
            if(lbl){lbl.textContent='\u2713 '+t('done').toUpperCase();lbl.className='rm-timer-lbl done';}
            if(wrap)wrap.className='rm-timer done-state';
            if(tBtn){tBtn.className='rm-timer-btn done';tBtn.textContent='\u2713';}
            if(navigator.vibrate)navigator.vibrate([200,100,200]);
          },
          meta
        );
      }
    });
  }
  document.getElementById('rmPrev')?.addEventListener('click',()=>{
    const cur=getCurrentStep();
    if(cur>0){
      stopTimer(`step_${cur}`);
      setCurrentStep(cur-1);
      if(prepTaskId&&typeof window.prepOnStepChange==='function') window.prepOnStepChange(prepTaskId,cur-1,totalSteps);
      renderFn();
    }
  });
  document.getElementById('rmNext')?.addEventListener('click',()=>{
    const cur=getCurrentStep();
    if(cur<steps.length-1){
      stopTimer(`step_${cur}`);
      setCurrentStep(cur+1);
      if(prepTaskId&&typeof window.prepOnStepChange==='function') window.prepOnStepChange(prepTaskId,cur+1,totalSteps);
      renderFn();
    } else {
      // Ultimo step — chiudi recipe overlay PRIMA di aprire DONE sheet
      if(prepTaskId && typeof window.openDoneSheet==='function'){
        _transitionToDone(prepTaskId);
      } else {
        closeModalFn();
      }
    }
  });
}

// ── MAIN ─────────────────────────────────────────────────
window.recipeModal={
  open: async function(recipeId, prepTaskId){
    document.getElementById('rmOverlay')?.remove();
    if(!document.getElementById('rmStyle')) document.head.insertAdjacentHTML('beforeend',STYLE);
    window.lockPrepScroll('recipe-modal');
    // NON killare timer globali: restano attivi nella timer bar
    Object.keys(timers).forEach(function(k){
      if(!window._timerState[k]){ clearInterval(timers[k].interval); delete timers[k]; }
    });

    // ── Carica prep task info (sempre, per stock pill e suggested_qty)
    let prepTask=null;
    if(prepTaskId){
      const{data:pt}=await supa.from('prep_tasks').select('*').eq('id',prepTaskId).maybeSingle();
      prepTask=pt;
    }

    // ── v624: Carica prep_suggestions_daily per Chef AI Step 1 (non bloccante)
    let prepSugg=null;
    if(prepTaskId){
      try{
        const{data:sd}=await supa.from('prep_suggestions_daily')
          .select('status,confidence,net_requirement,planned_output,output_unit,minimum_increment,current_stock,stock_source,forecast,coverage_days,production_constraint_quality,demand_source,debug_json,suggestion_date')
          .eq('prep_task_id',prepTaskId)
          .order('suggestion_date',{ascending:false})
          .limit(1)
          .maybeSingle();
        prepSugg=sd||null;
      }catch(e){}
    }

    // ── Carica prep_steps (per task senza ricetta o con steps operativi)
    let prepSteps=[];
    if(prepTaskId){
      const{data:ps}=await supa.from('prep_steps').select('*').eq('prep_task_id',prepTaskId).order('sort_order');
      prepSteps=ps||[];
    }

    // ── Carica ricetta + BOM + recipe_steps se c'è recipe_id
    let rec=null, bomRows=[], recipeSteps=[];
    if(recipeId){
      const{data:r}=await supa.from('recipes').select('*').eq('id',recipeId).maybeSingle();
      rec=r;
      if(rec){
        const{data:bom}=await supa.from('recipe_bom')
          .select('quantity,unit,component_type,item_id,sub_recipe_id,ingredients(name),recipes!recipe_bom_sub_recipe_id_fkey(title)')
          .eq('parent_recipe_id',recipeId).order('sort_order');
        bomRows=bom||[];
        const{data:rs}=await supa.from('recipe_steps').select('*').eq('recipe_id',recipeId).order('step_number');
        recipeSteps=rs||[];
      }
    }

    // ── Determina modalità ──────────────────────────────
    // 1. Ha ricetta con BOM o recipe_steps → modal completo
    // 2. Ha solo prep_steps → modal steps leggero (senza BOM)
    // 3. Ha solo nota → modal bare
    // 4. Niente → modal bare minimo
    const hasRecipe = !!rec;
    const hasBom = bomRows.length>0;
    const hasRecipeSteps = recipeSteps.length>0;
    const hasPrepSteps = prepSteps.length>0;
    const hasNote = prepTask?.note && prepTask.note.trim().length>0;

    // ── Resolved steps: prep_steps take precedence over recipe_steps ──────────
    // prep_steps = kitchen-specific operational instructions for this prep task
    // recipe_steps = generic recipe method (how to cook the dish)
    // Rule: if the task has its own prep_steps, those are the authoritative step source.
    // Never concatenate both; they describe overlapping production at different granularities.
    const resolvedSteps = hasPrepSteps ? prepSteps : recipeSteps;
    const hasResolvedSteps = resolvedSteps.length > 0;
    // Update hasRecipeSteps-dependent logic to use resolvedSteps
    const hasStepsForTab = hasResolvedSteps;

    const title = rec?.title || prepTask?.name || '';
    const category = rec?.menu_group||rec?.category||prepTask?.category||'';

    // Pill header
    const pills=[];
    if(rec?.base_servings) pills.push(`🍽️ ${rec.base_servings} ${t('servings').toLowerCase()}`);
    if(rec?.shelf_life_days) pills.push(`📅 ${rec.shelf_life_days} ${rec.shelf_life_days===1?t('day'):t('days')}`);

    // v627: bot pill — prefer new prepSugg.planned_output over legacy suggested_qty
    let suggestedPortions=null;
    let _pillLabel='';
    const _bwgPill = rec?.base_weight_g ? parseFloat(rec.base_weight_g) : null;
    const _bsPill  = rec?.base_servings  ? parseFloat(rec.base_servings)  : null;

    if(prepSugg && prepSugg.planned_output != null){
      const po=parseFloat(prepSugg.planned_output);
      const pq=prepSugg.production_constraint_quality||'missing';
      if(!isNaN(po)&&po>0&&(pq==='valid_fixed_batch'||pq==='valid_scalable')){
        if(_bwgPill&&_bwgPill>0){
          // Weight-based: show batches
          const batches=Math.round(po/_bwgPill);
          suggestedPortions=Math.round((po/_bwgPill)*(_bsPill||1)); // internal: servings unit for scaler
          _pillLabel=`🤖 ${batches} batch${batches===1?'':'es'} today`;
        } else {
          suggestedPortions=Math.round(po);
          _pillLabel=`🤖 ${suggestedPortions} ${prepSugg.output_unit||'pcs'} today`;
        }
      }
    }
    const botPill=suggestedPortions&&_pillLabel?`<span class="rm-sub-pill rm-bot-pill" id="rmBotPill" data-portions="${suggestedPortions}">${_pillLabel}</span>`:'';

    const overlay=document.createElement('div');
    overlay.id='rmOverlay';

    const closeFn=()=>closeModal(prepTaskId);

    // ── MODALITÀ 1: Ricetta completa ──────────────────
    if(hasRecipe && (hasBom||hasStepsForTab)){
      const tabs=[];
      if(hasBom) tabs.push({key:'ingredients',label:t('ingredients')});
      if(hasStepsForTab) tabs.push({key:'steps',label:t('steps')});
      tabs.push({key:'notes',label:t('notes')});

      const totalSteps=resolvedSteps.length;
      let currentStep=0;
      if(prepTaskId&&window._taskStep&&window._taskStep[prepTaskId]!==undefined){
        currentStep=Math.min(window._taskStep[prepTaskId],Math.max(0,totalSteps-1));
      }

      // Always open on Ingredients when available — never preserve previous tab state across modal opens
      let activeTab = hasBom ? 'ingredients' : (hasStepsForTab ? 'steps' : 'notes');
      const baseServings=rec.base_servings||1;
      const baseWeightG=rec.base_weight_g?parseFloat(rec.base_weight_g):null;

      // ── AUTO-SCALE to planned_output from suggestion ──────────────────────
      // The card already shows the planned_output from window._suggestions[id].
      // The modal must open at the same quantity the card shows — no re-calculation.
      // Priority: use window._suggestions[id] first (same data the card used),
      // then fall back to the freshly loaded prepSugg from DB if not available.
      // Scaling rules:
      //   Weight-based (base_weight_g set): scale = planned_output / base_weight_g
      //   Piece/discrete (base_servings > 1): _initialServings = planned_output
      //   Unit-based (base_servings null or 1): _initialServings = planned_output directly
      //   Fallback: _initialServings = baseServings (= 1 if null)
      const _cardSugg = prepTaskId ? (window._suggestions || {})[prepTaskId] : null;
      const _activeSugg = _cardSugg || prepSugg; // prefer card's data for consistency
      let scaleFactor = 1;
      let _initialServings = baseServings; // default: base_servings (may be 1)
      if(_activeSugg && _activeSugg.planned_output != null){
        const po = parseFloat(_activeSugg.planned_output);
        const pq = _activeSugg.production_constraint_quality || 'missing';
        const isValidConstraint = pq === 'valid_fixed_batch' || pq === 'valid_scalable';
        if(!isNaN(po) && po > 0 && isValidConstraint){
          if(baseWeightG && baseWeightG > 0){
            // Weight-based: scale factor drives ingredient amounts
            scaleFactor = po / baseWeightG;
            _initialServings = Math.max(1, Math.round(scaleFactor * baseServings));
          } else if(baseServings > 1){
            // Discrete recipe with meaningful servings count
            scaleFactor = po / baseServings;
            _initialServings = Math.max(1, Math.round(po));
          } else {
            // Unit-based or base_servings=null/1: planned_output IS the servings count
            // This is the Siciliana case: base_servings=null, planned_output=3 → show 3
            _initialServings = Math.max(1, Math.round(po));
            scaleFactor = _initialServings / (baseServings || 1);
          }
          // Cap at sane value to prevent runaway scaling
          if(scaleFactor > 50) { scaleFactor = 1; _initialServings = baseServings || 1; }
        }
      }

      overlay.innerHTML=buildShell(title,category,pills,botPill,tabs);
      document.body.appendChild(overlay);
      // v624: Chef AI Step 1 — inietta blocco dati sopra il body del modal
      {const _caiHtml=buildChefAiStep1Block(prepSugg,prepTask);if(_caiHtml){const _caiEl=document.createElement('div');_caiEl.id='rmChefAiBlock';_caiEl.innerHTML=_caiHtml;const _rmSheet=overlay.querySelector('#rmSheet');if(_rmSheet){const _rmBody=overlay.querySelector('#rmBody');if(_rmBody)_rmSheet.insertBefore(_caiEl,_rmBody);}}_bindRmChefAiBar();}
      overlay.addEventListener('click',e=>{if(e.target===overlay)closeFn();});

      // bot pill → salta a ingredienti con porzioni suggerite
      overlay.addEventListener('click',e=>{
        if(e.target.id==='rmBotPill'){
          const sp=parseInt(e.target.dataset.portions);
          if(!isNaN(sp)){
            activeTab='ingredients';
            overlay.querySelectorAll('.rm-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab==='ingredients'));
            scaleFactor=sp/baseServings;
            document.getElementById('rmBody').innerHTML=buildIngredients(bomRows,scaleFactor,baseServings);
            bindIngredients(sp);
          }
        }
      });

      // Attiva tab giusta — inizia su ingredients tab con scale già applicato
      overlay.querySelectorAll('.rm-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
      if(activeTab==='ingredients'){
        // Apri direttamente con il scale suggerito
        const body=document.getElementById('rmBody');
        if(body){body.innerHTML=buildIngredients(bomRows,scaleFactor,baseServings);bindIngredients(_initialServings);}
      } else {
        renderTab(activeTab);
      }

      overlay.querySelectorAll('.rm-tab').forEach(btn=>{
        btn.addEventListener('click',()=>{
          activeTab=btn.dataset.tab;
          overlay.querySelectorAll('.rm-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
          renderTab(activeTab);
        });
      });
      overlay.querySelector('.rm-close').addEventListener('click',closeFn);

      // ── DONE footer — visible when recipe has BOM but no steps ──
      if(hasBom && !hasStepsForTab && prepTaskId){
        const doneFooter=document.createElement('div');
        doneFooter.id='rmDoneFooter';
        doneFooter.innerHTML='<button id="rmIngDoneBtn">✓ Done — log quantity</button>';
        const rmSheet=overlay.querySelector('#rmSheet');
        if(rmSheet) rmSheet.appendChild(doneFooter);
        doneFooter.querySelector('#rmIngDoneBtn').addEventListener('click',()=>{
          _transitionToDone(prepTaskId);
        });
      }

      function renderTab(tab){
        const body=document.getElementById('rmBody');
        if(tab==='ingredients'){body.innerHTML=buildIngredients(bomRows,scaleFactor,baseServings);bindIngredients();}
        else if(tab==='steps'){body.innerHTML=renderStepView(resolvedSteps,currentStep,prepTaskId,totalSteps,closeFn,bomRows,scaleFactor);bindStepEvents(resolvedSteps,()=>currentStep,s=>{currentStep=s;},prepTaskId,totalSteps,()=>renderTab('steps'),closeFn,()=>bomRows,()=>scaleFactor);}
        else body.innerHTML=buildNotes(rec);
      }

      function buildIngredients(bom,factor,base){
        if(!bom||bom.length===0) return `<div class="rm-empty"><div class="rm-empty-icon">📋</div>${t('noIng').replace('\n','<br>')}</div>`;
        // v627: label reflects batch vs pieces
        const _bwg = rec && rec.base_weight_g ? parseFloat(rec.base_weight_g) : null;
        const _bs  = base || 1;
        const _selectorLabel = _bwg && _bwg > 0 ? 'Batches' : (_bs > 1 ? 'Pieces' : 'Servings');
        const _displayVal = Math.round(factor * _bs) || _bs;
        return `<div class="rm-servings"><span class="rm-servings-label">${_selectorLabel}</span><div class="rm-stepper"><button class="rm-step-btn" id="rmMinus">−</button><input type="number" class="rm-servings-val" id="rmServVal" min="1" max="9999" inputmode="numeric" value="${_displayVal}"><button class="rm-step-btn" id="rmPlus">+</button></div></div><div class="rm-ing-list" id="rmIngList">${renderIngList(bom,factor)}</div>`;
      }
      function renderIngList(bom,factor){
        return bom.map(b=>{
          const name=b.component_type==='RECIPE'?(b.recipes?.title||'—'):(b.ingredients?.name||'—');
          return `<div class="rm-ing-row"><div class="rm-ing-icon">${ingIcon(name)}</div><div class="rm-ing-name">${name}</div><span class="rm-ing-qty">${fmtQty(b.quantity,factor)}<span class="rm-ing-unit">${b.unit||''}</span></span></div>`;
        }).join('');
      }
      function bindIngredients(startServings){
        let servings=startServings||baseServings;
        const val=document.getElementById('rmServVal');
        const list=document.getElementById('rmIngList');
        function update(s){servings=Math.max(1,Math.min(9999,Math.round(s)));scaleFactor=servings/baseServings;if(val)val.value=servings;if(list&&bomRows)list.innerHTML=renderIngList(bomRows,scaleFactor);
          // Se siamo nel tab steps, aggiorna anche il testo degli steps con il nuovo scaleFactor
          if(activeTab==='steps'){
            const body=document.getElementById('rmBody');
            if(body){body.innerHTML=renderStepView(resolvedSteps,currentStep,prepTaskId,totalSteps,closeFn,bomRows,scaleFactor);bindStepEvents(resolvedSteps,()=>currentStep,s=>{currentStep=s;},prepTaskId,totalSteps,()=>renderTab('steps'),closeFn,()=>bomRows,()=>scaleFactor);}
          }
        }
        document.getElementById('rmMinus')?.addEventListener('click',()=>update(servings-1));
        document.getElementById('rmPlus')?.addEventListener('click',()=>update(servings+1));
        // Digitazione diretta nel campo numero
        val?.addEventListener('input',()=>{
          const v=parseInt(val.value,10);
          if(!isNaN(v)&&v>=1) update(v);
        });
        val?.addEventListener('blur',()=>{
          // Al blur, correggi se vuoto o < 1
          const v=parseInt(val.value,10);
          update(isNaN(v)||v<1?1:v);
        });
        val?.addEventListener('focus',()=>val.select());
      }
      function buildNotes(rec){
        const rows=[];
        if(rec.base_weight_g) rows.push(['⚖️',`<strong>${t('yieldLbl')}:</strong> ${rec.base_weight_g}g`]);
        if(rec.shelf_life_days) rows.push(['📅',`<strong>${t('shelfLbl')}:</strong> ${rec.shelf_life_days} ${rec.shelf_life_days===1?t('day'):t('days')}`]);
        if(rec.prep_time_minutes) rows.push(['⏱',`<strong>Prep:</strong> ${rec.prep_time_minutes} min`]);
        if(rec.equipment) rows.push(['🔧',`<strong>${t('equipLbl')}:</strong> ${rec.equipment}`]);
        const procLang=(lang==='it'&&rec.procedure)?rec.procedure:(lang==='es'&&rec.procedure_es)?rec.procedure_es:(rec.procedure_en||rec.procedure||'');
        if(procLang) rows.push(['📝',procLang]);
        if(!rows.length) return `<div class="rm-empty"><div class="rm-empty-icon">📝</div>${t('noNotes')}</div>`;
        return `<div class="rm-notes-card">${rows.map(([icon,text])=>`<div class="rm-note-row"><span class="rm-note-icon">${icon}</span><div class="rm-note-text">${text}</div></div>`).join('')}</div>`;
      }
      return;
    }

    // ── MODALITÀ 2: Solo prep_steps (senza ricetta o ricetta senza steps/BOM) ──
    if(hasPrepSteps){
      const totalSteps=prepSteps.length;
      let currentStep=0;
      if(prepTaskId&&window._taskStep&&window._taskStep[prepTaskId]!==undefined){
        currentStep=Math.min(window._taskStep[prepTaskId],Math.max(0,totalSteps-1));
      }
      overlay.innerHTML=buildShell(title,category,pills,botPill,[]);
      document.body.appendChild(overlay);
      // v624: Chef AI Step 1
      {const _caiHtml=buildChefAiStep1Block(prepSugg,prepTask);if(_caiHtml){const _caiEl=document.createElement('div');_caiEl.id='rmChefAiBlock';_caiEl.innerHTML=_caiHtml;const _rmSheet=overlay.querySelector('#rmSheet');if(_rmSheet){const _rmBody=overlay.querySelector('#rmBody');if(_rmBody)_rmSheet.insertBefore(_caiEl,_rmBody);}}_bindRmChefAiBar();}
      overlay.addEventListener('click',e=>{if(e.target===overlay)closeFn();});
      overlay.querySelector('.rm-close').addEventListener('click',closeFn);

      function renderPrepSteps(){
        document.getElementById('rmBody').innerHTML=renderStepView(prepSteps,currentStep,prepTaskId,totalSteps,closeFn);
        bindStepEvents(prepSteps,()=>currentStep,s=>{currentStep=s;},prepTaskId,totalSteps,renderPrepSteps,closeFn);
      }
      renderPrepSteps();
      return;
    }

    // ── MODALITÀ 3 & 4: Nota semplice o bare ──────────
    overlay.innerHTML=buildShell(title,category,pills,botPill,[]);
    document.body.appendChild(overlay);
    // v624: Chef AI Step 1
    {const _caiHtml=buildChefAiStep1Block(prepSugg,prepTask);if(_caiHtml){const _caiEl=document.createElement('div');_caiEl.id='rmChefAiBlock';_caiEl.innerHTML=_caiHtml;const _rmSheet=overlay.querySelector('#rmSheet');if(_rmSheet){const _rmBody=overlay.querySelector('#rmBody');if(_rmBody)_rmSheet.insertBefore(_caiEl,_rmBody);}}_bindRmChefAiBar();}
    overlay.addEventListener('click',e=>{if(e.target===overlay)closeFn();});
    overlay.querySelector('.rm-close').addEventListener('click',closeFn);

    const _procLang=(lang==='it'&&rec?.procedure)?rec.procedure:(lang==='es'&&rec?.procedure_es)?rec.procedure_es:(rec?.procedure_en||rec?.procedure||'');
    const noteText=hasNote?prepTask.note:_procLang;
    document.getElementById('rmBody').innerHTML=`
      <div class="rm-bare-body">
        ${noteText?`<div class="rm-bare-note">${noteText}</div>`:`<div class="rm-empty"><div class="rm-empty-icon">✅</div></div>`}
        <button class="rm-bare-done" id="rmBareDoneBtn">${t('doneBtn')}</button>
      </div>`;
    // Bind DONE button — apre quantity sheet IN-FLOW senza chiudere il modal prima
    document.getElementById('rmBareDoneBtn')?.addEventListener('click', ()=>{
      if(prepTaskId && typeof window.openDoneSheet==='function'){
        _transitionToDone(prepTaskId);
      } else {
        closeFn();
      }
    });
  },
  close: function(prepTaskId){ closeModal(prepTaskId); }
};

// ── DEBUG HELPER — physical device QA only ────────────────────────────────────
// Usage: prepDebugState() in browser console
// Returns current prep workflow state for validation on iPhone.
// Non-intrusive: no visible UI, no continuous logging.
window.prepDebugState = function() {
  var overlays = {
    rmOverlay:      !!document.getElementById('rmOverlay'),
    doneSheet:      !!document.querySelector('[data-prep-done-sheet]'),
    wipSheet:       !!document.getElementById('v624WipSheet'),
    confirmPopup:   !!document.getElementById('_dscConfirmCancel'),
    suggSheet:      !!document.getElementById('rmSuggSheet'),
  };
  var doneSheetEl = document.querySelector('[data-prep-done-sheet]');
  var doneTaskId  = doneSheetEl ? doneSheetEl.getAttribute('data-prep-done-sheet') : null;
  var qtyInput    = doneTaskId ? document.getElementById('dsc-qty-' + doneTaskId) : null;
  var scrollOwners = window._prepScrollOwners || [];
  return {
    scrollLock: {
      owners:      scrollOwners.slice(),
      locked:      scrollOwners.length > 0,
      bodyPosition: document.body.style.position,
      bodyTop:      document.body.style.top,
      savedScrollY: window._prepScrollSavedY,
    },
    overlays: overlays,
    activeTaskId:   doneTaskId,
    qtyFieldValue:  qtyInput ? qtyInput.value : null,
    qtyInputmode:   qtyInput ? qtyInput.getAttribute('inputmode') : null,
    timerKeys:      Object.keys(window._timerState || {}),
  };
};
// Deterministic: removes overlay immediately (no fade), then opens DONE sheet.
function _transitionToDone(prepTaskId) {
  // 1. Stop local timer intervals (global _timerState preserved — timer bar continues)
  Object.keys(timers).forEach(function(k){ clearInterval(timers[k].interval); delete timers[k]; });
  // 2. Fire step-sync callback
  if (prepTaskId && typeof window.prepOnModalClose === 'function') window.prepOnModalClose(prepTaskId);
  // 3. Remove sub-overlays
  document.getElementById('rmSuggSheet')?.remove();
  // 4. Remove recipe overlay immediately (no fade — user is transitioning to DONE)
  var o = document.getElementById('rmOverlay');
  if (o) o.remove();
  // 5. Unlock recipe-modal scroll owner (DONE sheet will acquire its own owner)
  window.unlockPrepScroll('recipe-modal');
  // 6. Clear pending flag — cleanup is done here, not by _rmOverlayCleanup
  window._rmDonePending = null;
  // 7. Open DONE sheet synchronously (DOM is clean)
  if (prepTaskId && typeof window.openDoneSheet === 'function') {
    window.openDoneSheet(prepTaskId);
  }
}
// Expose for MODALITÀ 2 (prep_steps) and bare DONE buttons via window reference
window._transitionRecipeToDone = function(prepTaskId, _unusedCloseModalFn) {
  _transitionToDone(prepTaskId);
};

function closeModal(prepTaskId){
  // Ferma interval locali ma NON cancella _timerState: timer bar continua
  Object.keys(timers).forEach(function(k){ clearInterval(timers[k].interval); delete timers[k]; });
  if(prepTaskId&&typeof window.prepOnModalClose==='function') window.prepOnModalClose(prepTaskId);
  // Close suggestion sheet if open
  document.getElementById('rmSuggSheet')?.remove();
  window.unlockPrepScroll('recipe-modal');
  var o=document.getElementById('rmOverlay');
  if(o){o.style.opacity='0';o.style.transition='opacity .2s';setTimeout(function(){o.remove();},200);}
}

// Chiude l'overlay residuo dopo il salvataggio dal Done sheet in-flow
window._rmOverlayCleanup = function(){
  window._rmDonePending=null;
  document.getElementById('rmSuggSheet')?.remove();
  var o=document.getElementById('rmOverlay');
  if(o){o.style.opacity='0';o.style.transition='opacity .15s';setTimeout(function(){o.remove();},150);}
};

})();




