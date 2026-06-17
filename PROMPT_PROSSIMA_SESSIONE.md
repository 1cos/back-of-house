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
- **Edge Function `souschef-chat` v21** — SQL query detection: domande su numeri → query reale al DB → numeri esatti. Parla come sous chef, non cita fonti tecniche

### Come funziona il flusso L'Ufficio
```
Cuoco manda Tell Chef / Operation Note
        ↓
chef_reports / operation_notes + office_items — in parallelo
        ↓
Max apre L'Ufficio → lista realtime red/orange/blue
        ↓
Premi "Analizza" → office-ai → ai_analysis + ai_options + priority
        ↓
Max tocca Letto (rimane open, diventa blue) o Risolto (chiude)
```

### Come funziona SQL Sous Chef
```
Max chiede "quante house salad la scorsa settimana come modifier?"
        ↓
detectQueryIntent() riconosce: modifier_item + scorsa settimana
        ↓
Query diretta su pos_modifier_by_item con date range reale
        ↓
Aggrega risultati → passa DATA REALI all'AI
        ↓
AI risponde: "La scorsa settimana 24 house salad come modifier"
```

### Decisioni architetturali
- office-ai NON gira ad ogni apertura — gira solo con bottone "Analizza" manuale
- Realtime Supabase attivo solo quando L'Ufficio è aperto, si chiude col back
- Letto = item rimane open ma diventa blue (ci penso)
- Risolto = chiude definitivamente
- Sous Chef non cita mai "SQL_RESULTS" o fonti tecniche — parla come sous chef

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. ⚠️ Audit menu tre puntini
Molte voci non hanno collegamento funzionante. Fare audit completo.

### 2. Demo Bot (sessione dedicata)
Edge Function + pannello admin con:
- Dropdown frequenza: 5 / 10 / 15 / 20 minuti
- Start / Stop
- Ogni tick = un giorno simulato — UN evento casuale
- Tipi: Tell Chef, Operation Note, prep log con timing, chiusura turno, chat
- Push notification: UNA sola riassuntiva quando tutti hanno "chiuso"
- ai_analysis pre-scritta (NO chiamate AI durante demo — risparmio token)
- Reset: cancella tutto in un click

### 3. office-ai → cron orario
Aggiungere pg_cron per analisi automatica ogni ora.
Ottimizzazione token AI — sessione dedicata.

### 4. Smart Office — calendario meeting interni
Meeting ricorrenti inseribili da Max dentro Brigade:
- Martedì ore 15 → Monica (catering)
- Mercoledì mattina → Zeno & Bo (FOH)
- Mercoledì dopo → meeting aziendale
- Smart Focus li rileva automaticamente 1h prima

### 5. Sous Chef SQL — espandere pattern
Aggiungere più pattern di riconoscimento per domande sui dati:
- Prep timing per persona (chi è più veloce/lento)
- Food cost per ricetta
- Confronto settimane
- Top seller per periodo

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
