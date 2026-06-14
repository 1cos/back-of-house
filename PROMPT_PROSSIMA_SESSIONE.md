# Prompt Prossima Sessione — Brigade
*Carica sempre questo file per primo, poi gli altri MD.*

Carica sempre in questo ordine:
1. PROMPT_PROSSIMA_SESSIONE.md da brigade-main
2. BOH_OS_SPEC.md da brigade-main
3. BOH_OS_BACKLOG.md da brigade-main
4. BOH_OS_DECISIONS.md da brigade-main
5. BRIGADE_VISION.md da brigade-main

---

## Stato attuale — Brigade v152

Supabase project: ydqmumpytgrlceuinoqt
Deploy: https://1cos.github.io/back-of-house — branch brigade-main
souschef-chat: v15 | sc-nightly-brief: v5 | souschef-scan: v4
gmail-touchbistro-import: v3

---

## Completato sessione 2026-06-15

### TouchBistro pipeline completa
- 4 file CSV importati ogni notte (era 3 — mancava ModifierPreferenceByMenuItem)
- Nuova tabella `pos_modifier_by_item` — modifier collegato al piatto padre
- Nuova tabella `modifier_config` — 86 modifier classificati (22 cucina, 64 non-cucina)
- Edge Function gmail-touchbistro-import v2→v3

### Sales admin — Deep Analysis
- Bottone "Deep Analysis" in fondo alla tab Sales (solo admin)
- Modal con 9 categorie, 200+ domande, 25 query types implementate
- File: js/pos.js

### Sales staff view
- Staff vede view completamente separata dall'admin
- Zero prezzi, zero incassi, solo quantità e cibo
- Selettori: Ieri / Weekend (ven+sab) / Sett. (lun→sab settimana precedente)
- Livello 1: gruppi cucina con barre
- Livello 2: tap su gruppo → lista piatti
- Modifier cucina colorati per categoria
- Modal porzioni su tap con calcolo side + modifier + totale

### Fix date
- Weekend: venerdì + sabato (era sbagliato per entrambi admin e staff)
- Settimana staff: lunedì → sabato settimana precedente

---

## Completato sessione 2026-06-14 — UI Split Admin/Staff (v146)

### Architettura UI biforcata — decisioni definitive

#### Top bar
- Admin: campanella visibile, cliccabile, apre News Manager, bellDot rosso se news attive
- Staff: campanella RIMOSSA. bellDot non mostrato.
- News bar: flash blu 2 secondi quando arriva news nuova mentre app è già aperta (staff)
- Push notification: non toccate — funzionano indipendentemente

#### Home page — struttura widget
**Prima delle 20:00:**

| Widget | Admin | Staff |
|---|---|---|
| Warnings Banner | ✅ tutto | ❌ nascosto |
| Invoice quick actions | ✅ | ❌ nascosto |
| Briefing AI (tecnico) | ✅ | ❌ nascosto |
| Yesterday's/Weekly Highlights | ✅ sunto tecnico | ✅ sunto motivazionale |
| Upcoming Demand | ✅ | ✅ |
| Stations (tutte pill) | ✅ | ❌ |
| Your Station (top 3 item) | ❌ | ✅ |
| Other Stations (pill solo con todo) | ❌ | ✅ widget separato |
| Closing Checklist | ✅ solo admin | ❌ |

**Dopo le 20:00 (tutti):**
- Closing Checklist sale in cima con campo commento "Anything to pass on for tomorrow?"
- Se staff compila campo → operation_note salvata → push 22:30 non arriva
- Il resto dei widget rimane invariato

**Highlights title — logica automatica:**
- Lunedì → "Weekly Highlights" (recap settimana intera)
- Tutti gli altri giorni → "Yesterday's Highlights"

#### Bottom bar biforcata
| Tab | Admin | Staff |
|---|---|---|
| Home | ✅ | ✅ |
| Prep | ❌ (nel menu •••) | ✅ |
| Closing | ❌ (nel menu •••) | ✅ |
| Recipes | ✅ | ✅ |
| Ingredients | ✅ | ❌ |
| Sales | ✅ | ✅ (view filtrata) |
| Chat | ✅ | ✅ |
| Menu ••• | ✅ | ❌ |

#### Sales staff — già implementata (sessione 15 giugno)
- View staff separata già funzionante in pos.js
- Zero prezzi, zero fatturato, solo quantità Food

#### Recipes — read-only per staff
- `recipeAdminBtns` (Collega / + Nuova) già nascosti per staff ✅

### File modificati in questa sessione
- `sw.js` — v141→v146
- `js/news.js` — campanella admin only, flash news bar staff
- `js/app.js` — doLogin biforcato admin/staff, startHomeTimeCheck, saveEveningNote
- `js/briefing.js` — renderHomeStations split, Other Stations widget separato
- `index.html` — struttura home widget, bottom bar, closing widget

### Pendente da questa sessione
- **Other Stations widget separato** — HTML creato, JS parzialmente implementato. v145 aveva rotto admin home — rollback a v144 (ora v146). Da riprendere con audit preventivo completo ID HTML↔JS prima di implementare.

---

## DA FARE SUBITO — prossima sessione

### 1. Other Stations widget separato (riprendere da v146)
Audit preventivo: mappare tutti gli ID HTML vs JS prima di toccare.
Problema v145: doLogin cercava homeOtherStations ma era in widget separato non gestito.
Soluzione: aggiornare doLogin + renderHomeStations + _applyHomeTimeLayout in modo coordinato.

### 2. PASSO 2 — Checklist sera → preplist mattina
Il ciclo fondamentale Brigade:
- Sera: brigata compila checklist per stazione
- Notte: AI genera preplist mattina basata su checklist + vendite
- Mattina: cuoco vede la sua preplist, segna fatto

### 3. Sales staff — modal porzioni (da completare)
Vedi file `PROMPT_SALES_STAFF_VIEW.md` per specifiche complete.

### 4. Warning Center fix
- "No peso" chiude senza fare niente — da fixare

---

## Pendenti operativi

- Romaine: Max pesa una testa e inserisce peso nel DB
- FreshPoint articoli: conversion_to_base null, reimportare fattura
- Sysco: fattura da importare (Sun Dry Tomatoes, Canned Tomatoes, Tomato Paste, Tomato Puree)
- Label Gmail: bek-import e fruge-import da creare
- Ben E. Keith: forward iCloud→Gmail da fare
- FreshPoint: non manda ancora fatture (solo order confirmation)
- Push notification primo login staff: banner sparisce dopo 8s, non ritorna (FIX-001)

---

## Regole operative

1. Leggi SEMPRE il file da GitHub prima di modificarlo
2. Usa API GitHub base64 decode — non raw CDN
3. Bumpa sw.js nello stesso push — leggere versione attuale e incrementare di 1
4. Verifica via API dopo ogni push
5. Supabase project: ydqmuppytgrlceuinoqt
6. MAI usare template literals multiriga o emoji nei file JS — causano SyntaxError
7. Dichiara cosa cambi prima di farlo — aspetta conferma Max
8. File completi — zero patch parziali
9. La view admin Sales rimane intatta — modifiche solo additive
10. Mai sovrascrivere sw.js con numero fisso — sempre leggere versione corrente e +1

---

## Struttura file Sales (pos.js) — v153

- Righe 1-127: utility functions (toISO, addDays, getPeriod, posSelectors)
- Righe 128-320: loadPOS() — view admin (NON TOCCARE)
- Righe 321-324: posSetMode()
- Righe 325-1440: Deep Analysis (DA_CATEGORIES, openDeepAnalysis, daExecuteQuery)
- Righe 1441-1760: Staff view (staffGetPeriod, loadPOSStaff, staffOpenGroup, staffOpenDishModal)

**Redirect admin/staff: riga 129** — `if (!isAdmin()) { loadPOSStaff(); return; }`

---

## FIX da fare (chat dedicata)

| # | Fix | File | Note |
|---|---|---|---|
| FIX-001 | Push notification primo login staff | push.js | Banner sparisce dopo 8s, non ritorna se ignorato |
| FIX-002 | ~~News push non arriva staff~~ | ~~push.js~~ | ✅ Risolto — arriva con piccolo delay normale |
