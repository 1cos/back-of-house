# PROMPT PROSSIMA SESSIONE — Brigade v219

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md, BRIGADE_VISION.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Display: https://1cos.github.io/back-of-house/display.html (LIVE su Fire TV)
- Versione: v219

---

## SESSIONE 2026-06-17 — cosa è successo

### Fix pushati (v219)
- `js/tell-chef.js` — fix user_name: ora prende da window.user, non più "Unknown"
- `js/operation-notes.js` — fix window.supabaseClient → window.supa (le note ora si salvano)
- DB: tutti i chef_reports con user_name "Unknown" aggiornati a "Anto"

### Visione documentata
- Aggiunta sezione "Brigade Communication & Decision System" in BRIGADE_VISION.md
- I tre livelli: 🔴 RED (Act Now) · 🟠 ORANGE (Must Read + conferma) · 🔵 BLUE (FYI)
- Decision Loop documentato: problema → Chef AI analizza + propone → Max decide → sistema esegue → archivio
- I tre meeting documentati: Pre-Lunch (11:00) · Pre-Dinner (16:00) · Post-Service (22:00)
- Regola fondamentale: i cuochi portano problemi e idee. Max decide sempre. Chef AI propone, non decide mai.

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. Decision Loop — il cuore (da costruire)
Il posto dove Chef AI porta problemi e osservazioni a Max con opzioni concrete.
NON è il Warning Center fatture (quello rimane separato, solo finanziario).
È una sezione nuova — accessibile dai tre puntini → "Chef AI" o "Meeting".
Leggi BRIGADE_VISION.md sezione "Brigade Communication & Decision System" per la spec completa.

**Cosa costruire:**
- Tabella DB: `chef_decisions` (problema, fonte, livello_suggerito, opzioni JSON, decisione_max, stato, created_at)
- Edge Function: `sc-nightly-brief` v11 — aggiungere lettura chef_reports (status=new) al prompt admin
- UI: sezione admin "Chef AI" — lista problemi aperti con opzioni, Max risponde, sistema esegue

### 2. Sistema livelli 🔴🟠🔵 — sulla comunicazione
Colonna `priority_level` (red/orange/blue) su alerts e chef_decisions.
Per orange: conferma di lettura obbligatoria al login + tracker chi ha confermato.

### 3. Briefing AI fix (v11 sc-nightly-brief)
- Aggiungere lettura chef_reports (status new/read) al prompt
- 2-3 punti concreti con numeri reali invece di frasi vaghe
- Sezione "From your team" nel briefing

---

## CONTESTO IMPORTANTE — per capire le priorità

### Warning Center — due separati
- **Warning Center Finanziario** (esistente): fatture, prezzi, link mancanti — solo Max, già funziona
- **Warning Center Operativo** (da costruire): questo è il Decision Loop — problemi operativi, segnalazioni brigata, osservazioni AI

### Tell Chef — stato attuale
- Funziona: cuoco manda segnalazione → va in chef_reports
- Manca: Chef AI non legge chef_reports nel briefing
- Manca: nessun loop decisionale — Max vede il messaggio ma non ha opzioni/risposta strutturata
- Manca: badge notifica sui tre puntini per nuovi report

### Operation Notes — stato attuale
- Fix pushato oggi (window.supa): ora si salvano correttamente
- Tabella vuota — app pre-launch, nessun uso reale ancora
- Non entrano nel briefing AI

### Focus Mode — IMPLEMENTATO v5
- Automatico 8:00-20:00 CDT, sostituisce la home per staff (non admin)
- Nessun swipe — era nella spec vecchia, rimosso

### TripleSeat — PENDING Monica
- Monica deve premere Authorize su zottsllc.tripleseat.com/settings/api
- Tutto il codice è pronto, manca solo quel click

---

## REGOLE OPERATIVE — INVIOLABILI
1. Leggi SEMPRE i file da GitHub (mai da /mnt/project/ o memoria)
2. Bumpa sw.js in ogni push che tocca file visibili all'utente
3. Dichiara cosa cambierai prima di scrivere codice — aspetta conferma
4. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
5. Non lavorare mai su file in memoria — sempre online
6. MAI pushare su main — sempre brigade-main
7. node --check su ogni file JS prima di pushare
