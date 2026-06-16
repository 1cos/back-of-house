# BRIGADE — BACKLOG
*Aggiornato: 2026-06-16 — v195*
*Leggi dopo SPEC e DECISIONS.*

---

## Regole operative

- App: BRIGADE (non BOH OS)
- Branch: brigade-main (MAI main)
- **KITCHEN DISPLAY (display.html): SOLO INGLESE** — UI, alert, chat, prep, stazioni, tutto in inglese. Mai italiano sul TV. Regola permanente.
- **BRIGADE APP: inglese UI, spagnolo/inglese per la brigata** — traduzione multilingua attiva
- Versione frontend: **v195**
- Versione souschef-chat: v15 (Supabase Edge Function)
- Supabase project: ydqmumpytgrlceuinoqt
- Leggi file da GitHub brigade-main, NON da /mnt/project/ (snapshot vecchio)
- Bump boh-vNN in sw.js ad ogni commit

---

## Edge Functions attive (Supabase ydqmumpytgrlceuinoqt)

| Function | Versione | Scopo |
|---|---|---|
| souschef-chat | v15 | Chat AI — accesso completo DB |
| souschef-classify | v17 | Scan anomalie |
| souschef-scan | v4 | Scan automatica oraria lun-sab |
| sc-nightly-brief | v5 | Briefing notturno 5:00 AM CDT |
| process-invoice | v27 | Parser fatture universale OpenRouter |
| gmail-hardies-import | v9 | Import PDF Hardie's |
| gmail-touchbistro-import | v3 | Import 4 CSV TouchBistro ogni notte |
| gmail-vendor-import | v3 | Import fatture fornitori via Gmail |
| transcribe-audio | v22 | Whisper voce->testo |
| ai-translate | v23 | Traduzioni brigata — supporta literal:true |

---

## Tabelle DB — stato completo

| Tabella | Scopo | Note |
|---|---|---|
| pos_daily_summary | Totali giornalieri (scontrini, fatturato) | 305 righe |
| pos_sales_by_item | Piatti venduti per giorno | 3.924 righe |
| pos_modifiers | Modifier totali per giorno (TextModifier) | 712 righe |
| pos_modifier_by_item | Modifier collegato al piatto padre | 1.167 righe |
| modifier_config | Whitelist modifier cucina classificati | 86 righe |
| pos_item_aliases | Mapping alias→canonical per stats produzione | 40 regole |
| ingredients | Ingredienti con categorie | 400 righe |
| ingredient_vendors | Prezzi per fornitore | 30+ righe |
| ingredient_links | Link descrizione fattura -> ingrediente | attivo |
| recipes | Ricette | 182 righe |
| recipes_with_cost | View ricette con costo calcolato | 181 righe |
| recipe_bom | Grafo dipendenze ricette (parent/sub-recipe) | attivo |
| chef_attention | Topic frequenti — ask_count + last_asked | attivo |
| briefing | Snapshot AI giornaliero JSONB | attivo — prompt da migliorare |
| operation_notes | Note servizio serale brigata | attivo — sentiment/tags da popolare |
| sous_chef_tasks | Task assegnati dall'AI | attivo |
| invoice_lines | Storico prezzi fatture | 33+ righe |
| invoice_warnings | Warning fatture | 3 open |
| ingredient_monthly_spend | Storico spesa mensile per ingrediente | attivo — non ancora usato dall'AI |
| v_prep_daily | Vista prep giornaliera | attivo |
| v_prep_weekly | Vista prep settimanale | attivo |
| user_presence | Presenza real-time brigata | attivo |
| messages | Chat brigata | attivo |
| alerts | Alert attivi | attivo |

**NOTA DATI:** Tutti i dati nel DB sono dati di TEST inseriti da Max. L'app non è ancora stata distribuita alla brigata. Nessun dato è produzione reale.

---

## pos_item_aliases — regole produzione Zenos

Tabella creata 2026-06-16. 40 regole. Usata per:
- Sommare modifier ai piatti canonici nelle statistiche
- Calcolare porzioni reali (portion_factor)
- Futura produzione: quanti nidi pasta, quante scallops, ecc.

Categorie: protein / side / pasta / appetizer
Sources: modifier / item / both

Regole chiave:
- Add chicken / Blackened chicken → Chicken, factor 1.0 (porzione intera)
- Add shrimp / Shrimp crispy → Shrimp, factor 1.0
- Salmon filet / Add salmon whole → Salmon fillet, factor 1.0
- Scallops add on → Scallops, 3 pezzi; Scallops (menu) → 4 pezzi
- Lobsters → Lobster tail, factor 1.0 (1 coda intera)
- Burrata → Burrata, 1 pezzo 2oz
- Brussels modifier → Brussel Sprouts, factor 1.0; side → factor 0.5
- Sauteed Spinach modifier → factor 1.0; side → factor 2.0
- Rosemary potato modifier → factor 0.5; side → factor 1.0
- Asparagus / Green Beans modifier → factor 0.5; side → factor 1.0
- Tutti i Kids menu pasta → factor 0.5 (1 nest)
- Add spaghetti half / Add half spaghetti / Add half fettuccine → factor 0.5

---

## Regole produzione pasta Zenos

- Porzione completa = 2 nest (spaghetti O fettuccine)
- Mezza porzione = 1 nest
- Ogni nest = 60-65g dry pasta
- Penne Midnight sauce = Arrabbiata
- Add spaghetti half con Chicken Parm → usa arrabbiata
- Add spaghetti half con Chicken Piccata → usa piccata sauce (solo pasta, niente extra)
- Happy Hour items → sommare alle categorie principali (non mostrare come categoria separata)
- Kids menu → sommare alle categorie principali

---

## bill_count vs guest count

- bill_count in pos_daily_summary = SCONTRINI CHIUSI, non coperti
- Dire sempre "bills" in app e Sous Chef, mai "tavoli" o "coperti"
- I 4 CSV TouchBistro non contengono guest count
- Max ha richiesto report separato a TouchBistro
- Quando arriva: aggiungere guest_count INTEGER a pos_daily_summary

---

## KITCHEN DISPLAY — stato v195

File: display.html in brigade-main root
URL: https://1cos.github.io/back-of-house/display.html
Schermo: Insignia Fire TV (Silk Browser), kiosk mode

### Layout
- Header: orologio CDT · staff chips online · service timer · alert pill
- Sinistra (270px): sales — 4 schermate rotating ogni 20s
- Centro (flex): Today's Prep — 3 colonne per stazione, prime 3 voci + N more
- Destra (250px): Kitchen Chat — ultimi 5 messaggi realtime tradotti EN
- Footer: Alert ticker 24px + realtime

### Sales screens
- A: Yesterday Sales — bills + top food (no bevande)
- B: This Week Top — 7 giorni food only
- C: Expected Tonight — media storica stesso DOW, date sporche escluse (>5000 qty)
- D: Best by Category — Antipasti · Pasta · Secondi · Insalate · Dolci · Contorni · Proteine Add-on

### Realtime channels attivi
- presence-rt → user_presence
- chat-rt → messages (INSERT)
- alerts-rt → alerts (ALL)

### Traduzioni
- Chat e Alert tradotti in inglese via ai-translate (literal:true) prima di mostrare
- Google Translate primario (letterale), Groq fallback con literal prompt

### Categorie escluse dalle stats
- NA Beverages, Mocktail, Lunch, Soup → skip
- Happy Hours → merge in Antipasti/appetizer
- Kids menu → merge in Pasta
- Tea, Water, Coffee, Pepsi, Sprite ecc. → skip per nome

### Contorni — logica
- pos_sales_by_item (Sides) + pos_modifiers filtrati via pos_item_aliases
- Brussels: modifier(1.0) + side(0.5); Spinach: modifier(1.0) + side(2.0); ecc.

### TODO display
- [ ] Foto slideshow via Supabase Storage (upload da Brigade admin)
- [ ] Pasta halves sommati al piatto principale nelle stats

---

## SOUS CHEF AI — visione e stato (sessione 2026-06-16)

### Cosa esiste già nel DB (pronto per il Sous Chef)
- `briefing` — snapshot giornaliero, già attivo ma **prompt vago** (da migliorare)
- `operation_notes` — tabella pronta, zero righe reali, campi sentiment/tags mai popolati
- `chef_attention` — memoria topic frequenti, aggiorna ask_count ad ogni domanda
- `sous_chef_tasks` — task AI con urgency, category, done
- `recipe_bom` — **grafo dipendenze ricette già strutturato** (Gemini voleva costruirlo, esiste già)
- `recipes_with_cost` — view con costo già calcolato
- `v_prep_daily`, `v_prep_weekly` — viste prep già pronte
- `ingredient_monthly_spend` — storico spesa ingredienti (non ancora interrogato dall'AI)

### Architettura concordata
- **Pipeline asincrona** — snapshot JSON pre-calcolato ogni notte, l'AI legge quello non le tabelle grezze
- **Tre livelli di memoria:** episodica (note servizio in operation_notes), semantica (regole operative), contestuale (cosa succede adesso)
- **Lingua come segnale di profondità** — Max vuole analisi, Cole vuole "cosa faccio adesso" — stesso DB, risposta diversa per role + lang
- **`chef_attention` come auto-calibrazione briefing** — se "uova" chiesto 7 volte, appare sempre nel briefing

### Le 10 funzionalità (Livelli)
1. Assistente operativo — ricette, fornitori, prep, personale
2. Analista food cost — prezzi, trend, anomalie fornitori
3. Produzione intelligente — suggerisce batch del giorno basato su storico + eventi
4. Controllo prep — cosa è in ritardo, cosa manca
5. Gestione personale — chi sa fare cosa, coperture (richiede skills JSONB su users)
6. Event readiness — cosa manca per il catering di giovedì
7. Attenzione automatica — ti cerca lui, non aspetta che chiedi (scan già attiva)
8. Fatture intelligenti — parla da sous chef non da sistema
9. TouchBistro brain — top seller, trend, analisi giorno settimana
10. Memoria del ristorante — ricorda decisioni, note, eventi passati

### Le Perle
- **Perla #1 Morning Briefing** — struttura ok (tabella briefing + sc-nightly-brief v5 alle 5AM CDT), **prompt da migliorare urgente** — contenuto attualmente vago
- **Perla #2 Night Recap** — UI scritta in operation-notes.js (v192+), manca **parsing AI post-salvataggio** per estrarre sentiment e tags automaticamente
- **Perla #3 Chef's Radar** — schermata che mostra solo anomalie, non tutto — da costruire
- **Perla #4 Prep Coach** — priorità su tempo rimasto + storico vendite + recipe_bom — da costruire

### Priorità ingegneristica Sous Chef (in ordine)
1. **Migliorare prompt sc-nightly-brief** — ROI massimo, zero nuova infrastruttura
2. **AI parsing post-salvataggio su operation_notes** — dopo salvataggio nota, Groq estrae sentiment + tags (~50 token)
3. **Aggiungere skills JSONB su users** — una riga SQL, sblocca Livello 5 completo
4. **Connettere souschef-chat a recipe_bom e ingredient_monthly_spend** — tabelle esistenti mai usate dall'AI
5. Solo dopo — nuove tabelle o Edge Functions

---

## NIGHT RECAP — stato (sessione 2026-06-16)

### Implementato (v192-v195)
- Push reale via send-push Edge Function alle 22:30 CDT
- Messaggio motivazionale in 3 lingue IT/EN/ES — invoglia a scrivere per crescere professionalmente
- Privacy badge nello sheet — "Solo Max lo vede, usato in forma anonima"
- Quick replies tradotte nelle 3 lingue
- Trigger automatico post-chiusura turno — 800ms dopo doCloseTurn() appare il prompt
- Fix data CDT in updateCloseTurnBtn() — usava UTC, ora usa CDT corretta

### CORS error send-push
- Edge Function send-push blocca richieste da 1cos.github.io per CORS
- Non blocca la chiusura (catch silenzioso) ma genera errore in console
- Da fixare: aggiungere header CORS alla Edge Function send-push

---

## CLOSING — stato e bug (sessione 2026-06-16)

### Comportamento corretto
- Chiunque può chiudere qualsiasi stazione
- La UI suggerisce la stazione di default ma non blocca
- Non si può chiudere il turno senza aver risposto a TUTTI gli item della stazione selezionata
- Closing appare dalle 20:00 alle 02:00 CDT (h >= 20 || h < 2)

### Bug attivo — chiusura stazioni errata
- **_closingStationLock** implementato in v195 — blocca station2 durante il flow
- **Causa identificata:** goCheckStation() sovrascriveva station2 globalmente, rompendo i controlli nel popup forgotten
- **Stato:** fix applicata ma comportamento ancora da verificare con test pulito
- **CORS send-push:** errore in console ma non blocca la chiusura

### Da investigare
- renderS() post-chiusura — se mostra UI sbagliata dopo doCloseTurn()
- Test pulito: rispondere a tutti gli item di una sola stazione e verificare nel DB

---

## FOCUS MODE — spec (v195+)

Nuova modalità per la brigata — accesso con swipe destra dalla home.
Mockup completato 2026-06-16.

### Concept
"Il Tabellone Digitale" — ispirazione al foglio plastificato con pennarello.
Zero rumore. Solo la tua stazione. Gesti naturali.

### Layout (portrait)
- Swipe destra da home → Focus Mode (slide animation)
- Swipe sinistra → torna Brigade
- 3 sezioni collassabili verticali:
  - To Do — in cima, bordo rosso
  - In Progress — mezzo
  - Done — collassata di default, opaca
- Ogni card: swipe destra = Done, swipe sinistra = In Progress
- Soglia 60% per conferma (mani bagnate)
- Solo item stazione del cuoco loggato
- Aggiornamento realtime

### Landscape mode — da esplorare
- Quando il telefono è orizzontale, layout cambia automaticamente
- Possibilità: 3 colonne side-by-side invece di sezioni verticali

### In Service view — da esplorare
- Focus Mode ha due stati: Prep (mattina) e Service (11 AM)
- In Service: comunicazioni rapide, modifiche dal pass, timer piatti
- Transizione automatica alle 11 AM CDT

---

## PRIORITA' ALTA — PROSSIMA SESSIONE

- [ ] **Fix CORS send-push** — aggiungere headers CORS alla Edge Function
- [ ] **Fix closing bug** — verificare _closingStationLock con test pulito, debug renderS() post-chiusura
- [ ] **Migliorare prompt sc-nightly-brief** — dati strutturati reali invece di frasi vaghe
- [ ] **Focus Mode** — costruire in js/prep.js o modulo separato

---

## PRIORITA' MEDIA

- [ ] AI parsing post-salvataggio su operation_notes (sentiment + tags automatici)
- [ ] skills JSONB su users — sblocca Livello 5 Sous Chef
- [ ] Connettere souschef-chat a recipe_bom e ingredient_monthly_spend
- [ ] Foto display TV — upload da Brigade admin → Supabase Storage bucket app/display/
- [ ] Pasta halves sommati nelle statistiche TV usando pos_item_aliases
- [ ] Auto-approve fatture senza warning e ingredienti già linkati
- [ ] Edit Vendor semplificato (5 campi)
- [ ] Ben E. Keith: testare import dopo fix Apps Script
- [ ] Sales staff — modal porzioni su tap piatto
- [ ] Guest count: aggiungere a pos_daily_summary quando arriva report TouchBistro

---

## BACKLOG ESISTENTE

- [ ] TripleSeat API (credenziali in attesa da Monica)
- [ ] Digital whiteboard (prep handoffs brigata)
- [ ] Sales anomaly detection (calo/picco >30% vs settimana scorsa)
- [ ] Yes Chef modal (sostituire toast con modal celebrativo)
- [ ] SevenShift API
- [ ] Apple Watch / Wear OS
- [ ] Apple Intelligence / new Siri integration

---

## Fornitori attivi

| Fornitore | Email import | Label Gmail | Stato |
|---|---|---|---|
| Hardie's | Gmail automatico | hardies-import | attivo |
| Fruge Seafood | system@netyield.com | fruge-import | attivo → gmail-vendor-import |
| Ben E. Keith | iCloud->Gmail forward | bek-import | attivo → gmail-vendor-import |
| Freshpoint | body email | freshpoint-import | attivo |
| Global Gourmet | manuale | — | scan manuale |
| Sysco | manuale | — | scan manuale |
