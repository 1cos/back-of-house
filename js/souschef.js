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

  // tieni premuto per registrare
  btn.addEventListener('mousedown', startRecording);
  btn.addEventListener('touchstart', e=>{e.preventDefault();startRecording();}, {passive:false});
  btn.addEventListener('mouseup', stopRecording);
  btn.addEventListener('touchend', e=>{e.preventDefault();stopRecording();}, {passive:false});
  btn.addEventListener('mouseleave', ()=>{if(isRecording)stopRecording();});

  // carica tasks esistenti
  loadScTasks();
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
  toast.className='sc-toast fixed top-16 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl max-w-[80vw] text-center';
  toast.textContent=msg;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), duration);
}

// ── CLICK SUL BOTTONE (breve = apri pannello, lungo = registra) ──
let scPressTimer = null;
document.addEventListener('DOMContentLoaded', ()=>{
  setTimeout(()=>{
    const btn = document.getElementById('scBtn');
    if(!btn) return;
    btn.addEventListener('click', ()=>{
      if(!isRecording) openSousChef();
    });
  }, 2000);
});
