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
  
  // Converti in base64
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
    
    // Chiudi il modal corrente
    input.closest('.fixed').remove();
    // One Question Rule: controlla ambiguità prima di mostrare preview
    await runOneQuestionRule(data, showInvoicePreview);
    
  }catch(e){
    status.textContent='❌ Error: '+e.message;
  }
}

function showInvoicePreview(data){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  
  const itemsHtml=(data.items||[]).map((item,idx)=>`
    <div style="padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:#1e3a5f;font-weight:500;">${item.description||'Unknown'}</div>
          <div style="font-size:11px;color:#93c5fd;margin-top:2px;">${item.quantity||''} ${item.unit||''} ${item.pack_size?'• '+item.pack_size:''} ${item.brand?'• '+item.brand:''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:8px;">
          <div style="font-size:13px;color:#1e3a5f;">$${(item.amount||0).toFixed(2)}</div>
          <div style="font-size:11px;color:#93c5fd;">@$${(item.unit_price||0).toFixed(2)}</div>
        </div>
      </div>
    </div>`).join('');
  
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      
      <!-- Header fattura -->
      <div style="background:rgba(59,130,246,0.06);border-radius:14px;padding:12px;margin-bottom:14px;">
        <div style="font-size:16px;font-weight:500;color:#1e3a5f;margin-bottom:6px;">${data.vendor||'Unknown Vendor'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
          <div style="font-size:11px;color:#93c5fd;">Invoice #<br><span style="color:#1e3a5f;font-weight:500;">${data.invoice_number||'—'}</span></div>
          <div style="font-size:11px;color:#93c5fd;">Date<br><span style="color:#1e3a5f;font-weight:500;">${data.invoice_date||'—'}</span></div>
          <div style="font-size:11px;color:#93c5fd;">Terms<br><span style="color:#1e3a5f;font-weight:500;">${data.payment_terms||'—'}</span></div>
          <div style="font-size:11px;color:#93c5fd;">Total<br><span style="color:#1e3a5f;font-weight:500;font-size:14px;">$${(data.total||0).toFixed(2)}</span></div>
        </div>
      </div>
      
      <!-- Lista prodotti -->
      <div style="font-size:11px;font-weight:500;color:#93c5fd;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">${(data.items||[]).length} Items</div>
      <div style="margin-bottom:14px;">${itemsHtml}</div>
      
      <!-- Totali -->
      <div style="background:rgba(59,130,246,0.04);border-radius:12px;padding:10px;margin-bottom:14px;">
        ${data.subtotal?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;"><span>Subtotal</span><span>$${data.subtotal.toFixed(2)}</span></div>`:''}
        ${data.tax?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;"><span>Tax</span><span>$${data.tax.toFixed(2)}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:500;color:#1e3a5f;"><span>Total</span><span>$${(data.total||0).toFixed(2)}</span></div>
      </div>
      
      <!-- Bottoni -->
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
    const{error}=await supa.from('purchases').insert({
      vendor: data.vendor||null,
      invoice_number: data.invoice_number||null,
      invoice_date: data.invoice_date||null,
      payment_terms: data.payment_terms||null,
      subtotal: data.subtotal||null,
      tax: data.tax||null,
      total: data.total||null,
      items: data.items||[],
      uploaded_by: user?.name||'Max'
    });
    
    if(error) throw error;
    
    btn.closest('.fixed').remove();
    
    const toast=document.createElement('div');
    toast.className='sc-toast fixed top-16 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl';
    toast.textContent=`✓ Invoice from ${data.vendor||'vendor'} saved — $${(data.total||0).toFixed(2)}`;
    document.body.appendChild(toast);
    setTimeout(()=>toast.remove(),3000);
    
    // salva anche nelle nuove invoice_lines per storico/prezzi
    saveToInvoiceLines(data);
    // suggerisci match ingredienti dopo 2 secondi
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
  showInvoicePreview(data);
}


// ── MATCH INGREDIENTI ──
async function suggestIngredientMatches(invoiceData){
  if(!invoiceData.items||!invoiceData.items.length) return;
  
  // carica ingredienti esistenti da ricette
  const{data:recipes}=await supa.from('recipes').select('ingredients');
  const allIngredients=new Set();
  (recipes||[]).forEach(r=>{
    (r.ingredients||[]).forEach(i=>{ if(i.name) allIngredients.add(i.name); });
  });
  
  if(!allIngredients.size) return;
  
  // carica link già esistenti per questo vendor
  const{data:existingLinks}=await supa.from('ingredient_links')
    .select('invoice_description')
    .eq('vendor', invoiceData.vendor||'');
  const linked=new Set((existingLinks||[]).map(l=>l.invoice_description.toLowerCase()));
  
  // filtra solo items non ancora collegati
  const unlinked=invoiceData.items.filter(i=>
    i.description && !linked.has(i.description.toLowerCase())
  );
  
  if(!unlinked.length) return;
  
  // chiedi a Groq i suggerimenti
  const ingredientList=[...allIngredients].join(', ');
  const itemList=unlinked.map(i=>`"${i.description}"`).join(', ');
  
  showScToast('🔗 Analizzando ingredienti...');
  
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
    
    // mostra modal conferma
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
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px;background:rgba(59,130,246,0.05);border-radius:12px;margin-bottom:8px;';
    row.innerHTML=`
      <input type="checkbox" id="match_${idx}" checked style="width:18px;height:18px;cursor:pointer;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;color:#93c5fd;">Invoice item</div>
        <div style="font-size:13px;color:#1e3a5f;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.invoice_item}</div>
        <div style="font-size:11px;color:#93c5fd;margin-top:2px;">→ <span style="color:#3B82F6;">${m.ingredient}</span> <span style="color:#93c5fd;">(${Math.round((m.confidence||0)*100)}%)</span></div>
      </div>`;
    row.dataset.invoiceItem=m.invoice_item;
    row.dataset.ingredient=m.ingredient;
    list.appendChild(row);
  });
  
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
  
  // salva riferimento matches per saveAllMatches
  window._pendingMatches={matches, vendor};
}

async function saveAllMatches(vendor){
  if(!window._pendingMatches) return;
  const{matches}=window._pendingMatches;
  const checkboxes=document.querySelectorAll('[id^="match_"]');
  
  const toSave=[];
  checkboxes.forEach((cb,idx)=>{
    if(cb.checked && matches[idx]){
      toSave.push({
        invoice_description: matches[idx].invoice_item,
        ingredient_name: matches[idx].ingredient,
        vendor: vendor||null,
        confirmed: true
      });
    }
  });
  
  if(!toSave.length) return;
  
  await supa.from('ingredient_links').upsert(toSave, {
    onConflict:'invoice_description,vendor'
  });
  
  showScToast(`✓ ${toSave.length} ingredient links saved`);
  window._pendingMatches=null;
}


// ── ONE QUESTION RULE ─────────────────────────────────────────
// Controlla ambiguità DOPO che la fattura è stata letta dall'AI
// Chiama questa funzione invece di showInvoicePreview direttamente
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

  // Applica risposte già note agli item
  items.forEach(item=>{
    if(knownMap[item.description]){
      Object.assign(item, knownMap[item.description]);
      item._clarified = true;
    }
  });

  // Trova prima riga ancora ambigua (needs_clarification = true e non già risolta)
  const ambiguous = items.find(i => i.needs_clarification && !i._clarified);

  if(!ambiguous){ onComplete(data); return; }

  // Mostra modal con UNA domanda
  showOneQuestionModal(ambiguous, data, onComplete);
}

function showOneQuestionModal(item, invoiceData, onComplete){
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[70] flex items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.5)';

  const question = item.clarification_question || `"${item.description}" — price is per:`;
  const options = item.clarification_options || [
    {label:'Each / unit', value:'each'},
    {label:'Case (CS)', value:'cs'},
    {label:'Pound (lb)', value:'lb'},
    {label:'Not sure', value:'skip'}
  ];

  modal.innerHTML = `
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
  btn.style.background = '#1e3a5f';
  btn.style.color = 'white';

  const modal = document.getElementById('oqModal');
  const item = modal._item;
  const invoiceData = modal._invoiceData;
  const onComplete = modal._onComplete;

  // Risoluzione in base alla risposta
  const resolution = answer === 'skip' ? {skipped:true} : {purchase_unit: answer, price_is_per: answer};
  Object.assign(item, resolution);
  item._clarified = true;
  item.needs_clarification = false;

  // Salva in DB — così non chiede mai più la stessa cosa
  if(answer !== 'skip'){
    await supa.from('invoice_line_clarifications').upsert({
      vendor:          vendor,
      raw_description: rawDesc,
      question:        item.clarification_question||'',
      answer:          answer,
      resolution:      resolution,
      answered_by:     user?.name||'Max'
    }, {onConflict:'vendor,raw_description'});
  }

  await new Promise(r=>setTimeout(r,150));
  modal.remove();

  // Continua — controlla se ci sono altre ambiguità
  runOneQuestionRule(invoiceData, onComplete);
};

// ── SALVA IN invoice_lines (nuova tabella) ───────────────────
async function saveToInvoiceLines(data){
  const lines = (data.items||[]).map(item=>({
    invoice_date:           data.invoice_date||new Date().toISOString().slice(0,10),
    invoice_number:         data.invoice_number||null,
    vendor:                 data.vendor||'Unknown',
    raw_description:        item.description||'',
    vendor_sku:             item.vendor_sku||null,
    qty:                    parseFloat(item.quantity||item.qty)||null,
    purchase_unit:          item.purchase_unit||item.unit||null,
    pack_description:       item.pack_size||null,
    unit_price:             parseFloat(item.unit_price)||null,
    line_total:             parseFloat(item.amount||item.line_total)||null,
    needs_clarification:    !!(item.needs_clarification && !item._clarified),
    clarification_answered: !!(item._clarified),
    match_status:           'unmatched'
  }));

  const {error} = await supa.from('invoice_lines').insert(lines);
  if(error) console.warn('invoice_lines:', error.message);
}
