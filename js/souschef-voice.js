// ══════════════════════════════════════════════════════════════
// SOUS CHEF VOICE — registrazione, Whisper, memoria attenzione
// ══════════════════════════════════════════════════════════════

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// ── REGISTRAZIONE ──
async function startRecording(){
  if(isRecording) return;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    audioChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' :
                     MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? {mimeType} : {});
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    isRecording = true;
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

// ── TRASCRIZIONE WHISPER ──
async function processAudio(blob, mimeType){
  try{
    const mt2 = mimeType || blob.type || 'audio/mp4';
    const base64Audio = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const transcribeRes = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ audio: base64Audio, mimeType: mt2, language: 'it' })
    });
    const transcribeData = await transcribeRes.json();
    const transcript = transcribeData.text || transcribeData.error || '';
    if(!transcript.trim()){ showScToast('❌ Non ho sentito nulla. Riprova.'); return; }
    showScToast(`"${transcript.slice(0,40)}..."`, 2000);
    await classifyWithGroq(transcript);
  }catch(e){
    showScToast('❌ Errore: '+e.message);
  }
}

// ── VOCE → CHAT ──
async function classifyWithGroq(transcript){
  try{
    const words = transcript.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if(words.length) saveChefAttention(words[0], words[0], 'general', transcript, null).catch(()=>{});
    openSousChefChat();
    setTimeout(() => scChatSend(transcript), 400);
  }catch(e){
    showScToast('❌ Errore: '+e.message);
  }
}

// ── MEMORIA ATTENZIONE CHEF ──
async function saveChefAttention(topic, topicEn, queryType, rawQuestion, lastAnswer) {
  try {
    const sb = window.supabaseClient;
    if (!sb) return;
    const topicNorm = topic.toLowerCase().trim();
    const { data: existing } = await sb.from('chef_attention').select('id, ask_count').eq('topic', topicNorm).maybeSingle();
    if (existing) {
      await sb.from('chef_attention').update({
        ask_count: existing.ask_count + 1,
        last_asked: new Date().toISOString(),
        last_answer: lastAnswer || null,
        raw_question: rawQuestion || null,
      }).eq('id', existing.id);
    } else {
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
  } catch(_) {}
}
