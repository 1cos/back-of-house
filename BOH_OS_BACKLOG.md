# BRIGADE — BACKLOG
*App si chiama BRIGADE. Branch deploy: brigade-main (MAI main).*
*Aggiorna dopo ogni sessione. Load dopo SPEC.*

---

## Regole operative

- App: **BRIGADE** (non BOH OS, non BIOS)
- Branch: **brigade-main**
- Versione attuale: **v89**
- Supabase project: `ydqmumpytgrlceuinoqt`
- Supabase project vecchio (BOH OS): `hykjompnvajjhggrnned` — tenere attivo fino a migrazione Flutter
- GitHub repo: `1cos/back-of-house`
- Leggi sempre file da `brigade-main` prima di modificare
- File di progetto in `/mnt/project/` sono snapshot vecchi — usa GitHub
- Ogni commit = bump `boh-vNN` in `sw.js`
- GitHub token: [in Supabase secrets / chiedere a Max]

---

## AI Stack attuale (IMPORTANTE — cambiato in questa sessione)

| Servizio | Prima | Ora |
|---|---|---|
| LLM principale | Groq LLaMA 3.3 70B (bloccato — tier upgrade non disponibile) | **OpenRouter → meta-llama/llama-3.3-70b-instruct** |
| OCR fatture | Google Vision + Groq | **OpenRouter → google/gemini-2.0-flash-001 (PDF diretto)** |
| Trascrizione voce | Groq Whisper | **Groq Whisper** (rimane — limite separato, funziona) |
| Fallback | — | Google Vision + Groq se OpenRouter fallisce |
| Chiave OpenRouter | [chiedere a Max — in Supabase secrets come OPENROUTER_API_KEY] |
| Chiave in Supabase | `OPENROUTER_API_KEY` — già salvata |

---

## Sessione 2026-06-13 — Completato ✅

### TASK 1 — Migrazione OpenRouter (v78→v80)
- `souschef-classify` Edge Function: prova OpenRouter → fallback Groq
- `sc-nightly-brief` Edge Function: stesso pattern
- Tap breve microfono: ora chiama Edge Function invece di Groq diretto dal browser (fix errore 401)
- `runSousChefScan` passa il prompt alla Edge Function `souschef-classify` con `mode: 'scan'`

### TASK 2 — Chef Memory Engine (v78)
- Tabella `chef_attention` creata: `topic`, `topic_en`, `query_type`, `ask_count`, `first_asked`, `last_asked`, `last_answer`
- Ogni domanda vocale salva silenziosamente il topic (fire & forget)
- `sc-nightly-brief` legge `chef_attention` e include topic frequenti nel briefing
- Se Max chiede della burrata 3 volte → il brief mattutino include aggiornamenti sulla burrata automaticamente

### TASK 3 — showScAnswer redesign (v79)
- Card risposta vocale: grande, leggibile, bottone "✓ Capito, Chef" nero 56px
- Sostituisce la vecchia sheet grigia con testo piccolo
- Fix bottone che non chiudeva (usa ID univoco invece di selector CSS)

### TASK 4 — Warning banner → stack OQR (v81)
- Click su warning SC-* apre direttamente lo stack OQR swipeable
- Non più modal generico "What should happen?"
- Reset throttle per permettere riapertura immediata

### TASK 5 — Domanda vocale interroga DB (v81→v82)
- `souschef-classify` ora cerca keyword in `ingredient_vendors`, `ingredients`, `prep_log`, `pos_sales_by_item`
- Dizionario italiano→inglese per ingredienti comuni (uova→eggs, salmone→salmon, ecc.)
- Vendite: trigger automatico se domanda contiene "vend", "sold", "quant", "ieri", ecc.
- Risposta con dati reali: "Le uova sono $14.99 per 15 dozzine da Hardie's"

### TASK 6 — price_type in DB (v84)
- Nuova colonna `price_type` in `ingredient_vendors`: `per_case` | `per_lb` | `per_kg` | `per_oz` | `per_each`
- Default: `per_case`
- `calcVendorPrice100g()` aggiornato: se `per_lb` → $/100g = (unit_price/453.592)*100
- Edit Vendor UI: toggle visuale PRICE TYPE con 5 bottoni
- `saveEditVendorRow` salva `price_type` e ricalcola `price_per_100g` correttamente
- Tutte le select query aggiornate per includere `price_type`

### TASK 7 — Pack parser migliorato (v85)
- `N/MKG` → N×M kg (es. "2/3KG" = 6kg) ✅
- `1pc/M#` → M lb (es. "1pc/28#" = 28lb) ✅
- `N PC/M#` → N×M lb (es. "4 PC/12#" = 48lb) — attenzione: carne catchweight può essere diverso
- `ingredients.js` `parsePackDescG()` già gestiva correttamente — fix solo in `souschef.js`

### TASK 8 — Operation Notes popup (v83)
- Nuovo file `js/operation-notes.js` — aggiunto a `index.html`
- `checkOperationNotePrompt()` chiamata da `init.js` (era già nel codice, non implementata)
- Appare alle **22:30 CDT** (Texas = CDT estate, CST inverno — calcola automaticamente)
- Bottom sheet grande: "Come è andata stasera?" — testo libero, qualsiasi lingua
- Esempi tap-to-fill: "Serata tranquilla", "Super impegnati 🔥", ecc.
- Salva in `operation_notes` con `note_date`, `user_name`, `note`, `service='dinner'`
- Riappare ogni 30 minuti se non risponde
- Si blocca dopo mezzanotte CDT

### TASK 9 — Nightly brief orario + funzione (v83 + DB)
- Cron spostato: `0 11 * * *` (11:00 UTC = 6:00 CDT) → `0 10 * * *` (10:00 UTC = **5:00 AM CDT**)
- Funzione chiamata: `generate-briefing` → **`sc-nightly-brief`**
- Report vendite arriva ~2:30 AM CDT → brief alle 5:00 AM CDT è sicuro

### TASK 10 — Sous Chef Chat (v86→v89)
- **Tap breve microfono** apre chat privata Max ↔ Sous Chef (prima lanciava scan)
- **Tap lungo** rimane registrazione vocale
- Chat con cronologia sessione, esempi tap-to-fill, campo testo + microfono + invio
- Bottone 🔍 in chat per lanciare scan manuale
- Nuova Edge Function `souschef-chat` (v2): accesso completo DB, può SCRIVERE nel DB
- Campi validi per update: `unit_price`, `price_type`, `conversion_to_base`, `pack_description`, `pack_size`, `pack_unit`, `unit_weight_g`, `notes`
- `scChatFetchContext`: porta TUTTO il DB senza filtri (ingredienti, ricette, vendite, warning)
- OpenRouter ragiona sulle similitudini (rosmary = rosemary, patate = potatoes)
- `scChatExecuteAction`: esegue azioni DB — `update_ingredient_vendor`, `create_task`
- Ricalcola `price_per_100g` automaticamente dopo ogni aggiornamento

### TASK 11 — Parser fatture universale (v27 process-invoice)
- **Nuovo approccio**: OpenRouter/Gemini legge PDF direttamente (no Google Vision OCR)
- Fallback automatico: se OpenRouter fallisce → Google Vision + Groq
- Con `autoProcess: true`: salva nel DB silenziosamente, confronta prezzi storici
- Logica anomalie: se prezzo cambia >10% vs media storica → warning in `invoice_warnings`
- Auto-crea ingredienti nuovi, avvisa solo la prima volta
- Tabella `invoice_lines` creata: storico prezzi per confronto anomalie

### TASK 12 — Gmail import fornitori
- **Hardie's**: già attivo (gmail-hardies-import)
- **Fruge Seafood**: aggiunto a Google Apps Script — label `fruge-import`, mittente `system@netyield.com`
- **Ben E. Keith**: label `bek-import`, forward iCloud → Gmail (da configurare manualmente)
- Script Google Apps Script aggiornato con `checkFrugeEmails()`, `checkBenEKeithEmails()`, `checkAllEmails()`
- Trigger: ogni ora → `checkAllEmails()`
- `price_type` estratto automaticamente dalla colonna Unit Price Fruge (es. "$11.25 LB" → `per_lb`)

---

## DB Changes questa sessione

| Tabella | Modifica |
|---|---|
| `ingredient_vendors` | + colonna `price_type` (per_case/per_lb/per_kg/per_oz/per_each, default per_case) |
| `chef_attention` | NUOVA: topic, topic_en, query_type, ask_count, first_asked, last_asked, last_answer |
| `invoice_lines` | NUOVA: storico prezzi per confronto anomalie (ingredient_id, vendor, invoice_date, unit_price, price_type, amount) |

---

## Importazione fatture — stato attuale

### Via email (automatica):
- **Hardie's**: PDF via Gmail → `gmail-hardies-import` → parser Hardie's → vendor_documents
- **Fruge**: PDF via Gmail (`system@netyield.com`) → `process-invoice` (autoProcess=true) → DB diretto
- **Ben E. Keith**: HTML/PDF via Gmail (`CRP-SVCMBX-entree@benekeit.com`) → forward iCloud→Gmail (DA FARE) → `process-invoice`

### Via foto/scan (manuale — DA MIGRARE):
- Attuale: foto → Google Vision OCR → Groq → vendor_documents → review manuale
- Da fare: foto → `process-invoice` con OpenRouter/Gemini (stesso parser universale)
- **NOTA**: la review manuale (Vendor Documents) rimane per casi ambigui

### Edge Functions:
- `process-invoice` v27: parser universale, autoProcess mode
- `souschef-classify` v17: domande vocali + scan
- `souschef-chat` v2: chat con accesso completo DB
- `sc-nightly-brief` v3: briefing notturno con chef_attention

---

## Backlog prossima sessione

### PRIORITÀ ALTA
- [ ] **Foto/scan → OpenRouter**: collegare Import Invoice foto a `process-invoice` con autoProcess=true
- [ ] **Edit Vendor semplificato**: 5 campi visibili (unit_price, price_type, pack_description, total_weight_g, notes) — nascondere campi tecnici
- [ ] **Warning che riappaiono**: dopo aver salvato peso nella card OQR, il warning riappare perché price_per_100g non viene ricalcolato
- [ ] **Ben E. Keith**: testare dopo forward iCloud→Gmail

### PRIORITÀ MEDIA
- [ ] Sales tab: rimuovere "Oggi" (dati arrivano mattina dopo), tradurre tab in inglese (Yesterday, Weekend, 7 days, 30 days), aggiungere "Tomorrow" per eventi TripleSeat
- [ ] Card OQR troppo grandi: escono dallo schermo iPhone
- [ ] Skip/Fine ritardo e click accidentale sul microfono
- [ ] Tomato CT: opzione peso unitario per pomodori beefsteak

### BACKLOG ESISTENTE
- [ ] TripleSeat API integration (credenziali in attesa)
- [ ] Digital whiteboard (prep handoffs brigata)
- [ ] Sous Chef: scansione automatica ogni ora (Edge Function schedulata)
- [ ] Good Job messages nel nightly brief
- [ ] Sales anomaly detection (calo/picco >30% vs settimana scorsa)
- [ ] Tabella pesi standard CT/DZ (uova 58g, lime 67g, lemon 100g, avocado 200g, tomato beefsteak 280g)

---

## Fornitori attivi

| Fornitore | Email import | Label Gmail | Tipo |
|---|---|---|---|
| Hardie's Fresh Foods | Gmail automatico | `hardies-import` | PDF |
| Fruge Seafood | `system@netyield.com` | `fruge-import` | PDF |
| Ben E. Keith | `CRP-SVCMBX-entree@benekeit.com` (iCloud→Gmail) | `bek-import` | HTML/PDF |
| Freshpoint | in attesa | `freshpoint-import` | text email |
| Global Gourmet | manuale | — | PDF scan |
| Sysco | manuale | — | PDF scan |
