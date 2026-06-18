# BRIGADE — BACKLOG
*Aggiornato: 2026-06-17 — v237*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- **KITCHEN DISPLAY (display.html): SOLO INGLESE** — UI, alert, chat, prep, stazioni, tutto. Mai italiano sul TV. Regola permanente.
- **BRIGADE APP: inglese UI, spagnolo/inglese per la brigata** — traduzione multilingua attiva
- Versione frontend: **v237**
- Versione souschef-chat: v21
- ai-translate: **v28** (Google Translate attivo)
- Supabase: ydqmumpytgrlceuinoqt
- Leggi sempre da GitHub brigade-main, MAI da /mnt/project/
- Bump boh-vNN in sw.js ad ogni commit

---

## Edge Functions attive

| Function | Ver | Scopo |
|---|---|---|
| souschef-chat | v21 | Chat AI — accesso completo DB + SQL query detection |
| souschef-classify | v17 | Scan anomalie |
| souschef-scan | v4 | Scan automatica oraria lun-sab |
| sc-nightly-brief | v5 | Briefing notturno 5:00 AM CDT — solo admin |
| process-invoice | v27 | Parser fatture OpenRouter |
| gmail-hardies-import | v9 | Import PDF Hardie's |
| gmail-touchbistro-import | v3 | Import 4 CSV TouchBistro nightly |
| gmail-vendor-import | v3 | Import fatture fornitori Gmail |
| transcribe-audio | v22 | Whisper voce→testo |
| ai-translate | v28 | Google Translate primario + Groq 70b fallback — literal:true supportato |
| office-ai | v1 | Analisi AI office_items |

---

## Sistema traduzioni — stato (aggiornato 2026-06-17)

### Come funziona
- Ogni messaggio chat → al momento dell'invio: detect lingua → salva `lang` in messages.lang
- Al momento della ricezione: se `m.lang !== user.lang` → ai-translate → mostra traduzione sotto bubble
- Kitchen Display: translateToEn con literal:true → tutto in inglese

### Motore
- **GOOGLE_TRANSLATE_API_KEY** impostata nei Supabase secrets ✅ (creata 2026-06-17)
- ai-translate v28: Google Translate (primario) → Groq llama-3.3-70b-versatile (fallback)
- Ottimizzazione: se testo già nella lingua target → nessuna chiamata translate

### Bug UI annotati (sessione grafica)
- BUG UI 1: Bottone "Send to team" (freccia invio) sovrapposto al microfono Sous Chef → impossibile toccare su iPhone
- BUG UI 2: Long press su messaggio chat non funziona — impossibile copiare testo

### Ancora da verificare
- [ ] Antonella (lang=it) riceve traduzione italiana sotto bubble messaggi inglesi
- [ ] TV realtime — si blocca dopo molti messaggi ravvicinati (loadChat() troppo frequente)

---

## Tabelle DB — stato

| Tabella | Scopo | Chi vede |
|---|---|---|
| briefing | Briefing AI mattutino | Solo admin |
| chef_reports | Tell Chef — segnalazioni brigata→Max | Solo admin + Sous Chef |
| operation_notes | Feedback serale post-closing (22:30 CDT) | Solo admin + Sous Chef |
| office_items | Inbox unificato L'Ufficio | Solo admin |
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

### Realtime: presence-rt · chat-rt · alerts-rt
### Traduzioni: chat e alert → inglese via ai-translate v28 literal:true

### TODO display
- [ ] Fix realtime TV — aggiungere solo nuovo messaggio via payload.new invece di loadChat() completo
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

## L'UFFICIO — v235 ✅ IMPLEMENTATO

### Costruito
- office_items tabella DB
- js/office.js — scrivania operativa: Smart Focus, lista red/orange/blue, realtime, badge, Analizza, Letto/Risolto
- Flusso: Tell Chef / Operation Note → office_items → Max analizza → AI suggestion
- office-ai v1 — analisi AI manuale (bottone Analizza)

### TODO L'Ufficio
- [ ] office-ai → pg_cron orario (analisi automatica ogni ora)
- [ ] Smart Office — calendario meeting interni Brigade

---

## PRIORITÀ ALTA — PROSSIME SESSIONI

1. **Fix realtime TV** — loadChat() troppo pesante, aggiungere solo nuovo messaggio via payload
2. **Bug UI chat** — send button sovrapposto al mic, long press copia
3. **Verifica traduzioni Antonella** — lang=it, deve vedere italiano
4. **Audit menu tre puntini** — molte voci non collegate
5. **Demo Bot** — sessione dedicata
6. **office-ai cron orario**

---

## PRIORITÀ MEDIA

- [ ] Foto display TV — upload da admin → Supabase Storage
- [ ] Pasta halves sommati nelle stats TV
- [ ] Auto-approve fatture senza warning
- [ ] Guest count da nuovo report TouchBistro
- [ ] Badge sui tre puntini per nuovi Tell Chef
- [ ] Sous Chef suggestion automatica su chef_reports
- [ ] Ben E. Keith: testare import
- [ ] Briefing AI fix — 2-3 punti concreti + View all + chef_reports + operation_notes

---

## BACKLOG

- [ ] TripleSeat API (credenziali Monica — Authorize pending)
- [ ] SevenShift API
- [ ] Apple Watch
- [ ] Apple Intelligence / Siri
- [ ] Sales anomaly detection
- [ ] Yes Chef modal
- [ ] Skill progression brigata
- [ ] Chef Inbox unificato (Tell Chef + Operation Notes + Chef AI)

---

## Log sessioni

### Sessione 2026-06-17 — Audit Traduzioni + Google Translate
- Identificato bug: Groq traduceva messaggi inglesi in spagnolo (confermato visivamente su TV)
- Causa: GOOGLE_TRANSLATE_API_KEY non impostata → Groq come unico motore → comportamento erratico
- Fix: creata chiave Google Cloud Translation API, aggiunta Supabase secrets
- ai-translate v28 deployata: Google Translate primario, Groq llama-3.3-70b-versatile fallback
- Ottimizzazione: detect prima della traduzione → se già nella lingua target, nessuna chiamata
- Bug UI annotati: send button sovrapposto mic, long press copia non funziona
- Test chat EN→EN ✅, TV EN ✅, bug spagnolo risolto ✅

### Sessione 2026-06-17 — L'Ufficio (v229→v237)
- office_items tabella, office.js, office-ai v1
- sous_chef_tasks eliminata
- Sous Chef SQL v21 — query reali al DB

### Sessione 2026-06-17 — Prep List PDF + Checklist Chiusura
- PDF statico Brigade_PrepList.pdf generato
- Brigata ha compilato schede — dati da inserire in prep_tasks

### Sessione 2026-06-16 — TellChef + Display + pos_item_aliases
- chef_reports tabella + js/tell-chef.js
- Kitchen Display: 4 schermate sales, chat realtime EN, staff chips
- pos_item_aliases: 40 regole mapping

### Sessione 2026-06-16 — TripleSeat Calendar
- OAuth 2.0 app "MAX" creata
- tripleseat-sync v4
- js/calendar.js — lista eventi admin
- PENDING: Monica deve fare Authorize

## Aggiornamento 2026-06-17 — Fine sessione completa (v237→v249)

### Aggiunto
- Demo Bot + Bug Tracker (js/demo-bot.js) — frequenza 1/5/10/15/20m
- is_demo flag su 4 tabelle — reset pulisce tutto in un click
- L'Ufficio: overlay, animazioni Letto/Risolto, Riapri
- Fix prep_log station NOT NULL in demo-bot
- Bottone 1m nel Demo Bot

### Bug aperti
- Realtime L'Ufficio non funziona — richiede chiudi/riapri
- Bottoni L'Ufficio non collegati ad azioni reali

### Decisioni prese
- Bottoni diversi per fonte: Op.Note→Archivia, TellChef→Risolto, AI→Investiga
- "Investiga" deve aprire Sous Chef con contesto precaricato
- "Archivia" chiude silenziosamente, resta in memoria AI


---

## BOT SYSTEM — Da costruire (sessione dedicata)

### Architettura
Bot specializzati che girano in background via pg_cron / Edge Functions.
Alimentano L'Ufficio mentre Max dorme. Non rispondono — osservano e preparano.

| Bot | Trigger | Cosa fa | Output |
|---|---|---|---|
| Bot 1 — Guardiano Prezzi | Dopo ogni import fattura | Confronta prezzi vs media storica ingredient_monthly_spend | Warning 🟠 in office_items con domanda già pronta |
| Bot 2 — Lettore Chat | Orario | Legge messages, cerca ripetizioni keyword in 48h | Warning 🟡/🔴 a Max se pattern rilevato |
| Bot 3 — Costruttore Preplist | Notte 04:00 | Legge vendite storiche DOW + prep_log → calcola quantità | Popola prep_tasks con qty suggerite |
| Bot 4 — Lettore Tell Chef | Orario | Legge chef_reports non letti, genera suggestion AI | Scrive souschef_suggestion su chef_reports |
| Bot 5 — Guardiano Food Cost | Dopo ogni import fattura | Ricalcola food_cost_pct su recipe_bom | Warning 🟠 se ricetta supera soglia Max |

