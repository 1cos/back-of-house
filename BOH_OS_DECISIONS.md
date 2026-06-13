# BRIGADE — DECISIONS
*Perché abbiamo scelto certe cose. Non ridiscutere senza motivo.*

---

## Stack

| Decisione | Scelta | Motivo |
|---|---|---|
| OCR fatture | ~~Google Vision + Groq~~ → **OpenRouter Gemini 2.0 Flash (PDF diretto)** | Gemini legge PDF direttamente, zero OCR, un solo step |
| Fallback OCR | Google Vision + Groq | Se OpenRouter fallisce |
| Trascrizione voce | **Groq Whisper** | Limite separato dal LLM, funziona anche con Groq bloccato |
| LLM principale | ~~Groq LLaMA 3.3 70B~~ → **OpenRouter → meta-llama/llama-3.3-70b-instruct** | Groq free tier bloccato (upgrade non disponibile da 2 settimane) |
| LLM chat | **OpenRouter** con fallback Groq | Stessa chiave, stesso modello |
| Frontend attuale | HTML/JS vanilla | Prototipo funzionante in produzione |
| Frontend futuro | Flutter | Siri AI integration richiede app nativa |
| Database | Supabase | Auth, Realtime, Edge Functions, RLS tutto incluso |
| Deployment | GitHub Pages | Semplicità, zero costi, sufficiente per PWA |
| Cron nightly brief | Supabase cron | `0 10 * * *` = 10:00 UTC = 5:00 AM CDT Texas |

---

## Naming

| Cosa | Nome corretto |
|---|---|
| App HTML/PWA attuale | **BRIGADE** |
| App Flutter futura con Siri | **BOH OS** (separata, non ancora costruita) |
| Branch deploy | **brigade-main** (MAI main) |
| Versione attuale | **v89** |
| AI assistant in cucina | **Sous Chef** / **Chef AI** |

---

## AI Architecture

| Componente | Tecnologia | Note |
|---|---|---|
| Chat privata Max | `souschef-chat` Edge Function | Porta TUTTO il DB senza filtri, OpenRouter ragiona |
| Scan anomalie | `souschef-classify` mode=scan | Prompt costruito nel browser, mandato alla Edge Function |
| Domanda vocale | `souschef-classify` mode=classify | Cerca in DB per keyword + passa tutto a OpenRouter |
| Nightly brief | `sc-nightly-brief` | Legge vendite, note brigata, chef_attention, warning |
| Parser fatture | `process-invoice` v27 | OpenRouter/Gemini PDF diretto, autoProcess mode |
| Chef Memory | tabella `chef_attention` | Salva topic domande, nightly brief li include |

---

## Principio fondamentale Chat AI (IMPORTANTE)

**Il codice porta i dati. L'AI ragiona.**

Non filtrare per keyword prima di mandare a OpenRouter.
Portare TUTTO il contesto (ingredienti, ricette, vendite, warning) e lasciare che OpenRouter trovi le connessioni semantiche.

Es: Max chiede "Rosemary Potatoes" → il DB ha "ROSMARY POTATOES" → OpenRouter capisce da solo.
Se filtrassimo per keyword "rosemary", non troveremmo "rosmary".

---

## price_type (IMPORTANTE — nuovo campo)

Il campo `price_type` in `ingredient_vendors` risolve il problema catchweight:

| Valore | Significato | Esempio |
|---|---|---|
| `per_case` | unit_price è per cassa intera | Hardie's, Sysco, BEK |
| `per_lb` | unit_price è per libbra | Fruge (pesce), carni catchweight |
| `per_kg` | unit_price è per kg | Global Gourmet (alcuni prodotti) |
| `per_oz` | unit_price è per oncia | raro |
| `per_each` | unit_price è per pezzo | raro |

Formula $/100g:
- `per_case`: `(unit_price / conversion_to_base) * 100`
- `per_lb`: `(unit_price / 453.592) * 100`
- `per_kg`: `(unit_price / 1000) * 100`

---

## Importazione fatture — architettura definitiva

### Flusso email (automatico, silenzioso):
```
Email fornitore → Gmail label → Google Apps Script → process-invoice (autoProcess=true)
→ OpenRouter/Gemini legge PDF → salva DB → confronta prezzi → avvisa solo anomalie
```

### Flusso foto/scan (manuale, da migrare):
```
Foto Max → [DA FARE: mandare a process-invoice invece di Google Vision]
→ OpenRouter/Gemini legge immagine → stessa logica email
```

### Notifiche Brigade:
- Prezzo cambiato >10%: warning in `invoice_warnings` (banner home)
- Ingrediente nuovo: warning `insight` in `invoice_warnings`
- Tutto il resto: silenzio

---

## UX

| Decisione | Scelta | Motivo |
|---|---|---|
| Lingua UI | English only | Staff multilingue ma UI uniforme |
| Chat AI | Italiano | Max è italiano, risponde sempre in italiano |
| OQR | Obbligatorio | Una decisione alla volta |
| Bottom decision zone | Obbligatorio | One thumb rule, iPhone first |
| Warning color | 🔴 blocking, 🟡 alert, 🔵 insight | Gradazione chiara |
| Fake defaults | Vietati | Blank > placeholder > valore inventato |
| Font size card OQR | Min 16px, titoli 18-19px | Max è in cucina, mani sporche |
| Tap breve microfono | Apre chat Sous Chef | Prima lanciava scan — cambiato v86 |
| Tap lungo microfono | Registrazione vocale | Invariato |
| Scan manuale | Bottone 🔍 dentro la chat | Accessibile sempre dalla chat |

---

## Sous Chef Engine — comportamento atteso

Il Sous Chef NON è un chatbot. È un agente operativo:

- **Proattivo**: nota problemi prima che Max li chieda
- **Silenzioso**: avvisa solo quando serve una decisione
- **Impara**: `chef_attention` registra cosa chiede Max, nightly brief lo include
- **Corregge il DB**: Max dice "Stew Meat, 12 lb, $3.29/lb" → aggiorna direttamente
- **Ragiona semanticamente**: trova "ROSMARY POTATOES" quando chiedi "Rosemary Potatoes"

---

## Sessione 22:30 CDT — Operation Notes

- Appare automaticamente a tutta la brigata loggata
- Campo testo libero, qualsiasi lingua
- Salva in `operation_notes` con `note_date` (CDT, non UTC), `user_name`, `note`, `service='dinner'`
- Riappare ogni 30 min se non risponde, si blocca dopo mezzanotte CDT
- Il nightly brief delle 5:00 AM legge le note e le collega ai dati vendite
