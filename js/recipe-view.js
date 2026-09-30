// ── BR-UI02 — SCHEDA RICETTA: PREP | COSTO | STRUTTURA ──────────────────────
// Vista di SOLA LETTURA, layout del primo mockup approvato da Max: intestazione con porzioni e
// PREP | COSTO | STRUTTURA fermi in alto, righe verticali. Separata dall'editor: il tasto "Modifica"
// chiude la vista e apre openRecipeEditor, che resta quello della v870.
// Cambiare le porzioni ricalcola a schermo e non scrive mai nel database: questo file fa solo letture
// (select su recipes, recipe_bom, recipe_steps, prep_tasks, recipes_with_cost e la funzione di lettura fc_costo_ricetta).
// COSTO (BR-UI02B): numeri solo da FC05, vedi _rvLoadCost. STRUTTURA (BR-UI02C): resa, componenti, da preparare, problemi.
// Attivazione: localStorage 'brigade_ricetta_v2' = '1' oppure #ricetta-v2 nell'indirizzo.
// Riusa: escHtml, _legacyIngredients, _writtenFullyInBom, _subYieldLabel (recipes.js), scaleTextQty (recipe-modal.js),
// isAdmin, lockPrepScroll (utils.js / recipe-modal.js).

// Unita': stessi fattori di js/unit-normalizer.js (STATIC_CONVERSIONS), che e' un modulo ES non caricato dall'app.
const RV_UNITS = {
  mg: ['mass', 0.001, 'metric'], g: ['mass', 1, 'metric'], gr: ['mass', 1, 'metric'], kg: ['mass', 1000, 'metric'],
  oz: ['mass', 28.3495, 'us'], lb: ['mass', 453.592, 'us'], lbs: ['mass', 453.592, 'us'],
  ml: ['vol', 1, 'metric'], cl: ['vol', 10, 'metric'], dl: ['vol', 100, 'metric'], l: ['vol', 1000, 'metric'], lt: ['vol', 1000, 'metric'],
  tsp: ['vol', 4.92892, 'keep'], tbsp: ['vol', 14.7868, 'keep'], cup: ['vol', 236.588, 'keep'], fl_oz: ['vol', 29.5735, 'keep'],
  'fl oz': ['vol', 29.5735, 'keep'], qt: ['vol', 946.353, 'keep'], gal: ['vol', 3785.41, 'keep'], gallone: ['vol', 3785.41, 'keep'],
  galloni: ['vol', 3785.41, 'keep'], gallon: ['vol', 3785.41, 'keep'],
  pz: ['count'], pezzi: ['count'], pezzo: ['count'], each: ['count'], ea: ['count'], n: ['count'], nests: ['count'],
  porzione: ['count'], porzioni: ['count'], foglio: ['count'], foglia: ['count'], fogli: ['count'], foglie: ['count'],
  spicchio: ['count'], spicchi: ['count'], fetta: ['count'], fette: ['count'], case: ['count'], busta: ['count'], buste: ['count'],
  pinch: ['free'], pizzico: ['free'], pizzichi: ['free'], drops: ['free'], gocce: ['free'], qb: ['free'], 'q.b.': ['free'],
};
function _rvUnit(u){
  const k = String(u || '').trim().toLowerCase();
  const d = RV_UNITS[k];
  if(!d) return { key: k, fam: k ? 'unknown' : 'none' };
  return { key: k, fam: d[0], f: d[1], sys: d[2] };
}
function _rvNum(v){ const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : null; }
function _rvLocale(){ const l = window.user?.lang || 'it'; return l === 'it' ? 'it-IT' : l === 'es' ? 'es-ES' : 'en-US'; }
function _rvN(n, dec, grouping = true){ return n.toLocaleString(_rvLocale(), { maximumFractionDigits: dec, minimumFractionDigits: 0, useGrouping: grouping }); }

// Quantita' scalata e arrotondata come in cucina. Ritorna {text, flag}; flag: null | 'free' | 'unknown' | 'rounded' | 'none'.
function _rvScaleQty(qty, unit, factor){
  const q = _rvNum(qty), u = _rvUnit(unit), raw = String(unit || '').trim();
  if(q === null || q === 0) return { text: '—', flag: 'none' };
  if(u.fam === 'free') return { text: _rvN(q, 2) + ' ' + raw, flag: 'free' };      // un pizzico resta un pizzico
  const v = q * factor;
  if(u.fam === 'mass' && u.sys === 'metric'){
    const g = v * u.f;
    if(u.key === 'mg' && g < 1) return { text: _rvN(Math.round(g * 1000), 0) + ' mg', flag: null };
    if(g >= 999.5) return { text: _rvN(Math.round(g / 10) / 100, 2) + ' kg', flag: null };
    return { text: (g < 10 ? _rvN(Math.round(g * 10) / 10, 1) : _rvN(Math.round(g), 0)) + ' g', flag: null };
  }
  if(u.fam === 'mass'){                                                             // lb / oz: si resta in libbre e once
    const oz = v * u.f / 28.3495;
    if(oz >= 15.95) return { text: _rvN(Math.round(oz / 16 * 100) / 100, 2) + ' lb', flag: null };
    return { text: _rvN(Math.round(oz * 10) / 10, 1) + ' oz', flag: null };
  }
  if(u.fam === 'vol' && u.sys === 'metric'){
    const ml = v * u.f;
    if(ml >= 999.5) return { text: _rvN(Math.round(ml / 10) / 100, 2) + ' l', flag: null };
    return { text: (ml < 10 ? _rvN(Math.round(ml * 10) / 10, 1) : _rvN(Math.round(ml), 0)) + ' ml', flag: null };
  }
  if(u.fam === 'vol') return { text: _rvN(Math.round(v * 100) / 100, 2) + ' ' + raw, flag: null }; // cucchiai, cup, galloni: unita' del cuoco
  if(u.fam === 'count'){                                                            // i pezzi si arrotondano per eccesso
    const r = Math.round(v * 1000) / 1000;
    if(Number.isInteger(r)) return { text: _rvN(r, 0) + ' ' + raw, flag: null };
    return { text: _rvN(Math.ceil(r), 0) + ' ' + raw, flag: 'rounded', exact: _rvN(Math.round(v * 100) / 100, 2) };
  }
  return { text: _rvN(Math.round(v * 100) / 100, 2) + (raw ? ' ' + raw : ''), flag: 'unknown' };
}

// Base della scala: le STESSE regole di resa di FC05 (food_cost.recipe_breakdown), cosi' porzioni e costi coincidono:
// resa = base_weight_g, altrimenti base_weight in kg/g; porzioni = base_servings, altrimenti resa / serving_weight_g,
// altrimenti resa / serving_qty se serving_unit e' 'g'. Il testo della resa ("10 porzioni") FC05 non lo usa: nemmeno qui.
function _rvYieldBase(rec){
  const bs = _rvNum(rec?.base_servings), sw = _rvNum(rec?.serving_weight_g), sq = _rvNum(rec?.serving_qty);
  let yw = _rvNum(rec?.base_weight_g);
  if(!(yw > 0)){ const w = _rvNum(rec?.base_weight), u = String(rec?.weight_unit || '').toLowerCase(); yw = w > 0 && (u === 'kg' || u === 'g') ? w * (u === 'kg' ? 1000 : 1) : null; }
  if(bs > 0) return { mode: 'porzioni', base: bs };
  if(yw > 0 && sw > 0) return { mode: 'porzioni', base: yw / sw, from: 'peso' };
  if(yw > 0 && String(rec?.serving_unit || '').toLowerCase() === 'g' && sq > 0) return { mode: 'porzioni', base: yw / sq, from: 'peso' };
  if(yw > 0) return { mode: 'peso', base: yw };
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(porzion|portion|porcion|serving)/i.exec(rec?.yield_text || '');
  return { mode: 'lotti', base: 1, text: m ? rec.yield_text.trim() : null };
}

// Quanto serve della sotto-ricetta, espresso come fattore sulla SUA resa. Mai inventato: se le unita'
// non si convertono (es. 5 kg di un piatto che rende 1 porzione) lo dice e apre la sotto-ricetta alla sua resa.
function _rvSubFactor(qty, unit, factor, sub){
  const q = _rvNum(qty), u = _rvUnit(unit);
  if(!sub) return { ok: false, why: 'sotto-ricetta non trovata' };
  if(q === null || q === 0) return { ok: false, why: 'quantità mancante' };
  const need = q * factor, bw = _rvNum(sub.base_weight_g), y = _rvYieldBase(sub);
  if(u.fam === 'mass' && bw > 0) return { ok: true, factor: need * u.f / bw };
  if(u.fam === 'count' && /^porzion/.test(u.key) && y.mode === 'porzioni') return { ok: true, factor: need / y.base };
  const resa = typeof _subYieldLabel === 'function' ? _subYieldLabel(sub) : 'resa non indicata';
  if(u.fam === 'vol' && bw > 0) return { ok: false, why: `in ${unit} ma la resa è in peso (${resa}): serve la densità` };
  return { ok: false, why: `in ${unit || 'nessuna unità'}, resa della sotto-ricetta: ${resa}` };
}

const RV_TXT = {
  prep: { it: 'PREP', en: 'PREP', es: 'PREP' }, cost: { it: 'COSTO', en: 'COST', es: 'COSTO' }, struct: { it: 'STRUTTURA', en: 'STRUCTURE', es: 'ESTRUCTURA' },
  portions: { it: 'Porzioni', en: 'Portions', es: 'Porciones' }, batchKg: { it: 'Lotto', en: 'Batch', es: 'Lote' }, batches: { it: 'Lotti', en: 'Batches', es: 'Lotes' },
  original: { it: 'ricetta originale', en: 'original recipe', es: 'receta original' }, edit: { it: 'Modifica', en: 'Edit', es: 'Editar' },
  ingredients: { it: 'Ingredienti', en: 'Ingredients', es: 'Ingredientes' }, method: { it: 'Procedimento', en: 'Method', es: 'Procedimiento' },
  noMethod: { it: 'Nessun procedimento scritto per questa ricetta.', en: 'No method written for this recipe.', es: 'No hay procedimiento escrito.' },
  noIng: { it: 'Nessun ingrediente in distinta.', en: 'No ingredients listed.', es: 'Sin ingredientes.' },
  prepBadge: { it: 'preparazione', en: 'prep', es: 'preparación' },
  loading: { it: 'Carico la ricetta…', en: 'Loading recipe…', es: 'Cargando receta…' },
  readErr: { it: 'Non riesco a leggere la ricetta. Riprova tra poco: niente è stato modificato.', en: 'Could not read the recipe. Nothing was changed.', es: 'No se pudo leer la receta. No se modificó nada.' },
  bomErr: { it: 'Non riesco a leggere gli ingredienti: le quantità non sono mostrate per non darti numeri sbagliati.', en: 'Could not read the ingredients: quantities hidden to avoid wrong numbers.', es: 'No se pudieron leer los ingredientes.' },
  back: { it: 'Indietro', en: 'Back', es: 'Atrás' }, close: { it: 'Chiudi', en: 'Close', es: 'Cerrar' },
};
function _rvT(k){ const l = window.user?.lang || 'it'; return (RV_TXT[k] || {})[l] || (RV_TXT[k] || {}).it || k; }
function _rvEsc(s){ return typeof escHtml === 'function' ? escHtml(s) : String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }


const RV_STYLE = `<style id="rvStyle">
/* layout: primo mockup approvato. In alto, fermi mentre si scorre: nome, porzioni (numero + slider), PREP | COSTO | STRUTTURA.
   Sotto, righe verticali leggibili sull'iPhone: mai tabelle orizzontali. Nessun pulsante in basso. */
#rvOverlay{--bg:#eff6ff;--surface:#fff;--sunk:#f5f9ff;--text:#1e3a5f;--text-2:#4f6f99;--line:rgba(37,99,235,.14);--accent:#2563eb;--accent-bg:#dbeafe;--on-accent:#fff;
  --ok:#15803d;--ok-bg:#dcfce7;--warn:#a16207;--warn-bg:#fef3c7;--bad:#b91c1c;--bad-bg:#fee2e2;
  position:fixed;inset:0;z-index:170;background:var(--bg);color:var(--text);overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  font:16px/1.45 -apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;-webkit-tap-highlight-color:transparent}
@media (prefers-color-scheme:dark){#rvOverlay{--bg:#0f172a;--surface:#1e293b;--sunk:#172033;--text:#e2e8f0;--text-2:#9fb6d6;--line:rgba(147,197,253,.18);--accent:#60a5fa;--accent-bg:rgba(96,165,250,.16);--on-accent:#0f172a;
  --ok:#4ade80;--ok-bg:rgba(74,222,128,.14);--warn:#fbbf24;--warn-bg:rgba(251,191,36,.14);--bad:#f87171;--bad-bg:rgba(248,113,113,.16);color-scheme:dark}}
#rvOverlay *{box-sizing:border-box}
#rvOverlay button{font:inherit;color:inherit;cursor:pointer}
#rvOverlay button:focus-visible,#rvOverlay input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-head{position:sticky;top:0;z-index:3;background:var(--bg);padding-top:env(safe-area-inset-top,0px)}
.rv-head .rv-in{max-width:560px;margin:0 auto;padding:6px 16px 8px;display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--line)}
.rv-page{max-width:560px;margin:0 auto;padding:12px 16px calc(40px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:14px}
.rv-top{display:flex;align-items:center;gap:8px}
.rv-round{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;flex:none}
.rv-round svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.rv-title{flex:1;min-width:0}
.rv-title h1{font-size:16.5px;line-height:1.2;margin:0;font-weight:700;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rv-title span{display:block;font-size:12px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rv-por{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:4px 10px}
.rv-prow{display:flex;align-items:center;gap:10px}
.rv-prow label{display:flex;flex-direction:column;line-height:1.15;flex:none;min-width:64px}
.rv-prow label b{font-size:14.5px}
.rv-prow label small{font-size:11.5px;color:var(--text-2);white-space:nowrap}
.rv-prow input#rvAmount{width:76px;height:44px;flex:none;border-radius:12px;border:2px solid var(--accent);background:var(--surface);text-align:center;font:700 19px ui-rounded,-apple-system,sans-serif;font-variant-numeric:tabular-nums;color:var(--text)}
.rv-por input[type=range]{flex:1;min-width:0;accent-color:var(--accent);height:44px;margin:0}
.rv-seg{display:grid;grid-template-columns:repeat(3,1fr);background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:3px;gap:3px}
.rv-seg button{height:44px;border:0;border-radius:10px;background:transparent;font-weight:700;font-size:11.5px;letter-spacing:.05em;color:var(--text-2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0;padding:0 4px}
.rv-seg svg{width:18px;height:18px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.rv-seg .rv-hat{color:var(--accent)}
.rv-seg button[aria-selected="true"]{background:var(--accent-bg);color:var(--accent)}
.rv-note{font-size:13px;border-radius:12px;padding:9px 12px;background:var(--warn-bg);color:var(--warn)}
.rv-note.bad{background:var(--bad-bg);color:var(--bad)}
.rv-sec{display:flex;flex-direction:column;gap:10px}
.rv-sec h2{font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);margin:6px 2px 0;font-weight:700}
.rv-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:4px 14px}
.rv-it{display:flex;align-items:center;gap:12px;padding-block:13px;border:0;border-top:1px solid var(--line);width:100%;background:none;text-align:left;min-height:48px}
.rv-card > .rv-it:first-child{border-top:0}
.rv-it .rv-grow{flex:1;min-width:0;overflow-wrap:anywhere}
.rv-it .rv-grow small{display:block;font-size:12.5px;color:var(--text-2)}
.rv-it .rv-grow small.warn{color:var(--warn)}
.rv-it .rv-grow small.bad{color:var(--bad);font-weight:600}
.rv-it .rv-v{font-weight:700;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.rv-it .rv-v small{display:block;font-weight:400;font-size:12px;color:var(--text-2)}
.rv-it .rv-v.unk{color:var(--bad)}
.rv-it .rv-v.est{color:var(--warn)}
.rv-it .rv-chev{color:var(--text-2);font-size:22px;flex:none}
.rv-badge{font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;background:var(--sunk);color:var(--accent);border:1px solid var(--line);margin-left:6px;vertical-align:1px;white-space:nowrap}
.rv-badge.a{color:var(--ok)} .rv-badge.b,.rv-badge.c{color:var(--warn)} .rv-badge.x{color:var(--bad);background:var(--bad-bg);border-color:transparent}
.rv-sechead{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-2);font-weight:700;padding-block:12px 4px;border-top:1px solid var(--line)}
.rv-card > .rv-sechead:first-child{border-top:0}
.rv-steps{list-style:none;margin:0;padding:6px 0;counter-reset:s;display:flex;flex-direction:column}
.rv-steps li{counter-increment:s;display:grid;grid-template-columns:34px 1fr;gap:12px;padding-block:12px;border-top:1px solid var(--line)}
.rv-steps li:first-child{border-top:0}
.rv-steps li::before{content:counter(s);width:34px;height:34px;border-radius:50%;background:var(--sunk);border:1px solid var(--line);display:grid;place-items:center;font-weight:700}
.rv-steps b{display:block}
.rv-steps span{color:var(--text-2);font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere}
.rv-steps span strong{color:var(--text)!important}
.rv-steps .rv-timer{display:inline-block;margin-top:4px;font-size:12.5px;font-weight:700;color:var(--accent);font-style:normal}
.rv-proc{padding-block:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.rv-empty{padding-block:14px;color:var(--text-2);font-size:14.5px}
.rv-soon{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 14px;display:flex;flex-direction:column;gap:8px}
.rv-soon b{font-size:17px}
.rv-soon p{margin:0;color:var(--text-2);font-size:14.5px}
.rv-state{border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);background:var(--surface)}
.rv-state.ok{background:var(--ok-bg);border-color:var(--ok)} .rv-state.est{background:var(--warn-bg);border-color:var(--warn)} .rv-state.bad{background:var(--bad-bg);border-color:var(--bad)}
.rv-state .rv-lbl{font-weight:800;font-size:15.5px}
.rv-state.ok .rv-lbl{color:var(--ok)} .rv-state.est .rv-lbl{color:var(--warn)} .rv-state.bad .rv-lbl{color:var(--bad)}
.rv-state .rv-why{font-size:13px;color:var(--text)}
.rv-money{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rv-money div{background:var(--surface);border-radius:12px;padding:10px;min-width:0}
.rv-money span{display:block;font-size:12px;color:var(--text-2)}
.rv-money b{font-size:21px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.rv-money b.unk{font-size:15px;color:var(--text-2)}
.rv-src{font-size:12.5px;color:var(--text-2)}
.rv-issue{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding-block:12px;border-top:1px solid var(--line)}
.rv-card > .rv-issue:first-child{border-top:0}
.rv-issue .rv-ic{width:24px;height:24px;border-radius:50%;background:var(--bad);color:var(--surface);display:grid;place-items:center;font-weight:800;font-size:14px}
.rv-issue .rv-ic.w{background:var(--warn)}
.rv-issue b{display:block;font-size:15px}
.rv-issue span{display:block;font-size:13px;color:var(--text-2);overflow-wrap:anywhere}
</style>`;

const RV_ICONS = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  // cappello da chef, blu in PREP
  prep: '<svg class="rv-hat" viewBox="0 0 24 24"><path d="M7 16.5V20h10v-3.5M7 16.5c-2.3-.4-4-2.3-4-4.6A4.3 4.3 0 0 1 8.2 7.7a4.2 4.2 0 0 1 7.6 0 4.3 4.3 0 0 1 5.2 4.2c0 2.3-1.7 4.2-4 4.6M7 16.5h10"/></svg>',
  cost: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/></svg>',
  struct: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v4a3 3 0 0 0 3 3H14"/></svg>',
};

async function _rvLoad(recipeId){
  const r = await supa.from('recipes').select('*').eq('id', recipeId).maybeSingle();
  if(r.error || !r.data) return { error: r.error || { message: 'ricetta non trovata' } };
  const [b, s] = await Promise.all([
    supa.from('recipe_bom')
      .select(RV_BOM_COLS)
      .eq('parent_recipe_id', recipeId).order('sort_order'),
    supa.from('recipe_steps').select('*').eq('recipe_id', recipeId).order('step_number'),
  ]);
  return { rec: r.data, bom: b.error ? null : (b.data || []), bomError: !!b.error, steps: s.error ? [] : (s.data || []) };
}

function _rvIngName(row){
  const lang = window.user?.lang || 'it';
  if(row.component_type === 'RECIPE') return row.recipes?.title || '—';
  const i = row.ingredients || {};
  return (lang === 'it' && i.name_it) || (lang === 'es' && i.name_es) || i.name || '—';
}

// ── rendering ──
function _rvPrep(v){
  const f = v.factor;
  let ing;
  if(v.bomError){
    ing = `<div class="rv-note bad">${_rvT('bomErr')}</div>`;
  } else if(v.bom.length){
    ing = `<div class="rv-card">${v.bom.map((row, i) => {
      const q = _rvScaleQty(row.quantity, row.unit, f);
      const note = row.notes ? `<small>${_rvEsc(row.notes)}</small>` : '';
      const flag = q.flag === 'free' ? `<small>non scalata</small>` : q.flag === 'unknown' ? `<small class="warn">unità non convertibile: solo moltiplicata</small>`
        : q.flag === 'rounded' ? `<small>per eccesso da ${q.exact}</small>` : '';
      if(row.component_type === 'RECIPE' && row.sub_recipe_id){
        const sf = _rvSubFactor(row.quantity, row.unit, f, row.recipes);
        const warn = sf.ok ? '' : `<small class="warn">⚠ quantità non convertibile: ${_rvEsc(sf.why)}</small>`;
        return `<button class="rv-it" data-sub="${i}"><div class="rv-grow">${_rvEsc(_rvIngName(row))}<span class="rv-badge">${_rvT('prepBadge')}</span>${note}${warn}</div><div class="rv-v">${_rvEsc(q.text)}${flag}</div><span class="rv-chev" aria-hidden="true">›</span></button>`;
      }
      return `<div class="rv-it"><div class="rv-grow">${_rvEsc(_rvIngName(row))}${note}</div><div class="rv-v">${_rvEsc(q.text)}${flag}</div></div>`;
    }).join('')}</div>`;
  } else if(v.written.length){
    // Ricetta senza distinta: si mostra la ricetta scritta, scalata allo stesso modo.
    ing = `<div class="rv-note">Solo ricetta scritta: questa ricetta non ha ancora una distinta collegata.</div><div class="rv-card">${v.written.map(i => {
      if(i.type === 'section') return `<div class="rv-sechead">${_rvEsc(i.name)}</div>`;
      const q = _rvScaleQty(i.qty, i.unit, f);
      const flag = q.flag === 'unknown' ? `<small class="warn">unità non convertibile: solo moltiplicata</small>` : q.flag === 'rounded' ? `<small>per eccesso da ${q.exact}</small>` : q.flag === 'free' ? `<small>non scalata</small>` : '';
      return `<div class="rv-it"><div class="rv-grow">${_rvEsc(i.name)}${i.comment ? `<small>${_rvEsc(i.comment)}</small>` : ''}</div><div class="rv-v">${_rvEsc(q.text)}${flag}</div></div>`;
    }).join('')}</div>`;
  } else {
    ing = `<div class="rv-card"><div class="rv-empty">${_rvT('noIng')}</div></div>`;
  }
  const extra = v.bom.length && v.written.length && typeof _writtenFullyInBom === 'function'
    && !_writtenFullyInBom(v.written, v.bom.flatMap(b => [b.ingredients?.name, b.ingredients?.name_it, b.ingredients?.name_es, b.recipes?.title].filter(Boolean)
      .map(name => ({ name, ingredient_id: b.item_id, sub_recipe_id: b.sub_recipe_id }))))
    ? `<div class="rv-note">La ricetta scritta ha righe che non sono in distinta: controllale nell'editor.</div>` : '';

  const lang = window.user?.lang || 'it';
  const scaleTxt = t => (typeof scaleTextQty === 'function' && f !== 1) ? scaleTextQty(_rvEsc(t), f) : _rvEsc(t);
  let method;
  if(v.steps.length){
    method = `<div class="rv-card"><ol class="rv-steps">${v.steps.map(s => {
      const title = (lang === 'it' && s.title_it) || (lang === 'es' && s.title_es) || s.title || '';
      const body = (lang === 'it' && s.instruction_it) || (lang === 'es' && s.instruction_es) || s.instruction_en || s.instruction_it || '';
      const tm = _rvNum(s.timer_seconds) > 0 ? `<i class="rv-timer">⏱ ${Math.floor(s.timer_seconds / 60)}:${String(s.timer_seconds % 60).padStart(2, '0')}</i>` : '';
      return `<li><div><b>${_rvEsc(title)}</b><span>${scaleTxt(body)}</span>${tm}</div></li>`;
    }).join('')}</ol></div>`;
  } else {
    const p = (lang === 'it' && v.rec.procedure) || (lang === 'es' && v.rec.procedure_es) || v.rec.procedure_en || v.rec.procedure || '';
    method = p ? `<div class="rv-card"><div class="rv-proc">${scaleTxt(p)}</div></div>` : `<div class="rv-card"><div class="rv-empty">${_rvT('noMethod')}</div></div>`;
  }
  return `<div class="rv-sec"><h2>${_rvT('ingredients')} · ${_rvEsc(_rvAmountLabel(v))}</h2>${ing}${extra}<h2>${_rvT('method')}</h2>${method}</div>`;
}

// ── COSTO ── i numeri vengono SOLO dal motore FC05 (food_cost.recipe_breakdown), letto con la funzione
// protetta fc_costo_ricetta(token, ricetta): sessione Brigade da amministratore, sola lettura.
// Qui non si calcola nessun costo: si moltiplica per le porzioni scelte il costo del lotto che FC05 ha gia'
// calcolato (il costo e' proporzionale alla quantita'), e il costo a porzione resta quello di FC05.
// La maggiorazione catering del 10% NON si applica: appartiene al foglio dell'evento, una volta sola.
async function _rvLoadCost(recipeId){
  let token = null;
  try{ token = window.localStorage.getItem('brigade_token'); }catch(e){ token = null; }
  const { data, error } = await supa.rpc('fc_costo_ricetta', { p_token: token, p_recipe_id: recipeId });
  if(error){
    // Funzione non ancora installata: si usa solo il riepilogo gia' pubblico (recipes_with_cost), e solo per l'amministratore.
    if(error.code === 'PGRST202' || /could not find the function|schema cache/i.test(error.message || '')){
      if(!(typeof isAdmin === 'function' && isAdmin())) return { state: 'unauthorized' };
      const s = await supa.from('recipes_with_cost')
        .select('known_cost,total_cost,cost_per_portion,cost_status,semaforo,issue_count,costo_stimato,costo_stimato_porzione,parte_stimata')
        .eq('id', recipeId).maybeSingle();
      return { state: 'missing', summary: s.error ? null : s.data };
    }
    return { state: 'error' };
  }
  if(!data || data.ok !== true){
    const e = data?.error || '';
    return { state: e === 'unauthorized' ? 'unauthorized' : /session|token/.test(e) ? 'session' : 'error' };
  }
  return data.breakdown ? { state: 'ok', b: data.breakdown } : { state: 'error' };
}

function _rvMoney(n, dec = 2){ return '$' + Number(n).toLocaleString(_rvLocale(), { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function _rvDate(d){ const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''; }

const RV_ISSUE = {
  prezzo_mancante: 'Prezzo mancante', conversione_mancante: 'Conversione mancante', prezzo_in_conflitto: 'Prezzo in conflitto con la fattura',
  unita_sospetta: 'Unità da rivedere', resa_mancante: 'La sotto-ricetta non dichiara la resa', ciclo: 'La ricetta contiene se stessa',
  distinta_vuota: 'Distinta vuota', porzioni_in_conflitto: 'Porzioni in conflitto', resa_non_dichiarata: 'Resa non dichiarata',
  ricetta_inesistente: 'Ricetta inesistente', sotto_ricetta_incompleta: 'Sotto-ricetta con costo incompleto', escluso_non_alimentare: 'Escluso: non alimentare',
};
const RV_CLASS = { A: ['a', 'fattura'], B: ['b', 'prezzo dello chef'], C: ['c', 'senza fattura'] };

// Stato del costo nella stessa forma per il dettaglio FC05 e per il riepilogo recipes_with_cost.
function _rvCostState(c){
  if(c.b){
    const b = c.b, s = b.semaforo || {};
    return { colore: s.colore, complete: !!b.complete, known: _rvNum(b.totals?.known), stimato: _rvNum(s.costo_stimato),
      porzione: _rvNum(b.cost_per_portion), stimatoPorz: _rvNum(s.costo_porzione), parte: _rvNum(s.parte_stimata), motivo: s.motivo || '',
      perYield: _rvNum(b.cost_per_yield_unit), yieldQty: _rvNum(b.yield?.qty), yieldDim: b.yield?.dim || null, conflict: b.portions?.conflict || null };
  }
  const s = c.summary || {};
  return { colore: s.semaforo, complete: s.cost_status === 'verificato' || s.cost_status === 'con_stime', known: _rvNum(s.known_cost),
    stimato: _rvNum(s.costo_stimato), porzione: _rvNum(s.cost_per_portion), stimatoPorz: _rvNum(s.costo_stimato_porzione),
    parte: _rvNum(s.parte_stimata), motivo: '', perYield: null, yieldQty: null, yieldDim: null, conflict: null };
}

// TRUST: un totale compare come "costo" solo se FC05 lo dichiara affidabile (VERDE) o utilizzabile (GIALLO).
// Altrimenti si vede solo il costo noto, chiamato parziale; mai $0 al posto di "non si sa".
function _rvVerdict(st, v){
  const f = v.factor, amount = _rvAmountLabel(v);
  const cat = /catering/i.test((v.rec.menu_group || '') + ' ' + (v.rec.category || ''));
  const cat10 = cat ? '<div class="rv-src">Maggiorazione catering del 10% esclusa: si applica una volta sola nel foglio dell\'evento.</div>' : '';
  const perUnit = (tot) => {
    if(st.yieldQty > 0 && tot != null){ const u = st.yieldDim === 'volume' ? 'al litro' : st.yieldDim === 'mass' ? 'al kg' : null;
      if(u) return [u, _rvMoney(tot / st.yieldQty * 1000)]; }
    return null;
  };
  let cls, lbl, why, boxes;
  if(st.colore === 'VERDE' && st.complete && st.known != null){
    cls = 'ok'; lbl = '● Costo affidabile'; why = 'Tutti i prezzi vengono da fatture.';
    const pu = st.porzione != null ? ['A porzione', _rvMoney(st.porzione)] : perUnit(st.known);
    boxes = [[`Totale · ${amount}`, _rvMoney(st.known * f)], pu || ['A porzione', null, st.conflict ? 'porzioni in conflitto' : 'porzioni non definite']];
  } else if(st.colore === 'GIALLO' && st.stimato != null){
    cls = 'est'; lbl = '● Costo utilizzabile, con una parte stimata';
    why = `${st.motivo ? st.motivo.charAt(0).toUpperCase() + st.motivo.slice(1) + '. ' : ''}Parte stimata: ${_rvMoney((st.parte || 0) * f)}.`;
    const pu = st.stimatoPorz != null ? ['A porzione (stima)', _rvMoney(st.stimatoPorz)] : perUnit(st.stimato);
    boxes = [[`Totale stimato · ${amount}`, _rvMoney(st.stimato * f)], pu || ['A porzione', null, 'porzioni non definite']];
  } else {
    cls = 'bad'; lbl = '● Costo non affidabile';
    why = (st.motivo ? st.motivo.charAt(0).toUpperCase() + st.motivo.slice(1) + '. ' : '') + 'Il costo noto è solo una parte: non usarlo per preventivi.';
    boxes = [[`Costo noto, parziale · ${amount}`, st.known > 0 ? _rvMoney(st.known * f) : null, 'nessun prezzo noto'], ['A porzione', null, 'non calcolabile']];
  }
  const box = ([l, val, alt]) => `<div><span>${_rvEsc(l)}</span>${val != null ? `<b>${val}</b>` : `<b class="unk">${_rvEsc(alt)}</b>`}</div>`;
  return `<div class="rv-state ${cls}"><div class="rv-lbl">${lbl}</div><div class="rv-money">${boxes.map(box).join('')}</div>
    <div class="rv-why">${_rvEsc(why)}</div>${cat10}</div>`;
}

// Collegamento errato: una riga in peso/volume che punta a un piatto a porzioni (stessa regola dell'editor v870).
function _rvLinkChecks(b, v){
  const out = [];
  (b.lines || []).forEach(l => {
    if(l.kind !== 'sotto_ricetta' || l.status !== 'resa_mancante') return;
    const u = _rvUnit(l.unit); if(u.fam !== 'mass' && u.fam !== 'vol') return;
    const row = v.bom.find(r => r.bom_id === l.bom_id), sub = row?.recipes;
    const resa = sub && typeof _subYieldLabel === 'function' ? _subYieldLabel(sub) : 'resa non indicata';
    out.push({ bad: true, bom: l.bom_id, name: l.name, t: `Collegamento da verificare: «${l.name}»`,
      d: `È usata in ${l.unit} (${_rvN(_rvNum(l.qty), 2)} ${l.unit} nella ricetta originale) ma la sua resa è ${resa}. Cercavi una salsa o una base? Si corregge nell'editor.` });
  });
  return out;
}

function _rvIssues(b, v){
  const root = (b.title || v.rec.title || '') + ' > ', seen = new Set(), out = _rvLinkChecks(b, v);
  (b.issues || []).forEach(i => {
    const k = [i.code, i.path, i.component, i.qty, i.unit].join('|'); if(seen.has(k)) return; seen.add(k);
    // la stessa riga gia' spiegata come collegamento da verificare: una volta sola
    if(i.code === 'resa_mancante' && i.path === b.title && out.some(x => x.name === i.component)) return;
    const where = i.path && i.path.startsWith(root) ? 'in ' + i.path.slice(root.length) : '';
    const what = i.component ? `${i.component}${i.qty != null ? ` · ${_rvN(_rvNum(i.qty), 2)} ${i.unit || ''}` : ''}` : '';
    out.push({ bad: i.code !== 'porzioni_in_conflitto' && i.code !== 'resa_non_dichiarata',
      t: RV_ISSUE[i.code] || i.code, d: [what, where, i.detail].filter(Boolean).join(' — ') });
  });
  if(!out.length) return '';
  return `<h2>Da correggere · ${out.length}</h2><div class="rv-card">${out.map(x =>
    `<div class="rv-issue"><div class="rv-ic${x.bad ? '' : ' w'}">!</div><div><b>${_rvEsc(x.t)}</b>${x.d ? `<span>${_rvEsc(x.d)}</span>` : ''}</div></div>`).join('')}</div>`;
}

function _rvPriceText(l){
  const p = l.price; if(!p) return '';
  let unit;
  if(p.basis === 'count' || l.note === 'prezzo al pezzo') unit = p.cost_per_each != null ? `${_rvMoney(p.cost_per_each, 4)} / pezzo` : '';
  else if(/^prezzo al ml/.test(l.note || '') && p.cost_per_100ml != null) unit = `${_rvMoney(p.cost_per_100ml, 4)} / 100 ml`;
  else if(p.cost_per_100 != null) unit = `${_rvMoney(p.cost_per_100, 4)} / 100 ${p.basis === 'volume' ? 'ml' : 'g'}`;
  const cl = RV_CLASS[p.class];
  return [unit, p.vendor, _rvDate(p.invoice_date)].filter(Boolean).map(_rvEsc).join(' · ') + (cl ? `<span class="rv-badge ${cl[0]}">${cl[1]}</span>` : '');
}

function _rvCostLine(l, v){
  const f = v.factor, q = _rvScaleQty(l.qty, l.unit, f).text;
  const label = RV_ISSUE[l.status] || l.status;
  const probl = l.status !== 'ok' && l.status !== 'escluso_non_alimentare'
    ? `<small class="bad">${_rvEsc(label)}${l.note && l.note !== label.toLowerCase() ? ': ' + _rvEsc(l.note) : ''}</small>` : '';
  if(l.kind === 'sotto_ricetta'){
    const idx = v.bom.findIndex(r => r.bom_id === l.bom_id);
    let right;
    if(l.status === 'ok' && l.cost != null) right = `<div class="rv-v">${_rvMoney(l.cost * f)}</div>`;
    else if(l.status === 'sotto_ricetta_incompleta' && l.cost != null) right = `<div class="rv-v unk">${_rvMoney(l.cost * f)}<small>solo parte nota</small></div>`;
    else right = `<div class="rv-v unk">?<small>sconosciuto</small></div>`;
    const frac = _rvNum(l.fraction) != null ? `<small>${_rvLots(l.fraction * f)} della sotto-ricetta</small>` : '';
    const sem = l.child_semaforo ? `<span class="rv-badge ${l.child_semaforo === 'VERDE' ? 'a' : l.child_semaforo === 'GIALLO' ? 'b' : 'x'}">${l.child_semaforo === 'VERDE' ? 'affidabile' : l.child_semaforo === 'GIALLO' ? 'con stime' : 'non affidabile'}</span>` : '';
    const tag = idx >= 0 ? 'button' : 'div';
    return `<${tag} class="rv-it"${idx >= 0 ? ` data-sub="${idx}"` : ''}><div class="rv-grow">${_rvEsc(l.name || '—')} · ${_rvEsc(q)}<span class="rv-badge">preparazione</span>${sem}${frac}${probl}</div>${right}${idx >= 0 ? '<span class="rv-chev" aria-hidden="true">›</span>' : ''}</${tag}>`;
  }
  let right;
  if(l.status === 'ok' && l.class === 'zero') right = `<div class="rv-v">${_rvMoney(0)}<small>costo zero dichiarato</small></div>`;
  else if(l.status === 'ok' && l.cost != null) right = `<div class="rv-v">${_rvMoney(l.cost * f)}</div>`;
  else if(l.status === 'escluso_non_alimentare') right = `<div class="rv-v">—<small>non alimentare</small></div>`;
  else if(l.stima && _rvNum(l.stima.centrale) != null) right = `<div class="rv-v est">~${_rvMoney(l.stima.centrale * f)}<small>stima</small></div>`;
  else right = `<div class="rv-v unk">?<small>sconosciuto</small></div>`;
  const price = _rvPriceText(l);
  const conv = l.status === 'ok' && l.note && l.note !== 'prezzo al pezzo' ? `<small>${_rvEsc(l.note)}</small>` : '';
  return `<div class="rv-it"><div class="rv-grow">${_rvEsc(l.name || '—')} · ${_rvEsc(q)}${price ? `<small>${price}</small>` : ''}${conv}${probl}</div>${right}</div>`;
}

function _rvCost(v){
  const c = v.cost;
  if(!c || c.state === 'loading') return `<div class="rv-soon"><p>Leggo i costi dal motore FC05…</p></div>`;
  if(c.state === 'unauthorized') return `<div class="rv-soon"><b>Costi riservati</b><p>I costi delle ricette li vede solo l'amministratore.</p></div>`;
  if(c.state === 'session') return `<div class="rv-soon"><b>Sessione scaduta</b><p>Esci e rientra con il PIN per vedere i costi.</p></div>`;
  if(c.state === 'error') return `<div class="rv-note bad">Non riesco a leggere i costi. Nessun numero mostrato, per non darti un costo sbagliato.</div>`;
  if(c.state === 'missing'){
    const lim = `<div class="rv-note">Dettaglio per ingrediente non disponibile: il motore FC05 non è ancora leggibile dall'app in modo protetto (serve la funzione fc_costo_ricetta, proposta, non installata).</div>`;
    if(!c.summary) return lim;
    return `<div class="rv-sec">${_rvVerdict(_rvCostState(c), v)}${_rvNum(c.summary.issue_count) > 0 ? `<div class="rv-note bad">FC05 segnala ${c.summary.issue_count} problemi in questa ricetta.</div>` : ''}${lim}</div>`;
  }
  const b = c.b;
  const lines = (b.lines || []).map(l => _rvCostLine(l, v)).join('');
  return `<div class="rv-sec">${_rvVerdict(_rvCostState(c), v)}${_rvIssues(b, v)}
    <h2>Da dove viene il costo · ${_rvEsc(_rvAmountLabel(v))}</h2>
    ${lines ? `<div class="rv-card">${lines}</div>` : `<div class="rv-card"><div class="rv-empty">${_rvT('noIng')}</div></div>`}
    <div class="rv-src">Prezzi e calcolo: motore FC05${b.lines?.some(l => l.price?.invoice_date) ? ', dall\'ultima fattura di ogni ingrediente' : ''}.</div></div>`;
}

// ── STRUTTURA ── come e' costruita la ricetta: resa, componenti, cosa preparare, problemi di costruzione.
// Solo letture: le distinte delle sotto-ricette (a ogni livello) e i nomi delle prep collegate.
// Le quantita' delle sotto-ricette usano le stesse regole di PREP (_rvSubFactor): se una resa o
// un'unita' non si convertono, la quantita' resta sconosciuta e lo si dice. Nessuna resa inventata.
const RV_BOM_COLS = 'bom_id,parent_recipe_id,quantity,unit,notes,component_type,item_id,sub_recipe_id,sort_order,prep_task_id,ingredients(name,name_it,name_es),recipes!recipe_bom_sub_recipe_id_fkey(id,title,base_servings,base_weight_g,base_weight,weight_unit,serving_weight_g,serving_qty,serving_unit,yield_text)';

async function _rvLoadTree(v){
  const byParent = new Map([[v.rec.id, v.bom]]);
  let frontier = [...new Set(v.bom.filter(r => r.component_type === 'RECIPE' && r.sub_recipe_id).map(r => r.sub_recipe_id))];
  for(let depth = 0; depth < 6 && frontier.length; depth++){
    const ask = frontier.filter(id => !byParent.has(id));
    if(!ask.length) break;
    const { data, error } = await supa.from('recipe_bom').select(RV_BOM_COLS).in('parent_recipe_id', ask).order('sort_order');
    if(error) return { state: 'error' };
    ask.forEach(id => byParent.set(id, []));
    (data || []).forEach(r => byParent.get(r.parent_recipe_id)?.push(r));
    frontier = [...new Set((data || []).filter(r => r.component_type === 'RECIPE' && r.sub_recipe_id).map(r => r.sub_recipe_id))];
  }
  const prepIds = [...new Set([...byParent.values()].flat().map(r => r.prep_task_id).filter(x => x != null))];
  const preps = new Map();
  if(prepIds.length){
    const { data, error } = await supa.from('prep_tasks').select('id,name').in('id', prepIds);
    if(error) return { state: 'error' };
    (data || []).forEach(p => preps.set(p.id, p.name));
  }
  return { state: 'ok', byParent, preps, prepIds };
}

function _rvLots(n){ return n > 0 && n < 0.01 ? 'meno di 0,01 lotti' : `${_rvN(Math.round(n * 100) / 100, 2)} ${Math.round(n * 100) === 100 ? 'lotto' : 'lotti'}`; }
function _rvGrams(unit){ const u = _rvUnit(unit); return u.fam === 'mass' ? u.f : null; }

// Tutta l'analisi in un posto: quanto serve di ogni preparazione (a ogni livello) e cosa non torna.
function _rvStructAnalysis(v){
  const problems = [], preps = new Map(), tree = v.tree?.state === 'ok' ? v.tree : null;
  const addP = (t, where, bad = true) => { const s = t + (where ? ` (dentro «${where}»)` : ''); if(!problems.some(p => p.t === s)) problems.push({ t: s, bad }); };
  const walk = (recId, recTitle, rows, factor, path, depth) => {
    rows.forEach(row => {
      const where = depth ? recTitle : null;
      const u = _rvUnit(row.unit);
      if(row.component_type !== 'RECIPE'){
        const name = _rvIngName(row);
        if(_rvNum(row.quantity) === null || _rvNum(row.quantity) === 0) addP(`Manca la quantità di «${name}».`, where);
        else if(u.fam === 'unknown') addP(`Unità non convertibile: «${name}» è scritto in "${row.unit}", non so pesarlo.`, where, false);
        if(row.prep_task_id != null && tree && !tree.preps.has(row.prep_task_id)) addP(`«${name}» è collegato a una prep che non esiste più.`, where);
        if(depth === 0 && row.prep_task_id != null && tree?.preps.has(row.prep_task_id)){
          const q = factor != null ? _rvScaleQty(row.quantity, row.unit, factor).text : null;
          preps.set('item:' + row.bom_id, { item: true, name, need: q, prep: tree.preps.get(row.prep_task_id), depth: 0 });
        }
        return;
      }
      const sub = row.recipes;
      if(!row.sub_recipe_id || !sub){ addP('Una riga punta a una preparazione che non esiste più.', where); return; }
      const name = sub.title;
      if(path.includes(row.sub_recipe_id)){
        addP(row.sub_recipe_id === recId ? `«${name}» contiene se stessa.` : `«${name}» rientra in se stessa passando da «${recTitle}».`, null);
        return;
      }
      const y = _rvYieldBase(sub), bw = _rvNum(sub.base_weight_g);
      const sf1 = _rvSubFactor(row.quantity, row.unit, 1, sub);
      if(!sf1.ok){
        if(y.mode === 'lotti') addP(`Non conosco la resa di «${name}»: non posso calcolare quanti lotti servono.`, where);
        else if((u.fam === 'mass' || u.fam === 'vol') && !(bw > 0) && y.mode === 'porzioni')
          addP(`Collegamento sospetto: «${name}» rende ${typeof _subYieldLabel === 'function' ? _subYieldLabel(sub) : 'porzioni'} ma in «${recTitle}» è usata in ${row.unit}. Cercavi una salsa o una base?`, null);
        else addP(`Quantità di «${name}» non convertibile: ${sf1.why}.`, where);
      }
      const lots = sf1.ok && factor != null ? sf1.factor * factor : null;
      const prev = preps.get(row.sub_recipe_id);
      if(prev){ prev.lots = prev.lots != null && lots != null ? prev.lots + lots : null; if(depth > prev.depth) prev.depth = depth; }
      else preps.set(row.sub_recipe_id, { id: row.sub_recipe_id, name, sub, lots, depth, via: depth ? recTitle : null });
      if(tree){
        const kids = tree.byParent.get(row.sub_recipe_id);
        if(kids && !kids.length) addP(`«${name}» non ha ingredienti in distinta.`, null);
        if(kids) walk(row.sub_recipe_id, name, kids, lots, [...path, row.sub_recipe_id], depth + 1);
      }
    });
  };
  walk(v.rec.id, v.rec.title, v.bom, v.factor, [v.rec.id], 0);
  // la ricetta stessa
  if(v.yb.mode === 'lotti') addP('Questa ricetta non ha una resa registrata (porzioni o peso).', null);
  const nText = _rvNum((/^\s*(\d+(?:[.,]\d+)?)\s*porzion/i.exec(v.rec.yield_text || '') || [])[1]);
  if(v.yb.mode === 'porzioni' && nText > 0 && Math.abs(v.yb.base - nText) / nText > 0.05)
    addP(`Il testo della resa dice ${_rvN(nText, 1)} porzioni, ma le porzioni della ricetta sono ${_rvN(v.yb.base, 1)}.`, null);
  if(v.written.length && v.bom.length && typeof _writtenFullyInBom === 'function'){
    // anche dentro le sotto-ricette: "cipolle rosse" scritte in ricetta stanno dentro "Onion Rings"
    const all = tree ? [...tree.byParent.values()].flat() : v.bom;
    const rows = all.flatMap(b => [b.ingredients?.name, b.ingredients?.name_it, b.ingredients?.name_es, b.recipes?.title].filter(Boolean)
      .map(name => ({ name, ingredient_id: b.item_id, sub_recipe_id: b.sub_recipe_id })));
    const miss = v.written.filter(i => i && i.type !== 'section' && (i.name || '').trim() && !_writtenFullyInBom([i], rows)).map(i => i.name.trim());
    // confronto per nome: puo' essere un nome diverso per lo stesso ingrediente, quindi giallo e non rosso
    if(miss.length) addP(`La ricetta scritta contiene ingredienti assenti dalla distinta: ${miss.join(', ')}.`, null, false);
  }
  if(!v.bom.length && !v.bomError) addP('La distinta è vuota.', null);
  return { problems, preps: [...preps.values()] };
}

function _rvNeedText(p){
  if(p.item) return p.need || 'quantità non calcolabile';
  if(p.lots == null) return null;
  const bw = _rvNum(p.sub.base_weight_g), y = _rvYieldBase(p.sub);
  if(bw > 0) return _rvScaleQty(p.lots * bw, 'g', 1).text;
  if(y.mode === 'porzioni') return `${_rvN(Math.round(p.lots * y.base * 10) / 10, 1)} porzioni`;
  return null;
}

function _rvStruct(v){
  if(v.bomError) return `<div class="rv-note bad">${_rvT('bomErr')}</div>`;
  const f = v.factor, rec = v.rec, y = v.yb, an = _rvStructAnalysis(v);
  const loading = !v.tree || v.tree.state === 'loading', err = v.tree?.state === 'error';
  // stato: mai verde con problemi, mai verde prima di aver controllato tutti i livelli
  const nBad = an.problems.length;
  const state = err ? `<div class="rv-state bad"><div class="rv-lbl">● Non riesco a leggere le sotto-preparazioni</div><div class="rv-why">La struttura sotto il primo livello non è verificata.</div></div>`
    : loading ? `<div class="rv-state"><div class="rv-lbl">Controllo le sotto-preparazioni…</div></div>`
    : nBad ? `<div class="rv-state ${an.problems.some(p => p.bad) ? 'bad' : 'est'}"><div class="rv-lbl">● Struttura da correggere · ${nBad} ${nBad === 1 ? 'problema' : 'problemi'}</div><div class="rv-why">Li trovi in fondo, in parole semplici.</div></div>`
    : `<div class="rv-state ok"><div class="rv-lbl">● Struttura completa</div><div class="rv-why">Rese, collegamenti e unità tornano a ogni livello.</div></div>`;

  // A · RESA
  const bw = _rvNum(rec.base_weight_g), bwAlt = !(bw > 0) && _rvNum(rec.base_weight) > 0 && /^(kg|g)$/i.test(rec.weight_unit || '') ? _rvNum(rec.base_weight) * (/kg/i.test(rec.weight_unit) ? 1000 : 1) : null;
  const yw = bw > 0 ? bw : bwAlt;
  const sw = _rvNum(rec.serving_weight_g) || (String(rec.serving_unit || '').toLowerCase() === 'g' ? _rvNum(rec.serving_qty) : null);
  const kg = g => _rvScaleQty(g, 'g', 1).text;
  const r = [];
  r.push(['Resa del lotto', yw > 0 ? kg(yw) : null, bwAlt ? 'dal peso del lotto' : '', 'non registrata']);
  r.push(['Porzioni', y.mode === 'porzioni' ? _rvN(Math.round(y.base * 10) / 10, 1) : null,
    y.from === 'peso' ? `dedotte: ${kg(yw)} ÷ ${kg(sw)}` : '', 'non registrate']);
  const swDed = !(sw > 0) && yw > 0 && _rvNum(rec.base_servings) > 0 ? yw / _rvNum(rec.base_servings) : null;
  r.push(['Peso a porzione', sw > 0 ? kg(sw) : swDed ? kg(swDed) : null, swDed ? `dedotto: ${kg(yw)} ÷ ${_rvN(_rvNum(rec.base_servings), 1)} porzioni` : '', 'non registrato']);
  if((rec.yield_text || '').trim()) r.push(['Testo della resa', `«${rec.yield_text.trim()}»`, y.mode === 'lotti' ? 'non usato: non è un dato' : 'solo descrittivo', '']);
  r.push([`Per ${_rvAmountLabel(v)}`, yw > 0 ? kg(yw * f) : null, yw > 0 ? 'peso finale previsto' : '', 'peso non calcolabile: manca la resa in peso']);
  const resa = r.map(([k, val, note, miss]) => `<div class="rv-it"><div class="rv-grow">${_rvEsc(k)}${note ? `<small>${_rvEsc(note)}</small>` : ''}</div>${val != null
    ? `<div class="rv-v">${_rvEsc(val)}</div>` : `<div class="rv-v unk"><small>${_rvEsc(miss)}</small></div>`}</div>`).join('');

  // B · COMPONENTI (primo livello)
  const comp = v.bom.map((row, i) => {
    const orig = _rvScaleQty(row.quantity, row.unit, 1).text, now = _rvScaleQty(row.quantity, row.unit, f).text;
    const prepName = row.prep_task_id != null && v.tree?.preps?.get(row.prep_task_id);
    const prepTag = row.prep_task_id != null ? `<span class="rv-badge">prep</span>` : '';
    if(row.component_type === 'RECIPE' && row.sub_recipe_id){
      const sub = row.recipes, sf = _rvSubFactor(row.quantity, row.unit, f, sub);
      const resa = sub && typeof _subYieldLabel === 'function' ? _subYieldLabel(sub) : 'resa non indicata';
      const lot = sf.ok ? `<small>resa ${_rvEsc(resa)} · servono ${_rvLots(sf.factor)}</small>`
        : `<small class="bad">resa ${_rvEsc(resa)} · lotti non calcolabili</small>`;
      return `<button class="rv-it" data-sub="${i}"><div class="rv-grow">${_rvEsc(_rvIngName(row))}<span class="rv-badge">sotto-ricetta</span>${prepTag}<small>originale: ${_rvEsc(orig)}</small>${lot}</div><div class="rv-v">${_rvEsc(now)}</div><span class="rv-chev" aria-hidden="true">›</span></button>`;
    }
    return `<div class="rv-it"><div class="rv-grow">${_rvEsc(_rvIngName(row))}<span class="rv-badge a">ingrediente</span>${prepTag}<small>originale: ${_rvEsc(orig)}${prepName ? ` · prep: ${_rvEsc(prepName)}` : ''}</small></div><div class="rv-v">${_rvEsc(now)}</div></div>`;
  }).join('');

  // C · DA PREPARARE: prima le preparazioni piu' interne (si fanno per prime)
  const todo = an.preps.slice().sort((a, b) => b.depth - a.depth).map(p => {
    const need = _rvNeedText(p);
    if(p.item) return `<div class="rv-it"><div class="rv-grow">${_rvEsc(p.name)}<small>prep: ${_rvEsc(p.prep)}</small></div><div class="rv-v">${_rvEsc(need)}</div></div>`;
    const yl = typeof _subYieldLabel === 'function' ? _subYieldLabel(p.sub) : '';
    const sub = p.lots != null ? `${_rvLots(p.lots)} · resa ${yl}` : `resa ${yl}: quantità non calcolabile`;
    return `<button class="rv-it" data-rid="${_rvEsc(p.id)}" data-lots="${p.lots ?? ''}"><div class="rv-grow">${_rvEsc(p.name)}<small${p.lots == null ? ' class="bad"' : ''}>${_rvEsc(sub)}</small>${p.via ? `<small>per «${_rvEsc(p.via)}»</small>` : ''}</div><div class="rv-v${need ? '' : ' unk'}">${need ? _rvEsc(need) : '?'}</div><span class="rv-chev" aria-hidden="true">›</span></button>`;
  }).join('');

  const probs = an.problems.map(p => `<div class="rv-issue"><div class="rv-ic${p.bad ? '' : ' w'}">!</div><div><b>${_rvEsc(p.t)}</b></div></div>`).join('');
  return `<div class="rv-sec">${state}
    <h2>Resa</h2><div class="rv-card">${resa}</div>
    <h2>Componenti · ${_rvEsc(_rvAmountLabel(v))}</h2><div class="rv-card">${comp || `<div class="rv-empty">${_rvT('noIng')}</div>`}</div>
    <h2>Da preparare · ${_rvEsc(_rvAmountLabel(v))}</h2>
    <div class="rv-card">${todo || `<div class="rv-empty">Nessuna preparazione collegata: solo ingredienti da pesare (vedi PREP).</div>`}</div>
    ${loading ? '' : probs ? `<h2>Problemi di struttura · ${an.problems.length}</h2><div class="rv-card">${probs}</div>` : ''}
  </div>`;
}

function _rvAmountLabel(v){
  const y = v.yb;
  if(y.mode === 'porzioni'){ const p = y.base * v.factor; return _rvN(Math.round(p * 10) / 10, 1) + ' ' + _rvT('portions').toLowerCase(); }
  if(y.mode === 'peso') return _rvN(Math.round(y.base * v.factor / 10) / 100, 2) + ' kg';
  return '× ' + _rvN(Math.round(v.factor * 100) / 100, 2);
}


// Intestazione ferma in alto e compatta (~185 px a 390x844): riga 1 chiudi · nome (max 2 righe) · modifica;
// riga 2 porzioni: etichetta, numero e slider sulla stessa riga; riga 3 PREP | COSTO | STRUTTURA.
function _rvHeader(v, depth){
  const y = v.yb;
  const cat = v.rec.menu_group || v.rec.category || '';
  const orig = y.mode === 'porzioni' ? `${_rvN(Math.round(y.base * 10) / 10, 1)} ${_rvT('portions').toLowerCase()}` : y.mode === 'peso' ? `lotto ${_rvN(y.base / 1000, 2)} kg` : 'resa non registrata';
  const meta = [depth ? `dentro ${depth}` : null, cat, `ricetta da ${orig}`].filter(Boolean).join(' · ');
  const isAdm = typeof isAdmin === 'function' && isAdmin();
  const lbl = y.mode === 'porzioni' ? _rvT('portions') : y.mode === 'peso' ? _rvT('batchKg') + ' kg' : _rvT('batches');
  const range = y.mode === 'porzioni' ? { min: 1, max: Math.max(200, Math.ceil(y.base * 3)), step: 1 }
    : y.mode === 'peso' ? { min: 0.1, max: Math.max(10, Math.ceil(y.base * 3 / 1000)), step: 0.1 } : { min: 0.25, max: 10, step: 0.25 };
  return `<div class="rv-head"><div class="rv-in">
    <div class="rv-top">
      <button class="rv-round" id="rvBack" aria-label="${depth ? _rvT('back') : _rvT('close')}">${depth ? RV_ICONS.back : RV_ICONS.close}</button>
      <div class="rv-title"><h1 title="${_rvEsc(v.rec.title || '')}">${_rvEsc(v.rec.title || '')}</h1><span>${_rvEsc(meta)}</span></div>
      ${isAdm ? `<button class="rv-round" id="rvEdit" aria-label="${_rvT('edit')}">${RV_ICONS.edit}</button>` : ''}
    </div>
    <div class="rv-por rv-prow">
      <label for="rvAmount"><b>${lbl}</b><small id="rvSub"></small></label>
      <input id="rvAmount" inputmode="decimal" autocomplete="off" aria-label="${lbl}">
      <input type="range" id="rvRange" min="${range.min}" max="${range.max}" step="${range.step}" aria-label="${lbl}">
    </div>
    <div class="rv-seg" role="tablist" aria-label="Modalità">
      ${['prep', 'cost', 'struct'].map(k => `<button role="tab" data-tab="${k}" aria-selected="${v.tab === k}">${RV_ICONS[k]}${_rvT(k)}</button>`).join('')}
    </div>
  </div></div>`;
}

// Avvisi sulla resa: nel contenuto, non nell'intestazione (che deve restare piccola).
function _rvNotes(v){
  const y = v.yb;
  const yieldNote = y.from === 'peso' ? `<div class="rv-note">Porzioni calcolate come fa FC05: peso del lotto diviso peso a porzione.</div>`
    : y.mode === 'lotti' && y.text ? `<div class="rv-note">Il testo della resa dice "${_rvEsc(y.text)}", ma la ricetta non ha il campo porzioni né un peso: FC05 non lo usa, quindi qui si scala per lotti.</div>`
    : y.mode === 'lotti' ? `<div class="rv-note">Questa ricetta non ha una resa registrata (porzioni o peso): puoi solo moltiplicarla per lotti.</div>` : '';
  return (v.subWarn ? `<div class="rv-note bad">⚠ ${_rvEsc(v.subWarn)}</div>` : '') + yieldNote;
}

// ── controller ──
window.recipeView = {
  enabled(){
    try{ if(localStorage.getItem('brigade_ricetta_v2') === '1') return true; }catch(e){}
    return /(^|#)ricetta-v2\b/.test(location.hash || '');
  },
  // Interruttore per dispositivo, solo per l'amministratore: spento per tutti finche' non lo si accende qui.
  // (L'app aperta dalla schermata Home dell'iPhone ha una memoria sua: l'indirizzo con #ricetta-v2 non basta.)
  setFlag(on){
    try{ if(on) localStorage.setItem('brigade_ricetta_v2', '1'); else localStorage.removeItem('brigade_ricetta_v2'); }catch(e){}
    this.syncFlagButton();
  },
  syncFlagButton(){
    const box = document.getElementById('recipeAdminBtns'); if(!box) return;
    let b = document.getElementById('rvFlagBtn');
    if(!(typeof isAdmin === 'function' && isAdmin())){ b?.remove(); return; }
    if(!b){
      b = document.createElement('button');
      b.id = 'rvFlagBtn';
      b.className = 'px-3 py-1.5 rounded-lg text-xs';
      b.onclick = () => this.setFlag(!this.enabled());
      box.prepend(b);
    }
    const on = this.enabled();
    b.textContent = on ? 'Scheda nuova: ON' : 'Scheda nuova: OFF';
    b.setAttribute('aria-pressed', String(on));
    b.style.cssText = on ? 'background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;' : 'background:#fff;color:#475569;border:1px solid #cbd5e1;';
  },
  _stack: [],
  async open(recipeId){
    document.getElementById('rvOverlay')?.remove();
    if(!document.getElementById('rvStyle')) document.head.insertAdjacentHTML('beforeend', RV_STYLE);
    const ov = document.createElement('div');
    ov.id = 'rvOverlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="rv-page"><div class="rv-empty">${_rvT('loading')}</div></div>`;
    document.body.appendChild(ov);
    if(typeof window.lockPrepScroll === 'function') window.lockPrepScroll('recipe-view');
    this._stack = [];
    await this._push(recipeId, null, null, 'prep');
  },
  async _push(recipeId, factor, subWarn, tab){
    const ov = document.getElementById('rvOverlay'); if(!ov) return;
    const d = await _rvLoad(recipeId);
    if(!document.getElementById('rvOverlay')) return;
    if(d.error){
      if(!this._stack.length){ ov.innerHTML = `<div class="rv-page"><div class="rv-top"><button class="rv-round" id="rvBack" aria-label="${_rvT('close')}">${RV_ICONS.close}</button></div><div class="rv-note bad">${_rvT('readErr')}</div></div>`;
        ov.querySelector('#rvBack').onclick = () => this.close(); }
      else if(typeof showScToast === 'function') showScToast(_rvT('readErr'));
      return;
    }
    const written = typeof _legacyIngredients === 'function' ? _legacyIngredients(d.rec.ingredients) : (Array.isArray(d.rec.ingredients) ? d.rec.ingredients : []);
    this._stack.push({ rec: d.rec, bom: d.bom || [], bomError: d.bomError, steps: d.steps, written, yb: _rvYieldBase(d.rec),
      factor: factor > 0 ? factor : 1, tab: tab || 'prep', subWarn: subWarn || null, scrollY: 0, cost: null, tree: null });
    this._render(true);
  },
  _cur(){ return this._stack[this._stack.length - 1]; },
  // I costi si leggono una volta per ricetta, alla prima apertura di COSTO; il cambio porzioni non rilegge.
  _ensureCost(v){
    if(v.tab !== 'cost' || v.cost) return;
    v.cost = { state: 'loading' };
    _rvLoadCost(v.rec.id).then(c => { v.cost = c; }, () => { v.cost = { state: 'error' }; })
      .then(() => { if(this._cur() === v && v.tab === 'cost') this._render(false); });
  },
  // Le distinte delle sotto-ricette si leggono una volta, alla prima apertura di STRUTTURA.
  _ensureTree(v){
    if(v.tab !== 'struct' || v.tree) return;
    v.tree = { state: 'loading' };
    _rvLoadTree(v).then(t => { v.tree = t; }, () => { v.tree = { state: 'error' }; })
      .then(() => { if(this._cur() === v && v.tab === 'struct') this._render(false); });
  },
  // full=true ridisegna anche intestazione; il cambio porzioni ridisegna solo il contenuto (il campo resta a fuoco)
  _render(full){
    const ov = document.getElementById('rvOverlay'), v = this._cur(); if(!ov || !v) return;
    this._ensureCost(v);
    this._ensureTree(v);
    if(full){
      const parent = this._stack.length > 1 ? this._stack[this._stack.length - 2].rec.title : null;
      ov.innerHTML = `${_rvHeader(v, parent)}<div class="rv-page"><div id="rvNotes"></div><main id="rvView" aria-live="polite"></main></div>`;
      this._bind(ov);
    }
    this._syncAmount(ov, v);
    ov.querySelector('#rvNotes').innerHTML = _rvNotes(v);
    ov.querySelector('#rvView').innerHTML = v.tab === 'prep' ? _rvPrep(v) : v.tab === 'cost' ? _rvCost(v) : _rvStruct(v);
    ov.querySelectorAll('#rvView [data-sub]').forEach(b => b.onclick = () => this.openSub(+b.dataset.sub));
    ov.querySelectorAll('#rvView [data-rid]').forEach(b => b.onclick = () => this.openPrep(b.dataset.rid, b.dataset.lots));
  },
  _amount(v){ return v.yb.mode === 'porzioni' ? v.yb.base * v.factor : v.yb.mode === 'peso' ? v.yb.base * v.factor / 1000 : v.factor; },
  _syncAmount(ov, v){
    const inp = ov.querySelector('#rvAmount'), rng = ov.querySelector('#rvRange'), sub = ov.querySelector('#rvSub');
    const a = this._amount(v), dec = v.yb.mode === 'porzioni' ? 1 : 2;
    if(inp && document.activeElement !== inp) inp.value = _rvN(Math.round(a * 10 ** dec) / 10 ** dec, dec, false);
    if(rng) rng.value = String(Math.min(+rng.max, Math.max(+rng.min, a)));
    if(sub) sub.textContent = Math.abs(v.factor - 1) < 1e-9 ? 'originale' : `× ${_rvN(Math.round(v.factor * 1000) / 1000, 3)}`;
  },
  setAmount(value){
    const v = this._cur(); if(!v) return false;
    const a = _rvNum(value); if(!(a > 0)) return false;
    const f = v.yb.mode === 'porzioni' ? a / v.yb.base : v.yb.mode === 'peso' ? a * 1000 / v.yb.base : a;
    v.factor = Math.min(f, 1000);
    this._render(false);
    return true;
  },
  setTab(tab){
    const v = this._cur(); if(!v || !['prep', 'cost', 'struct'].includes(tab)) return;
    v.tab = tab;
    const ov = document.getElementById('rvOverlay');
    ov?.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    this._render(false);
    ov?.scrollTo?.({ top: 0 });
  },
  _bind(ov){
    ov.querySelector('#rvBack').onclick = () => this.back();
    const ed = ov.querySelector('#rvEdit');
    if(ed) ed.onclick = () => { const rec = this._cur().rec; this.close(); if(typeof openRecipeEditor === 'function') openRecipeEditor(rec); };
    const inp = ov.querySelector('#rvAmount'), rng = ov.querySelector('#rvRange');
    inp.addEventListener('input', () => this.setAmount(inp.value));
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('blur', () => this._syncAmount(ov, this._cur()));
    rng.addEventListener('input', () => this.setAmount(rng.value));
    ov.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this.setTab(b.dataset.tab));
  },
  async openSub(i){
    const v = this._cur(), row = v?.bom[i]; if(!row?.sub_recipe_id) return;
    v.scrollY = document.getElementById('rvOverlay')?.scrollTop || 0;
    const sf = _rvSubFactor(row.quantity, row.unit, v.factor, row.recipes);
    const need = _rvScaleQty(row.quantity, row.unit, v.factor).text;
    await this._push(row.sub_recipe_id, sf.ok ? sf.factor : 1,
      sf.ok ? null : `In "${v.rec.title}" servono ${need}, ma la quantità non si converte (${sf.why}). Mostro la ricetta alla sua resa.`, v.tab);
  },
  // da "Da preparare": la preparazione alla quantita' che serve; se non calcolabile, alla sua resa e lo dice
  async openPrep(id, lots){
    const v = this._cur(); if(!v || !id) return;
    v.scrollY = document.getElementById('rvOverlay')?.scrollTop || 0;
    const l = _rvNum(lots);
    await this._push(id, l > 0 ? l : 1, l > 0 ? null : `La quantità che serve per "${v.rec.title}" non è calcolabile: mostro la ricetta alla sua resa.`, v.tab);
  },
  back(){
    if(this._stack.length > 1){
      this._stack.pop();
      this._render(true);
      const ov = document.getElementById('rvOverlay'); if(ov) ov.scrollTop = this._cur().scrollY || 0;
      return;
    }
    this.close();
  },
  close(){
    document.getElementById('rvOverlay')?.remove();
    this._stack = [];
    if(typeof window.unlockPrepScroll === 'function') window.unlockPrepScroll('recipe-view');
  },
  _: { scaleQty: _rvScaleQty, yieldBase: _rvYieldBase, subFactor: _rvSubFactor, unit: _rvUnit, costState: _rvCostState },
};
