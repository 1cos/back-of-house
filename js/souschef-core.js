// ══════════════════════════════════════════════════════════════
// SOUS CHEF CORE — init, bottone, gesture, toast, badge, tasks
// ══════════════════════════════════════════════════════════════

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


// ── INIT SOUS CHEF ──
async function initSousChef(){
  if(!isAdmin()) return;
  if(document.getElementById('scBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'scBtn';
  btn.className = 'fixed z-50 w-14 h-14 bg-white/90 backdrop-blur border border-slate-200 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition select-none';
  btn.style.cssText = 'position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));right:16px;z-index:50;';
  btn.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5">
      <path d="M12 2a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
    <span id="scPulse" class="hidden absolute inset-0 rounded-full border-2 border-blue-400 animate-ping"></span>`;
  document.body.appendChild(btn);
  setTimeout(scAttachGestures, 100);

  // Scan automatica — orari Texas CDT (UTC-5)
  // 06:30 → scan mattina speciale
  // 06:30-17:30 → ogni ora
  // 17:30-06:30 → nessuna scan
  scScheduleAutoScan();
}

function scGetTexasHour() {
  // CDT = UTC-5 (estate), CST = UTC-6 (inverno)
  // Usiamo offset fisso -5 per CDT (maggio-novembre)
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const texas = new Date(utc - 5 * 60 * 60 * 1000);
  return { hour: texas.getHours(), minute: texas.getMinutes(), texas };
}

function scIsActiveHour() {
  const { hour } = scGetTexasHour();
  // Attivo dalle 06:30 alle 17:30
  return hour >= 6 && hour < 17 || (hour === 6 && scGetTexasHour().minute >= 30);
}

function scScheduleAutoScan() {
  // Controlla ogni minuto se è il momento giusto di scandire
  const CHECK_INTERVAL = 60 * 1000; // 1 minuto

  // Ultima scan tracciata separata dal throttle manuale
  let lastAutoScan = parseInt(localStorage.getItem('sc_last_auto_scan') || '0');

  function tick() {
    const { hour, minute, texas } = scGetTexasHour();
    const now = Date.now();
    const dayOfWeek = texas.getDay(); // 0=domenica, 1=lunedì...
    const isSunday = dayOfWeek === 0;

    const is630 = hour === 6 && minute >= 30 && minute < 35;
    const todayKey = texas.toISOString().slice(0, 10);
    const lastMorningKey = localStorage.getItem('sc_last_morning_scan') || '';

    if (is630 && lastMorningKey !== todayKey) {
      localStorage.setItem('sc_last_morning_scan', todayKey);

      if (isSunday) {
        // Domenica 06:30 — solo messaggio buona domenica, zero scan
        console.log('[AutoScan] Domenica — solo buongiorno, nessuna scan');
        scSundayGreeting(texas);
        return;
      }

      // Lunedì-Sabato 06:30 — scan mattina normale
      localStorage.removeItem('sc_last_scan');
      if (typeof runSousChefScan === 'function') {
        console.log('[AutoScan] Scan mattina 06:30 Texas');
        runSousChefScan(true);
      }
      lastAutoScan = now;
      localStorage.setItem('sc_last_auto_scan', String(now));
      return;
    }

    // Scan oraria 06:30-17:30 — solo Lunedì-Sabato
    if (!isSunday && scIsActiveHour()) {
      const ONE_HOUR = 60 * 60 * 1000;
      if (now - lastAutoScan >= ONE_HOUR) {
        lastAutoScan = now;
        localStorage.setItem('sc_last_auto_scan', String(now));
        localStorage.removeItem('sc_last_scan');
        if (typeof runSousChefScan === 'function') {
          console.log('[AutoScan] Scan oraria', `${hour}:${String(minute).padStart(2,'0')} Texas`);
          runSousChefScan(true);
        }
      }
    }
  }

  // ── DOMENICA — buona domenica + recap settimana + settimana prossima ──
  async function scSundayGreeting(texas) {
    try {
      const sb = window.supabaseClient;
      if (!sb) return;

      const days = ['Domenica','Lunedi','Martedi','Mercoledi','Giovedi','Venerdi','Sabato'];
      const months = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];

      // Recap settimana passata
      const monday = new Date(texas);
      monday.setDate(texas.getDate() - texas.getDay() + 1);
      const mondayStr = monday.toISOString().slice(0, 10);
      const sundayStr = texas.toISOString().slice(0, 10);

      const { data: sales } = await sb
        .from('pos_daily_summary')
        .select('sale_date, net_sales, bill_count')
        .gte('sale_date', mondayStr)
        .lte('sale_date', sundayStr)
        .order('sale_date', { ascending: true });

      const totalCovers = (sales || []).reduce(function(s, d) { return s + parseInt(d.bill_count || 0); }, 0);
      const sorted = [...(sales || [])].sort(function(a, b) { return parseInt(b.bill_count) - parseInt(a.bill_count); });
      const bestDay = sorted[0];
      const worstDay = sorted[sorted.length - 1];

      const { data: topItems } = await sb
        .from('pos_sales_by_item')
        .select('menu_item, quantity')
        .gte('sale_date', mondayStr)
        .lte('sale_date', sundayStr)
        .order('quantity', { ascending: false })
        .limit(3);

      const topItemsStr = (topItems || []).slice(0, 3)
        .map(function(t, i) { return (i+1) + '. ' + t.menu_item + ' (' + t.quantity + ' pz)'; })
        .join(', ');

      var recapSettimana = 'RECAP SETTIMANA\n';
      recapSettimana += totalCovers + ' coperti totali\n';
      if (bestDay) recapSettimana += 'Giorno piu pieno: ' + days[new Date(bestDay.sale_date).getDay()] + ' (' + parseInt(bestDay.bill_count || 0) + ' coperti)\n';
      if (worstDay && worstDay.sale_date !== (bestDay && bestDay.sale_date)) recapSettimana += 'Giorno piu quieto: ' + days[new Date(worstDay.sale_date).getDay()] + ' (' + parseInt(worstDay.bill_count || 0) + ' coperti)\n';
      if (topItemsStr) recapSettimana += 'Top piatti: ' + topItemsStr;

      // Settimana prossima
      const nextMonday = new Date(texas);
      nextMonday.setDate(texas.getDate() + 1);
      const nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextMonday.getDate() + 6);
      const nextMondayStr = nextMonday.toISOString().slice(0, 10);
      const nextSundayStr = nextSunday.toISOString().slice(0, 10);

      const { data: events } = await sb
        .from('tripleseat_events')
        .select('name, event_date, guest_count, menu_type, location')
        .gte('event_date', nextMondayStr)
        .lte('event_date', nextSundayStr)
        .order('event_date', { ascending: true })
        .limit(10);

      const { data: serviceEvents } = await sb
        .from('service_updates')
        .select('message, created_at')
        .eq('level', 'event')
        .gte('created_at', nextMondayStr)
        .lte('created_at', nextSundayStr + 'T23:59:59')
        .order('created_at', { ascending: true })
        .limit(5);

      var recapProssima = 'SETTIMANA PROSSIMA\n';
      recapProssima += nextMonday.getDate() + ' ' + months[nextMonday.getMonth()] + ' - ' + nextSunday.getDate() + ' ' + months[nextSunday.getMonth()] + '\n';

      if (events && events.length > 0) {
        recapProssima += events.map(function(e) {
          const d = new Date(e.event_date);
          return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ': ' + e.name + (e.guest_count ? ' (' + e.guest_count + ' ospiti)' : '') + (e.menu_type ? ' - ' + e.menu_type : '');
        }).join('\n');
      } else if (serviceEvents && serviceEvents.length > 0) {
        recapProssima += serviceEvents.map(function(e) { return e.message; }).join('\n');
      } else {
        recapProssima += 'Nessun evento in agenda.\nCollega TripleSeat per vedere gli eventi automaticamente.';
      }

      const msg = 'Buona domenica crew! Buon riposo a tutti - ci vediamo lunedi!\n\n' + recapSettimana + '\n\n' + recapProssima;

      showScToast('Buona domenica! Recap settimana disponibile in Service Updates.', 6000);

      await sb.from('service_updates').insert({
        message: msg,
        level: 'info',
        created_by: 'Sous Chef',
      });

      if (typeof loadServiceUpdates === 'function') loadServiceUpdates();

    } catch(e) {
      console.error('[SundayGreeting]', e.message);
      showScToast('Buona domenica! Buon riposo crew!', 6000);
    }
  }


  // Prima esecuzione dopo 10 secondi (app appena aperta)
  setTimeout(tick, 10000);
  // Poi ogni minuto
  setInterval(tick, CHECK_INTERVAL);
}

// ── GESTURE: tap breve = chat, long press = voce ──
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
      openSousChefChat();
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

// ── TOAST ──
function showScToast(msg, duration=3000){
  document.querySelectorAll('.sc-toast').forEach(t=>t.remove());
  const toast = document.createElement('div');
  toast.className='sc-toast fixed z-[9999] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-2xl shadow-xl max-w-[80vw] text-center';
  toast.style.cssText += ';bottom:96px;left:50%;transform:translateX(-50%);';
  toast.textContent=msg;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), duration);
}

// Badge urgenti → ora gestito da office_items

// loadScTasks + markScDone → rimossi, ora tutto va in office_items

// openSousChef panel → rimosso, sostituito da L'Ufficio

// ── RISPOSTA DOMANDA (sheet) ──
function showScAnswer(result){
  const sheet = document.createElement('div');
  sheet.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);display:flex;align-items:flex-end;';
  const catColor = {
    'Food Cost': { bg:'#eff6ff', border:'#93c5fd', dot:'#3b82f6', emoji:'💰' },
    'Acquisti':  { bg:'#f0fdf4', border:'#86efac', dot:'#22c55e', emoji:'🛒' },
    'HR':        { bg:'#fdf4ff', border:'#d8b4fe', dot:'#a855f7', emoji:'👥' },
    'Manutenzione': { bg:'#fff7ed', border:'#fdba74', dot:'#f97316', emoji:'🔧' },
    'Task':      { bg:'#f8fafc', border:'#cbd5e1', dot:'#64748b', emoji:'✅' },
  }[result.category] || { bg:'#eff6ff', border:'#93c5fd', dot:'#3b82f6', emoji:'🤖' };
  const hasAnswer = result.answer && result.answer.trim().length > 0;
  const sheetId = '_scAnswerSheet_' + Date.now();
  sheet.id = sheetId;
  sheet.innerHTML = `
    <div style="background:white;width:100%;max-width:480px;margin:0 auto;border-radius:28px 28px 0 0;padding:0 0 32px;max-height:80vh;overflow:auto;animation:slideUp .25s ease;box-shadow:0 -8px 40px rgba(0,0,0,0.2);">
      <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;margin:12px auto 0;"></div>
      <div style="display:flex;align-items:center;gap:10px;padding:16px 20px 12px;">
        <div style="width:44px;height:44px;border-radius:14px;background:${catColor.bg};border:1.5px solid ${catColor.border};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${catColor.emoji}</div>
        <div>
          <div style="font-size:13px;font-weight:700;color:${catColor.dot};text-transform:uppercase;letter-spacing:.06em;">Sous Chef</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:1px;font-style:italic;">"${(result.text||'').slice(0,60)}${(result.text||'').length>60?'…':''}"</div>
        </div>
      </div>
      <div style="margin:0 16px 16px;padding:18px;background:${catColor.bg};border:1.5px solid ${catColor.border};border-radius:20px;">
        <div style="font-size:19px;font-weight:600;color:#1e293b;line-height:1.5;">${hasAnswer ? result.answer : '⚠️ Nessuna informazione disponibile.'}</div>
      </div>
      <div style="padding:0 16px;">
        <button onclick="document.getElementById('${sheetId}').remove()"
          style="width:100%;height:56px;border-radius:16px;background:#1e293b;color:white;font-size:18px;font-weight:700;border:none;cursor:pointer;">
          ✓ Capito, Chef
        </button>
      </div>
    </div>`;
  sheet.addEventListener('click', e => { if(e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}

