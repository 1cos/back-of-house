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
  // found = array di "card objects" — ogni card ha contesto completo per risolvere inline
  const cards = [];

  try {
    // ── SC-PRICE-001: carni con price_per_100g < $0.10 ─────────
    // Porta contesto completo: vendor, pack, unit_price, ingredient_id
    if (rules['SC-PRICE-001']) {
      const meatKeywords = ['beef','meat','steak','chicken','pork','veal','lamb',
        'rib','loin','tenderloin','brisket','chuck','short','tomahawk','stew'];
      const { data: lowPrice } = await sb
        .from('ingredient_vendors')
        .select('ingredient_id,vendor,unit_price,price_per_100g,pack_description,purchase_unit,conversion_to_base,ingredients(id,name)')
        .not('price_per_100g', 'is', null)
        .lt('price_per_100g', 0.10);

      const meats = (lowPrice || []).filter(row => {
        const name = (row.ingredients?.name || '').toLowerCase();
        return meatKeywords.some(k => name.includes(k));
      });

      // Raggruppa in card da max 3 ingredienti
      for (let i = 0; i < meats.length; i += 3) {
        const group = meats.slice(i, i + 3);
        cards.push({
          code: 'SC-PRICE-001',
          severity: 'blocking',
          title: group.length === 1
            ? `${group[0].ingredients?.name} — prezzo sospetto`
            : `${group.length} carni con prezzo sospetto`,
          items: group.map(row => ({
            ingredient_id: row.ingredient_id,
            ingredient_name: row.ingredients?.name || '?',
            vendor: row.vendor,
            unit_price: row.unit_price,
            price_per_100g: row.price_per_100g,
            pack_description: row.pack_description,
            conversion_to_base: row.conversion_to_base, // grams per purchase unit
          })),
        });
      }
    }

    // ── SC-PRICE-002: prezzi aumentati >20% ────────────────────
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
          pricesByKey[key].push({ price: parseFloat(item.unit_price), date: p.invoice_date, pack: item.pack_size || item.pack_description });
        }
      }

      const spikes = [];
      for (const [key, entries] of Object.entries(pricesByKey)) {
        if (entries.length < 2) continue;
        const latest = entries[0].price;
        const avg = entries.slice(1).reduce((a,b) => a + b.price, 0) / (entries.length - 1);
        if (avg <= 0) continue;
        const pct = Math.round(((latest - avg) / avg) * 100);
        if (pct < 20) continue;
        const [vendor, desc] = key.split('|||');
        spikes.push({ vendor, desc, latest, avg, pct, pack: entries[0].pack, date: entries[0].date });
      }

      for (let i = 0; i < spikes.length; i += 3) {
        const group = spikes.slice(i, i + 3);
        cards.push({
          code: 'SC-PRICE-002',
          severity: 'alert',
          title: group.length === 1
            ? `${group[0].desc} — prezzo +${group[0].pct}%`
            : `${group.length} articoli con prezzo in aumento`,
          items: group.map(s => ({
            ingredient_name: s.desc,
            vendor: s.vendor,
            unit_price: s.latest,
            prev_avg: s.avg,
            pct: s.pct,
            pack_description: s.pack,
            invoice_date: s.date,
          })),
        });
      }
    }

    // ── SC-NOLINK-001: ingredienti senza price_per_100g ─────────
    if (rules['SC-NOLINK-001']) {
      const { data: allIngr } = await sb
        .from('ingredients')
        .select('id,name,category')
        .eq('active', true)
        .neq('category', 'Supply');

      const { data: ivRows } = await sb
        .from('ingredient_vendors')
        .select('ingredient_id,vendor,unit_price,price_per_100g,pack_description,conversion_to_base');

      // Mappa ingredient_id → vendor row
      const ivMap = {};
      for (const iv of (ivRows || [])) {
        if (!ivMap[iv.ingredient_id]) ivMap[iv.ingredient_id] = iv;
        // Preferisci riga con price_per_100g
        else if (iv.price_per_100g && !ivMap[iv.ingredient_id].price_per_100g) ivMap[iv.ingredient_id] = iv;
      }

      const missing = (allIngr || []).filter(i => {
        const iv = ivMap[i.id];
        return !iv || !iv.price_per_100g;
      });

      for (let i = 0; i < missing.length; i += 3) {
        const group = missing.slice(i, i + 3);
        cards.push({
          code: 'SC-NOLINK-001',
          severity: 'insight',
          title: `${missing.length} ingredienti senza $/100g`,
          subtitle: `Gruppo ${Math.floor(i/3)+1} di ${Math.ceil(missing.length/3)}`,
          items: group.map(ingr => {
            const iv = ivMap[ingr.id];
            return {
              ingredient_id: ingr.id,
              ingredient_name: ingr.name,
              vendor: iv?.vendor || null,
              unit_price: iv?.unit_price || null,
              pack_description: iv?.pack_description || null,
              conversion_to_base: iv?.conversion_to_base || null,
            };
          }),
        });
      }
    }

    // ── SC-UNUSED-001 ────────────────────────────────────────
    if (rules['SC-UNUSED-001']) {
      const { data: linked } = await sb
        .from('ingredient_links').select('invoice_description,vendor').eq('confirmed',true).limit(300);
      const { data: recipes } = await sb.from('recipes').select('ingredients');
      const inRecipes = new Set();
      for (const r of (recipes||[])) for (const ing of (r.ingredients||[])) if(ing.name) inRecipes.add(ing.name.toLowerCase());
      const unused = (linked||[]).filter(l => !inRecipes.has((l.invoice_description||'').toLowerCase()));
      if (unused.length > 0) {
        for (let i = 0; i < Math.min(unused.length, 9); i += 3) {
          const group = unused.slice(i, i+3);
          cards.push({
            code: 'SC-UNUSED-001', severity: 'insight',
            title: `${unused.length} articoli non in ricette`,
            items: group.map(u => ({ ingredient_name: u.invoice_description, vendor: u.vendor })),
          });
        }
      }
    }

    // ── Salva warning sintetici in invoice_warnings ──────────
    const scCodes = [...new Set(cards.map(c => c.code))];
    if (scCodes.length > 0) {
      await sb.from('invoice_warnings').delete().in('code', scCodes).eq('status','open');
      await sb.from('invoice_warnings').insert(cards.map(c => ({
        code: c.code, severity: c.severity, status: 'open',
        vendor: c.items?.[0]?.vendor || null,
        item_description: c.title,
        message: c.title,
        document_id: null, document_date: null, document_number: null, field: null,
      })));
    } else {
      await sb.from('invoice_warnings').delete().like('code','SC-%').eq('status','open');
    }

    if (typeof loadWarningsBanner === 'function') loadWarningsBanner();

    if (cards.length > 0) {
      showSousChefStack(cards);
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

// ── SOUS CHEF STACK ───────────────────────────────────────────
// Card impilate. Card in cima: contesto fattura + azione inline.
// Card sotto: solo titolo colorato visibile.
// Swipe giù = skip (va in fondo). Swipe su = expand OQR.

function showSousChefStack(cards) {
  const order = { blocking:0, alert:1, insight:2 };
  const stack = [...cards].sort((a,b) => (order[a.severity]??2)-(order[b.severity]??2));

  document.getElementById('_scStack')?.remove();
  const overlay = document.createElement('div');
  overlay.id = '_scStack';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9600;display:flex;flex-direction:column;justify-content:flex-end;';

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.5);';
  backdrop.addEventListener('click', () => overlay.remove());
  overlay.appendChild(backdrop);

  const stackWrap = document.createElement('div');
  stackWrap.style.cssText = 'position:relative;width:100%;max-width:480px;margin:0 auto;pointer-events:none;padding:0 0 32px;';
  overlay.appendChild(stackWrap);
  document.body.appendChild(overlay);

  // Altezza card in cima (dinamica — si espande con la tastiera)
  const CARD_TOP_H = 'auto';
  const TAB_H = 48; // px — altezza tab sotto

  function renderStack() {
    stackWrap.innerHTML = '';
    if (stack.length === 0) { overlay.remove(); return; }
    const total = stack.length;
    const visible = Math.min(total, 3);

    // Disegna dal fondo verso l'alto (z-index crescente)
    for (let i = visible - 1; i >= 0; i--) {
      const card = stack[i];
      const isTop = i === 0;
      const cfg = severityCfg(card.severity);

      const el = document.createElement('div');
      el.dataset.stackIdx = i;

      if (!isTop) {
        // Tab visibile sotto la card principale
        const bottomOffset = (visible - 1 - i) * 0; // impilate
        el.style.cssText = `
          position:relative;
          background:${cfg.bg};border:1.5px solid ${cfg.border};
          border-radius:16px;padding:12px 16px;
          margin-bottom:6px;
          box-shadow:0 2px 8px rgba(0,0,0,0.06);
          pointer-events:none;
          transform:scale(${1 - (i * 0.03)});
          transform-origin:center bottom;
          z-index:${10-i};`;
        el.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${cfg.dot};flex-shrink:0;"></span>
            <span style="font-size:14px;font-weight:700;color:${cfg.dot};">${card.title}</span>
            <span style="font-size:12px;color:#94a3b8;margin-left:auto;">${i+1}/${total}</span>
          </div>`;
        stackWrap.insertBefore(el, stackWrap.firstChild);
        continue;
      }

      // Card in cima — completa
      el.style.cssText = `
        position:relative;
        background:${cfg.bg};border:2px solid ${cfg.border};
        border-radius:20px;padding:18px 16px 16px;
        box-shadow:0 12px 40px rgba(0,0,0,0.18);
        pointer-events:all;z-index:20;
        margin-bottom:6px;`;

      el.innerHTML = buildTopCardHTML(card, cfg, total);
      stackWrap.appendChild(el);

      // Wire up action buttons
      wireCardActions(el, card);

      // Swipe gesture
      attachCardSwipe(el, card);
    }
  }

  function buildTopCardHTML(card, cfg, total) {
    const emoji = scWarnEmoji(card.code);
    const subtitle = card.subtitle ? `<span style="font-size:11px;color:#94a3b8;"> · ${card.subtitle}</span>` : '';

    // Riga intestazione
    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:22px;">${emoji}</span>
          <div>
            <div style="font-size:16px;font-weight:700;color:#1e293b;line-height:1.2;">${card.title}</div>
            <div style="font-size:11px;color:${cfg.dot};font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;">${cfg.label}${subtitle}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${total > 1 ? `<span style="font-size:12px;color:#94a3b8;">${total} problemi</span>` : ''}
          <button onclick="document.getElementById('_scStack')?.remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;cursor:pointer;font-size:16px;color:#64748b;">✕</button>
        </div>
      </div>`;

    // Contenuto specifico per codice
    html += buildCardBody(card);

    // Hint swipe
    html += `
      <div style="display:flex;justify-content:center;gap:32px;margin-top:16px;padding-top:12px;border-top:0.5px solid ${cfg.border};">
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:20px;">↓</div>
          <div style="font-size:11px;margin-top:2px;">Skip</div>
        </div>
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:20px;">↑</div>
          <div style="font-size:11px;margin-top:2px;">Fine</div>
        </div>
      </div>`;

    return html;
  }

  function buildCardBody(card) {
    // ── SC-PRICE-001: peso mancante su carni ──────────────────
    if (card.code === 'SC-PRICE-001') {
      return card.items.map((item, i) => `
        <div id="scItem-${i}" style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.15);border-radius:14px;padding:12px 14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <div>
              <div style="font-size:15px;font-weight:700;color:#1e293b;">${item.ingredient_name}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">${item.vendor || ''} ${item.pack_description ? '· ' + item.pack_description : ''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:600;color:#ef4444;">$${(item.price_per_100g||0).toFixed(4)}/100g</div>
              <div style="font-size:11px;color:#64748b;">$${(item.unit_price||0).toFixed(2)}/case</div>
            </div>
          </div>
          <div style="font-size:12px;color:#475569;margin-bottom:8px;">Quanto pesa una cassa? <span style="color:#ef4444;">* Il prezzo sembra troppo basso.</span></div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="scWeight-${i}" type="number" placeholder="es. 28" min="0.1" step="0.1"
              style="flex:1;height:40px;padding:0 12px;border:1.5px solid #fca5a5;border-radius:10px;font-size:16px;outline:none;background:white;"
              oninput="scPreviewPrice(${i},${item.unit_price||0},'lb')">
            <select id="scWeightUnit-${i}" style="height:40px;padding:0 8px;border:1.5px solid #fca5a5;border-radius:10px;font-size:14px;background:white;">
              <option value="lb">lb</option>
              <option value="kg">kg</option>
              <option value="oz">oz</option>
              <option value="g">g</option>
            </select>
            <button onclick="scSaveWeight(${i},'${item.ingredient_id}','${(item.vendor||'').replace(/'/g,"\\'")}',${item.unit_price||0})"
              style="height:40px;padding:0 14px;border-radius:10px;background:#1e293b;color:white;font-size:14px;font-weight:600;border:none;cursor:pointer;white-space:nowrap;">
              ✓ Salva
            </button>
          </div>
          <div id="scPricePreview-${i}" style="font-size:12px;color:#10b981;margin-top:6px;display:none;"></div>
        </div>`).join('');
    }

    // ── SC-PRICE-002: prezzo aumentato ────────────────────────
    if (card.code === 'SC-PRICE-002') {
      return card.items.map((item, i) => `
        <div style="background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.2);border-radius:14px;padding:12px 14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
            <div>
              <div style="font-size:15px;font-weight:700;color:#1e293b;">${item.ingredient_name}</div>
              <div style="font-size:11px;color:#64748b;margin-top:1px;">${item.vendor||''} ${item.pack_description ? '· '+item.pack_description : ''}</div>
            </div>
            <span style="background:rgba(239,68,68,0.1);color:#dc2626;font-size:13px;font-weight:700;padding:3px 10px;border-radius:8px;">+${item.pct}%</span>
          </div>
          <div style="display:flex;gap:12px;font-size:12px;color:#64748b;margin-bottom:10px;">
            <span>Media storica: <strong style="color:#1e293b;">$${(item.prev_avg||0).toFixed(2)}</strong></span>
            <span>Ultima fattura: <strong style="color:#dc2626;">$${(item.unit_price||0).toFixed(2)}</strong></span>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="scAcceptPrice(this,'${(item.vendor||'').replace(/'/g,"\\'")}','${(item.ingredient_name||'').replace(/'/g,"\\'")}',${item.unit_price||0})"
              style="flex:1;height:40px;border-radius:10px;background:#f0fdf4;color:#166534;border:1.5px solid #bbf7d0;font-size:14px;font-weight:600;cursor:pointer;">
              ✓ Accetto il nuovo prezzo
            </button>
            <button onclick="this.closest('[style*=border-radius:14px]').style.opacity='0.4'"
              style="height:40px;padding:0 14px;border-radius:10px;background:#fef2f2;color:#991b1b;border:1.5px solid #fecaca;font-size:14px;cursor:pointer;">
              ✕
            </button>
          </div>
        </div>`).join('');
    }

    // ── SC-NOLINK-001: ingredienti senza prezzo ───────────────
    if (card.code === 'SC-NOLINK-001') {
      return card.items.map((item, i) => `
        <div style="background:rgba(59,130,246,0.04);border:1px solid rgba(59,130,246,0.15);border-radius:14px;padding:12px 14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <div>
              <div style="font-size:15px;font-weight:700;color:#1e293b;">${item.ingredient_name}</div>
              <div style="font-size:11px;color:#64748b;margin-top:1px;">${item.vendor ? item.vendor + ' · ' : ''}${item.pack_description || 'Nessun pack'}${item.unit_price ? ' · $'+parseFloat(item.unit_price).toFixed(2)+'/case' : ' · prezzo sconosciuto'}</div>
            </div>
            <span style="font-size:11px;color:#3b82f6;background:rgba(59,130,246,0.1);padding:3px 8px;border-radius:6px;">no $/100g</span>
          </div>
          ${item.unit_price ? `
          <div style="font-size:12px;color:#475569;margin-bottom:8px;">Inserisci il peso per calcolare il $/100g:</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="scWeight-nl-${i}" type="number" placeholder="es. 10" min="0.1" step="0.1"
              style="flex:1;height:40px;padding:0 12px;border:1.5px solid #93c5fd;border-radius:10px;font-size:16px;outline:none;background:white;"
              oninput="scPreviewPriceNL(${i},${item.unit_price})">
            <select id="scWeightUnitNL-${i}" style="height:40px;padding:0 8px;border:1.5px solid #93c5fd;border-radius:10px;font-size:14px;background:white;">
              <option value="lb">lb</option>
              <option value="kg">kg</option>
              <option value="oz">oz</option>
              <option value="g">g</option>
            </select>
            <button onclick="scSaveWeightNL(${i},'${(item.ingredient_id||'').replace(/'/g,"\\'")}','${(item.vendor||'').replace(/'/g,"\\'")}',${item.unit_price})"
              style="height:40px;padding:0 14px;border-radius:10px;background:#1e293b;color:white;font-size:14px;font-weight:600;border:none;cursor:pointer;">
              ✓
            </button>
          </div>
          <div id="scPricePreviewNL-${i}" style="font-size:12px;color:#10b981;margin-top:6px;display:none;"></div>
          ` : `<div style="font-size:12px;color:#94a3b8;">Nessun prezzo in fattura — importa prima una fattura per questo ingrediente.</div>`}
        </div>`).join('');
    }

    // Default
    return `<div style="font-size:14px;color:#475569;padding:8px 0;">${card.items.map(i=>i.ingredient_name).join(', ')}</div>`;
  }

  function wireCardActions(el, card) {
    // scPreviewPrice: mostra calcolo real-time mentre digiti il peso (SC-PRICE-001)
    window.scPreviewPrice = function(idx, unitPrice, defaultUnit) {
      const input = document.getElementById(`scWeight-${idx}`);
      const unitSel = document.getElementById(`scWeightUnit-${idx}`);
      const preview = document.getElementById(`scPricePreview-${idx}`);
      if (!input || !preview) return;
      const w = parseFloat(input.value);
      const unit = unitSel?.value || defaultUnit || 'lb';
      if (!w || w <= 0) { preview.style.display='none'; return; }
      const UNIT_G = {lb:453.592,kg:1000,oz:28.3495,g:1};
      const totalG = w * (UNIT_G[unit]||453.592);
      const p100 = (unitPrice / totalG) * 100;
      preview.textContent = `→ $${p100.toFixed(4)}/100g`;
      preview.style.display = 'block';
    };

    // scSaveWeight: salva peso corretto su ingredient_vendors (SC-PRICE-001)
    window.scSaveWeight = async function(idx, ingredientId, vendor, unitPrice) {
      const input = document.getElementById(`scWeight-${idx}`);
      const unitSel = document.getElementById(`scWeightUnit-${idx}`);
      const w = parseFloat(input?.value);
      if (!w || w <= 0) { input?.focus(); return; }
      const UNIT_G = {lb:453.592,kg:1000,oz:28.3495,g:1};
      const unit = unitSel?.value || 'lb';
      const totalG = w * (UNIT_G[unit]||453.592);
      const p100 = parseFloat(((unitPrice/totalG)*100).toFixed(4));

      const sbBtn = input?.parentElement?.querySelector('button');
      if (sbBtn) { sbBtn.textContent='...'; sbBtn.disabled=true; }

      const sb = window.supabaseClient;
      const { error } = await sb.from('ingredient_vendors').update({
        conversion_to_base: totalG,
        price_per_100g: p100,
      }).eq('ingredient_id', ingredientId).eq('vendor', vendor);

      if (error) {
        if (typeof showScToast === 'function') showScToast('❌ Errore: ' + error.message);
        if (sbBtn) { sbBtn.textContent='✓ Salva'; sbBtn.disabled=false; }
        return;
      }

      // Segna item risolto visivamente
      const itemEl = document.getElementById(`scItem-${idx}`);
      if (itemEl) {
        itemEl.style.opacity = '0.5';
        itemEl.style.pointerEvents = 'none';
        const preview = document.getElementById(`scPricePreview-${idx}`);
        if (preview) preview.textContent = `✅ Salvato — $${p100.toFixed(4)}/100g`;
      }

      // Controlla se tutti gli item nella card sono risolti
      const allItems = el.querySelectorAll('[id^="scItem-"]');
      const allDone = [...allItems].every(it => it.style.opacity === '0.5');
      if (allDone) setTimeout(() => scResolveTop(), 600);
    };

    // Preview per SC-NOLINK-001
    window.scPreviewPriceNL = function(idx, unitPrice) {
      const input = document.getElementById(`scWeight-nl-${idx}`);
      const unitSel = document.getElementById(`scWeightUnitNL-${idx}`);
      const preview = document.getElementById(`scPricePreviewNL-${idx}`);
      if (!input||!preview) return;
      const w = parseFloat(input.value);
      const unit = unitSel?.value||'lb';
      if (!w||w<=0){preview.style.display='none';return;}
      const UNIT_G={lb:453.592,kg:1000,oz:28.3495,g:1};
      const totalG=w*(UNIT_G[unit]||453.592);
      const p100=(unitPrice/totalG)*100;
      preview.textContent=`→ $${p100.toFixed(4)}/100g`;
      preview.style.display='block';
    };

    window.scSaveWeightNL = async function(idx, ingredientId, vendor, unitPrice) {
      const input = document.getElementById(`scWeight-nl-${idx}`);
      const unitSel = document.getElementById(`scWeightUnitNL-${idx}`);
      const w = parseFloat(input?.value);
      if (!w||w<=0){input?.focus();return;}
      const UNIT_G={lb:453.592,kg:1000,oz:28.3495,g:1};
      const unit=unitSel?.value||'lb';
      const totalG=w*(UNIT_G[unit]||453.592);
      const p100=parseFloat(((unitPrice/totalG)*100).toFixed(4));
      const sb=window.supabaseClient;
      await sb.from('ingredient_vendors').update({conversion_to_base:totalG,price_per_100g:p100})
        .eq('ingredient_id',ingredientId).eq('vendor',vendor);
      const preview=document.getElementById(`scPricePreviewNL-${idx}`);
      if(preview){preview.textContent=`✅ $${p100.toFixed(4)}/100g`;preview.style.display='block';}
      const itemEl=input?.closest('[style*="border-radius:14px"]');
      if(itemEl){itemEl.style.opacity='0.5';itemEl.style.pointerEvents='none';}
    };

    // Accept price (SC-PRICE-002)
    window.scAcceptPrice = async function(btn, vendor, desc, newPrice) {
      btn.textContent='...'; btn.disabled=true;
      // Aggiorna ingredient_vendors cercando per vendor + nome approx
      const sb=window.supabaseClient;
      const {data:links}=await sb.from('ingredient_links')
        .select('ingredient_id').eq('vendor',vendor).ilike('invoice_description',`%${desc.slice(0,15)}%`).limit(1);
      if (links?.length) {
        await sb.from('ingredient_vendors').update({unit_price:newPrice})
          .eq('ingredient_id',links[0].ingredient_id).eq('vendor',vendor);
      }
      btn.textContent='✅ Accettato';
      const itemEl=btn.closest('[style*="border-radius:14px"]');
      if(itemEl){itemEl.style.opacity='0.5';itemEl.style.pointerEvents='none';}
    };
  }

  // ── Swipe ────────────────────────────────────────────────
  function attachCardSwipe(el) {
    let startY=0, curY=0, dragging=false;
    const onStart=(e)=>{
      if(e.target.closest('button,input,select')) return;
      startY=e.touches?e.touches[0].clientY:e.clientY;
      dragging=true; el.style.transition='none';
    };
    const onMove=(e)=>{
      if(!dragging) return;
      curY=(e.touches?e.touches[0].clientY:e.clientY)-startY;
      el.style.transform=`translateY(${curY}px)`;
    };
    const onEnd=()=>{
      if(!dragging) return; dragging=false;
      el.style.transition='transform .3s,opacity .3s';
      if(curY>70){
        el.style.transform='translateY(200px)'; el.style.opacity='0';
        setTimeout(scSkipTop, 280);
      } else if(curY<-70){
        el.style.transform='translateY(-200px)'; el.style.opacity='0';
        setTimeout(scResolveTop, 280);
      } else {
        el.style.transform='';
      }
      curY=0;
    };
    el.addEventListener('touchstart',onStart,{passive:true});
    el.addEventListener('touchmove',onMove,{passive:true});
    el.addEventListener('touchend',onEnd);
    el.addEventListener('mousedown',onStart);
    el.addEventListener('mousemove',onMove);
    el.addEventListener('mouseup',onEnd);
  }

  function scSkipTop(){
    if(!stack.length) return;
    stack.push(stack.shift());
    renderStack();
  }

  function scResolveTop(){
    if(!stack.length) return;
    stack.shift();
    if(typeof loadWarningsBanner==='function') loadWarningsBanner();
    if(!stack.length){
      overlay.remove();
      if(typeof showScToast==='function') showScToast('✅ Sous Chef — tutto risolto!');
    } else {
      renderStack();
    }
  }

  renderStack();
}

function severityCfg(severity) {
  return {
    blocking: { bg:'#fff5f5', border:'#fca5a5', dot:'#ef4444', label:'🔴 Urgente' },
    alert:    { bg:'#fffbeb', border:'#fcd34d', dot:'#f59e0b', label:'🟡 Attenzione' },
    insight:  { bg:'#eff6ff', border:'#93c5fd', dot:'#3b82f6', label:'🔵 Info' },
  }[severity] || { bg:'#f8fafc', border:'#e2e8f0', dot:'#94a3b8', label:'⚪' };
}

function scWarnEmoji(code) {
  const map = {
    'SC-PRICE-001':'🥩','SC-PRICE-002':'📈',
    'SC-NOLINK-001':'💡','SC-UNUSED-001':'🔗',
    'OQR-008':'⚖️','OQR-007':'📦','DOC-TOTAL-001':'🧮','OQR-002':'🔄',
  };
  return map[code]||'⚠️';
}
