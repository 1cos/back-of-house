// ── IMPORT FATTURE ──

function openInvoiceImport(){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 16px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e3a5f;margin-bottom:14px;">📄 Import Invoice</div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <label style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 12px;background:rgba(59,130,246,0.06);border:0.5px solid rgba(59,130,246,0.2);border-radius:16px;cursor:pointer;">
          <span style="font-size:28px;">📷</span>
          <span style="font-size:12px;color:#1e3a5f;font-weight:500;">Camera</span>
          <input type="file" accept="image/*" capture="environment" style="display:none" onchange="processInvoiceFile(this)">
        </label>
        <label style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 12px;background:rgba(59,130,246,0.06);border:0.5px solid rgba(59,130,246,0.2);border-radius:16px;cursor:pointer;">
          <span style="font-size:28px;">🖼️</span>
          <span style="font-size:12px;color:#1e3a5f;font-weight:500;">Gallery</span>
          <input type="file" accept="image/*" style="display:none" onchange="processInvoiceFile(this)">
        </label>
      </div>
      
      <div id="invoiceStatus" style="display:none;padding:12px;background:rgba(59,130,246,0.06);border-radius:12px;font-size:13px;color:#1e3a5f;text-align:center;">
        ⏳ Reading invoice...
      </div>
      
      <button onclick="this.closest('.fixed').remove()" style="width:100%;height:40px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;margin-top:8px;">Cancel</button>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

async function processInvoiceFile(input){
  const file=input.files[0];
  if(!file) return;
  
  const status=document.getElementById('invoiceStatus');
  status.style.display='block';
  status.textContent='⏳ Reading invoice...';
  
  const base64=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.split(',')[1]);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
  
  try{
    status.textContent='🤖 Analyzing with AI...';
    
    const res=await fetch(`${SUPABASE_URL}/functions/v1/process-invoice`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${SUPABASE_ANON_KEY}`
      },
      body:JSON.stringify({imageBase64:base64, mimeType:file.type})
    });
    
    const data=await res.json();
    
    if(data.error){
      status.textContent='❌ Error: '+data.error;
      return;
    }
    
    input.closest('.fixed').remove();
    // Enrichment step: calcola pesi e costi prima della One Question Rule
    enrichInvoiceItems(data);
    await runOneQuestionRule(data, showInvoicePreview);
    
  }catch(e){
    status.textContent='❌ Error: '+e.message;
  }
}

// ── PACK FORMAT PARSER ─────────────────────────────────────────
// Parsifica formati come "2/5 LB", "4/2.5 LB", "6/1 GAL", "1/5#", "5LB", "12 OZ"
// Ritorna {count, sizeEach, unit} o null se non riesce
function parsePackFormat(str){
  if(!str) return null;

  // Normalizza: # → lb, rimuovi trailing words (bag, box, case, pack)
  let s = String(str).trim()
    .replace(/#/g,'lb')
    .replace(/\b(bag|box|case|pack|bx|cs)\b/gi,'')
    .trim()
    .toUpperCase();

  // Formato "count X size unit" — es. "4 X 5 LB", "1 X 10 LB", "2 X 500G"
  let m = s.match(/^(\d+)\s*X\s*([\d.]+)\s*([A-Z_]+)/);
  if(m) return {count:parseFloat(m[1]), sizeEach:parseFloat(m[2]), unit:m[3].toLowerCase()};

  // Formato "count/size unit" — es. "2/5 LB", "6/1GAL", "4/2.5LB", "12/3 CT"
  m = s.match(/^(\d+)\s*\/\s*([\d.]+)\s*([A-Z_]+)/);
  if(m) return {count:parseFloat(m[1]), sizeEach:parseFloat(m[2]), unit:m[3].toLowerCase()};

  // Formato "size unit" — es. "5 LB", "10LB", "12OZ", "8LB", "1GAL"
  m = s.match(/^([\d.]+)\s*([A-Z]+)$/);
  if(m) return {count:1, sizeEach:parseFloat(m[1]), unit:m[2].toLowerCase()};

  // Formato "count EA/EACH/CT" — es. "24 EA", "100 CT"
  m = s.match(/^(\d+)\s*(EA|EACH|PC|PCS|CT|COUNT)$/);
  if(m) return {count:parseFloat(m[1]), sizeEach:1, unit:'each'};

  return null;
}

// ── UNITÀ → BASE (g o ml) ──────────────────────────────────────
const UNIT_TO_G = {
  'g':1,'kg':1000,'lb':453.592,'oz':28.3495,
  'lbs':453.592,'pound':453.592,'pounds':453.592,
  'ml':1,'l':1000,'liter':1000,'litre':1000,
  'gal':3785.41,'qt':946.353,'pt':473.176,'fl_oz':29.5735,
};

function unitToG(unit){
  return UNIT_TO_G[(unit||'').toLowerCase().trim()]||null;
}

// ── CALCOLA total_weight_g per un item ─────────────────────────
// Priorità: pack_description > purchase_unit diretto > avg_unit_weight_g
function calcTotalWeightG(item){
  const qty = parseFloat(item.quantity||item.qty)||1;

  // 1. Prova a parsare pack_description es. "2/5 LB"
  if(item.pack_size||item.pack_description){
    const p = parsePackFormat(item.pack_size||item.pack_description);
    if(p && p.unit!=='each'){
      const factor = unitToG(p.unit);
      if(factor) return qty * p.count * p.sizeEach * factor;
    }
  }

  // 2. purchase_unit diretto (non each)
  const pu = (item.purchase_unit||item.unit||'').toLowerCase();
  if(pu && pu!=='each' && pu!=='cs' && pu!=='case'){
    const factor = unitToG(pu);
    if(factor) return qty * factor;
  }

  // 3. pack_qty + pack_unit (campi strutturati)
  if(item.pack_qty && item.pack_unit && item.pack_unit!=='each'){
    const factor = unitToG(item.pack_unit);
    if(factor) return qty * parseFloat(item.pack_qty) * factor;
  }

  // 4. each con peso stimato dall'AI
  if(item.avg_unit_weight_g){
    const packSize = parsePackFormat(item.pack_size||item.pack_description);
    const units = packSize ? packSize.count * packSize.sizeEach : qty;
    return units * parseFloat(item.avg_unit_weight_g);
  }

  return null; // non calcolabile — chiederemo
}

// ── ENRICHMENT — calcola pesi e costi per tutti gli item ──────
function enrichInvoiceItems(data){
  (data.items||[]).forEach(item=>{
    const totalG = calcTotalWeightG(item);
    item._total_weight_g = totalG;

    const price = parseFloat(item.unit_price||item.amount)||null;
    if(totalG && price){
      item._cost_per_100g = (price / totalG) * 100;
    } else {
      item._cost_per_100g = null;
    }

    // Segnala se serve chiarimento peso
    if(!totalG && !item.needs_clarification){
      const pu = (item.purchase_unit||item.unit||'').toLowerCase();
      if(pu==='each'||pu==='cs'||pu==='case'||!pu){
        item._needs_weight_clarification = true;
      }
    }
  });
}

// ── ANOMALIA PREZZI — confronta con storico ───────────────────
async function checkPriceAnomalies(data){
  if(!data.items?.length) return;

  // carica storico prezzi per questo vendor
  const descriptions = data.items.map(i=>i.description).filter(Boolean);
  const {data:history} = await supa
    .from('invoice_lines')
    .select('raw_description,cost_per_100g,invoice_date')
    .eq('vendor', data.vendor||'')
    .in('raw_description', descriptions)
    .not('cost_per_100g','is',null)
    .order('invoice_date',{ascending:false});

  if(!history?.length) return;

  // media storica per descrizione
  const avgMap = {};
  history.forEach(h=>{
    if(!avgMap[h.raw_description]) avgMap[h.raw_description]={sum:0,count:0};
    avgMap[h.raw_description].sum   += h.cost_per_100g;
    avgMap[h.raw_description].count += 1;
  });

  data.items.forEach(item=>{
    if(!item._cost_per_100g || !avgMap[item.description]) return;
    const avg = avgMap[item.description].sum / avgMap[item.description].count;
    const pct = Math.abs(item._cost_per_100g - avg) / avg;
    if(pct > 0.15){ // soglia 15%
      item._price_anomaly = true;
      const dir = item._cost_per_100g > avg ? '↑' : '↓';
      item._anomaly_note = `${dir} ${Math.round(pct*100)}% vs avg $${avg.toFixed(2)}/100g`;
    }
  });
}

function showInvoicePreview(data){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  
  const itemsHtml=(data.items||[]).map((item,idx)=>{
    const anomalyBadge = item._price_anomaly
      ? `<div style="font-size:10px;color:#dc2626;background:rgba(220,38,38,0.08);padding:2px 6px;border-radius:6px;margin-top:2px;">⚠️ ${item._anomaly_note}</div>`
      : '';
    const weightLine = item._total_weight_g
      ? `<span style="color:#10b981;">${item._total_weight_g>=1000?(item._total_weight_g/1000).toFixed(2)+'kg':Math.round(item._total_weight_g)+'g'}</span>`
      : `<span style="color:#f59e0b;">⚠️ weight unknown</span>`;
    const costLine = item._cost_per_100g
      ? ` · $${item._cost_per_100g.toFixed(2)}/100g`
      : '';
    return `
    <div style="padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:#1e3a5f;font-weight:500;">${item.description||'Unknown'}</div>
          <div style="font-size:11px;color:#93c5fd;margin-top:2px;">${item.quantity||''} ${item.unit||''} ${item.pack_size?'• '+item.pack_size:''} ${item.brand?'• '+item.brand:''}</div>
          <div style="font-size:11px;margin-top:1px;">${weightLine}${costLine}</div>
          ${anomalyBadge}
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:8px;">
          <div style="font-size:13px;color:#1e3a5f;">$${(item.amount||0).toFixed(2)}</div>
          <div style="font-size:11px;color:#93c5fd;">@$${(item.unit_price||0).toFixed(2)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  
  // Conta anomalie
  const anomalies = (data.items||[]).filter(i=>i._price_anomaly).length;
  const noWeight  = (data.items||[]).filter(i=>!i._total_weight_g).length;
  const warningBar = (anomalies||noWeight) ? `
    <div style="background:rgba(245,158,11,0.08);border:0.5px solid rgba(245,158,11,0.3);border-radius:12px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#92400e;">
      ${anomalies?`⚠️ ${anomalies} price anomal${anomalies>1?'ies':'y'} detected. `:''}${noWeight?`📦 ${noWeight} item${noWeight>1?'s':''} without calculable weight.`:''}
    </div>` : '';

  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      
      <div style="background:rgba(59,130,246,0.06);border-radius:14px;padding:12px;margin-bottom:14px;">
        <div style="font-size:16px;font-weight:500;color:#1e3a5f;margin-bottom:6px;">${data.vendor||'Unknown Vendor'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <div style="font-size:11px;color:#93c5fd;">Invoice #<br><span style="color:#1e3a5f;font-weight:500;">${data.invoice_number||'—'}</span></div>
          <div style="font-size:11px;color:#93c5fd;">Date<br><span style="color:#1e3a5f;font-weight:500;">${data.invoice_date||'—'}</span></div>
          <div style="font-size:11px;color:#93c5fd;">Terms<br><span style="color:#1e3a5f;font-weight:500;">${data.payment_terms||'—'}</span></div>
          <div style="font-size:11px;color:#93c5fd;">Total<br><span style="color:#1e3a5f;font-weight:500;font-size:14px;">$${(data.total||0).toFixed(2)}</span></div>
        </div>
      </div>
      
      ${warningBar}
      
      <div style="font-size:11px;font-weight:500;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">${(data.items||[]).length} Items</div>
      <div style="margin-bottom:14px;">${itemsHtml}</div>
      
      <div style="background:rgba(59,130,246,0.04);border-radius:12px;padding:10px;margin-bottom:14px;">
        ${data.subtotal?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;"><span>Subtotal</span><span>$${data.subtotal.toFixed(2)}</span></div>`:''}
        ${data.tax?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;"><span>Tax</span><span>$${data.tax.toFixed(2)}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:500;color:#1e3a5f;"><span>Total</span><span>$${(data.total||0).toFixed(2)}</span></div>
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveInvoice(${JSON.stringify(data).replace(/"/g,'&quot;')},this)" style="height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">✓ Save Invoice</button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

async function saveInvoice(data, btn){
  btn.textContent='Saving...';
  btn.disabled=true;
  
  try{
    const{data:purchase, error}=await supa.from('purchases').insert({
      vendor: data.vendor||null,
      invoice_number: data.invoice_number||null,
      invoice_date: data.invoice_date||null,
      payment_terms: data.payment_terms||null,
      subtotal: data.subtotal||null,
      tax: data.tax||null,
      total: data.total||null,
      items: data.items||[],
      uploaded_by: user?.name||'Max'
    }).select().single();
    
    if(error) throw error;
    
    // Attach purchase id to data so invoice_lines and matching can use it
    data._purchase_id = purchase?.id || null;

    btn.closest('.fixed').remove();
    
    const toast=document.createElement('div');
    toast.className='sc-toast fixed top-16 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl';
    toast.textContent=`✓ Invoice from ${data.vendor||'vendor'} saved — $${(data.total||0).toFixed(2)}`;
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(),3000);
    
    saveToInvoiceLines(data);
    setTimeout(()=>suggestIngredientMatches(data), 2000);
    
  }catch(e){
    btn.textContent='Error — retry';
    btn.disabled=false;
    console.error(e);
  }
}

// ── STORICO FATTURE ──
async function openPurchaseHistory(){
  const{data}=await supa.from('purchases').select('*').order('created_at',{ascending:false}).limit(30);
  
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:15px;font-weight:500;color:#1e3a5f;">Purchase History</div>
        <button onclick="openInvoiceImport()" style="font-size:12px;color:#3B82F6;background:rgba(59,130,246,0.1);border:none;padding:5px 12px;border-radius:8px;cursor:pointer;">+ New</button>
      </div>
      ${(data||[]).length===0?'<p style="font-size:13px;color:#93c5fd;text-align:center;padding:20px;">No invoices yet</p>':
        (data||[]).map(p=>`
        <div onclick="showPurchaseDetail(${p.id})" style="padding:10px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <div style="font-size:14px;font-weight:500;color:#1e3a5f;">${p.vendor||'Unknown'}</div>
              <div style="font-size:11px;color:#93c5fd;margin-top:2px;">${p.invoice_date||''} ${p.invoice_number?'• #'+p.invoice_number:''}</div>
              <div style="font-size:11px;color:#93c5fd;">${(p.items||[]).length} items</div>
            </div>
            <div style="font-size:15px;font-weight:500;color:#1e3a5f;">$${(p.total||0).toFixed(2)}</div>
          </div>
        </div>`).join('')}
      <button onclick="this.closest('.fixed').remove()" style="width:100%;height:40px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;margin-top:12px;">Close</button>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

async function showPurchaseDetail(id){
  const{data}=await supa.from('purchases').select('*').eq('id',id).single();
  if(!data) return;
  document.querySelector('.fixed')?.remove();
  enrichInvoiceItems(data);
  showInvoicePreview(data);
}


// ── MATCH INGREDIENTI ──
async function suggestIngredientMatches(invoiceData){
  if(!invoiceData.items||!invoiceData.items.length) return;
  
  // Search BOTH: ingredients table + recipe ingredient lines
  const [{data:ingrsDB}, {data:recipes}] = await Promise.all([
    supa.from('ingredients').select('name').eq('active',true),
    supa.from('recipes').select('ingredients')
  ]);

  const allIngredients=new Set();
  // From ingredients table (primary source)
  (ingrsDB||[]).forEach(i=>{ if(i.name) allIngredients.add(i.name); });
  // From recipe lines (may have more specific names)
  (recipes||[]).forEach(r=>{
    (r.ingredients||[]).forEach(i=>{ if(i.name) allIngredients.add(i.name); });
  });
  
  if(!allIngredients.size) return;
  
  const{data:existingLinks}=await supa.from('ingredient_links')
    .select('invoice_description')
    .eq('vendor', invoiceData.vendor||'');
  const linked=new Set((existingLinks||[]).map(l=>l.invoice_description.toLowerCase()));
  
  const unlinked=invoiceData.items.filter(i=>
    i.description && !linked.has(i.description.toLowerCase())
  );
  
  if(!unlinked.length) return;
  
  const ingredientList=[...allIngredients].join(', ');
  const itemList=unlinked.map(i=>`"${i.description}"`).join(', ');
  
  showScToast('🔗 Analyzing ingredients...');
  
  try{
    const res=await fetch(`${SUPABASE_URL}/functions/v1/souschef-classify`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({
        transcript: `Match these invoice items to recipe ingredients. Invoice items: ${itemList}. Available ingredients: ${ingredientList}. Return JSON array: [{"invoice_item": "...", "ingredient": "...", "confidence": 0.0-1.0}]. Only include matches with confidence > 0.6. Return ONLY JSON array.`,
        kitchenData: []
      })
    });
    const data=await res.json();
    let matches=[];
    try{
      const text=data.result?.answer||data.result?.summary||'[]';
      matches=JSON.parse(text.replace(/```json|```/g,'').trim());
    }catch(e){ return; }
    
    if(!matches.length) return;
    showIngredientMatchModal(matches, invoiceData.vendor, unlinked);
  }catch(e){
    console.warn('Ingredient match failed:', e.message);
  }
}

function showIngredientMatchModal(matches, vendor, items){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e3a5f;margin-bottom:4px;">🔗 Ingredient Matches</div>
      <div style="font-size:12px;color:#93c5fd;margin-bottom:14px;">Confirm or skip each suggestion</div>
      
      <div id="matchList" style="space-y:8px;"></div>
      
      <button onclick="saveAllMatches('${vendor}');this.closest('.fixed').remove()" 
        style="width:100%;height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;margin-top:14px;border:none;cursor:pointer;">
        ✓ Save confirmed matches
      </button>
    </div>`;
  
  const list=modal.querySelector('#matchList');
  matches.forEach((m,idx)=>{
    const invoiceItem = items.find(i=>i.description===m.invoice_item)||{};
    const weightInfo = invoiceItem._total_weight_g
      ? `<span style="color:#10b981;"> · ${invoiceItem._total_weight_g>=1000?(invoiceItem._total_weight_g/1000).toFixed(2)+'kg':Math.round(invoiceItem._total_weight_g)+'g'}</span>`
      : '';
    const costInfo = invoiceItem._cost_per_100g
      ? `<span style="color:#6b7280;"> · $${invoiceItem._cost_per_100g.toFixed(2)}/100g</span>`
      : '';
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px;background:rgba(59,130,246,0.05);border-radius:12px;margin-bottom:8px;';
    row.innerHTML=`
      <input type="checkbox" id="match_${idx}" checked style="width:18px;height:18px;cursor:pointer;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;color:#93c5fd;">Invoice item</div>
        <div style="font-size:13px;color:#1e3a5f;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.invoice_item}</div>
        <div style="font-size:11px;color:#93c5fd;margin-top:2px;">→ <span style="color:#3B82F6;">${m.ingredient}</span> <span style="color:#93c5fd;">(${Math.round((m.confidence||0)*100)}%)</span>${weightInfo}${costInfo}</div>
      </div>`;
    row.dataset.invoiceItem=m.invoice_item;
    row.dataset.ingredient=m.ingredient;
    list.appendChild(row);
  });
  
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
  window._pendingMatches={matches, vendor, invoiceData};
}

async function saveAllMatches(vendor){
  if(!window._pendingMatches) return;
  const{matches, invoiceData}=window._pendingMatches;
  const checkboxes=document.querySelectorAll('[id^="match_"]');
  
  const toSave=[];
  checkboxes.forEach((cb,idx)=>{
    if(cb.checked && matches[idx]){
      toSave.push({
        invoice_description: matches[idx].invoice_item,
        ingredient_name:     matches[idx].ingredient,
        vendor:              vendor||null,
        confirmed:           true,
        confidence:          matches[idx].confidence||null
      });
    }
  });
  
  if(!toSave.length){ window._pendingMatches=null; return; }

  // 1. Save ingredient_links
  await supa.from('ingredient_links').upsert(toSave, {
    onConflict:'invoice_description,vendor'
  });

  // 2. For each confirmed match: find ingredient.id → update invoice_lines safely
  await Promise.all(toSave.map(async(m)=>{
    // Find ingredient by name
    const{data:ingr}=await supa.from('ingredients')
      .select('id')
      .eq('name', m.ingredient_name)
      .single();
    if(!ingr?.id) return;

    // Update ingredient_links with ingredient_id
    await supa.from('ingredient_links')
      .update({ingredient_id: ingr.id})
      .eq('invoice_description', m.invoice_description)
      .eq('vendor', vendor||'');

    // Update invoice_lines — scoped to THIS invoice only
    // Primary filter: import_id (purchase id) — most precise
    // Secondary: vendor + invoice_date + raw_description — fallback for older rows
    const purchaseId = invoiceData?._purchase_id;
    let query = supa.from('invoice_lines')
      .update({
        ingredient_id:     ingr.id,
        match_status:      'matched',
        match_confidence:  m.confidence||null
      })
      .eq('raw_description', m.invoice_description);

    if(purchaseId){
      // Precise: only this purchase
      query = query.eq('import_id', purchaseId);
    } else {
      // Fallback: same vendor + invoice_date (never touches other invoices)
      query = query
        .eq('vendor', vendor||'')
        .eq('invoice_date', invoiceData?.invoice_date||'');
    }

    await query;
  }));

  // 3. Update ingredient_vendors.price_per_100g for newly linked ingredients
  if(invoiceData){
    const{data:updatedLines}=await supa.from('invoice_lines')
      .select('vendor,unit_price,cost_per_100g,total_weight_g,invoice_date,purchase_unit,raw_description,ingredient_id')
      .eq('import_id', invoiceData._purchase_id||'')
      .not('ingredient_id','is',null)
      .not('cost_per_100g','is',null);
    if(updatedLines?.length){
      updateIngredientVendorPrices(vendor, updatedLines);
    }
  }

  showScToast(`✓ ${toSave.length} match${toSave.length>1?'es':''} confirmed — prices updated`);
  window._pendingMatches=null;
}


// ── ONE QUESTION RULE ─────────────────────────────────────────
async function runOneQuestionRule(data, onComplete){
  const items = data.items||[];
  if(!items.length){ onComplete(data); return; }

  // Carica risposte già date in passato per questo vendor
  const rawDescs = items.map(i=>i.description||'').filter(Boolean);
  const {data:known} = await supa
    .from('invoice_line_clarifications')
    .select('*')
    .eq('vendor', data.vendor||'')
    .in('raw_description', rawDescs);

  const knownMap = {};
  (known||[]).forEach(c=>{ knownMap[c.raw_description] = c.resolution; });

  items.forEach(item=>{
    if(knownMap[item.description]){
      Object.assign(item, knownMap[item.description]);
      item._clarified = true;
    }
  });

  // Controlla anomalie prezzi (non-blocking)
  await checkPriceAnomalies(data);

  // Priorità domande:
  // 1. needs_clarification dall'AI (unità ambigua)
  // 2. _needs_weight_clarification (each senza peso)
  const ambiguous =
    items.find(i => i.needs_clarification && !i._clarified) ||
    items.find(i => i._needs_weight_clarification && !i._clarified && !i._weight_answered);

  if(!ambiguous){ onComplete(data); return; }

  if(ambiguous._needs_weight_clarification){
    showWeightQuestionModal(ambiguous, data, onComplete);
  } else {
    showOneQuestionModal(ambiguous, data, onComplete);
  }
}

// ── MODAL PESO STIMATO ────────────────────────────────────────
function showWeightQuestionModal(item, invoiceData, onComplete){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-center justify-center';
  modal.style.background='rgba(0,0,0,0.5)';

  const commonWeights = [
    {label:'Small (≈100g)', value:100},
    {label:'Medium (≈200g)', value:200},
    {label:'Large (≈400g)', value:400},
    {label:'XL (≈600g)', value:600},
    {label:'1 lb (≈454g)', value:454},
    {label:'Skip', value:null},
  ];

  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;">⚖️ WEIGHT UNKNOWN</div>
      <div style="font-size:14px;font-weight:500;color:#1e3a5f;margin-bottom:8px;line-height:1.4;">How much does 1 unit weigh?</div>
      <div style="font-family:monospace;font-size:12px;color:#6b7280;background:#f8fafc;padding:6px 10px;border-radius:8px;margin-bottom:16px;">${item.description}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${commonWeights.map(w=>`
          <button
            style="padding:11px 14px;border-radius:12px;border:1.5px solid #e2e8f0;background:white;font-size:13px;color:#1e3a5f;cursor:pointer;text-align:left;"
            onclick="answerWeightQuestion(${w.value},this)">
            ${w.label}
          </button>`).join('')}
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="customWeight" type="number" placeholder="Custom g..." min="1" max="10000"
            style="flex:1;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:13px;">
          <button onclick="answerWeightQuestion(parseInt(document.getElementById('customWeight').value)||0,this)"
            style="padding:10px 14px;border-radius:12px;border:1.5px solid #3B82F6;background:#3B82F6;color:white;font-size:13px;cursor:pointer;">
            ✓
          </button>
        </div>
      </div>
    </div>`;

  modal._item = item;
  modal._invoiceData = invoiceData;
  modal._onComplete = onComplete;
  modal.id = 'weightModal';
  document.body.appendChild(modal);

  window.answerWeightQuestion = async(grams, btn)=>{
    btn.style.background='#1e3a5f';
    btn.style.color='white';
    const m = document.getElementById('weightModal');
    const itm = m._item;
    const invData = m._invoiceData;
    const cb = m._onComplete;

    if(grams && grams > 0){
      itm.avg_unit_weight_g = grams;
      itm._weight_answered = true;
      // ricalcola con il peso appena fornito
      const totalG = calcTotalWeightG(itm);
      itm._total_weight_g = totalG;
      if(totalG && itm.unit_price){
        itm._cost_per_100g = (parseFloat(itm.unit_price)/totalG)*100;
      }
    } else {
      itm._weight_answered = true; // skip — non chiediamo di nuovo
    }

    await new Promise(r=>setTimeout(r,150));
    m.remove();
    delete window.answerWeightQuestion;
    runOneQuestionRule(invData, cb);
  };
}

function showOneQuestionModal(item, invoiceData, onComplete){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-center justify-center';
  modal.style.background='rgba(0,0,0,0.5)';

  const question = item.clarification_question || `"${item.description}" — price is per:`;
  const options = item.clarification_options || [
    {label:'Each / unit', value:'each'},
    {label:'Case (CS)', value:'cs'},
    {label:'Pound (lb)', value:'lb'},
    {label:'Not sure', value:'skip'}
  ];

  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="font-size:10px;font-weight:700;color:#3B82F6;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;">⚠️ ONE QUESTION</div>
      <div style="font-size:14px;font-weight:500;color:#1e3a5f;margin-bottom:8px;line-height:1.4;">${question}</div>
      <div style="font-family:monospace;font-size:12px;color:#6b7280;background:#f8fafc;padding:6px 10px;border-radius:8px;margin-bottom:16px;">${item.description}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${options.map(o=>`
          <button 
            style="padding:11px 14px;border-radius:12px;border:1.5px solid #e2e8f0;background:white;font-size:13px;color:#1e3a5f;cursor:pointer;text-align:left;"
            onclick="answerOneQuestion('${(invoiceData.vendor||'').replace(/'/g,"\\'")}','${(item.description||'').replace(/'/g,"\\'")}','${o.value}',this)">
            ${o.label}
          </button>`).join('')}
      </div>
    </div>`;

  modal._invoiceData = invoiceData;
  modal._item = item;
  modal._onComplete = onComplete;
  modal.id = 'oqModal';
  document.body.appendChild(modal);
}

window.answerOneQuestion = async(vendor, rawDesc, answer, btn)=>{
  btn.style.background='#1e3a5f';
  btn.style.color='white';

  const modal = document.getElementById('oqModal');
  const item = modal._item;
  const invoiceData = modal._invoiceData;
  const onComplete = modal._onComplete;

  const resolution = answer==='skip' ? {skipped:true} : {purchase_unit:answer, price_is_per:answer};
  Object.assign(item, resolution);
  item._clarified = true;
  item.needs_clarification = false;

  if(answer!=='skip'){
    await supa.from('invoice_line_clarifications').upsert({
      vendor:          vendor,
      raw_description: rawDesc,
      question:        item.clarification_question||'',
      answer:          answer,
      resolution:      resolution,
      answered_by:     user?.name||'Max'
    }, {onConflict:'vendor,raw_description'});

    await supa.from('invoice_lines')
      .update({
        purchase_unit:          answer,
        clarification_answered: true,
        clarification_answer:   answer,
        clarification_at:       new Date().toISOString(),
        needs_clarification:    false
      })
      .eq('raw_description', rawDesc)
      .eq('vendor', vendor)
      .is('clarification_answered', false);
  }

  await new Promise(r=>setTimeout(r,150));
  modal.remove();
  runOneQuestionRule(invoiceData, onComplete);
};

// ── SALVA IN invoice_lines ────────────────────────────────────
async function saveToInvoiceLines(data){
  const lines = (data.items||[]).map(item=>{
    // Parse pack format per colonne strutturate
    const packStr = item.pack_size||item.pack_description||'';
    const pack = parsePackFormat(packStr);

    return {
      import_id:              data._purchase_id||null,
      invoice_date:           data.invoice_date||new Date().toISOString().slice(0,10),
      invoice_number:         data.invoice_number||null,
      vendor:                 data.vendor||'Unknown',
      raw_description:        item.description||'',
      vendor_sku:             item.item_code||item.vendor_sku||null,
      qty:                    parseFloat(item.quantity||item.qty)||null,
      purchase_unit:          item.purchase_unit||item.unit||null,
      pack_description:       packStr||null,
      pack_size:              pack?.sizeEach||parseFloat(item.pack_size)||null,
      pack_qty:               parseFloat(item.pack_qty)||null,
      pack_unit:              pack?.unit||item.pack_unit||null,
      // Colonne pack strutturate
      pack_count:             pack?.count||null,
      pack_size_each:         pack?.sizeEach||null,
      pack_size_unit:         pack?.unit||null,
      // Peso e costo calcolati
      estimated_total_g:      item._total_weight_g||null,
      total_weight_g:         item._total_weight_g||null,
      cost_per_100g:          item._cost_per_100g||null,
      price_anomaly:          item._price_anomaly||false,
      anomaly_note:           item._anomaly_note||null,
      // Resto
      unit_price:             parseFloat(item.unit_price)||null,
      line_total:             parseFloat(item.amount||item.line_total)||null,
      count_unit:             item.count_unit||null,
      avg_unit_weight_g:      parseFloat(item.avg_unit_weight_g)||null,
      needs_clarification:    !!(item.needs_clarification && !item._clarified),
      clarification_answered: !!(item._clarified),
      clarification_answer:   item._clarified?(item.purchase_unit||null):null,
      clarification_question: item.clarification_question||null,
      match_status:           'unmatched'
    };
  });

  const{error}=await supa.from('invoice_lines').insert(lines);
  if(error) console.warn('invoice_lines:', error.message);
  else {
    console.log('invoice_lines saved:', lines.length, 'rows');
    // Aggiorna price_per_100g in ingredient_vendors per i link confermati
    updateIngredientVendorPrices(data.vendor, lines);
  }
}

// ── AGGIORNA PREZZI INGREDIENT_VENDORS ───────────────────────
async function updateIngredientVendorPrices(vendor, lines){
  if(!vendor||!lines?.length) return;
  const{data:links}=await supa.from('ingredient_links')
    .select('invoice_description,ingredient_name')
    .eq('vendor',vendor)
    .eq('confirmed',true);
  if(!links?.length) return;

  const linkMap = {};
  links.forEach(l=>{ linkMap[l.invoice_description.toLowerCase()] = l.ingredient_name; });

  for(const line of lines){
    const ingredientName = linkMap[line.raw_description.toLowerCase()];
    if(!ingredientName||!line.cost_per_100g) continue;

    const{data:ingr}=await supa.from('ingredients').select('id').eq('name',ingredientName).single();
    if(!ingr) continue;

    await supa.from('ingredient_vendors').upsert({
      ingredient_id:        ingr.id,
      vendor:               vendor,
      price_per_100g:       line.cost_per_100g,
      last_invoice_date:    line.invoice_date,
      last_total_weight_g:  line.total_weight_g,
      updated_at:           new Date().toISOString()
    },{onConflict:'ingredient_id,vendor_name'});
  }
}
