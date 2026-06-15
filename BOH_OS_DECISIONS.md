# BRIGADE — DECISIONS
*Perche abbiamo scelto certe cose. Non ridiscutere senza motivo.*
*Aggiornato: 2026-06-15 — v190*

---

## Naming

| Cosa | Nome corretto |
|---|---|
| App HTML/PWA attuale | **BRIGADE** |
| App Flutter futura con Siri | **BOH OS** (separata, non ancora costruita) |
| Branch deploy | **brigade-main** (MAI main) |
| Versione attuale frontend | **v190** |
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

## Prep redesign — decisione (2026-06-15)

### Swipe gestuale — "Il Tabellone Digitale"
- Ispirazione: foglio plastificato con pennarello che usano i ragazzi
- Zero bottoni visibili — solo lista gigante
- Swipe destra -> Fatta (verde, scende in fondo)
- Swipe sinistra -> In corso (blu, rimane in cima)
- Soglia 60% per conferma (evita falsi positivi mani bagnate)
- Tap nome -> apre ricetta
- Font 22px minimo, leggibile a 1 metro sul tavolo di acciaio
- Pillole stazione invece dei cerchi
- Sessione dedicata richiesta

---

## Sous Chef AI — concetto v15

Il Sous Chef non e un chatbot. E' un agente operativo con accesso diretto al database.

### Principio fondamentale:
IL CODICE PORTA I DATI. IL LLM RAGIONA.
Non filtrare mai. Mandare tutto e lasciare ragionare OpenRouter.

---

## Warning fatture — DEFINITIVO

Solo due warning validi durante importazione:
1. SC-GHOST-001: ingrediente senza nessun vendor/prezzo nel DB
2. SC-NOLINK-001: ha vendor e prezzo ma manca conversion_to_base (per_case senza peso pack)

SC-PRICE-001 ELIMINATO PER SEMPRE durante importazione.

---

## Review fattura — formato riga articolo (v190)

Warning [Nome Articolo] / OK [Nome Articolo]
Qty [input] . Pack [input] . Unit Price [input] . Ext [input]
Sous Chef: [calcolo pack dal parser] . [$/100g]

- Tutti e 4 i campi modificabili inline
- Ricalcolo automatico con bottone ricorda
- Nessun AI — solo parser + dizionario pesi standard
- _vdrEdits salvati e letti da vdrApprove al momento del save

---

## price_type in ingredient_vendors

Valori: per_case (DEFAULT), per_lb, per_kg, per_oz, per_each

Formula $/100g:
- per_case: (unit_price / conversion_to_base) * 100
- per_lb: (unit_price / 453.592) * 100
- per_kg: (unit_price / 1000) * 100

Carni catchweight (Tomahake Loin, Stew Meat): usare per_lb.

---

## Ingredienti — categorie (2026-06-15)

Produce, Dairy, Meat, Seafood, Dry Goods, Oil & Vinegar,
Spices & Herbs, Beverages & Spirits, Prepared, Bakery, Frozen, Supply

Tutti i 400 ingredienti attivi hanno categoria assegnata.

---

## Microfono (v92+)

- Tap breve: apre chat Sous Chef
- Tap lungo: voce -> Whisper -> souschef-chat

---

## Nightly Brief

- Cron: 0 10 * * * = 10:00 UTC = 5:00 AM CDT
- Edge Function: sc-nightly-brief v5
- Domenica: recap settimana
