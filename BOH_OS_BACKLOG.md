# BRIGADE — BACKLOG
*Aggiornato: 2026-06-15 — v191*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- Versione frontend: **v191**
- Versione souschef-chat: v15 (Supabase Edge Function)
- Supabase project: ydqmumpytgrlceuinoqt
- Leggi file da GitHub brigade-main, NON da /mnt/project/ (snapshot vecchio)
- Bump boh-vNN in sw.js ad ogni commit

---

## Edge Functions attive (Supabase ydqmumpytgrlceuinoqt)

| Function | Versione | Scopo |
|---|---|---|
| souschef-chat | v15 | Chat AI — accesso completo DB |
| souschef-classify | v17 | Scan anomalie |
| souschef-scan | v4 | Scan automatica oraria lun-sab |
| sc-nightly-brief | v5 | Briefing notturno 5:00 AM CDT |
| process-invoice | v27 | Parser fatture universale OpenRouter |
| gmail-hardies-import | v9 | Import PDF Hardie's |
| gmail-touchbistro-import | v3 | Import 4 CSV TouchBistro ogni notte |
| gmail-vendor-import | v3 | Import fatture fornitori via Gmail |
| transcribe-audio | v22 | Whisper voce->testo |
| ai-translate | v22 | Traduzioni brigata |

---

## Tabelle DB — stato completo

| Tabella | Scopo | Righe |
|---|---|---|
| pos_daily_summary | Totali giornalieri (scontrini, fatturato) | 305 |
| pos_sales_by_item | Piatti venduti per giorno | 3.924 |
| pos_modifiers | Modifier totali per giorno (TextModifier) | 712 |
| pos_modifier_by_item | Modifier collegato al piatto padre | 1.167 |
| modifier_config | Whitelist modifier cucina classificati | 86 |
| ingredients | Ingredienti con categorie | 400 |
| ingredient_vendors | Prezzi per fornitore | 30+ |
| ingredient_links | Link descrizione fattura -> ingrediente | attivo |
| recipes | Ricette | 182 |
| chef_attention | Topic frequenti Max | 7 |
| invoice_lines | Storico prezzi fatture | 33+ |
| invoice_warnings | Warning fatture | 3 open |

---

## PRIORITA' ALTA — PROSSIMA SESSIONE

- [ ] **PREP redesign — Swipe gestuale**
  - Lista a tutto schermo, font 22px, nome prep gigante
  - Swipe destra -> verde -> Fatta (scende in fondo)
  - Swipe sinistra -> blu -> In corso (rimane in cima)
  - Soglia 60% per conferma (evita falsi positivi mani bagnate)
  - Tap nome -> apre ricetta
  - Swipe sinistra su riga verde -> riporta su (undo)
  - Zero bottoni visibili — solo la lista
  - Pillole stazione invece dei cerchi attuali
  - Fatte in fondo automaticamente con opacita ridotta
  - File: js/prep.js

---

## PRIORITA' MEDIA

- [ ] Auto-approve fatture senza warning e ingredienti gia linkati
- [ ] Edit Vendor semplificato (5 campi: unit_price, price_type, pack_description, conversion_to_base, notes)
- [ ] Warning che riappaiono dopo salvataggio peso OQR
- [ ] Ben E. Keith: testare import dopo fix Apps Script
- [ ] Sales staff — modal porzioni su tap piatto
- [ ] Card OQR — ancora troppo grandi su iPhone
- [ ] Sous Chef proattivo: scansione automatica ogni ora
- [ ] Aggiungere guest_count a pos_daily_summary quando arriva il nuovo report TouchBistro (richiesto da Max)

---

## BACKLOG ESISTENTE

- [ ] TripleSeat API (credenziali in attesa da Monica)
- [ ] Digital whiteboard (prep handoffs brigata)
- [ ] Good Job messages nel nightly brief
- [ ] Sales anomaly detection (calo/picco >30% vs settimana scorsa)
- [ ] Yes Chef modal (sostituire toast con modal celebrativo)
- [ ] Tela module — da progettare da zero
- [ ] Display cucina TV (PASSO 4)
- [ ] SevenShift API (PASSO 5)

---

## Fornitori attivi

| Fornitore | Email import | Label Gmail | Stato |
|---|---|---|---|
| Hardie's | Gmail automatico | hardies-import | attivo |
| Fruge Seafood | system@netyield.com | fruge-import | Apps Script fixato -> gmail-vendor-import |
| Ben E. Keith | iCloud->Gmail forward | bek-import | Apps Script fixato -> gmail-vendor-import |
| Freshpoint | body email | freshpoint-import | attivo (conferme ordine, non fatture) |
| Global Gourmet | manuale | — | scan manuale |
| Sysco | manuale | — | scan manuale |

---

## Sessione 2026-06-15 — vendor review redesign + DB (v180->v190)

### vendor-documents-review.js — redesign completo righe articoli
- Formato nuovo: Warning/OK label + 5 campi + Sous Chef calc
- Campi editabili inline: Qty (number), Pack (text), Unit Price (number), Ext (number)
- Ricalcolo live Sous Chef con bottone ricorda (fix 107 elementi DOM duplicati)
- Fix scoping querySelector -> closest('[data-vdr-row]')
- Approve legge _vdrEdits prima di salvare nel DB
- Dizionario 50 pesi standard USDA: lemon 100g, lime 67g, avocado 200g, romaine 626g, ecc.
- CT auto-calc dal dizionario senza domande
- Parser: fix 1pc/28# , fix 9-1/2 GAL numeri misti
- Fix insert ingredienti: count_unit -> base_unit
- Fix iOS: aggiunto onchange oltre oninput

### DB updates
- Link RWPR 103 RIB REF -> Tomahake Loin in ingredient_links
- Tomahake Loin price_type = per_lb
- Edible Flower conversion_to_base = 100g (50 CT x 2g)
- SUNFLOWER Seed ripristinato a 2268g (5lb)
- Carrots: pack 5# = 2268g, price_per_100g calcolato
- Romaine: 12/3 CT = 36 teste x 626g = 22536g, price_per_100g calcolato

### Ingredienti categorizzati
- 320 ingredienti senza categoria -> 0
- Categorie: Produce, Dairy, Meat, Seafood, Dry Goods, Oil & Vinegar,
  Spices & Herbs, Beverages & Spirits, Prepared, Bakery, Frozen, Supply

### Apps Script fix
- checkBEKEmails: gmail-hardies-import -> gmail-vendor-import
- checkFrugeEmails: gmail-hardies-import -> gmail-vendor-import

---

## Sessione 2026-06-15 — scan stato app + TouchBistro audit (v191)

### TouchBistro CSV — stato import
- pos_daily_summary: 305 giorni (2025-06-02 -> 2026-06-13) — PULITO
- pos_sales_by_item: solo 19 date distinte su 305 — copertura parziale
  - 5 date recenti (2026-06-09/10/11/12/13) hanno detail per piatto — OK
  - Maggio 2026 e prima: solo summary, nessun dettaglio per piatto
  - Alcune date vecchie (2025-06-01, 2025-12-01, 2025-05-08) hanno righe aggregate sporche
    (quantita assurde: Wheel Pasta 2763 pezzi) — CSV mensili importati come giornalieri
- pos_modifiers: 712 righe (2025-07-12 -> 2026-06-14) — OK

### bill_count vs guest_count
- bill_count in pos_daily_summary = SCONTRINI CHIUSI, non coperti
- I 4 CSV TouchBistro (SalesByMenuItem, TextModifier, ModifierPreferenceByMenuItem,
  Daily&HourlySales) NON contengono guest count
- Max ha richiesto a TouchBistro un report separato con guest count
- Quando arriva: aggiungere colonna guest_count INTEGER a pos_daily_summary
  e aggiornare gmail-touchbistro-import per importarla

---

## Note importanti

### vendor-documents-review.js — architettura
- File unico, 1900 righe, non suddividere
- Entra da un punto solo: openVendorDocumentsReview() in app.js
- _vdrEdits[docId][itemIdx] = {qty, pack, unitPrice, ext} — store edits in memoria
- VDR_UNIT_WEIGHTS — dizionario pesi standard, definito PRIMA di vdrCalcPack e vdrPackToGrams
- vdrLookupUnitWeight — cerca per nome ingrediente nel dizionario
- vdrRecalcRow(docId, idx, btn) — btn.closest('[data-vdr-row]') per scope corretto

### pos_daily_summary — bill_count
- bill_count = scontrini chiusi (NON coperti/guest count)
- Dire sempre "scontrini" o "bills" in app e Sous Chef, mai "tavoli" o "coperti"
- guest_count da aggiungere quando arriva nuovo report TB

### pos_sales_by_item — nomi colonne CORRETTI:
- menu_item (NON item_name)
- quantity (NON quantity_sold)
- net_sales, sale_date, sales_category

### souschef-chat — non toccare senza leggere prima v15 da GitHub
