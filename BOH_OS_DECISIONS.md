# BRIGADE — DECISIONS
*Perche abbiamo scelto certe cose. Non ridiscutere senza motivo.*
*Aggiornato: 2026-06-30 — v428 — versioni verificate live, contenuto filosofico/architetturale invariato salvo dove indicato*

---

## Naming

| Cosa | Nome corretto |
|---|---|
| App HTML/PWA attuale | **BRIGADE** |
| App Flutter futura con Siri | **BOH OS** / **BIOS** (separata, non ancora costruita — vedi nota sotto) |
| Branch deploy | **brigade-main** (MAI main, MAI brigade-dev — abbandonato) |
| Versione attuale frontend | **v428** |
| Versione souschef-chat | **v41** (era v23 quando scritto questo file — verificare azioni disponibili prima di assumere che la lista in BOH_OS_BACKLOG.md sia ancora completa) |
| Supabase project attivo | ydqmumpytgrlceuinoqt |
| AI in-app | **Chef AI** — MAI "Sous Chef AI" o "Sous Chef" |

**Nota naming BOH OS/BIOS:** entrambi i nomi sono usati per la stessa app futura separata (Flutter + Siri), da non confondere con Brigade. Se il nome ufficiale si stabilizza su uno dei due, aggiornare qui.

---

## Gerarchia cucina Zenos on the Square — DEFINITIVA

*Aggiornamento 30/06: il titolo di Tela è stato chiarito come "Kitchen Operation Coordinator" — il termine "Manager" usato sotto e nel codice (stazione "Manager Station") è legacy e in fase di rinominazione (vedi BOH_OS_BACKLOG.md → "Rinominare stazione Manager → Coordinator"). Finché il rename non è completo in DB/JS, la stazione si chiama ancora "Manager Station" nel sistema — usare "Coordinator" solo nel linguaggio rivolto a Max/brigata, non assumere che sia già cambiato nel codice.*

| Ruolo | Nome | Funzione |
|---|---|---|
| Executive Chef | **Max** | Visione, decisioni, direzione — NON owner/proprietario |
| Chef Rover | **Anto / Antonella** | Occhi di Max in cucina — gira ovunque, riporta a Max |
| Sous Chef sera | **David** | Esegue direttive, gestisce brigata sera |
| Sous Chef mattina | **Colton** | Esegue direttive, gestisce brigata mattina |
| Pastry Chef | **Samantha** | Pasticceria |
| Kitchen Operation Coordinator | **Tela** | Operations, gestione logistica, prep tasks — NON sous chef, NON chiude (closing) |
| Saucier | **Cole** | Stazione salse |
| Chef de partie | Zuu/Maria Rosa Razo, Rachel/Carolina Baquero, altri | Stazioni fisse (line cook = termine USA informale) |
| Dish Crew | Austin, Jaxon, Arianna, Kelly, Herminia, Jose, Luis, Ronaldo | Lavapiatti — vedi Dish Crew Home Fase 2 in backlog per UI dedicata |

### Flusso di comando
Max → Chef Rover (Anto) → Sous Chef (David/Colton) → Chef de partie

### Chef Rover — perché questo titolo
Il Rover (dal francese "tournant") è il cuoco che non ha stazione fissa ma conosce tutto.
È il ponte tra l'executive chef e la linea — non comanda i sous chef, riporta a Max.
È figura di intelligence operativa, non di comando diretto.

### REGOLE INVIOLABILI per Brigade e Chef AI
- Max = Executive Chef. MAI owner, MAI proprietario.
- Tela = Kitchen Operation Coordinator. MAI sous chef, MAI "Manager" nel linguaggio rivolto a Max (il codice/DB usa ancora "Manager Station" finché il rename non è fatto — vedi nota sopra).
- Il sous chef umano di Max è David (sera) e Colton (mattina).
- Chef AI è il segretario digitale — non è il sous chef.
- "Sous Chef" nell'app si riferisce SOLO a Chef AI come funzione — non come titolo gerarchico.

---

## Chef AI — definizione ufficiale (2026-06-18)

### Cos'è
Chef AI è il **segretario digitale di cucina** di Max.
NON è il sous chef — il sous chef è umano (David/Colton).
NON si chiama "Sous Chef" nell'interfaccia pubblica.

### Cosa fa
- Accesso in **lettura** a tutto: DB, messaggi, email, Tell Chef, fatture, vendite, operazioni
- **Non modifica mai niente** — Max è l'unico che modifica
- Convoglia informazioni nei tre canali giusti

### I tre canali di output

| Canale | Per chi | Contenuto |
|---|---|---|
| **Briefing AI** | Solo Max | Tutto — incluso finanziario, food cost, margini |
| **L'Ufficio** | Solo Max | Tutto — avvisi bot, tell chef classificati, anomalie |
| **Yesterday/Weekly Highlights** | Brigata + Max | Operativo only — porzioni, piatti venduti, ratio pasta/secondi, analisi chat settimana. **MAI soldi, MAI prezzi** |

### I bot e Chef AI
- I bot (**7** ad oggi 30/06/2026 — erano 5 quando scritta questa decisione: Guardiano Prezzi, Analista Chat, Costruttore Preplist, Lettore Tell Chef, Guardiano Food Cost, Guardiano Accuratezza Prep, Recipe Guardian) sono il **mise en place** — esaminano dati, trovano anomalie, le scrivono già strutturate
- Chef AI arriva e trova tutto pronto — non cerca, **legge e interpreta**
- I bot NON pensano — i bot esaminano. Chef AI ragiona su quello che i bot hanno già trovato.
- I bot usano AI internamente solo dove necessario (Bot Chat, Bot Tell Chef) — non consumano token per le matematiche

### Analogia cucina
I commis (bot) fanno il mise en place.
Chef AI arriva e ha tutto pronto per cucinare.
Max assaggia e decide.

---

## Stack AI

| Componente | Ora |
|---|---|
| LLM principale | OpenRouter → meta-llama/llama-3.3-70b-instruct |
| OCR fatture | OpenRouter → google/gemini-2.0-flash-001 (PDF diretto) |
| Voce trascrizione | Groq Whisper (rimane — limite separato) |
| Fallback LLM | Groq se OpenRouter fallisce |
| Chiave OpenRouter | Supabase secrets: OPENROUTER_API_KEY |
| Chiave Groq | Supabase secrets: GROQ_API_KEY |

---

## Closing — decisioni (2026-06-16)

### Modello di accesso stazioni
- **Chiunque può chiudere qualsiasi stazione** — non esiste blocco per ruolo
- La UI suggerisce la stazione di default dell'utente ma non la impone
- Se stasera Max è alla pasta e vuole che Sofia la chiuda, Sofia può farlo
- Domani un'altra persona può chiudere quella stessa stazione

### Orario tab Closing
- Visibile dalle **20:00 alle 02:00 CDT** — `h >= 20 || h < 2`
- Prima delle 20:00 la tab non appare — i ragazzi vedono solo Prep

### _closingStationLock (v195)
- Variabile locale che blocca `station2` al momento del click su "Chiudi Turno"
- Evita che `goCheckStation()` cambi `station2` globalmente durante il flow di chiusura
- Il flow di chiusura usa sempre `_closingStationLock`, mai `station2` direttamente
- Si resetta a null dopo `doCloseTurn()` completato

### Regola chiusura turno
- Non si può chiudere senza aver risposto a TUTTI gli item della stazione selezionata
- Se ci sono item senza risposta appare il popup forgotten con tre opzioni: In stock / Missing / Go Check
- Go Check porta all'item nell'UI ma non sblocca la chiusura — bisogna tornare e rispondere

---

## Night Recap — decisioni (2026-06-16)

### Push motivazionale (non solo operativa)
- Il messaggio push delle 22:30 non è un reminder burocratico
- È un invito professionale — "la tua voce aiuta il team a crescere"
- Testo in 3 lingue (IT/EN/ES) basato su users.lang

### Privacy della nota
- Le note di operation_notes sono visibili SOLO a Max
- Non vengono condivise con altri membri della brigata
- Vengono usate in forma anonima in report o azioni correttive

### Trigger doppio
- Il prompt appare sia alle 22:30 CDT via push
- Sia automaticamente 800ms dopo doCloseTurn()
- Se ha già risposto oggi, non appare una seconda volta

---

## Chef AI (souschef-chat) — decisioni (2026-06-16)

### Principio fondamentale
IL CODICE PORTA I DATI. IL LLM RAGIONA.
Non filtrare mai. Mandare tutto e lasciare ragionare OpenRouter.

### Chef AI non è un chatbot
È un agente operativo proattivo. La differenza:
- Chatbot: aspetta che tu chieda
- Chef AI: ti avvisa prima che tu apra la chat

### Pipeline asincrona (DECISIONE ARCHITETTURALE)
- L'AI non interroga mai tabelle grezze al momento della richiesta
- Uno snapshot JSON pre-calcolato ogni notte a 04:00 CDT viene letto istantaneamente
- Il LLM traduce i dati pre-masticati in linguaggio da cucina
- Questo elimina latenza e riduce il consumo di token

### Lingua come segnale di profondità
- Max (admin, IT): vuole analisi, numeri, trend
- Cole (cook, EN): vuole solo "cosa faccio adesso"
- Stessa domanda = risposte radicalmente diverse per ruolo

### chef_attention come auto-calibrazione
- Ogni domanda alla chat aggiorna ask_count su chef_attention
- Il briefing mattutino deve leggere chef_attention e includere automaticamente
  gli ingredienti/topic con ask_count più alto

---

## Warning fatture — DEFINITIVO

Solo due warning validi durante importazione:
1. SC-GHOST-001: ingrediente senza nessun vendor/prezzo nel DB
2. SC-NOLINK-001: ha vendor e prezzo ma manca conversion_to_base

SC-PRICE-001 ELIMINATO PER SEMPRE durante importazione.

---

## Review fattura — formato riga articolo (v190)

Warning [Nome Articolo] / OK [Nome Articolo]
Qty [input] · Pack [input] · Unit Price [input] · Ext [input]
Sous Chef: [calcolo pack dal parser] · [$/100g]

---

## price_type in ingredient_vendors

Valori: per_case (DEFAULT), per_lb, per_kg, per_oz, per_each

Formula $/100g:
- per_case: (unit_price / conversion_to_base) * 100
- per_lb: (unit_price / 453.592) * 100
- per_kg: (unit_price / 1000) * 100

Carni catchweight: usare per_lb.

---

## Ingredienti — categorie (2026-06-15)

Produce, Dairy, Meat, Seafood, Dry Goods, Oil & Vinegar,
Spices & Herbs, Beverages & Spirits, Prepared, Bakery, Frozen, Supply

---

## Microfono (v92+)

- Tap breve: apre chat Chef AI
- Tap lungo: voce → Whisper → Chef AI

---

## Nightly Brief

- Cron: 0 10 * * * = 10:00 UTC = 5:00 AM CDT
- Edge Function: sc-nightly-brief **v24** (era v12 — verificare se la logica/qualità testo è cambiata sostanzialmente da allora)
- Domenica: recap settimana
- **Da chiarire (30/06):** esiste anche una funzione `generate-briefing` v27 separata con proprio cron giornaliero (10:00 UTC anch'esso) — verificare con Max se è un duplicato/successore di sc-nightly-brief o se hanno scopi diversi, prima di assumere che sc-nightly-brief sia l'unica fonte del briefing

---

## TripleSeat OAuth 2.0 (2026-06-16, stato verificato 30/06)

- OAuth 2.0 authorization_code flow
- Serve Authorize manuale da Monica (admin TripleSeat)
- OAuth app "MAX" creata su zottsllc.tripleseat.com
- Edge Function: tripleseat-sync **v24** (era v4 quando scritta questa decisione — funzione sviluppata/aggiornata molto oltre il punto iniziale, ma resta non agganciata in produzione)
- **PENDING: Monica deve ancora fare Authorize** — confermato 30/06: 0 eventi con source='tripleseat' nel DB, last_synced_at sempre NULL

---

## Sistema Traduzioni — decisioni aggiornate (2026-06-19)

### Architettura (dopo fix ai-translate storm)

**Alerts:**
- Traduzione generata UNA VOLTA alla creazione in `sendNews()`
- Salvata in `alerts.translations = { "it": "...", "en": "...", "es": "..." }`
- `loadNews()` legge dal DB — zero chiamate AI in lettura

**Briefing:**
- `sc-nightly-brief` genera punti in italiano, poi traduce in EN+ES, salva in 4 colonne
- `loadBriefing()` legge colonna giusta per `user.lang` e ruolo — zero chiamate AI in lettura

**Chat messaggi:**
- Invio: detect lingua → salva `lang` — 1 chiamata (corretta)
- Ricezione: se `m.lang !== user.lang` → traduce — 1 chiamata per messaggio (corretta)

**Kitchen Display:**
- `translateToEn` con `literal:true` — chiamata per ogni messaggio nuovo (corretta)

## Sistema Traduzioni — decisioni (2026-06-17)

### Motore
- Google Cloud Translation API come primario
- Groq llama-3.3-70b-versatile come fallback
- Secret: GOOGLE_TRANSLATE_API_KEY

### Flusso
- Invio messaggio: detect lingua → salva m.lang
- Ricezione: se m.lang !== user.lang → traduzione → mostra sotto bubble
- Kitchen Display: translateToEn con literal:true → sempre inglese

---

## Yesterday / Weekly Highlights — decisioni (2026-06-18)

### Cos'è
Tab dedicata visibile a brigata + Max con highlights operativi.

### Regole contenuto
- ✅ Porzioni vendute, piatti top, ratio pasta/secondi
- ✅ Analisi chat settimana (pattern, dinamiche)
- ✅ Prep performance
- ❌ MAI prezzi, MAI food cost, MAI margini, MAI dollari
- ❌ MAI dati finanziari di nessun tipo

### Stato
- Dati disponibili nel DB (pos_production_daily, messages, prep_log)
- UI da costruire — sessione dedicata

