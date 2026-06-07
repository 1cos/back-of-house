// ── IMPORT FATTURE — BOH OS v2 ──
// Stack: GitHub Pages + Supabase + Groq
// One Question Rule: mai indovinare in silenzio

// ── APRI MODAL IMPORT ──────────────────────────────────────────
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

// ── PROCESSA FILE FATTURA ──────────────────────────────────────
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
    const res=await fetch(`${SUPABASE_URL}/functions/v1/process-invoice-ocr`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({imageBase64:base64, mimeType:file.type})
    });
    const data=await res.json();
    if(data.error){ status.textContent='❌ Error: '+data.error; return; }
    input.closest('.fixed').remove();
    // Prima controlla ambiguità — One Question Rule
    await runOneQuestionRule(data);
  }catch(e){
    status.textContent='❌ '+e.message;
  }
}

// ── ONE QUESTION RULE ──────────────────────────────────────────
// Per ogni riga ambigua, chiedi UNA domanda alla volta
// Salva la risposta in invoice_line_clarifications così non chiede mai più
async function runOneQuestionRule(invoiceData){
  const items=invoiceData.items||[];
  if(!items.length){ showInvoicePreview(invoiceData); return; }

  // Carica risposte già date in passato
  const rawDescs=items.map(i=>i.description||'').filter(Boolean);
  const {data:knownClarifications}=await supa
    .from('invoice_line_clarifications')
    .select('*')
    .eq('vendor', invoiceData.vendor||'')
    .in('raw_description', rawDescs);

  const knownMap={};
  (knownClarifications||[]).forEach(c=>{ knownMap[c.raw_description]=c; });

  // Applica risposte già note
  items.forEach(item=>{
    const known=knownMap[item.description];
    if(known && known.resolution){
      Object.assign(item, known.resolution);
      item._clarified=true;
    }
  });

  // Trova la prima riga che ha ancora ambiguità e NON è già nota
  const ambiguous=items.filter(i=>i.needs_clarification && !i._clarified);
  
  if(!ambiguous.length){
    showInvoicePreview(invoiceData);
    return;
  }

  // One Question Rule: chiedi solo la prima ambiguità
  const first=ambiguous[0];
  showClarificationModal(first, invoiceData, ()=>{
    runOneQuestionRule(invoiceData); // riesegui dopo risposta
  });
}

// ── MODAL CHIARIMENTO (One Question Rule) ─────────────────────
function showClarificationModal(item, invoiceData, onDone){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[60] flex items-center justify-center';
  modal.style.background='rgba(0,0,0,0.5)';

  const question=item.clarification_question||`Is "${item.description}" priced per unit or per case?`;
  const options=item.clarification_options||[
    {label:'Per unit / each', value:'each'},
    {label:'Per case (CS)', value:'case'},
    {label:'Per pound (lb)', value:'lb'},
    {label:'Not sure — skip', value:'skip'}
  ];

  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:20px;width:90%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <div style="font-size:11px;font-weight:600;color:#3B82F6;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">⚠️ One Question</div>
      <div style="font-size:14px;font-weight:500;color:#1e3a5f;margin-bottom:6px;line-height:1.4;">${question}</div>
      <div style="font-size:12px;color:#93c5fd;margin-bottom:16px;font-family:monospace;background:#f8fafc;padding:6px 10px;border-radius:8px;">${item.description}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${options.map((o,i)=>`
          <button onclick="answerClarification('${invoiceData.vendor||''}','${(item.description||'').replace(/'/g,"\\'")}','${o.value}',this)"
            style="padding:11px 14px;border-radius:12px;border:1.5px solid #e2e8f0;background:white;font-size:13px;color:#1e3a5f;cursor:pointer;text-align:left;transition:all .15s;font-weight:${i===0?'500':'400'};">
            ${o.label}
          </button>`).join('')}
      </div>
    </div>`;

  // Salva riferimento per callback
  modal._invoiceData=invoiceData;
  modal._item=item;
  modal._onDone=onDone;
  modal.id='clarificationModal';

  document.body.appendChild(modal);
}

// ── RISPOSTA CHIARIMENTO ───────────────────────────────────────
window.answerClarification=async(vendor, rawDescription, answer, btn)=>{
  btn.style.background='#1e3a5f';
  btn.style.color='white';
  btn.style.borderColor='#1e3a5f';

  const modal=document.getElementById('clarificationModal');
  const item=modal._item;
  const invoiceData=modal._invoiceData;
  const onDone=modal._onDone;

  // Calcola resolution in base alla risposta
  let resolution={};
  if(answer==='each')   resolution={purchase_unit:'each', price_is_per:'each'};
  if(answer==='case')   resolution={purchase_unit:'cs',   price_is_per:'case'};
  if(answer==='lb')     resolution={purchase_unit:'lb',   price_is_per:'lb'};
  if(answer==='skip')   resolution={skipped:true};

  // Salva in DB — mai chiedere di nuovo
  if(answer!=='skip'){
    await supa.from('invoice_line_clarifications').upsert({
      vendor:           vendor||'',
      raw_description:  rawDescription,
      question:         item.clarification_question||'',
      answer:           answer,
      resolution:       resolution,
      answered_by:      user?.name||'Max'
    },{onConflict:'vendor,raw_description'});
  }

  // Applica al item in memoria
  Object.assign(item, resolution);
  item._clarified=true;
  item.needs_clarification=false;

  await new Promise(r=>setTimeout(r,200));
  modal.remove();
  onDone();
};

// ── PREVIEW FATTURA ────────────────────────────────────────────
function showInvoicePreview(data){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';

  const itemsHtml=(data.items||[]).map((item,idx)=>{
    const ambig=item.needs_clarification&&!item._clarified;
    return `
    <div style="padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:#1e3a5f;font-weight:500;">${item.description||'Unknown'} ${ambig?'<span style="color:#f59e0b;font-size:10px;">⚠️ unclear</span>':''}</div>
          <div style="font-size:11px;color:#93c5fd;margin-top:2px;">${item.qty||item.quantity||''} ${item.purchase_unit||item.unit||''} ${item.pack_description?'• '+item.pack_description:''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:8px;">
          <div style="font-size:13px;color:#1e3a5f;">$${(item.line_total||item.amount||0).toFixed(2)}</div>
          <div style="font-size:11px;color:#93c5fd;">@$${(item.unit_price||0).toFixed(2)}/${item.purchase_unit||item.unit||'unit'}</div>
        </div>
      </div>
    </div>`;
  }).join('');

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
      <div style="font-size:11px;font-weight:500;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">${(data.items||[]).length} Items</div>
      <div style="margin-bottom:14px;">${itemsHtml}</div>
      <div style="background:rgba(59,130,246,0.04);border-radius:12px;padding:10px;margin-bottom:14px;">
        ${data.subtotal?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;"><span>Subtotal</span><span>$${(data.subtotal||0).toFixed(2)}</span></div>`:''}
        ${data.tax?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;"><span>Tax</span><span>$${(data.tax||0).toFixed(2)}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:500;color:#1e3a5f;"><span>Total</span><span>$${(data.total||0).toFixed(2)}</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;">
        <button onclick="this.closest('.fixed').remove()" style="height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button onclick="saveInvoiceV2(${JSON.stringify(data).replace(/"/g,'&quot;')},this)" style="height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">✓ Save Invoice</button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

// ── SALVA FATTURA V2 ───────────────────────────────────────────
// Salva ogni riga in invoice_lines + aggiorna ingredient_vendors
window.saveInvoiceV2=async(data, btn)=>{
  btn.textContent='Saving...';
  btn.disabled=true;

  try{
    const invoiceDate=data.invoice_date||new Date().toISOString().slice(0,10);

    // 1. Salva ogni riga in invoice_lines
    const lines=(data.items||[]).map(item=>({
      invoice_date:     invoiceDate,
      invoice_number:   data.invoice_number||null,
      vendor:           data.vendor||'Unknown',
      raw_description:  item.description||'',
      vendor_sku:       item.vendor_sku||null,
      qty:              parseFloat(item.qty||item.quantity)||null,
      purchase_unit:    item.purchase_unit||item.unit||null,
      pack_description: item.pack_description||null,
      pack_size:        parseFloat(item.pack_size)||null,
      pack_unit:        item.pack_unit||null,
      unit_price:       parseFloat(item.unit_price)||null,
      line_total:       parseFloat(item.line_total||item.amount)||null,
      needs_clarification: !!(item.needs_clarification && !item._clarified),
      clarification_question: item.clarification_question||null,
      clarification_answered: !!(item._clarified),
      clarification_answer:   item._clarified?(item.purchase_unit||null):null,
      match_status:     'unmatched'
    }));

    const {error:linesErr}=await supa.from('invoice_lines').insert(lines);
    if(linesErr) console.warn('invoice_lines insert:', linesErr.message);

    // 2. Match AI — collega ingredienti noti
    setTimeout(()=>matchInvoiceToIngredients(data), 500);

    btn.closest('.fixed').remove();

    const toast=document.createElement('div');
    toast.className='fixed top-16 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl';
    toast.textContent=`✓ ${data.vendor||'Invoice'} saved — $${(data.total||0).toFixed(2)} — ${lines.length} items`;
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(),3500);

  }catch(e){
    btn.textContent='Error — retry';
    btn.disabled=false;
    console.error(e);
  }
};

// ── MATCH AI: collega invoice_lines a ingredients ─────────────
async function matchInvoiceToIngredients(invoiceData){
  const items=invoiceData.items||[];
  if(!items.length) return;

  // Carica ingredienti master esistenti
  const {data:ingrs}=await supa.from('ingredients').select('id,name,name_aliases').eq('active',true);
  if(!ingrs||!ingrs.length) return;

  // Carica link già noti
  const {data:knownLinks}=await supa.from('ingredient_links')
    .select('*')
    .eq('vendor', invoiceData.vendor||'');
  const linkMap={};
  (knownLinks||[]).forEach(l=>{ linkMap[l.raw_description.toLowerCase()]=l; });

  const unmatched=items.filter(i=>i.description && !linkMap[i.description.toLowerCase()]);
  if(!unmatched.length) return;

  // Chiedi a Groq di fare il match
  const ingrList=ingrs.map(i=>({id:i.id,name:i.name}));
  const itemList=unmatched.map(i=>i.description);

  try{
    const res=await fetch(`${SUPABASE_URL}/functions/v1/process-invoice-lines`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({
        mode:'match_ingredients',
        invoice_items: itemList,
        ingredients:   ingrList,
        vendor:        invoiceData.vendor||''
      })
    });
    const result=await res.json();
    const matches=result.matches||[];
    if(!matches.length) return;

    // Salva i match confermati
    const toUpsert=matches
      .filter(m=>m.confidence>=0.75)
      .map(m=>({
        raw_description:  m.invoice_item,
        vendor:           invoiceData.vendor||null,
        ingredient_id:    m.ingredient_id||null,
        ingredient_name:  m.ingredient_name||null,
        confirmed:        m.confidence>=0.9,
        confidence:       m.confidence
      }));

    if(toUpsert.length){
      await supa.from('ingredient_links').upsert(toUpsert,{onConflict:'raw_description,vendor'});
      // Aggiorna invoice_lines con il match
      for(const m of toUpsert){
        await supa.from('invoice_lines')
          .update({
            ingredient_id: m.ingredient_id,
            match_status: m.confirmed?'matched':'ambiguous',
            match_confidence: m.confidence
          })
          .eq('raw_description', m.raw_description)
          .eq('vendor', invoiceData.vendor||'');
      }
    }

    // Aggiorna prezzi in ingredient_vendors
    await updateIngredientVendorPrices(invoiceData, matches);

  }catch(e){
    console.warn('AI match failed:', e.message);
  }
}

// ── AGGIORNA PREZZI FORNITORI ─────────────────────────────────
async function updateIngredientVendorPrices(invoiceData, matches){
  for(const m of matches){
    if(!m.ingredient_id) continue;
    const item=invoiceData.items.find(i=>i.description===m.invoice_item);
    if(!item||!item.unit_price) continue;

    await supa.from('ingredient_vendors').upsert({
      ingredient_id:    m.ingredient_id,
      vendor:           invoiceData.vendor||'Unknown',
      purchase_unit:    item.purchase_unit||item.unit||'each',
      pack_description: item.pack_description||null,
      pack_size:        parseFloat(item.pack_size)||null,
      pack_unit:        item.pack_unit||null,
      unit_price:       parseFloat(item.unit_price),
      last_ordered:     invoiceData.invoice_date||new Date().toISOString().slice(0,10),
      active:           true
    },{onConflict:'ingredient_id,vendor'});
  }
}

// ── STORICO FATTURE ────────────────────────────────────────────
async function openPurchaseHistory(){
  const {data}=await supa.from('invoice_lines')
    .select('vendor,invoice_date,invoice_number,line_total')
    .order('invoice_date',{ascending:false})
    .limit(100);

  // Raggruppa per fattura
  const byInvoice={};
  (data||[]).forEach(l=>{
    const key=`${l.vendor}|${l.invoice_date}|${l.invoice_number||''}`;
    if(!byInvoice[key]) byInvoice[key]={vendor:l.vendor,date:l.invoice_date,num:l.invoice_number,total:0,lines:0};
    byInvoice[key].total+=(l.line_total||0);
    byInvoice[key].lines++;
  });
  const invoices=Object.values(byInvoice).sort((a,b)=>b.date?.localeCompare(a.date));

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
      ${!invoices.length?'<p style="font-size:13px;color:#93c5fd;text-align:center;padding:20px;">No invoices yet</p>':
        invoices.map(p=>`
        <div onclick="openIngredientSpend('${p.vendor}','${p.date}')" style="padding:10px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <div style="font-size:14px;font-weight:500;color:#1e3a5f;">${p.vendor}</div>
              <div style="font-size:11px;color:#93c5fd;margin-top:2px;">${p.date||''} ${p.num?'• #'+p.num:''} • ${p.lines} items</div>
            </div>
            <div style="font-size:15px;font-weight:500;color:#1e3a5f;">$${p.total.toFixed(2)}</div>
          </div>
        </div>`).join('')}
      <button onclick="this.closest('.fixed').remove()" style="width:100%;height:40px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;margin-top:12px;">Close</button>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

// ── SCHEDA INGREDIENTE ─────────────────────────────────────────
// Apri "Burrata" → vedi tutto: prezzi fornitori, storico, ricette
async function openIngredientCard(ingredientId){
  const [{data:ingr},{data:vendors},{data:spend},{data:recipeLines}]=await Promise.all([
    supa.from('ingredients').select('*').eq('id',ingredientId).single(),
    supa.from('ingredient_vendors').select('*').eq('ingredient_id',ingredientId).order('unit_price'),
    supa.from('ingredient_monthly_spend').select('*').eq('ingredient_id',ingredientId).order('month',{ascending:false}).limit(6),
    supa.from('recipe_lines').select('ingredient_name,recipe_version_id,recipe_versions(recipe_id,recipes(name))')
      .eq('inventory_item_id', ingredientId).limit(20)
  ]);

  if(!ingr) return;

  const bestVendor=vendors?.length?vendors[0]:null;
  const totalSpend=(spend||[]).reduce((s,r)=>s+(r.total_spend||0),0);

  const vendorsHtml=(vendors||[]).map((v,i)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:${i===0?'rgba(16,185,129,0.08)':'rgba(59,130,246,0.04)'};border-radius:10px;margin-bottom:6px;">
      <div>
        <div style="font-size:13px;font-weight:500;color:#1e3a5f;">${v.vendor} ${i===0?'<span style="font-size:10px;color:#10b981;font-weight:600;">BEST</span>':''}</div>
        <div style="font-size:11px;color:#93c5fd;">${v.pack_description||v.purchase_unit} • last: ${v.last_ordered||'—'}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:15px;font-weight:600;color:#1e3a5f;">$${(v.unit_price||0).toFixed(2)}</div>
        <div style="font-size:10px;color:#93c5fd;">per ${v.purchase_unit}</div>
      </div>
    </div>`).join('');

  const spendHtml=(spend||[]).map(s=>`
    <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:0.5px solid rgba(59,130,246,0.06);">
      <span style="color:#6b7280;">${new Date(s.month).toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span>
      <span style="color:#1e3a5f;font-weight:500;">$${(s.total_spend||0).toFixed(2)} (${s.order_count} orders)</span>
    </div>`).join('');

  const recipeNames=[...new Set((recipeLines||[]).map(r=>r.recipe_versions?.recipes?.name).filter(Boolean))];

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.97);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:90vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      
      <!-- Header -->
      <div style="margin-bottom:16px;">
        <div style="font-size:20px;font-weight:600;color:#1e3a5f;">${ingr.name}</div>
        <div style="font-size:12px;color:#93c5fd;">${ingr.category||''} • base unit: ${ingr.base_unit}</div>
      </div>

      <!-- Best price highlight -->
      ${bestVendor?`
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);border-radius:16px;padding:14px;margin-bottom:16px;color:white;">
        <div style="font-size:11px;opacity:.7;margin-bottom:4px;">BEST PRICE</div>
        <div style="font-size:24px;font-weight:700;">$${(bestVendor.unit_price||0).toFixed(2)} <span style="font-size:14px;font-weight:400;">/ ${bestVendor.purchase_unit}</span></div>
        <div style="font-size:13px;opacity:.8;margin-top:2px;">${bestVendor.vendor} — ${bestVendor.pack_description||''}</div>
      </div>`:''}

      <!-- Fornitori -->
      <div style="font-size:11px;font-weight:600;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Vendors (${(vendors||[]).length})</div>
      <div style="margin-bottom:16px;">${vendorsHtml||'<p style="font-size:12px;color:#93c5fd;">No vendors yet</p>'}</div>

      <!-- Spesa mensile -->
      ${spend?.length?`
      <div style="font-size:11px;font-weight:600;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Monthly Spend</div>
      <div style="margin-bottom:4px;">${spendHtml}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:16px;">Total (6 months): <strong style="color:#1e3a5f;">$${totalSpend.toFixed(2)}</strong></div>`:''}

      <!-- Ricette -->
      ${recipeNames.length?`
      <div style="font-size:11px;font-weight:600;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Used in ${recipeNames.length} Recipes</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
        ${recipeNames.map(n=>`<span style="font-size:12px;background:rgba(59,130,246,0.08);color:#1e3a5f;padding:4px 10px;border-radius:20px;">${n}</span>`).join('')}
      </div>`:''}

      <!-- Note -->
      ${ingr.notes?`<div style="font-size:12px;color:#6b7280;background:#f8fafc;padding:10px;border-radius:10px;margin-bottom:14px;">${ingr.notes}</div>`:''}

      <button onclick="this.closest('.fixed').remove()" style="width:100%;height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;">Close</button>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

// ── SPEND PER VENDOR IN DATA ───────────────────────────────────
async function openIngredientSpend(vendor, date){
  const {data:lines}=await supa.from('invoice_lines')
    .select('*')
    .eq('vendor',vendor)
    .eq('invoice_date',date)
    .order('line_total',{ascending:false});

  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  const total=(lines||[]).reduce((s,l)=>s+(l.line_total||0),0);
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e3a5f;margin-bottom:2px;">${vendor}</div>
      <div style="font-size:12px;color:#93c5fd;margin-bottom:14px;">${date} — ${(lines||[]).length} items — $${total.toFixed(2)}</div>
      ${(lines||[]).map(l=>`
        <div style="display:flex;justify-content:space-between;align-items:start;padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">
          <div style="flex:1;">
            <div style="font-size:13px;color:#1e3a5f;font-weight:500;">${l.raw_description}</div>
            <div style="font-size:11px;color:#93c5fd;">${l.qty||''} ${l.purchase_unit||''} @$${(l.unit_price||0).toFixed(2)} ${l.match_status==='matched'?'✓':l.needs_clarification?'⚠️':''}</div>
          </div>
          <div style="font-size:13px;color:#1e3a5f;font-weight:500;margin-left:8px;">$${(l.line_total||0).toFixed(2)}</div>
        </div>`).join('')}
      <button onclick="this.closest('.fixed').remove()" style="width:100%;height:40px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;margin-top:12px;">Close</button>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}
