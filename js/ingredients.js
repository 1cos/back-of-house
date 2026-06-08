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


// ── TAB INGREDIENTS — FUNZIONI UI ────────────────────────────

let allIngredients = [];
let activeCategory = 'all';

async function loadIngredientsTab(){
  const list = document.getElementById('ingrTabList');
  if(!list) return;
  list.innerHTML = '<div class="text-sm text-slate-400 text-center py-8">Loading...</div>';

  // Carica ingredienti + best price in parallelo
  const [{data:ingrs}, {data:prices}] = await Promise.all([
    supa.from('ingredients').select('id,name,category,base_unit,notes').eq('active',true).order('name'),
    supa.from('ingredient_best_price').select('ingredient_id,vendor,unit_price,purchase_unit,price_rank').eq('price_rank',1)
  ]);

  allIngredients = ingrs || [];
  const priceMap = {};
  (prices||[]).forEach(p=>{ priceMap[p.ingredient_id] = p; });

  renderIngredientsTab(allIngredients, priceMap);
  // salva priceMap globale per il filtro
  window._ingrPriceMap = priceMap;
}

function renderIngredientsTab(ingrs, priceMap){
  const list = document.getElementById('ingrTabList');
  if(!list) return;

  const filtered = ingrs.filter(i => {
    const matchCat = activeCategory === 'all' || i.category === activeCategory;
    const q = (document.getElementById('ingrSearchMain')?.value||'').toLowerCase();
    const matchQ = !q || i.name.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if(!filtered.length){
    list.innerHTML = '<div class="text-sm text-slate-400 text-center py-8">No ingredients found</div>';
    return;
  }

  const catEmoji = {
    'Dairy':'🧀','Produce':'🥦','Protein':'🥩','Seafood':'🐟',
    'Dry Goods':'🌾','Oil & Vinegar':'🫒','Spices & Condiments':'🌶️',
    'Beverage':'🥤','Fees':'💸','Other':'📦'
  };

  list.innerHTML = filtered.map(i => {
    const bp = (priceMap||window._ingrPriceMap||{})[i.id];
    const emoji = catEmoji[i.category] || '📦';
    return `
    <div onclick="openIngredientCard('${i.id}')"
      style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:white;border-radius:14px;border:1px solid #f1f5f9;cursor:pointer;active:scale-98;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;border-radius:10px;background:#f8fafc;display:flex;align-items:center;justify-content:center;font-size:18px;">${emoji}</div>
        <div>
          <div style="font-size:14px;font-weight:500;color:#1e293b;">${i.name}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:1px;">${i.category||'Other'} • ${i.base_unit}</div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        ${bp
          ? `<div style="font-size:14px;font-weight:600;color:#1e293b;">$${(bp.unit_price||0).toFixed(2)}</div>
             <div style="font-size:10px;color:#94a3b8;">${bp.vendor?.split('/')[0]?.trim()||bp.vendor} / ${bp.purchase_unit}</div>`
          : `<div style="font-size:11px;color:#cbd5e1;">no price</div>`}
      </div>
    </div>`;
  }).join('');
}

window.filterIngredientsTab = (q) => {
  renderIngredientsTab(allIngredients, window._ingrPriceMap);
};

window.filterIngrCategory = (cat, btn) => {
  activeCategory = cat;
  document.querySelectorAll('#ingrCategoryFilter button').forEach(b=>{
    b.className = 'px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 whitespace-nowrap';
  });
  btn.className = 'px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-white whitespace-nowrap';
  renderIngredientsTab(allIngredients, window._ingrPriceMap);
};

// ── SCHEDA INGREDIENTE SMART ──────────────────────────────────
window.openIngredientCard = async function(ingredientId){
  // Carica tutto in parallelo
  const [
    {data:ingr},
    {data:vendors},
    {data:recipes},
    {data:priceHistory}
  ] = await Promise.all([
    supa.from('ingredients').select('*').eq('id',ingredientId).single(),
    supa.from('ingredient_vendors')
      .select('*')
      .eq('ingredient_id',ingredientId)
      .eq('active',true)
      .order('price_per_100g',{ascending:true,nullsLast:true}),
    supa.from('recipes').select('id,title,category,ingredients'),
    supa.from('invoice_lines')
      .select('vendor,unit_price,cost_per_100g,total_weight_g,invoice_date,purchase_unit,pack_description')
      .eq('ingredient_id',ingredientId)
      .not('cost_per_100g','is',null)
      .order('invoice_date',{ascending:false})
      .limit(12)
  ]);

  if(!ingr) return;

  // Ricette che usano questo ingrediente
  const usedIn = (recipes||[]).filter(r=>
    (r.ingredients||[]).some(i=>
      i.name && ingr.name &&
      i.name.toLowerCase().includes(ingr.name.toLowerCase().split(' ')[0])
    )
  );

  // Best price
  const bestVendor = vendors?.[0];
  const bestPer100g = bestVendor?.price_per_100g;

  // Trend prezzo (confronto ultima vs penultima fattura)
  let priceTrend = null;
  if(priceHistory?.length >= 2){
    const diff = priceHistory[0].cost_per_100g - priceHistory[1].cost_per_100g;
    const pct = (diff / priceHistory[1].cost_per_100g) * 100;
    priceTrend = {dir: diff > 0 ? '↑' : '↓', pct: Math.abs(pct).toFixed(1), color: diff > 0 ? '#ef4444' : '#10b981'};
  }

  const catEmoji = {
    'Dairy':'🧀','Produce':'🥦','Protein':'🥩','Seafood':'🐟',
    'Dry Goods':'🌾','Oil & Vinegar':'🫒','Spices':'🌶️','Spices & Condiments':'🌶️',
    'Beverage':'🥤','Bakery':'🥖','Frozen':'🧊','Fees':'💸','Other':'📦'
  };
  const emoji = catEmoji[ingr.category] || '📦';

  // ── VENDOR ROWS ──
  const vendorRows = vendors?.length ? vendors.map((v,idx)=>{
    const isLowest = idx === 0;
    const p100 = v.price_per_100g ? `$${v.price_per_100g.toFixed(2)}/100g` : '';
    const unitInfo = v.unit_price ? `$${v.unit_price.toFixed(2)}/${v.purchase_unit||'unit'}` : '—';
    const packInfo = v.pack_description||'';
    const lastDate = v.last_invoice_date ? new Date(v.last_invoice_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : (v.last_ordered ? new Date(v.last_ordered).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '');
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${isLowest?'rgba(16,185,129,0.06)':'rgba(59,130,246,0.03)'};border-radius:12px;border:1px solid ${isLowest?'rgba(16,185,129,0.2)':'#f1f5f9'};margin-bottom:6px;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="font-size:13px;font-weight:500;color:#1e293b;">${v.vendor}</div>
          ${isLowest?'<span style="font-size:9px;font-weight:700;color:#10b981;background:rgba(16,185,129,0.1);padding:1px 6px;border-radius:20px;">BEST</span>':''}
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${unitInfo}${packInfo?' · '+packInfo:''}${lastDate?' · '+lastDate:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:13px;font-weight:600;color:${isLowest?'#10b981':'#1e293b'};">${p100}</div>
      </div>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:#94a3b8;padding:8px 0;">No vendor data yet — import an invoice to populate</div>';

  // ── PRICE HISTORY ROWS ──
  const historyRows = priceHistory?.length ? priceHistory.slice(0,6).map(h=>{
    const d = h.invoice_date ? new Date(h.invoice_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '—';
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid #f1f5f9;">
      <div>
        <div style="font-size:12px;color:#1e293b;">${h.vendor}</div>
        <div style="font-size:10px;color:#94a3b8;">${d} · ${h.purchase_unit||''} ${h.pack_description?'· '+h.pack_description:''}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;font-weight:500;color:#1e293b;">$${(h.cost_per_100g||0).toFixed(2)}/100g</div>
        <div style="font-size:10px;color:#94a3b8;">$${(h.unit_price||0).toFixed(2)}</div>
      </div>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:#94a3b8;padding:8px 0;">No invoice history yet</div>';

  // ── RECIPE ROWS ──
  const recipeRows = usedIn.length ? usedIn.map(r=>`
    <div onclick="showRecipeSheet(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border-radius:10px;margin-bottom:5px;cursor:pointer;">
      <div style="font-size:16px;">${r.category?.includes('Pasta')?'🍝':r.category?.includes('Meat')?'🥩':r.category?.includes('Fish')?'🐟':'🍽️'}</div>
      <div>
        <div style="font-size:13px;font-weight:500;color:#1e293b;">${r.title}</div>
        ${r.category?`<div style="font-size:10px;color:#94a3b8;">${r.category}</div>`:''}
      </div>
    </div>`).join('')
    : '<div style="font-size:12px;color:#94a3b8;padding:4px 0;">Not used in any recipe yet</div>';

  // ── MODAL ──
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[60] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;';

  modal.innerHTML = `
    <!-- HEADER -->
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <button onclick="this.closest('.fixed').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:600;color:#1e293b;">${emoji} ${ingr.name}</div>
          <div style="font-size:11px;color:#94a3b8;">${ingr.category||'Other'} · ${ingr.base_unit} · ${ingr.count_unit||'weight'}</div>
        </div>
        ${isAdmin()?`<button onclick="openEditIngredient('${ingr.id}')" style="font-size:12px;color:#3B82F6;background:rgba(59,130,246,0.08);border:none;padding:5px 10px;border-radius:8px;cursor:pointer;">Edit</button>`:''}
      </div>
    </div>

    <div style="padding:16px;max-width:480px;width:100%;margin:0 auto;">

      <!-- STATS ROW -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
        <div style="background:#f8fafc;border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#1e293b;">${bestPer100g?'$'+bestPer100g.toFixed(2):'—'}</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Best /100g</div>
        </div>
        <div style="background:#f8fafc;border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#1e293b;">${vendors?.length||0}</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Vendors</div>
        </div>
        <div style="background:#f8fafc;border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:${priceTrend?priceTrend.color:'#1e293b'};">
            ${priceTrend?priceTrend.dir+priceTrend.pct+'%':'—'}
          </div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Price trend</div>
        </div>
      </div>

      <!-- VENDORS -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">
          Vendors & Prices
        </div>
        ${vendorRows}
      </div>

      <!-- PRICE HISTORY -->
      ${priceHistory?.length ? `
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">
          Invoice History
        </div>
        ${historyRows}
      </div>` : ''}

      <!-- USED IN RECIPES -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">
          Used in ${usedIn.length} Recipe${usedIn.length!==1?'s':''}
        </div>
        ${recipeRows}
      </div>

      ${ingr.notes?`
      <!-- NOTES -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Notes</div>
        <div style="font-size:13px;color:#475569;background:#f8fafc;border-radius:10px;padding:10px 12px;line-height:1.5;">${ingr.notes}</div>
      </div>`:''}

      ${ingr.avg_unit_weight_g?`
      <!-- UNIT INFO -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Unit Info</div>
        <div style="font-size:13px;color:#475569;background:#f8fafc;border-radius:10px;padding:10px 12px;">
          Avg unit weight: <strong>${ingr.avg_unit_weight_g}g</strong>
          ${ingr.unit_volume_ml?` · Volume: <strong>${ingr.unit_volume_ml}ml</strong>`:''}
        </div>
      </div>`:''}

    </div>`;

  modal.onclick = e=>{ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
};

// ── EDIT INGREDIENTE (admin) ──────────────────────────────────
window.openEditIngredient = async function(ingredientId){
  const {data:ingr} = await supa.from('ingredients').select('*').eq('id',ingredientId).single();
  if(!ingr) return;

  const categories=['Dairy','Produce','Protein','Seafood','Dry Goods','Spices','Spices & Condiments','Oil & Vinegar','Bakery','Frozen','Beverage','Fees','Other'];
  const units=['g','kg','ml','l','lb','oz','each'];

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[70] flex items-end';
  modal.style.background = 'rgba(0,0,0,0.3)';
  modal.innerHTML = `
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e293b;margin-bottom:16px;">✏️ Edit ${ingr.name}</div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">NAME</label>
        <input id="editIngrName" value="${ingr.name}" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">CATEGORY</label>
          <select id="editIngrCat" style="width:100%;padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
            ${categories.map(c=>`<option ${c===ingr.category?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">BASE UNIT</label>
          <select id="editIngrUnit" style="width:100%;padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
            ${units.map(u=>`<option ${u===ingr.base_unit?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">AVG UNIT WEIGHT (g)</label>
          <input id="editIngrWeight" type="number" value="${ingr.avg_unit_weight_g||''}" placeholder="e.g. 200" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">UNIT VOLUME (ml)</label>
          <input id="editIngrVol" type="number" value="${ingr.unit_volume_ml||''}" placeholder="e.g. 500" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">NOTES</label>
        <textarea id="editIngrNotes" rows="2" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;resize:none;box-sizing:border-box;">${ingr.notes||''}</textarea>
      </div>

      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:#f1f5f9;color:#6b7280;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveEditIngredient('${ingredientId}',this)" style="height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Save</button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
};

window.saveEditIngredient = async function(ingredientId, btn){
  btn.textContent='Saving...'; btn.disabled=true;
  const updates = {
    name:            document.getElementById('editIngrName')?.value?.trim(),
    category:        document.getElementById('editIngrCat')?.value||null,
    base_unit:       document.getElementById('editIngrUnit')?.value||'g',
    notes:           document.getElementById('editIngrNotes')?.value||null,
  };
  const w = parseFloat(document.getElementById('editIngrWeight')?.value);
  const v = parseFloat(document.getElementById('editIngrVol')?.value);
  if(w) updates.avg_unit_weight_g = w;
  if(v) updates.unit_volume_ml = v;

  const {error} = await supa.from('ingredients').update(updates).eq('id',ingredientId);
  if(error){ btn.textContent='Error'; btn.disabled=false; return; }
  btn.closest('.fixed').remove();
  // Riapri la scheda aggiornata
  document.querySelector('.fixed.inset-0')?.remove();
  openIngredientCard(ingredientId);
};
