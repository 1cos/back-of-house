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

| Tabella | Scopo | Righe |
|---|---|---|
| pos_daily_summary | Totali giornalieri (scontrini, fatturato) | 305 |
| pos_sales_by_item | Piatti venduti per giorno | 3.924 |
| pos_modifiers | Modifier totali per giorno (TextModifier) | 712 |
| pos_modifier_by_item | Modifier collegato al piatto padre | 1.167 |
| modifier_config | Whitelist modifier cucina classificati | 86 |
| pos_item_aliases | Mapping alias→canonical per stats produzione | 40 |
| ingredients | Ingredienti con categorie | 400 |
| ingredient_vendors | Prezzi per fornitore | 30+ |
| ingredient_links | Link descrizione fattura -> ingrediente | attivo |
| recipes | Ricette | 182 |
| chef_attention | Topic frequenti Max | 7 |
| invoice_lines | Storico prezzi fatture | 33+ |
| invoice_warnings | Warning fatture | 3 open |
| user_presence | Presenza real-time brigata | attivo |
| messages | Chat brigata | attivo |
| alerts | Alert attivi | attivo |
| briefing | Briefing AI giornaliero | attivo |

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
  - 🔴 To Do — in cima, bordo rosso
  - 🟡 In Progress — mezzo
  - ✅ Done — collassata di default, opaca
- Ogni card: swipe destra = Done, swipe sinistra = In Progress
- Soglia 60% per conferma (mani bagnate)
- Solo ite stazione del cuoco loggato
- Aggiornamento realtime

### Landscape mode — da esplorare
- Quando il telefono è orizzontale, layout cambia automaticamente
- Idea da sviluppare insieme con Max nella prossima sessione
- Possibilità: 3 colonne side-by-side invece di sezioni verticali

### In Service view — da esplorare
- Focus Mode ha due stati: Prep (mattina) e Service (11 AM)
- In Service: comunicazioni rapide, modifiche dal pass, timer piatti
- Transizione automatica alle 11 AM CDT

---

## PRIORITA' ALTA — PROSSIMA SESSIONE

- [ ] **Focus Mode** — costruire in js/prep.js o modulo separato
  - Swipe destra da home
  - 3 sezioni collassabili
  - Card swipe per completare
  - Filtro stazione automatico da user_presence
  - Landscape mode da definire con Max

---

## PRIORITA' MEDIA

- [ ] Foto display TV — upload da Brigade admin → Supabase Storage bucket app/display/
- [ ] Pasta halves sommati nelle statistiche TV usando pos_item_aliases
- [ ] Auto-approve fatture senza warning e ingredienti già linkati
- [ ] Edit Vendor semplificato (5 campi)
- [ ] Warning che riappaiono dopo salvataggio peso OQR
- [ ] Ben E. Keith: testare import dopo fix Apps Script
- [ ] Sales staff — modal porzioni su tap piatto
- [ ] Sous Chef proattivo: scansione automatica ogni ora
- [ ] Guest count: aggiungere a pos_daily_summary quando arriva report TouchBistro

---

## BACKLOG ESISTENTE

- [ ] TripleSeat API (credenziali in attesa da Monica)
- [ ] Digital whiteboard (prep handoffs brigata)
- [ ] Sales anomaly detection (calo/picco >30% vs settimana scorsa)
- [ ] Yes Chef modal (sostituire toast con modal celebrativo)
- [ ] Tela module — da progettare da zero
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

---

## Sessione 2026-06-16 — Kitchen Display + pos_item_aliases

### Kitchen Display (display.html) — v192→v195
- Completato layout KDS professionale tema chiaro per cucina luminosa
- Service timer CDT (Opens in / In service N h left / Closing in N m)
- 4 schermate sales con rotazione 20s (Yesterday/Week/Expected/Best by Category)
- Expected Tonight: fix DOW calculation, escluse date sporche, solo food
- Best by Category: Happy Hours→Antipasti, Kids→Pasta, Sides visibili, Bevande escluse
- Contorni: sommano modifier via pos_item_aliases (Brussels, Rosemary, Spinach, ecc.)
- Categoria Proteins Add-on da modifier (Chicken, Shrimp, Salmon, Scallops, Lobster)
- Auto-scroll Best by Category con etichette italiane (Antipasti, Secondi, Contorni, ecc.)
- Chat brigata realtime (ultimi 5 messaggi) tradotti in inglese via ai-translate literal:true
- Staff chips in header (solo chi è online in user_presence <2 min)
- Realtime: 3 canali (presence-rt, chat-rt, alerts-rt)
- ai-translate v23: aggiunto parametro literal:true per traduzione word-for-word
- Rimosso AI briefing dal footer — solo ticker alert 24px

### pos_item_aliases — creata e popolata
- 40 regole di mapping alias→canonical
- Categorie: protein, side, pasta, appetizer
- Usata per calcolo porzioni e statistiche produzione

### Focus Mode — mockup completato
- Concept approvato da Max
- Landscape mode da esplorare insieme
- In Service view — idea da sviluppare
