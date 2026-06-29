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
.rm-servings-val{font-size:20px;font-weight:800;color:#1e3a5f;min-width:32px;text-align:center;}
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
const timers={};
function startTimer(key,secs,onTick,onDone){
  if(timers[key]){clearInterval(timers[key].interval);delete timers[key];return false;}
  let rem=secs;
  timers[key]={rem};
  if(typeof window._prepTimerStarted==='function') window._prepTimerStarted();
  timers[key].interval=setInterval(()=>{
    rem--;timers[key].rem=rem;
    if(rem<=0){clearInterval(timers[key].interval);delete timers[key];if(typeof window._prepTimerStopped==='function')window._prepTimerStopped();onDone&&onDone();return;}
    onTick&&onTick(rem);
  },1000);
  return true;
}
function stopTimer(key){if(timers[key]){clearInterval(timers[key].interval);delete timers[key];if(typeof window._prepTimerStopped==='function')window._prepTimerStopped();}}
function fmtTime(s){return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}

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
  const timerHtml=timerSecs?`
    <div class="rm-timer" id="rmTimer_${currentStep}">
      <div class="rm-timer-info">
        <span class="rm-timer-lbl idle" id="rmTlbl_${currentStep}">⏱ ${t('timer').toUpperCase()}</span>
        <span class="rm-timer-display" id="rmTdsp_${currentStep}">${fmtTime(timerSecs)}</span>
      </div>
      <button class="rm-timer-btn idle" id="rmTbtn_${currentStep}" data-secs="${timerSecs}">▶</button>
    </div>`:'';
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
  const idx=getCurrentStep();
  const timerSecs = steps[idx].timer_seconds || (steps[idx].timer_minutes ? steps[idx].timer_minutes*60 : 0);
  const tBtn=document.getElementById(`rmTbtn_${idx}`);
  if(tBtn&&timerSecs){
    tBtn.addEventListener('click',()=>{
      const key=`step_${idx}`;
      const dsp=document.getElementById(`rmTdsp_${idx}`);
      const lbl=document.getElementById(`rmTlbl_${idx}`);
      const wrap=document.getElementById(`rmTimer_${idx}`);
      if(timers[key]){
        stopTimer(key);
        tBtn.className='rm-timer-btn idle';tBtn.textContent='▶';
        if(lbl){lbl.className='rm-timer-lbl idle';lbl.textContent=`⏱ ${t('timer').toUpperCase()}`;}
        if(wrap)wrap.className='rm-timer';
        if(dsp){dsp.className='rm-timer-display';dsp.textContent=fmtTime(timerSecs);}
      } else {
        tBtn.className='rm-timer-btn running';tBtn.textContent='■';
        if(lbl){lbl.className='rm-timer-lbl running';lbl.textContent=`⏱ ${t('running').toUpperCase()}`;}
        if(wrap)wrap.className='rm-timer running';
        if(dsp)dsp.className='rm-timer-display running';
        startTimer(key,timerSecs,
          rem=>{if(dsp)dsp.textContent=fmtTime(rem);},
          ()=>{
            if(dsp){dsp.textContent=t('done')+' ✓';dsp.className='rm-timer-display done';}
            if(lbl){lbl.textContent='✓ '+t('done').toUpperCase();lbl.className='rm-timer-lbl done';}
            if(wrap)wrap.className='rm-timer done-state';
            if(tBtn){tBtn.className='rm-timer-btn done';tBtn.textContent='✓';}
            if(navigator.vibrate)navigator.vibrate([200,100,200]);
          }
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
      closeModalFn();
    }
  });
}

// ── MAIN ─────────────────────────────────────────────────
window.recipeModal={
  open: async function(recipeId, prepTaskId){
    document.getElementById('rmOverlay')?.remove();
    if(!document.getElementById('rmStyle')) document.head.insertAdjacentHTML('beforeend',STYLE);
    Object.keys(timers).forEach(k=>stopTimer(k));

    // ── Carica prep task info (sempre, per stock pill e suggested_qty)
    let prepTask=null;
    if(prepTaskId){
      const{data:pt}=await supa.from('prep_tasks').select('*').eq('id',prepTaskId).maybeSingle();
      prepTask=pt;
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

    const title = rec?.title || prepTask?.name || '';
    const category = rec?.menu_group||rec?.category||prepTask?.category||'';

    // Pill header
    const pills=[];
    if(rec?.base_servings) pills.push(`🍽️ ${rec.base_servings} ${t('servings').toLowerCase()}`);
    if(rec?.shelf_life_days) pills.push(`📅 ${rec.shelf_life_days} ${rec.shelf_life_days===1?t('day'):t('days')}`);

    // Bot pill suggested portions
    let suggestedPortions=null;
    if(prepTask?.suggested_qty && rec?.serving_weight_g){
      const sqG=parseFloat(prepTask.suggested_qty), swG=parseFloat(rec.serving_weight_g);
      if(sqG>0&&swG>0) suggestedPortions=Math.round(sqG/swG);
    } else if(prepTask?.suggested_qty && rec?.base_weight_g && rec?.base_servings){
      const sqG=parseFloat(prepTask.suggested_qty), bwG=parseFloat(rec.base_weight_g), bs=parseFloat(rec.base_servings);
      if(sqG>0&&bwG>0) suggestedPortions=Math.round((sqG/bwG)*bs);
    }
    const botPill=suggestedPortions?`<span class="rm-sub-pill rm-bot-pill" id="rmBotPill" data-portions="${suggestedPortions}">🤖 ${suggestedPortions} ${t('servings').toLowerCase()} today</span>`:'';

    const overlay=document.createElement('div');
    overlay.id='rmOverlay';

    const closeFn=()=>closeModal(prepTaskId);

    // ── MODALITÀ 1: Ricetta completa ──────────────────
    if(hasRecipe && (hasBom||hasRecipeSteps)){
      const tabs=[];
      if(hasBom) tabs.push({key:'ingredients',label:t('ingredients')});
      if(hasRecipeSteps) tabs.push({key:'steps',label:t('steps')});
      tabs.push({key:'notes',label:t('notes')});

      const totalSteps=recipeSteps.length;
      let currentStep=0;
      if(prepTaskId&&window._taskStep&&window._taskStep[prepTaskId]!==undefined){
        currentStep=Math.min(window._taskStep[prepTaskId],Math.max(0,totalSteps-1));
      }

      let activeTab=hasRecipeSteps?'steps':'ingredients';
      let scaleFactor=1;
      const baseServings=rec.base_servings||1;

      overlay.innerHTML=buildShell(title,category,pills,botPill,tabs);
      document.body.appendChild(overlay);
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

      // Attiva tab giusta
      overlay.querySelectorAll('.rm-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
      renderTab(activeTab);

      overlay.querySelectorAll('.rm-tab').forEach(btn=>{
        btn.addEventListener('click',()=>{
          activeTab=btn.dataset.tab;
          overlay.querySelectorAll('.rm-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
          renderTab(activeTab);
        });
      });
      overlay.querySelector('.rm-close').addEventListener('click',closeFn);

      function renderTab(tab){
        const body=document.getElementById('rmBody');
        if(tab==='ingredients'){body.innerHTML=buildIngredients(bomRows,scaleFactor,baseServings);bindIngredients();}
        else if(tab==='steps'){body.innerHTML=renderStepView(recipeSteps,currentStep,prepTaskId,totalSteps,closeFn,bomRows,scaleFactor);bindStepEvents(recipeSteps,()=>currentStep,s=>{currentStep=s;},prepTaskId,totalSteps,()=>renderTab('steps'),closeFn,()=>bomRows,()=>scaleFactor);}
        else body.innerHTML=buildNotes(rec);
      }

      function buildIngredients(bom,factor,base){
        if(!bom||bom.length===0) return `<div class="rm-empty"><div class="rm-empty-icon">📋</div>${t('noIng').replace('\n','<br>')}</div>`;
        return `<div class="rm-servings"><span class="rm-servings-label">${t('servings')}</span><div class="rm-stepper"><button class="rm-step-btn" id="rmMinus">−</button><span class="rm-servings-val" id="rmServVal">${Math.round(factor*base)||base}</span><button class="rm-step-btn" id="rmPlus">+</button></div></div><div class="rm-ing-list" id="rmIngList">${renderIngList(bom,factor)}</div>`;
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
        function update(s){servings=Math.max(1,s);scaleFactor=servings/baseServings;if(val)val.textContent=servings;if(list&&bomRows)list.innerHTML=renderIngList(bomRows,scaleFactor);
          // Se siamo nel tab steps, aggiorna anche il testo degli steps con il nuovo scaleFactor
          if(activeTab==='steps'){
            const body=document.getElementById('rmBody');
            if(body){body.innerHTML=renderStepView(recipeSteps,currentStep,prepTaskId,totalSteps,closeFn,bomRows,scaleFactor);bindStepEvents(recipeSteps,()=>currentStep,s=>{currentStep=s;},prepTaskId,totalSteps,()=>renderTab('steps'),closeFn,()=>bomRows,()=>scaleFactor);}
          }
        }
        document.getElementById('rmMinus')?.addEventListener('click',()=>update(servings-1));
        document.getElementById('rmPlus')?.addEventListener('click',()=>update(servings+1));
      }
      function buildNotes(rec){
        const rows=[];
        if(rec.base_weight_g) rows.push(['⚖️',`<strong>${t('yieldLbl')}:</strong> ${rec.base_weight_g}g`]);
        if(rec.shelf_life_days) rows.push(['📅',`<strong>${t('shelfLbl')}:</strong> ${rec.shelf_life_days} ${rec.shelf_life_days===1?t('day'):t('days')}`]);
        if(rec.prep_time_minutes) rows.push(['⏱',`<strong>Prep:</strong> ${rec.prep_time_minutes} min`]);
        if(rec.equipment) rows.push(['🔧',`<strong>${t('equipLbl')}:</strong> ${rec.equipment}`]);
        if(rec.procedure) rows.push(['📝',rec.procedure]);
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
    overlay.addEventListener('click',e=>{if(e.target===overlay)closeFn();});
    overlay.querySelector('.rm-close').addEventListener('click',closeFn);

    const noteText=hasNote?prepTask.note:(rec?.procedure||'');
    document.getElementById('rmBody').innerHTML=`
      <div class="rm-bare-body">
        ${noteText?`<div class="rm-bare-note">${noteText}</div>`:`<div class="rm-empty"><div class="rm-empty-icon">✅</div></div>`}
        <button class="rm-bare-done" id="rmBareDoneBtn">${t('doneBtn')}</button>
      </div>`;
    // Bind DONE button — prima apre done sheet, poi chiude modal
    document.getElementById('rmBareDoneBtn')?.addEventListener('click', ()=>{
      // Chiudi overlay immediatamente senza aspettare animazione
      const o=document.getElementById('rmOverlay');
      if(o) o.remove();
      Object.keys(timers).forEach(k=>stopTimer(k));
      // Poi apri done sheet
      if(prepTaskId && typeof window.prepDone==='function') window.prepDone(prepTaskId);
    });
  },
  close: function(prepTaskId){ closeModal(prepTaskId); }
};

function closeModal(prepTaskId){
  Object.keys(timers).forEach(k=>stopTimer(k));
  if(prepTaskId&&typeof window.prepOnModalClose==='function') window.prepOnModalClose(prepTaskId);
  const o=document.getElementById('rmOverlay');
  if(o){o.style.opacity='0';o.style.transition='opacity .2s';setTimeout(()=>o.remove(),200);}
}

})();
