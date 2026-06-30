# BOH OS — SPEC
*Source of truth for every Claude session.*
*Load this first, always.*
*Aggiornato 2026-06-30 — v428. Vedi nota importante sotto su naming BOH OS vs Brigade.*

---

## ⚠️ Nota naming critica (chiarita dopo questo documento, leggere prima di tutto)

Questo documento usa "BOH OS" per riferirsi all'app HTML/PWA attualmente in produzione. **Quel nome è cambiato**: l'app HTML/PWA live oggi si chiama **Brigade** (repo `1cos/back-of-house`, branch `brigade-main`). "BOH OS" (o "BIOS") oggi indica un'**app gemella separata in Flutter con integrazione Siri — attualmente in pausa, non attiva** (confermato da Max 30/06/2026). Non abbandonata, ma non in sviluppo al momento: tutto il focus è su Brigade.

Lo stack Flutter descritto sotto (tabelle `recipe_versions`/`recipe_lines`/`inventory_items`, moduli `lib/features/`) **non risulta nello schema DB reale verificato live** (vedi BRIGADE_DB_SCHEMA.md) — coerente con il fatto che è in pausa: quel lavoro resta congelato allo stato in cui era, non sincronizzato con l'evoluzione recente del DB di Brigade. Quando/se Max riprenderà BOH OS/BIOS, andrà ripreso da zero o quasi sul fronte schema, perché Brigade nel frattempo è andata avanti molto.

La filosofia OQR (One Question Rule) descritta in questo documento resta pienamente valida e applicata in Brigade — è coerente con BOH_OS_WARNINGS.md e con le decisioni architetturali in BOH_OS_DECISIONS.md.

---

## The Vision — Il Sous Chef Digitale

**This is not a management app. It is a digital sous chef.**

The perfect sous chef does not bring the chef 10 problems at once.
He approaches during service and says one thing:

*"Chef, the Bolognese is low."*
Chef says: *"Make another batch."*
He says: *"Done."*
Back to work.

**This is the exact model for every interaction in Brigade.**

The app knows everything. It interrupts only when a decision is needed.
It presents one problem, one suggestion, one action.
The chef taps. Done. Next.

This is the **One Question Rule (OQR)** — the central mantra of the entire project.

Not: "Here is the inventory page with 596 items, filters, columns, tabs."
Yes: "Chef, 3 items changed price this week. Want to see?"

Not: "Fill this form to create a production task."
Yes: "Need to make Arrabbiata today. How much? [ 1 batch ] [ 2 batches ] [ I decide ]"

Not: "You have 286 recipe warnings."
Yes: "There's a yield issue on Arrabbiata. Fix it now? [ Yes ] [ Later ]"

**The sous chef knows everything. He only interrupts when the chef must decide.**

---

## What Is Brigade

Kitchen operating system for **Zenos on the Square**, Weatherford TX.
Executive Chef: Max (NOT owner — see BOH_OS_DECISIONS.md for full hierarchy). Key staff: Anto/Antonella (Chef Rover), Tela (Kitchen Operation Coordinator), Cole (Saucier), Samantha (Pastry Chef), David/Colton (Sous Chef sera/mattina).

Not a generic app. Not accounting software.
A digital sous chef for a real working kitchen, in daily production use by the brigade since launch (June 2026).

**The primary object is not a recipe or invoice — it is a decision requiring chef attention.**

---

## Stack (verified live 30/06/2026)

- Vanilla JS modules, no framework
- Supabase (DB, Edge Functions, Realtime, Storage, pg_cron)
- AI: OpenRouter (meta-llama/llama-3.3-70b-instruct primary) — **not Groq LLaMA as this document originally stated**; Groq remains as fallback LLM and as the dedicated Whisper voice transcription engine (`transcribe-audio` function)
- OCR fatture: OpenRouter (google/gemini-2.0-flash-001, PDF diretto) + Google Vision API as secondary OCR (free tier, 1000/month) — verify with Max which is primary today, this document's original Google Vision claim may be outdated
- GitHub Pages deployment → https://1cos.github.io/back-of-house
- Safari/iPhone: requires `maximum-scale=1,user-scalable=no`

**Flutter stack (BOH OS/BIOS):** app gemella, attualmente **in pausa** — non in sviluppo attivo, focus interamente su Brigade. Non assumere che qualsiasi modulo Flutter elencato in versioni precedenti di questo file sia ancora rilevante o sincronizzato con lo schema DB attuale di Brigade.

---

## Supabase

Project ID: `ydqmumpytgrlceuinoqt`
URL: https://ydqmumpytgrlceuinoqt.supabase.co

**Per lo schema completo e verificato delle tabelle reali, vedi BRIGADE_DB_SCHEMA.md — non fidarsi di liste tabelle in questo file, che erano relative a un disegno di schema precedente (`recipe_versions`, `recipe_lines`, `inventory_items`, `vendor_sku_aliases` — nessuna di queste esiste nello schema reale verificato live).**

Edge Functions attive: 28 funzioni — vedi BOH_OS_BACKLOG.md per la lista completa verificata, inclusi i 7 bot del sistema automatico (`bot-price-guard`, `bot-chat-analyst`, `bot-preplist-builder`, `bot-tell-chef-reader`, `bot-food-cost-guard`, `bot-prep-accuracy`, `bot-recipe-guardian`).

RLS note: **50 tabelle hanno Row Level Security disabilitata** (rilevato 30/06/2026) — vedi BRIGADE_DB_SCHEMA.md sezione sicurezza. Non ancora affrontato, richiede sessione dedicata con Max prima di abilitare RLS (rischio di bloccare l'accesso dell'app).

---

## Module Files (HTML/Brigade) — verificato live 30/06/2026

*Lista completa reale, 35 file in `js/` + sottocartella `vendor-parsers/`. La versione precedente di questo documento ne elencava solo 12 e diversi non esistono più con quel nome.*

| Area | File |
|---|---|
| App shell | `index.html`, `app.js`, `init.js` |
| Auth | `auth.js` |
| Invoice pipeline | `invoice.js`, `vendor-parser-ui.js`, `vendor-documents-review.js` |
| Vendor parsers | `vendor-parsers/` → `hardies-invoice.js`, `hardies-order.js`, `hardies-credit.js`, `bek-invoice.js`, `fruge-invoice.js`, `freshpoint-invoice.js`, `index.js`, `utils.js`, `test.js` |
| Ingredienti | `ingredients.js` |
| Ricette | `recipes.js`, `recipe-modal.js` |
| Prep | `prep.js`, `focus-mode.js` |
| Closing | `closing.js` |
| Briefing | `briefing.js` |
| Chat / Tell Chef | `chat.js`, `tell-chef.js` |
| Chef AI | `souschef-chat.js`, `souschef-core.js`, `souschef-scan.js`, `souschef-voice.js`, `souschef-warnings.js` |
| L'Ufficio | `office.js` |
| News / Alerts | `news.js`, `warnings-banner.js` |
| Operation notes | `operation-notes.js` |
| Schedule | `schedule.js`, `calendar.js` |
| Sales / POS | `pos.js` |
| Presence / Push | `presence.js`, `push.js` |
| Admin | `admin.js`, `admin-chef-ai.js`, `admin-ingredients.js`, `admin-prep.js`, `admin-team.js`, `staff-manager.js` |
| Utils | `utils.js` |
| Demo | `demo-bot.js` |

---

## Vendor Parsers — stato verificato 30/06/2026

Parser dedicati esistenti in `js/vendor-parsers/`:
- Hardie's (invoice, order, credit — tre file separati)
- Ben E. Keith (`bek-invoice.js`)
- Frugé (`fruge-invoice.js`)
- FreshPoint Dallas (`freshpoint-invoice.js`) — **questo file esiste**: la nota "known parser gap" della versione precedente di questo documento è probabilmente superata, verificare con Max se FreshPoint funziona correttamente o se il gap riguarda qualcos'altro
- **Mancante:** Global Gourmet Food (fornitore Bresaola) — confermato ancora da costruire, vedi BOH_OS_BACKLOG.md

General parser insufficiente da solo. Serve sempre vendor signature detection.

---

## Core Design Rules (Brigade)

**One Question Rule (OQR) — the mantra:**
Never ask the chef to solve multiple problems at once.
One issue → one suggestion → one confirm → one override option.
Bottom of screen. One tap. Done. Next.

Pattern:
```
[ Problem in one line ]
[ Why it matters in one line ]
[ Suggested solution ]
[ PRIMARY ACTION ]  [ manual override ]
```

HTML: fixed bottom card or bottom sheet.

**Imported data is not confirmed data.**
Never show imported values as truth. Always flag for review.

**No fake defaults.**
Blank > placeholder > invented value. Never save a guessed value silently.

**Unmatched is safer than wrong match.**
Invoice line matching: wrong match poisons costing.

**Complete files only.**
No partial patches. No TODO placeholders.

**Scope discipline.**
Fix only what was asked. Do not refactor adjacent code.

**Chef AI confirmation gate (added since this document's last full rewrite):**
Every DB write triggered by Chef AI requires explicit "Sì Chef" tap before execution — no silent writes, ever. See BOH_OS_DECISIONS.md.
