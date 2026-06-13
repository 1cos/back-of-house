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
  "notify": true/false,
  "attention_topic": "parola chiave principale della domanda in italiano (es. burrata, salmone, pasta wheel) — null se è un task",
  "attention_topic_en": "stessa keyword in inglese normalizzato (es. burrata, salmon, pasta wheel) — null se è un task",
  "attention_type": "price | quantity | vendor | general — null se è un task"
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

    // ── CHEF MEMORY: salva domanda in background (fire & forget) ──
    if(result.type === 'domanda' && result.attention_topic) {
      saveChefAttention(
        result.attention_topic,
        result.attention_topic_en || null,
        result.attention_type || 'general',
        transcript,
        result.answer || null
      ).catch(() => {}); // silenzioso — non blocca mai l'UI
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

// ── CHEF MEMORY ENGINE — salva attenzione in silenzio ──────────
// Chiamata dopo ogni domanda vocale. Fuoco e dimentica.
// Usa UPSERT: se il topic esiste già, incrementa il contatore.
async function saveChefAttention(topic, topicEn, queryType, rawQuestion, lastAnswer) {
  try {
    const sb = window.supabaseClient;
    if (!sb) return;

    const topicNorm = topic.toLowerCase().trim();

    // Cerca se esiste già
    const { data: existing } = await sb
      .from('chef_attention')
      .select('id, ask_count')
      .eq('topic', topicNorm)
      .maybeSingle();

    if (existing) {
      // Incrementa contatore
      await sb.from('chef_attention').update({
        ask_count: existing.ask_count + 1,
        last_asked: new Date().toISOString(),
        last_answer: lastAnswer || null,
        raw_question: rawQuestion || null,
      }).eq('id', existing.id);
    } else {
      // Inserisci nuovo topic
      await sb.from('chef_attention').insert({
        topic: topicNorm,
        topic_en: topicEn ? topicEn.toLowerCase().trim() : null,
        query_type: queryType || 'general',
        raw_question: rawQuestion || null,
        ask_count: 1,
        first_asked: new Date().toISOString(),
        last_asked: new Date().toISOString(),
        last_answer: lastAnswer || null,
      });
    }
  } catch(_) {
    // Silenzioso — la memoria non deve mai rompere il flusso principale
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
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);display:flex;align-items:flex-end;';

  // Categoria → colore e emoji
  const catColor = {
    'Food Cost': { bg:'#eff6ff', border:'#93c5fd', dot:'#3b82f6', emoji:'💰' },
    'Acquisti':  { bg:'#f0fdf4', border:'#86efac', dot:'#22c55e', emoji:'🛒' },
    'HR':        { bg:'#fdf4ff', border:'#d8b4fe', dot:'#a855f7', emoji:'👥' },
    'Manutenzione': { bg:'#fff7ed', border:'#fdba74', dot:'#f97316', emoji:'🔧' },
    'Task':      { bg:'#f8fafc', border:'#cbd5e1', dot:'#64748b', emoji:'✅' },
  }[result.category] || { bg:'#eff6ff', border:'#93c5fd', dot:'#3b82f6', emoji:'🤖' };

  const hasAnswer = result.answer && result.answer.trim().length > 0;

  sheet.innerHTML = `
    <div style="
      background:white;
      width:100%;
      max-width:480px;
      margin:0 auto;
      border-radius:28px 28px 0 0;
      padding:0 0 32px;
      max-height:80vh;
      overflow:auto;
      animation:slideUp .25s ease;
      box-shadow:0 -8px 40px rgba(0,0,0,0.2);
    ">
      <!-- Handle -->
      <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;margin:12px auto 0;"></div>

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:10px;padding:16px 20px 12px;">
        <div style="width:44px;height:44px;border-radius:14px;background:${catColor.bg};border:1.5px solid ${catColor.border};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">
          ${catColor.emoji}
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:${catColor.dot};text-transform:uppercase;letter-spacing:.06em;">Sous Chef</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:1px;font-style:italic;">"${(result.text||'').slice(0,60)}${(result.text||'').length>60?'…':''}"</div>
        </div>
      </div>

      <!-- Risposta -->
      <div style="margin:0 16px 16px;padding:18px;background:${catColor.bg};border:1.5px solid ${catColor.border};border-radius:20px;">
        <div style="font-size:19px;font-weight:600;color:#1e293b;line-height:1.5;">
          ${hasAnswer ? result.answer : '⚠️ Nessuna informazione disponibile in questo momento.'}
        </div>
      </div>

      <!-- Bottone -->
      <div style="padding:0 16px;">
        <button onclick="this.closest('[style*=position\\:fixed]').remove()"
          style="
            width:100%;
            height:56px;
            border-radius:16px;
            background:#1e293b;
            color:white;
            font-size:18px;
            font-weight:700;
            border:none;
            cursor:pointer;
            letter-spacing:.02em;
          ">
          ✓ Capito, Chef
        </button>
      </div>
    </div>`;

  sheet.addEventListener('click', e => { if(e.target === sheet) sheet.remove(); });
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

  // Throttle: max 1 scan AI ogni 30 minuti (protegge Groq quota)
  const lastScan = parseInt(localStorage.getItem('sc_last_scan') || '0');
  const now = Date.now();
  const THROTTLE_MS = 30 * 60 * 1000;
  if (now - lastScan < THROTTLE_MS) {
    const minsLeft = Math.ceil((THROTTLE_MS - (now - lastScan)) / 60000);
    if (typeof showScToast === 'function') showScToast(`⏳ Prossima scan disponibile tra ${minsLeft} min`);
    return;
  }

  const btn = document.getElementById('scBtn');
  if (btn) { btn.style.background = 'rgba(16,185,129,0.15)'; btn.style.borderColor = '#10b981'; }
  if (typeof showScToast === 'function') showScToast('🔍 Sous Chef sta analizzando...');

  try {
    // ── 1. Raccogli dati reali dal DB ─────────────────────────
    const [{ data: ivRows }, { data: allIngr }, { data: allRecipes }, { data: linkRows }] = await Promise.all([
      sb.from('ingredient_vendors')
        .select('ingredient_id,vendor,unit_price,price_per_100g,pack_description,last_invoice_date')
        .not('unit_price', 'is', null),
      sb.from('ingredients').select('id,name,category').eq('active', true),
      sb.from('recipes').select('title,ingredients'),
      sb.from('ingredient_links').select('ingredient_id').eq('confirmed', true),
    ]);

    // Mappa id → nome ingrediente
    const ingrMap = {};
    for (const i of (allIngr || [])) ingrMap[i.id] = i;

    // Nomi ricette (sub-ricette = produzione interna)
    const recipeNames = new Set((allRecipes || []).map(r => (r.title || '').toLowerCase().trim()));

    // Ingredienti usati in ricette
    const usedInRecipes = new Set();
    for (const r of (allRecipes || [])) {
      for (const ing of (r.ingredients || [])) {
        if (ing.name) usedInRecipes.add(ing.name.toLowerCase().trim());
      }
    }

    // Ingredienti con link fattura confermato
    const linkedIds = new Set((linkRows || []).map(l => l.ingredient_id));

    // ── 2. Costruisci dataset per Groq ───────────────────────
    // Solo ingredienti rilevanti — non sub-ricette, non Supply
    const dataset = [];
    for (const iv of (ivRows || [])) {
      const ingr = ingrMap[iv.ingredient_id];
      if (!ingr) continue;
      if (ingr.category === 'Supply') continue;
      const nameLower = ingr.name.toLowerCase().trim();
      // Skip sub-ricette (produzione interna)
      if (recipeNames.has(nameLower) && !linkedIds.has(iv.ingredient_id)) continue;

      dataset.push({
        id: iv.ingredient_id,
        name: ingr.name,
        vendor: iv.vendor,
        unit_price: parseFloat(iv.unit_price) || null,
        price_per_100g: iv.price_per_100g ? parseFloat(iv.price_per_100g) : null,
        pack: iv.pack_description,
        last_invoice: iv.last_invoice_date,
        in_recipes: usedInRecipes.has(nameLower),
        has_link: linkedIds.has(iv.ingredient_id),
      });
    }

    // Aggiungi ingredienti senza vendor (potenziali fantasmi)
    for (const ingr of (allIngr || [])) {
      if (ingr.category === 'Supply') continue;
      const nameLower = ingr.name.toLowerCase().trim();
      if (recipeNames.has(nameLower)) continue; // sub-ricetta
      const alreadyIn = dataset.find(d => d.id === ingr.id);
      if (alreadyIn) continue;
      const hasLink = linkedIds.has(ingr.id);
      const inRec = usedInRecipes.has(nameLower);
      if (!hasLink && !inRec) {
        dataset.push({
          id: ingr.id, name: ingr.name,
          vendor: null, unit_price: null, price_per_100g: null,
          pack: null, last_invoice: null,
          in_recipes: false, has_link: false,
        });
      }
    }

    if (dataset.length === 0) {
      if (typeof showScToast === 'function') showScToast('✅ Nessun dato da analizzare');
      return;
    }

    // ── 3. Chiedi a Groq di ragionare sui dati reali ─────────
    const dataJson = JSON.stringify(dataset.slice(0, 80)); // max 80 items per token limit

    const prompt = `Sei l'Executive Sous Chef digitale di Zenos on the Square, ristorante italiano a Weatherford Texas.
Il tuo compito è analizzare i dati reali degli ingredienti e trovare anomalie — come farebbe un sous chef esperto guardando i numeri della cucina.

DATI INGREDIENTI (JSON):
${dataJson}

ISTRUZIONI PER L'ANALISI:
Ragiona su questi dati come un esperto di food cost. Trova problemi reali, non teorici.

Tipi di problemi da cercare:
1. PREZZO IMPOSSIBILE: price_per_100g esiste ma è troppo basso per quel tipo di prodotto
   (es. carne a $0.06/100g è impossibile — deve essere un errore di peso)
2. PESO MANCANTE: unit_price esiste ma price_per_100g è null e il pack è in CT/DZ/EA
   (il peso per unità non è mai stato inserito — senza peso non si calcola il food cost)
3. FANTASMA: nessun vendor, nessun link fattura, non usato in ricette
   (ingrediente creato per errore — va eliminato)

REGOLE:
- Usa il buon senso di un cuoco: la farina costa poco, la carne costa molto, il pesce ancora di più
- Se il price_per_100g sembra impossibile per quel tipo di prodotto, segnalalo
- Se il pack è in CT/EA/DZ e manca price_per_100g, il peso non è mai stato calcolato
- Non segnalare sub-ricette o preparazioni interne
- Sii conciso — Max è in cucina e ha poco tempo
- Massimo 6 problemi totali — solo i più importanti

RISPOSTA: JSON array, niente altro, niente markdown.
Formato esatto:
[
  {
    "code": "SC-PRICE-001" | "SC-NOLINK-001" | "SC-GHOST-001",
    "severity": "blocking" | "alert" | "insight",
    "subtype": "price_impossible" | "missing_weight" | "ghost",
    "ingredient_id": "uuid",
    "ingredient_name": "nome",
    "vendor": "vendor o null",
    "unit_price": numero o null,
    "price_per_100g": numero o null,
    "pack": "pack o null",
    "title": "frase breve max 6 parole",
    "question": "domanda OQR in italiano — una sola domanda",
    "options": [
      {"label": "risposta breve", "value": "valore_interno"},
      {"label": "risposta breve", "value": "valore_interno"}
    ],
    "reasoning": "una frase: perché è un problema"
  }
]`;

    // ── Chiama Edge Function (OpenRouter con fallback Groq) ───
    const groqRes = await fetch(`${SUPABASE_URL}/functions/v1/souschef-classify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ mode: 'scan', scanPrompt: prompt }),
    });

    if (!groqRes.ok) throw new Error('Scan error: ' + groqRes.status);
    const groqData = await groqRes.json();
    const rawText = groqData.rawText || '';

    // Parse JSON da Groq
    let problems = [];
    try {
      const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const arr = JSON.parse(cleaned);
      problems = Array.isArray(arr) ? arr : [];
    } catch(e) {
      // Fallback: cerca array JSON nel testo
      const m = rawText.match(/\[[\s\S]*\]/);
      if (m) {
        try { problems = JSON.parse(m[0]); } catch(_) {}
      }
    }

    if (problems.length === 0) {
      if (typeof showScToast === 'function') showScToast('✅ Sous Chef — tutto ok');
      localStorage.setItem('sc_last_scan', String(now));
      return;
    }

    // ── 4. Converti i problemi Groq in card per lo stack ─────
    // Raggruppa per subtype (max 3 per card)
    const order = { blocking:0, alert:1, insight:2 };
    problems.sort((a,b) => (order[a.severity]??2) - (order[b.severity]??2));

    const cards = [];
    for (let i = 0; i < problems.length; i += 3) {
      const group = problems.slice(i, i + 3);
      const first = group[0];
      const n = group.length;

      cards.push({
        code: first.code,
        severity: first.severity,
        subtype: first.subtype,
        title: n === 1 ? first.title : `${n} problemi — ${first.title}`,
        items: group.map(p => ({
          ingredient_id: p.ingredient_id,
          ingredient_name: p.ingredient_name,
          vendor: p.vendor,
          unit_price: p.unit_price,
          price_per_100g: p.price_per_100g,
          pack_description: p.pack,
          // OQR da Groq — domanda e opzioni già pronte
          oqr_question: p.question,
          oqr_options: p.options || [],
          oqr_reasoning: p.reasoning,
        })),
      });
    }

    // ── 5. Salva in invoice_warnings ─────────────────────────
    const scCodes = [...new Set(cards.map(c => c.code))];
    await sb.from('invoice_warnings').delete().in('code', scCodes).eq('status', 'open');
    await sb.from('invoice_warnings').insert(cards.map(c => ({
      code: c.code, severity: c.severity, status: 'open',
      vendor: c.items?.[0]?.vendor || null,
      item_description: c.title,
      message: c.title,
      document_id: null, document_date: null, document_number: null, field: null,
    })));

    if (typeof loadWarningsBanner === 'function') loadWarningsBanner();

    // ── 6. Mostra stack ───────────────────────────────────────
    localStorage.setItem('sc_last_scan', String(now));
    showSousChefStack(cards);

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
            <span style="font-size:16px;font-weight:700;color:${cfg.dot};">${card.title}</span>
            <span style="font-size:13px;color:#94a3b8;margin-left:auto;">${i+1}/${total}</span>
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
            <div style="font-size:19px;font-weight:700;color:#1e293b;line-height:1.2;">${card.title}</div>
            <div style="font-size:13px;color:${cfg.dot};font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;">${cfg.label}${subtitle}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${total > 1 ? `<span style="font-size:14px;color:#94a3b8;">${total} problemi</span>` : ''}
          <button onclick="document.getElementById('_scStack')?.remove()" style="width:32px;height:32px;border-radius:10px;background:#f1f5f9;border:none;cursor:pointer;font-size:16px;color:#64748b;">✕</button>
        </div>
      </div>`;

    // Contenuto specifico per codice
    html += buildCardBody(card);

    // Hint swipe
    html += `
      <div style="display:flex;justify-content:center;gap:32px;margin-top:16px;padding-top:12px;border-top:0.5px solid ${cfg.border};">
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:24px;">↓</div>
          <div style="font-size:13px;margin-top:2px;">Skip</div>
        </div>
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:24px;">↑</div>
          <div style="font-size:13px;margin-top:2px;">Fine</div>
        </div>
      </div>`;

    return html;
  }

  function buildCardBody(card) {
    // ── Groq OQR: domanda e opzioni già pronte da Groq ────────
    // Se il primo item ha oqr_question, usa quello invece delle regole hardcodate
    if (card.items?.[0]?.oqr_question) {
      return card.items.map((item, i) => {
        const hasWeightAction = item.subtype === 'missing_weight' || card.subtype === 'missing_weight' ||
          (item.oqr_options||[]).some(o => o.value === 'manual_weight');
        const bgColor = card.severity === 'blocking' ? 'rgba(239,68,68,0.04)' :
                        card.severity === 'alert'    ? 'rgba(245,158,11,0.05)' :
                                                       'rgba(59,130,246,0.04)';
        const borderColor = card.severity === 'blocking' ? 'rgba(239,68,68,0.15)' :
                            card.severity === 'alert'    ? 'rgba(245,158,11,0.2)' :
                                                           'rgba(59,130,246,0.15)';
        const optionsHtml = (item.oqr_options || []).map((opt, oi) => {
          if (opt.value === 'manual_weight') {
            // Opzione speciale: input peso
            return `
              <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                <input id="scGroqWeight-${i}" type="number" placeholder="es. 28" min="0.1" step="0.1"
                  style="flex:1;height:48px;padding:0 14px;border:2px solid #93c5fd;border-radius:12px;font-size:18px;outline:none;background:white;"
                  oninput="scGroqPreview(${i},${item.unit_price||0})">
                <select id="scGroqUnit-${i}" style="height:48px;padding:0 10px;border:2px solid #93c5fd;border-radius:12px;font-size:16px;background:white;">
                  <option value="lb">lb</option><option value="kg">kg</option>
                  <option value="oz">oz</option><option value="g">g</option>
                </select>
                <button onclick="scGroqSaveWeight(${i},'${(item.ingredient_id||'').replace(/'/g,"\\'")}','${(item.vendor||'').replace(/'/g,"\\'")}',${item.unit_price||0})"
                  style="height:48px;padding:0 16px;border-radius:12px;background:#1e293b;color:white;font-size:18px;font-weight:700;border:none;cursor:pointer;">✓</button>
              </div>
              <div id="scGroqPreview-${i}" style="font-size:15px;font-weight:600;color:#10b981;margin-top:8px;display:none;"></div>`;
          }
          if (opt.value === 'delete') {
            return `<button onclick="scDeleteGhost('${item.ingredient_id}',${i})"
              style="flex:1;height:48px;border-radius:12px;background:#ef4444;color:white;font-size:16px;font-weight:700;border:none;cursor:pointer;">🗑️ ${opt.label}</button>`;
          }
          return `<button data-answer="${opt.value}"
            onclick="scGroqAnswer(this,'${item.ingredient_id||''}','${(item.vendor||'').replace(/'/g,"\\'")}','${opt.value}')"
            style="flex:1;height:48px;border-radius:12px;background:${oi===0?'#f0fdf4':'#f8fafc'};color:${oi===0?'#166534':'#1e293b'};border:1.5px solid ${oi===0?'#bbf7d0':'#e2e8f0'};font-size:15px;font-weight:600;cursor:pointer;">
            ${opt.label}
          </button>`;
        }).join('');

        return `
          <div id="scGroqItem-${i}" style="background:${bgColor};border:1px solid ${borderColor};border-radius:16px;padding:16px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div style="font-size:18px;font-weight:700;color:#1e293b;">${item.ingredient_name}</div>
              ${item.price_per_100g ? `<span style="font-size:13px;color:#ef4444;font-weight:700;">$${parseFloat(item.price_per_100g).toFixed(3)}/100g</span>` :
                item.unit_price ? `<span style="font-size:13px;color:#64748b;">$${parseFloat(item.unit_price).toFixed(2)}/case</span>` : ''}
            </div>
            ${item.vendor || item.pack_description ? `<div style="font-size:14px;color:#64748b;margin-bottom:6px;">${item.vendor||''} ${item.pack_description ? '· '+item.pack_description : ''}</div>` : ''}
            ${item.oqr_reasoning ? `<div style="font-size:13px;color:#475569;font-style:italic;margin-bottom:10px;">${item.oqr_reasoning}</div>` : ''}
            <div style="font-size:16px;font-weight:600;color:#1e293b;margin-bottom:10px;">${item.oqr_question}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">${optionsHtml}</div>
          </div>`;
      }).join('');
    }

    // ── SC-PRICE-001: peso mancante su carni ──────────────────
    if (card.code === 'SC-PRICE-001') {
      return card.items.map((item, i) => `
        <div id="scItem-${i}" style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.15);border-radius:14px;padding:12px 14px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <div>
              <div style="font-size:18px;font-weight:700;color:#1e293b;">${item.ingredient_name}</div>
              <div style="font-size:14px;color:#64748b;margin-top:2px;">${item.vendor || ''} ${item.pack_description ? '· ' + item.pack_description : ''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:15px;font-weight:600;color:#ef4444;">$${(item.price_per_100g||0).toFixed(4)}/100g</div>
              <div style="font-size:14px;color:#64748b;">$${(item.unit_price||0).toFixed(2)}/case</div>
            </div>
          </div>
          <div style="font-size:15px;font-weight:600;color:#475569;margin-bottom:10px;">Quanto pesa una cassa? <span style="color:#ef4444;">* Il prezzo sembra troppo basso.</span></div>
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
              <div style="font-size:18px;font-weight:700;color:#1e293b;">${item.ingredient_name}</div>
              <div style="font-size:14px;color:#64748b;margin-top:1px;">${item.vendor||''} ${item.pack_description ? '· '+item.pack_description : ''}</div>
            </div>
            <span style="background:rgba(239,68,68,0.1);color:#dc2626;font-size:15px;font-weight:700;padding:4px 12px;border-radius:8px;">+${item.pct}%</span>
          </div>
          <div style="display:flex;gap:12px;font-size:14px;color:#64748b;margin-bottom:12px;">
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

    // ── SC-NOLINK-001: due varianti ───────────────────────────
    if (card.code === 'SC-NOLINK-001') {
      // FANTASMA: nessun dato → bottone Elimina
      if (card.subtype === 'ghost') {
        return card.items.map((item, i) => `
          <div id="scGhost-${i}" style="background:rgba(239,68,68,0.04);border:1px solid rgba(239,68,68,0.15);border-radius:16px;padding:16px;margin-bottom:12px;">
            <div style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:6px;">${item.ingredient_name}</div>
            <div style="font-size:14px;color:#64748b;margin-bottom:14px;">Non è collegato a nessuna fattura, nessun fornitore e non è usato in nessuna ricetta.</div>
            <div style="display:flex;gap:10px;">
              <button onclick="scDeleteGhost('${item.ingredient_id}',${i})"
                style="flex:1;height:48px;border-radius:12px;background:#ef4444;color:white;font-size:16px;font-weight:700;border:none;cursor:pointer;">
                🗑️ Elimina
              </button>
              <button onclick="document.getElementById('scGhost-${i}').style.opacity='0.4';document.getElementById('scGhost-${i}').style.pointerEvents='none'"
                style="height:48px;padding:0 18px;border-radius:12px;background:#f1f5f9;color:#64748b;font-size:15px;border:none;cursor:pointer;">
                Tieni
              </button>
            </div>
          </div>`).join('');
      }
      // PESO MANCANTE: ha prezzo ma manca peso → input
      return card.items.map((item, i) => `
        <div id="scMW-${i}" style="background:rgba(59,130,246,0.04);border:1px solid rgba(59,130,246,0.15);border-radius:16px;padding:16px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
            <div style="font-size:18px;font-weight:700;color:#1e293b;">${item.ingredient_name}</div>
            <span style="font-size:12px;color:#3b82f6;background:rgba(59,130,246,0.1);padding:4px 10px;border-radius:8px;font-weight:600;">no $/100g</span>
          </div>
          <div style="font-size:14px;color:#64748b;margin-bottom:12px;">${item.vendor || ''} ${item.pack_description ? '· ' + item.pack_description : ''} · <strong style="color:#1e293b;">$${parseFloat(item.unit_price||0).toFixed(2)}/case</strong></div>
          <div style="font-size:14px;color:#475569;font-weight:600;margin-bottom:10px;">Quanto pesa una cassa?</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="scWeightMW-${i}" type="number" placeholder="es. 10" min="0.1" step="0.1"
              style="flex:1;height:48px;padding:0 14px;border:2px solid #93c5fd;border-radius:12px;font-size:18px;outline:none;background:white;"
              oninput="scPreviewPriceMW(${i},${item.unit_price||0})">
            <select id="scWeightUnitMW-${i}" style="height:48px;padding:0 10px;border:2px solid #93c5fd;border-radius:12px;font-size:16px;background:white;">
              <option value="lb">lb</option>
              <option value="kg">kg</option>
              <option value="oz">oz</option>
              <option value="g">g</option>
            </select>
            <button onclick="scSaveWeightMW(${i},'${(item.ingredient_id||'').replace(/'/g,"\\'")}','${(item.vendor||'').replace(/'/g,"\\'")}',${item.unit_price||0})"
              style="height:48px;padding:0 16px;border-radius:12px;background:#1e293b;color:white;font-size:18px;font-weight:700;border:none;cursor:pointer;">
              ✓
            </button>
          </div>
          <div id="scPriceMW-${i}" style="font-size:15px;font-weight:600;color:#10b981;margin-top:8px;display:none;"></div>
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
    // scGroqAnswer: risposta generica a OQR da Groq
    window.scGroqAnswer = async function(btn, ingredientId, vendor, answer) {
      btn.style.opacity = '0.5'; btn.disabled = true;
      const itemEl = btn.closest('[id^="scGroqItem-"]');
      if (itemEl) { itemEl.style.opacity = '0.5'; itemEl.style.pointerEvents = 'none'; }
      // Salva la risposta in invoice_line_clarifications se utile
      if (ingredientId && answer && answer !== 'skip') {
        const sb = window.supabaseClient;
        // Marca il warning come resolved
        await sb.from('invoice_warnings')
          .update({ status: 'resolved', resolution: answer,
            resolved_by: window.user?.name || 'Admin',
            resolved_at: new Date().toISOString() })
          .eq('item_description', itemEl?.closest('[data-stack-idx]')?.querySelector('[style*="font-weight:700"]')?.textContent || '')
          .eq('status', 'open');
      }
      // Controlla se tutti risolti
      const card = itemEl?.closest('[data-stack-idx="0"]');
      if (card) {
        const allItems = card.querySelectorAll('[id^="scGroqItem-"]');
        const allDone = [...allItems].every(it => it.style.opacity === '0.5');
        if (allDone) setTimeout(() => scResolveTop(), 400);
      }
    };

    // scGroqPreview: anteprima $/100g mentre digiti il peso
    window.scGroqPreview = function(idx, unitPrice) {
      const input = document.getElementById('scGroqWeight-' + idx);
      const unitSel = document.getElementById('scGroqUnit-' + idx);
      const preview = document.getElementById('scGroqPreview-' + idx);
      if (!input || !preview) return;
      const w = parseFloat(input.value);
      const unit = unitSel?.value || 'lb';
      if (!w || w <= 0) { preview.style.display = 'none'; return; }
      const UNIT_G = { lb:453.592, kg:1000, oz:28.3495, g:1 };
      const totalG = w * (UNIT_G[unit] || 453.592);
      const p100 = (unitPrice / totalG) * 100;
      preview.textContent = '→ $' + p100.toFixed(4) + '/100g';
      preview.style.display = 'block';
    };

    // scGroqSaveWeight: salva peso da OQR Groq
    window.scGroqSaveWeight = async function(idx, ingredientId, vendor, unitPrice) {
      const input = document.getElementById('scGroqWeight-' + idx);
      const unitSel = document.getElementById('scGroqUnit-' + idx);
      const w = parseFloat(input?.value);
      if (!w || w <= 0) { input?.focus(); return; }
      const UNIT_G = { lb:453.592, kg:1000, oz:28.3495, g:1 };
      const unit = unitSel?.value || 'lb';
      const totalG = w * (UNIT_G[unit] || 453.592);
      const p100 = parseFloat(((unitPrice / totalG) * 100).toFixed(4));
      const sb = window.supabaseClient;
      const { error } = await sb.from('ingredient_vendors')
        .update({ conversion_to_base: totalG, price_per_100g: p100 })
        .eq('ingredient_id', ingredientId).eq('vendor', vendor);
      if (error) { if (typeof showScToast === 'function') showScToast('❌ ' + error.message); return; }
      const preview = document.getElementById('scGroqPreview-' + idx);
      if (preview) { preview.textContent = '✅ $' + p100.toFixed(4) + '/100g salvato'; preview.style.display = 'block'; }
      const el = document.getElementById('scGroqItem-' + idx);
      if (el) { el.style.opacity = '0.5'; el.style.pointerEvents = 'none'; }
      const allItems = el?.closest('[data-stack-idx="0"]')?.querySelectorAll('[id^="scGroqItem-"]') || [];
      if ([...allItems].every(m => m.style.opacity === '0.5')) setTimeout(() => scResolveTop(), 400);
      if (typeof loadWarningsBanner === 'function') loadWarningsBanner();
    };

    // scDeleteGhost: elimina ingrediente fantasma dal DB
    window.scDeleteGhost = async function(ingredientId, idx) {
      const sb = window.supabaseClient;
      const el = document.getElementById('scGhost-' + idx);
      if (el) { el.style.opacity = '0.5'; el.style.pointerEvents = 'none'; }
      await sb.from('ingredients').update({ active: false }).eq('id', ingredientId);
      if (el) {
        const btn = el.querySelector('button');
        if (btn) btn.textContent = '✅ Eliminato';
        const allGhosts = stackWrap?.querySelectorAll('[id^="scGhost-"]') || [];
        const allDone = [...allGhosts].every(g => g.style.opacity === '0.5');
        if (allDone) setTimeout(() => scResolveTop(), 500);
      }
    };

    // scPreviewPriceMW: preview $/100g per SC-NOLINK-001 missing_weight
    window.scPreviewPriceMW = function(idx, unitPrice) {
      const input = document.getElementById('scWeightMW-' + idx);
      const unitSel = document.getElementById('scWeightUnitMW-' + idx);
      const preview = document.getElementById('scPriceMW-' + idx);
      if (!input || !preview) return;
      const w = parseFloat(input.value);
      const unit = unitSel?.value || 'lb';
      if (!w || w <= 0) { preview.style.display = 'none'; return; }
      const UNIT_G = { lb:453.592, kg:1000, oz:28.3495, g:1 };
      const totalG = w * (UNIT_G[unit] || 453.592);
      const p100 = (unitPrice / totalG) * 100;
      preview.textContent = '→ $' + p100.toFixed(4) + '/100g';
      preview.style.display = 'block';
    };

    // scSaveWeightMW: salva peso per SC-NOLINK-001 missing_weight
    window.scSaveWeightMW = async function(idx, ingredientId, vendor, unitPrice) {
      const input = document.getElementById('scWeightMW-' + idx);
      const unitSel = document.getElementById('scWeightUnitMW-' + idx);
      const w = parseFloat(input?.value);
      if (!w || w <= 0) { input?.focus(); return; }
      const UNIT_G = { lb:453.592, kg:1000, oz:28.3495, g:1 };
      const unit = unitSel?.value || 'lb';
      const totalG = w * (UNIT_G[unit] || 453.592);
      const p100 = parseFloat(((unitPrice / totalG) * 100).toFixed(4));
      const sb = window.supabaseClient;
      const { error } = await sb.from('ingredient_vendors')
        .update({ conversion_to_base: totalG, price_per_100g: p100 })
        .eq('ingredient_id', ingredientId).eq('vendor', vendor);
      if (error) { if (typeof showScToast === 'function') showScToast('❌ ' + error.message); return; }
      const preview = document.getElementById('scPriceMW-' + idx);
      if (preview) { preview.textContent = '✅ $' + p100.toFixed(4) + '/100g salvato'; preview.style.display = 'block'; }
      const el = document.getElementById('scMW-' + idx);
      if (el) { el.style.opacity = '0.5'; el.style.pointerEvents = 'none'; }
      const allMW = el?.closest('[data-stack-idx]')?.querySelectorAll('[id^="scMW-"]') || [];
      const allDone = [...allMW].every(m => m.style.opacity === '0.5');
      if (allDone) setTimeout(() => scResolveTop(), 500);
    };

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
