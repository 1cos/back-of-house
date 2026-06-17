# PROMPT PROSSIMA SESSIONE — Brigade v235

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
- Versione: v235

---

## SESSIONE 2026-06-17 — L'UFFICIO

### Cosa è stato costruito
- **`office_items`** — nuova tabella DB, struttura completa e scalabile
- **`sous_chef_tasks`** — eliminata (era vuota, ridondante)
- **`js/office.js`** — L'Ufficio completo: Smart Focus, lista per urgenza red/orange/blue, resolve
- **`js/tell-chef.js`** — scrive in office_items ad ogni segnalazione brigata
- **`js/operation-notes.js`** — scrive in office_items ad ogni nota serale
- **`js/souschef-core.js`** — rimossi tutti i riferimenti a sous_chef_tasks
- **`index.html`** — bottone "L'Ufficio" nel menu tre puntini + script caricato
- **Edge Function `office-ai` v1** — analizza office_items senza ai_analysis, scrive priority + ai_analysis + ai_options

### Come funziona il flusso
```
Cuoco manda Tell Chef / Operation Note
        ↓
chef_reports / operation_notes (archivio) + office_items (scrivania) — in parallelo
        ↓
Max apre L'Ufficio → chiama office-ai
        ↓
office-ai legge items senza analisi → OpenRouter → scrive ai_analysis + ai_options + priority
        ↓
Lista ordinata red / orange / blue — con analisi AI e bottoni pronti
        ↓
Max tocca → officeResolve() → resolved → sparisce
```

### Decisioni architetturali prese
- L'Ufficio vive nei tre puntini — non nella bottom nav
- Scrivania unica per ora (operativa) — finanziaria e comunicazioni = future
- Smart Focus: si riconfigura automaticamente prima dei meeting ricorrenti
- office-ai NON gira ad ogni apertura — va spostata a cron orario (TODO)
- Demo Bot: da costruire in sessione separata (vedi backlog)

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. ⚠️ Audit menu tre puntini
Molte voci non hanno collegamento funzionante. Fare audit completo prima di aggiungere altro.

### 2. office-ai → cron orario
Togliere la chiamata da openOffice() e metterla come cron (come souschef-scan).
Aggiungere bottone "Analizza ora" manuale per Max.
Ottimizzazione token AI — sessione dedicata.

### 3. Demo Bot
Edge Function + pannello admin con:
- Dropdown frequenza: 5 / 10 / 15 / 20 minuti
- Start / Stop
- Ogni tick = un giorno simulato — UN solo evento casuale
- Tipi evento: Tell Chef, Operation Note, prep log con timing, chiusura turno, messaggio chat
- Push notification: UNA sola push riassuntiva quando tutti hanno "chiuso" nel giorno simulato
- ai_analysis pre-scritta (NO chiamate AI durante demo — risparmio token)
- Reset: cancella tutto in un click
- Sessione dedicata

### 4. Smart Office — calendario meeting
- Meeting ricorrenti inseribili da Max dentro Brigade
- Martedi ore 15 → Monica (catering)
- Mercoledi mattina → Zeno & Bo (FOH)
- Mercoledi dopo → meeting aziendale
- Smart Focus li rileva automaticamente 1h prima
- Connessione iPhone Calendar = futura

### 5. Briefing AI fix
- sc-nightly-brief legge anche chef_reports (status new/read)
- 2-3 punti concreti con numeri reali
- Sezione "From your team"

---

## REGOLE OPERATIVE — INVIOLABILI
1. Leggi SEMPRE i file da GitHub (mai da /mnt/project/ o memoria)
2. Bumpa sw.js in ogni push che tocca file visibili all'utente
3. Dichiara cosa cambierai prima di scrivere codice — aspetta conferma
4. KITCHEN DISPLAY = SOLO INGLESE — regola permanente
5. Non lavorare mai su file in memoria — sempre online
6. MAI pushare su main — sempre brigade-main
7. node --check su ogni file JS prima di pushare
8. office-ai NON va chiamata ad ogni apertura — è costosa in token
