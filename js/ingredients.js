// ── INGREDIENTS INTELLIGENCE — BOH OS v2 ──
// Scheda ingrediente, confronto prezzi, storico spesa
// Max può chiedere al Sous Chef: "quanto mi costa 100g di burrata?"

// ── CONVERSIONI UNITÀ (cache locale) ──────────────────────────
const UNIT_CONVERSIONS = {
  // peso → grammi
  'lb':  453.592,
  'oz':  28.3495,
  'kg':  1000,
  'g':   1,
  // volume → ml
  'gal': 3785.41,
  'qt':  946.353,
  'pt':  473.176,
  'fl_oz': 29.5735,
  'l':   1000,
  'ml':  1,
};

// Converte qty in unità base (g o ml)
function convertToBase(qty, unit){
  const factor=UNIT_CONVERSIONS[unit?.toLowerCase()];
  if(!factor) return null;
  return qty * factor;
}

// Formatta prezzo per 100g
function costPer100g(unitPrice, purchaseUnit, conversionToBase){
  const baseQty=conversionToBase||UNIT_CONVERSIONS[purchaseUnit?.toLowerCase()];
  if(!baseQty||!unitPrice) return null;
  return (unitPrice/baseQty)*100;
}

// ── CERCA INGREDIENTE PER NOME ────────────────────────────────
async function searchIngredient(name){
  const {data}=await supa.from('ingredients')
    .select('*')
    .ilike('name', `%${name}%`)
    .eq('active',true)
    .limit(10);
  return data||[];
}

// ── APRI LISTA INGREDIENTI ────────────────────────────────────
async function openIngredientsList(){
  const {data:ingrs}=await supa.from('ingredients')
    .select('id,name,category,base_unit')
    .eq('active',true)
    .order('name');

  // Carica best price per tutti
  const {data:bestPrices}=await supa.from('ingredient_best_price')
    .select('*')
    .eq('price_rank',1);
  const priceMap={};
  (bestPrices||[]).forEach(p=>{ priceMap[p.ingredient_id]=p; });

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex flex-col';
  modal.style.background='rgba(255,255,255,0.98)';
  modal.innerHTML=`
    <div style="padding:16px;border-bottom:0.5px solid rgba(59,130,246,0.1);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:16px;font-weight:600;color:#1e3a5f;">🧀 Ingredients</div>
        <div style="display:flex;gap:8px;">
          <button onclick="openAddIngredient()" style="font-size:12px;color:#10b981;background:rgba(16,185,129,0.1);border:none;padding:5px 12px;border-radius:8px;cursor:pointer;">+ Add</button>
          <button onclick="this.closest('.fixed').remove()" style="font-size:12px;color:#6b7280;background:#f1f5f9;border:none;padding:5px 12px;border-radius:8px;cursor:pointer;">✕</button>
        </div>
      </div>
      <input id="ingrSearch" placeholder="Search ingredient..." 
        style="width:100%;padding:10px 14px;border:1px solid #e2e8f0;border-radius:12px;font-size:14px;box-sizing:border-box;outline:none;"
        oninput="filterIngredientsList(this.value)">
    </div>
    <div id="ingrList" style="flex:1;overflow-y:auto;padding:12px;">
      ${(ingrs||[]).map(i=>{
        const bp=priceMap[i.id];
        return `
        <div onclick="openIngredientCard('${i.id}')" 
          style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:12px;margin-bottom:6px;background:#f8fafc;cursor:pointer;active:scale-99;"
          data-name="${(i.name||'').toLowerCase()}">
          <div>
            <div style="font-size:14px;font-weight:500;color:#1e3a5f;">${i.name}</div>
            <div style="font-size:11px;color:#93c5fd;">${i.category||'Uncategorized'} • ${i.base_unit}</div>
          </div>
          <div style="text-align:right;">
            ${bp?`<div style="font-size:13px;font-weight:600;color:#1e3a5f;">$${(bp.unit_price||0).toFixed(2)}</div>
            <div style="font-size:10px;color:#93c5fd;">${bp.vendor}</div>`:'<div style="font-size:11px;color:#cbd5e1;">no price</div>'}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  document.body.appendChild(modal);
}

window.filterIngredientsList=(q)=>{
  const rows=document.querySelectorAll('#ingrList [data-name]');
  const lq=q.toLowerCase();
  rows.forEach(r=>{ r.style.display=r.dataset.name.includes(lq)?'flex':'none'; });
};

// ── AGGIUNGI INGREDIENTE MANUALMENTE ─────────────────────────
function openAddIngredient(prefillName=''){
  const categories=['Dairy','Produce','Protein','Seafood','Dry Goods','Spices','Oil & Vinegar','Bakery','Frozen','Beverage','Other'];
  const units=['g','kg','ml','l','lb','oz','each'];

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e3a5f;margin-bottom:16px;">➕ New Ingredient</div>
      
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#93c5fd;font-weight:500;display:block;margin-bottom:4px;">NAME *</label>
        <input id="newIngrName" value="${prefillName}" placeholder="e.g. Burrata" 
          style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;">
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#93c5fd;font-weight:500;display:block;margin-bottom:4px;">CATEGORY</label>
          <select id="newIngrCat" style="width:100%;padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
            ${categories.map(c=>`<option>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:#93c5fd;font-weight:500;display:block;margin-bottom:4px;">BASE UNIT</label>
          <select id="newIngrUnit" style="width:100%;padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
            ${units.map(u=>`<option ${u==='g'?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
      </div>
      
      <div style="margin-bottom:16px;">
        <label style="font-size:11px;color:#93c5fd;font-weight:500;display:block;margin-bottom:4px;">NOTES</label>
        <textarea id="newIngrNotes" placeholder="Chef notes..." rows="2"
          style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;resize:none;box-sizing:border-box;"></textarea>
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:#f1f5f9;color:#6b7280;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveNewIngredient()" style="height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Save Ingredient</button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

window.saveNewIngredient=async()=>{
  const name=document.getElementById('newIngrName')?.value?.trim();
  if(!name){ alert('Name required'); return; }
  const {data,error}=await supa.from('ingredients').insert({
    name,
    category: document.getElementById('newIngrCat')?.value||null,
    base_unit: document.getElementById('newIngrUnit')?.value||'g',
    notes: document.getElementById('newIngrNotes')?.value||null
  }).select().single();
  if(error){ alert('Error: '+error.message); return; }
  document.querySelector('.fixed')?.remove();
  showScToast(`✓ ${name} added`);
  if(data) openIngredientCard(data.id);
};

// ── CALCOLA COSTO PER QUANTITÀ ────────────────────────────────
// Usato dal Sous Chef: "quanto costa 100g di burrata?"
async function calculateIngredientCost(ingredientName, qty, unit){
  const ingrs=await searchIngredient(ingredientName);
  if(!ingrs.length) return null;
  const ingr=ingrs[0];

  const {data:vendors}=await supa.from('ingredient_vendors')
    .select('*')
    .eq('ingredient_id',ingr.id)
    .order('unit_price');

  if(!vendors?.length) return {ingredient:ingr.name, error:'No price data'};

  const results=vendors.map(v=>{
    const basePerUnit=v.conversion_to_base||UNIT_CONVERSIONS[v.purchase_unit?.toLowerCase()];
    if(!basePerUnit||!v.unit_price) return null;
    const costPerBase=v.unit_price/basePerUnit; // costo per 1 base_unit (g o ml)
    const requestedBase=convertToBase(qty,unit);
    if(!requestedBase) return null;
    const totalCost=costPerBase*requestedBase;
    return {
      vendor:     v.vendor,
      unit_price: v.unit_price,
      purchase_unit: v.purchase_unit,
      cost_for_qty: totalCost,
      cost_per_base: costPerBase
    };
  }).filter(Boolean);

  return {
    ingredient: ingr.name,
    base_unit:  ingr.base_unit,
    qty,
    unit,
    results,
    best: results[0]||null
  };
}
