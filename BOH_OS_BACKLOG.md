# BRIGADE — BACKLOG
*Aggiornato: 2026-06-19 — v276*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- **KITCHEN DISPLAY (display.html): SOLO INGLESE** — UI, alert, chat, prep, stazioni, tutto. Mai italiano sul TV. Regola permanente.
- **BRIGADE APP: inglese UI, spagnolo/inglese per la brigata** — traduzione multilingua attiva
- Versione frontend: **v276**
- Versione souschef-chat: v23
- ai-translate: **v28** (Google Translate attivo)
- Supabase: ydqmumpytgrlceuinoqt
- Leggi sempre da GitHub brigade-main, MAI da /mnt/project/
- Bump boh-vNN in sw.js ad ogni commit

---

## Edge Functions attive

| Function | Ver | Scopo |
|---|---|---|
| souschef-chat | v23 | Chat AI — accesso completo DB + SQL query detection |
| souschef-classify | v17 | Scan anomalie |
| souschef-scan | v4 | Scan automatica oraria lun-sab |
| sc-nightly-brief | v12 | Briefing notturno 5:00 AM CDT + traduzioni EN/ES — solo admin |
| process-invoice | v29 | Parser fatture OpenRouter + chiama bot-price-guard e bot-food-cost-guard |
| gmail-hardies-import | v9 | Import PDF Hardie's |
| hardies-order-check | v2 | Controllo articoli bloccati in conferme ordine Chef's Warehouse |
| gmail-touchbistro-import | v3 | Import 4 CSV TouchBistro nightly |
| gmail-vendor-import | v3 | Import fatture fornitori Gmail |
| transcribe-audio | v22 | Whisper voce→testo |
| ai-translate | v28 | Google Translate primario + Groq 70b fallback — literal:true supportato |
| office-ai | v1 | Analisi AI office_items |
| bot-price-guard | v1 | 🤖 Guardiano Prezzi — confronta prezzi fattura vs media storica |
| bot-chat-analyst | v2 | 🤖 Analista Chat — analisi notturna AI chat brigata |
| bot-preplist-builder | v1 | 🤖 Costruttore Preplist — suggested_qty automatiche ogni notte |
| bot-tell-chef-reader | v1 | 🤖 Lettore Tell Chef — classifica e genera suggestion AI ogni ora |
| bot-food-cost-guard | v1 | 🤖 Guardiano Food Cost — impatto $ ingredienti su ricette vendute |

---

## BOT SYSTEM — ✅ COSTRUITO (sessione 2026-06-18)

### Architettura
Bot specializzati che girano in background via pg_cron / Edge Functions.
Alimentano L'Ufficio mentre Max dorme. Non rispondono — osservano e preparano.

| Bot | Trigger | Stato | Note |
|---|---|---|---|
| Bot 1 — Guardiano Prezzi | Dopo ogni import fattura | ✅ v1 attivo | Soglia 10%, min 3 storici |
| Bot 2 — Analista Chat | Cron 3AM CDT lun-sab + domenica recap | ✅ v2 attivo | AI legge contesto, non keyword |
| Bot 3 — Costruttore Preplist | Cron 4AM CDT ogni notte | ✅ v1 attivo | 3 sett. storia, +10% buffer |
| Bot 4 — Lettore Tell Chef | Cron ogni ora | ✅ v1 attivo | Fase 1: classificazione + suggestion |
| Bot 5 — Guardiano Food Cost | Dopo ogni import fattura | ✅ v1 attivo (versione A) | Impatto $ — upgrade a % quando selling_price popolato |
| Bot 6 — Guardiano Accuratezza Prep | Cron 17:30 CDT ogni giorno | ✅ v1 attivo | No Need + prep log pomeridiano = identifica chi ha sbagliato |

### Dettagli Bot

**Bot 1 — Guardiano Prezzi**
- Soglia: variazione >10% vs media storica
- Minimo 3 acquisti storici per generare warning
- Output: 🟠 in office_items con opzioni "Accetta nuovo prezzo" / "Indaga con fornitore"

**Bot 2 — Analista Chat**
- Giornaliero: legge ultime 24h, analisi libera AI (non keyword)
- Domenicale: recap 7 giorni — pattern ricorrenti, dinamiche, chi ha brillato
- Salta solo se chat completamente vuota (0 messaggi)
- Output: 🔵 in office_items con analisi in italiano

**Bot 3 — Costruttore Preplist**
- Legge pos_production_daily + prep_log ultimi 3 stessi DOW
- Scrive suggested_qty (separata da qty reale — mai sovrascrive)
- +10% buffer sicurezza, arrotonda al mezzo superiore
- Nuove colonne: prep_tasks.suggested_qty, suggested_by, suggested_at

**Bot 4 — Lettore Tell Chef**
- Classifica ogni report in: CONTRIBUTO_RICETTA / GAP_CHECKLIST / PROBLEMA_OPERATIVO / FEEDBACK_RICETTA / SEGNALE_PERSONALE
- Scrive souschef_suggestion + report_type su chef_reports
- Output in office_items con priorità automatica (🔴/🟠/🔵)
- Nuova colonna: chef_reports.report_type
- **FASE 2 (sessione futura):** esecuzione automatica — aggiungi a ricetta, aggiungi a prep_tasks

**Bot 5 — Guardiano Food Cost (versione A)**
- Versione A: calcola impatto $ sul venduto (non richiede selling_price)
- Soglia: $20/settimana di impatto
- Versione B (futura): food cost % reale quando selling_price popolato nelle ricette
- Output: 🟠/🔴 in office_items con impatto settimanale e mensile

**Bot 6 — Guardiano Accuratezza Prep**
- Gira ogni giorno alle 17:30 CDT (dopo la finestra 14:00-17:00)
- Legge tutti i No Need del giorno (prep_log.unit=no_need)
- Per ogni No Need: cerca se lo stesso item appare in prep_log tra 14:00-17:00
- Se SI: colpevole morning — No Need errato, andava fatto → output orange in office_items
- Se NO: colpevole evening — closing impreciso, non serviva → output blue in office_items
- Zero AI — puro SQL

### Cron jobs attivi
| Job | Schedule | Bot |
|---|---|---|
| bot-chat-analyst-daily | 0 8 * * 1-6 (3AM CDT lun-sab) | Bot 2 giornaliero |
| bot-chat-analyst-weekly | 0 8 * * 0 (3AM CDT domenica) | Bot 2 settimanale |
| bot-preplist-builder-nightly | 0 9 * * * (4AM CDT) | Bot 3 |
| bot-tell-chef-reader-hourly | 0 * * * * (ogni ora) | Bot 4 |
| bot-prep-accuracy-daily | 30 22 * * * (17:30 CDT) | Bot 6 |

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
- ✅ RISOLTO v276: mic Chef AI nascosto quando chat e aperta — showChat() setta scBtn.style.display='none'
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

### Colonne aggiunte (sessione 2026-06-18)
- `prep_tasks.suggested_qty` — quantità suggerita da Bot 3 (non sovrascrive qty reale)
- `prep_tasks.suggested_by` — fonte della suggestion (default: 'bot-preplist-builder')
- `prep_tasks.suggested_at` — timestamp ultimo aggiornamento suggestion
- `chef_reports.report_type` — classificazione AI: CONTRIBUTO_RICETTA / GAP_CHECKLIST / PROBLEMA_OPERATIVO / FEEDBACK_RICETTA / SEGNALE_PERSONALE

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
Canale personale brigata → Max. Non è solo segnalazioni — è contributi ricette, gap checklist, idee, feedback, segnali personali.
Nessun collega lo vede. Non è conversazione — è input diretto a Max.

### Implementato
- Bottone "Tell Chef" nella bottom nav (solo staff, non admin)
- Modal: textarea + "Send to Chef →" + tip dettatura iOS nativa
- Tabella: chef_reports (id, user_name, station, message, status, souschef_suggestion, souschef_at, report_type)
- Status: new → read → in_progress → done → ignored
- Admin inbox: nei tre puntini → "Tell Chef" → lista chat-style con status buttons
- **Bot 4** classifica ogni report automaticamente ogni ora

### TODO Tell Chef
- [ ] Fase 2 Bot 4: esecuzione automatica (aggiungi a ricetta, aggiungi a prep_tasks)
- [ ] Badge notifica sui tre puntini quando arrivano nuovi report

---

## L'UFFICIO — v235 ✅ IMPLEMENTATO

### Costruito
- office_items tabella DB
- js/office.js — scrivania operativa: Smart Focus, lista red/orange/blue, realtime, badge, Analizza, Letto/Risolto
- Flusso: Tell Chef / Operation Note → office_items → Max analizza → AI suggestion
- office-ai v1 — analisi AI manuale (bottone Analizza)
- **5 Bot attivi** alimentano L'Ufficio automaticamente

### TODO L'Ufficio
- ✅ Realtime L'Ufficio — RISOLTO (2026-06-18)
- [ ] 🔴 Bottoni non collegati ad azioni reali — sessione dedicata
- [ ] office-ai → pg_cron orario (analisi automatica ogni ora)
- [ ] Smart Office — calendario meeting interni Brigade
- [ ] Spostare L'Ufficio nella bottom bar invece dei tre puntini
- [ ] Pulizia menu admin: verificare se Parser Test, Similarity, Vendor Match, Ingredient Cleanup, Bootstrap sono ancora usati e rimuovere quelli obsoleti

---

## PRIORITÀ ALTA — PROSSIME SESSIONI

1. **🔴 Bottoni L'Ufficio** — sessione dedicata urgente
2. ✅ **Realtime L'Ufficio** — RISOLTO
3. **Fix realtime TV** — loadChat() troppo pesante
4. **Bug UI chat** — send button sovrapposto al mic, long press copia
5. **Audit menu tre puntini** — molte voci non collegate
6. **office-ai cron orario**
7. **Bot 4 Fase 2** — esecuzione automatica Tell Chef
8. **Bot 5 versione B** — food cost % quando selling_price popolato

---

## PRIORITÀ MEDIA

- [ ] Foto display TV — upload da admin → Supabase Storage
- [ ] Pasta halves sommati nelle stats TV
- [ ] Auto-approve fatture senza warning
- [ ] Guest count da nuovo report TouchBistro
- [ ] Badge sui tre puntini per nuovi Tell Chef
- [ ] Verifica traduzioni Antonella (lang=it)
- [ ] Ben E. Keith: testare import
- [ ] Briefing AI fix — 2-3 punti concreti + View all + chef_reports + operation_notes
- [ ] selling_price su ricette (prerequisito Bot 5 versione B)

---

## BACKLOG

- [ ] TripleSeat API (credenziali Monica — Authorize pending)
- [ ] SevenShift API
- [ ] Apple Watch
- [ ] Apple Intelligence / Siri
- [ ] Sales anomaly detection
- [ ] Yes Chef modal
- [ ] Sistema foto centralizzato — album unico usato da ricette, TV, Kitchen Display; Kitchen Display multi-schermata con rotazione contenuti
- [ ] Skill progression brigata
- [ ] Chef Inbox unificato (Tell Chef + Operation Notes + Chef AI)

---

## Log sessioni





### Sessione 2026-06-19 (e) — Fix mic sovrapposto send button (v276)
- `chat.js`: `showChat()` nasconde `scBtn` all'apertura chat
- Ripristino automatico al cambio tab gia gestito da `app.js`
- Tutti i bug pre-lancio beta risolti

### Sessione 2026-06-19 (d) — Fix TV toggle realtime (v275)
- `settings` aggiunta a `supabase_realtime` publication (era assente — causa root)
- `display.html`: `startSettingsRealtime()` con riconnessione automatica CLOSED/CHANNEL_ERROR
- `display.html`: polling fallback `checkDisplayActive` ogni 30s
- Toggle TV ON/OFF ora agisce in tempo reale anche dopo ore di uptime

### Sessione 2026-06-19 (c) — Fix ai-translate storm (v269-v271)
- **Problema**: ai-translate chiamato ~360 volte/ora da news.js + 5 volte per apertura home da briefing.js
- **Fix news.js**: nuova colonna `alerts.translations JSONB` — traduzione generata una volta alla creazione, letta dal DB
- **Fix briefing.js + sc-nightly-brief v12**: 4 nuove colonne `briefing.points_en/es/staff_en/staff_es` — tradotte alla generazione notturna
- **DB**: `ALTER TABLE alerts ADD COLUMN translations JSONB` + 4 colonne su `briefing`
- Realtime alerts preservato intatto
- chat.js e recipes.js: invariati (chiamate corrette e on-demand)

### Sessione 2026-06-19 — Fruge Parser (v267-v273)
- Fruge parser riscritto da zero (v1->v5) in vendor-parser-ui.js
- Logica: regex riga singola + lookahead per righe spezzate da PDF.js
- 3 tipi pack: LB catchweight, BG/GA peso da descrizione, CA moltiplicazione NxN
- pack_description = peso totale LB per compatibilita con UI Hardies
- Fix vendor-documents-review.js: legge _cost_per_100g, cost_per_lb, total_weight_lb
- **BUG APERTO**: calcoli $/100g nel flusso reale (email->Storage) non sempre corretti
- Priorita: DOPO lancio beta lunedi

### ✅ RISOLTO 2026-06-19 — ai-translate storm
- alerts.translations JSONB: traduzioni salvate al momento creazione alert
- briefing: 4 nuove colonne tradotte (points_en/es, points_staff_en/es)
- sc-nightly-brief v12: traduce in EN+ES alla generazione
- loadNews() e loadBriefing(): zero chiamate ai-translate in lettura

### Sessione 2026-06-19 — No Need + Bot 6 (v266)
- Bottone No Need su prep tasks urgenti (unit=no_need in prep_log)
- Bot 6 — Guardiano Accuratezza Prep (bot-prep-accuracy v1): identifica chi ha sbagliato tra morning e evening crew
- Cron: 17:30 CDT ogni giorno

### Sessione 2026-06-18 — Bot System completo (v249)
- **Bot 1 — Guardiano Prezzi** (bot-price-guard v1): confronta prezzi fattura vs storico, soglia 10%, min 3 acquisti
- **Bot 2 — Analista Chat** (bot-chat-analyst v2): AI legge chat ogni notte, recap settimanale domenica
- **Bot 3 — Costruttore Preplist** (bot-preplist-builder v1): suggested_qty automatiche da POS + prep_log, 3 settimane storia
- **Bot 4 — Lettore Tell Chef** (bot-tell-chef-reader v1): classifica tell chef in 5 tipi, suggestion AI ogni ora
- **Bot 5 — Guardiano Food Cost** (bot-food-cost-guard v1): impatto $ su venduto, versione A senza selling_price
- process-invoice aggiornato a v29: chiama bot-price-guard + bot-food-cost-guard dopo ogni import
- Nuove colonne DB: prep_tasks.suggested_qty/suggested_by/suggested_at, chef_reports.report_type
- 4 cron jobs creati: chat analyst daily/weekly, preplist nightly, tell chef hourly

### Sessione 2026-06-17 — Audit Traduzioni + Google Translate
- Fix bug Groq traduceva EN→ES erroneamente
- ai-translate v28: Google Translate primario, Groq fallback
- Bug UI annotati: send button sovrapposto mic, long press copia

### Sessione 2026-06-17 — L'Ufficio (v229→v237)
- office_items tabella, office.js, office-ai v1
- sous_chef_tasks eliminata
- Sous Chef SQL v21 — query reali al DB

### Sessione 2026-06-17 — Prep List PDF + Checklist Chiusura
- PDF statico Brigade_PrepList.pdf generato

### Sessione 2026-06-16 — TellChef + Display + pos_item_aliases
- chef_reports tabella + js/tell-chef.js
- Kitchen Display: 4 schermate sales, chat realtime EN, staff chips
- pos_item_aliases: 40 regole mapping

### Sessione 2026-06-16 — TripleSeat Calendar
- OAuth 2.0 app "MAX" creata
- tripleseat-sync v4, js/calendar.js
- PENDING: Monica deve fare Authorize

## BACKLOG — Walmart Wishlist

I ragazzi scrivono da Brigade cosa serve da Walmart (come la lavagna magnetica sul frigo).
Max vede la lista e fa l'ordine sul sito Walmart.
- Spazio dedicato da costruire (posizione UI da decidere)
- Solo staff cucina puo aggiungere voci
- Max vede tutto e spunta quello che ha ordinato

