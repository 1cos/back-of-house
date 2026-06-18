# BRIGADE — DECISIONS
*Perche abbiamo scelto certe cose. Non ridiscutere senza motivo.*
*Aggiornato: 2026-06-16 — v217*

---

## Naming

| Cosa | Nome corretto |
|---|---|
| App HTML/PWA attuale | **BRIGADE** |
| App Flutter futura con Siri | **BOH OS** (separata, non ancora costruita) |
| Branch deploy | **brigade-main** (MAI main) |
| Versione attuale frontend | **v217** |
| Versione souschef-chat | **v15** |
| Supabase project attivo | ydqmumpytgrlceuinoqt |
| Supabase project vecchio | hykjompnvajjhggrnned — tenere attivo fino a Flutter |

---

## Stack AI

| Componente | Ora |
|---|---|
| LLM principale | OpenRouter -> meta-llama/llama-3.3-70b-instruct |
| OCR fatture | OpenRouter -> google/gemini-2.0-flash-001 (PDF diretto) |
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
- Questo messaggio appare nello sheet prima del textarea

### Trigger doppio
- Il prompt appare sia alle 22:30 CDT via push
- Sia automaticamente 800ms dopo doCloseTurn() — così chi chiude il turno lo vede subito
- Se ha già risposto oggi, non appare una seconda volta (check su operation_notes)

---

## Sous Chef AI — decisioni (2026-06-16)

### Principio fondamentale
IL CODICE PORTA I DATI. IL LLM RAGIONA.
Non filtrare mai. Mandare tutto e lasciare ragionare OpenRouter.

### Il Sous Chef non è un chatbot
È un agente operativo proattivo. La differenza:
- Chatbot: aspetta che tu chieda
- Sous Chef: ti avvisa prima che tu apra la chat

### Pipeline asincrona (DECISIONE ARCHITETTURALE)
- L'AI non interroga mai tabelle grezze al momento della richiesta
- Uno snapshot JSON pre-calcolato ogni notte a 04:00 CDT viene letto istantaneamente
- Il LLM traduce i dati pre-masticati in linguaggio da cucina
- Questo elimina latenza e riduce il consumo di token

### Lingua come segnale di profondità (non solo traduzione)
- users.lang già in DB — usato per tradurre l'interfaccia
- DECISIONE: usare lang + role per cambiare il TIPO di risposta, non solo la lingua
- Max (admin, IT): vuole analisi, numeri, trend
- Cole (cook, EN): vuole solo "cosa faccio adesso"
- Stessa domanda al Sous Chef = risposte radicalmente diverse

### recipe_bom è già il grafo di dipendenze
- Gemini proponeva di costruire un grafo da zero
- recipe_bom con parent_recipe_id / sub_recipe_id / quantity esiste già
- Il Prep Coach può usarlo oggi senza nessuna nuova tabella

### chef_attention come auto-calibrazione
- Ogni domanda alla chat aggiorna ask_count su chef_attention
- Il briefing mattutino deve leggere chef_attention e includere automaticamente
  gli ingredienti/topic con ask_count più alto
- Se "uova" è stato chiesto 7 volte → il prezzo delle uova va sempre nel briefing

---

## Prep redesign — decisione (2026-06-15)

### Swipe gestuale — "Il Tabellone Digitale"
- Ispirazione: foglio plastificato con pennarello che usano i ragazzi
- Zero bottoni visibili — solo lista gigante
- Swipe destra -> Fatta (verde, scende in fondo)
- Swipe sinistra -> In corso (blu, rimane in cima)
- Soglia 60% per conferma (evita falsi positivi mani bagnate)
- Tap nome -> apre ricetta
- Font 22px minimo, leggibile a 1 metro sul tavolo di acciaio
- Pillole stazione invece dei cerchi
- Sessione dedicata richiesta

---

## Warning fatture — DEFINITIVO

Solo due warning validi durante importazione:
1. SC-GHOST-001: ingrediente senza nessun vendor/prezzo nel DB
2. SC-NOLINK-001: ha vendor e prezzo ma manca conversion_to_base (per_case senza peso pack)

SC-PRICE-001 ELIMINATO PER SEMPRE durante importazione.

---

## Review fattura — formato riga articolo (v190)

Warning [Nome Articolo] / OK [Nome Articolo]
Qty [input] . Pack [input] . Unit Price [input] . Ext [input]
Sous Chef: [calcolo pack dal parser] . [$/100g]

- Tutti e 4 i campi modificabili inline
- Ricalcolo automatico con bottone ricorda
- Nessun AI — solo parser + dizionario pesi standard
- _vdrEdits salvati e letti da vdrApprove al momento del save

---

## price_type in ingredient_vendors

Valori: per_case (DEFAULT), per_lb, per_kg, per_oz, per_each

Formula $/100g:
- per_case: (unit_price / conversion_to_base) * 100
- per_lb: (unit_price / 453.592) * 100
- per_kg: (unit_price / 1000) * 100

Carni catchweight (Tomahake Loin, Stew Meat): usare per_lb.

---

## Ingredienti — categorie (2026-06-15)

Produce, Dairy, Meat, Seafood, Dry Goods, Oil & Vinegar,
Spices & Herbs, Beverages & Spirits, Prepared, Bakery, Frozen, Supply

Tutti i 400 ingredienti attivi hanno categoria assegnata.

---

## Microfono (v92+)

- Tap breve: apre chat Sous Chef
- Tap lungo: voce -> Whisper -> souschef-chat

---

## Nightly Brief

- Cron: 0 10 * * * = 10:00 UTC = 5:00 AM CDT
- Edge Function: sc-nightly-brief v5
- Domenica: recap settimana
- PROBLEMA NOTO: prompt genera frasi vaghe invece di dati strutturati — da migliorare

---

## TripleSeat OAuth 2.0 (2026-06-16)

- TripleSeat usa OAuth 2.0 **authorization_code** flow — NON client_credentials
- Serve un Authorize manuale (una sola volta) da parte di Monica (admin TripleSeat)
- Dopo l'Authorize: access_token (2h) + refresh_token (automatico)
- Public API key (`6aaf13...`) = solo per leads/rooms, NON per eventi privati
- OAuth app "MAX" creata su `zottsllc.tripleseat.com/settings/api`
- Secrets Supabase: TRIPLESEAT_CLIENT_ID, TRIPLESEAT_CLIENT_SECRET
- Edge Function: `tripleseat-sync` v4
- Endpoint token: `https://api.tripleseat.com/oauth2/token`
- Endpoint eventi: `https://api.tripleseat.com/v1/events`

---

## Sistema Traduzioni — decisioni (2026-06-17)

### Motore
- Google Cloud Translation API come primario — preciso, consistente, gratuito fino a 500k char/mese
- Groq llama-3.3-70b-versatile come fallback — aggiornato da llama-3.1-8b-instant (troppo inaffidabile)
- Secret Supabase: GOOGLE_TRANSLATE_API_KEY (creata 2026-06-17 su Google Cloud Console, progetto "My First Project")

### Flusso
- Invio messaggio: detect lingua → salva m.lang nel DB
- Ricezione: se m.lang !== user.lang → traduzione → mostra sotto bubble
- Kitchen Display: translateToEn con literal:true → sempre inglese
- Ottimizzazione: se testo già nella lingua target → return immediato senza chiamata translate

### Perché detect sull'invio e non sull'arrivo
- Il detect una sola volta (sull'invio) è più efficiente di N detect (uno per ogni viewer)
- m.lang salvato nel DB è fonte di verità permanente
- L'arrivo usa solo il confronto m.lang vs user.lang → nessun detect aggiuntivo

### Bug Groq confermato e risolto
- llama-3.1-8b-instant traduceva messaggi inglesi in spagnolo invece di inglese
- Causa: modello piccolo con scarso rispetto del targetLang parameter
- Fix: Google Translate come primario elimina il problema alla radice

