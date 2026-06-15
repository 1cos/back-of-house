# BRIGADE — DECISIONS
*Perche abbiamo scelto certe cose. Non ridiscutere senza motivo.*
*Aggiornato: 2026-06-15 — v180*

---

## Naming

| Cosa | Nome corretto |
|---|---|
| App HTML/PWA attuale | **BRIGADE** |
| App Flutter futura con Siri | **BOH OS** (separata, non ancora costruita) |
| Branch deploy | **brigade-main** (MAI main) |
| Versione attuale frontend | **v180** |
| Versione souschef-chat | **v15** |
| Supabase project attivo | ydqmumpytgrlceuinoqt |
| Supabase project vecchio | hykjompnvajjhggrnned — tenere attivo fino a Flutter |

---

## Stack AI

| Componente | Ora |
|---|---|
| LLM principale | OpenRouter -> meta-llama/llama-3.3-70b-instruct |
| OCR fatture | OpenRouter -> google/gemini-2.0-flash-001 (PDF diretto) |
| Voce trascrizione | Groq Whisper (rimane — limite separato) |
| Fallback LLM | Groq se OpenRouter fallisce |
| Chiave OpenRouter | Supabase secrets: OPENROUTER_API_KEY |
| Chiave Groq | Supabase secrets: GROQ_API_KEY |

---

## Sous Chef AI — concetto v15

Il Sous Chef non e un chatbot. E' un agente operativo con accesso diretto al database.

### Architettura:
1. Max parla o scrive — voce e testo identici, stesso flusso
2. Edge Function souschef-chat legge TUTTO il DB con service role key
3. Manda tutto a OpenRouter LLaMA con contesto completo
4. OpenRouter ragiona semanticamente
5. Risponde in italiano, pulito, senza JSON visibile

### Tabelle che legge:
- recipes, ingredients, ingredient_vendors
- pos_sales_by_item, pos_modifiers, pos_modifier_by_item, pos_daily_summary
- prep_log, sous_chef_tasks, operation_notes
- invoice_warnings, chef_attention

### Principio fondamentale:
IL CODICE PORTA I DATI. IL LLM RAGIONA.
Non filtrare mai. Mandare tutto e lasciare ragionare OpenRouter.

---

## TouchBistro — import pipeline (2026-06-15)

4 file CSV arrivano ogni notte via Gmail:

| File | Tabella | Note |
|---|---|---|
| Daily_HourlySales | pos_daily_summary | coperti + fatturato |
| SalesByMenuItem | pos_sales_by_item | piatti venduti |
| TextModifier | pos_modifiers | modifier totali |
| ModifierPreferenceByMenuItem | pos_modifier_by_item | modifier + piatto padre |

Edge Function: gmail-touchbistro-import v3
Google Apps Script: TouchBistroImport.gs in "Brigade hardies import"

---

## Sales — decisioni architetturali (2026-06-15)

### Admin view
- Selettori: 6 giorni recenti + Weekend + Last week + 30 days + Periodo custom
- Mostra: fatturato, coperti, food cost, sconti, top 10 revenue, categorie, trend
- Deep Analysis: modal separato con 200 domande su 9 categorie
- Weekend = venerdi + sabato (Zenos chiuso domenica)
- Last week = lunedi -> sabato della settimana precedente

### Staff view
- Selettori: Ieri / Weekend / Sett.
- Mostra: solo quantita, solo Food, zero prezzi
- Livello 1: gruppi cucina (Pasta, Secondi, ecc.) con barre
- Livello 2: tap su gruppo -> lista piatti
- Modifier cucina con colori per categoria
- Modal su tap: porzioni da preparare con calcolo side + modifier
- Weekend = venerdi + sabato
- Sett. = lunedi -> sabato settimana precedente

### Regola porzioni modifier
- Contorni come modifier = mezza porzione
- Proteine come modifier = porzione intera
- Pasta come modifier su secondi = mezza porzione
- Half/Child nel nome = mezza porzione
- Arrotonda sempre per eccesso (Math.ceil)

### Gruppi Food da mostrare allo staff
Pasta, Secondi/entrees, Antipasti/appetizer, Insalate/salad,
Dolcezze/dessert, Kids menu, Soup, Sides, Lunch

### Gruppi Food da ESCLUDERE allo staff
NA Beverages, The Bar, Mocktail, Happy hours, Wine dinner,
Testing menu, Catering, Peach Festival, Resturant week

---

## price_type in ingredient_vendors

Valori: per_case (DEFAULT), per_lb, per_kg, per_oz, per_each

Formula $/100g:
- per_case: (unit_price / conversion_to_base) * 100
- per_lb: (unit_price / 453.592) * 100
- per_kg: (unit_price / 1000) * 100

Carni catchweight (Stew Meat, Tomahawk): usare per_lb.

---

## Importazione fatture

### Email automatica:
Email -> Gmail label -> Google Apps Script -> process-invoice (autoProcess=true)
-> OpenRouter/Gemini legge PDF -> DB -> warning solo se anomalia >10%

### Fornitori:
- Hardies: label hardies-import
- Fruge: system@netyield.com -> label fruge-import
- Ben E. Keith: forward iCloud->Gmail DA FARE -> label bek-import
- Freshpoint: in attesa

---

## Warning fatture — DEFINITIVO

Solo due warning validi durante importazione:
1. SC-GHOST-001: ingrediente senza nessun vendor/prezzo nel DB
2. SC-NOLINK-001: ha vendor e prezzo ma manca conversion_to_base (per_case senza peso pack)

SC-PRICE-001 ELIMINATO PER SEMPRE durante importazione.
Il giudizio sui prezzi e capitolo futuro (confronto storico) — non ora.

---

## Review fattura — formato riga articolo (OBBLIGATORIO)

Warning [Nome Articolo]
Qty [val] . Pack [val] . Unit Price [val] . Ext [val]
Sous Chef: [calcolo pack] . [risultato]

Tutti e 4 i campi sono modificabili inline.
Quando modifichi un campo, il $/100g si ricalcola in background automaticamente.
Nessun giudizio sul prezzo. Solo matematica.

Esempio Burrata:
Warning Burrata
Qty 1 . Pack 6-4/2oz . Unit $26.73 . Ext $26.73
Sous Chef: 6x4x2 = 48oz . $26.73

Esempio Stew Meat (per lb):
Warning Stew Meat (ABR Brochette in fattura)
Qty 1 . Pack 4 PC/12# . Unit $3.42/lb . Ext $44.90
DB: 4x12 = 48lb . $3.42/lb = $0.754/100g

Se il parser calcola due risultati diversi dallo stesso pack:
mostrare ENTRAMBE le interpretazioni come opzioni cliccabili.
Max sceglie quale e giusta. Nessuna AI coinvolta.

---

## Microfono (v92+)

- Tap breve: apre chat Sous Chef
- Tap lungo: voce -> Whisper -> souschef-chat
- Voce e testo identici — stesso Edge Function

---

## Operation Notes

- File: js/operation-notes.js
- 22:30 CDT: popup a tutta la brigata
- Salva in operation_notes (note_date in CDT)
- Nightly brief le legge alle 5:00 AM CDT

---

## Nightly Brief

- Cron: 0 10 * * * = 10:00 UTC = 5:00 AM CDT
- Edge Function: sc-nightly-brief v5
- Legge: vendite, note brigata, warning, chef_attention
- Domenica: recap settimana (no scan giornaliero)
