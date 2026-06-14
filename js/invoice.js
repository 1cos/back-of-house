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
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
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
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({imageBase64:base64,mimeType:file.type})
    });
    const data=await res.json();
    if(data.error){status.textContent='❌ Error: '+data.error;return;}
    if(!data.items||!data.items.length){
      status.textContent='❌ Could not read invoice — try a clearer photo';
      console.error('process-invoice returned empty:',JSON.stringify(data).slice(0,200));
      return;
    }
    input.closest('.fixed').remove();
    enrichInvoiceItems(data);
    await runOneQuestionRule(data,showInvoicePreview);
  }catch(e){
    status.textContent='❌ Error: '+e.message;
    console.error('processInvoiceFile error:',e);
  }
}

// ── PACK FORMAT PARSER ────────────────────────────────────────
function parsePackFormat(str){
  if(!str) return null;
  let s=String(str).trim().replace(/#/g,'lb').replace(/\b(bag|box|pack|bx)\b/gi,'').trim().toUpperCase();
  let m;
  // Mixed number: "9-1/2 GAL" = 9.5 gal (Hardie's liquid format)
  m=s.match(/^(\d+)-(\d+)\/(\d+)\s*([A-Z]+)/);
  if(m) return {count:1,sizeEach:parseInt(m[1])+parseInt(m[2])/parseInt(m[3]),unit:m[4].toLowerCase()};
  // count/subcount-sizeUNIT: "6/4-2OZ" = 6 packs × 4 pcs × 2oz
  m=s.match(/^(\d+)\/(\d+)-(\d+\.?\d*)\s*([A-Z]+)/);
  if(m) return {count:parseFloat(m[1]),subcount:parseFloat(m[2]),sizeEach:parseFloat(m[3]),unit:m[4].toLowerCase()};
  // N pc/ea / N unit: "1pc / 28lb", "6ea/1GAL"
  m=s.match(/^\d+\s*(?:PC|PCS|EA|EACH|CT)\s*\/\s*([\d.]+)\s*([A-Z]+)/);
  if(m) return {count:1,sizeEach:parseFloat(m[1]),unit:m[2].toLowerCase()};
  // count X size unit: "4 X 5 LB"
  m=s.match(/^(\d+)\s*X\s*([\d.]+)\s*([A-Z_]+)/);
  if(m) return {count:parseFloat(m[1]),sizeEach:parseFloat(m[2]),unit:m[3].toLowerCase()};
  // count/size unit: "2/5 LB", "12/3 CT"
  m=s.match(/^(\d+)\s*\/\s*([\d.]+)\s*([A-Z_]+)/);
  if(m) return {count:parseFloat(m[1]),sizeEach:parseFloat(m[2]),unit:m[3].toLowerCase()};
  // size unit: "10LB", "28LB", "12OZ"
  m=s.match(/^([\d.]+)\s*([A-Z]+)$/);
  if(m) return {count:1,sizeEach:parseFloat(m[1]),unit:m[2].toLowerCase()};
  // count each: "24 EA", "100 CT"
  m=s.match(/^(\d+)\s*(EA|EACH|PC|PCS|CT|COUNT)$/);
  if(m) return {count:parseFloat(m[1]),sizeEach:1,unit:'each'};
  return null;
}

// UUID validation — purchases.id is integer, invoice_lines.import_id is UUID
function isValidUUID(v){
  return typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const UNIT_TO_G={
  'g':1,'kg':1000,'lb':453.592,'oz':28.3495,
  'lbs':453.592,'pound':453.592,'pounds':453.592,
  'ml':1,'l':1000,'liter':1000,'litre':1000,
  'gal':3785.41,'qt':946.353,'pt':473.176,'fl_oz':29.5735,
};
function unitToG(unit){return UNIT_TO_G[(unit||'').toLowerCase().trim()]||null;}

function calcTotalWeightG(item){
  const qty=parseFloat(item.quantity||item.qty)||1;
  if(item.pack_size||item.pack_description){
    const p=parsePackFormat(item.pack_size||item.pack_description);
    if(p&&p.unit!=='each'){
      const f=unitToG(p.unit);
      // subcount handles "6/4-2OZ" → count=6, subcount=4, sizeEach=2
      if(f) return qty*p.count*(p.subcount||1)*p.sizeEach*f;
    }
  }
  const pu=(item.purchase_unit||item.unit||'').toLowerCase();
  if(pu&&pu!=='each'&&pu!=='cs'&&pu!=='case'){const f=unitToG(pu);if(f)return qty*f;}
  if(item.pack_qty&&item.pack_unit&&item.pack_unit!=='each'){
    const f=unitToG(item.pack_unit);if(f)return qty*parseFloat(item.pack_qty)*f;
  }
  if(item.avg_unit_weight_g){
    const ps=parsePackFormat(item.pack_size||item.pack_description);
    const units=ps?ps.count*ps.sizeEach:qty;
    return units*parseFloat(item.avg_unit_weight_g);
  }
  return null;
}

function detectPriceType(item){
  // Regola: qty × unit_price ≈ extended_price (±1%) → per_case
  //         qty × unit_price ≠ extended_price → per_lb (prezzo a lb, extended = unit_price × peso reale)
  const qty       = parseFloat(item.quantity||item.qty)||1;
  const unitPrice = parseFloat(item.unit_price)||null;
  const extended  = parseFloat(item.extended_price||item.amount)||null;
  if(!unitPrice||!extended) return 'per_case'; // default se mancano dati
  const expected = qty * unitPrice;
  const ratio    = Math.abs(extended - expected) / expected;
  if(ratio < 0.01) return 'per_case'; // coincide → prezzo per confezione
  return 'per_lb';                    // non coincide → prezzo per lb
}

function enrichInvoiceItems(data){
  (data.items||[]).forEach(item=>{
    // Determina price_type prima di tutto
    item._price_type = detectPriceType(item);

    const totalG=calcTotalWeightG(item);
    item._total_weight_g=totalG;
    const price=parseFloat(item.unit_price||item.amount)||null;

    // Calcola cost_per_100g in base al price_type
    if(item._price_type === 'per_lb' && price){
      // Prezzo a lb: calcolo diretto senza bisogno del peso del pack
      item._cost_per_100g = parseFloat(((price / 453.592) * 100).toFixed(4));
    } else if(totalG && price){
      item._cost_per_100g = parseFloat(((price / totalG) * 100).toFixed(4));
    } else {
      item._cost_per_100g = null;
    }

    if(!totalG&&!item.needs_clarification){
      const pu=(item.purchase_unit||item.unit||'').toLowerCase();
      const pack=item.pack_size||item.pack_description||'';
      const isCountOnly=/\b(ct|ea|each|pc|pcs|count)\b/i.test(pack)&&!/\b(lb|oz|g|kg|gal|qt|pt|ml|l)\b/i.test(pack);
      // Per articoli per_lb non serve il peso del pack
      if(item._price_type !== 'per_lb' && !isCountOnly&&(pu==='each'||pu==='cs'||pu==='case'||!pu)){
        item._needs_weight_clarification=true;
      }
    }
  });
}

async function checkPriceAnomalies(data){
  // Skipped until cost_per_100g column added to invoice_lines via migration
}

// ── INVOICE PREVIEW ───────────────────────────────────────────
function showInvoicePreview(data){
  document.getElementById('_invoicePreviewModal')?.remove();
  const modal=document.createElement('div');
  modal.id='_invoicePreviewModal';
  // z-9000 via inline style — sopra il Vendor Parser modal (z-65) e tutto il resto
  modal.style.cssText='position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.55);';
  // Dati salvati sull'elemento — mai inline JSON.stringify in onclick
  // (apostrofi nei nomi vendor tipo "Hardie's" rompono il parsing HTML)
  modal._invoiceData=data;
  const itemsHtml=(data.items||[]).map(item=>{
    const weightLine=item._total_weight_g
      ?`<span style="color:#10b981;">${item._total_weight_g>=1000?(item._total_weight_g/1000).toFixed(2)+'kg':Math.round(item._total_weight_g)+'g'}</span>`
      :`<span style="color:#f59e0b;">⚠️ weight unknown</span>`;
    const costLine=item._cost_per_100g?` · $${item._cost_per_100g.toFixed(2)}/100g`:'';
    return `
    <div style="padding:8px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:#1e3a5f;font-weight:500;">${item.description||'Unknown'}</div>
          <div style="font-size:11px;color:#93c5fd;margin-top:2px;">${item.quantity||''} ${item.unit||''} ${item.pack_size?'· '+item.pack_size:''}</div>
          <div style="font-size:11px;margin-top:1px;">${weightLine}${costLine}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:8px;">
          <div style="font-size:13px;color:#1e3a5f;">$${(item.amount||0).toFixed(2)}</div>
          <div style="font-size:11px;color:#93c5fd;">@$${(item.unit_price||0).toFixed(2)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  const noWeight=(data.items||[]).filter(i=>!i._total_weight_g).length;
  const warningBar=noWeight?`<div style="background:rgba(245,158,11,0.08);border:0.5px solid rgba(245,158,11,0.3);border-radius:12px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#92400e;">📦 ${noWeight} item${noWeight>1?'s':''} without calculable weight — flagged for review.</div>`:'';
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.98);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;">
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
        <button id="_ipCancel" style="height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;">Cancel</button>
        <button id="_ipSave" style="height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">✓ Save Invoice</button>
      </div>
    </div>`;
  modal.querySelector('#_ipCancel').addEventListener('click',()=>modal.remove());
  modal.querySelector('#_ipSave').addEventListener('click',function(){saveInvoice(modal._invoiceData,this);});
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}

async function saveInvoice(data,btn){
  btn.textContent='Saving...'; btn.disabled=true;
  try{
    // Anti-duplicate: check if same vendor+date+total already saved
    if(data.invoice_date&&data.vendor){
      const q=supa.from('purchases')
        .select('id').eq('vendor',data.vendor).eq('invoice_date',data.invoice_date);
      if(data.total) q.eq('total',data.total);
      const{data:existing}=await q.limit(1);
      if(existing&&existing.length){
        btn.textContent='✓ Save Invoice'; btn.disabled=false;
        showDuplicateInvoiceModal(data,btn);
        return;
      }
    }
    const{data:purchase,error}=await supa.from('purchases').insert({
      vendor:data.vendor||null,invoice_number:data.invoice_number||null,
      invoice_date:data.invoice_date||null,payment_terms:data.payment_terms||null,
      subtotal:data.subtotal||null,tax:data.tax||null,total:data.total||null,
      items:data.items||[],uploaded_by:user?.name||'Max'
    }).select().single();
    if(error) throw error;
    data._purchase_id=purchase?.id||null;
    (document.getElementById('_invoicePreviewModal')||btn.closest('.fixed'))?.remove();

    const savedLines=await saveToInvoiceLines(data);
    data._lineIdMap={};
    (savedLines||[]).forEach(row=>{
      if(row.id&&row.raw_description) data._lineIdMap[row.raw_description]=row.id;
    });

    // Classify each item before opening the success modal
    const descs=(data.items||[]).map(i=>i.description).filter(Boolean);
    const vendor=data.vendor||'';
    // Step 1: check ingredient_links for previously matched items
    const{data:links}=await supa.from('ingredient_links')
      .select('invoice_description,ingredient_name,ingredient_id,confirmed')
      .eq('vendor',vendor).in('invoice_description',descs);
    // Step 2: get price history only for matched ingredient IDs
    const linkedIds=(links||[]).map(l=>l.ingredient_id).filter(Boolean);
    let priceRows=[];
    if(linkedIds.length){
      const{data:pr}=await supa.from('ingredient_vendors')
        .select('ingredient_id,unit_price,last_invoice_date')
        .in('ingredient_id',linkedIds).eq('vendor',vendor);
      priceRows=pr||[];
    }
    const linkMap={};
    (links||[]).forEach(l=>{linkMap[l.invoice_description]={ingredient_name:l.ingredient_name,ingredient_id:l.ingredient_id,confirmed:l.confirmed};});
    const priceMap={};
    priceRows.forEach(p=>{priceMap[p.ingredient_id]=parseFloat(p.unit_price)||null;});

    (data.items||[]).forEach(item=>{
      const link=linkMap[item.description];
      if(!link){
        item._match_status='new';
      } else {
        item._matched_ingredient=link.ingredient_name;
        item._matched_ingredient_id=link.ingredient_id;
        const prevPrice=link.ingredient_id?priceMap[link.ingredient_id]:null;
        const currPrice=parseFloat(item.unit_price)||null;
        if(prevPrice&&currPrice){
          const diff=currPrice-prevPrice;
          const pct=Math.round((diff/prevPrice)*100);
          if(Math.abs(pct)>=2){
            item._match_status=diff>0?'price_up':'price_down';
            item._prev_price=prevPrice;
            item._price_pct=pct;
          } else {
            item._match_status='ok';
          }
        } else {
          item._match_status='ok';
        }
      }
    });

    // For items still 'new', search ingredients DB for fuzzy matches
    // Extract 1-2 meaningful keywords from the invoice description
    function extractKeywords(desc){
      const stop=['large','small','medium','fresh','whole','sliced','diced','chopped',
        'frozen','dried','organic','baby','jumbo','xl','super','grade','choice',
        'usa','mex','loc','local','whl','fr','loc','cs','ct','ea','each','lb','oz','gal'];
      return (desc||'').toLowerCase()
        .replace(/[^a-z0-9 ]/g,' ')
        .split(/\s+/)
        .filter(w=>w.length>2&&!stop.includes(w))
        .slice(0,2);
    }

    // Fetch all active ingredients for matching and autocomplete
    const{data:allIngr}=await supa.from('ingredients')
      .select('id,name,category').eq('active',true);
    // Filter out Supply in JS — .neq() on null fields excludes nulls in PostgREST
    const ingr=(allIngr||[]).filter(i=>i.category!=='Supply');
    const newItems=(data.items||[]).filter(i=>i._match_status==='new');
    if(newItems.length){

      newItems.forEach(item=>{
        const keywords=extractKeywords(item.description);
        if(!keywords.length) return;

        // Score each ingredient: count how many keywords appear in its name
        const scored=ingr.map(ing=>{
          const ingLower=ing.name.toLowerCase();
          const score=keywords.filter(kw=>ingLower.includes(kw)).length;
          return {ing,score};
        }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);

        if(scored.length){
          const best=scored[0];
          const topCandidates=scored.filter(x=>x.score===best.score).slice(0,3);
          item._candidates=topCandidates.map(x=>({id:x.ing.id,name:x.ing.name}));

          const firstKw=keywords[0];
          // Find exact/plural/singular match among all scored
          const exactScored=scored.find(x=>{
            const n=x.ing.name.toLowerCase();
            return n===firstKw||n===firstKw+'s'||n===firstKw.replace(/s$/,'')||
              n===keywords.join(' ')||n===keywords.join(' ')+'s';
          });
          // Pick best: exact match first, then shortest among top candidates
          const pickedItem=exactScored||topCandidates.reduce((a,b)=>
            a.ing.name.length<=b.ing.name.length?a:b
          );
          const shouldSuggest=!!(exactScored||topCandidates.length===1||
            topCandidates.some(x=>x.ing.name.toLowerCase()===firstKw||x.ing.name.toLowerCase()===firstKw+'s'));
          if(shouldSuggest){
            item._match_status='suggest';
            item._suggested_ingredient=pickedItem.ing.name;
            item._suggested_ingredient_id=pickedItem.ing.id;
          } else {
            item._match_status='new';
          }
        }
      });
    } // end if(newItems.length)

    await showSaveSuccessModal({data,linesCreated:savedLines?.length||0,linesError:!savedLines?1:0,ingr});
  }catch(e){
    const isDuplicate=e.code==='23505'||/duplicate|unique/i.test(e.message||'');
    if(isDuplicate){
      btn.textContent='✓ Save Invoice'; btn.disabled=false;
      showDuplicateInvoiceModal(data,btn);
      return;
    }
    btn.textContent='Error — retry'; btn.disabled=false;
    console.error('saveInvoice error:',e);
    showScToast('❌ Error saving invoice: '+e.message);
  }
}

function showDuplicateInvoiceModal(data,btn){
  // Close the preview modal
  btn.closest('.fixed')?.remove();
  document.getElementById('_invoicePreviewModal')?.remove();
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;z-index:9100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:24px;width:88%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.25);text-align:center;">
      <div style="font-size:32px;margin-bottom:12px;">🗂️</div>
      <div style="font-size:15px;font-weight:600;color:#1e3a5f;margin-bottom:6px;">This invoice already exists.</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:20px;">${data.vendor||''}${data.invoice_number?' · #'+data.invoice_number:''}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="_dupHistory" style="height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">Open Purchase History</button>
        <button id="_dupCancel" style="height:44px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;">Cancel</button>
      </div>
    </div>`;
  modal.querySelector('#_dupHistory').addEventListener('click',()=>{modal.remove();openPurchaseHistory();});
  modal.querySelector('#_dupCancel').addEventListener('click',()=>modal.remove());
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}

async function showSaveSuccessModal({data,linesCreated,linesError,ingr=[]}){
  // For 'new' items, ask AI for ingredient name suggestions
  const newItems=(data.items||[]).filter(i=>i._match_status==='new');
  const aiSuggestions={};
  if(newItems.length){
    try{
      const res=await fetch(`${SUPABASE_URL}/functions/v1/souschef-classify`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
        body:JSON.stringify({
          transcript:'You are a kitchen ingredient matcher. For each invoice item return 2-3 short canonical ingredient name suggestions in English. Return ONLY a JSON object: {"ITEM_DESCRIPTION":["Suggestion1","Suggestion2"],...}. No markdown, no preamble.',
          kitchenData:newItems.map(i=>i.description)
        })
      });
      const rd=await res.json();
      const raw=rd.result?.answer||rd.result?.summary||rd.answer||rd.summary||'';
      const cleaned=raw.replace(/```json|```/g,'').trim();
      try{Object.assign(aiSuggestions,JSON.parse(cleaned));}catch(_){}
    }catch(_){}
  }

  const modal=document.createElement('div');
  modal.id='_saveSuccessModal';
  modal.style.cssText='position:fixed;inset:0;z-index:9200;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.55);';

  const meta=[
    data.invoice_number?'#'+data.invoice_number:'',
    data.invoice_date||'',
  ].filter(Boolean).join(' · ');

  // ── renders a single item row — called on mount and after each action ──
  function renderItemCard(item,modal){
    const el=document.createElement('div');
    el.dataset.desc=item.description;
    el.style.cssText='border:0.5px solid rgba(59,130,246,0.12);border-radius:12px;padding:10px 12px;margin-bottom:8px;';

    // Header row
    const header=document.createElement('div');
    header.style.cssText='display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;';
    const nameDiv=document.createElement('div');
    nameDiv.style.cssText='font-size:13px;font-weight:500;color:#1e3a5f;flex:1;min-width:0;';
    nameDiv.textContent=item.description||'—';
    const badgeDiv=document.createElement('div');
    badgeDiv.style.cssText='flex-shrink:0;';

    let badgeHtml='',badgeBg='',badgeColor='';
    if(item._match_status==='suggest'){
      badgeBg='rgba(59,130,246,0.08)';badgeColor='#1d4ed8';badgeHtml='? '+item._suggested_ingredient;
    } else if(item._match_status==='new'){
      badgeBg='rgba(245,158,11,0.12)';badgeColor='#92400e';badgeHtml='🟡 New item';
    } else if(item._match_status==='ok'){
      badgeBg='rgba(16,185,129,0.1)';badgeColor='#065f46';badgeHtml='✓ '+(item._matched_ingredient||'Matched');
    } else if(item._match_status==='price_up'){
      badgeBg='rgba(239,68,68,0.08)';badgeColor='#991b1b';
      badgeHtml='↑ '+(item._price_pct>0?'+':'')+item._price_pct+'%';
    } else if(item._match_status==='price_down'){
      badgeBg='rgba(59,130,246,0.08)';badgeColor='#1d4ed8';
      badgeHtml='↓ '+item._price_pct+'%';
    } else if(item._match_status==='done'){
      badgeBg='rgba(16,185,129,0.1)';badgeColor='#065f46';badgeHtml='✓ Saved';
    }
    badgeDiv.innerHTML='<span style="background:'+badgeBg+';color:'+badgeColor+';font-size:11px;font-weight:500;padding:3px 8px;border-radius:8px;">'+badgeHtml+'</span>';
    header.appendChild(nameDiv);
    header.appendChild(badgeDiv);
    el.appendChild(header);

    // Sub info
    const sub=document.createElement('div');
    sub.style.cssText='font-size:11px;color:#64748b;margin-bottom:8px;';
    const parts=[
      item.pack_size||item.pack_description||'',
      item.unit_price?'$'+parseFloat(item.unit_price).toFixed(2):'',
      item._cost_per_100g?'$'+item._cost_per_100g.toFixed(2)+'/100g':'',
    ].filter(Boolean);
    if(item._match_status==='price_up'||item._match_status==='price_down'){
      parts.push('was $'+item._prev_price.toFixed(2));
    }
    if(item._matched_ingredient&&item._match_status!=='ok'&&item._match_status!=='done'){
      parts.unshift(item._matched_ingredient);
    }
    sub.textContent=parts.join(' · ');
    if(parts.length) el.appendChild(sub);

    // Action area
    const actions=document.createElement('div');
    actions.style.cssText='display:flex;gap:6px;flex-wrap:wrap;';

    if(item._match_status==='suggest'){
      // DB found a likely match — one-tap confirm
      const yesBtn=document.createElement('button');
      yesBtn.textContent='Yes — '+item._suggested_ingredient;
      yesBtn.style.cssText='font-size:12px;padding:7px 14px;border-radius:10px;background:rgba(16,185,129,0.1);color:#065f46;border:0.5px solid rgba(16,185,129,0.3);cursor:pointer;font-weight:500;';
      yesBtn.addEventListener('click',async function(){
        yesBtn.textContent='Saving...';yesBtn.disabled=true;
        await linkItemToIngredient(item,item._suggested_ingredient,data,modal,item._suggested_ingredient_id);
      });
      actions.appendChild(yesBtn);
      // Other candidates
      if(item._candidates&&item._candidates.length>1){
        item._candidates.slice(1).forEach(function(c){
          const b=document.createElement('button');
          b.textContent=c.name;
          b.style.cssText='font-size:11px;padding:5px 10px;border-radius:8px;background:rgba(59,130,246,0.06);color:#1d4ed8;border:0.5px solid rgba(59,130,246,0.2);cursor:pointer;';
          b.addEventListener('click',async function(){b.textContent='Saving...';b.disabled=true;await linkItemToIngredient(item,c.name,data,modal,c.id);});
          actions.appendChild(b);
        });
      }
      const notThis=document.createElement('button');
      notThis.textContent='Not this';
      notThis.style.cssText='font-size:11px;padding:5px 10px;border-radius:8px;background:rgba(0,0,0,0.04);color:#64748b;border:0.5px solid #e2e8f0;cursor:pointer;';
      notThis.addEventListener('click',function(){item._match_status='new';item._candidates=[];refreshItemCard(item,modal);});
      actions.appendChild(notThis);

    } else if(item._match_status==='new'){
      // No DB match — AI suggestions + manual input
      const suggs=aiSuggestions[item.description]||[];
      suggs.forEach(function(s){
        const b=document.createElement('button');
        b.textContent=s;
        b.style.cssText='font-size:11px;padding:5px 10px;border-radius:8px;background:rgba(59,130,246,0.08);color:#1d4ed8;border:0.5px solid rgba(59,130,246,0.25);cursor:pointer;';
        b.addEventListener('click',async function(){
          b.textContent='Saving...';b.disabled=true;
          await linkItemToIngredient(item,s,data,modal);
        });
        actions.appendChild(b);
      });
      // Custom name input
      const wrap=document.createElement('div');
      wrap.style.cssText='display:flex;gap:4px;width:100%;margin-top:4px;';
      const inp=document.createElement('input');
      inp.type='text';inp.placeholder='Type ingredient name...';
      inp.style.cssText='flex:1;font-size:11px;padding:5px 8px;border:0.5px solid #e2e8f0;border-radius:8px;outline:none;';
      inp.setAttribute('list','_ingrDatalist');
      // Datalist for autocomplete — populated from ingredients already fetched
      if(!document.getElementById('_ingrDatalist')&&ingr.length){
        const dl=document.createElement('datalist');
        dl.id='_ingrDatalist';
        ingr.forEach(function(i){const opt=document.createElement('option');opt.value=i.name;dl.appendChild(opt);});
        document.body.appendChild(dl);
      }
      const confirmBtn=document.createElement('button');
      confirmBtn.textContent='Link';
      confirmBtn.style.cssText='font-size:11px;padding:5px 10px;border-radius:8px;background:#1e3a5f;color:white;border:none;cursor:pointer;';
      confirmBtn.addEventListener('click',async function(){
        const val=inp.value.trim();
        if(!val)return;
        confirmBtn.textContent='...';confirmBtn.disabled=true;
        await linkItemToIngredient(item,val,data,modal);
      });
      inp.addEventListener('keydown',function(e){if(e.key==='Enter'){confirmBtn.click();}});
      wrap.appendChild(inp);wrap.appendChild(confirmBtn);
      actions.appendChild(wrap);
      // Skip
      const skip=document.createElement('button');
      skip.textContent='Skip for now';
      skip.style.cssText='font-size:11px;padding:5px 10px;border-radius:8px;background:rgba(0,0,0,0.04);color:#64748b;border:0.5px solid #e2e8f0;cursor:pointer;';
      skip.addEventListener('click',function(){
        item._match_status='done';item._matched_ingredient='(skipped)';
        refreshItemCard(item,modal);
        refreshDoneButton(data,modal);
      });
      actions.appendChild(skip);

    } else if(item._match_status==='price_up'||item._match_status==='price_down'){
      const acceptBtn=document.createElement('button');
      acceptBtn.textContent='Accept new price';
      const col=item._match_status==='price_up'?'#991b1b':'#1d4ed8';
      const bg=item._match_status==='price_up'?'rgba(239,68,68,0.08)':'rgba(59,130,246,0.08)';
      acceptBtn.style.cssText='font-size:11px;padding:5px 10px;border-radius:8px;background:'+bg+';color:'+col+';border:0.5px solid '+col+'40;cursor:pointer;';
      acceptBtn.addEventListener('click',async function(){
        acceptBtn.textContent='Saving...';acceptBtn.disabled=true;
        await acceptPriceChange(item,data);
        item._match_status='done';
        refreshItemCard(item,modal);
        refreshDoneButton(data,modal);
      });
      actions.appendChild(acceptBtn);
    }

    if(actions.children.length) el.appendChild(actions);
    return el;
  }

  function refreshItemCard(item,modal){
    const old=modal.querySelector('[data-desc="'+item.description.replace(/"/g,'\\"')+'"]');
    if(old) old.replaceWith(renderItemCard(item,modal));
  }

  function refreshDoneButton(data,modal){
    const pending=(data.items||[]).filter(i=>i._match_status==='new'||i._match_status==='price_up'||i._match_status==='price_down');
    const doneBtn=document.getElementById('_ssDone');
    if(!doneBtn)return;
    if(!pending.length){
      doneBtn.style.background='#10b981';
      doneBtn.textContent='✓ All done';
    }
  }

  // Build modal HTML shell
  const allOk=(data.items||[]).every(i=>i._match_status==='ok');
  modal.innerHTML='<div style="background:rgba(255,255,255,0.98);border-radius:24px 24px 0 0;padding:20px;width:100%;max-width:480px;margin:0 auto;max-height:85vh;overflow-y:auto;">'
    +'<div style="width:36px;height:4px;background:rgba(16,185,129,0.3);border-radius:2px;margin:0 auto 16px;"></div>'
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">'
      +'<div style="width:42px;height:42px;border-radius:13px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;color:#065f46;">✓</div>'
      +'<div>'
        +'<div style="font-size:15px;font-weight:500;color:#1e3a5f;">Invoice saved</div>'
        +'<div style="font-size:12px;color:#64748b;margin-top:1px;">'+(data.vendor||'Unknown Vendor')+(meta?' · '+meta:'')+'</div>'
      +'</div>'
    +'</div>'
    +'<div style="background:rgba(16,185,129,0.07);border:0.5px solid rgba(16,185,129,0.2);border-radius:12px;padding:8px 14px;margin-bottom:14px;font-size:12px;color:#065f46;">'
      +linesCreated+' line'+(linesCreated!==1?'s':'')+' saved'+(linesError?' · ⚠️ '+linesError+' error':'')
    +'</div>'
    +'<div id="_ssItems" style="margin-bottom:14px;"></div>'
    +'<div style="display:flex;flex-direction:column;gap:8px;">'
      +'<button id="_ssDone" style="height:44px;border-radius:14px;background:'+(allOk?'#10b981':'#1e3a5f')+';color:white;font-size:13px;font-weight:500;border:none;cursor:pointer;">'+(allOk?'✓ All done':'Done')+'</button>'
    +'</div>'
    +'</div>';

  modal.querySelector('#_ssDone').addEventListener('click',()=>{
    // Close all modals and return to home
    modal.remove();
    document.querySelectorAll('.fixed').forEach(m=>m.remove());
    const homeTab=document.querySelector('[data-t="h"]');
    if(homeTab) homeTab.click();
  });
  document.body.appendChild(modal);

  // Render item cards
  const container=document.getElementById('_ssItems');
  (data.items||[]).forEach(function(item){
    container.appendChild(renderItemCard(item,modal));
  });
  refreshDoneButton(data,modal);
}

async function linkItemToIngredient(item,ingredientName,data,modal,knownId){
  const vendor=data.vendor||'';
  // Find or create ingredient (skip if knownId already provided)
  let ingrId=knownId||null;
  if(!ingrId){
    const{data:found}=await supa.from('ingredients').select('id').ilike('name',ingredientName).eq('active',true).limit(1);
    if(found?.length){
      ingrId=found[0].id;
    } else {
      const{data:created,error:ce}=await supa.from('ingredients').insert({
        name:ingredientName,category:'Other',base_unit:'g',active:true,
        notes:'Created from invoice: '+item.description
      }).select('id').single();
      if(ce){showScToast('❌ Could not create ingredient: '+ce.message);return;}
      ingrId=created.id;
    }
  }
  // Upsert ingredient_link
  await supa.from('ingredient_links').upsert({
    invoice_description:item.description,ingredient_name:ingredientName,
    vendor,confirmed:true,confidence:1.0,
    invoice_unit:item.unit||item.purchase_unit||null,
    base_unit:'g',conversion_g:null,ingredient_id:ingrId
  },{onConflict:'invoice_description,vendor'});
  // Upsert ingredient_vendors price
  const up=parseFloat(item.unit_price)||null;
  const ltg=item._total_weight_g||null;
  const p100=item._cost_per_100g||null;
  if(up||p100){
    await supa.from('ingredient_vendors').upsert({
      ingredient_id:ingrId,vendor,
      purchase_unit:item.unit||item.purchase_unit||null,
      pack_description:item.pack_size||item.pack_description||null,
      unit_price:up,
      price_per_100g:p100||(up&&ltg?parseFloat(((up/ltg)*100).toFixed(4)):null),
      conversion_to_base:ltg||null,
      last_invoice_date:data.invoice_date||null,
      active:true
    },{onConflict:'ingredient_id,vendor'});
  }
  // Update invoice_line match status
  const lineId=data._lineIdMap?.[item.description];
  if(lineId){
    await supa.from('invoice_lines').update({ingredient_id:ingrId,match_status:'matched',match_confidence:1.0}).eq('id',lineId);
  }
  item._match_status='done';
  item._matched_ingredient=ingredientName;
  item._matched_ingredient_id=ingrId;
  refreshItemCard(item,modal);
  refreshDoneButton(data,modal);
  function refreshItemCard(item,modal){
    const old=modal.querySelector('[data-desc="'+item.description.replace(/"/g,'\\"')+'"]');
    if(old) old.replaceWith(renderItemCardStatic(item));
  }
  function renderItemCardStatic(item){
    const el=document.createElement('div');
    el.dataset.desc=item.description;
    el.style.cssText='border:0.5px solid rgba(16,185,129,0.25);border-radius:12px;padding:10px 12px;margin-bottom:8px;background:rgba(16,185,129,0.04);';
    el.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;">'
      +'<div style="font-size:13px;font-weight:500;color:#1e3a5f;">'+item.description+'</div>'
      +'<span style="background:rgba(16,185,129,0.1);color:#065f46;font-size:11px;font-weight:500;padding:3px 8px;border-radius:8px;">✓ '+item._matched_ingredient+'</span>'
      +'</div>';
    return el;
  }
  function refreshDoneButton(data,modal){
    const pending=(data.items||[]).filter(i=>i._match_status==='new'||i._match_status==='price_up'||i._match_status==='price_down');
    const doneBtn=document.getElementById('_ssDone');
    if(!doneBtn)return;
    if(!pending.length){doneBtn.style.background='#10b981';doneBtn.textContent='✓ All done';}
  }
}

async function acceptPriceChange(item,data){
  if(!item._matched_ingredient_id)return;
  const up=parseFloat(item.unit_price)||null;
  const ltg=item._total_weight_g||null;
  const p100=item._cost_per_100g||null;
  await supa.from('ingredient_vendors').upsert({
    ingredient_id:item._matched_ingredient_id,
    vendor:data.vendor||'',
    unit_price:up,
    price_per_100g:p100||(up&&ltg?parseFloat(((up/ltg)*100).toFixed(4)):null),
    conversion_to_base:ltg||null,
    last_invoice_date:data.invoice_date||null,
    active:true
  },{onConflict:'ingredient_id,vendor'});
  const lineId=data._lineIdMap?.[item.description];
  if(lineId){
    await supa.from('invoice_lines').update({match_status:'matched',match_confidence:1.0}).eq('id',lineId);
  }
}


function showImportSummary({vendor,total,linesCreated,linesError}){
  // Stub kept for any external callers
  showSaveSuccessModal({data:{vendor,total},linesCreated,linesError:linesError||0,reviewCount:0});
}

// ── STORICO FATTURE ───────────────────────────────────────────
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
        <div onclick="showPurchaseDetail('${p.id}')" style="padding:10px 0;border-bottom:0.5px solid rgba(59,130,246,0.08);cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <div style="font-size:14px;font-weight:500;color:#1e3a5f;">${p.vendor||'Unknown'}</div>
              <div style="font-size:11px;color:#93c5fd;margin-top:2px;">${p.invoice_date||''} ${p.invoice_number?'· #'+p.invoice_number:''}</div>
              <div style="font-size:11px;color:#93c5fd;">${(p.items||[]).length} items</div>
            </div>
            <div style="font-size:15px;font-weight:500;color:#1e3a5f;">$${(p.total||0).toFixed(2)}</div>
          </div>
        </div>`).join('')}
      <button onclick="this.closest('.fixed').remove()" style="width:100%;height:40px;border-radius:14px;background:rgba(59,130,246,0.08);color:#1d4ed8;font-size:13px;border:none;cursor:pointer;margin-top:12px;">Close</button>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
}

async function showPurchaseDetail(id){
  const{data}=await supa.from('purchases').select('*').eq('id',id).single();
  if(!data) return;
  document.querySelector('.fixed')?.remove();
  enrichInvoiceItems(data);
  showInvoicePreview(data);
}

// ── MATCH INGREDIENTI ─────────────────────────────────────────
async function suggestIngredientMatches(invoiceData){
  if(!invoiceData.items?.length) return;

  const [{data:ingrsDB},{data:recipes}]=await Promise.all([
    supa.from('ingredients').select('name').eq('active',true),
    supa.from('recipes').select('ingredients')
  ]);
  const allIngredients=new Set();
  (ingrsDB||[]).forEach(i=>{if(i.name) allIngredients.add(i.name);});
  (recipes||[]).forEach(r=>{(r.ingredients||[]).forEach(i=>{if(i.name) allIngredients.add(i.name);});});

  const{data:existingLinks}=await supa.from('ingredient_links')
    .select('invoice_description').eq('vendor',invoiceData.vendor||'').eq('confirmed',true);
  const linked=new Set((existingLinks||[]).map(l=>l.invoice_description.toLowerCase()));
  const unlinked=invoiceData.items.filter(i=>i.description&&!linked.has(i.description.toLowerCase()));
  if(!unlinked.length){showScToast('✓ All items already matched');return;}

  const ingredientList=allIngredients.size?[...allIngredients].join(', '):'(none yet — new ones will be created)';
  const itemList=unlinked.map(i=>`"${i.description}"`).join(', ');
  showScToast('🔗 Analyzing ingredients...');

  try{
    const res=await fetch(`${SUPABASE_URL}/functions/v1/souschef-classify`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${SUPABASE_ANON_KEY}`},
      body:JSON.stringify({
        transcript:`You are an ingredient matching assistant for a restaurant. Match each invoice item to a canonical English ingredient name.

Invoice items to match: ${itemList}

Known ingredients: ${ingredientList}

Rules:
- Return ONLY a JSON array, no other text, no markdown
- For each invoice item, find or suggest a clean English ingredient name
- If the item matches a known ingredient, use that exact name
- If not, suggest a clean short English name (e.g. "Arugula" not "ARUGULA BABY WILD B W 2/1.5#")
- Include only matches with confidence above 0.5

Required format (JSON array only):
[{"invoice_item":"...","ingredient":"...","confidence":0.85}]`,
        kitchenData:[]
      })
    });
    const responseData=await res.json();

    // Robust parser — handles multiple response shapes and non-JSON gracefully
    let matches=[];
    let parseError=null;
    const rawText=responseData.result?.answer
      ||responseData.result?.summary
      ||responseData.answer
      ||responseData.summary
      ||'';

    if(rawText){
      // Strip markdown fences, leading/trailing text
      const cleaned=rawText
        .replace(/```json\s*/gi,'').replace(/```\s*/g,'')
        .replace(/^[^[{]*/,'')   // strip text before first [ or {
        .replace(/[^}\]]*$/,'')  // strip text after last ] or }
        .trim();
      try{
        const parsed=JSON.parse(cleaned);
        matches=Array.isArray(parsed)?parsed:[];
      }catch(e){
        parseError=e.message;
        console.error('Match parse error. Raw text:',rawText.slice(0,300));
        console.error('Cleaned text:',cleaned.slice(0,300));
        // Try to extract JSON array from anywhere in the text
        const arrayMatch=rawText.match(/\[[\s\S]*\]/);
        if(arrayMatch){
          try{matches=JSON.parse(arrayMatch[0]);}
          catch(e2){console.error('Fallback parse also failed:',e2.message);}
        }
      }
    }

    if(!matches.length){
      // Fallback: show manual matching UI with unlinked items
      showScToast(parseError?'⚠️ AI response unclear — showing items for manual review':'No matches suggested');
      showManualMatchModal(unlinked,invoiceData);
      return;
    }
    showIngredientMatchModal(matches,invoiceData.vendor,unlinked,invoiceData);
  }catch(e){
    console.error('suggestIngredientMatches error:',e.message);
    showScToast('⚠️ Match failed — showing items for manual review');
    showManualMatchModal(unlinked,invoiceData);
  }
}

// Fallback manual matching modal when AI fails
function showManualMatchModal(items,invoiceData){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e3a5f;margin-bottom:4px;">🔗 Manual Ingredient Matching</div>
      <div style="font-size:12px;color:#93c5fd;margin-bottom:14px;">Enter the canonical ingredient name for each item (or leave blank to skip)</div>
      <div id="manualMatchList"></div>
      <button onclick="saveManualMatches('${(invoiceData.vendor||'').replace(/'/g,"\\'")}');this.closest('.fixed').remove()"
        style="width:100%;height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;margin-top:14px;border:none;cursor:pointer;">
        ✓ Save matches
      </button>
    </div>`;
  const list=modal.querySelector('#manualMatchList');
  items.forEach((item,idx)=>{
    const row=document.createElement('div');
    row.style.cssText='margin-bottom:10px;';
    row.innerHTML=`
      <div style="font-size:11px;color:#93c5fd;margin-bottom:3px;">${item.description}</div>
      <input id="manual_${idx}" placeholder="Ingredient name (e.g. Arugula)" value="${guessIngredientName(item.description)}"
        style="width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;box-sizing:border-box;">`;
    row.dataset.description=item.description;
    list.appendChild(row);
  });
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
  window._pendingManualItems=items;
  window._pendingManualInvoiceData=invoiceData;
}

// Simple heuristic: clean up invoice description to a usable ingredient name
function guessIngredientName(desc){
  if(!desc) return '';
  return desc
    .replace(/\b\d+\s*\/\s*\d+\s*(lb|oz|kg|g|gal|cs|ct|ea|each)\b/gi,'')
    .replace(/\b(fr|fresh|whl|whole|slcd|sliced|dcd|diced|chpd|chopped|loc|local|organic|baby|jumbo|large|small|medium|xl|super)\b/gi,'')
    .replace(/\b[A-Z]{2}\b/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .split(' ')
    .slice(0,3)
    .join(' ')
    .replace(/\b\w/g,c=>c.toUpperCase());
}

window.saveManualMatches=async function(vendor){
  const items=window._pendingManualItems||[];
  const invoiceData=window._pendingManualInvoiceData||{};
  const directMatches=[];
  items.forEach((item,idx)=>{
    // Read the EDITED input value — this is the canonical ingredient name
    const val=document.getElementById(`manual_${idx}`)?.value?.trim();
    if(val) directMatches.push({
      invoice_item: item.description,  // raw invoice description (for matching invoice_lines)
      ingredient:   val,               // user-edited canonical name (for ingredients.name)
      confidence:   1.0
    });
  });
  if(!directMatches.length) return;
  // Use directMatches so saveAllMatches bypasses the checkbox loop
  window._pendingMatches={matches:[],directMatches,vendor,invoiceData};
  await saveAllMatches(vendor);
};

function showIngredientMatchModal(matches,vendor,items,invoiceData){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-50 flex items-end';
  modal.style.background='rgba(0,0,0,0.3)';
  modal.innerHTML=`
    <div style="background:rgba(255,255,255,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:16px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;animation:slideUp .25s ease">
      <div style="width:36px;height:4px;background:rgba(59,130,246,0.15);border-radius:2px;margin:0 auto 14px;"></div>
      <div style="font-size:15px;font-weight:500;color:#1e3a5f;margin-bottom:4px;">🔗 Ingredient Matches</div>
      <div style="font-size:12px;color:#93c5fd;margin-bottom:14px;">Confirm or skip. New ingredients will be created automatically.</div>
      <div id="matchList"></div>
      <button onclick="saveAllMatches('${(vendor||'').replace(/'/g,"\\'")}');this.closest('.fixed').remove()"
        style="width:100%;height:44px;border-radius:14px;background:#1e3a5f;color:white;font-size:13px;font-weight:500;margin-top:14px;border:none;cursor:pointer;">
        ✓ Save confirmed matches
      </button>
    </div>`;
  const list=modal.querySelector('#matchList');
  matches.forEach((m,idx)=>{
    const invoiceItem=items.find(i=>i.description===m.invoice_item)||{};
    const weightInfo=invoiceItem._total_weight_g
      ?`<span style="color:#10b981;"> · ${invoiceItem._total_weight_g>=1000?(invoiceItem._total_weight_g/1000).toFixed(2)+'kg':Math.round(invoiceItem._total_weight_g)+'g'}</span>`:'';
    const costInfo=invoiceItem._cost_per_100g
      ?`<span style="color:#6b7280;"> · $${invoiceItem._cost_per_100g.toFixed(2)}/100g</span>`:'';
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:10px;background:rgba(59,130,246,0.05);border-radius:12px;margin-bottom:8px;';
    row.innerHTML=`
      <input type="checkbox" id="match_${idx}" checked style="width:18px;height:18px;cursor:pointer;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;color:#93c5fd;">Invoice item</div>
        <div style="font-size:13px;color:#1e3a5f;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.invoice_item}</div>
        <div style="font-size:11px;color:#93c5fd;margin-top:2px;">→ <span style="color:#3B82F6;">${m.ingredient}</span> <span style="color:#93c5fd;">(${Math.round((m.confidence||0)*100)}%)</span>${weightInfo}${costInfo}</div>
      </div>`;
    list.appendChild(row);
  });
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  document.body.appendChild(modal);
  window._pendingMatches={matches,vendor,invoiceData};
}

// ── SAVE ALL MATCHES ──────────────────────────────────────────
async function saveAllMatches(vendor){
  if(!window._pendingMatches) return;
  const{matches,invoiceData,directMatches}=window._pendingMatches;
  const toSave=[];

  if(directMatches){
    // Called from saveManualMatches — matches are already confirmed, use as-is
    directMatches.forEach(m=>{
      toSave.push({
        invoice_description: m.invoice_item,
        ingredient_name:     m.ingredient,   // ← this is the USER-EDITED name
        vendor:              vendor||null,
        confirmed:           true,
        confidence:          m.confidence||1.0,
        invoice_unit:        invoiceData?.items?.find(i=>i.description===m.invoice_item)?.unit||null,
        base_unit:           'g',
        conversion_g:        null
      });
    });
  } else {
    // Called from AI match modal — read checkbox selections
    const checkboxes=document.querySelectorAll('[id^="match_"]');
    checkboxes.forEach((cb,idx)=>{
      if(cb.checked&&matches[idx]){
        toSave.push({
          invoice_description: matches[idx].invoice_item,
          ingredient_name:     matches[idx].ingredient,
          vendor:              vendor||null,
          confirmed:           true,
          confidence:          matches[idx].confidence||null,
          invoice_unit:        invoiceData?.items?.find(i=>i.description===matches[idx].invoice_item)?.unit||null,
          base_unit:           'g',
          conversion_g:        null
        });
      }
    });
  }
  if(!toSave.length){window._pendingMatches=null;return;}

  const stats={linksSaved:0,ingredientsCreated:0,linesUpdated:0,vendorPricesUpdated:0,errors:[]};

  // ── Step 1: upsert ingredient_links (real columns only) ──
  const{error:linkErr}=await supa.from('ingredient_links').upsert(
    toSave.map(m=>({
      invoice_description: m.invoice_description,
      ingredient_name:     m.ingredient_name,
      vendor:              m.vendor,
      confirmed:           m.confirmed,
      confidence:          m.confidence,
      invoice_unit:        m.invoice_unit,
      base_unit:           m.base_unit,
      conversion_g:        m.conversion_g,
    })),
    {onConflict:'invoice_description,vendor'}
  );
  if(linkErr){
    console.error('ingredient_links upsert error:',linkErr);
    stats.errors.push('Links: '+linkErr.message);
  } else {
    stats.linksSaved=toSave.length;
  }

  // ── Step 2: for each confirmed match — find or create ingredient ──
  await Promise.all(toSave.map(async(m)=>{
    // 2a. Look up ingredient by name (exact, then case-insensitive)
    let ingrId=null;
    const{data:found}=await supa.from('ingredients')
      .select('id').eq('name',m.ingredient_name).eq('active',true).maybeSingle();

    if(found?.id){
      ingrId=found.id;
    } else {
      // Try case-insensitive
      const{data:foundCI}=await supa.from('ingredients')
        .select('id').ilike('name',m.ingredient_name).eq('active',true).limit(1);
      if(foundCI?.length){
        ingrId=foundCI[0].id;
      } else {
        // Create new ingredient with canonical English name
        const{data:created,error:createErr}=await supa.from('ingredients').insert({
          name:      m.ingredient_name,
          category:  'Other',
          base_unit: 'g',
          active:    true,
          notes:     `Auto-created from invoice: ${m.invoice_description}`
        }).select('id').single();
        if(createErr){
          console.error(`Create ingredient "${m.ingredient_name}":`,createErr);
          stats.errors.push(`Create ${m.ingredient_name}: ${createErr.message}`);
          return;
        }
        ingrId=created.id;
        stats.ingredientsCreated++;
        if(typeof loadIngredientsTab==='function'&&document.getElementById('ingrTabList')){
          setTimeout(loadIngredientsTab,600);
        }
      }
    }
    if(!ingrId) return;

    // 2b. Update ingredient_links with ingredient_id
    await supa.from('ingredient_links')
      .update({ingredient_id:ingrId})
      .eq('invoice_description',m.invoice_description)
      .eq('vendor',vendor||'');

    // 2c. Update invoice_lines using raw_description + import_id (both safe UUIDs)
    //     NEVER use array index or non-UUID as filter
    const purchaseId = invoiceData?._purchase_id;
    const lineId = invoiceData?._lineIdMap?.[m.invoice_description];
    const purchaseIdIsUUID = isValidUUID(purchaseId);

    let ilErr = null;
    if(isValidUUID(lineId)){
      // Best: update exact row by its own UUID
      const{error:e} = await supa.from('invoice_lines')
        .update({ingredient_id:ingrId, match_status:'matched', match_confidence:m.confidence||null})
        .eq('id', lineId);
      ilErr = e;
    } else if(purchaseIdIsUUID){
      // Good: scoped to this purchase + description
      const{error:e} = await supa.from('invoice_lines')
        .update({ingredient_id:ingrId, match_status:'matched', match_confidence:m.confidence||null})
        .eq('import_id', purchaseId)
        .eq('raw_description', m.invoice_description);
      ilErr = e;
    } else {
      // Skip — no valid UUID available, do not send garbage to DB
      console.warn('Skipped invoice_lines update: missing lineId and invalid import_id',
        {lineId, purchaseId, desc: m.invoice_description});
    }

    if(ilErr){
      console.error('invoice_lines update error:',ilErr,{lineId,purchaseId,desc:m.invoice_description});
      stats.errors.push('Line update: '+ilErr.message);
    } else if(isValidUUID(lineId)||purchaseIdIsUUID){
      stats.linesUpdated++;
    }

    // 2d. Upsert ingredient_vendors — real columns, correct onConflict
    const invoiceItem=invoiceData?.items?.find(i=>i.description===m.invoice_description)||{};
    const up=parseFloat(invoiceItem.unit_price)||null;
    const ltg=invoiceItem._total_weight_g||null;
    const p100=invoiceItem._cost_per_100g||null;
    const pu=invoiceItem.purchase_unit||invoiceItem.unit||null;
    const pd=invoiceItem.pack_size||invoiceItem.pack_description||null;

    // Only upsert if we have at least unit_price to make it meaningful
    if(up||p100){
      // Calculate price_per_100g if not already done
      const effectiveP100 = p100 || (up&&ltg ? parseFloat(((up/ltg)*100).toFixed(4)) : null);
      const priceType = invoiceItem._price_type || 'per_case';
      const{error:ivErr}=await supa.from('ingredient_vendors').upsert({
        ingredient_id:      ingrId,
        vendor:             vendor||'Unknown',
        pack_description:   pd,
        unit_price:         up,
        price_per_100g:     effectiveP100,
        price_type:         priceType,
        conversion_to_base: priceType === 'per_lb' ? null : (ltg||null),
        last_invoice_date:  invoiceData?.invoice_date||null,
        active:             true,
      },{onConflict:'ingredient_id,vendor'});
      if(ivErr){
        console.error('ingredient_vendors upsert error:',ivErr);
        stats.errors.push('Vendor: '+ivErr.message);
      } else {
        stats.vendorPricesUpdated++;
      }
    }
  }));

  // ── Summary ──
  const parts=[
    `${stats.linksSaved} links saved`,
    stats.ingredientsCreated?`${stats.ingredientsCreated} created`:'',
    `${stats.linesUpdated} lines linked`,
    `${stats.vendorPricesUpdated} prices updated`,
  ].filter(Boolean).join(' · ');
  const errPart=stats.errors.length?` · ⚠️ ${stats.errors.length} error(s)`:'';
  showScToast(`✓ ${parts}${errPart}`);
  if(stats.errors.length) console.error('saveAllMatches errors:',stats.errors);

  // Refresh ingredients tab if open
  if(typeof loadIngredientsTab==='function'&&document.getElementById('ingrTabList')){
    setTimeout(loadIngredientsTab,800);
  }
  window._pendingMatches=null;
}

// ── ONE QUESTION RULE ─────────────────────────────────────────
async function runOneQuestionRule(data,onComplete){
  const items=data.items||[];
  if(!items.length){onComplete(data);return;}
  const rawDescs=items.map(i=>i.description||'').filter(Boolean);
  const{data:known}=await supa.from('invoice_line_clarifications')
    .select('*').eq('vendor',data.vendor||'').in('raw_description',rawDescs);
  const knownMap={};
  (known||[]).forEach(c=>{knownMap[c.raw_description]=c.resolution;});
  items.forEach(item=>{
    if(knownMap[item.description]){Object.assign(item,knownMap[item.description]);item._clarified=true;}
  });
  await checkPriceAnomalies(data);
  const ambiguous=
    items.find(i=>i.needs_clarification&&!i._clarified)||
    items.find(i=>i._needs_weight_clarification&&!i._clarified&&!i._weight_answered);
  if(!ambiguous){onComplete(data);return;}
  if(ambiguous._needs_weight_clarification){
    showWeightQuestionModal(ambiguous,data,onComplete);
  } else {
    showOneQuestionModal(ambiguous,data,onComplete);
  }
}

function showWeightQuestionModal(item,invoiceData,onComplete){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-center justify-center';
  modal.style.background='rgba(0,0,0,0.5)';
  const weights=[
    {label:'Small (≈100g)',value:100},{label:'Medium (≈200g)',value:200},
    {label:'Large (≈400g)',value:400},{label:'XL (≈600g)',value:600},
    {label:'1 lb (≈454g)',value:454},{label:'Skip',value:null},
  ];
  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="font-size:10px;font-weight:700;color:#f59e0b;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;">⚖️ WEIGHT UNKNOWN</div>
      <div style="font-size:14px;font-weight:500;color:#1e3a5f;margin-bottom:8px;line-height:1.4;">How much does 1 unit weigh?</div>
      <div style="font-family:monospace;font-size:12px;color:#6b7280;background:#f8fafc;padding:6px 10px;border-radius:8px;margin-bottom:16px;">${item.description}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${weights.map(w=>`<button style="padding:11px 14px;border-radius:12px;border:1.5px solid #e2e8f0;background:white;font-size:13px;color:#1e3a5f;cursor:pointer;text-align:left;" onclick="answerWeightQuestion(${w.value},this)">${w.label}</button>`).join('')}
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="customWeight" type="number" placeholder="Custom g..." min="1" max="10000" style="flex:1;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:12px;font-size:13px;">
          <button onclick="answerWeightQuestion(parseInt(document.getElementById('customWeight').value)||0,this)" style="padding:10px 14px;border-radius:12px;background:#3B82F6;color:white;font-size:13px;border:none;cursor:pointer;">✓</button>
        </div>
      </div>
    </div>`;
  modal._item=item; modal._invoiceData=invoiceData; modal._onComplete=onComplete; modal.id='weightModal';
  document.body.appendChild(modal);
  window.answerWeightQuestion=async(grams,btn)=>{
    btn.style.background='#1e3a5f'; btn.style.color='white';
    const m=document.getElementById('weightModal');
    const itm=m._item,invData=m._invoiceData,cb=m._onComplete;
    if(grams&&grams>0){
      itm.avg_unit_weight_g=grams; itm._weight_answered=true;
      const totalG=calcTotalWeightG(itm);
      itm._total_weight_g=totalG;
      if(totalG&&itm.unit_price) itm._cost_per_100g=(parseFloat(itm.unit_price)/totalG)*100;
    } else {
      itm._weight_answered=true;
    }
    await new Promise(r=>setTimeout(r,150));
    m.remove(); delete window.answerWeightQuestion;
    runOneQuestionRule(invData,cb);
  };
}

function showOneQuestionModal(item,invoiceData,onComplete){
  const modal=document.createElement('div');
  modal.className='fixed inset-0 z-[70] flex items-center justify-center';
  modal.style.background='rgba(0,0,0,0.5)';
  const question=item.clarification_question||`"${item.description}" — price is per:`;
  const options=item.clarification_options||[
    {label:'Each / unit',value:'each'},{label:'Case (CS)',value:'cs'},
    {label:'Pound (lb)',value:'lb'},{label:'Not sure',value:'skip'}
  ];
  modal.innerHTML=`
    <div style="background:white;border-radius:20px;padding:20px;width:88%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="font-size:10px;font-weight:700;color:#3B82F6;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px;">⚠️ ONE QUESTION</div>
      <div style="font-size:14px;font-weight:500;color:#1e3a5f;margin-bottom:8px;line-height:1.4;">${question}</div>
      <div style="font-family:monospace;font-size:12px;color:#6b7280;background:#f8fafc;padding:6px 10px;border-radius:8px;margin-bottom:16px;">${item.description}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${options.map(o=>`<button style="padding:11px 14px;border-radius:12px;border:1.5px solid #e2e8f0;background:white;font-size:13px;color:#1e3a5f;cursor:pointer;text-align:left;" onclick="answerOneQuestion('${(invoiceData.vendor||'').replace(/'/g,"\\'")}','${(item.description||'').replace(/'/g,"\\'")}','${o.value}',this)">${o.label}</button>`).join('')}
      </div>
    </div>`;
  modal._invoiceData=invoiceData; modal._item=item; modal._onComplete=onComplete; modal.id='oqModal';
  document.body.appendChild(modal);
}

window.answerOneQuestion=async(vendor,rawDesc,answer,btn)=>{
  btn.style.background='#1e3a5f'; btn.style.color='white';
  const modal=document.getElementById('oqModal');
  const item=modal._item,invoiceData=modal._invoiceData,onComplete=modal._onComplete;
  const resolution=answer==='skip'?{skipped:true}:{purchase_unit:answer,price_is_per:answer};
  Object.assign(item,resolution);
  item._clarified=true; item.needs_clarification=false;
  if(answer!=='skip'){
    const{error:cErr}=await supa.from('invoice_line_clarifications').upsert({
      vendor,raw_description:rawDesc,
      question:item.clarification_question||'',answer,
      resolution,answered_by:user?.name||'Max'
    },{onConflict:'vendor,raw_description'});
    if(cErr) console.error('clarification upsert error:',cErr);
    const{error:ilErr}=await supa.from('invoice_lines')
      .update({
        purchase_unit:         answer,
        clarification_answered:true,
        clarification_answer:  answer,
        clarification_at:      new Date().toISOString(),
        needs_clarification:   false
      })
      .eq('raw_description',rawDesc)
      .eq('vendor',vendor)
      .is('clarification_answered',false);
    if(ilErr) console.error('invoice_lines clarification error:',ilErr);
  }
  await new Promise(r=>setTimeout(r,150));
  modal.remove();
  runOneQuestionRule(invoiceData,onComplete);
};

// ── SALVA IN invoice_lines — returns inserted rows with IDs ──
async function saveToInvoiceLines(data){
  const lines=(data.items||[]).map(item=>{
    const totalG=item._total_weight_g||null;
    const price=parseFloat(item.unit_price||item.amount)||null;
    const costPer100g=(totalG&&price)?((price/totalG)*100):null;
    return {
      import_id:        isValidUUID(data._purchase_id) ? data._purchase_id : null,
      invoice_date:     data.invoice_date||new Date().toISOString().slice(0,10),
      invoice_number:   data.invoice_number||null,
      vendor:           data.vendor||'Unknown',
      raw_description:  item.description||'',
      vendor_sku:       item.item_code||item.vendor_sku||null,
      qty:              parseFloat(item.quantity||item.qty)||null,
      purchase_unit:    item.purchase_unit||item.unit||null,
      pack_size:        item.pack_size||null,
      pack_description: item.pack_description||item.pack_size||null,
      pack_qty:         item.pack_qty||null,
      pack_size_unit:   item.pack_unit||null,
      unit_price:       parseFloat(item.unit_price)||null,
      line_total:       parseFloat(item.amount||item.extended_price)||null,
      total_weight_g:   totalG,
      cost_per_100g:    costPer100g,
      count_unit:       item.count_unit||null,
      avg_unit_weight_g:item.avg_unit_weight_g||null,
      match_status:     'unmatched',
      match_confidence: null,
    };
  });

  // Use .select() to get back the inserted rows with their real UUIDs
  const{data:inserted,error}=await supa.from('invoice_lines').insert(lines).select('id,raw_description');
  if(error){
    console.error('invoice_lines insert error:',error);
    showScToast('❌ Error saving invoice lines: '+error.message);
    return null;
  }
  console.log('invoice_lines saved:',inserted?.length,'rows');
  return inserted; // array of {id, raw_description}
}

// ── EXPOSE PIPELINE FUNCTIONS TO WINDOW (required by vendor-parser bridge) ──
window.enrichInvoiceItems  = enrichInvoiceItems;
window.runOneQuestionRule  = runOneQuestionRule;
window.showInvoicePreview  = showInvoicePreview;
