# BOH OS — DECISIONS
*Perché abbiamo scelto certe cose. Non ridiscutere queste decisioni senza motivo.*

---

## Credenziali & Accessi
*Leggere all'inizio di ogni sessione Claude.*

| Servizio | Dettaglio |
|---|---|
| **GitHub repo** | `1cos/back-of-house` |
| **GitHub token** | ⚠️ Non salvabile nel repo — Max lo fornisce all'inizio di ogni sessione come file upload (`x_claude_GIthub.txt`) |
| **Supabase project ID** | `ydqmumpytgrlceuinoqt` |
| **App live** | https://1cos.github.io/back-of-house |
| **Google Apps Script** | "Brigade hardies import" — ID: `19acxePrxOZQU7M-7_RsM0Y5VRc0ILkmSLFcvyIUndmI5Q0UN-3lMcGI5` |

**Regola:** ogni sessione Claude legge i file JS da GitHub prima di modificarli, e li rimette su GitHub dopo.
**Regola:** Max carica il token GitHub come primo file upload di ogni sessione (`x_claude_GIthub.txt`).

---

## Automazioni Attive

| Automazione | Trigger | Edge Function | Tabelle |
|---|---|---|---|
| Hardie's invoice Gmail | label `hardies-import` → Apps Script orario | `gmail-hardies-import` | `vendor_documents` |
| TouchBistro daily report | label `touchbistro-import` → Apps Script orario | `gmail-touchbistro-import` | `pos_daily_summary`, `pos_sales_by_item`, `pos_modifiers` |

**TouchBistro Gmail filter:** `from:no-reply@touchbistro.com` → applica label `touchbistro-import`
**TouchBistro CSV riconosciuti:** `SalesByMenuItem`, `Daily_HourlySales`, `TextModifier` (ModifierPreference skippato)

---

## Stack

| Decisione | Scelta | Motivo |
|---|---|---|
| OCR | Google Vision + Groq | Mindee scartato (a pagamento dopo trial), Groq Vision scartato (inaffidabile su fatture) |
| Frontend attuale | HTML/JS vanilla | Prototipo funzionante in produzione, nessun framework necessario |
| Frontend futuro | Flutter | Siri AI integration richiede app nativa, App Store |
| Database | Supabase | Auth, Realtime, Edge Functions, RLS tutto incluso |
| AI | Groq LLaMA 3.3 70B | Velocità, costo, qualità sufficiente per cucina |
| Deployment | GitHub Pages | Semplicità, zero costi, sufficiente per PWA |
| HTML come blueprint | ✅ tenere | L'HTML è la spec funzionante per Flutter. Ogni feature validata in cucina = requisito confermato |

---

## UX

| Decisione | Scelta | Motivo |
|---|---|---|
| Lingua UI | English only | Staff multilingue ma UI uniforme. Nomi ricette/dati = lingua originale |
| OQR | Obbligatorio | Una decisione alla volta. Mai 5 problemi simultanei |
| Bottom decision zone | Obbligatorio | One thumb rule, iPhone first |
| Warning color | Amber default, rosso solo high severity | Evitare "app rotta" visivamente |
| Scroll preservation | Obbligatorio | Non resettare lista dopo ritorno da dettaglio |
| Fake defaults | Vietati | Blank > placeholder > valore inventato |
| Unmatched vs wrong match | Unmatched è più sicuro | Wrong match avvelena il food cost |
| Imported data | Non è truth | Sempre flag per review, mai salvare silenziosamente |

---

## Sviluppo

| Decisione | Scelta | Motivo |
|---|---|---|
| File completi | Obbligatorio | Patch incrementali hanno causato bug e merge conflicts ripetuti |
| Scope discipline | Obbligatorio | Toccare solo il modulo richiesto |
| **Base file per modifiche** | **Sempre da GitHub** | MAI leggere da `/mnt/project/` — è snapshot iniziale. Leggere sempre da GitHub con il token, modificare, rimettere su GitHub. |
| **Conferma prima di modificare** | **Obbligatorio** | Prima di ogni modifica dichiarare esattamente cosa cambia e aspettare conferma di Max. |
| Vendor parser specifici | Necessari | Parser generale insufficiente per Hardie's, Ben E. Keith, Frugé, FreshPoint, Global Gourmet |
| Sub-recipe | Ogni ricetta può essere sub-recipe | Nessuna restrizione di categoria, riferimenti circolari vietati |
| Invoice line total | Source of truth | Non fidarsi dell'OCR su prezzi unitari, usare il totale riga |
| Auto-match aggressivo | Vietato | Solo high confidence. Wrong match = costing avvelenato |
| Costing changes | Solo con audit preventivo | Non modificare formule costing senza report prima |

---

## Architettura futura

| Decisione | Scelta | Motivo |
|---|---|---|
| Siri AI | Flutter nativo richiesto | PWA/HTML non può integrarsi con Siri AI (richiede App Store + Swift frameworks) |
| Stock on-hand | Non ancora | Tre opzioni aperte: manuale / stima da invoice / depletion da produzione. Non decidere in fretta |
| Forecasting | Futuro | Richiede Touch Bistro + TripleSeat + storia invoice. Non costruire ora |
| HR / Scheduling / CRM | Non costruire | Fuori scope BOH OS v1 |

---

## Lezioni Apprese

- `get_edge_function` di Supabase MCP non restituisce il body delle funzioni in modo affidabile → chiedere il codice direttamente a Max
- Recipe import mancava `recipe_steps` perché la tabella si chiama `recipe_steps` non `procedure_steps`
- Safari iPhone richiede `maximum-scale=1,user-scalable=no` nel viewport meta
- Cache iPhone va svuotata per ricevere aggiornamenti
- Sessioni multiple senza SPEC brucia token in warmup invece che in codice
- `/mnt/project/` è uno snapshot iniziale — leggere sempre da GitHub con il token
- `JSON.stringify(data)` inline in onclick crasha su nomi vendor con apostrofi — usare sempre `element._data = data` + `addEventListener`
- `.neq('category','Supply')` in PostgREST esclude anche le righe con `category = null` — filtrare in JS con `filter(i => i.category !== 'Supply')`
- `topCandidates.reduce()` crasha su array vuoto senza valore iniziale — aggiungere sempre guard `length > 0`
- Variabili definite in `saveInvoice` non accessibili in `showSaveSuccessModal` — passare come parametri esplicitamente
- TouchBistro CSV giornalieri: la data è nel filename, non nel CSV (`16814-ReportName-YYYY-MM-DD-YYYY-MM-DD.csv`)
- TouchBistro `Daily_HourlySales` aggrega per giorno della settimana, non per ora — non mappabile a fasce orarie
- GrossMarginByDay storico ha food_cost e margin per giorno — fonte di verità per costing storico
- GitHub secret scanning blocca push di token nel repo — il token va fornito da Max come file upload a ogni sessione
