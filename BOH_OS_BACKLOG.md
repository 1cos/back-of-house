# BOH OS — BACKLOG
*Aggiorna l'ultima riga dopo ogni sessione.*
*Load after SPEC, before coding.*

---

## Current Priority Order

1. FreshPoint Dallas parser (HTML) — vendor parser mancante
2. Gmail → Hardie's auto-import (Edge Function + Gmail API)
3. Inventory section — placeholder stub da costruire
4. Weight unknown residui (Burrata, Whipping Cream, Shredded Mozz) — verificare dopo prima fattura reale
5. Recipe data cleanup (QA warnings)
6. RLS Supabase — obbligatorio prima go-live staff
7. Whiteboard / brigade handoff (HTML)
8. Flutter: Thumb Engine V1 + OQR Engine
9. Flutter: Attention Queue V1
10. Siri AI integration (Flutter, iOS 27 — futuro)

**Regola:** non costruire nuovi moduli finché Recipes, Inventory e Invoice Import non sono stabili.

---

## HTML — Completato Oggi ✅

### Invoice Import pipeline — end-to-end funzionante
- Vendor Parser Test → Continue → Preview → Save → Match → Done → Home
- OQR non blocca più l'import (`vendor-parser-ui.js`)
- Preview modal visibile sopra tutto (z-index:9000, inline style)
- `saveInvoice` fix: `btn.closest('.fixed')` → `_invoicePreviewModal`
- Duplicate invoice modal con "Open Purchase History"
- Success modal con matching ingredienti inline
- Autocomplete datalist dal DB su campo testo manuale
- Price change detection (↑↓ %) con "Accept new price"
- Done → chiude tutti i modal → torna alla home

### Pack format parser
- `9-1/2 GAL` → 9.5 gallons ✅
- `6/4-2OZ` → 6×4×2oz = 1361g ✅
- Item CT/EA non flaggati come "weight unknown" ✅

### Matching ingredienti post-salvataggio
- Fuzzy search nel DB ingredienti (keyword extraction)
- Status: `suggest` (un tap), `new` (campo manuale), `ok`, `price_up`, `price_down`
- Memoria storica via `ingredient_links` — seconda volta è automatico

### DB ingredienti — pulizia completa
- 85 nomi accorpati (olive oil ×18, parmesan ×12, garlic ×12, tomatoes, rosemary, chocolate…)
- 11 typo corretti (Anchovie→Anchovy, Heavu Cream→Heavy Cream, Parslay→Parsley…)
- 34 non-ingredienti taggati `category='Supply'` (C57pst1, Pk5, Co2, Skewers…)
- Tutte le ricette aggiornate con nomi canonici
- Lingua: tutto in inglese

---

## HTML — Blockers Attivi

### FreshPoint Dallas parser
- Vendor signature detection su raw text: `/freshpoint/i`
- Parser specifico da costruire (formato diverso da Hardie's)
- Già presente nel router `buildVendorParsers()` ma ritorna `NO_PARSER`

### Gmail → Hardie's auto-import
- Email PDF allegato → Edge Function → parser → Vendor Review
- Richiede: Gmail API credentials, Supabase Edge Function
- Max ha Gmail — da configurare nella prossima sessione

### Inventory
- Sezione attualmente placeholder stub
- Units of measure / conversione IT-US (g/kg/lt ↔ lb/oz/gal) parziale
- Categorie ingredienti da completare (oggi: solo 'Supply' aggiunta)

### Weight residui da verificare
- Burrata Belgioioso `6/4-2OZ` → parser fixato, verificare su fattura reale
- Whipping Cream `9-1/2 GAL` → parser fixato, verificare
- Shredded Mozzarella `5#` → dovrebbe funzionare (# → lb)
- Se ancora wrong: debug `calcTotalWeightG` con log su item specifico

---

## Prima del Go-Live — Obbligatorio

- [ ] **RLS Supabase** — tabelle esposte senza autenticazione. Da fare prima di condividere con lo staff.

---

## HTML — In Attesa di Input Esterni

- Touch Bistro CSV → import POS sales (awaiting file)
- TripleSeat API credentials → reservations (awaiting creds)
- Gmail API credentials → Hardie's auto-import (da configurare)

---

## Flutter — Stato Attivo

### Ricette ✅ funzionante
- 182 ricette importate, 183 versioni, 1230 lines, 688 steps
- 286 QA warnings da risolvere
- Yield mismatch, duplicati, porzioni mancanti

### Inventory ✅ funzionante
- ~439 ingredienti attivi (dopo cleanup oggi)
- 157 disattivati (varianti accorpate)
- 34 Supply

### Invoice Import 🔧
- Decimal weight handling
- Vendor alias cleanup
- Duplicate invoice detection

### Production ⬜ non iniziato
### Chef Mode ⬜ non iniziato
### Attention Queue ⬜ in design

---

## Prossima Sessione

**Ultimo task completato:**
Invoice Import pipeline end-to-end + DB ingredienti cleanup + matching post-salvataggio

**Prossimo task:**
1. FreshPoint Dallas parser
2. Gmail → Hardie's auto-import (setup Gmail API)

**Blockers:**
Gmail API credentials da configurare
