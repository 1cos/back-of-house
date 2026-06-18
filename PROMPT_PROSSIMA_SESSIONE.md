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
- process-invoice: v29

---

## SESSIONE 2026-06-18 — COMPLETATA

### Costruito oggi — Bot System completo
- **Bot 1 — Guardiano Prezzi** (bot-price-guard v1): dopo ogni fattura, confronta prezzi vs media storica, soglia 10%, min 3 acquisti storici
- **Bot 2 — Analista Chat** (bot-chat-analyst v2): AI legge chat ogni notte ore 3AM CDT, recap settimanale domenica. Analisi libera — non keyword.
- **Bot 3 — Costruttore Preplist** (bot-preplist-builder v1): ogni notte ore 4AM CDT, calcola suggested_qty da POS + prep_log (3 settimane stesso DOW, +10% buffer)
- **Bot 4 — Lettore Tell Chef** (bot-tell-chef-reader v1): ogni ora, classifica tell chef in 5 tipi (CONTRIBUTO_RICETTA / GAP_CHECKLIST / PROBLEMA_OPERATIVO / FEEDBACK_RICETTA / SEGNALE_PERSONALE), genera suggestion AI
- **Bot 5 — Guardiano Food Cost** (bot-food-cost-guard v1 — versione A): dopo ogni fattura, calcola impatto $ su ricette × venduto settimana, soglia $20/sett
- **process-invoice v29**: chiama bot-price-guard + bot-food-cost-guard in parallelo dopo ogni import
- **Nuove colonne DB**: prep_tasks.suggested_qty/suggested_by/suggested_at, chef_reports.report_type
- **4 cron jobs**: chat analyst daily (3AM lun-sab), chat analyst weekly (domenica), preplist nightly (4AM), tell chef hourly

### Bug noti aperti (invariati)
- **🔴 Realtime L'Ufficio** — non si aggiorna automaticamente, richiede chiudi/riapri
- **🔴 Bottoni L'Ufficio** — azioni non collegate

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

### 4. 🟠 Bot 4 Fase 2 — esecuzione automatica
Quando Max approva "Aggiungi alla ricetta" → bot esegue materialmente.
Sessione dedicata.

### 5. 🔵 Bot 5 versione B — food cost %
Prerequisito: inserire selling_price nelle ricette.
Poi upgrade bot-food-cost-guard per calcolare food cost % reale + margine $.

### 6. 🔵 office-ai → cron orario
Analisi automatica ogni ora invece che solo on demand.

### 7. 🔵 Smart Office — calendario meeting interni
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
8. Sous Chef NON cita mai fonti tecniche — parla come sous chef
9. Demo Bot: fare Reset prima di ogni sessione di test
