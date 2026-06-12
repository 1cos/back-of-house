// ── SOUS CHEF AI — solo per Max ──

const SOUSCHEF_PROMPT = `You are the digital sous chef assistant for Massimiliano, Head Chef and owner of Zenos on the Square, an authentic Italian restaurant (not Italian-American) in Weatherford, Texas.

Your job is to help Max manage the kitchen efficiently. You have access to kitchen data including prep logs, recipes, staff presence, and alerts.

KITCHEN CONTEXT:
- Restaurant: Zenos on the Square, Weatherford TX
- Style: Authentic Italian cuisine
- Kitchen stations: Oven Station, Pasta Station, Plating Station, Salad Station, Freezer
- Staff: multilingual brigade (Italian, Spanish, English speakers)
- External tools: TripleSeat (catering/events), Touch Bistro (POS)

LANGUAGE RULES:
- Max sempre parla italiano — rispondi sempre in italiano
- Riassumi i task in italiano
- Cambia lingua solo se Max lo chiede esplicitamente

RESPONSE RULES:
- Se l'input è un TASK/REMINDER: classifica e salva
- Se l'input è una DOMANDA sui dati: interroga e rispondi direttamente
- Sii conciso — Max è in una cucina impegnata
- Non fare domande di chiarimento a meno che non sia assolutamente necessario

CATEGORIE:
- Acquisti — ingredienti, forniture da comprare
- Task — cose da fare, follow up, amministrazione
- HR — personale, turni, ferie, performance
- Manutenzione — problemi attrezzatura
- Food Cost — prezzi, analisi costi, variazioni fatture
- Reminder — con data/ora se menzionata
- Urgenza: Alta, Media, Bassa

OUTPUT FORMAT (sempre JSON, niente altro):
{
  "type": "task" | "domanda",
  "category": "Acquisti|Task|HR|Manutenzione|Food Cost|Reminder",
  "urgency": "alta" | "media" | "bassa",
  "text": "trascrizione originale",
  "summary": "riassunto pulito del task in italiano",
  "due_date": "data ISO se menzionata, null altrimenti",
  "answer": "se type è domanda, la risposta qui in italiano, altrimenti null",
  "notify": true/false
}`;

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let scTasks = [];

// ── INIT SOUS CHEF ──
async function initSousChef(){
  if(!isAdmin()) return;
  if(document.getElementById('scBtn')) return; // guard: do not double-create
  // aggiungi bottone impronta in basso a sinistra
  const btn = document.createElement('button');
  btn.id = 'scBtn';
  btn.className = 'fixed bottom-24 left-3 z-40 w-14 h-14 bg-white/80 backdrop-blur border border-slate-200 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition select-none';
  btn.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5">
      <path d="M12 2a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
    <span id="scPulse" class="hidden absolute inset-0 rounded-full border-2 border-blue-400 animate-ping"></span>`;
  document.body.appendChild(btn);

  // Carica tasks esistenti
  loadScTasks();
  // Attacca gesti tap/longpress subito dopo aver creato il bottone
  setTimeout(scAttachGestures, 100);
}

// ── REGISTRAZIONE VOCALE ──
async function startRecording(){
  if(isRecording) return;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks = [];
    // iOS Safari supporta audio/mp4, altri browser audio/webm
    const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 
                     MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? {mimeType} : {});
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    isRecording = true;
    // feedback visivo
    const btn = document.getElementById('scBtn');
    const pulse = document.getElementById('scPulse');
    if(btn) btn.classList.add('bg-blue-100','border-blue-400');
    if(pulse) pulse.classList.remove('hidden');
    showScToast('🎙️ Sto ascoltando...');
  }catch(e){
    showScToast('❌ Microfono non disponibile');
  }
}

async function stopRecording(){
  if(!isRecording||!mediaRecorder) return;
  isRecording = false;
  const btn = document.getElementById('scBtn');
  const pulse = document.getElementById('scPulse');
  if(btn) btn.classList.remove('bg-blue-100','border-blue-400');
  if(pulse) pulse.classList.add('hidden');

  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t=>t.stop());

  showScToast('⏳ Elaborazione...');

  mediaRecorder.onstop = async() => {
    const mt = mediaRecorder.mimeType || 'audio/mp4';
    const blob = new Blob(audioChunks, {type: mt});
    await processAudio(blob, mt);
  };
}

// ── TRASCRIZIONE CON GROQ WHISPER (base64 via FileReader — compatibile Safari iOS) ──
async function processAudio(blob, mimeType){
  try{
    const mt2 = mimeType || blob.type || 'audio/mp4';
    // usa FileReader per base64 — più compatibile con Safari
    const base64Audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        // rimuovi il prefisso "data:audio/...;base64,"
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const body = JSON.stringify({ audio: base64Audio, mimeType: mt2, language: 'it' });

    const transcribeRes = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body
    });
    const transcribeData = await transcribeRes.json();
    const transcript = transcribeData.text || transcribeData.error || '';

    if(!transcript.trim()){
      showScToast('❌ Non ho sentito nulla. Riprova.');
      return;
    }

    showScToast(`"${transcript.slice(0,40)}..."`, 2000);

    // Classifica con LLaMA via Groq
    await classifyWithGroq(transcript);

  }catch(e){
    showScToast('❌ Errore: '+e.message);
  }
}

// ── CLASSIFICAZIONE CON GROQ LLAMA ──
async function classifyWithGroq(transcript){
  try{
    // recupera dati cucina per domande sul database
    const since = new Date(Date.now() - 14*24*60*60*1000).toISOString();
    const {data:recentPreps} = await supa.from('prep_log')
      .select('item,qty,unit,user_name,created_at')
      .gte('created_at', since)
      .order('created_at',{ascending:false})
      .limit(50);

    const kitchenContext = recentPreps?.length 
      ? `\n\nDATA CUCINA (ultime 2 settimane):\n${JSON.stringify(recentPreps.slice(0,20))}`
      : '';

    // Groq non è accessibile dal browser — usiamo Edge Function
    const groqRes = await fetch(`${SUPABASE_URL}/functions/v1/souschef-classify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        transcript,
        kitchenData: recentPreps?.slice(0,20) || []
      })
    });

    const groqData = await groqRes.json();
    const result = groqData.result;

    if(!result){
      showScToast('❌ Errore classificazione');
      return;
    }

    // se è una domanda — mostra risposta
    if(result.type === 'domanda'){
      showScAnswer(result);
      return;
    }

    // se è un task — salva su Supabase
    await saveScTask(result, transcript);

  }catch(e){
    showScToast('❌ Errore AI: '+e.message);
  }
}

// ── SALVA TASK ──
async function saveScTask(result, transcript){
  const task = {
    user_name: user.name,
    type: result.type||'task',
    category: result.category||'Task',
    urgency: result.urgency||'media',
    summary: result.summary||transcript,
    text: transcript,
    due_date: result.due_date||null,
    notify: result.notify||false,
    done: false
  };
  const{error} = await supa.from('sous_chef_tasks').insert(task);
  if(error){showScToast('❌ Errore salvataggio');return}

  // imposta notifica push se ha data
  if(task.due_date && task.notify){
    // notifica gestita lato server con cron
  }

  showScToast(`✓ ${result.category} — ${result.urgency} • Salvato`);
  loadScTasks();
}

// ── CARICA TASKS ──
async function loadScTasks(){
  const{data} = await supa.from('sous_chef_tasks')
    .select('*')
    .eq('user_name', user.name)
    .eq('done', false)
    .order('created_at', {ascending:false})
    .limit(50);
  scTasks = data||[];
  // aggiorna badge se ci sono task
  updateScBadge();
}

function updateScBadge(){
  const btn = document.getElementById('scBtn');
  if(!btn) return;
  const alta = scTasks.filter(t=>t.urgency==='alta').length;
  let badge = btn.querySelector('.sc-badge');
  if(alta>0){
    if(!badge){
      badge = document.createElement('span');
      badge.className='sc-badge absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold';
      btn.appendChild(badge);
    }
    badge.textContent=alta;
  } else if(badge){
    badge.remove();
  }
}

// ── MOSTRA RISPOSTA DOMANDA ──
function showScAnswer(result){
  const sheet = document.createElement('div');
  sheet.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end';
  sheet.innerHTML = `
    <div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] p-5 max-h-[60vh] overflow-auto" style="animation:slideUp .25s ease">
      <div class="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4"></div>
      <div class="flex items-center gap-2 mb-3">
        <span class="text-2xl">🤖</span>
        <span class="font-semibold text-sm text-slate-500">Sous Chef</span>
      </div>
      <p class="text-sm text-slate-500 mb-2 italic">"${result.text}"</p>
      <div class="bg-blue-50 rounded-2xl p-4 text-sm text-slate-800 leading-relaxed">${result.answer}</div>
      <button onclick="this.closest('.fixed').remove()" class="w-full mt-4 py-3 bg-slate-900 text-white rounded-xl">Chiudi</button>
    </div>`;
  sheet.onclick=e=>{if(e.target===sheet)sheet.remove()};
  document.body.appendChild(sheet);
}

// ── APRI PANNELLO SOUS CHEF ──
function openSousChef(){
  const urgencyColors = {alta:'bg-red-100 text-red-700', media:'bg-amber-100 text-amber-700', bassa:'bg-green-100 text-green-700'};
  const catIcons = {Acquisti:'🛒', Task:'✅', HR:'👥', Manutenzione:'🔧', 'Food Cost':'💰', Reminder:'🔔'};

  const grouped = {};
  scTasks.forEach(t=>{
    if(!grouped[t.category]) grouped[t.category]=[];
    grouped[t.category].push(t);
  });

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end';
  modal.innerHTML = `
    <div class="bg-white w-full max-w-md mx-auto rounded-t-[28px] max-h-[85vh] flex flex-col" style="animation:slideUp .25s ease">
      <div class="p-4 border-b flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xl">🤖</span>
          <h3 class="font-bold">Sous Chef</h3>
          ${scTasks.filter(t=>t.urgency==='alta').length>0?`<span class="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">${scTasks.filter(t=>t.urgency==='alta').length} urgenti</span>`:''}
        </div>
        <button onclick="this.closest('.fixed').remove()" class="text-slate-400 text-xl">✕</button>
      </div>
      <div class="overflow-auto flex-1 p-4 space-y-4">
        ${Object.keys(grouped).length===0?'<p class="text-slate-400 text-sm text-center py-8">Nessun task. Tieni premuto il microfono per aggiungerne uno.</p>':''}
        ${Object.entries(grouped).map(([cat, tasks])=>`
          <div>
            <div class="flex items-center gap-2 mb-2">
              <span class="text-lg">${catIcons[cat]||'📌'}</span>
              <span class="font-semibold text-sm">${cat}</span>
              <span class="text-xs text-slate-400">${tasks.length}</span>
            </div>
            <div class="space-y-2">
              ${tasks.sort((a,b)=>a.urgency==='alta'?-1:1).map(t=>`
              <div class="flex items-start gap-3 p-3 bg-slate-50 rounded-2xl">
                <button onclick="markScDone(${t.id},this)" class="w-5 h-5 rounded-full border-2 border-slate-300 flex-shrink-0 mt-0.5 active:scale-90 transition"></button>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium leading-snug">${t.summary}</p>
                  ${t.due_date?`<p class="text-[11px] text-blue-600 mt-0.5">📅 ${new Date(t.due_date).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>`:''}
                  <p class="text-[10px] text-slate-400 mt-0.5">${new Date(t.created_at).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${urgencyColors[t.urgency]||'bg-slate-100 text-slate-500'}">${t.urgency}</span>
              </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>
      <div class="p-4 border-t">
        <button onclick="this.closest('.fixed').remove();setTimeout(()=>startRecording(),100)" class="w-full py-3 bg-blue-500 text-white rounded-2xl font-semibold flex items-center justify-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          Nuovo task vocale
        </button>
      </div>
    </div>`;
  modal.onclick=e=>{if(e.target===modal)modal.remove()};
  document.body.appendChild(modal);
}

async function markScDone(id, btn){
  btn.classList.add('bg-green-500','border-green-500');
  btn.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  await supa.from('sous_chef_tasks').update({done:true}).eq('id',id);
  setTimeout(()=>{
    btn.closest('.flex').style.opacity='0.3';
    btn.closest('.flex').style.transition='opacity 0.3s';
    setTimeout(()=>{btn.closest('.flex').remove(); loadScTasks();},300);
  },400);
}

// ── TOAST NOTIFICA ──
function showScToast(msg, duration=3000){
  document.querySelectorAll('.sc-toast').forEach(t=>t.remove());
  const toast = document.createElement('div');
  // bottom-24 so toast clears the bottom nav AND appears above any modal header
  toast.className='sc-toast fixed z-[9999] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl max-w-[80vw] text-center';
  toast.style.cssText += ';bottom:96px;left:50%;transform:translateX(-50%);';
  toast.textContent=msg;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), duration);
}

// ── BOTTONE: tap breve = scan DB, long press = registra ──────
// Tap breve (< 500ms): runSousChefScan() + aggiorna banner
// Long press (≥ 500ms): avvia registrazione vocale
let scPressTimer = null;
const SC_LONG_PRESS_MS = 500;

function scAttachGestures() {
  const btn = document.getElementById('scBtn');
  if (!btn) return;

  let pressStart = 0;
  let longPressTriggered = false;

  function onPressStart(e) {
    e.preventDefault();
    pressStart = Date.now();
    longPressTriggered = false;
    scPressTimer = setTimeout(() => {
      longPressTriggered = true;
      startRecording();
    }, SC_LONG_PRESS_MS);
  }

  function onPressEnd(e) {
    e.preventDefault();
    clearTimeout(scPressTimer);
    if (longPressTriggered) {
      if (isRecording) stopRecording();
    } else {
      // Tap breve — scan
      runSousChefScan();
    }
  }

  btn.addEventListener('mousedown', onPressStart);
  btn.addEventListener('touchstart', onPressStart, { passive: false });
  btn.addEventListener('mouseup', onPressEnd);
  btn.addEventListener('touchend', onPressEnd, { passive: false });
  btn.addEventListener('mouseleave', () => {
    clearTimeout(scPressTimer);
    if (isRecording) stopRecording();
  });
}

// scAttachGestures è chiamata da initSousChef dopo la creazione del bottone.

// ── SOUS CHEF SCAN — scansione DB on demand ───────────────────
// Chiamata a ogni tap breve. Scrive warning in invoice_warnings.
// Il banner home si aggiorna dopo.

const SC_SCAN_RULES_DEFAULT = {
  'SC-PRICE-001': true,   // price_per_100g anomalo su carni (< $0.10)
  'SC-PRICE-002': true,   // prezzo aumentato >20% vs media storica
  'SC-NOLINK-001': true,  // ingrediente attivo senza price_per_100g
  'SC-UNUSED-001': false, // ingrediente non in nessuna ricetta (off di default)
};

function scGetRules() {
  try {
    const saved = localStorage.getItem('sc_scan_rules');
    return saved ? { ...SC_SCAN_RULES_DEFAULT, ...JSON.parse(saved) } : { ...SC_SCAN_RULES_DEFAULT };
  } catch(_) { return { ...SC_SCAN_RULES_DEFAULT }; }
}

window.runSousChefScan = async function() {
  const sb = window.supabaseClient;
  if (!sb) return;

  const btn = document.getElementById('scBtn');
  if (btn) { btn.style.background = 'rgba(16,185,129,0.15)'; btn.style.borderColor = '#10b981'; }
  if (typeof showScToast === 'function') showScToast('🔍 Sous Chef sta controllando...');

  const rules = scGetRules();
  const found = [];

  try {
    // ── SC-PRICE-001: price_per_100g < $0.10 su carni ──────────
    if (rules['SC-PRICE-001']) {
      const meatKeywords = ['beef','meat','steak','chicken','pork','veal','lamb',
        'rib','loin','tenderloin','brisket','chuck','short','tomahawk','stew'];
      const { data: lowPrice } = await sb
        .from('ingredient_vendors')
        .select('ingredient_id,vendor,unit_price,price_per_100g,ingredients(name)')
        .not('price_per_100g', 'is', null)
        .lt('price_per_100g', 0.10);

      for (const row of (lowPrice || [])) {
        const name = (row.ingredients?.name || '').toLowerCase();
        if (!meatKeywords.some(k => name.includes(k))) continue;
        found.push({
          code: 'SC-PRICE-001', severity: 'blocking',
          vendor: row.vendor || null,
          item_description: row.ingredients?.name || null,
          message: `${row.ingredients?.name} — $${(row.price_per_100g||0).toFixed(4)}/100g è sospettosamente basso. Catchweight non rilevato?`,
        });
      }
    }

    // ── SC-PRICE-002: prezzo aumentato >20% vs storico ─────────
    if (rules['SC-PRICE-002']) {
      const { data: purchases } = await sb
        .from('purchases')
        .select('vendor,items,invoice_date')
        .order('invoice_date', { ascending: false })
        .limit(30);

      const pricesByKey = {};
      for (const p of (purchases || [])) {
        for (const item of (p.items || [])) {
          if (!item.unit_price) continue;
          const key = `${p.vendor}|||${item.description}`;
          if (!pricesByKey[key]) pricesByKey[key] = [];
          pricesByKey[key].push(parseFloat(item.unit_price));
        }
      }

      for (const [key, prices] of Object.entries(pricesByKey)) {
        if (prices.length < 2) continue;
        const latest = prices[0];
        const avg = prices.slice(1).reduce((a,b) => a+b, 0) / (prices.length - 1);
        if (avg <= 0) continue;
        const pct = Math.round(((latest - avg) / avg) * 100);
        if (pct < 20) continue;
        const [vendor, desc] = key.split('|||');
        found.push({
          code: 'SC-PRICE-002', severity: 'alert',
          vendor: vendor || null,
          item_description: desc || null,
          message: `${desc} — prezzo +${pct}% rispetto alla media ($${avg.toFixed(2)} → $${latest.toFixed(2)})`,
        });
      }
    }

    // ── SC-NOLINK-001: ingrediente attivo senza price_per_100g ──
    if (rules['SC-NOLINK-001']) {
      const { data: allIngr } = await sb
        .from('ingredients')
        .select('id,name,category')
        .eq('active', true);

      const { data: hasPrice } = await sb
        .from('ingredient_vendors')
        .select('ingredient_id')
        .not('price_per_100g', 'is', null);

      const hasPriceSet = new Set((hasPrice || []).map(r => r.ingredient_id));
      const missing = (allIngr || []).filter(i =>
        i.category !== 'Supply' && !hasPriceSet.has(i.id)
      );

      if (missing.length > 0) {
        const names = missing.slice(0, 5).map(i => i.name).join(', ');
        const extra = missing.length > 5 ? ` +${missing.length - 5} altri` : '';
        found.push({
          code: 'SC-NOLINK-001', severity: 'insight',
          vendor: null, item_description: null,
          message: `${missing.length} ingredienti senza $/100g: ${names}${extra}`,
        });
      }
    }

    // ── SC-UNUSED-001: acquistato ma non in nessuna ricetta ─────
    if (rules['SC-UNUSED-001']) {
      const { data: linked } = await sb
        .from('ingredient_links')
        .select('invoice_description')
        .eq('confirmed', true)
        .limit(300);

      const { data: recipes } = await sb
        .from('recipes').select('ingredients');

      const inRecipes = new Set();
      for (const r of (recipes || [])) {
        for (const ing of (r.ingredients || [])) {
          if (ing.name) inRecipes.add(ing.name.toLowerCase());
        }
      }

      const unused = (linked || []).filter(l =>
        !inRecipes.has((l.invoice_description || '').toLowerCase())
      );

      if (unused.length > 0) {
        const names = unused.slice(0, 5).map(l => l.invoice_description).join(', ');
        const extra = unused.length > 5 ? ` +${unused.length - 5} altri` : '';
        found.push({
          code: 'SC-UNUSED-001', severity: 'insight',
          vendor: null, item_description: null,
          message: `${unused.length} articoli acquistati non usati in ricette: ${names}${extra}`,
        });
      }
    }

    // ── Salva in invoice_warnings ─────────────────────────────
    if (found.length > 0) {
      const scCodes = [...new Set(found.map(r => r.code))];
      // Cancella vecchi SC-* open prima di inserire i nuovi
      await sb.from('invoice_warnings')
        .delete()
        .in('code', scCodes)
        .eq('status', 'open');

      await sb.from('invoice_warnings').insert(found.map(w => ({
        code:             w.code,
        severity:         w.severity,
        status:           'open',
        vendor:           w.vendor || null,
        item_description: w.item_description || null,
        message:          w.message,
        document_id:      null,
        document_date:    null,
        document_number:  null,
        field:            null,
      })));
    } else {
      // Nessun problema trovato — rimuovi vecchi SC-* open
      await sb.from('invoice_warnings')
        .delete()
        .like('code', 'SC-%')
        .eq('status', 'open');
    }

    // ── Aggiorna banner home ──────────────────────────────────
    if (typeof loadWarningsBanner === 'function') loadWarningsBanner();

    // ── Apri lo stack OQR ────────────────────────────────────
    if (found.length > 0) {
      showSousChefStack(found);
    } else {
      if (typeof showScToast === 'function') showScToast('✅ Sous Chef — tutto ok');
    }

  } catch(e) {
    console.error('[SousChefScan] Error:', e.message);
    if (typeof showScToast === 'function') showScToast('⚠️ Scan error: ' + e.message);
  } finally {
    if (btn) { btn.style.background = ''; btn.style.borderColor = ''; }
  }
};

// ── SOUS CHEF STACK — card swipeable OQR ─────────────────────
// Stack di card impilate: una per ogni warning trovato dalla scan.
// Card in cima = più urgente (blocking > alert > insight).
// Swipe giù = skip (va in fondo allo stack).
// Swipe su = risolvi (OQR inline nella card stessa).

function showSousChefStack(warnings) {
  // Ordina: blocking prima, poi alert, poi insight
  const order = { blocking: 0, alert: 1, insight: 2 };
  const stack = [...warnings].sort((a, b) =>
    (order[a.severity] ?? 2) - (order[b.severity] ?? 2)
  );

  const existing = document.getElementById('_scStack');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '_scStack';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9600;display:flex;flex-direction:column;justify-content:flex-end;pointer-events:none;';

  // Sfondo semi-trasparente cliccabile per chiudere
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.45);pointer-events:all;';
  backdrop.addEventListener('click', () => overlay.remove());
  overlay.appendChild(backdrop);

  // Container stack
  const stackEl = document.createElement('div');
  stackEl.style.cssText = 'position:relative;width:100%;max-width:480px;margin:0 auto;height:420px;pointer-events:none;padding:0 12px 24px;box-sizing:border-box;';
  overlay.appendChild(stackEl);

  document.body.appendChild(overlay);

  // Rendi le card (dalla più in basso allo stack alla più in cima)
  function renderStack() {
    stackEl.innerHTML = '';
    const total = stack.length;
    if (total === 0) { overlay.remove(); return; }

    // Mostra massimo 3 card visibili (le prime dello stack)
    const visible = Math.min(total, 3);

    for (let i = visible - 1; i >= 0; i--) {
      const w = stack[i];
      const isTop = i === 0;
      // Offset verticale: card sotto sono più in alto (si vedono i tab colorati)
      const offsetY = i * 44; // px verso l'alto per ogni card sotto
      const scale = 1 - i * 0.04;
      const zIndex = visible - i;

      const card = buildCard(w, i, isTop, offsetY, scale, zIndex, total);
      stackEl.appendChild(card);
    }
  }

  function buildCard(w, idx, isTop, offsetY, scale, zIndex, total) {
    const cfg = {
      blocking: { bg: '#fff5f5', border: '#fca5a5', dot: '#ef4444', label: '🔴 Urgente' },
      alert:    { bg: '#fffbeb', border: '#fcd34d', dot: '#f59e0b', label: '🟡 Attenzione' },
      insight:  { bg: '#eff6ff', border: '#93c5fd', dot: '#3b82f6', label: '🔵 Info' },
    }[w.severity] || { bg: '#f8fafc', border: '#e2e8f0', dot: '#94a3b8', label: '⚪' };

    const card = document.createElement('div');
    card.dataset.idx = idx;
    card.style.cssText = `
      position:absolute;
      bottom:${offsetY}px;
      left:0;right:0;
      background:${cfg.bg};
      border:1.5px solid ${cfg.border};
      border-radius:${isTop ? '20px' : '16px'};
      padding:${isTop ? '18px 16px 14px' : '10px 16px'};
      box-shadow:0 ${isTop ? '16px 40px' : '4px 12px'} rgba(0,0,0,${isTop ? '0.18' : '0.08'});
      transform:scale(${scale});
      transform-origin:center bottom;
      z-index:${zIndex};
      pointer-events:${isTop ? 'all' : 'none'};
      transition:transform .2s,box-shadow .2s;
      touch-action:none;
      user-select:none;
    `;

    if (!isTop) {
      // Card non in cima: mostra solo titolo colorato
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${cfg.dot};flex-shrink:0;display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:${cfg.dot};text-transform:uppercase;letter-spacing:.06em;">${cfg.label}</span>
          <span style="font-size:11px;color:#94a3b8;margin-left:auto;">${total > 1 ? (idx + 1) + '/' + total : ''}</span>
        </div>`;
      return card;
    }

    // Card in cima: OQR completo
    const oqr = scOQRForWarning(w);
    const emoji = scWarnEmoji(w.code);

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${cfg.dot};flex-shrink:0;display:inline-block;"></span>
          <span style="font-size:11px;font-weight:700;color:${cfg.dot};text-transform:uppercase;letter-spacing:.06em;">${cfg.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:11px;color:#94a3b8;">${total > 1 ? '1/' + total : ''}</span>
          <button onclick="document.getElementById('_scStack')?.remove()" style="width:28px;height:28px;border-radius:8px;background:#f1f5f9;border:none;cursor:pointer;font-size:14px;color:#94a3b8;">✕</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;">
        <span style="font-size:28px;flex-shrink:0;">${emoji}</span>
        <div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;line-height:1.3;margin-bottom:4px;">${oqr.title}</div>
          <div style="font-size:13px;color:#475569;line-height:1.4;">${oqr.question}</div>
        </div>
      </div>

      <div style="font-size:11px;color:#94a3b8;background:rgba(0,0,0,0.03);border-radius:8px;padding:6px 10px;margin-bottom:14px;">
        ${w.message}
      </div>

      <div id="_scOQROptions" style="display:flex;flex-direction:column;gap:7px;">
        ${oqr.options.map((opt, oi) => `
          <button data-answer="${opt.value}" data-oi="${oi}"
            style="padding:11px 14px;border-radius:12px;border:1.5px solid ${oi === 0 ? cfg.border : '#e2e8f0'};
              background:${oi === 0 ? cfg.bg : 'white'};
              font-size:13px;color:#1e293b;cursor:pointer;text-align:left;font-weight:${oi === 0 ? 600 : 400};
              display:flex;align-items:center;gap:8px;">
            <span>${opt.emoji || ''}</span><span>${opt.label}</span>
          </button>`).join('')}
      </div>

      <div style="display:flex;justify-content:center;gap:20px;margin-top:14px;">
        <div style="text-align:center;">
          <div style="font-size:18px;">↓</div>
          <div style="font-size:10px;color:#94a3b8;">Skip</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:18px;">↑</div>
          <div style="font-size:10px;color:#94a3b8;">Risolvi</div>
        </div>
      </div>`;

    // Wire up option buttons
    card.querySelectorAll('[data-answer]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const answer = btn.dataset.answer;
        if (answer === 'skip') {
          scSkipTop();
        } else {
          await scResolveTop(w, answer);
        }
      });
    });

    // Swipe gesture
    attachSwipe(card, w);

    return card;
  }

  // ── Swipe logic ───────────────────────────────────────────
  function attachSwipe(card, w) {
    let startY = 0, currentY = 0, dragging = false;

    function onStart(e) {
      // Ignore if tapping a button
      if (e.target.closest('button,[data-answer]')) return;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      dragging = true;
      card.style.transition = 'none';
    }

    function onMove(e) {
      if (!dragging) return;
      currentY = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
      card.style.transform = `scale(1) translateY(${currentY}px)`;
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      card.style.transition = 'transform .3s,opacity .3s';

      if (currentY > 60) {
        // Swipe giù → skip
        card.style.transform = `translateY(200px)`;
        card.style.opacity = '0';
        setTimeout(() => scSkipTop(), 280);
      } else if (currentY < -60) {
        // Swipe su → segna come da risolvere (apre prima opzione)
        card.style.transform = `translateY(-200px)`;
        card.style.opacity = '0';
        setTimeout(() => scResolveTop(w, 'resolved'), 280);
      } else {
        // Torna in posizione
        card.style.transform = 'scale(1) translateY(0)';
      }
      currentY = 0;
    }

    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: true });
    card.addEventListener('touchend', onEnd);
    card.addEventListener('mousedown', onStart);
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseup', onEnd);
  }

  // ── Skip top card → va in fondo ──────────────────────────
  function scSkipTop() {
    if (stack.length === 0) return;
    const top = stack.shift();
    stack.push(top); // in fondo
    renderStack();
  }

  // ── Risolvi top card ──────────────────────────────────────
  async function scResolveTop(w, answer) {
    // Salva in invoice_warnings se ha un id
    if (w.id) {
      const sb = window.supabaseClient;
      if (sb) {
        await sb.from('invoice_warnings').update({
          status: 'resolved',
          resolution: answer,
          resolved_by: window.user?.name || 'Admin',
          resolved_at: new Date().toISOString(),
        }).eq('id', w.id);
      }
    }
    // Rimuovi dallo stack
    stack.shift();
    if (typeof loadWarningsBanner === 'function') loadWarningsBanner();
    if (stack.length === 0) {
      // Tutto risolto — chiudi con celebrazione
      overlay.remove();
      if (typeof showScToast === 'function') showScToast('✅ Sous Chef — tutto risolto!');
    } else {
      renderStack();
    }
  }

  renderStack();
}

// ── OQR content per ogni codice warning ──────────────────────
function scOQRForWarning(w) {
  const item = w.item_description || 'Questo articolo';

  if (w.code === 'SC-PRICE-001') return {
    title: `${item} — prezzo sospetto`,
    question: 'Il $/100g è troppo basso per una carne. Probabilmente il catchweight non è stato rilevato.',
    options: [
      { emoji: '✏️', label: 'Correggi il peso manualmente', value: 'fix_weight' },
      { emoji: '✅', label: 'Il prezzo è corretto così', value: 'price_ok' },
      { emoji: '⏭️', label: 'Skip — ci penso dopo', value: 'skip' },
    ]
  };

  if (w.code === 'SC-PRICE-002') return {
    title: `${item} — prezzo aumentato`,
    question: 'Il prezzo di questo articolo è salito oltre il 20% rispetto alla media storica.',
    options: [
      { emoji: '✅', label: 'Accetto il nuovo prezzo', value: 'accepted' },
      { emoji: '🔍', label: 'Voglio verificare prima', value: 'check' },
      { emoji: '⏭️', label: 'Skip', value: 'skip' },
    ]
  };

  if (w.code === 'SC-NOLINK-001') return {
    title: 'Ingredienti senza prezzo',
    question: 'Alcuni ingredienti attivi non hanno ancora un $/100g calcolato.',
    options: [
      { emoji: '📦', label: 'Vai agli ingredienti', value: 'open_ingredients' },
      { emoji: '⏭️', label: 'Skip', value: 'skip' },
    ]
  };

  if (w.code === 'SC-UNUSED-001') return {
    title: 'Articoli non in ricette',
    question: 'Questi articoli sono stati acquistati ma non compaiono in nessuna ricetta.',
    options: [
      { emoji: '📖', label: 'Vai alle ricette', value: 'open_recipes' },
      { emoji: '✅', label: 'OK, è normale', value: 'resolved' },
      { emoji: '⏭️', label: 'Skip', value: 'skip' },
    ]
  };

  // Default
  return {
    title: item,
    question: w.message || 'Questo elemento richiede attenzione.',
    options: [
      { emoji: '✅', label: 'Risolto', value: 'resolved' },
      { emoji: '⏭️', label: 'Skip', value: 'skip' },
    ]
  };
}

function scWarnEmoji(code) {
  const map = {
    'SC-PRICE-001': '🥩', 'SC-PRICE-002': '📈',
    'SC-NOLINK-001': '💡', 'SC-UNUSED-001': '🔗',
    'OQR-008': '⚖️', 'OQR-007': '📦',
    'DOC-TOTAL-001': '🧮', 'OQR-002': '🔄',
  };
  return map[code] || '⚠️';
}
