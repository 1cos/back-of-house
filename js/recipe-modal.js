// ── RECIPE MODAL — Brigade v1 ─────────────────────────────
// Componente unico riutilizzabile da prep.js e recipes.js
// Tab: Ingredients (BOM) | Steps (recipe_steps) | Notes
// ─────────────────────────────────────────────────────────

(function(){

// ── CSS ──────────────────────────────────────────────────
const STYLE = `
<style id="rmStyle">
#rmOverlay{
  position:fixed;inset:0;z-index:9000;
  background:rgba(15,23,42,0.7);
  backdrop-filter:blur(6px);
  -webkit-backdrop-filter:blur(6px);
  display:flex;align-items:flex-end;justify-content:center;
  animation:rmFadeIn .2s ease;
}
@keyframes rmFadeIn{from{opacity:0}to{opacity:1}}
@keyframes rmSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes rmConfetti{0%{transform:translateY(-10px) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(720deg);opacity:0}}

#rmSheet{
  width:100%;max-width:480px;
  background:#f0f4f8;
  border-radius:28px 28px 0 0;
  max-height:92vh;
  display:flex;flex-direction:column;
  overflow:hidden;
  animation:rmSlideUp .28s cubic-bezier(.32,1.1,.5,1);
  padding-bottom:env(safe-area-inset-bottom,16px);
}

/* Header */
#rmHeader{
  background:linear-gradient(135deg,#1e3a5f 0%,#1e40af 100%);
  padding:18px 18px 0;
  flex-shrink:0;
}
.rm-drag{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.25);margin:0 auto 14px;}
.rm-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;}
.rm-badge{
  display:inline-flex;align-items:center;gap:5px;
  background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.2);
  border-radius:20px;padding:4px 10px;
  font-size:11px;font-weight:600;color:rgba(255,255,255,0.9);
  letter-spacing:.04em;text-transform:uppercase;
}
.rm-close{
  width:32px;height:32px;border-radius:50%;
  background:rgba(255,255,255,0.15);border:none;
  color:white;font-size:20px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  line-height:1;flex-shrink:0;
}
.rm-title{font-size:24px;font-weight:800;color:white;letter-spacing:-.4px;line-height:1.1;margin-bottom:4px;}
.rm-sub{font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:14px;}

/* Tabs */
.rm-tabs{display:flex;border-top:1px solid rgba(255,255,255,0.1);}
.rm-tab{
  flex:1;padding:10px 0;
  font-size:12px;font-weight:600;
  color:rgba(255,255,255,0.45);
  background:none;border:none;
  border-bottom:2px solid transparent;
  cursor:pointer;letter-spacing:.04em;
  transition:all .18s;
}
.rm-tab.active{color:white;border-bottom-color:#60a5fa;}

/* Body */
#rmBody{flex:1;overflow-y:auto;padding:18px;-webkit-overflow-scrolling:touch;}

/* ── INGREDIENTS ── */
.rm-servings{
  display:flex;align-items:center;justify-content:space-between;
  background:white;border-radius:16px;padding:12px 16px;
  margin-bottom:14px;
  box-shadow:0 1px 4px rgba(30,58,95,0.07);
}
.rm-servings-label{font-size:13px;font-weight:600;color:#1e3a5f;}
.rm-stepper{display:flex;align-items:center;gap:10px;}
.rm-step-btn{
  width:30px;height:30px;border-radius:50%;
  background:#1e3a5f;border:none;
  color:white;font-size:18px;font-weight:700;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  line-height:1;
}
.rm-servings-val{font-size:16px;font-weight:800;color:#1e3a5f;min-width:28px;text-align:center;}
.rm-ing-list{display:flex;flex-direction:column;gap:8px;}
.rm-ing-row{
  display:flex;align-items:center;
  background:white;border-radius:14px;padding:11px 14px;
  box-shadow:0 1px 4px rgba(30,58,95,0.06);
}
.rm-ing-icon{
  width:34px;height:34px;border-radius:10px;
  background:linear-gradient(135deg,#dbeafe,#bfdbfe);
  display:flex;align-items:center;justify-content:center;
  font-size:16px;flex-shrink:0;margin-right:11px;
}
.rm-ing-name{flex:1;font-size:14px;font-weight:500;color:#1e3a5f;line-height:1.3;}
.rm-ing-qty{font-size:14px;font-weight:700;color:#2563eb;white-space:nowrap;}
.rm-ing-unit{font-size:11px;font-weight:500;color:#94a3b8;margin-left:2px;}

/* ── STEPS ── */
.rm-step-counter{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:10px;
}
.rm-step-counter-lbl{font-size:12px;font-weight:600;color:#94a3b8;letter-spacing:.04em;}
.rm-progress-bar{
  flex:1;height:3px;
  background:rgba(30,58,95,0.1);
  border-radius:2px;margin:0 10px;overflow:hidden;
}
.rm-progress-fill{
  height:100%;
  background:linear-gradient(90deg,#2563eb,#60a5fa);
  border-radius:2px;transition:width .3s ease;
}
.rm-dots{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:14px;flex-wrap:wrap;}
.rm-dot{
  width:8px;height:8px;border-radius:50%;
  background:rgba(30,58,95,0.15);transition:all .2s;flex-shrink:0;
}
.rm-dot.active{width:22px;border-radius:4px;background:#2563eb;}
.rm-dot.done{background:#60a5fa;}

.rm-step-card{
  background:white;border-radius:18px;padding:18px;
  box-shadow:0 2px 8px rgba(30,58,95,0.08);
  min-height:170px;display:flex;flex-direction:column;gap:12px;
  margin-bottom:14px;
}
.rm-step-num-row{display:flex;align-items:center;gap:10px;}
.rm-step-num{
  width:32px;height:32px;border-radius:10px;
  background:linear-gradient(135deg,#1e3a5f,#2563eb);
  color:white;font-size:13px;font-weight:800;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.rm-step-title{font-size:15px;font-weight:700;color:#1e3a5f;}
.rm-step-text{font-size:14px;color:#475569;line-height:1.65;flex:1;}

/* Timer */
.rm-timer{
  display:flex;align-items:center;justify-content:space-between;
  background:linear-gradient(135deg,#eff6ff,#dbeafe);
  border-radius:14px;padding:12px 14px;
  border:1px solid rgba(59,130,246,0.15);
}
.rm-timer.running{
  background:linear-gradient(135deg,#fff1f2,#fee2e2);
  border-color:rgba(239,68,68,0.2);
}
.rm-timer.done-state{
  background:linear-gradient(135deg,#f0fdf4,#dcfce7);
  border-color:rgba(5,150,105,0.2);
}
.rm-timer-info{display:flex;flex-direction:column;gap:2px;}
.rm-timer-lbl{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;}
.rm-timer-lbl.idle{color:#60a5fa;}
.rm-timer-lbl.running{color:#f87171;}
.rm-timer-lbl.done{color:#059669;}
.rm-timer-display{font-size:28px;font-weight:800;color:#1e3a5f;letter-spacing:-.5px;font-variant-numeric:tabular-nums;}
.rm-timer-display.running{color:#dc2626;}
.rm-timer-display.done{color:#059669;}
.rm-timer-btn{
  width:46px;height:46px;border-radius:14px;border:none;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:19px;transition:all .15s;
}
.rm-timer-btn.idle{
  background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;
  box-shadow:0 4px 12px rgba(30,58,95,0.3);
}
.rm-timer-btn.running{
  background:linear-gradient(135deg,#ef4444,#dc2626);color:white;
  box-shadow:0 4px 12px rgba(239,68,68,0.3);
}
.rm-timer-btn.done{
  background:linear-gradient(135deg,#059669,#10b981);color:white;
  box-shadow:0 4px 12px rgba(5,150,105,0.3);
}

/* Nav */
.rm-nav{display:flex;gap:10px;}
.rm-nav-btn{
  flex:1;height:48px;border-radius:14px;border:none;
  font-size:14px;font-weight:600;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:6px;
  transition:all .15s;
}
.rm-nav-btn.prev{
  background:white;color:#1e3a5f;
  border:1.5px solid #e2e8f0;
  box-shadow:0 1px 3px rgba(30,58,95,0.07);
}
.rm-nav-btn.prev:disabled{opacity:.35;cursor:default;}
.rm-nav-btn.next{
  background:linear-gradient(135deg,#1e3a5f,#2563eb);color:white;
  box-shadow:0 4px 14px rgba(30,58,95,0.28);
}
.rm-nav-btn.finish{
  background:linear-gradient(135deg,#059669,#10b981);color:white;
  box-shadow:0 4px 14px rgba(5,150,105,0.28);
}

/* ── NOTES ── */
.rm-notes-card{
  background:white;border-radius:16px;padding:4px 16px;
  box-shadow:0 1px 4px rgba(30,58,95,0.07);
}
.rm-note-row{
  display:flex;align-items:flex-start;gap:10px;
  padding:12px 0;border-bottom:1px solid #f1f5f9;
}
.rm-note-row:last-child{border-bottom:none;}
.rm-note-icon{font-size:16px;margin-top:1px;flex-shrink:0;}
.rm-note-text{font-size:13px;color:#334155;line-height:1.55;}
.rm-note-text strong{color:#1e3a5f;font-weight:600;}

/* Empty states */
.rm-empty{
  text-align:center;padding:40px 20px;
  color:#94a3b8;font-size:14px;line-height:1.6;
}
.rm-empty-icon{font-size:36px;margin-bottom:10px;}
</style>`;

// ── INGREDIENT ICONS MAP ─────────────────────────────────
const ING_ICONS = {
  potato:'🥔', butter:'🧈', cream:'🥛', rosemary:'🌿', thyme:'🌿',
  salt:'🧂', pepper:'⚫', garlic:'🧄', oil:'🫒', egg:'🥚',
  flour:'🌾', milk:'🥛', cheese:'🧀', tomato:'🍅', lemon:'🍋',
  orange:'🍊', onion:'🧅', carrot:'🥕', water:'💧', wine:'🍷',
  stock:'🍲', demi:'🍲', broth:'🍲', sugar:'🍬', chocolate:'🍫',
  parmesan:'🧀', pecorino:'🧀', mozzarella:'🧀', ricotta:'🧀',
  beef:'🥩', chicken:'🍗', salmon:'🐟', shrimp:'🦐', lobster:'🦞',
  scallop:'🐚', pasta:'🍝', rice:'🍚', bread:'🍞', truffle:'🍄',
  mushroom:'🍄', spinach:'🥬', arugula:'🥬', fennel:'🌿', basil:'🌿',
  bacon:'🥓', prosciutto:'🍖', sausage:'🌭',
};

function ingIcon(name){
  if(!name) return '🥄';
  const n = name.toLowerCase();
  for(const [key,icon] of Object.entries(ING_ICONS)){
    if(n.includes(key)) return icon;
  }
  return '🥄';
}

// ── UNIT FORMATTING ──────────────────────────────────────
function fmtQty(qty, scaleFactor){
  if(qty === null || qty === undefined || qty === '') return '';
  const raw = parseFloat(qty) * (scaleFactor || 1);
  if(isNaN(raw)) return qty;
  if(raw >= 100) return Math.round(raw).toString();
  if(raw >= 10)  return (Math.round(raw * 10) / 10).toFixed(1).replace(/\.0$/,'');
  return (Math.round(raw * 100) / 100).toFixed(2).replace(/\.?0+$/,'');
}

// ── TIMER STATE ──────────────────────────────────────────
const timers = {};

function startTimer(key, seconds, onTick, onDone){
  if(timers[key]) { clearInterval(timers[key].interval); delete timers[key]; return false; }
  let remaining = seconds;
  timers[key] = { remaining };
  timers[key].interval = setInterval(()=>{
    remaining--;
    timers[key].remaining = remaining;
    if(remaining <= 0){
      clearInterval(timers[key].interval);
      delete timers[key];
      onDone && onDone();
      return;
    }
    onTick && onTick(remaining);
  }, 1000);
  return true;
}

function stopTimer(key){
  if(timers[key]){ clearInterval(timers[key].interval); delete timers[key]; }
}

function fmtTime(s){
  const m = Math.floor(s/60), sec = s%60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// ── MAIN OPEN FUNCTION ───────────────────────────────────
window.recipeModal = {
  open: async function(recipeId, options){
    // Rimuovi eventuali modal aperti
    document.getElementById('rmOverlay')?.remove();
    const existingStyle = document.getElementById('rmStyle');
    if(!existingStyle) document.head.insertAdjacentHTML('beforeend', STYLE);

    // Stop tutti i timer attivi
    Object.keys(timers).forEach(k => stopTimer(k));

    // Fetch ricetta
    const {data: rec} = await supa.from('recipes').select('*').eq('id', recipeId).maybeSingle();
    if(!rec) return;

    // Fetch BOM ingredients
    const {data: bomRows} = await supa
      .from('recipe_bom')
      .select('quantity, unit, component_type, item_id, sub_recipe_id, ingredients(name), recipes!recipe_bom_sub_recipe_id_fkey(title)')
      .eq('recipe_id', recipeId)
      .order('id');

    // Fetch steps
    const {data: steps} = await supa
      .from('recipe_steps')
      .select('*')
      .eq('recipe_id', recipeId)
      .order('step_number');

    // Build overlay
    const overlay = document.createElement('div');
    overlay.id = 'rmOverlay';
    overlay.innerHTML = buildShell(rec, options);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if(e.target === overlay) closeModal(); });

    // Tab state
    let activeTab = 'ingredients';
    let currentStep = 0;
    let scaleFactor = 1;
    const baseServings = rec.base_servings || 1;

    // Render initial tab
    renderTab(activeTab);

    // Tab buttons
    overlay.querySelectorAll('.rm-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        overlay.querySelectorAll('.rm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
        renderTab(activeTab);
      });
    });

    // Close
    overlay.querySelector('.rm-close').addEventListener('click', closeModal);

    // ── RENDER TAB ─────────────────────────────────────
    function renderTab(tab){
      const body = document.getElementById('rmBody');
      if(tab === 'ingredients') body.innerHTML = buildIngredients(bomRows, scaleFactor, baseServings);
      else if(tab === 'steps')  body.innerHTML = buildStep(steps, currentStep);
      else                      body.innerHTML = buildNotes(rec);

      if(tab === 'ingredients') bindIngredients();
      if(tab === 'steps')       bindStep(steps);
    }

    // ── INGREDIENTS ────────────────────────────────────
    function buildIngredients(bom, factor, base){
      if(!bom || bom.length === 0){
        return `<div class="rm-empty"><div class="rm-empty-icon">📋</div>No ingredients linked yet.<br>Add BOM entries to see them here.</div>`;
      }
      const rows = bom.map(b => {
        const name = b.component_type === 'RECIPE'
          ? (b.recipes?.title || '—')
          : (b.ingredients?.name || '—');
        const qty = fmtQty(b.quantity, factor);
        const unit = b.unit || '';
        return `<div class="rm-ing-row">
          <div class="rm-ing-icon">${ingIcon(name)}</div>
          <div class="rm-ing-name">${name}</div>
          <span class="rm-ing-qty">${qty}<span class="rm-ing-unit">${unit}</span></span>
        </div>`;
      }).join('');

      return `
        <div class="rm-servings">
          <span class="rm-servings-label">Servings</span>
          <div class="rm-stepper">
            <button class="rm-step-btn" id="rmMinus">−</button>
            <span class="rm-servings-val" id="rmServVal">${base}</span>
            <button class="rm-step-btn" id="rmPlus">+</button>
          </div>
        </div>
        <div class="rm-ing-list" id="rmIngList">${rows}</div>`;
    }

    function bindIngredients(){
      let servings = baseServings;
      const val = document.getElementById('rmServVal');
      const list = document.getElementById('rmIngList');

      function updateScale(s){
        servings = Math.max(1, s);
        scaleFactor = servings / baseServings;
        if(val) val.textContent = servings;
        if(list && bomRows){
          list.innerHTML = bomRows.map(b => {
            const name = b.component_type === 'RECIPE'
              ? (b.recipes?.title || '—')
              : (b.ingredients?.name || '—');
            const qty = fmtQty(b.quantity, scaleFactor);
            const unit = b.unit || '';
            return `<div class="rm-ing-row">
              <div class="rm-ing-icon">${ingIcon(name)}</div>
              <div class="rm-ing-name">${name}</div>
              <span class="rm-ing-qty">${qty}<span class="rm-ing-unit">${unit}</span></span>
            </div>`;
          }).join('');
        }
      }

      document.getElementById('rmMinus')?.addEventListener('click', () => updateScale(servings - 1));
      document.getElementById('rmPlus')?.addEventListener('click',  () => updateScale(servings + 1));
    }

    // ── STEPS ──────────────────────────────────────────
    function buildStep(steps, idx){
      if(!steps || steps.length === 0){
        return `<div class="rm-empty"><div class="rm-empty-icon">👨‍🍳</div>No steps added yet.<br>Admin can add steps from the recipe editor.</div>`;
      }
      const step = steps[idx];
      const total = steps.length;
      const pct = Math.round(((idx + 1) / total) * 100);
      const lang = window.user?.lang || 'en';
      const instruction = (lang === 'it' && step.instruction_it) ? step.instruction_it
        : (lang === 'es' && step.instruction_es) ? step.instruction_es
        : (step.instruction_en || step.instruction_it || '');

      const dots = steps.map((_, i) =>
        `<div class="rm-dot ${i === idx ? 'active' : i < idx ? 'done' : ''}"></div>`
      ).join('');

      const timerHtml = step.timer_seconds ? `
        <div class="rm-timer" id="rmTimer_${idx}">
          <div class="rm-timer-info">
            <span class="rm-timer-lbl idle" id="rmTlbl_${idx}">⏱ Timer</span>
            <span class="rm-timer-display" id="rmTdsp_${idx}">${fmtTime(step.timer_seconds)}</span>
          </div>
          <button class="rm-timer-btn idle" id="rmTbtn_${idx}" data-idx="${idx}" data-secs="${step.timer_seconds}">▶</button>
        </div>` : '';

      const isLast = idx === total - 1;
      return `
        <div class="rm-step-counter">
          <span class="rm-step-counter-lbl">Step ${idx+1} of ${total}</span>
          <div class="rm-progress-bar"><div class="rm-progress-fill" style="width:${pct}%"></div></div>
          <span class="rm-step-counter-lbl">${pct}%</span>
        </div>
        <div class="rm-dots">${dots}</div>
        <div class="rm-step-card">
          <div class="rm-step-num-row">
            <div class="rm-step-num">${idx+1}</div>
            <div class="rm-step-title">${step.title}</div>
          </div>
          <div class="rm-step-text">${instruction}</div>
          ${timerHtml}
        </div>
        <div class="rm-nav">
          <button class="rm-nav-btn prev" id="rmPrev" ${idx===0?'disabled':''}>← Prev</button>
          <button class="rm-nav-btn ${isLast?'finish':'next'}" id="rmNext">
            ${isLast ? '✓ Done' : 'Next →'}
          </button>
        </div>`;
    }

    function bindStep(steps){
      // Timer
      const tBtn = document.getElementById(`rmTbtn_${currentStep}`);
      if(tBtn){
        tBtn.addEventListener('click', () => {
          const key = `step_${currentStep}`;
          const secs = parseInt(tBtn.dataset.secs);
          const dsp  = document.getElementById(`rmTdsp_${currentStep}`);
          const lbl  = document.getElementById(`rmTlbl_${currentStep}`);
          const wrap = document.getElementById(`rmTimer_${currentStep}`);

          if(timers[key]){
            // Stop
            stopTimer(key);
            tBtn.className = 'rm-timer-btn idle'; tBtn.textContent = '▶';
            lbl.className = 'rm-timer-lbl idle'; lbl.textContent = '⏱ Timer';
            wrap.className = 'rm-timer';
            dsp.className = 'rm-timer-display'; dsp.textContent = fmtTime(secs);
          } else {
            // Start
            tBtn.className = 'rm-timer-btn running'; tBtn.textContent = '■';
            lbl.className = 'rm-timer-lbl running'; lbl.textContent = '⏱ Running';
            wrap.className = 'rm-timer running';
            dsp.className = 'rm-timer-display running';
            startTimer(key, secs,
              rem => { if(dsp) dsp.textContent = fmtTime(rem); },
              () => {
                if(dsp){ dsp.textContent = 'DONE ✓'; dsp.className = 'rm-timer-display done'; }
                if(lbl){ lbl.textContent = '✓ Done'; lbl.className = 'rm-timer-lbl done'; }
                if(wrap) wrap.className = 'rm-timer done-state';
                if(tBtn){ tBtn.className = 'rm-timer-btn done'; tBtn.textContent = '✓'; }
                // Vibrate if supported
                if(navigator.vibrate) navigator.vibrate([200,100,200]);
              }
            );
          }
        });
      }

      // Prev
      document.getElementById('rmPrev')?.addEventListener('click', () => {
        if(currentStep > 0){
          stopTimer(`step_${currentStep}`);
          currentStep--;
          document.getElementById('rmBody').innerHTML = buildStep(steps, currentStep);
          bindStep(steps);
        }
      });

      // Next / Done
      document.getElementById('rmNext')?.addEventListener('click', () => {
        if(currentStep < steps.length - 1){
          stopTimer(`step_${currentStep}`);
          currentStep++;
          document.getElementById('rmBody').innerHTML = buildStep(steps, currentStep);
          bindStep(steps);
        } else {
          // Finito
          closeModal();
        }
      });
    }

    // ── NOTES ──────────────────────────────────────────
    function buildNotes(rec){
      const rows = [];
      if(rec.base_weight_g)     rows.push(['⚖️', `<strong>Yield:</strong> ${rec.base_weight_g}g per batch`]);
      if(rec.shelf_life_days)   rows.push(['📅', `<strong>Shelf life:</strong> ${rec.shelf_life_days} day${rec.shelf_life_days!==1?'s':''} refrigerated`]);
      if(rec.prep_time_minutes) rows.push(['⏱', `<strong>Prep time:</strong> ${rec.prep_time_minutes} min`]);
      if(rec.equipment)         rows.push(['🔧', `<strong>Equipment:</strong> ${rec.equipment}`]);
      if(rec.procedure)         rows.push(['📝', rec.procedure]);
      if(rec.yield_text)        rows.push(['📦', `<strong>Yield note:</strong> ${rec.yield_text}`]);

      if(rows.length === 0){
        return `<div class="rm-empty"><div class="rm-empty-icon">📝</div>No notes added yet.</div>`;
      }
      return `<div class="rm-notes-card">
        ${rows.map(([icon, text]) => `
          <div class="rm-note-row">
            <span class="rm-note-icon">${icon}</span>
            <div class="rm-note-text">${text}</div>
          </div>`).join('')}
      </div>`;
    }
  },

  close: closeModal
};

// ── SHELL HTML ───────────────────────────────────────────
function buildShell(rec, options){
  const category = rec.menu_group || rec.category || '';
  const sub = [
    rec.shelf_life_days ? `shelf life ${rec.shelf_life_days}d` : null,
    rec.base_weight_g   ? `${rec.base_weight_g}g yield` : null,
  ].filter(Boolean).join(' · ') || category;

  return `<div id="rmSheet">
    <div id="rmHeader">
      <div class="rm-drag"></div>
      <div class="rm-top">
        <span class="rm-badge">${category || '🍳 Recipe'}</span>
        <button class="rm-close">×</button>
      </div>
      <div class="rm-title">${rec.title || ''}</div>
      <div class="rm-sub">${sub}</div>
      <div class="rm-tabs">
        <button class="rm-tab active" data-tab="ingredients">Ingredients</button>
        <button class="rm-tab" data-tab="steps">Steps</button>
        <button class="rm-tab" data-tab="notes">Notes</button>
      </div>
    </div>
    <div id="rmBody"></div>
  </div>`;
}

function closeModal(){
  Object.keys(timers).forEach(k => stopTimer(k));
  const overlay = document.getElementById('rmOverlay');
  if(overlay){
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity .2s';
    setTimeout(() => overlay.remove(), 200);
  }
}

})();
