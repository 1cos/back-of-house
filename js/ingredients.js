// ── INGREDIENTS — BOH OS ─────────────────────────────────────
// Schema reale da Supabase — nessuna colonna inventata

// ── CONVERSIONI LOCALI ────────────────────────────────────────
const UNIT_CONVERSIONS = {
  'lb':453.592,'oz':28.3495,'kg':1000,'g':1,
  'gal':3785.41,'qt':946.353,'pt':473.176,'fl_oz':29.5735,'l':1000,'ml':1,
  'cup':236.588,'tbsp':14.7868,'tsp':4.92892,
};
// ── INGREDIENT-SPECIFIC EMOJI ────────────────────────────────
// Name-based, same logic used in vendor-documents-review.js.
// Falls back to category emoji if no name match.
function ingrEmoji(name, category){
  const n = (name||'').toUpperCase();

  // ── Frutta & Verdura ──────────────────────────────────────
  if(/AVOCADO/.test(n))              return '🥑';
  if(/LEMON/.test(n))                return '🍋';
  if(/LIME/.test(n))                 return '🍋';
  if(/TOMATO/.test(n))               return '🍅';
  if(/WATERMELON/.test(n))           return '🍉';
  if(/STRAWBERR/.test(n))            return '🍓';
  if(/RASPBERR/.test(n))             return '🫐';
  if(/BLUEBERR/.test(n))             return '🫐';
  if(/BLACKBERR/.test(n))            return '🫐';
  if(/BERRY|BERRIES/.test(n))        return '🫐';
  if(/GRAPE/.test(n))                return '🍇';
  if(/APPLE/.test(n))                return '🍎';
  if(/PEAR/.test(n))                 return '🍐';
  if(/ORANGE|MANDARIN/.test(n))      return '🍊';
  if(/PEACH|NECTARINE/.test(n))      return '🍑';
  if(/CHERRY/.test(n))               return '🍒';
  if(/MANGO/.test(n))                return '🥭';
  if(/PINEAPPLE/.test(n))            return '🍍';
  if(/COCONUT/.test(n))              return '🥥';
  if(/BANANA/.test(n))               return '🍌';
  if(/FIG/.test(n))                  return '🫐';
  if(/POMEGRANATE/.test(n))          return '🍎';
  if(/MUSHROOM/.test(n))             return '🍄';
  if(/ARUGULA|LETTUCE|ROMAINE/.test(n)) return '🥬';
  if(/SPINACH/.test(n))              return '🥬';
  if(/ENDIVE|RADICCHIO/.test(n))     return '🥬';
  if(/KALE/.test(n))                 return '🥬';
  if(/ASPARAGUS/.test(n))            return '🫛';
  if(/BRUSSEL/.test(n))              return '🥦';
  if(/BROCCOLI/.test(n))             return '🥦';
  if(/ARTICHOKE/.test(n))            return '🫛';
  if(/ZUCCHINI|COURGETTE/.test(n))   return '🥒';
  if(/CUCUMBER/.test(n))             return '🥒';
  if(/EGGPLANT|AUBERGINE/.test(n))   return '🍆';
  if(/PEPPER/.test(n))               return '🫑';
  if(/CORN/.test(n))                 return '🌽';
  if(/ONION/.test(n))                return '🧅';
  if(/GARLIC/.test(n))               return '🧄';
  if(/CARROT|SHREDDED CARROT/.test(n)) return '🥕';
  if(/POTATO|GNOCCHI/.test(n))       return '🥔';
  if(/BEET/.test(n))                 return '🫚';
  if(/FENNEL/.test(n))               return '🌿';
  if(/CELERY/.test(n))               return '🌿';
  if(/LEEK/.test(n))                 return '🌿';
  if(/HERB|BASIL|ROSEMARY|THYME|SAGE|MINT|PARSLEY|CHIVE/.test(n)) return '🌿';
  if(/TRUFFLE/.test(n))              return '🍄';
  if(/CAPERS/.test(n))               return '🫙';

  // ── Uova & Latticini ──────────────────────────────────────
  if(/EGG/.test(n))                  return '🥚';
  if(/BURRATA/.test(n))              return '🧀';
  if(/MOZZARELLA|MOZZ/.test(n))      return '🧀';
  if(/PARMESAN|PARMIGIANO|PECORINO|GORGONZOLA|RICOTTA|MASCARPONE/.test(n)) return '🧀';
  if(/CHEESE|CHZ/.test(n))           return '🧀';
  if(/BUTTER/.test(n))               return '🧈';
  if(/MILK|CREAM|LATTE/.test(n))     return '🥛';
  if(/YOGURT/.test(n))               return '🥛';

  // ── Carne ─────────────────────────────────────────────────
  if(/BEEF|RIB|STEAK|TENDERLOIN|FILET|TOMAHAK|BRISKET|VEAL|VITELLO/.test(n)) return '🥩';
  if(/LAMB|AGNELLO/.test(n))         return '🍖';
  if(/CHICKEN|POULTRY/.test(n))      return '🍗';
  if(/PORK|BACON|PANCETTA|GUANCIALE|LARD/.test(n)) return '🥓';
  if(/HAM|PROSCIUTTO|SALAMI|SALAME|MORTADELLA|BRESAOLA|COPPA/.test(n)) return '🍖';
  if(/MEATBALL|SAUSAGE|GROUND BEEF|PULLED/.test(n)) return '🍖';

  // ── Pesce & Frutti di mare ────────────────────────────────
  if(/SALMON|SALMONE/.test(n))       return '🐟';
  if(/TUNA|TONNO/.test(n))           return '🐟';
  if(/BRANZINO|SEABASS|SEA BASS|ORATA|SEABREAM/.test(n)) return '🐟';
  if(/HALIBUT|COD|BACCALA|SOLE|TROUT/.test(n)) return '🐟';
  if(/ANCHOV/.test(n))               return '🐟';
  if(/SHRIMP|PRAWN|GAMBERI/.test(n)) return '🍤';
  if(/LOBSTER|ARAGOSTA/.test(n))     return '🦞';
  if(/CRAB|GRANCHIO/.test(n))        return '🦀';
  if(/SCALLOP|CAPASANTA/.test(n))    return '🐚';
  if(/CLAM|VONGOLE|MUSSEL|COZZE/.test(n)) return '🐚';
  if(/OYSTER|OSTRICA/.test(n))       return '🦪';
  if(/SQUID|CALAMARI|CUTTLEFISH|SEPPIA/.test(n)) return '🦑';
  if(/OCTOPUS|POLPO/.test(n))        return '🐙';

  // ── Pasta, Pane, Cereali ──────────────────────────────────
  if(/SPAGHETTI|LINGUINE|TAGLIATELLE|PAPPARDELLE|BUCATINI/.test(n)) return '🍝';
  if(/PASTA|PENNE|RIGATONI|FARFALLE|FUSILLI|ORECCHIETTE|GNOCCHI/.test(n)) return '🍝';
  if(/RAVIOLI|TORTELLINI|LASAGNA|CANNELLONI/.test(n)) return '🍝';
  if(/RICE|RISO|RISOTTO|CARNAROLI|ARBORIO/.test(n)) return '🍚';
  if(/BREAD|PANE|SOURDOUGH|FOCACCIA|CIABATTA|BAGUETTE/.test(n)) return '🍞';
  if(/BREADCRUMB|PANGRATTATO/.test(n)) return '🍞';
  if(/PIZZA|DOUGH/.test(n))          return '🍕';
  if(/FLOUR|FARINA/.test(n))         return '🌾';
  if(/CRACKER|TARALLI|GRISSINI/.test(n)) return '🥨';
  if(/CROISSANT|BRIOCHE/.test(n))    return '🥐';
  if(/POLENTA/.test(n))              return '🌽';

  // ── Salse & Preparazioni ──────────────────────────────────
  if(/SAUCE|RAGÙ|BOLOGNESE|ARRABBIATA|LIVORNESE/.test(n)) return '🫕';
  if(/PESTO/.test(n))                return '🌿';
  if(/DEMI|STOCK|BROTH|BRODO/.test(n)) return '🍲';
  if(/BECHAMEL|BESCIAME/.test(n))    return '🥛';
  if(/MAYO|AIOLI|BERNESE/.test(n))   return '🫙';
  if(/DRESSING|VINAIGRETTE|CITRONETTE/.test(n)) return '🥗';
  if(/CONFIT/.test(n))               return '🍳';
  if(/CREAM SAUCE|PINK SAUCE/.test(n)) return '🫕';

  // ── Olio, Aceto, Condimenti ───────────────────────────────
  if(/OLIVE OIL|OIL/.test(n))        return '🫒';
  if(/VINEGAR|ACETO/.test(n))        return '🫙';
  if(/SALT|SALE/.test(n))            return '🧂';
  if(/PEPPER|PEPE/.test(n))          return '🌶️';
  if(/SPICE|SEASONING|PAPRIKA|CUMIN|OREGANO/.test(n)) return '🌶️';
  if(/JUNIPER/.test(n))              return '🫐';
  if(/CAPER/.test(n))                return '🫙';
  if(/MUSTARD/.test(n))              return '🫙';
  if(/SOY SAUCE|WORCESTER/.test(n))  return '🫙';

  // ── Dolci & Dessert ───────────────────────────────────────
  if(/SUGAR|ZUCCHERO|MUSCOVADO/.test(n)) return '🍬';
  if(/HONEY|MIELE/.test(n))          return '🍯';
  if(/CHOCOLATE|CIOCCOLATO|COCOA/.test(n)) return '🍫';
  if(/NUTELLA/.test(n))              return '🍫';
  if(/VANILLA/.test(n))              return '🌿';
  if(/CARAMEL/.test(n))              return '🍮';
  if(/BROWNIE|CAKE|TORTA/.test(n))   return '🎂';
  if(/CREAM PUFF|PROFITEROLE/.test(n)) return '🍮';
  if(/TIRAMISU/.test(n))             return '☕';
  if(/GELATO|ICE CREAM/.test(n))     return '🍨';
  if(/SABLE|SHORTBREAD|COOKIE/.test(n)) return '🍪';
  if(/PISTACHIO|PISTACCHIO/.test(n)) return '🫘';
  if(/ALMOND|MANDORLE/.test(n))      return '🫘';
  if(/WALNUT|NOCE/.test(n))          return '🫘';
  if(/HAZELNUT|NOCCIOLA/.test(n))    return '🫘';
  if(/NUT|FRUIT MIX|BERRY MIX/.test(n)) return '🫘';

  // ── Bevande ───────────────────────────────────────────────
  if(/WINE|VINO/.test(n))            return '🍷';
  if(/BEER|BIRRA/.test(n))           return '🍺';
  if(/WATER|ACQUA|SPARKLING/.test(n)) return '💧';
  if(/COFFEE|CAFFE|ESPRESSO/.test(n)) return '☕';
  if(/JUICE|SUCCO/.test(n))          return '🥤';
  if(/LIQUEUR|LIQUORE|BRANDY|RUM|WHISKEY|GIN/.test(n)) return '🥃';

  // ── Forniture ─────────────────────────────────────────────
  if(/BAG|WRAP|FILM|VACUUM/.test(n)) return '🛍️';
  if(/BOX|CONTAINER|CUP|LID/.test(n)) return '📦';
  if(/GLOVE|TOWEL/.test(n))          return '🧤';
  if(/SKEWER/.test(n))               return '🍢';
  if(/PAN|TRAY/.test(n))             return '🍳';
  if(/CO2|GAS|BUTANE/.test(n))       return '🔵';
  if(/SPRAY/.test(n))                return '💨';

  // ── Category fallback ─────────────────────────────────────
  const cat = {
    'Dairy':'🧀','Produce':'🥦','Protein':'🥩','Seafood':'🐟',
    'Dry Goods':'🌾','Oil & Vinegar':'🫒','Spices & Condiments':'🌶️',
    'Beverage':'🥤','Supply':'📦','Fees':'💸','Other':'📦'
  };
  return cat[category]||'📦';
}

function convertToBase(qty, unit){
  const f = UNIT_CONVERSIONS[(unit||'').toLowerCase()];
  return f ? qty * f : null;
}

// ── PARSE PACK DESCRIPTION → TOTAL GRAMS ────────────────────
// Handles: 4#  25#  11/1#  4X5LB  2/5LB  8/12OZ  10LB  28LB
// '#' means lb. Returns total grams or null.
function parsePackDescG(str){
  if(!str) return null;
  // uppercase first, THEN replace X so it stays lowercase for regex matching
  const s = String(str).trim()
    .toUpperCase()
    .replace(/#/g,'LB')                  // # → LB
    .replace(/\s*\/\s*/g,'/')            // normalise slashes
    .replace(/\s*X\s*/g,'x');            // normalise X multiplier → lowercase x
  const UC = UNIT_CONVERSIONS;
  let m;
  // count x size unit  e.g. "4X5LB", "2x5 LB"
  m = s.match(/^(\d+)x([\d.]+)\s*([A-Z]+)/);
  if(m){ const f=UC[m[3].toLowerCase()]; if(f) return parseFloat(m[1])*parseFloat(m[2])*f; }
  // count/size unit  e.g. "2/5LB", "8/12OZ", "11/1LB"
  m = s.match(/^(\d+)\/([\d.]+)\s*([A-Z]+)/);
  if(m){ const f=UC[m[3].toLowerCase()]; if(f) return parseFloat(m[1])*parseFloat(m[2])*f; }
  // size unit  e.g. "10LB", "28 LB", "4LB"
  m = s.match(/^([\d.]+)\s*([A-Z]+)$/);
  if(m){ const f=UC[m[2].toLowerCase()]; if(f) return parseFloat(m[1])*f; }
  return null;
}

// ── CALCOLA PESO BASE IN GRAMMI DA CAMPI VENDOR ─────────────
// Unica fonte di verità — usata da calcVendorPrice100g,
// saveEditVendorRow, saveNewVendorRow e tutti i live preview.
//
// Priorità:
//  1. pack_size (numeric) × pack_unit          e.g. 11 lb  → 4989 g
//  2. pack_description parsed                  e.g. "4#"   → 1814 g
//  3. conversion_to_base  (già in grammi)
//  4. last_total_weight_g (già in grammi)
//  5. unit_weight_g       (già in grammi)
//  6. purchase_unit da solo                   e.g. 'lb'   → 453 g
function calcBaseWeightG(v){
  // Priority: conversion_to_base > pack_description parse
  if(v.conversion_to_base && parseFloat(v.conversion_to_base) > 0)
    return parseFloat(v.conversion_to_base);
  return parsePackDescG(v.pack_description) || null;
}

// ── CALCOLA price_per_100g DA CAMPI VENDOR ───────────────────
// IMPORTANT: always recalculates from pack_size+pack_unit first.
// The stored price_per_100g may be stale (written before pack_size
// was available) — we only fall back to it if we cannot compute.
function calcVendorPrice100g(v){
  const up = parseFloat(v.unit_price);
  if(!up) return null;

  // Se price_type è per unità di peso, converti prima in prezzo per cassa
  // poi calcola $/100g come sempre
  const pt = v.price_type || 'per_case';
  const base = calcBaseWeightG(v);

  if(pt === 'per_lb') {
    // unit_price è $/lb — moltiplica per grammi totali della cassa / 453.592
    // $/100g = ($/lb) / 453.592 * 100
    return (up / 453.592) * 100;
  }
  if(pt === 'per_kg') {
    return (up / 1000) * 100;
  }
  if(pt === 'per_oz') {
    return (up / 28.3495) * 100;
  }
  if(pt === 'per_each' && v.price_per_each) {
    return null; // per_each usa price_per_each, non price_per_100g
  }

  // per_case (default): prezzo per cassa intera
  if(base) return (up / base) * 100;
  return v.price_per_100g || null;
}

// ── MOTIVO MANCANZA price_per_100g ───────────────────────────
function missingPriceReason(v){
  if(!v.unit_price)           return 'Missing unit_price';
  if(!v.conversion_to_base && !parsePackDescG(v.pack_description))
                              return 'Missing conversion_to_base';
  return 'Needs review';
}

// ── CERCA INGREDIENTE PER NOME ────────────────────────────────
async function searchIngredient(name){
  const {data} = await supa.from('ingredients')
    .select('id,name,category,base_unit,measure_type,notes,active')
    .ilike('name', `%${name}%`).eq('active',true).limit(10);
  return data||[];
}

// ── CALCOLA COSTO (Chef AI) ───────────────────────────────────
async function calculateIngredientCost(ingredientName, qty, unit){
  const ingrs = await searchIngredient(ingredientName);
  if(!ingrs.length) return null;
  const ingr = ingrs[0];
  const {data:vendors} = await supa.from('ingredient_vendors')
    .select('vendor,unit_price,price_per_100g,price_type,pack_description,conversion_to_base')
    .eq('ingredient_id', ingr.id).eq('active',true);
  if(!vendors?.length) return {ingredient:ingr.name, error:'No price data'};
  const baseQty = convertToBase(qty, unit);
  const results = vendors.map(v=>{
    const p100 = calcVendorPrice100g(v);
    if(!p100||!baseQty) return null;
    return {vendor:v.vendor, cost_for_qty:(p100/100)*baseQty, price_per_100g:p100};
  }).filter(Boolean);
  return {ingredient:ingr.name, qty, unit, results, best:results[0]||null};
}

// ── TAB INGREDIENTS ───────────────────────────────────────────
let allIngredients = [];
let activeCategory = 'all';

async function loadIngredientsTab(){
  const list = document.getElementById('ingrTabList');
  if(!list) return;
  list.innerHTML = '<div class="text-sm text-slate-400 text-center py-8">Loading...</div>';

  const [{data:ingrs}, {data:vendors}] = await Promise.all([
    supa.from('ingredients')
      .select('id,name,category,base_unit,measure_type,active')
      .eq('active',true).order('name'),
    supa.from('ingredient_vendors')
      .select('ingredient_id,vendor,vendor_sku,unit_price,price_type,pack_description,price_per_100g,price_per_each,conversion_to_base,active')
      .eq('active',true)
  ]);

  allIngredients = ingrs||[];

  // Best price per ingredient — lowest price_per_100g (calculated)
  const priceMap = {};
  (vendors||[]).forEach(v=>{
    const p100 = calcVendorPrice100g(v);
    if(!priceMap[v.ingredient_id] || (p100 && p100 < (priceMap[v.ingredient_id]._p100||Infinity))){
      priceMap[v.ingredient_id] = {...v, _p100: p100};
    }
  });
  window._ingrPriceMap = priceMap;
  renderIngredientsTab(allIngredients, priceMap);
}

function renderIngredientsTab(ingrs, priceMap){
  const list = document.getElementById('ingrTabList');
  if(!list) return;

  const filtered = ingrs.filter(i=>{
    const matchCat = activeCategory==='all' || i.category===activeCategory;
    const q = (document.getElementById('ingrSearchMain')?.value||'').toLowerCase();
    return matchCat && (!q || i.name.toLowerCase().includes(q));
  });

  if(!filtered.length){
    list.innerHTML = '<div class="text-sm text-slate-400 text-center py-8">No ingredients found</div>';
    return;
  }

  list.innerHTML = filtered.map(i=>{
    const bp = (priceMap||window._ingrPriceMap||{})[i.id];
    const emoji = ingrEmoji(i.name, i.category);
    let priceHtml = '<div style="font-size:11px;color:#cbd5e1;">no price</div>';
    if(bp){
      const p100 = bp._p100;
      const packStr = bp.pack_description || '';
      if(p100){
        priceHtml = `
          <div style="font-size:13px;font-weight:600;color:#1e293b;">$${(bp.unit_price||0).toFixed(2)}${packStr?' / '+packStr:''}</div>
          <div style="font-size:10px;color:#10b981;font-weight:500;">$${p100.toFixed(2)}/100g</div>`;
      } else {
        priceHtml = `<div style="font-size:11px;color:#f59e0b;">${missingPriceReason(bp)}</div>`;
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
      <div style="text-align:right;flex-shrink:0;">${priceHtml}</div>
    </div>`;
  }).join('');
}

window.filterIngredientsTab = () => renderIngredientsTab(allIngredients, window._ingrPriceMap);
window.filterIngrCategory = (cat, btn)=>{
  activeCategory = cat;
  document.querySelectorAll('#ingrCategoryFilter button').forEach(b=>{
    b.className = 'px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 whitespace-nowrap';
  });
  btn.className = 'px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-white whitespace-nowrap';
  renderIngredientsTab(allIngredients, window._ingrPriceMap);
};

// ── SCHEDA INGREDIENTE ────────────────────────────────────────
window.openIngredientCard = async function(ingredientId){
  const [
    {data:ingr},
    {data:vendors},
    {data:recipes},
    {data:invoiceHistory}
  ] = await Promise.all([
    supa.from('ingredients')
      .select('id,name,category,base_unit,measure_type,notes,active,yield_factor')
      .eq('id', ingredientId).single(),
    supa.from('ingredient_vendors')
      .select('id,vendor,vendor_sku,pack_description,unit_price,price_type,conversion_to_base,price_per_100g,price_per_each,last_invoice_date,active')
      .eq('ingredient_id', ingredientId)
      .eq('active', true),
    supa.from('recipes').select('id,title,category,ingredients'),
    supa.from('invoice_lines')
      .select('vendor,invoice_date,qty,match_status')
      .eq('ingredient_id', ingredientId)
      .order('invoice_date',{ascending:false})
      .limit(12)
  ]);

  if(!ingr) return;

  // Sort vendors by price_per_100g (calculated)
  const vendorsSorted = (vendors||[]).map(v=>({...v, _p100: calcVendorPrice100g(v)}))
    .sort((a,b)=>{
      if(a._p100==null) return 1;
      if(b._p100==null) return -1;
      return a._p100 - b._p100;
    });

  const bestVendor = vendorsSorted[0];
  const bestPer100g = bestVendor?._p100;

  // Price trend from invoice_links history
  let priceTrend = null;
  const {data:linkHistory} = await supa.from('ingredient_links')
    .select('unit_price,last_invoice_date,vendor')
    .eq('ingredient_id', ingredientId)
    .not('unit_price','is',null)
    .order('last_invoice_date',{ascending:false})
    .limit(6);
  if(linkHistory?.length >= 2 && linkHistory[0].unit_price && linkHistory[1].unit_price){
    const diff = linkHistory[0].unit_price - linkHistory[1].unit_price;
    const pct = (diff / linkHistory[1].unit_price) * 100;
    priceTrend = {dir:diff>0?'↑':'↓', pct:Math.abs(pct).toFixed(1), color:diff>0?'#ef4444':'#10b981'};
  }

  // Recipes using this ingredient (fuzzy)
  const usedIn = (recipes||[]).filter(r=>
    (r.ingredients||[]).some(i=>
      i.name && ingr.name &&
      i.name.toLowerCase().includes(ingr.name.toLowerCase().split(' ')[0])
    )
  );

  const emoji = ingrEmoji(ingr.name, ingr.category);

  // ── VENDOR ROWS ──
  const vendorRows = vendorsSorted.length ? vendorsSorted.map((v,idx)=>{
    const isLowest = idx===0 && v._p100!=null;
    const p100 = v._p100;
    const packStr = v.pack_description || '';
    const unitLine = v.unit_price ? `$${v.unit_price.toFixed(2)}${packStr?' / '+packStr:''}` : '—';
    const p100Line = p100
      ? `<span style="font-size:13px;font-weight:600;color:${isLowest?'#10b981':'#1e293b'};">$${p100.toFixed(2)}/100g</span>`
      : `<span style="font-size:10px;color:#f59e0b;">${missingPriceReason(v)}</span>`;
    const lastDate = v.last_invoice_date
      ? new Date(v.last_invoice_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})
      : '';
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${isLowest?'rgba(16,185,129,0.06)':'rgba(59,130,246,0.03)'};border-radius:12px;border:1px solid ${isLowest?'rgba(16,185,129,0.2)':'#f1f5f9'};margin-bottom:6px;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:13px;font-weight:500;color:#1e293b;">${v.vendor}</span>
          ${isLowest?'<span style="font-size:9px;font-weight:700;color:#10b981;background:rgba(16,185,129,0.1);padding:1px 6px;border-radius:20px;">BEST</span>':''}
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${unitLine}${lastDate?' · Last: '+lastDate:''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        ${p100Line}
        ${isAdmin()?`<button onclick="openEditVendorRow('${v.id}','${ingredientId}')" style="font-size:11px;color:#6b7280;background:#f1f5f9;border:none;padding:3px 8px;border-radius:6px;cursor:pointer;">Edit</button>`:''}
      </div>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:#94a3b8;padding:8px 0;">No vendor data yet — import an invoice to populate</div>';

  // ── INVOICE HISTORY ROWS ──
  const historyRows = invoiceHistory?.length ? invoiceHistory.slice(0,6).map(h=>{
    const d = h.invoice_date ? new Date(h.invoice_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}) : '—';
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid #f1f5f9;">
      <div>
        <div style="font-size:12px;color:#1e293b;">${h.vendor}</div>
        <div style="font-size:10px;color:#94a3b8;">${d}${h.qty?' · qty '+h.qty:''}</div>
      </div>
      <div style="font-size:11px;color:#94a3b8;">${h.match_status||''}</div>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:#94a3b8;padding:8px 0;">No invoice history yet</div>';

  // ── RECIPE ROWS ──
  const recipeRows = usedIn.length ? usedIn.map(r=>`
    <div onclick="openRecipeFromCard(${JSON.stringify(r).replace(/"/g,'&quot;')})"
      style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border-radius:10px;margin-bottom:5px;cursor:pointer;">
      <div style="font-size:16px;">${r.category?.includes('Pasta')?'🍝':r.category?.includes('Meat')?'🥩':r.category?.includes('Fish')?'🐟':'🍽️'}</div>
      <div>
        <div style="font-size:13px;font-weight:500;color:#1e293b;">${r.title}</div>
        ${r.category?`<div style="font-size:10px;color:#94a3b8;">${r.category}</div>`:''}
      </div>
    </div>`).join('')
    : '<div style="font-size:12px;color:#94a3b8;padding:4px 0;">Not used in any recipe yet</div>';

  // Calcola offset top bar (top bar h-16=64px + newsBar se visibile)
  const _newsBar = document.getElementById('newsBar');
  const _topOffset = 64 + (_newsBar && !_newsBar.classList.contains('hidden') ? (_newsBar.offsetHeight||36) : 0);

  const modal = document.createElement('div');
  modal.className = 'fixed z-[60] flex flex-col';
  modal.style.cssText = 'background:white;overflow-y:auto;left:0;right:0;bottom:0;top:'+_topOffset+'px;';
  modal.innerHTML = `
    <div style="position:sticky;top:0;z-index:10;background:white;border-bottom:1px solid #f1f5f9;padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <button onclick="this.closest('.fixed').remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;font-size:16px;cursor:pointer;flex-shrink:0;">‹</button>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:600;color:#1e293b;">${emoji} ${ingr.name}</div>
          <div style="font-size:11px;color:#94a3b8;">${ingr.category||'Other'} · ${ingr.base_unit} · ${ingr.measure_type||'weight'}</div>
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
          <div style="font-size:18px;font-weight:700;color:#1e293b;">${vendorsSorted.length}</div>
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
        ${isAdmin()?`<button onclick="openAddVendorRow('${ingredientId}')" style="font-size:12px;color:#3B82F6;background:none;border:none;padding:4px 0;cursor:pointer;margin-top:4px;">+ Add vendor</button>`:''}
      </div>

      <!-- INVOICE HISTORY -->
      ${invoiceHistory?.length?`
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

      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Yield / Scarto</div>
        <div style="font-size:13px;color:#475569;background:#f8fafc;border-radius:10px;padding:10px 12px;">
          ${ingr.yield_factor && ingr.yield_factor < 1
            ? `<span style="font-weight:600;color:#f59e0b;">${Math.round(ingr.yield_factor*100)}% usabile</span> &nbsp;·&nbsp; scarto ${Math.round((1-ingr.yield_factor)*100)}%`
            : '<span style="color:#10b981;font-weight:600;">100% usabile</span> — nessuno scarto'}
        </div>
      </div>

      ${false?`
      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px;">Unit Info</div>
        <div style="font-size:13px;color:#475569;background:#f8fafc;border-radius:10px;padding:10px 12px;">
          
          
        </div>
      </div>`:''}

    </div>`;

  modal.onclick = e=>{ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
};

// ── EDIT INGREDIENTE — solo campi master ingredients ──────────
window.openEditIngredient = async function(ingredientId){
  const {data:ingr} = await supa.from('ingredients')
    .select('id,name,category,base_unit,measure_type,notes,yield_factor,avg_unit_weight_g')
    .eq('id',ingredientId).single();
  if(!ingr) return;

  // Riferimento vendor primario (sola lettura, solo per contesto — si edita dalla riga vendor)
  const {data:vendorRows} = await supa.from('ingredient_vendors')
    .select('vendor,purchase_unit,pack_description,unit_price,price_type')
    .eq('ingredient_id', ingredientId)
    .eq('active', true)
    .order('order_count', {ascending:false})
    .limit(1);
  const v = vendorRows && vendorRows[0];

  const categories = ['Dairy','Produce','Protein','Seafood','Dry Goods','Spices','Spices & Condiments','Oil & Vinegar','Bakery','Frozen','Beverage','Fees','Other'];

  const wg = ingr.avg_unit_weight_g;
  const currentWeightLine = wg != null
    ? `<div style="font-size:12px;color:#1d4ed8;margin-bottom:8px;">Salvato ora: ${wg}g · ${(wg/28.3495).toFixed(2)}oz · ${(wg/453.592).toFixed(3)}lb</div>`
    : `<div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">Non ancora impostato</div>`;

  const vendorLine = v
    ? `<div style="font-size:12px;color:#64748b;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;">${v.vendor} · ${v.pack_description||''} · $${parseFloat(v.unit_price).toFixed(2)}/${v.purchase_unit||'lb'}</div>`
    : `<div style="font-size:12px;color:#94a3b8;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;">Nessun fornitore collegato</div>`;

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[70] flex items-end';
  modal.style.background = 'rgba(0,0,0,0.3)';
  modal.innerHTML = `
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e293b;margin-bottom:4px;">✏️ Edit ${ingr.name}</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">Solo campi master ingrediente. I prezzi fornitore si editano per riga.</div>

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
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">MEASURE TYPE</label>
          <select id="editIngrMeasureType" style="width:100%;padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
            <option value="each" ${ingr.measure_type==='each'?'selected':''}>each (a pezzo)</option>
            <option value="weight" ${ingr.measure_type!=='each'?'selected':''}>weight (a peso)</option>
          </select>
        </div>
      </div>

      <div style="background:#eff6ff;border-radius:14px;padding:12px;margin-bottom:12px;">
        <label style="font-size:11px;color:#1d4ed8;font-weight:600;display:block;margin-bottom:6px;">PESO DI UN PEZZO</label>
        ${currentWeightLine}
        <div style="display:flex;align-items:center;gap:8px;">
          <input id="editIngrWeight" type="number" min="0" step="0.01"
            placeholder="es. 4.5"
            style="width:90px;padding:10px 12px;border:1px solid #bfdbfe;border-radius:10px;font-size:14px;box-sizing:border-box;">
          <select id="editIngrWeightUnit" style="padding:10px 8px;border:1px solid #bfdbfe;border-radius:10px;font-size:13px;">
            <option value="oz">oz</option>
            <option value="g">g</option>
            <option value="lb">lb</option>
          </select>
          <span style="font-size:11px;color:#1d4ed8;">scrivi e salva, lascia vuoto per non modificare</span>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">YIELD % (scarto)</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <input id="editIngrYield" type="number" min="1" max="100" step="1"
            value="${Math.round((ingr.yield_factor||1)*100)}"
            style="width:80px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;text-align:center;">
          <span style="font-size:13px;color:#64748b;">% usabile &nbsp;(100 = nessuno scarto)</span>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">VENDOR / PACK (riferimento)</label>
        ${vendorLine}
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
  modal.onclick = e=>{ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
  addSwipeToClose(modal, ()=>modal.remove());
};

window.saveEditIngredient = async function(ingredientId, btn){
  btn.textContent='Saving...'; btn.disabled=true;
  // Only update columns that exist in ingredients table
  const yieldVal = parseFloat(document.getElementById('editIngrYield')?.value);
  const weightRaw = document.getElementById('editIngrWeight')?.value;
  const weightUnit = document.getElementById('editIngrWeightUnit')?.value || 'oz';

  const updates = {
    name:         document.getElementById('editIngrName')?.value?.trim(),
    category:     document.getElementById('editIngrCat')?.value||null,
    measure_type: document.getElementById('editIngrMeasureType')?.value||'weight',
    notes:        document.getElementById('editIngrNotes')?.value||null,
    yield_factor: (!isNaN(yieldVal) && yieldVal > 0 && yieldVal <= 100) ? yieldVal/100 : 1.0,
  };

  // Peso a pezzo: converti in grammi solo se l'utente ha scritto qualcosa.
  // Campo vuoto = non toccare il valore già salvato.
  if (weightRaw !== '' && weightRaw != null) {
    const w = parseFloat(weightRaw);
    if (!isNaN(w) && w > 0) {
      const grams = w * (UNIT_CONVERSIONS[weightUnit] || 1);
      updates.avg_unit_weight_g = Math.round(grams * 100) / 100;
    }
  }

  const {error} = await supa.from('ingredients').update(updates).eq('id',ingredientId);
  if(error){ btn.textContent='Error: '+error.message; btn.disabled=false; return; }
  btn.closest('.fixed').remove();
  document.querySelector('.fixed.inset-0')?.remove();
  openIngredientCard(ingredientId);
};

// ── EDIT VENDOR ROW — campi ingredient_vendors ────────────────
window.openEditVendorRow = async function(vendorId, ingredientId){
  const {data:v} = await supa.from('ingredient_vendors')
    .select('id,vendor,vendor_sku,pack_description,unit_price,price_type,conversion_to_base,price_per_100g,price_per_each,last_invoice_date,active')
    .eq('id',vendorId).single();
  if(!v) return;

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[80] flex items-end';
  modal.style.background = 'rgba(0,0,0,0.4)';
  modal.innerHTML = `
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:90vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e293b;margin-bottom:4px;">✏️ Edit Vendor</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">Changes affect price_per_100g, food cost, and Chef AI answers</div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">VENDOR</label>
        <input id="evVendor" value="${v.vendor||''}" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">VENDOR SKU</label>
          <input id="evSku" value="${v.vendor_sku||''}" placeholder="item code" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">UNIT PRICE ($)</label>
          <input id="evUnitPrice" type="number" step="0.01" value="${v.unit_price||''}" placeholder="e.g. 24.96" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>

      <!-- PRICE TYPE -->
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:6px;">PRICE TYPE — il prezzo sopra è per...</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;" id="evPriceTypeGroup">
          ${[['per_case','📦 Cassa intera'],['per_lb','⚖️ Per lb'],['per_kg','⚖️ Per kg'],['per_oz','⚖️ Per oz'],['per_each','🥚 Per pezzo']].map(([val,label])=>`
            <button type="button" data-pt="${val}"
              onclick="document.querySelectorAll('#evPriceTypeGroup button').forEach(b=>b.style.background=b.dataset.pt==='${val}'?'#1e293b':'#f1f5f9');document.querySelectorAll('#evPriceTypeGroup button').forEach(b=>b.style.color=b.dataset.pt==='${val}'?'white':'#475569');document.getElementById('evPriceType').value='${val}';evUpdatePreview();"
              style="padding:8px 14px;border-radius:20px;border:1.5px solid #e2e8f0;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;background:${(v.price_type||'per_case')===val?'#1e293b':'#f1f5f9'};color:${(v.price_type||'per_case')===val?'white':'#475569'};">
              ${label}
            </button>`).join('')}
        </div>
        <input type="hidden" id="evPriceType" value="${v.price_type||'per_case'}">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">

        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PACK DESCRIPTION</label>
          <input id="evPackDesc" value="${v.pack_description||''}" placeholder="5# bag, 2/5lb" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PESO PACK (g) — peso totale della confezione in grammi</label>
        <input id="evConversion" type="number" value="${v.conversion_to_base||''}" placeholder="es. 1361 per 3 lb, 2268 per 5 lb" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;" oninput="evUpdatePreview()">
        <div style="font-size:11px;color:#94a3b8;margin-top:4px;">1 lb = 453g · 1 oz = 28g · 1 kg = 1000g</div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">COSTO PER UNITÀ ($) — per articoli CT/EA (fiori, limoni, ecc.)</label>
        <input id="evPricePerEach" type="number" step="0.0001" value="${v.price_per_each||''}" placeholder="es. 0.4688 per fiore" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
      </div>

      <div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="evActive" ${v.active!==false?'checked':''} style="width:16px;height:16px;">
        <label for="evActive" style="font-size:13px;color:#1e293b;">Active</label>
      </div>

      <!-- LIVE PREVIEW -->
      <div id="evCalcPreview" style="background:#f8fafc;border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#64748b;"></div>

      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:#f1f5f9;color:#6b7280;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveEditVendorRow('${vendorId}','${ingredientId}',this)" style="height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Save & Recalculate</button>
      </div>
    </div>`;
  modal.onclick = e=>{ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
  addSwipeToClose(modal, ()=>modal.remove());

  // Live preview
  function evUpdatePreview(){
    const up     = parseFloat(document.getElementById('evUnitPrice')?.value)||0;
    const conv   = parseFloat(document.getElementById('evConversion')?.value)||0;
    const pt     = document.getElementById('evPriceType')?.value||'per_case';
    const wgEach = parseFloat(document.getElementById('evAvgUnitWg')?.value)||0;
    const packDesc = (document.getElementById('evPackDesc')?.value||'').trim().toUpperCase();
    const el     = document.getElementById('evCalcPreview');
    if(!up){ el.textContent='→ Inserisci Unit Price'; el.style.color='#92400e'; el.style.background='#fff7ed'; return; }
    let p100 = null, note = '';
    if(pt === 'per_lb')      p100 = (up / 453.592) * 100;
    else if(pt === 'per_kg') p100 = (up / 1000) * 100;
    else if(conv > 0)        p100 = (up / conv) * 100;
    else if(wgEach > 0) {
      // Count-based: parse DZ → ×12, CT/EA → ×1
      const dzM = packDesc.match(/^(\d+(?:\.\d+)?)\s*DZ/);
      const ctM = packDesc.match(/^(\d+(?:\.\d+)?)\s*(?:CT|EA|EACH|PC|PCS)/);
      let totalPcs = 0;
      if(dzM)      totalPcs = parseFloat(dzM[1]) * 12;
      else if(ctM) totalPcs = parseFloat(ctM[1]);
      if(totalPcs > 0){
        const totalG = totalPcs * wgEach;
        p100 = (up / totalG) * 100;
        note = ` (${totalPcs} pz × ${wgEach}g = ${Math.round(totalG)}g)`;
      }
    }
    if(p100){
      el.innerHTML = `→ <strong>$${p100.toFixed(4)}/100g</strong>${note}`;
      el.style.color = '#166534'; el.style.background='#f0fdf4';
    } else {
      el.textContent = '→ Inserisci peso pack o peso per pezzo per calcolare $/100g';
      el.style.color = '#92400e'; el.style.background='#fff7ed';
    }
  }
  window.evUpdatePreview = evUpdatePreview;
  ['evUnitPrice','evPriceType','evConversion','evAvgUnitWg','evPackDesc'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input', evUpdatePreview);
  });
  evUpdatePreview();
};

window.saveEditVendorRow = async function(vendorId, ingredientId, btn){
  btn.textContent='Saving...'; btn.disabled=true;
  const up           = parseFloat(document.getElementById('evUnitPrice')?.value)||null;
  const pu           = document.getElementById('evPurchaseUnit')?.value?.trim()||null;
  const conv         = parseFloat(document.getElementById('evConversion')?.value)||null;
  const priceTypeVal = document.getElementById('evPriceType')?.value||'per_case';
  const pricePerEach = parseFloat(document.getElementById('evPricePerEach')?.value)||null;
  const avgUnitWgNew = parseFloat(document.getElementById('evAvgUnitWg')?.value)||null;

  // Calcola price_per_100g — include count-based (DZ/CT) via avg_unit_weight_g
  let p100 = null;
  if(up){
    if(priceTypeVal === 'per_lb')      p100 = parseFloat(((up / 453.592) * 100).toFixed(4));
    else if(priceTypeVal === 'per_kg') p100 = parseFloat(((up / 1000) * 100).toFixed(4));
    else if(conv > 0)                  p100 = parseFloat(((up / conv) * 100).toFixed(4));
    else if(avgUnitWgNew > 0) {
      const packDesc = (document.getElementById('evPackDesc')?.value||'').trim().toUpperCase();
      const dzM = packDesc.match(/^(\d+(?:\.\d+)?)\s*DZ/);
      const ctM = packDesc.match(/^(\d+(?:\.\d+)?)\s*(?:CT|EA|EACH|PC|PCS)/);
      let totalPcs = 0;
      if(dzM)      totalPcs = parseFloat(dzM[1]) * 12;
      else if(ctM) totalPcs = parseFloat(ctM[1]);
      if(totalPcs > 0) p100 = parseFloat(((up / (totalPcs * avgUnitWgNew)) * 100).toFixed(4));
    }
  }

  const updates = {
    vendor:           document.getElementById('evVendor')?.value?.trim()||null,
    vendor_sku:       document.getElementById('evSku')?.value?.trim()||null,
    unit_price:       up,

    pack_description: document.getElementById('evPackDesc')?.value?.trim()||null,
    conversion_to_base: conv,
    price_per_each:   pricePerEach,
    price_per_100g:   p100,
    price_type:       priceTypeVal,
    active:           document.getElementById('evActive')?.checked!==false,
    updated_at:       new Date().toISOString(),
  };

  const {error} = await supa.from('ingredient_vendors').update(updates).eq('id',vendorId);
  if(error){ btn.textContent='Error: '+error.message; btn.disabled=false; return; }
  // Save avg_unit_weight_g on the ingredient itself (shared across all vendors)
  if(avgUnitWgNew !== null){
    await supa.from('ingredients').update({ avg_unit_weight_g: avgUnitWgNew }).eq('id', ingredientId);
  }
  btn.closest('.fixed').remove();
  document.querySelectorAll('.fixed.inset-0').forEach(m=>m.remove());
  openIngredientCard(ingredientId);
};

// ── ADD VENDOR ROW ────────────────────────────────────────────
window.openAddVendorRow = function(ingredientId){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[80] flex items-end';
  modal.style.background = 'rgba(0,0,0,0.4)';
  modal.innerHTML = `
    <div style="background:white;border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e293b;margin-bottom:16px;">➕ Aggiungi Fornitore</div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">FORNITORE</label>
        <input id="avVendor" placeholder="es. Fruge Seafood" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PRICE TYPE</label>
          <select id="avPriceType" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;" oninput="avUpdatePreview()">
            <option value="per_case">Per Case</option>
            <option value="per_lb">Per Lb</option>
            <option value="per_kg">Per Kg</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">UNIT PRICE ($)</label>
          <input id="avUnitPrice" type="number" step="0.01" placeholder="es. 24.96" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;" oninput="avUpdatePreview()">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PACK DESCRIPTION</label>
          <input id="avPackDesc" placeholder="es. 5# bag, 6 CT, 1pc/28#" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">VENDOR SKU</label>
          <input id="avSku" placeholder="es. 03075" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">PESO PACK (g) — peso totale della confezione in grammi</label>
        <input id="avConversion" type="number" placeholder="es. 1361 per 3 lb, 2268 per 5 lb" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;" oninput="avUpdatePreview()">
        <div style="font-size:11px;color:#94a3b8;margin-top:4px;">1 lb = 453g · 1 oz = 28g · 1 kg = 1000g</div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#94a3b8;font-weight:500;display:block;margin-bottom:4px;">COSTO PER UNITÀ ($) — per articoli CT/EA (fiori, limoni, ecc.)</label>
        <input id="avPricePerEach" type="number" step="0.0001" placeholder="es. 0.4688 per fiore" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">
      </div>

      <div id="avCalcPreview" style="background:#fff7ed;border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#92400e;">Inserisci Unit Price + peso per vedere $/100g</div>

      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:#f1f5f9;color:#6b7280;font-size:13px;border:none;cursor:pointer;">Annulla</button>
        <button onclick="saveNewVendorRow('${ingredientId}',this)" style="height:44px;border-radius:14px;background:#1e293b;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Salva Fornitore</button>
      </div>
    </div>`;
  modal.onclick = e=>{ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
  addSwipeToClose(modal, ()=>modal.remove());

  window.avUpdatePreview = function(){
    const up   = parseFloat(document.getElementById('avUnitPrice')?.value)||0;
    const conv = parseFloat(document.getElementById('avConversion')?.value)||0;
    const pt   = document.getElementById('avPriceType')?.value||'per_case';
    const el   = document.getElementById('avCalcPreview');
    if(!up){ el.textContent='Inserisci Unit Price'; el.style.color='#92400e'; el.style.background='#fff7ed'; return; }
    let p100 = null;
    if(pt === 'per_lb')      p100 = (up / 453.592) * 100;
    else if(pt === 'per_kg') p100 = (up / 1000) * 100;
    else if(conv > 0)        p100 = (up / conv) * 100;
    if(p100){ el.textContent=`→ $${p100.toFixed(4)}/100g`; el.style.color='#166534'; el.style.background='#f0fdf4'; }
    else{ el.textContent='Inserisci peso pack per calcolare $/100g'; el.style.color='#92400e'; el.style.background='#fff7ed'; }
  };
};

window.saveNewVendorRow = async function(ingredientId, btn){
  btn.textContent='Saving...'; btn.disabled=true;
  const up           = parseFloat(document.getElementById('avUnitPrice')?.value)||null;
  const conv         = parseFloat(document.getElementById('avConversion')?.value)||null;
  const priceTypeVal = document.getElementById('avPriceType')?.value||'per_case';
  const pricePerEach = parseFloat(document.getElementById('avPricePerEach')?.value)||null;

  let p100 = null;
  if(up){
    if(priceTypeVal === 'per_lb')      p100 = parseFloat(((up / 453.592) * 100).toFixed(4));
    else if(priceTypeVal === 'per_kg') p100 = parseFloat(((up / 1000) * 100).toFixed(4));
    else if(conv > 0)                  p100 = parseFloat(((up / conv) * 100).toFixed(4));
  }

  const {error} = await supa.from('ingredient_vendors').insert({
    ingredient_id:      ingredientId,
    vendor:             document.getElementById('avVendor')?.value?.trim()||null,
    vendor_sku:         document.getElementById('avSku')?.value?.trim()||null,
    unit_price:         up,
    pack_description:   document.getElementById('avPackDesc')?.value?.trim()||null,
    conversion_to_base: conv,
    price_per_each:     pricePerEach,
    price_per_100g:     p100,
    price_type:         priceTypeVal,
    active:             true,
  });
  if(error){ btn.textContent='Error: '+error.message; btn.disabled=false; return; }
  btn.closest('.fixed').remove();
  document.querySelectorAll('.fixed.inset-0').forEach(m=>m.remove());
  openIngredientCard(ingredientId);
};

// ── AGGIUNGI INGREDIENTE ──────────────────────────────────────
function openAddIngredient(prefillName=''){
  const categories = ['Dairy','Produce','Protein','Seafood','Dry Goods','Spices','Oil & Vinegar','Bakery','Frozen','Beverage','Other'];
  const units = ['g','kg','ml','l','lb','oz','each'];
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[60] flex items-end';
  modal.style.background = 'rgba(0,0,0,0.3)';
  modal.innerHTML = `
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
  modal.onclick = e=>{ if(e.target===modal) modal.remove(); };
  document.body.appendChild(modal);
  addSwipeToClose(modal, ()=>modal.remove());
}

window.saveNewIngredient = async ()=>{
  const name = document.getElementById('newIngrName')?.value?.trim();
  if(!name){ alert('Name required'); return; }
  const {data,error} = await supa.from('ingredients').insert({
    name,
    category:  document.getElementById('newIngrCat')?.value||null,
    base_unit: document.getElementById('newIngrUnit')?.value||'g',
    notes:     document.getElementById('newIngrNotes')?.value||null,
  }).select().single();
  if(error){ alert('Error: '+error.message); return; }
  document.querySelector('.fixed')?.remove();
  showScToast(`✓ ${name} added`);
  if(data) openIngredientCard(data.id);
};

// ── APRI RICETTA DA SCHEDA INGREDIENTE ───────────────────────
window.openRecipeFromCard = function(rec){
  if(typeof showRecipeSheet==='function'){
    showRecipeSheet(rec);
    setTimeout(()=>{
      document.querySelectorAll('.fixed.inset-0').forEach(s=>{
        if(s.classList.contains('z-50')||s.style.zIndex==='50') s.style.zIndex='80';
      });
    },10);
  }
};

