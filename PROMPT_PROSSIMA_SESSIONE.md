# Prompt Prossima Sessione — Brigade

Carica sempre in questo ordine:
1. `PROMPT_PROSSIMA_SESSIONE.md` da brigade-main
2. `BOH_OS_SPEC.md` da brigade-main
3. `BOH_OS_BACKLOG.md` da brigade-main
4. `BOH_OS_DECISIONS.md` da brigade-main
5. `BRIGADE_VISION.md` da brigade-main

---

## Stato attuale — Brigade v108

**Supabase project:** `ydqmumpytgrlceuinoqt`
**Deploy:** `https://1cos.github.io/back-of-house` — branch `brigade-main`
**AI:** OpenRouter → LLaMA 3.3 70B (fallback Groq)

---

## Sessione del 13 giugno 2026 — cosa è stato fatto

### Architettura
- Sessione architettuale completa — documento `BRIGADE_VISION.md` caricato su GitHub
- Visione completa del sistema: ciclo sera→mattina, 5 stazioni, 3 lingue, display cucina, Apple Watch, SevenShift, TripleSeat

### Edge Functions
- `souschef-chat` → **v15** — scrive su tutto il DB (7 azioni: update_ingredient_vendor, update_ingredient, resolve_warning, create_task, complete_task, add_prep_log, update_recipe_ingredient)
- `souschef-scan` → **v1** — AI legge tutto il DB server-side, trova anomalie, scrive in `invoice_warnings` con OQR completo

### Refactor souschef.js → 5 file modulari
- `souschef-core.js` — init, bottone, gesture, toast, badge, tasks
- `souschef-voice.js` — registrazione, Whisper, memoria
- `souschef-scan.js` — chiama Edge Function souschef-scan (50 righe)
- `souschef-warnings.js` — banner, modal questionario, salvataggio zero AI
- `souschef-chat.js` — chat privata, usa Edge Function v15

### Database cleanup
- `ingredients`: da 14 a 9 colonne — eliminate avg_unit_weight_g, unit_volume_ml, purchase_unit, pack_description, name_aliases
- `ingredient_vendors`: da 25 a 15 colonne — eliminate base_cost, conversion_notes, last_total_weight_g, price_per_each (poi riaggiunti), units_per_case, last_ordered, pack_size, pack_unit, unit_weight_g, notes
- `price_per_each` riaggiunta per articoli CT/EA senza peso
- `count_unit` rinominata `measure_type` in ingredients
- Merge duplicati: Tomatoes Confit → Confit Tomatoes, Tomato Plum → Plum Tomatoes
- Correzione Tomahake Loin: era per_case → ora per_lb a $29.05/lb → $6.4044/100g
- Correzione Stew Meat: rimosso conversion_to_base errato (era per_lb)
- Aggiornati pesi standard CT: Avocado, Lemon, Lime, Eggs, Watermelon, Tomato, Blackberry, Edible Flower

### Parser logica price_type
- Regola: `qty × unit_price ≈ extended (±1%)` → per_case, altrimenti → per_lb
- Applicata in `invoice.js` con funzione `detectPriceType()`
- `ingredient_vendors` upsert aggiornato: salva price_type, rimuove purchase_unit/pack_size eliminati

### Nuovo parser FreshPoint
- `js/vendor-parsers/freshpoint-invoice.js` — tutto per_case, conversion_to_base da pack size
- Registrato in `vendor-parsers/index.js`
- Formato: SKU | QtyOrd | QtyShip | Pack | PackSize | Description | UnitPrice | Extended

### vendor-documents-review.js
- Rimossi pack_size, purchase_unit, unit_weight_g, units_per_case da tutti gli upsert/update
- Aggiunto price_type e conversion_to_base nei fields
- **Yes Chef modal** — sostituito toast piccolo con modal grande celebrativo (👨‍🍳 Yes, Chef!, lista articoli, $/100g)

### ingredient_vendors edit form
- Form edit vendor pulito: solo campi esistenti nel DB
- Nuovo campo "Peso Pack (g)" con guida conversione (1lb=453g, 1oz=28g)
- Nuovo campo "Costo per unità ($)" per CT/EA
- Preview live $/100g
- Form "Add Vendor" allineato — supporta multi-vendor per stesso ingrediente

---

## Pendenti / Da fare prossima sessione

### Urgente
- **FreshPoint pack_description null** — gli articoli approvati oggi hanno conversion_to_base e price_per_100g null perché il documento era già parsato con codice vecchio. Aggiornare manualmente o reimportare.
- **Romaine peso** — Max deve pesare una testa di romana e inserire il peso nel DB dall'app

### Backlog priorità alta
- **Warning Center OQR** — il modal warning mostra le opzioni ma sono ancora troppo generiche ("Correggere il prezzo" senza valore concreto). L'AI deve includere i valori esatti nelle opzioni.
- **Scan automatica ogni 30 min** — oggi si lancia solo manualmente con 🔍. Aggiungere interval automatico lato server o trigger periodico.
- **Collegamento checklist sera → preplist mattina** — il passaggio di consegne tra turni non è ancora automatico

### Backlog normale
- Sales: rimuovere pagina "Oggi", aggiungere query per data arbitraria
- TripleSeat integration (credenziali admin da Max)
- Display cucina (TV screen)
- Apple Watch

---

## Regole operative (SEMPRE)

1. **Leggi SEMPRE il file da GitHub prima di modificarlo** — mai dalla memoria o da /mnt/project/
2. **Verifica SHA via API GitHub** — non usare il raw CDN URL che può avere cache
3. **Bumpa sempre sw.js nello stesso push** — mai file separati
4. **Verifica via API dopo ogni push** — `curl api.github.com/repos/.../contents/sw.js` e decodifica base64
5. **Token GitHub:** `[TOKEN_GITHUB — vedi file sicuro]`
6. **Supabase project:** `ydqmumpytgrlceuinoqt`
