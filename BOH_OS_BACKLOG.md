# BRIGADE — BACKLOG
*Aggiornato: 2026-06-17 — v218*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- **KITCHEN DISPLAY (display.html): SOLO INGLESE** — UI, alert, chat, prep, stazioni, tutto. Mai italiano sul TV. Regola permanente.
- **BRIGADE APP: inglese UI, spagnolo/inglese per la brigata** — traduzione multilingua attiva
- Versione frontend: **v218**
- Versione souschef-chat: v15
- Supabase: ydqmumpytgrlceuinoqt
- Leggi sempre da GitHub brigade-main, MAI da /mnt/project/
- Bump boh-vNN in sw.js ad ogni commit

---

## Edge Functions attive

| Function | Ver | Scopo |
|---|---|---|
| souschef-chat | v15 | Chat AI — accesso completo DB |
| souschef-classify | v17 | Scan anomalie |
| souschef-scan | v4 | Scan automatica oraria lun-sab |
| sc-nightly-brief | v5 | Briefing notturno 5:00 AM CDT — solo admin |
| process-invoice | v27 | Parser fatture OpenRouter |
| gmail-hardies-import | v9 | Import PDF Hardie's |
| gmail-touchbistro-import | v3 | Import 4 CSV TouchBistro nightly |
| gmail-vendor-import | v3 | Import fatture fornitori Gmail |
| transcribe-audio | v22 | Whisper voce→testo |
| ai-translate | v23 | Traduzioni — supporta literal:true |

---

## Tabelle DB — stato

| Tabella | Scopo | Chi vede |
|---|---|---|
| briefing | Briefing AI mattutino | Solo admin |
| chef_reports | Tell Chef — segnalazioni brigata→Max | Solo admin + Sous Chef |
| operation_notes | Feedback serale post-closing (22:30 CDT) | Solo admin + Sous Chef |
| messages | Chat brigata | Tutti |
| alerts | Alert/news banner | Tutti |
| user_presence | Presenza realtime | Tutti |
| pos_daily_summary | Totali giornalieri | Solo admin |
| pos_sales_by_item | Piatti venduti | Solo admin |
| pos_modifiers | Modifier giornalieri | Solo admin |
| pos_item_aliases | Mapping alias→canonical produzione | Admin + display |
| prep_tasks/log | Prep | Tutti |
| users | Profili | Ognuno il proprio |
| ingredients/recipes | Ricette e ingredienti | Tutti |

---

## Regole produzione pasta Zenos

- Porzione completa = 2 nest (spaghetti O fettuccine)
- Mezza porzione = 1 nest — ogni nest = 60-65g dry
- Penne Midnight = Arrabbiata sauce
- Add spaghetti half con Chicken Parm → arrabbiata
- Add spaghetti half con Chicken Piccata → solo pasta, niente extra sauce
- Happy Hour items → sommare alle categorie principali
- Kids menu → sommare alle categorie principali

---

## bill_count vs guest count

- bill_count = scontrini chiusi (NON coperti)
- Dire sempre "bills" mai "tavoli" o "coperti"
- Guest count: Max ha richiesto report separato a TouchBistro
- Quando arriva: aggiungere guest_count INTEGER a pos_daily_summary

---

## KITCHEN DISPLAY — v202

URL: https://1cos.github.io/back-of-house/display.html
Schermo: Insignia Fire TV Silk Browser kiosk

### Layout
- Header: orologio CDT · staff chips online · service timer · alert pill
- Sinistra (270px): sales 4 schermate × 20s
- Centro: Today's Prep — 3 colonne, prime 3 voci + N more
- Destra: Kitchen Chat — ultimi 5 messaggi realtime EN
- Footer: Alert ticker 24px realtime

### Sales screens
- A: Yesterday — bills + top food
- B: This Week — 7 giorni food only
- C: Expected Tonight — media storica stesso DOW, date sporche escluse
- D: Best by Category — Antipasti · Pasta · Secondi · Insalate · Dolci · Contorni · Proteine

### Categorie stats
- Happy Hours → merge Antipasti; Kids → merge Pasta
- Esclusi: Soup, NA Beverages, Mocktail, Lunch
- Bevande escluse per nome: Tea, Water, Coffee, Pepsi ecc.
- Contorni: sommano modifier via pos_item_aliases
- Proteine Add-on: da pos_modifiers via pos_item_aliases

### Realtime: presence-rt · chat-rt · alerts-rt
### Traduzioni: chat e alert → inglese via ai-translate literal:true

### TODO display
- [ ] Foto slideshow Supabase Storage
- [ ] Pasta halves sommati nelle stats

---

## TELL CHEF — v202 ✅ IMPLEMENTATO

### Cos'è
Canale unidirezionale: cuoco → Max + Sous Chef. Nessun collega lo vede.
Non è conversazione — è segnalazione.

### Implementato
- Bottone "Tell Chef" nella bottom nav (solo staff, non admin)
- Modal: textarea + "Send to Chef →" + tip dettatura iOS nativa
- Tabella: chef_reports (id, user_name, station, message, status, souschef_suggestion)
- Status: new → read → in_progress → done → ignored
- Admin inbox: nei tre puntini → "Tell Chef" → lista chat-style con status buttons

### TODO Tell Chef
- [ ] Sous Chef legge chef_reports e aggiunge suggestion automatica
- [ ] Badge notifica sui tre puntini quando arrivano nuovi report

---

## OPERATION NOTES — esistente ✅

- File: js/operation-notes.js
- Appare alle 22:30 CDT dopo closing (o subito dopo doCloseTurn)
- Tabella: operation_notes (note_date, user_name, note, sentiment, service, tags)
- "Anonimo" = solo Max lo vede, mai condiviso con colleghi
- Al momento tabella vuota (app pre-launch, nessun uso reale)

---

## CHEF INBOX — IN COSTRUZIONE (PRIORITÀ ALTA)

### Concept
Unico inbox admin stile chat dove convergono tutte le voci della brigata.
Accessibile dai tre puntini → "Chef Inbox".

### Layout chat-style
Messaggi in ordine cronologico, colorati per fonte:
- 🤖 **Chef AI** [blu] — analisi, suggerimenti, pattern rilevati
- 📢 **Nome cuoco** [arancio] — Tell Chef (segnalazioni giorno)
- 🌙 **Nome cuoco** [viola] — Operation Note (feedback serale post-closing)

### Regole
- Nome sempre visibile a Max — mai anonimo verso di lui
- Mai visibile ai colleghi — privato verso la brigata
- "Anonimo" = solo Max lo vede
- Resolve chiude ma rimane in archivio (non si cancella mai)
- Keep open = rimane visibile finché Max non decide
- Max può chiedere a Chef AI analisi o azioni su ogni messaggio
- Chef AI può rilevare pattern ("terza volta che Tela segnala pressione")

### Integrazione sc-nightly-brief
- Aggiungere lettura chef_reports (status new/read) al briefing mattutino
- Aggiungere lettura operation_notes ultimi 7 giorni al briefing
- Sezione "From your team" nel briefing con colori per fonte

---

## BRIEFING AI FIX — da fare dopo Chef Inbox

### Problema attuale
Il prompt di sc-nightly-brief genera frasi vaghe e generiche invece di dati concreti.

### Cosa fare
- **2-3 punti chiave** — invece di un muro di testo, mostrare solo i punti più importanti con emoji e numeri reali. Es: "🔴 Salmon +22% vs last week · 🟡 Stew Meat zero prep da 3 giorni · 🔵 52 bills ieri — record del mese"
- **Bottone "View all"** — apre un modal con tutto il briefing completo + chef_reports + operation_notes
- **Connessione al team** — il briefing legge anche chef_reports (Tell Chef non letti) e operation_notes (ultimi 7 giorni) così al mattino Max trova tutto in un posto: vendite + prep + cosa ha scritto la brigata la sera prima

---

## FOCUS MODE — v5 ✅ IMPLEMENTATO

### Spec corretta (aggiornata 2026-06-17)
- **Attivazione automatica:** 8:00 AM → 8:00 PM CDT — nessun swipe, nessuna gesture
- **Sostituisce la home** per tutto lo staff (role != admin) durante quelle ore
- Max (admin) vede sempre Brigade normale
- Al login se sono le 8-20 → Focus Mode diretto, nessuna home

### Cosa fa
- Mostra solo la prep della stazione del cuoco loggato
- Card: DA FARE (rosso) · IN PROGRESS (giallo, con timer) · DONE (blu)
- Bottone START → avvia timer · DONE → logga in prep_log con durata
- Può cambiare stazione (bottone stazioni → sheet)
- Realtime: aggiorna solo il task cambiato in memoria, no re-query
- Clock CDT in header

### File
- js/focus-mode.js v5

---

## PRIORITÀ ALTA — PROSSIME SESSIONI

1. **Chef Inbox** — inbox unificato admin (Tell Chef + Operation Notes + Chef AI) — IN COSTRUZIONE OGGI
2. **Briefing AI fix** — 2-3 punti concreti + View all + lettura chef_reports + operation_notes

---

## PRIORITÀ MEDIA

- [ ] Foto display TV — upload da admin → Supabase Storage
- [ ] Pasta halves sommati nelle stats TV
- [ ] Auto-approve fatture senza warning
- [ ] Guest count da nuovo report TouchBistro
- [ ] Badge sui tre puntini per nuovi Tell Chef
- [ ] Sous Chef suggestion automatica su chef_reports
- [ ] Ben E. Keith: testare import

---

## BACKLOG

- [ ] TripleSeat API (credenziali Monica — Authorize pending)
- [ ] SevenShift API
- [ ] Apple Watch
- [ ] Apple Intelligence / Siri
- [ ] Sales anomaly detection
- [ ] Yes Chef modal
- [ ] Skill progression brigata

---

## Sessione 2026-06-16 — TellChef + Display + pos_item_aliases

### TellChef (v201→v202)
- Tabella chef_reports creata
- js/tell-chef.js — modal user + inbox admin
- Bottone nav staff (non admin)
- Admin inbox nei tre puntini con status buttons
- Fix: rimosso mic custom Groq — usa dettatura iOS nativa
- Fix: SUPABASE vars da globali utils.js

### Kitchen Display
- Service timer CDT corretto
- 4 schermate sales con rotazione
- Best by Category: Happy Hours→Antipasti, Kids→Pasta, Sides visibili
- Contorni sommano modifier via pos_item_aliases
- Categoria Proteins Add-on
- Auto-scroll Best by Category
- Chat realtime tradotta EN
- Staff chips header
- Realtime: presence-rt · chat-rt · alerts-rt
- ai-translate v23 con literal:true
- Rimosso AI briefing dal footer

### pos_item_aliases
- 40 regole mapping alias→canonical
- Categorie: protein, side, pasta, appetizer

---

## Sessione 2026-06-16 — TripleSeat Calendar

### TripleSeat Integration
- OAuth 2.0 app creata su TripleSeat (ZOTS LLC) — app "MAX"
- Client ID + Secret salvati nei Supabase secrets
- Edge Function `tripleseat-sync` v4 — OAuth 2.0 client_credentials flow
- Tabella `events` estesa: contact_name, contact_email, contact_phone, room_name, total_amount, documents JSONB, last_synced_at
- **PENDING:** premere Authorize su TripleSeat (Monica deve farlo) per completare il flow OAuth 2.0 authorization_code

### Calendar Tab (v217)
- js/calendar.js — lista eventi scrollabile solo admin
- section#vkal in index.html — non-fixed, scroll normale
- Filtri: Upcoming / Past / All
- Card evento: data, orario, guests, room, status, link PDF documenti, link TripleSeat
- Bottone ↻ Sync TripleSeat in alto a destra
- Layout: segue topbar + newsBar correttamente

---

## Sessione 2026-06-17 — Aggiornamento stato

- Focus Mode: spec corretta — automatico 8-20 CDT, nessun swipe, già implementato v5
- Briefing AI fix: chiarito — 2-3 punti concreti + View all + connessione chef_reports/operation_notes
- Chef Inbox: confermato priorità alta — costruzione iniziata questa sessione
