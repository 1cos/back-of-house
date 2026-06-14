# BRIGADE — BACKLOG
*Aggiornato: 2026-06-13 — v92*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- Versione frontend: v92
- Versione souschef-chat: v14 (Supabase Edge Function)
- Supabase project: ydqmumpytgrlceuinoqt
- Leggi file da GitHub brigade-main, NON da /mnt/project/ (snapshot vecchio)
- Bump boh-vNN in sw.js ad ogni commit

---

## Edge Functions attive (Supabase ydqmumpytgrlceuinoqt)

| Function | Versione | Scopo |
|---|---|---|
| souschef-chat | v14 | Chat AI — accesso completo DB |
| souschef-classify | v17 | Scan anomalie (tap breve → 🔍 in chat) |
| sc-nightly-brief | v3 | Briefing notturno 5:00 AM CDT |
| process-invoice | v27 | Parser fatture universale OpenRouter |
| gmail-hardies-import | v9 | Import PDF Hardie's |
| transcribe-audio | v22 | Whisper voce→testo |
| ai-translate | v22 | Traduzioni brigata |

---

## Tabelle DB aggiunte in questa sessione

| Tabella | Scopo |
|---|---|
| chef_attention | Topic che Max chiede spesso (ask_count, last_asked) |
| invoice_lines | Storico prezzi per confronto anomalie |
| pos_modifiers | Vendite modifier — GIA' ESISTEVA, colonne: modifier, quantity_sold, sale_date |

## Colonne DB aggiunte

| Tabella | Colonna | Tipo | Note |
|---|---|---|---|
| ingredient_vendors | price_type | text | per_case DEFAULT, per_lb, per_kg, per_oz, per_each |

## Funzioni SQL aggiunte

| Funzione | Scopo |
|---|---|
| execute_query(query_text) | Esegue SELECT arbitrari — usata da tool use (non più in uso attivo) |

---

## PRIORITA' ALTA — prossima sessione

- [ ] **Foto/scan → OpenRouter**: collegare Import Invoice foto a process-invoice con autoProcess=true invece di Google Vision
- [ ] **Edit Vendor semplificato**: 5 campi visibili (unit_price, price_type, pack_description, total_weight_g, notes) — nascondere campi tecnici
- [ ] **Warning che riappaiono**: dopo aver salvato peso nella card OQR, warning riappare perché price_per_100g non viene ricalcolato
- [ ] **Ben E. Keith**: forward iCloud→Gmail, poi testare import

---

## PRIORITA' MEDIA

- [ ] Sales — ricerca per data libera (es. "cosa ho venduto il 12 giugno")
- [ ] Sales — filtro categoria Food only (no bevande)
- [ ] Sales — tradurre tab: Yesterday, Weekend, 7 days, 30 days
- [ ] Card OQR — ancora troppo grandi su iPhone
- [ ] Skip/Fine — ritardo e click accidentale sul microfono
- [ ] Sous Chef proattivo: scansione automatica ogni ora senza che Max premi niente

---

## BACKLOG ESISTENTE

- [ ] TripleSeat API (credenziali in attesa da Monica)
- [ ] Digital whiteboard (prep handoffs brigata)
- [ ] Good Job messages nel nightly brief
- [ ] Sales anomaly detection (calo/picco >30% vs settimana scorsa → OQR immediata)
- [ ] Tabella pesi standard CT/DZ (uova 58g, lime 67g, lemon 100g, avocado 200g)
- [ ] Yes Chef modal (sostituire toast con modal celebrativo per import completato)

---

## Sessione 2026-06-13 — completato

### Chat Sous Chef (v86→v92 + souschef-chat v1→v14)
- Tap breve microfono apre chat privata Max ↔ Sous Chef
- Tap lungo rimane voce → Whisper → stessa chat
- souschef-chat v14: legge tutto DB direttamente con service role key
- Nessun filtro — tutto a OpenRouter, ragiona lui semanticamente
- Risposta pulita: niente JSON visibile, niente ragionamento intermedio
- Può aggiornare DB e creare task dalla chat
- Trova "ROSMARY POTATOES" quando chiedi "Rosemary Potatoes" ✅
- Conta asparagi in piatti + modifier + totale ✅ (11-13 porzioni ieri)

### Migrazione OpenRouter (v78→v80)
- Groq bloccato (upgrade tier non disponibile da settimane)
- Tutto su OpenRouter con fallback Groq automatico
- Whisper rimane su Groq (limite separato, funziona)

### price_type (v84)
- Nuovo campo in ingredient_vendors
- Edit Vendor UI: toggle 5 bottoni
- calcVendorPrice100g aggiornato
- Stew Meat aggiornato via chat: "12 lb $3.29/lb" → DB aggiornato ✅

### Parser fatture universale (process-invoice v27)
- OpenRouter/Gemini legge PDF direttamente
- autoProcess: salva silenzioso, avvisa solo anomalie >10%
- Tabella invoice_lines per storico prezzi

### Gmail fornitori
- Fruge: system@netyield.com → label fruge-import → configurato ✅
- BEK: label bek-import → forward iCloud DA FARE
- Google Apps Script aggiornato con checkFrugeEmails() e checkBenEKeithEmails()

### Operation Notes (v83)
- Popup 22:30 CDT per tutta la brigata
- js/operation-notes.js — checkOperationNotePrompt() implementato

### Nightly Brief
- Spostato a 5:00 AM CDT (era 6:00 AM)
- Ora usa sc-nightly-brief (era generate-briefing)

### Chef Memory
- Tabella chef_attention
- Ogni domanda vocale salva topic silenziosamente
- Nightly brief include topic frequenti

---

## Note importanti per prossima sessione

### pos_sales_by_item — nomi colonne CORRETTI:
- menu_item (NON item_name)
- quantity (NON quantity_sold)
- net_sales, sale_date, sales_category

### pos_modifiers — nomi colonne CORRETTI:
- modifier
- quantity_sold
- gross_sales, sale_date

### souschef-chat — non toccare senza leggere prima la v14 da GitHub
### souschef.js — versione live è v92 su brigade-main

---

## Fornitori attivi

| Fornitore | Email import | Label Gmail | Stato |
|---|---|---|---|
| Hardie's | Gmail automatico | hardies-import | ✅ attivo |
| Fruge Seafood | system@netyield.com | fruge-import | ✅ configurato |
| Ben E. Keith | iCloud→Gmail forward | bek-import | ⏳ forward DA FARE |
| Freshpoint | in attesa | freshpoint-import | ⏳ in attesa |
| Global Gourmet | manuale | — | scan manuale |
| Sysco | manuale | — | scan manuale |
## Prossima Sessione

**Ultimo task completato (v114 — 2026-06-14):**
- Refactor admin.js → moduli separati (admin-prep.js, admin-ingredients.js, admin-chef-ai.js)
- Sistema autenticazione PIN-only: rimossi password_hash, hashPassword, checkFirstLogin
- Gestione brigata completa: aggiungi, modifica, reset PIN, disattiva cuoco
- 10 stazioni definite: Oven, Fresh Pasta, Pasta, Sauté, Saucier, Plating, Salad, Pastry, Tableside, Freezer
- Brigata completa con stazioni assegnate (15 utenti attivi)
- Tela = Operations/Manager — nessuna stazione cucina, modulo futuro

**Prossimo task:**
1. Checklist sera → preplist mattina per stazione (ciclo fondamentale Brigade)
2. Bulk move prep — spostare prep in blocco tra stazioni
3. Warning Center OQR — opzioni con valori concreti

**Blockers:**
- FreshPoint non manda ancora fatture (solo order confirmation)
- Tela module da progettare da zero
