# PROMPT PROSSIMA SESSIONE — Brigade v237

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md, BRIGADE_VISION.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Versione: v237
- souschef-chat: v21
- office-ai: v1
- ai-translate: v28

---

## SESSIONE 2026-06-17 — AUDIT TRADUZIONI + GOOGLE TRANSLATE

### Problema trovato e risolto
- ai-translate usava Groq (llama-3.1-8b-instant) come unico motore perché GOOGLE_TRANSLATE_API_KEY non era impostata
- Groq traduceva messaggi inglesi in spagnolo invece di inglese — bug confermato visivamente sulla TV
- SOLUZIONE: creata chiave Google Cloud Translation API, aggiunta ai Supabase secrets come GOOGLE_TRANSLATE_API_KEY
- ai-translate v28 deployata con Google Translate come primario + Groq llama-3.3-70b-versatile come fallback

### Come funziona ora ai-translate v28
- __detect__: Google Detect (o Groq fallback)
- Se testo già nella lingua target → restituisce subito senza tradurre (ottimizzazione)
- Traduzione: Google Translate (primario) → Groq 70b (fallback)
- Groq aggiornato da llama-3.1-8b-instant a llama-3.3-70b-versatile

### Test effettuati
- Chat EN → EN: Tela manda inglese, TV mostra inglese ✅
- Chat EN → TV: messaggi inglesi mostrati in inglese senza traduzione spuria ✅
- Bug spagnolo (Groq): risolto con Google Translate ✅

### Bug UI annotati (da sessione grafica)
- BUG UI 1: Bottone "Send to team" (freccia invio chat) si sovrappone al microfono Sous Chef AI → impossibile toccare send su iPhone
- BUG UI 2: Chat — impossibile copiare testo di un messaggio precedente (long press non funziona)

### Ancora da testare/verificare
- [ ] Antonella (lang=it) deve ricevere traduzione italiana sotto bubble messaggi inglesi — da verificare con Google Translate attivo
- [ ] TV realtime — si blocca dopo molti messaggi ravvicinati — da investigare (loadChat() richiamato troppo spesso)

---

## SESSIONE 2026-06-17 — L'UFFICIO COMPLETO + SQL SOUS CHEF

### Costruito
- **`office_items`** — tabella DB struttura completa
- **`sous_chef_tasks`** — eliminata (era vuota)
- **`js/office.js`** — scrivania operativa: Smart Focus, lista red/orange/blue, realtime, badge, bottone Analizza, Letto/Risolto, data+ora
- **`js/tell-chef.js`** — trigger → office_items con nome utente reale
- **`js/operation-notes.js`** — trigger → office_items
- **`js/souschef-core.js`** — rimossi riferimenti sous_chef_tasks
- **`js/init.js`** — officeBadgeUpdate() all'avvio admin
- **`index.html`** — bottone L'Ufficio + badge rosso nel menu tre puntini
- **Edge Function `office-ai` v1** — analisi AI automatica degli office_items
- **Edge Function `souschef-chat` v21** — SQL query detection

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. ✅ Traduzioni — RISOLTO questa sessione
Google Translate attivo, Groq aggiornato. Verificare Antonella (IT) e realtime TV.

### 2. ⚠️ TV realtime — da investigare
loadChat() viene chiamato ad ogni INSERT → con messaggi ravvicinati il Silk Browser va in timeout.
Fix proposto: aggiungere solo il nuovo messaggio via payload.new invece di ricaricare tutta la chat.

### 3. ⚠️ Bug UI chat (da sessione grafica)
- Send button sovrapposto al mic
- Long press copia non funziona

### 4. Audit menu tre puntini
Molte voci non hanno collegamento funzionante. Fare audit completo.

### 5. Demo Bot (sessione dedicata)
Edge Function + pannello admin con:
- Dropdown frequenza: 5 / 10 / 15 / 20 minuti
- Start / Stop
- Ogni tick = un giorno simulato — UN evento casuale
- ai_analysis pre-scritta (NO chiamate AI durante demo)
- Reset: cancella tutto in un click

### 6. office-ai → cron orario
Aggiungere pg_cron per analisi automatica ogni ora.

### 7. Smart Office — calendario meeting interni
Meeting ricorrenti inseribili da Max dentro Brigade.

---

## REGOLE OPERATIVE — INVIOLABILI
1. Leggi SEMPRE i file da GitHub (mai da memoria)
2. Bumpa sw.js in ogni push che tocca file visibili
3. Dichiara cosa cambierai prima di scrivere — aspetta conferma
4. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
5. MAI pushare su main — sempre brigade-main
6. node --check su ogni file JS prima di pushare
7. office-ai NON va chiamata ad ogni apertura
8. Sous Chef NON cita mai "SQL_RESULTS" o fonti tecniche
