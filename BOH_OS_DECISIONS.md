# BRIGADE — DECISIONS
*Perché abbiamo scelto certe cose. Non ridiscutere senza motivo.*
*Aggiornato: 2026-06-13 — v92 frontend + souschef-chat v14*

---

## Naming

| Cosa | Nome corretto |
|---|---|
| App HTML/PWA attuale | **BRIGADE** |
| App Flutter futura con Siri | **BOH OS** (separata, non ancora costruita) |
| Branch deploy | **brigade-main** (MAI main) |
| Versione attuale frontend | **v92** |
| Versione souschef-chat | **v14** |
| Supabase project attivo | `ydqmumpytgrlceuinoqt` |
| Supabase project vecchio | `hykjompnvajjhggrnned` — tenere attivo fino a Flutter |

---

## Stack AI — CAMBIATO 2026-06-13

| Componente | Ora |
|---|---|
| LLM principale | OpenRouter → meta-llama/llama-3.3-70b-instruct |
| OCR fatture | OpenRouter → google/gemini-2.0-flash-001 (PDF diretto) |
| Voce trascrizione | Groq Whisper (rimane — limite separato) |
| Fallback LLM | Groq se OpenRouter fallisce |
| Chiave OpenRouter | Supabase secrets: OPENROUTER_API_KEY |
| Chiave Groq | Supabase secrets: GROQ_API_KEY |

---

## Cos'è il Sous Chef AI — concetto v14

Il Sous Chef non è un chatbot. E' un agente operativo con accesso diretto al database.

### Architettura:
1. Max parla o scrive — voce e testo identici, stesso flusso
2. Edge Function souschef-chat legge TUTTO il DB con service role key
3. Manda tutto a OpenRouter LLaMA con contesto completo
4. OpenRouter ragiona semanticamente — asparagi=asparagus, olio=oil
5. Risponde in italiano, pulito, senza JSON visibile

### Tabelle che legge:
- recipes — ricette con ingredienti e grammature
- ingredients + ingredient_vendors — prezzi per fornitore
- pos_sales_by_item — vendite piatti (campo: menu_item, quantity)
- pos_modifiers — vendite modifier (campo: modifier, quantity_sold)
- pos_daily_summary — totali giornalieri
- prep_log — prep ultime 2 settimane
- sous_chef_tasks — task aperti
- operation_notes — note brigata
- invoice_warnings — warning aperti
- chef_attention — topic frequenti di Max

### Cosa puo' fare:
- Rispondere su ricette, prezzi, vendite, prep
- Aggiornare ingredient_vendors a voce
- Creare task
- Calcolare (scala ricette, food cost, conversioni)
- Ragionare in italiano anche se dati sono in inglese

### Principio fondamentale:
IL CODICE PORTA I DATI. IL LLM RAGIONA.
Non filtrare mai. Mandare tutto e lasciare ragionare OpenRouter.

---

## price_type in ingredient_vendors

Aggiunto 2026-06-13. Valori: per_case (DEFAULT), per_lb, per_kg, per_oz, per_each

Formula $/100g:
- per_case: (unit_price / conversion_to_base) * 100
- per_lb: (unit_price / 453.592) * 100
- per_kg: (unit_price / 1000) * 100

Carni catchweight (Stew Meat, Tomahawk): usare per_lb.

---

## Importazione fatture

### Email automatica:
Email → Gmail label → Google Apps Script → process-invoice (autoProcess=true)
→ OpenRouter/Gemini legge PDF → DB → warning solo se anomalia >10%

### Fornitori:
- Hardies: label hardies-import, parser gmail-hardies-import
- Fruge: system@netyield.com → label fruge-import → process-invoice
- Ben E. Keith: forward iCloud→Gmail DA FARE → label bek-import
- Freshpoint: in attesa

### Foto/scan — DA MIGRARE a OpenRouter

---

## Microfono (v92)

- Tap breve: apre chat Sous Chef
- Tap lungo: voce → Whisper → souschef-chat
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
- Edge Function: sc-nightly-brief
- Legge: vendite, note brigata, warning, chef_attention

---

## Sales page

- Tab Oggi: RIMOSSA (dati arrivano mattina dopo)
- Da aggiungere: ricerca per data libera, filtro Food only
- Da tradurre: Yesterday, Weekend, 7 days, 30 days
