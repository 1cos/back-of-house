# PROMPT PROSSIMA SESSIONE — Brigade

## CARICA SUBITO
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Leggi TUTTI i file .md da brigade-main prima di fare qualsiasi cosa
3. Controlla versione live sw.js prima di qualsiasi push
4. Repo: `1cos/back-of-house`, branch `brigade-main` — MAI `brigade-dev`

---

## SESSIONE 28 GIUGNO 2026 — COSA ABBIAMO FATTO

### v392-v393 — Sistema inventario prep (carico/scarico)
- DB: aggiunto `prep_tasks.current_stock` (numeric) e `prep_log.is_suggested_qty` (boolean)
- Frontend prep.js v393: nuovo flusso "Fatto" — modal dose suggerita (verde) vs quantità diversa
- `suggestedSave()` → salva `is_suggested_qty=true` + aggiorna `current_stock`
- `detailSave()` → aggiorna `current_stock` con qty custom
- Card prep: pill stato stock 🟢 Prepara oggi / 🟡 Stock ok · X / 🔴 Quasi finito · X
- Edge Function `gmail-touchbistro-import` v22: aggiunta `depleteStock()` — scarico notturno automatico da POS (solo task con recipe_id + current_stock non null + base_servings presente)

### Inventario fisico
- PDF inventario prep stampabile generato (due colonne per stazione, campo QTY vuoto)
- Logica: current_stock si popola solo dal conteggio fisico reale, mai da seed artificiale

### DB prep_tasks — cleanup e categorizzazione
- Aggiunto campo `prep_type` con check constraint: 'finale' | 'supporto' | 'checklist'
- 5 duplicati archiviati (Rinse Clams, Rinse Mussels, Tempura, Cook Focaccia, Season Focaccia — tutti creati lo stesso secondo il 25 giugno da import batch)
- Categorizzazione automatica applicata:
  - checklist: 41 task (Check X, Refill X, Thaw X, Rinse X, Pull X...)
  - finale: 12 task (recipe_id + pos_name presenti)
  - supporto: 109 task (resto)

### Nuove ricette create e collegate
| Ricetta | pos_name | Note |
|---|---|---|
| Amalfi Salmon | Amalfi Salmon | collegata a Pull Salmon filets |
| Grilled Chicken | Add chicken\|Add Chicken\|Add chicken for number 4\|Blackened chicken | a monte di Cube Grilled Chicken |
| Nutella mix | Nutella | BOM: 500g Nutella + 50g Sunflower Oil, 13 porzioni da 40g, shelf 30gg |
| Berry coulis | Berry Coulis\|Berried and coulis on side\|Raspberry\|Choc raspberry | BOM: 2250g Mix Berries + 1225g Sugar, 56 porzioni da 40g, shelf 7gg, batch fisso |
| Ranch Dressing | ranch\|Ranch | BOM: 3785g Mayo + 3900g Buttermilk + 226g Ranch Powder, 106 porzioni da 74g, shelf 7gg |

### Prep task modificate
- Siciliana in bag → rinominata "Siciliana cartoccio", finale, collegata a ricetta Siciliana, 3 step aggiunti
- Pull Branzino, Sicilian Mix, Thaw Branzino → archiviati
- Pull Salmon filets → supporto, collegato ad Amalfi Salmon
- Cube Grilled Chicken → checklist (dipende da Grilled Chicken a monte)
- Pastori e onions, Shrimp for cocktail, Thaw Shrimp → archiviati
- Chicken Parmesan → finale, collegato a ricetta POS
- Rinse Clams, Rinse Mussels → checklist (reminder operativo, non misurabile)
- Tiramisu → finale, collegato a ricetta POS
- Cheese cake → finale, collegato a ricetta POS
- Balsamic Dressing (id 392) → supporto, collegato a BALSAMIC VINAIGRETTE
- Citronnette (id 389) → supporto, collegata a CITRONETTE
- Caesar Dressing → checklist (si compra già pronto da Ardis/Ben E. Keith)

### pos_item_aliases aggiunti
- Add salmon → portion_factor 1.0 (era 0.5 di default)
- Both / Both on side → 1 Nutella mix + 1 Berry coulis (4 righe)

### Principio chiave stabilito oggi
- `prep_frequency_days` = NULL → decide il bot in base a venduto + shelf life
- `prep_frequency_days` = N → solo se vuoi FORZARE cadenza fissa indipendentemente dal bot
- `shelf_life_days` → il bot non supera mai questa soglia
- Porzione dressing standard = 2.5oz = 74g per tutti

---

## DA FARE NELLA PROSSIMA SESSIONE (PRIORITÀ)

### 1. CLEANUP prep_frequency_days
Eseguire questa query e decidere uno per uno quali tenere e quali azzerare:
```sql
SELECT id, name, category, prep_frequency_days 
FROM prep_tasks 
WHERE prep_frequency_days IS NOT NULL AND archived = false
ORDER BY category, name;
```
Regola: metti NULL su tutto tranne dove c'è una ragione operativa specifica per forzare la cadenza.

### 2. CONTINUARE categorizzazione prep — stazioni da completare
Abbiamo finito: Fresh Pasta, Manager parziale, Oven, Pasta, Pastry, Salad (dressing)
Da fare ancora:
- **Salad Station** — Bruschetta, Caprese seasoning, Pecorino wedge, Roasted Almonds, Shaved Parm, Sliced Mozzarella, Sliced Tomatoes, Spring mix, Romaine, Cantaloupe, Blue Cheese, Goat cheese, Walnuts, Watermelon, Seed mix
- **Saucier Station** — Arrabbiata, Bechamel, Brisket, Cacio e pepe, Demi, Mash Potato, Mushrooms, Pomodoro, Ragu, Soffritto Livornese, Texana Soup, Truffle butter
- **Saute Station** — Artichoke Sauce, Asparagus, Butter Spinach, Lemon cream, Lemon sliced, Risotto Base, Salmon aioli, Salmoriglio, Scallops, Sicilian mix (archiviata)
- **Table Side** — Filets, NY Strip, Ribeye, Tomahawk, Wagyu ribeye
- **Manager Station** — Arugola, Basil, Basil flowers, Confit tomatoes, Beef salt, Rosemary, Sage, Spinach, Tarragon, Thyme
- **Fresh Pasta** — Grated Pecorino, Maccheroni, Parmesan Grated

### 3. OBIETTIVO FINALE prep
Per ogni prep task attiva (162 totali):
- `prep_type` assegnato (finale/supporto/checklist) ✅ già fatto
- `recipe_id` collegato dove applicabile
- Ricetta con `base_servings` + `serving_weight_g` corretto
- BOM con ingredienti reali
- `shelf_life_days` impostato
- `pos_name` su tutte le ricette finale/supporto per il calcolo bot

### 4. Caesar dressing
Verificare quale fornitore (Ardis o Ben E. Keith) e aggiungere come ingrediente in ingredient_vendors

### 5. Aggiornare PROMPT_SUGGESTED_QTY.md
Il bot-preplist-builder deve essere riscritto per usare il nuovo paradigma:
- Legge `current_stock` invece di `need_tomorrow`
- Considera `shelf_life_days` per capire quando rifarlo
- Usa `prep_type` per trattare diversamente finale/supporto/checklist
- Output: "prepara X oggi (stock esaurito)" vs "prepara tra N giorni (stock ancora ok)"

---

## STATO VERSIONI
- Brigade: **v393**
- Edge Function gmail-touchbistro-import: **v22**
- Supabase project: `ydqmumpytgrlceuinoqt`
