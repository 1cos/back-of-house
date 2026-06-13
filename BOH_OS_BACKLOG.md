# BRIGADE — BACKLOG
*App si chiama BRIGADE. Branch deploy: brigade-main (MAI main).*
*Aggiorna dopo ogni sessione. Load dopo SPEC.*

---

## Regole operative

- App: **BRIGADE** (non BOH OS, non BIOS)
- Branch: **brigade-main**
- Versione attuale: **v77**
- Supabase project: `ydqmumpytgrlceuinoqt`
- GitHub repo: `1cos/back-of-house`
- Leggi sempre file da `brigade-main` prima di modificare
- File di progetto in `/mnt/project/` sono snapshot vecchi — usa GitHub
- Ogni commit = bump `boh-vNN` in `sw.js`

---

## Sessione 2026-06-12 — Completato ✅

### TASK 0a — Yes Chef modal (v69)
- `showSaveSuccessModal` sostituito con modal celebrativo grande
- ✅ Chef!, conteggio items/known/new, lista nuovi articoli
- Bottone "Got it — back to kitchen" 52px

### TASK 0b — Pesi standard pack a conteggio (v69)
- `STANDARD_UNIT_WEIGHTS` lookup (12 voci: egg 58g, lime 67g, lemon 100g, romaine 350g, flower 3g...)
- `enrichInvoiceItems` applica automaticamente prima di OQR-009
- `answerWeightQuestion` salva in `invoice_line_clarifications` (first time ask, second time learn)

### TASK 1 — Home Banner Warning (v70)
- `js/warnings-banner.js` (nuovo): legge `invoice_warnings` status=open + `vendor_documents.warnings` JSONB
- Banner colorato: 🔴 blocking, 🟡 alert, 🔵 insight
- Visibilità per ruolo: Admin tutto, Chef/Sous Chef solo alert, Cook niente
- `vendor-documents-review.js`: INSERT in `invoice_warnings` ad ogni parse PDF
- `vdrCodeToSeverity()` helper

### TASK 2 — Sous Chef proattivo (v71-v77)
- Tap breve microfono = scan DB, long press = registra vocale
- `runSousChefScan()` usa **Groq AI** (non regole hardcodate):
  1. Raccoglie dati reali dal DB
  2. Esclude sub-ricette/produzioni interne
  3. Manda a Groq con prompt da sous chef esperto
  4. Groq trova anomalie e le struttura come OQR
  5. Card swipeable: swipe giù = skip, swipe su = risolto
- Throttle: max 1 scan ogni 30 minuti
- Regole SC-*: SC-PRICE-001, SC-PRICE-002, SC-NOLINK-001, SC-UNUSED-001
- `openChefAISettings()` in Admin menu — toggle regole, localStorage
- Font size aumentati (18-19px), leggibili in cucina

### Operation Notes (v77)
- Tabella `operation_notes` creata in Supabase
- Pop-up alle 22:30 per tutta la brigata: "Come è andata stasera?"
- Una nota per persona per serata (guard localStorage + DB)
- Admin menu → "🌙 Note brigata" per storico completo

### Nightly Brief Engine (v77)
- Edge Function `sc-nightly-brief` deployata su Supabase
- Aggrega ogni notte: vendite ieri + top piatti + note brigata + warning + fatture
- Groq collega commenti umani ai dati POS
- Scrive in tabella `briefing` → appare in Briefing AI su Brigade
- **Cron automatico**: GitHub Actions `.github/workflows/nightly-brief.yml`
  - 05:00 UTC ogni notte = mezzanotte CDT
  - Trigger anche manuale da GitHub → Actions → Nightly Brief → Run workflow

---

## Prossima Sessione — Priority

### 1. Sous Chef Chat — interroga il DB in italiano
Il microfono oggi risponde in modo generico. Max parla italiano —
dice "cavoletti di Bruxelles" e il Sous Chef deve capire "Brussels Sprouts",
cercare nel DB, rispondere con il prezzo reale.
Flusso: voce → Groq capisce intento → query DB → risposta in italiano.
Questo è il prossimo task più importante.

### 2. Sous Chef Engine — scan periodica automatica
Oggi la scan è on-demand (tap microfono).
Prossimo step: Edge Function schedulata che gira ogni ora
e scrive warning nel banner senza che Max lo chieda.
Tre frequenze:
- Ogni ora: solo cosa è cambiato (nuove fatture, nuovi eventi)
- Ogni notte (già fatto): vendite + note brigata + briefing
- Ogni lunedì: trend 7 giorni, pattern settimanali

### 3. Good Job messages
Il Sous Chef deve celebrare i record:
"Ieri record di Tomahawk negli ultimi 90 giorni — cosa avete cambiato?"
Vanno in Service Updates — visibili a tutta la brigata.

### 4. Sous Chef Sales Anomaly detection
Pattern vendite anomale:
- Calo/picco >30% vs stesso giorno settimana scorsa
- Es: giovedì 11/6 — $1,011 vs $7,000+ → Groq chiede "cosa è successo?"
- Risposta salvata → quel giorno escluso dalle medie future

### 5. TripleSeat integration
Quando Monica aggiunge un evento su TripleSeat →
Sous Chef ti avvisa: "Nuovo evento aggiunto — vuoi analizzare il menù?"
(In attesa di credenziali API TripleSeat da Max)

### 6. Recipe → Sales linkage
Collegare ricette agli articoli POS:
quante Caprese vendute → quanto mozzarella e pomodoro consumato teoricamente.
Base per food cost futuro.

### 7. Ingredienti con peso mancante da risolvere
Avocado, Blackberry, Edible Flower, Eggs, Lemon, Lime, Romaine, Tomato, Watermelon
— tutti hanno unit_price ma price_per_100g = NULL perché pack è CT/DZ.
Il Sous Chef scan AI già li trova — risolvere con la card inline.

---

## Blockers attivi

- FreshPoint non manda ancora fatture (solo order confirmation)
- TripleSeat API credentials — in attesa da Max
- Touch Bistro CSV — in attesa da Max
- RLS Supabase — obbligatorio prima go-live staff

---

## Architettura Sous Chef Engine — Blueprint completo

```
FATTURE — event-driven:
  Nuova fattura → elabora → se ok: toast silenzioso
                          → se problemi: OQR in home banner

VENDITE — tre frequenze:
  Ogni notte: ieri vs settimana scorsa, top piatti, anomalie
  Ogni lunedì: trend 7gg, pattern giorno/settimana
  Ogni mese: stagionalità, food cost trend

OPERATION NOTES — ogni sera 22:30:
  Pop-up brigata → commento libero → salvato in DB
  Groq collega commenti ai numeri nel briefing mattutino

NOTIFICHE:
  🔴 Blocking → push immediata
  🟡 Alert → home banner al prossimo accesso
  🔵 Info/Good news → Briefing AI (visibile a tutta la brigata)
```

---

## Tabelle DB rilevanti

| Tabella | Uso |
|---|---|
| `invoice_warnings` | Warning aperti/risolti — fonte del banner |
| `vendor_documents` | Fatture PDF con warnings JSONB |
| `ingredient_vendors` | Prezzi per vendor + price_per_100g |
| `ingredient_links` | Match fattura → ingrediente |
| `operation_notes` | Commenti brigata post-servizio (NUOVO) |
| `briefing` | Briefing mattutino generato da Groq |
| `pos_daily_summary` | Vendite giornaliere da TouchBistro |
| `pos_sales_by_item` | Vendite per piatto |
| `purchases` | Fatture importate (invoice pipeline) |
| `invoice_lines` | Righe fattura con match status |

---

## Edge Functions attive

| Function | Trigger | Scopo |
|---|---|---|
| `process-invoice` | On demand | OCR pipeline Google Vision + Groq |
| `gmail-hardies-import` | Cron orario | Gmail → Hardie's PDF → storage |
| `sc-nightly-brief` | Cron 05:00 UTC | Vendite + note → Groq → briefing |
| `souschef-classify` | On demand | Groq LLaMA classificazione AI |
| `ai-translate` | On demand | Traduzione multilingue |
| `transcribe-audio` | On demand | Groq Whisper trascrizione vocale |

---

## Decisions permanenti

- File completi sempre — mai patch parziali
- Base per modifiche: sempre da `brigade-main` su GitHub, mai da `/mnt/project/`
- Scope discipline: tocca solo il modulo richiesto
- Groq AI invece di regole hardcodate — più intelligente, più flessibile
- Sub-ricette (Bolognese, Béchamel...) escluse dai warning ingredienti
- Classificazione ingredienti: se nome = titolo ricetta → produzione interna → skip
