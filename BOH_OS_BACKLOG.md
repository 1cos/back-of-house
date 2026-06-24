# BRIGADE — BACKLOG
*Aggiornato: 2026-06-24 — v340*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- **KITCHEN DISPLAY (display.html): SOLO INGLESE** — UI, alert, chat, prep, stazioni, tutto. Mai italiano sul TV. Regola permanente.
- **BRIGADE APP: inglese UI, spagnolo/inglese per la brigata** — traduzione multilingua attiva
- Versione frontend: **v340** — 🟢 **APP IN PRODUZIONE** (brigata attiva)
- souschef-chat: **v24** (confirmation gate "Sì Chef")

- ai-translate: **v28** (Google Translate attivo)
- Supabase: ydqmumpytgrlceuinoqt
- Leggi sempre da GitHub brigade-main, MAI da /mnt/project/
- Bump boh-vNN in sw.js ad ogni commit — **ATTENZIONE sessioni parallele**: verifica versione live prima di bumpare, NON da memoria

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
| gmail-touchbistro-import | v10 | Import 4 CSV TouchBistro nightly + recalcProductionDaily v3 (recipe-based) |
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

### Motore
- **GOOGLE_TRANSLATE_API_KEY** impostata nei Supabase secrets ✅
- ai-translate v28: Google Translate (primario) → Groq llama-3.3-70b-versatile (fallback)
- Ottimizzazione: se testo già nella lingua target → nessuna chiamata translate

### Bug UI annotati
- BUG UI: Long press su messaggio chat non funziona — impossibile copiare testo

### Ancora da verificare
- [ ] Antonella (lang=it) riceve traduzione italiana sotto bubble messaggi inglesi
- [ ] TV realtime — si blocca dopo molti messaggi ravvicinati (loadChat() troppo frequente)

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

### TODO display
- [ ] Fix realtime TV — aggiungere solo nuovo messaggio via payload.new invece di loadChat() completo
- [ ] Foto slideshow Supabase Storage
- [ ] Pasta halves sommati nelle stats

---

## TELL CHEF — ✅ IMPLEMENTATO

### TODO Tell Chef
- [ ] Fase 2 Bot 4: esecuzione automatica (aggiungi a ricetta, aggiungi a prep_tasks)
- [ ] Badge notifica sui tre puntini quando arrivano nuovi report

---

## L'UFFICIO — ✅ IMPLEMENTATO

### TODO L'Ufficio
- [ ] 🔴 Bottoni non collegati ad azioni reali — sessione dedicata urgente
- [ ] office-ai → pg_cron orario (analisi automatica ogni ora)
- [ ] Spostare L'Ufficio nella bottom bar invece dei tre puntini
- [ ] Pulizia menu admin: Parser Test, Similarity, Vendor Match, Ingredient Cleanup, Bootstrap → verificare e rimuovere obsoleti

---

## PRIORITÀ ALTA — PROSSIME SESSIONI

1. **🔴 Cleaning Checklist (nuovo modulo)** — pulizie fine shift, separato da closing prep tasks. Tabelle: `cleaning_tasks`, `cleaning_log`. Flusso: dopo operation note → cleaning → chiudi shift → notifica. Riallineare stazioni prima.
2. **🔴 Riallineamento stazioni** — Expo Line e Grill non esistono nel DB. Manager → Coordinator. Allineare con realtà cucina prima di Cleaning Checklist.
3. **🔴 Home dedicata Dish Crew (Fase 2)** — layout semplificato per dishwasher. Detect: `user.default_station === 'Dish Crew'`. Nascondere Recipes, Closing, Sales, Ingredienti, Focus Mode. Bottom bar: Home/Chat/Schedule/Tell Chef. Fase 1 (visibilità stazioni) chiusa in v332.
4. **🟠 Smart UI prep con suggested_qty** — preview ricetta + prep card con quantità Bot 3 e scaler.
5. **🟠 Bottoni L'Ufficio** — sessione dedicata urgente
6. **🟠 Focus Mode test reale** — importare CSV 7shifts e verificare match schedule_name in produzione
7. **🟠 Foto in chat (v340)** — da testare su iPhone (non ancora verificate da Max)
8. **Fix realtime TV** — loadChat() troppo pesante
9. **Bug UI chat** — long press copia
10. **office-ai cron orario**
11. **Bot 4 Fase 2** — esecuzione automatica Tell Chef
12. **Bot 5 versione B** — food cost % quando selling_price popolato

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

- [ ] TripleSeat API (credenziali Monica — Authorize ancora in attesa)
- [ ] SevenShift API (JWT token bloccato)
- [ ] Apple Watch
- [ ] Apple Intelligence / Siri
- [ ] Sales anomaly detection
- [ ] Yes Chef modal — sostituire toast con modal grande e celebrativo
- [ ] Sistema foto centralizzato — album unico usato da ricette, TV, Kitchen Display
- [ ] Skill progression brigata
- [ ] Chef Inbox unificato (Tell Chef + Operation Notes + Chef AI)
- [ ] Walmart Wishlist — i ragazzi scrivono da Brigade cosa serve, Max vede e spunta

---

## Log sessioni

### Sessione 2026-06-24 — Bug fix post-lancio + Cleaning Checklist (teoria) (v336→v340)
- **App in produzione** — brigata attiva dal 2026-06-24 🟢
- v336→v340: bug fix post-lancio segnalati dai ragazzi (bottoni L'Ufficio, bottoni Tell Chef, fix PIN/login)
- **Backup:** brigade-main → main mergiato (v340)
- **Pianificato nuovo modulo:** Cleaning Checklist (pulizie fine shift) — architettura definita, non ancora implementato
- Flusso: Closing Prep → Operation Note → Cleaning Checklist → Chiudi Shift → notifica Max+David
- Tabelle necessarie: `cleaning_tasks`, `cleaning_log`
- Stazioni da allineare prima dell'implementazione

### Sessione 2026-06-24 — Aggiornamento MD (v335)
- Aggiornati tutti i file MD per allineare a v335
- Verificato stato utenti: PIN assegnati a tutti i 10 nuovi utenti ✅
- Foto in chat (v335) non ancora testate da Max su iPhone
- TripleSeat ancora in attesa Monica
- Focus Mode match schedule_name ancora solo teoria (nessun CSV reale importato post-23-giugno)

### Sessione 2026-06-23 — Focus Mode definitiva + Dish Crew Foundation + Traduzioni + Onboarding (v329→v335)
- **v329**: fix bug bypass Focus Mode via Schedule. Nuovo `focusOpenSchedule()` overlay z-index:70
- **v330**: Focus Mode regole turno definitive. Match esatto `users.schedule_name`. Finestra esatta turno. is_closing=true → mezzanotte. NO fallback 8-20. + drag&drop sort_order ingredienti BOM
- **v331**: upload foto libreria ricette + tasto elimina ricetta
- **v332**: nuova stazione "Dish Crew" in init.js. Visibilità: admin tutto, staff cucina no Dish Crew, Dish Crew solo Dish Crew. + traduzioni ricette TR() IT/EN/ES
- **v333**: fix stringhe hardcoded UI ricette (prepEvery, botSuggestion, ecc.)
- **v334**: tab Schedule visibile a tutti (era nascosto per staff)
- **v335**: foto in chat (upload rullino, preview fullscreen, image_url in DB) + slideshow onboarding EN/ES liquid glass 13 slide
- **DB**: colonna `users.schedule_name` creata e popolata per tutti. 10 nuovi utenti attivati con PIN.

### Sessione 2026-06-21 — POS Pipeline + Produzione + BOM Audit (v302)
- gmail-touchbistro-import v10: recalcProductionDaily v3
- pos.js v302: Kids menu sommato a Pasta nella staff view
- recipes: aggiunte colonne serving_unit e serving_qty
- Audit BOM completo: 32 ricette OK, 25 parziali, 3 vuote

### Sessione 2026-06-19 — Fix ai-translate storm + Fruge Parser + No Need + Bot 6 (v266-v276)
- alerts.translations JSONB: traduzioni salvate alla creazione
- briefing: 4 colonne tradotte (points_en/es, points_staff_en/es)
- Fruge parser riscritto v1→v5
- Bottone No Need su prep tasks urgenti
- Bot 6 — Guardiano Accuratezza Prep attivo
- Fix TV toggle realtime (settings aggiunta a supabase_realtime publication)
- Fix mic sovrapposto send button

### Sessione 2026-06-18 — Bot System completo (v249)
- Bot 1→6 costruiti e attivi
- Nuove colonne DB: prep_tasks.suggested_qty/suggested_by/suggested_at, chef_reports.report_type
- 4 cron jobs creati

### Sessione 2026-06-17 — L'Ufficio + Traduzioni Google (v229→v237)
- office_items tabella, office.js, office-ai v1
- Google Translate primario attivo

### Sessione 2026-06-16 — TellChef + Display + TripleSeat
- chef_reports tabella + js/tell-chef.js
- Kitchen Display: 4 schermate sales, chat realtime EN
- TripleSeat OAuth app "MAX" creata — PENDING Monica

