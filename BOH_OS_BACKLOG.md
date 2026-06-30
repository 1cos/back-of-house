# BRIGADE — BACKLOG
*Aggiornato: 2026-06-30 — v428 — verificato contro Edge Functions, cron job e DB live*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS — BOH OS/BIOS è un'app futura separata in Flutter, non questa)
- Branch: brigade-main (MAI main, MAI brigade-dev — abbandonato)
- **KITCHEN DISPLAY (display.html): SOLO INGLESE** — UI, alert, chat, prep, stazioni, tutto. Mai italiano sul TV. Regola permanente.
- **BRIGADE APP: multilingua IT/EN/ES** — tutte le stringhe via `tr()` in `js/utils.js`
- Versione frontend: **v428** — 🟢 **APP IN PRODUZIONE** (brigata attiva)
- Supabase: ydqmumpytgrlceuinoqt
- Leggi sempre da GitHub brigade-main, MAI da /mnt/project/
- Bump boh-vNN in sw.js ad ogni commit — **ATTENZIONE sessioni parallele**: verifica versione live prima di bumpare, NON da memoria

---

## Edge Functions attive (verificato live 30/06/2026 — 28 funzioni totali)

*Lista precedente in questo file era incompleta. Sotto: tutte le funzioni ACTIVE su Supabase con versione reale.*

| Function | Ver | Scopo |
|---|---|---|
| souschef-chat | v41 | Chat AI — accesso completo DB, SQL query detection, confirmation gate "Sì Chef" |
| souschef-classify | v32 | Scan anomalie |
| souschef-scan | v21 | Scan automatica oraria |
| sc-nightly-brief | v24 | Briefing notturno + traduzioni EN/ES — solo admin |
| generate-briefing | v27 | **Non documentata prima** — generazione briefing, cron giornaliero attivo (vedi sotto) |
| process-invoice | v44 | Parser fatture + chiama bot-price-guard/bot-food-cost-guard |
| gmail-hardies-import | v24 | Import PDF Hardie's da Gmail |
| gmail-vendor-import | v20 | Import fatture fornitori Gmail generico |
| hardies-order-check | v13 | Controllo articoli bloccati in conferme ordine Chef's Warehouse |
| gmail-touchbistro-import | v22 | Import CSV TouchBistro nightly + recalcProductionDaily |
| pos-import | v18 | **Non documentata prima** — import POS (verificare overlap con gmail-touchbistro-import) |
| transcribe-audio | v37 | Whisper voce→testo |
| ai-translate | v39 | Google Translate primario + Groq 70b fallback |
| translate | v32 | **Non documentata prima** — funzione translate separata da ai-translate, verificare se ancora in uso o legacy |
| office-ai | v13 | Analisi AI office_items |
| bot-price-guard | v12 | 🤖 Guardiano Prezzi |
| bot-chat-analyst | v13 | 🤖 Analista Chat |
| bot-preplist-builder | v38 | 🤖 Costruttore Preplist — suggested_qty/suggested_note ogni notte |
| bot-tell-chef-reader | v16 | 🤖 Lettore Tell Chef |
| bot-food-cost-guard | v12 | 🤖 Guardiano Food Cost |
| bot-prep-accuracy | v12 | 🤖 Guardiano Accuratezza Prep |
| bot-recipe-guardian | v12 | 🆕 **Nuovo, non documentato prima** — scansiona ricette vendute (pos_name popolato) e segnala in office_items: BOM vuoto/parziale (<4 righe), serving_unit/serving_qty mancanti, procedure vuota, base_servings mancante. Cron giornaliero attivo. |
| batch-translate-recipes | v12 | 🆕 **Nuova, non documentata prima** — traduzione batch ricette, verificare scopo esatto/se ancora usata |
| tripleseat-sync | v24 | Sync TripleSeat — **codice pronto ma MAI agganciato**: 0 eventi con source='tripleseat' nel DB, last_synced_at sempre NULL. OAuth ancora pending autorizzazione di Monica. |
| sevenshift-sync | v17 | ⚠️ In realtà uno script di **diagnostica/test** (whoami + test endpoint v2), non un importer automatico funzionante |
| sevenshift-explore | v14 | Esplorazione API 7shifts — stesso discorso, non produzione |
| rapid-worker | v28 | **Non documentata prima** — invio push notification (`send-push-universal`), verificare scopo esatto |
| notifications | v33 | CORS fix applicato 30/06 (verify_jwt:false + preflight OPTIONS) — chiamata da operation-notes.js |

**⚠️ Nota 7shifts (corretta 30/06, su conferma di Max):** nonostante esistano `sevenshift-sync`/`sevenshift-explore` e 91 righe sincronizzate in `shifts_schedule` negli ultimi 7 giorni, l'integrazione API diretta **resta un problema/workaround parziale**, non risolta. Il flusso operativo reale è ancora l'import CSV manuale (anchor date da filename) descritto in BRIGADE_DB_SCHEMA.md. Non considerare 7shifts "sbloccato" finché Max non lo conferma esplicitamente.

---

## Cron jobs attivi (verificato live 30/06/2026 — `cron.job`, 8 job totali)

| Job | Schedule (UTC) | Funzione |
|---|---|---|
| daily-reset-prep-tasks | 0 5 * * * (00:00 CDT circa) | Reset giornaliero prep_tasks — **non documentato prima** |
| bot-preplist-builder-nightly | 0 9 * * * (4AM CDT) | bot-preplist-builder |
| generate-briefing-daily | 0 10 * * * (5AM CDT) | generate-briefing — **non documentato prima**, verificare overlap/relazione con sc-nightly-brief |
| bot-recipe-guardian-daily | 0 11 * * * (6AM CDT) | bot-recipe-guardian — **non documentato prima** |
| bot-chat-analyst-daily | 0 8 * * 1-6 (3AM CDT lun-sab) | bot-chat-analyst giornaliero |
| bot-chat-analyst-weekly | 0 8 * * 0 (3AM CDT domenica) | bot-chat-analyst settimanale |
| bot-tell-chef-reader-hourly | 0 * * * * (ogni ora) | bot-tell-chef-reader |
| bot-prep-accuracy-daily | 0 23 * * * (17-18 CDT circa) | bot-prep-accuracy — orario diverso da quanto riportato in versioni precedenti (era indicato 22:30 CDT) |

---

## BOT SYSTEM — stato reale (7 bot attivi, non 6)

Bot specializzati in background via pg_cron + Edge Functions, alimentano L'Ufficio.

| Bot | Trigger | Stato | Note |
|---|---|---|---|
| Bot 1 — Guardiano Prezzi | Dopo ogni import fattura | ✅ v12 attivo | |
| Bot 2 — Analista Chat | Cron giornaliero/settimanale | ✅ v13 attivo | |
| Bot 3 — Costruttore Preplist | Cron 4AM CDT | ✅ v38 attivo | Formato suggested_note ora `color\|testo_it\|testo_en\|testo_es` (v38) — vedi BOH_OS_BACKLOG sessioni recenti per bug noti ancora aperti |
| Bot 4 — Lettore Tell Chef | Cron ogni ora | ✅ v16 attivo | |
| Bot 5 — Guardiano Food Cost | Dopo ogni import fattura | ✅ v12 attivo | Ancora versione impatto $ — non ancora % (richiede selling_price popolato su tutte le ricette) |
| Bot 6 — Guardiano Accuratezza Prep | Cron giornaliero | ✅ v12 attivo | |
| Bot 7 — Recipe Guardian | Cron giornaliero (6AM CDT) | ✅ v12 attivo — 🆕 non era documentato | Scansiona ricette vendute incomplete, scrive in office_items |

---

## Sistema traduzioni — stato

### Motore
- ai-translate v39: Google Translate (primario) → Groq fallback
- Esiste anche una funzione `translate` v32 separata — verificare con Max se è legacy/da rimuovere o ancora in uso attivo da qualche modulo

### Bug UI ancora aperti (da versioni precedenti, mai confermati risolti)
- Long press su messaggio chat non funziona — impossibile copiare testo
- TV realtime — si blocca dopo molti messaggi ravvicinati (loadChat() troppo frequente) — vedi anche TODO display sotto

---

## KITCHEN DISPLAY (display.html)

URL: https://1cos.github.io/back-of-house/display.html — Insignia Fire TV Silk Browser kiosk

### TODO display (stato da riverificare — non confermato in sessioni recenti)
- [ ] Fix realtime TV — payload.new incrementale invece di loadChat() completo
- [ ] Foto slideshow Supabase Storage — backlog "Sistema foto centralizzato" (vedi sotto)
- [ ] Pasta halves sommati nelle stats
- **Bug confermato 30/06:** apertura/chiusura L'Ufficio rompe gli aggiornamenti realtime della chat su display.html — non ancora risolto

---

## TELL CHEF / L'UFFICIO

- Tell Chef: confirmation gate "Sì Chef" attivo su tutte le scritture DB (chiunque sia il bot/azione)
- **Bug confermato 30/06:** bottone "Riapri" in chat de L'Ufficio non funziona
- [ ] ai_options come azioni eseguibili (add_prep_task, open_prep_station, ecc.) — ancora PRIORITÀ alta, non implementato
- [ ] office-ai → verificare se già su cron o solo on-demand
- [ ] Spostare L'Ufficio nella bottom bar invece dei tre puntini — confermato ancora in backlog (vedi sessione recente)
- [ ] Audit e rimozione voci menu admin obsolete: Parser Test, Similarity, Vendor Match, Ingredient Cleanup, Bootstrap

---

## PRIORITÀ ALTA — stato aggiornato 30/06/2026

1. **🔴 Dish Crew Home — Fase 2** — Home semplificata per `user.default_station === 'Dish Crew'`: mostra top bar+alert+prep tasks Dish Crew+compleanni+bottom bar (Home/Chat/Schedule/Tell Chef), nasconde Recipes/Closing/Sales/Operation Notes. Niente Focus Mode per Dish Crew (decisione esplicita). Fase 1 (visibilità stazioni) era già chiusa in v332 — Fase 2 resta da fare, priorità #1 confermata.
2. **🔴 Rinominare stazione "Manager" → "Coordinator"** — ovunque: DB, JS, Focus Mode, Closing. Ancora da fare.
3. **🔴 Bot-preplist-builder — riscrittura testo tono sous-chef** — invece di calcoli grezzi tipo foglio Excel. Bug noti aperti: Caprese seasoning (giorni ripetuti, finestra storica sbagliata), Check Basil Oil (suggested_qty confonde g/kg). Vedi PROMPT_PROSSIMA_SESSIONE.md per dettaglio formato.
4. **🟠 Recipe steps — completare stazioni rimanenti.** Fatto: Oven Station (9/9 ricette). Prossima: Sauté Station (6 ricette: Asparagus, Artichoke Sauce, Butter Spinach, Risotto Base, Salmoriglio, Siciliana — Lemon Cream esclusa, da confermare archiviata). Poi: Finishing Oven, Plating Station (categorizzazione prep_type non ancora toccata).
5. **🟠 Refactor UX bottone "Later" nelle prep card** — richiesta esplicita di Max, sessione dedicata separata (non ancora fatto): eliminare bottone Later, card checklist solo Check, card urgenti Start→In Progress→Done (Done solo dopo tutti gli step), card non urgenti Done diretto come log.
6. **🟠 Focus Mode per closing** — pagina Focus dedicata per i task di chiusura (stazioni applicabili, non Tela/Coordinator) — non ancora implementato.
7. **Bottom bar fluttuante (bug UI)** — in osservazione dopo fix swipe-to-close v428, non confermato del tutto risolto.
8. **Yes Chef modal** — sostituire toast piccolo con sheet grande celebrativa (leggibile su iPhone, emoji, riepilogo item).
9. **🔴 Warning Center — ricostruzione completa da zero** (Aggiornamento 30/06, giudizio esplicito di Max: il modulo attuale non funziona, va ricostruito, non patchato). Distinto dal punto 10 sotto (formato riga articolo), che resta valido come riferimento di formato ma non basta a risolvere il problema di fondo. Prossima sessione dedicata: ripartire ascoltando da Max cosa esattamente non va prima di toccare codice.
10. **Warning format standardizzato** — "Warning [Nome]" + Qty·Pack·Unit Price·Ext editabili, riga "Sous Chef: [math]·[risultato]", nessun giudizio di prezzo — vedi BOH_OS_WARNINGS.md per registro completo. Da considerare solo un tassello del rebuild più ampio al punto 9, non la soluzione completa.
10. **OQR-009 pack weight** — tabella pesi unitari standard (uovo 58g, lime 67g, limone 100g, ecc.) applicata automaticamente, OQR solo per sconosciuti.

---

## PRIORITÀ MEDIA

- [ ] Foto display TV — upload da admin → Supabase Storage
- [ ] Pasta halves sommati nelle stats TV
- [ ] Auto-approve fatture senza warning
- [ ] Guest count da nuovo report TouchBistro
- [ ] Badge sui tre puntini per nuovi Tell Chef
- [ ] Verifica traduzioni Antonella (lang=it)
- [ ] Ben E. Keith: testare import (parser già in piedi secondo memoria sessioni — verificare se test fatto)
- [ ] Briefing AI fix — verificare qualità testo dopo generate-briefing v27, non confermato se ancora "frasi vaghe" come segnalato in passato
- [ ] selling_price su ricette (prerequisito Bot 5 versione %)
- [ ] BOM placeholder dinamici `{item_id}` nei recipe_steps — quantità scalate automaticamente con porzioni invece di hardcoded
- [ ] Centralizzare sistema foto: album unico per ricette, TV, Kitchen Display, rotazione contenuti
- [ ] Kitchen Display multi-screen rotation

---

## BACKLOG

- [ ] **Reorder alerts** — soglie di riordino per item critici (Caesar Dressing, Lobster tail, Ribeye, Porterhouse, Branzino, Salmon, Filets): quando il cuoco segna "finito" o stock sotto soglia → alert a Tela per riordino. **Nota:** ora che `prep_tasks.current_stock` esiste ed è popolato e bot-preplist-builder è costruito, valutare se questo backlog è in parte già coperto o va ancora costruito come flusso separato.
- [ ] TripleSeat — sync pronto (v24) ma non agganciato, OAuth ancora pending Monica
- [ ] SevenShift API — diagnosticato ma non risolto, vedi nota sopra. Pending supporto 7shifts o processo OAuth partnership
- [ ] Apple Watch
- [ ] Apple Intelligence / Siri — nota: questo converge con il futuro "BOH OS/BIOS" in Flutter, applicazione separata da Brigade
- [ ] Sales anomaly detection — parzialmente in carico a Sous Chef proattivo (backlog: scansione automatica anomalie senza essere richiesto)
- [ ] Skill progression brigata
- [ ] Chef Inbox unificato (Tell Chef + Operation Notes + Chef AI) — verificare se L'Ufficio ha già coperto questo bisogno
- [ ] Walmart Wishlist — i ragazzi scrivono da Brigade cosa serve, Max vede e spunta
- [ ] Sales: rimuovere tab "Oggi" (dati solo da TouchBistro nightly, niente vista realtime possibile), aggiungere campo data libera per query storiche, campo ricerca manuale, querying DB dedicato per Sous Chef

---

## CHEF AI — CATALOGO AZIONI ESEGUIBILI

*Sezione "100 IPOTESI scenari futuri" e tabella azioni attive non riverificate in questa sessione di aggiornamento — il contenuto sotto è ereditato dalla versione precedente del file (26/06) e potrebbe non riflettere azioni aggiunte nelle sessioni più recenti. Verificare souschef-chat v41 live (era v25 quando questa lista fu scritta) prima di usarla come riferimento per nuovo sviluppo.*

### Azioni note come attive (verificate fino a v25 — souschef-chat è ora a v41, possibile siano state aggiunte altre azioni)

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
| `update_recipe_ingredient` | Modifica ingrediente in ricetta (JSONB legacy) |
| `create_office_item` | Crea item in L'Ufficio |
| `block/unblock_ingredient_vendor` | Blocca/sblocca ordini per fornitore specifico |
| `block/unblock_ingredient_all_vendors` | Blocca/sblocca tutti i fornitori di un ingrediente |
| `block/unblock_all_from_vendor` | Blocca/sblocca tutti gli articoli di un fornitore |

*(100 scenari ipotetici di roadmap rimossi da questa versione per brevità — restano invariati rispetto alla versione precedente del file, consultare lo storico Git se servono.)*

---

## VENDOR PARSER DA FARE
- **Global Gourmet Food** — fornitore Bresaola (e probabilmente altri salumi). Parser invoice da costruire, stessa architettura degli altri vendor parser.

---

## Log sessioni recenti (29-30 giugno 2026, v389→v428)

*Sintesi — il dettaglio completo di ogni sessione è in PROMPT_PROSSIMA_SESSIONE.md, che resta la fonte primaria per i log sessione-per-sessione. Qui solo i titoli per orientarsi.*

- **v412→v420 (29/6):** flusso prep card riscritto (Start/See Steps/Done, eliminati Later/No Need), wake lock, recipe modal adattiva 4 modalità
- **v396→v426 (29-30/6, sessione parallela bug fixing):** fix CORS notifications, fix Schedule tab Oggi/domenica, refactor UX Later (richiesto, non ancora fatto), fix ricetta Pomodoro Sauce (lattine 3kg), fix crash Tell Chef
- **v424→v425 (29/6, sessione Oven Station):** aggiunta title_it/title_es a recipe_steps, 9 ricette Oven Station completate con steps reali
- **v427 (30/6):** step editor UI per recipe_steps dentro openRecipeEditor (recipes.js) — prima volta che recipe_steps è editabile da UI invece che solo via query dirette
- **v428 (30/6):** nuove ricette contorni (Roasted Cauliflower, Marsala Onions), fix swipe-to-close (Vendor Documents + L'Ufficio)

Per dettagli completi di ciascuna sessione (file modificati, bug specifici, decisioni prese), leggere PROMPT_PROSSIMA_SESSIONE.md.
