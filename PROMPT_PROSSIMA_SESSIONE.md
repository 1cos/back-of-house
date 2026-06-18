# PROMPT PROSSIMA SESSIONE — Brigade v249

## PRIMA DI TUTTO
1. Carica x_claude_GIthub.txt dal progetto
2. Leggi BOH_OS_BACKLOG.md, BOH_OS_DECISIONS.md, BRIGADE_VISION.md da brigade-main
3. Leggi SEMPRE i file da GitHub prima di modificarli — MAI da memoria locale
4. Bumpa sw.js ad ogni push (letto live da GitHub)

## STATO
- Supabase: ydqmumpytgrlceuinoqt
- Deploy: https://1cos.github.io/back-of-house
- Branch: brigade-main
- Versione: v249
- souschef-chat: v21
- office-ai: v1

---

## SESSIONE 2026-06-17 — COMPLETATA

### Costruito oggi (v229 → v249)
- **L'Ufficio completo** — scrivania operativa, realtime, badge, Analizza, Letto/Risolto, overlay, animazioni
- **Demo Bot + Bug Tracker** — js/demo-bot.js, frequenza 1/5/10/15/20m, reset completo
- **is_demo flag** — su office_items, chef_reports, prep_log, operation_notes
- **Sous Chef SQL v21** — query reali al DB, numeri precisi, no citazioni tecniche
- **office-ai v1** — analisi AI on demand
- **Fix prep_log station** — NOT NULL constraint risolto in demo-bot

### Bug noti aperti
- **Realtime L'Ufficio** — non si aggiorna automaticamente, richiede chiudi/riapri. Max sta lavorando su altra chat.
- **Bottoni L'Ufficio** — azioni non collegate. Sessione dedicata necessaria.

---

## PRIORITÀ PROSSIMA SESSIONE

### 1. 🔴 Bottoni L'Ufficio — sessione dedicata
Tre fix urgenti:
- Bottoni diversi per fonte:
  - Operation Note → "Letto" / "Archivia"
  - Tell Chef → "Letto" / "Risolto"
  - AI scan → "Ignora" / "Investiga"
- "Investiga" → apre Sous Chef con contesto item precaricato
- "Archivia" → chiude silenziosamente, resta in memoria AI

### 2. 🔴 Realtime L'Ufficio
Supabase Realtime subscription su office_items non funziona.
L'Ufficio richiede chiudi/riapri per vedere nuovi item.

### 3. 🟠 Audit menu tre puntini
Molte voci non hanno collegamento funzionante.
Fare audit completo prima di aggiungere altro.

### 4. 🟠 Demo Bot — reset prima di usare
I bug rossi pre-fix sono ancora in DB.
Fare Reset dal Demo Bot prima di ogni sessione di test.

### 5. 🔵 office-ai → cron orario
Aggiungere pg_cron per analisi automatica ogni ora.
Ottimizzazione token AI — sessione dedicata.

### 6. 🔵 Smart Office — calendario meeting interni
Meeting ricorrenti inseribili da Max dentro Brigade:
- Martedì ore 15 → Monica (catering)
- Mercoledì mattina → Zeno & Bo (FOH)

### 7. 🔵 Sous Chef SQL — espandere pattern
- Prep timing per persona (chi è più veloce/lento)
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
8. Sous Chef NON cita mai fonti tecniche — parla come sous chef
9. Demo Bot: fare Reset prima di ogni sessione di test
