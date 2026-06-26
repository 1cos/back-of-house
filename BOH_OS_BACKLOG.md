# BRIGADE — BACKLOG
*Aggiornato: 2026-06-26 — v389*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- **KITCHEN DISPLAY (display.html): SOLO INGLESE** — UI, alert, chat, prep, stazioni, tutto. Mai italiano sul TV. Regola permanente.
- **BRIGADE APP: inglese UI, spagnolo/inglese per la brigata** — traduzione multilingua attiva
- Versione frontend: **v389** — 🟢 **APP IN PRODUZIONE** (brigata attiva)
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
| bot-tell-chef-reader | v5 | 🤖 Lettore Tell Chef — classifica, smista per folder, ciclo vita 7gg, chef_action→chef_reports |
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
- [x] ~~Bottoni non collegati ad azioni reali~~ → Working on it / Done / Ignore implementati (v339)
- [x] ~~Pulizia menu admin~~ → 5 voci dev rimosse, Invoice+Purchases deduplicati (v337)
- [ ] ai_options come azioni eseguibili (add_prep_task, open_prep_station, ecc.) — PRIORITÀ #1
- [ ] office-ai → pg_cron orario (analisi automatica ogni ora)
- [ ] Spostare L'Ufficio nella bottom bar invece dei tre puntini
- [ ] Valutare rimozione bottone Tell Chef dai tre puntini (ora tutto in L'Ufficio)

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

### Sessione 2026-06-26 — Fix brigata attiva (v380→v389)
- **v380**: traduzioni Zuu — greeting, "Tu estación", "Otras estaciones" ora in spagnolo. `app.js` usava stringhe hardcoded inglese invece di `tr()`.
- **v381**: fix Contorni — card mostrava 17 porzioni (solo items diretti), realtà ~57. Aggiunto merge modifier ×0.5 da `modifier_config`. Weekend 06-19/20 verificato.
- **v382**: font globale +1px (body 14→15px). Richiesta staff.
- **v383**: testo traduzione 🌐 in chat 11→13px (+2px).
- **v384/v385**: Tell Chef — guard `_tcSending` anti-doppio invio + dedup history.
- **v386**: Tell Chef redesign come mini-chat — header fisso, bolle messaggi, input fisso in fondo.
- **v387**: Tell Chef colori app (gradiente navy/blue) + chiavi `tr()` IT/EN/ES su tutte le stringhe.
- **v388/v389**: fix bottone fotocamera chat — `applyLang()` sovrascriveva SVG con "Send to team".
- **Android keyboard fix**: Visual Viewport API su `souschef-chat.js` e `tell-chef.js`.
- **DB cleanup**: 160 `chef_reports` del demobot eliminati (prima del 23-06-2026). Rimasti 5 reali.

### Sessione 2026-06-24 — L'Ufficio pulizia e riordino (v337→v342)
- v337→v342: pulizia menu admin, Purchase History unificata, fix Focus Mode, fix Report, fix Riapri
- Tell Chef: bottoni Working/Done/Ignore + salva chef_action nel DB
- office_items: +chef_action, +chef_action_at, +chef_action_by, +report_type, +updated_at
- chef_reports: +chef_action, +chef_action_at, +chef_action_by
- bot-tell-chef-reader v5: from_user=Chef AI, report_type, smistamento folder, ciclo vita 7gg
- getFolderForItem(): PROBLEMA_OPERATIVO+GAP_CHECKLIST→prep, CONTRIBUTO_RICETTA+FEEDBACK_RICETTA→miglioramenti
- Ciclo vita: done>7gg sparisce, working_on_it>7gg→alert rosso, ignored→sparisce subito
- Fix opt.label undefined nei bottoni AI options
- Pianificato: ai_options come azioni eseguibili (prossima sessione)

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



---

## CHEF AI — CATALOGO AZIONI ESEGUIBILI (souschef-chat v25)

*Aggiornato: 2026-06-24 — da espandere sistematicamente*

### Azioni attive in v25

| Azione | Cosa fa |
|---|---|
| `add_prep_task` | Aggiunge voce a prep_tasks di una stazione |
| `remove_prep_task` | Archivia prep task (archived=true) |
| `update_prep_task` | Modifica qty/unit/note di una prep task |
| `add_closing_check` | Aggiunge voce alla closing checklist |
| `remove_closing_check` | Rimuove voce dalla closing checklist |
| `send_brigade_message` | Invia messaggio in chat brigata a nome di Max |
| `update_ingredient_vendor` | Modifica prezzo/pack/conversion fornitore |
| `update_ingredient` | Modifica dati ingrediente |
| `resolve_warning` | Chiude un invoice warning |
| `add_prep_log` | Registra produzione nel prep log |
| `update_recipe_ingredient` | Modifica ingrediente in ricetta (JSONB) |
| `create_office_item` | Crea item in L'Ufficio |
| `block/unblock_ingredient_vendor` | Blocca/sblocca ordini per fornitore specifico |
| `block/unblock_ingredient_all_vendors` | Blocca/sblocca tutti i fornitori di un ingrediente |
| `block/unblock_all_from_vendor` | Blocca/sblocca tutti gli articoli di un fornitore |

### 📋 100 IPOTESI — scenari da supportare con azioni future

*Max ha richiesto di mappare sistematicamente tutti gli scenari che la brigata chiederà a Chef AI. Usare come roadmap per espandere executeAction() nelle prossime sessioni.*

**PREP & PRODUZIONE**
1. "Aggiungi focaccia alla prep list dell'Oven" → `add_prep_task` ✅
2. "Rimuovi focaccia dalla prep list" → `remove_prep_task` ✅
3. "Cambia la quantità di arrabbiata a 3 gallons" → `update_prep_task` ✅
4. "Segna arrabbiata come completata oggi" → `update_prep_task` {done:true}
5. "Metti arrabbiata in need tomorrow" → `update_prep_task` {need_tomorrow:true}
6. "Sposta focaccia da Oven a Pastry" → `update_prep_task` {category:'Pastry Station'}
7. "Clona la prep task arrabbiata anche per Pasta Station" → `add_prep_task` (copia)
8. "Aggiungi nota: 'solo per cena' alla prep task risotto" → `update_prep_task` {note}
9. "Imposta shelf life 3 giorni per la besciamella" → `update_prep_task` {expected_duration_days}
10. "Mostra tutte le prep tasks urgenti di oggi" → query (nessuna modifica)

**CLOSING CHECKS**
11. "Aggiungi check: pulisci la friggitrice alla closing list" → `add_closing_check` ✅
12. "Rimuovi check: controlla livello olio" → `remove_closing_check` ✅
13. "Aggiungi controllo temp frigo alla closing Pasta Station" → `add_closing_check`
14. "Segna tutti i closing check come completati" → da implementare: `mark_all_closing_done`
15. "Quanti closing check mancano stasera?" → query

**RICETTE**
16. "Aggiorna la quantità di burro nella carbonara a 80g" → `update_recipe_ingredient` ✅
17. "Aggiungi un ingrediente alla ricetta arrabbiata" → da implementare: `add_recipe_ingredient`
18. "Rimuovi un ingrediente dalla ricetta" → da implementare: `remove_recipe_ingredient`
19. "Cambia le porzioni base della carbonara a 6" → da implementare: `update_recipe`
20. "Aggiungi un passo al procedimento della pasta fresca" → da implementare: `update_recipe_step`
21. "Crea una nuova ricetta base: Salsa Verde" → da implementare: `create_recipe`
22. "Duplica la ricetta arrabbiata con nome 'Arrabbiata catering'" → da implementare: `clone_recipe`
23. "Aggiorna shelf life della besciamella a 4 giorni" → da implementare: `update_recipe`
24. "Segna la ricetta lobster fettuccine come priorità alta" → da implementare: `update_recipe`
25. "Qual è il costo attuale della carbonara?" → query

**INGREDIENTI & FORNITORI**
26. "Blocca la farina da Hardie's — non voglio più" → `block_ingredient_vendor` ✅
27. "Sblocca la mozzarella da FreshPoint" → `unblock_ingredient_vendor` ✅
28. "Blocca tutto da Global Gourmet" → `block_all_from_vendor` ✅
29. "Aggiorna il prezzo del burro a $4.50/lb" → `update_ingredient_vendor` ✅
30. "Imposta conversion to base 453g per la pancetta" → `update_ingredient_vendor` ✅
31. "Crea un nuovo ingrediente: Nduja calabrese" → da implementare: `create_ingredient`
32. "Aggiungi Hardie's come fornitore per la Nduja" → da implementare: `create_ingredient_vendor`
33. "Cambia categoria della pancetta da Dry Goods a Meat" → `update_ingredient`
34. "Quale ingrediente costa di più questa settimana?" → query
35. "Mostra tutti gli ingredienti senza conversion_to_base" → query (warning scan)

**COMUNICAZIONE & BRIGATA**
36. "Manda in chat: stanotte pulizia a fondo del walk-in" → `send_brigade_message` ✅
37. "Manda alert urgente: mancano i limoni" → da implementare: `create_alert`
38. "Rimuovi l'alert sui limoni" → da implementare: `deactivate_alert`
39. "Pinna il messaggio sulle bistecche in chat" → da implementare: `pin_message`
40. "Manda un messaggio a Cole direttamente" → `send_brigade_message` {channel specifico}

**L'UFFICIO & OFFICE ITEMS**
41. "Crea un item arancione in ufficio: verificare ordine Frugé" → `create_office_item` ✅
42. "Segna come done l'item sulla focaccia in ufficio" → da implementare: `resolve_office_item`
43. "Ignora l'alert sul prezzo del burro" → da implementare: `resolve_office_item`
44. "Quanti item aperti ho in ufficio?" → query
45. "Mostra tutti gli item urgenti (red)" → query

**INVOICE & WARNING**
46. "Chiudi il warning SC-GHOST-001 sulla burrata" → `resolve_warning` ✅
47. "Approva la fattura Hardie's di ieri" → da implementare: `approve_vendor_document`
48. "Quanti warning aperti ci sono?" → query
49. "Mostra i warning di Frugé" → query
50. "Aggiungi conversion to base 2268g per il vitello" → `update_ingredient_vendor` ✅

**VENDITE & ANALISI**
51. "Quante porzioni di lobster fettuccine ieri?" → query (già funziona)
52. "Qual è stato il piatto più venduto questa settimana?" → query
53. "Quanti bills lunedì scorso?" → query (già funziona)
54. "Confronta le vendite di questo mercoledì con il precedente" → query
55. "Qual è la media di bills il sabato?" → query

**SCHEDULING & TURNI**
56. "Chi è in turno domani?" → query shifts_schedule
57. "Aggiungi Cole al turno di sabato mattina" → da implementare: `update_shift` (richiede 7shifts)
58. "Mostra lo schedule della settimana" → query shifts_schedule
59. "Chi lavora alla Pasta Station stasera?" → query
60. "Manda reminder turno a Samantha" → `send_brigade_message`

**EVENTI & CATERING**
61. "Aggiungi evento: cena privata sabato 30 persone" → da implementare: `create_event`
62. "Mostra il prossimo evento catering" → query events
63. "Cambia il guest count dell'evento di sabato a 35" → da implementare: `update_event`
64. "Genera prep extra per l'evento di sabato" → da implementare: `generate_event_prep`
65. "Annulla l'evento di domenica" → da implementare: `update_event` {status:cancelled}

**BRIEFING & REPORT**
66. "Scrivi nel briefing: il risotto di oggi è al tartufo" → da implementare: `update_briefing`
67. "Aggiungi punto al briefing: attenzione allergeni evento" → da implementare: `add_briefing_point`
68. "Genera il briefing di oggi" → da implementare: `trigger_briefing`
69. "Mostra le operation notes di ieri" → query
70. "Quante operation notes questa settimana?" → query

**STAZIONI & CONFIG**
71. "Rinomina Manager Station in Coordinator Station" → da implementare: `rename_station` (tocca prep_tasks)
72. "Aggiungi stazione: Expo Line" → da implementare: `create_station`
73. "Mostra tutte le prep tasks dell'Oven Station" → query
74. "Quante voci ha la Salad Station?" → query
75. "Archivia tutte le prep tasks done di Plating" → da implementare: `bulk_archive_prep`

**USERS & PROFILI**
76. "Cambia la stazione default di Sofia in Plating" → da implementare: `update_user`
77. "Attiva l'account di un nuovo dishwasher" → da implementare: `create_user`
78. "Cambia il PIN di Cole" → da implementare: `update_user` {pin}
79. "Imposta la lingua di Rachel in spagnolo" → da implementare: `update_user` {lang:'es'}
80. "Mostra chi è online adesso" → query user_presence

**ALERTS & ANNUNCI**
81. "Crea alert rosso: no pork tonight" → da implementare: `create_alert`
82. "Disattiva tutti gli alert attivi" → da implementare: `deactivate_all_alerts`
83. "Crea annuncio arancione: nuovo piatto in menu da lunedì" → da implementare: `create_announcement`
84. "Mostra gli alert attivi" → query alerts
85. "Rimuovi l'alert sul forno" → da implementare: `deactivate_alert`

**ORDINI & MAGAZZINO**
86. "Crea ordine Hardie's per lunedì" → da implementare: `create_order`
87. "Aggiungi 5 casi di mozzarella all'ordine di lunedì" → da implementare: `add_order_line`
88. "Controlla se abbiamo abbastanza burro per la settimana" → query (incrocia prep + ingredient_vendors)
89. "Segna ricevuto l'ordine di Frugé" → da implementare: `receive_order`
90. "Mostra gli ordini in attesa" → query incoming_orders

**SICUREZZA & QUALITÀ**
91. "Aggiungi check HACCP: temperatura walk-in ogni mattina" → `add_closing_check`
92. "Registra temperatura walk-in: 38°F" → da implementare: `log_temperature`
93. "Crea alert: controllare date scadenza prodotti freschi" → da implementare: `create_alert`
94. "Mostra tutti i prodotti con shelf life scaduta" → query (incrocia prep_log + expected_duration_days)
95. "Aggiungi nota allergen warning alla ricetta carbonara" → `update_recipe_ingredient` o da implementare: `add_recipe_note`

**MISCELLANEA OPERATIVA**
96. "Qual è il mio schedule questa settimana?" → query shifts_schedule per utente
97. "Aggiungi al wishlist Walmart: carta da forno 18x26" → da implementare: `add_wishlist_item` (modulo futuro)
98. "Quanto abbiamo speso da Hardie's questo mese?" → query ingredient_monthly_spend
99. "Mostra le ultime 5 prep log di Cole" → query prep_log
100. "Resetta tutti i done=false nelle prep tasks di oggi" → da implementare: `reset_daily_prep`

### Priorità implementazione prossime sessioni
- **Alta:** scenari 17-24 (ricette), 31-32 (nuovi ingredienti), 37-38 (alerts), 74-75 (bulk ops)
- **Media:** scenari 61-65 (eventi), 76-80 (users), 81-85 (alerts/annunci)
- **Bassa (richiede integrazioni):** 56-60 (7shifts), 86-90 (ordini completi)

