# BRIGADE — BACKLOG
*Aggiornato: 2026-06-14 — v152*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- Versione frontend: **v152**
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
| transcribe-audio | v22 | Whisper voce→testo |
| ai-translate | v22 | Traduzioni brigata |

---

## Tabelle DB — stato completo

| Tabella | Scopo | Righe |
|---|---|---|
| pos_daily_summary | Totali giornalieri (coperti, fatturato) | 305 |
| pos_sales_by_item | Piatti venduti per giorno | 3.924 |
| pos_modifiers | Modifier totali per giorno (TextModifier) | 711 |
| pos_modifier_by_item | Modifier collegato al piatto padre | 1.167 |
| modifier_config | Whitelist modifier cucina classificati | 86 |
| ingredients | Ingredienti | 400 |
| ingredient_vendors | Prezzi per fornitore | 30 |
| recipes | Ricette | 182 |
| chef_attention | Topic frequenti Max | 7 |
| invoice_lines | Storico prezzi fatture | 33 |

### pos_modifier_by_item — colonne
- sale_date, is_historical, modifier, parent_item, quantity_sold, pct_of_parent

### modifier_config — colonne
- modifier (PK), is_kitchen, kitchen_cat (Contorni/Proteine/Upgrade/Extra), portion_note

---

## PRIORITA' ALTA — prossima sessione

- [ ] **PASSO 2**: Checklist sera → preplist mattina per stazione (ciclo fondamentale Brigade)
- [ ] **Foto/scan → OpenRouter**: collegare Import Invoice foto a process-invoice con autoProcess=true
- [ ] **Edit Vendor semplificato**: 5 campi visibili (unit_price, price_type, pack_description, total_weight_g, notes)
- [ ] **Warning che riappaiono**: dopo aver salvato peso nella card OQR, warning riappare — price_per_100g non ricalcolato
- [ ] **Ben E. Keith**: forward iCloud→Gmail, poi testare import

---

## PRIORITA' MEDIA

- [ ] Sales staff — modal porzioni su tap piatto (vedi PROMPT_SALES_STAFF_VIEW.md)
- [ ] Sales admin — Deep Analysis: query rimanenti nel fallback
- [ ] Card OQR — ancora troppo grandi su iPhone
- [ ] Skip/Fine — ritardo e click accidentale sul microfono
- [ ] Sous Chef proattivo: scansione automatica ogni ora senza che Max premi niente
- [ ] Bulk move prep — spostare prep in blocco tra stazioni
- [ ] Warning Center OQR — opzioni con valori concreti

---

## BACKLOG ESISTENTE

- [ ] TripleSeat API (credenziali in attesa da Monica)
- [ ] Digital whiteboard (prep handoffs brigata)
- [ ] Good Job messages nel nightly brief
- [ ] Sales anomaly detection (calo/picco >30% vs settimana scorsa)
- [ ] Tabella pesi standard CT/DZ (uova 58g, lime 67g, lemon 100g, avocado 200g)
- [ ] Yes Chef modal (sostituire toast con modal celebrativo)
- [ ] Tela module — da progettare da zero
- [ ] Display cucina TV (PASSO 4)
- [ ] SevenShift API (PASSO 5)

---


## Sessione 2026-06-14 — UI/Grafica (v139→v152)

### Admin menu — fix chiusura (v139)
- Rimossa doppia definizione `showAdminMenu`/`hideAdminMenu` da `admin.js` (sovrascriveva la versione corretta in `app.js` senza listener)
- Aggiunto swipe-down gesture sul bottom sheet admin: il sheet segue il dito, soglia 80px, animazione spring se sotto soglia
- Backdrop tap ripristinato e funzionante
- File modificati: `js/admin.js`, `js/app.js`

### Sales selettori — redesign compatto (v140)
- Pillole giorni recenti: padding ridotto `8px→5px`, border-radius `12px→10px`
- Bottoni period: padding `11px→8px`
- Card Recent days: padding ridotto, gap tra card `10px→6px`
- Risultato visivo allineato al mockup originale

### Sales staff — fix copertura topbar (v152)
- `section#vx` era `position:fixed; top:64px` — la topbar sticky + news bar coprivano il contenuto
- Convertita a layout normale come `section#vi` (Ingredients): `class="hidden px-3 pt-3 pb-24"`
- Modifica chirurgica solo su `index.html`, zero logica toccata

---
## Sessione 2026-06-15 — completato

### TouchBistro — import pipeline completa (v148→v153)
- 4 file CSV arrivano ogni notte via Gmail → Supabase
- Tabella `pos_modifier_by_item` creata e popolata (modifier + piatto padre)
- Tabella `modifier_config` creata con 86 modifier classificati (22 cucina, 64 non-cucina)
- Edge Function `gmail-touchbistro-import` v2→v3: ora importa tutti e 4 i file

### Sales admin — Deep Analysis (v145→v147)
- Bottone "🔍 Deep Analysis" in fondo alla tab Sales admin
- Modal con 8 categorie × 25 domande = 200 domande totali
- 25 query types implementate (top piatti, cotture, contorni per piatto, trend, record, YoY, ecc.)
- Categorie: Primi, Secondi, Antipasti, Contorni e Modifier, Riepilogo, Insalate e Zuppe, Dolci, Confronti Temporali, Performance e Record

### Sales staff view (v148)
- Staff (non admin) vede view separata — zero prezzi, zero incassi
- Selettori: Ieri / Weekend / Sett.
- Livello 1: gruppi cucina con barre (Pasta 106x, Secondi 54x...)
- Livello 2: tap su gruppo → lista piatti
- Sezione modifier cucina con colori per categoria
- Modal porzioni su tap: mostra side + modifier separati + totale da preparare

### Fix calcoli date (v149→v153)
- Weekend admin: formula corretta venerdì + sabato
- Weekend staff: formula corretta venerdì + sabato
- Settimana staff: lunedì → sabato della settimana precedente
- Padding dinamico per news bar su iPhone

---

## Note importanti per prossima sessione

### pos_sales_by_item — nomi colonne CORRETTI:
- menu_item (NON item_name)
- quantity (NON quantity_sold)
- net_sales, sale_date, sales_category

### pos_modifiers — nomi colonne CORRETTI:
- modifier, quantity_sold, gross_sales, sale_date

### pos_modifier_by_item — nomi colonne:
- modifier, parent_item, quantity_sold, pct_of_parent, sale_date

### Regola porzioni modifier:
- Contorni (Brussels, Asparagus, ecc.) = mezza porzione come modifier
- Proteine (Add chicken, Meatballs, ecc.) = porzione intera
- Pasta come modifier su secondi = mezza porzione
- Half/Child nel nome piatto = mezza porzione

### souschef-chat — non toccare senza leggere prima v15 da GitHub

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
