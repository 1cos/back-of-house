// ── INGREDIENTS — BOH OS ──────────────────────────────────────
// Scheda ingrediente, confronto prezzi vendor, storico fatture

// ── CONVERSIONI LOCALI (fallback senza DB) ────────────────────
const UNIT_CONVERSIONS = {
  'lb':453.592,'oz':28.3495,'kg':1000,'g':1,
  'gal':3785.41,'qt':946.353,'pt':473.176,'fl_oz':29.5735,'l':1000,'ml':1,
};
function convertToBase(qty,unit){
  const f=UNIT_CONVERSIONS[unit?.toLowerCase()];
  return f?qty*f:null;
}

// ── CALCOLA price_per_100g DA DATI VENDOR ────────────────────
function calcPrice100g(v){
  // Usa conversion_to_base se disponibile, altrimenti ricava da purchase_unit
  const base = v.conversion_to_base ||
    (v.total_weight_g) ||
    (v.purchase_unit ? convertToBase(1, v.purchase_unit) : null);
  if(!base || !v.unit_price) return null;
  return (v.unit_price / base) * 100;
}

// ── MOTIVO MANCANZA PREZZO ────────────────────────────────────
function missingPriceReason(v){
  if(!v.unit_price) return 'Missing unit price';
  if(!v.purchase_unit && !v.total_weight_g && !v.conversion_to_base)
    return 'Missing purchase unit';
  if(!v.total_weight_g && !v.conversion_to_base && !convertToBase(1,v.purchase_unit))
    return 'Missing pack size / total weight';
  return 'Needs review';
}

// ── CERCA INGREDIENTE ─────────────────────────────────────────
async function searchIngredient(name){
  const {data}=await supa.from('ingredients')
    .select('*').ilike('name',`%${name}%`).eq('active',true).limit(10);
  return data||[];
}

// ── CALCOLA COSTO PER QUANTITÀ (usato da Chef AI) ─────────────
async function calculateIngredientCost(ingredientName,qty,unit){
  const ingrs=await searchIngredient(ingredientName);
  if(!ingrs.length) return null;
  const ingr=ingrs[0];
  const {data:vendors}=await supa.from('ingredient_vendors')
    .select('*').eq('ingredient_id',ingr.id).order('price_per_100g',{nullsLast:true});
  if(!vendors?.length) return {ingredient:ingr.name,error:'No price data'};
  const results=vendors.map(v=>{
    const p100=v.price_per_100g||calcPrice100g(v);
    if(!p100) return null;
    const baseQty=convertToBase(qty,unit);
    if(!baseQty) return null;
    return {vendor:v.vendor,cost_for_qty:(p100/100)*baseQty,price_per_100g:p100};
  }).filter(Boolean);
  return {ingredient:ingr.name,qty,unit,results,best:results[0]||null};
}

// ── TAB INGREDIENTS ───────────────────────────────────────────
let allIngredients=[];
let activeCategory='all';

async function loadIngredientsTab(){
  const list=document.getElementById('ingrTabList');
  if(!list) return;
  list.innerHTML='<div class="text-sm text-slate-400 text-center py-8">Loading...</div>';

  const [{data:ingrs},{data:prices}]=await Promise.all([
    supa.from('ingredients').select('id,name,category,base_unit').eq('active',true).order('name'),
    supa.from('ingredient_vendors').select('ingredient_id,vendor,unit_price,purchase_unit,pack_description,price_per_100g,total_weight_g,conversion_to_base')
      .eq('active',true).order('price_per_100g',{ascending:true,nullsLast:true})
  ]);

  allIngredients=ingrs||[];
  // Best price per ingredient
  const priceMap={};
  (prices||[]).forEach(p=>{
    if(!priceMap[p.ingredient_id]) priceMap[p.ingredient_id]=p;
  });
  window._ingrPriceMap=priceMap;
  renderIngredientsTab(allIngredients,priceMap);
}

function renderIngredientsTab(ingrs,priceMap){
  const list=document.getElementById('ingrTabList');
  if(!list) return;

  const filtered=ingrs.filter(i=>{
    const matchCat=activeCategory==='all'||i.category===activeCategory;
    const q=(document.getElementById('ingrSearchMain')?.value||'').toLowerCase();
    const matchQ=!q||i.name.toLowerCase().includes(q);
    return matchCat&&matchQ;
  });

  if(!filtered.length){
    list.innerHTML='<div class="text-sm text-slate-400 text-center py-8">No ingredients found</div>';
    return;
  }

  const catEmoji={
    'Dairy':'🧀','Produce':'🥦','Protein':'🥩','Seafood':'🐟',
    'Dry Goods':'🌾','Oil & Vinegar':'🫒','Spices & Condiments':'🌶️',
    'Beverage':'🥤','Fees':'💸','Other':'📦'
  };

  list.innerHTML=filtered.map(i=>{
    const bp=(priceMap||window._ingrPriceMap||{})[i.id];
    const emoji=catEmoji[i.category]||'📦';
    // Prezzo display
    let priceDisplay='<div style="font-size:11px;color:#cbd5e1;">no price</div>';
    if(bp){
      const p100=bp.price_per_100g||calcPrice100g(bp);
      if(p100){
        const packStr=bp.pack_description?` ${bp.pack_description}`:bp.purchase_unit?` ${bp.purchase_unit}`:'';
        priceDisplay=`
          <div style="font-size:13px;font-weight:600;color:#1e293b;">$${(bp.unit_price||0).toFixed(2)}${packStr}</div>
          <div style="font-size:10px;color:#10b981;font-weight:500;">$${p100.toFixed(2)}/100g</div>`;
      } else {
        priceDisplay=`<div style="font-size:11px;color:#f59e0b;">${missingPriceReason(bp)}</div>`;
      }
    }
    return `
    <div onclick="openIngredientCard('${i.id}')"
      style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:white;border-radius:14px;border:1px solid #f1f5f9;cursor:pointer;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;border-radius:10px;background:#f8fafc;display:flex;align-items:center;justify-content:center;font-size:18px;">${emoji}</div>
        <div>
          <div style="font-size:14px;font-weight:500;color:#1e293b;">${i.name}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:1px;">${i.category||'Other'} · ${i.base_unit}</div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">${priceDisplay}</div>
    </div>`;
  }).join('');
}

window.filterIngredientsTab=()=>renderIngredientsTab(allIngredients,window._ingrPriceMap);
window.filterIngrCategory=(cat,btn)=>{
  activeCategory=cat;
  document.querySelectorAll('#ingrCategoryFilter button').forEach(b=>{
    b.className='px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 whitespace-nowrap';
  });
  btn.className='px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-white whitespace-nowrap';
  renderIngredientsTab(allIngredients,window._ingrPriceMap);
};

// ── SCHEDA INGREDIENTE SMART ──────────────────────────────────
window.openIngredientCard=async function(ingredientId){
  const [
    {data:ingr},
    {data:vendors},
    {data:recipes},
    {data:priceHistory}
  ]=await Promise.all([
    supa.from('ingredients').select('*').eq('id',ingredientId).single(),
    supa.from('ingredient_vendors').select('*').eq('ingredient_id',ingredientId).eq('active',true),
    supa.from('recipes').select('id,title,category,ingredients'),
    supa.from('invoice_lines')
      .select('vendor,unit_price,cost_per_100g,total_weight_g,invoice_date,purchase_unit,pack_description')
      .eq('ingredient_id',ingredientId)
      .not('cost_per_100g','is',null)
      .order('invoice_date',{ascending:false})
      .limit(12)
  ]);
  if(!ingr) return;

  // Ordina vendor per price_per_100g (calcola se manca)
  const vendorsSorted=(vendors||[]).map(v=>({
    ...v,
    _p100: v.price_per_100g||calcPrice100g(v)
  })).sort((a,b)=>{
    if(a._p100==null) return 1;
    if(b._p100==null) return -1;
    return a._p100-b._p100;
  });

  const bestVendor=vendorsSorted[0];
  const bestPer100g=bestVendor?._p100;

  // Trend prezzo
  let priceTrend=null;
  if(priceHistory?.length>=2){
    const diff=priceHistory[0].cost_per_100g-priceHistory[1].cost_per_100g;
    const pct=(diff/priceHistory[1].cost_per_100g)*100;
    priceTrend={dir:diff>0?'↑':'↓',pct:Math.abs(pct).toFixed(1),color:diff>0?'#ef4444':'#10b981'};
  }

  // Ricette che usano questo ingrediente (fuzzy match)
  const usedIn=(recipes||[]).filter(r=>
    (r.ingredients||[]).some(i=>i.name&&ingr.name&&
      i.name.toLowerCase().includes(ingr.name.toLowerCase().split(' ')[0]))
  );

  const catEmoji={
    'Dairy':'🧀','Produce':'🥦','Protein':'🥩','Seafood':'🐟',
    'Dry Goods':'🌾','Oil & Vinegar':'🫒','Spices':'🌶️','Spices & Condiments':'🌶️',
    'Beverage':'🥤','Bakery':'🥖','Frozen':'🧊','Fees':'💸','Other':'📦'
  };
  const emoji=catEmoji[ingr.category]||'📦';

  // ── VENDOR ROWS ──
  const vendorRows=vendorsSorted.length?vendorsSorted.map((v,idx)=>{
    const isLowest=idx===0&&v._p100!=null;
    const p100=v._p100;
    // Prezzo contestualizzato
    const packStr=v.pack_description?` ${v.pack_description}`:v.purchase_unit?` / ${v.purchase_unit}`:'';
    const unitLine=v.unit_price?`$${v.unit_price.toFixed(2)}${packStr}`:'—';
    const p100Line=p100?`$${p100.toFixed(2)}/100g`:`<span style="color:#f59e0b;font-size:10px;">${missingPriceReason(v)}</span>`;
    const lastDate=v.last_invoice_date?new Date(v.last_invoice_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${isLowest?'rgba(16,185,129,0.06)':'rgba(59,130,246,0.03)'};border-radius:12px;border:1px solid ${isLowest?'rgba(16,185,129,0.2)':'#f1f5f9'};margin-bottom:6px;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="font-size:13px;font-weight:500;color:#1e293b;">${v.vendor}</div>
          ${isLowest?'<span style="font-size:9px;font-weight:700;color:#10b981;background:rgba(16,185,129,0.1);padding:1px 6px;border-radius:20px;">BEST</span>':''}
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${unitLine}${lastDate?' · '+lastDate:''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <div style="font-size:13px;font-weight:600;color:${isLowest?'#10b981':'#1e293b'};">${p100Line}</div>
        ${isAdmin()?`<button onclick="openEditVendorRow('${v.id}','${ingredientId}')" style="font-size:11px;color:#6b7280;background:#f1f5f9;border:none;padding:3px 8px;border-radius:6px;cursor:pointer;">Edit</button>`:''}
      </div>
    </div>`;
  }).join(''):'<div style="font-size:12px;color:#94a3b8;padding:8px 0;">No vendor data yet — import an invoice to populate</div>';

  // ── PRICE HISTORY ROWS ──
  const historyRows=priceHistory?.length?priceHistory.slice(0,6).map(h=>{
    const d=h.invoice_date?new Date(h.invoice_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):'—';
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid #f1f5f9;">
      <div>
        <div style="font-size:12px;color:#1e293b;">${h.vendor}</div>
        <div style="font-size:10px;color:#94a3b8;">${d}${h.purchase_unit?' · '+h.purchase_unit:''}${h.pack_description?' · '+h.pack_description:''}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;font-weight:500;color:#1e293b;">$${(h.cost_per_100g||0).toFixed(2)}/100g</div>
        <div style="font-size:10px;color:#94a3b8;">$${(h.unit_price||0).toFixed(2)}</div>
      </div>
    </div>`;
  }).join(''):'<div style="font-size:12px;color:#94a3b8;padding:8px 0;">No invoice history yet</div>';

  // ── RECIPE ROWS ──
  const recipeRows=usedIn.length?usedIn.map(r=>`
    <div onclick="openRecipeFromCard(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border-radius:10px;margin-bottom:5px;cursor:pointer;">
      <div style="font-size:16px;">${r.category?.includes('Pasta')?'🍝':r.category?.includes('Meat')?'🥩':r.category?.includes('Fish')?'🐟':'🍽️'}</div>
      <div>
        <div style="font-size:13px;font-weight:500;color:#1e293b;">${r.title}</div>
        ${r.category?`<div style="font-size:10px;color:#94a3b8;">${r.category}</div>`:''}
      </div>
    </div>`).join('')
    :'<div style="font-size:12px;color:#94a3b8;padding:4px 0;">Not used in any recipe yet</div>';

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] flex flex-col';
  modal.style.cssText='background:white;overflow-y:auto;';
  modal.innerHTML=`
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

      <!-- STATS -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
        <div style="background:#f8fafc;border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#1e293b;">${bestPer100g?'$'+bestPer100g.toFixed(2):'—'}</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Best /100g</div>
        </div>
        <div style="background:#f8fafc;border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#1e293b;">${vendorsSorted.length||0}</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Vendors</div>
        </div>
        <div style="background:#f8fafc;border-radius:12px;padding:10px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:${priceTrend?priceTrend.color:'#1e293b'};">${priceTrend?priceTrend.dir+priceTrend.pct+'%':'—'}</div>
          <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Price trend</div>
        </div>
      </div>

      <!-- VENDORS -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Vendors & Prices</div>
        ${vendorRows}
        ${isAdmin()?`<button onclick="openAddVendorRow('${ingredientId}')" style="font-size:12px;color:#3B82F6;background:none;border:none;padding:4px 0;cursor:pointer;">+ Add vendor</button>`:''}
      </div>

      <!-- PRICE HISTORY -->
      ${priceHistory?.length?`
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Invoice History</div>
        ${historyRows}
      </div>`:''}

      <!-- RECIPES -->
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Used in ${usedIn.length} Recipe${usedIn.length!==1?'s':''}</div>
        ${recipeRows}
      </div>

      ${ingr.notes?`
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Notes</div>
        <div style="font-size:13px;color:#475569;background:#f8fafc;border-radius:10px;padding:10px 12px;line-height:1.5;">${ingr.notes}</div>
      </div>`:''}

      ${ingr.avg_unit_weight_g?`
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Unit Info</div>
        <div style="font-size:13px;color:#475569;background:#f8fafc;border-radius:10px;padding:10px 12px;">
          Avg unit weight: <strong>${ingr.avg_unit_weight_g}g</strong>
          ${ingr.unit_volume_ml?` · Volume: <strong>${ingr.unit_volume_ml}ml</strong>`:''}
        </div>
      </div>`:''}
    </div>`;

  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
};

// ── EDIT INGREDIENTE — solo campi master ──────────────────────
window.openEditIngredient=async function(ingredientId){
  const {data:ingr}=await supa.from('ingredients').select('*').eq('id',ingredientId).single();
  if(!ingr) return;
  const categories=['Dairy','Produce','Protein','Seafood','Dry Goods','Spices','Spices & Condiments','Oil & Vinegar','Bakery','Frozen','Beverage','Fees','Other'];
  const units=['g','kg','ml','l','lb','oz','each'];
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
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
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
};

window.saveEditIngredient=async function(ingredientId,btn){
  btn.textContent='Saving...'; btn.disabled=true;
  const updates={
    name:      document.getElementById('editIngrName')?.value?.trim(),
    category:  document.getElementById('editIngrCat')?.value||null,
    base_unit: document.getElementById('editIngrUnit')?.value||'g',
    notes:     document.getElementById('editIngrNotes')?.value||null,
  };
  const w=parseFloat(document.getElementById('editIngrWeight')?.value);
  const v=parseFloat(document.getElementById('editIngrVol')?.value);
  if(w) updates.avg_unit_weight_g=w;
  if(v) updates.unit_volume_ml=v;
  const {error}=await supa.from('ingredients').update(updates).eq('id',ingredientId);
  if(error){btn.textContent='Error';btn.disabled=false;return;}
  btn.closest('.fixed').remove();
  document.querySelector('.fixed.inset-0')?.remove();
  openIngredientCard(ingredientId);
};

// ── EDIT VENDOR ROW — campi ingredient_vendors ────────────────
window.openEditVendorRow=async function(vendorId,ingredientId){
  const {data:v}=await supa.from('ingredient_vendors').select('*').eq('id',vendorId).single();
  if(!v) return;
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[80] flex items-end';
  modal.style.background='rgba(0,0,0,0.4)';
  modal.innerHTML=`
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e293b;margin-bottom:4px;">✏️ Edit Vendor</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">These fields affect price_per_100g calculation and food cost</div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">VENDOR NAME</label>
        <input id="evVendor" value="${v.vendor||''}" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">UNIT PRICE ($)</label>
          <input id="evUnitPrice" type="number" step="0.01" value="${v.unit_price||''}" placeholder="e.g. 24.96" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PURCHASE UNIT</label>
          <input id="evPurchaseUnit" value="${v.purchase_unit||''}" placeholder="lb, cs, each, bag" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PACK DESCRIPTION</label>
          <input id="evPackDesc" value="${v.pack_description||''}" placeholder="5# bag, 2/5lb" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">TOTAL WEIGHT (g)</label>
          <input id="evTotalG" type="number" value="${v.total_weight_g||''}" placeholder="e.g. 2268" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">CONVERSION TO BASE (g per purchase unit)</label>
        <input id="evConversion" type="number" value="${v.conversion_to_base||''}" placeholder="e.g. 2268 for 5lb bag" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        <div style="font-size:10px;color:#94a3b8;margin-top:4px;">If set, overrides purchase_unit conversion. Leave blank to auto-calculate.</div>
      </div>

      <div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="evActive" ${v.active!==false?'checked':''} style="width:16px;height:16px;">
        <label for="evActive" style="font-size:13px;color:#1e293b;">Active (show in price comparison)</label>
      </div>

      <div id="evCalcPreview" style="background:#f0fdf4;border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#166534;"></div>

      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:#f1f5f9;color:#6b7280;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveEditVendorRow('${vendorId}','${ingredientId}',this)" style="height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Save & Recalculate</button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);

  // Live preview del calcolo
  function updatePreview(){
    const up=parseFloat(document.getElementById('evUnitPrice')?.value)||0;
    const pu=document.getElementById('evPurchaseUnit')?.value||'';
    const tg=parseFloat(document.getElementById('evTotalG')?.value)||0;
    const conv=parseFloat(document.getElementById('evConversion')?.value)||0;
    const base=conv||tg||convertToBase(1,pu)||0;
    const preview=document.getElementById('evCalcPreview');
    if(up&&base){
      preview.textContent=`→ $${((up/base)*100).toFixed(2)}/100g`;
      preview.style.background='#f0fdf4';preview.style.color='#166534';
    } else {
      preview.textContent='→ Cannot calculate — fill Unit Price + Total Weight or Purchase Unit';
      preview.style.background='#fff7ed';preview.style.color='#92400e';
    }
  }
  ['evUnitPrice','evPurchaseUnit','evTotalG','evConversion'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',updatePreview);
  });
  updatePreview();
};

window.saveEditVendorRow=async function(vendorId,ingredientId,btn){
  btn.textContent='Saving...'; btn.disabled=true;
  const up=parseFloat(document.getElementById('evUnitPrice')?.value)||null;
  const pu=document.getElementById('evPurchaseUnit')?.value?.trim()||null;
  const tg=parseFloat(document.getElementById('evTotalG')?.value)||null;
  const conv=parseFloat(document.getElementById('evConversion')?.value)||null;
  const active=document.getElementById('evActive')?.checked!==false;

  // Ricalcola price_per_100g
  const base=conv||tg||convertToBase(1,pu)||null;
  const p100=up&&base?parseFloat(((up/base)*100).toFixed(4)):null;

  const updates={
    vendor:           document.getElementById('evVendor')?.value?.trim()||null,
    unit_price:       up,
    purchase_unit:    pu,
    pack_description: document.getElementById('evPackDesc')?.value?.trim()||null,
    total_weight_g:   tg,
    conversion_to_base: conv,
    price_per_100g:   p100,
    active,
    updated_at:       new Date().toISOString(),
  };

  const {error}=await supa.from('ingredient_vendors').update(updates).eq('id',vendorId);
  if(error){btn.textContent='Error: '+error.message;btn.disabled=false;return;}
  btn.closest('.fixed').remove();
  // Chiudi e riapri la scheda aggiornata
  document.querySelectorAll('.fixed.inset-0').forEach(m=>m.remove());
  openIngredientCard(ingredientId);
};

// ── ADD VENDOR ROW ────────────────────────────────────────────
window.openAddVendorRow=function(ingredientId){
  // Riusa openEditVendorRow con un record vuoto temporaneo
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[80] flex items-end';
  modal.style.background='rgba(0,0,0,0.4)';
  modal.innerHTML=`
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e293b;margin-bottom:16px;">➕ Add Vendor</div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">VENDOR NAME</label>
        <input id="avVendor" placeholder="e.g. Fruge Seafood" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">UNIT PRICE ($)</label>
          <input id="avUnitPrice" type="number" step="0.01" placeholder="e.g. 24.96" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PURCHASE UNIT</label>
          <input id="avPurchaseUnit" placeholder="lb, cs, each" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PACK DESCRIPTION</label>
          <input id="avPackDesc" placeholder="5# bag, 2/5lb" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">TOTAL WEIGHT (g)</label>
          <input id="avTotalG" type="number" placeholder="e.g. 2268" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>
      <div id="avCalcPreview" style="background:#fff7ed;border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#92400e;">Fill Unit Price + Total Weight to preview calculation</div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:#f1f5f9;color:#6b7280;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveNewVendorRow('${ingredientId}',this)" style="height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Add Vendor</button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
  function updatePreview(){
    const up=parseFloat(document.getElementById('avUnitPrice')?.value)||0;
    const pu=document.getElementById('avPurchaseUnit')?.value||'';
    const tg=parseFloat(document.getElementById('avTotalG')?.value)||0;
    const base=tg||convertToBase(1,pu)||0;
    const el=document.getElementById('avCalcPreview');
    if(up&&base){el.textContent=`→ $${((up/base)*100).toFixed(2)}/100g`;el.style.background='#f0fdf4';el.style.color='#166534';}
    else{el.textContent='Fill Unit Price + Total Weight to preview calculation';el.style.background='#fff7ed';el.style.color='#92400e';}
  }
  ['avUnitPrice','avPurchaseUnit','avTotalG'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',updatePreview);
  });
};

window.saveNewVendorRow=async function(ingredientId,btn){
  btn.textContent='Saving...'; btn.disabled=true;
  const up=parseFloat(document.getElementById('avUnitPrice')?.value)||null;
  const pu=document.getElementById('avPurchaseUnit')?.value?.trim()||null;
  const tg=parseFloat(document.getElementById('avTotalG')?.value)||null;
  const base=tg||convertToBase(1,pu)||null;
  const p100=up&&base?parseFloat(((up/base)*100).toFixed(4)):null;
  const {error}=await supa.from('ingredient_vendors').insert({
    ingredient_id: ingredientId,
    vendor:        document.getElementById('avVendor')?.value?.trim()||null,
    unit_price:    up,
    purchase_unit: pu,
    pack_description: document.getElementById('avPackDesc')?.value?.trim()||null,
    total_weight_g: tg,
    price_per_100g: p100,
    active: true,
  });
  if(error){btn.textContent='Error: '+error.message;btn.disabled=false;return;}
  btn.closest('.fixed').remove();
  document.querySelectorAll('.fixed.inset-0').forEach(m=>m.remove());
  openIngredientCard(ingredientId);
};

// ── AGGIUNGI INGREDIENTE ──────────────────────────────────────
function openAddIngredient(prefillName=''){
  const categories=['Dairy','Produce','Protein','Seafood','Dry Goods','Spices','Oil & Vinegar','Bakery','Frozen','Beverage','Other'];
  const units=['g','kg','ml','l','lb','oz','each'];
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e293b;margin-bottom:16px;">➕ New Ingredient</div>
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">NAME *</label>
        <input id="newIngrName" value="${prefillName}" placeholder="e.g. Burrata" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">CATEGORY</label>
          <select id="newIngrCat" style="width:100%;padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
            ${categories.map(c=>`<option>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">BASE UNIT</label>
          <select id="newIngrUnit" style="width:100%;padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
            ${units.map(u=>`<option ${u==='g'?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">NOTES</label>
        <textarea id="newIngrNotes" placeholder="Chef notes..." rows="2" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;resize:none;box-sizing:border-box;"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:#f1f5f9;color:#6b7280;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveNewIngredient()" style="height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Save Ingredient</button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
}

window.saveNewIngredient=async()=>{
  const name=document.getElementById('newIngrName')?.value?.trim();
  if(!name){alert('Name required');return;}
  const {data,error}=await supa.from('ingredients').insert({
    name,
    category: document.getElementById('newIngrCat')?.value||null,
    base_unit: document.getElementById('newIngrUnit')?.value||'g',
    notes: document.getElementById('newIngrNotes')?.value||null
  }).select().single();
  if(error){alert('Error: '+error.message);return;}
  document.querySelector('.fixed')?.remove();
  showScToast(`✓ ${name} added`);
  if(data) openIngredientCard(data.id);
};

// ── APRI RICETTA DA SCHEDA INGREDIENTE ───────────────────────
window.openRecipeFromCard=function(rec){
  if(typeof showRecipeSheet==='function'){
    showRecipeSheet(rec);
    setTimeout(()=>{
      document.querySelectorAll('.fixed.inset-0').forEach(s=>{
        if(s.classList.contains('z-50')||s.style.zIndex==='50') s.style.zIndex='80';
      });
    },10);
  }
};
