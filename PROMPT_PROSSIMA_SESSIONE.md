# PROMPT PROSSIMA SESSIONE — Brigade

## CARICA SUBITO
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Leggi TUTTI i file .md da brigade-main prima di fare qualsiasi cosa
3. Controlla versione live sw.js prima di qualsiasi push
4. Repo: `1cos/back-of-house`, branch `brigade-main` — MAI `brigade-dev`

---

## SESSIONE 28 GIUGNO 2026 (mattina) — v392-v393 — Sistema inventario prep

### Sistema inventario prep (carico/scarico)
- DB: aggiunto `prep_tasks.current_stock` (numeric) e `prep_log.is_suggested_qty` (boolean)
- Frontend prep.js v393: nuovo flusso "Fatto" — modal dose suggerita (verde) vs quantità diversa
- `suggestedSave()` → salva `is_suggested_qty=true` + aggiorna `current_stock`
- `detailSave()` → aggiorna `current_stock` con qty custom
- Card prep: pill stato stock 🟢 Prepara oggi / 🟡 Stock ok · X / 🔴 Quasi finito · X
- Edge Function `gmail-touchbistro-import` v22: aggiunta `depleteStock()` — scarico notturno automatico da POS

### DB prep_tasks — cleanup e categorizzazione iniziale
- Aggiunto campo `prep_type` con check constraint: 'finale' | 'supporto' | 'checklist'
- 5 duplicati archiviati
- Categorizzazione automatica: 41 checklist, 12 finale, 109 supporto

---

## SESSIONE 28 GIUGNO 2026 (pomeriggio) — Categorizzazione prep + Menu audit

### Stazioni completate oggi
**Manager Station:**
- Beef salt, Confit salt, Fish salt, Potato salt, Ribeye salt → checklist (controllo stock, non prep)
- Arugola, Basil, Flowers, Rosemary, Sage, Tarragon, Thyme → checklist (si comprano)
- Basil flowers, Confit tomatoes, Spinach → supporto (da gestire separatamente)
- Salmon filets (id 317), Branzino filets (id 316) → spostati a Table Side

**Saucier Station:**
- Mushrooms (id 449) → supporto, collegato a SLICED MUSHROOM
- Brisket → supporto, collegato a Beef Ravioli
- Mash Potato → supporto (ricetta da creare)
- Preparato per Livornese + Soffritto Livornese → supporto, collegati a Lobster Fettucine
- Texana Soup → finale, collegato a ricetta POS
- Truffle butter → supporto, collegato a Truffle Fettuccine

**Saute Station:**
- Artichoke Sauce → supporto, collegato a ricetta Artichoke Sauce
- Asparagus → finale, collegato a ricetta Asparagus POS
- Butter Spinach → supporto, collegato a BUTTER SPINACH
- Lemon cream → supporto (rimossa dal menu — ricette LEMON CREAM e Lemon cream cold 2020 archiviate)
- Lemon sliced → checklist (taglio limoni giornaliero)
- Risotto Base → supporto, collegato a Risotto Base
- Salmon aioli → supporto (ricetta da inserire prossima sessione)
- Salmoriglio → supporto, collegato a SALMORIGLIO
- Scallops → finale
- Thaw Scallops → checklist

**Table Side:**
- Filet Branzino, Filets, Ny strip, Ribeye, Porterhouse → supporto (trigger fattura/scontrino)
- Tomahawk, Wagyu ribeye → supporto (trigger fattura Hardie's)
- Clean Branzino → checklist ✅

**Nuove ricette create:**
- `Timberland Maccheroni` — pos_name match POS, BOM: 120g Maccheroni fresh pasta + 150g MK-RAGU + 50g SLICED MUSHROOM + 50g Heavy Cream
- `MACCHERONI FRESH PASTA` — 3.5kg impasto, 23 porzioni da 150g, stesso BOM Fettuccine/Spaghetti
- `Porterhouse alla Fiorentina` — pos_name: Chef's Feature|Porterhouse Alla Fiorentina (15 vendite storiche recuperate)
- `48 Hour Texas Wagyu Dino Rib` — piatto nuovo, statistiche da zero
- `TIMBERLAND FETTUCCINE` → archiviata (sostituita da Timberland Maccheroni)

**Prep task Maccheroni (id 412)** collegata a MACCHERONI FRESH PASTA

### Trigger da fattura — architettura decisa
| Fornitore | Prodotto | Prep attivata |
|---|---|---|
| Frugé | Branzino (lb) | Filet Branzino — bordo rosso, in cima |
| Frugé | Salmone (lb) | Salmon filets — bordo rosso, in cima |
| Hardie's | 103 Rib | Portion Tomahawk + Portion Wagyu Ribeye |
| HEB (scontrino manuale) | Filetti / Ribeye / Porterhouse | Portion Filets / Ribeye / Porterhouse |

Logica: il cuoco preme Done → dichiara pezzi → current_stock popolato → POS scarica

### BOM Edible Flower + Arugola — regola definitiva
- Solo su: **Griglia + Mediterranean + Table Side** (carni, pesci, secondi)
- NON su antipasti, pasta, zuppe, insalate
- Edible Flower = `f3d353e4` (Hardie's SKU 05840 — marigold) — unico ingrediente flower nel DB
- `Flower` e `flowers` (duplicati vuoti) → eliminati dal DB, BOM migrati a Edible Flower
- 19 ricette esistenti migrate + nuove aggiunte: totale ~26 ricette con 30g Arugola + 1 Edible Flower

### Menu audit — luglio 2026
**Alias aggiunti (no modifica storico POS):**
- Costata della Casa → `Costata Della Casa|Ribeye Prime Green Peppers Corn`
- Filetto Toscano → aggiunto a pos_name Filetto di manzo al merlot
- Porterhouse alla Fiorentina → collegata a `Chef's Feature`

**Ricette archiviate (fuori menu luglio 2026):**
- Ravioli Al Pesto · Scallops Asparagus Gnocchi · Salmon Salad · Saltimbocca Alla Romana · Chicken Piccata Buffet · Veal Saltimbocca family style

**Non toccate (hanno storico POS):**
- Lemon Ravioli (Beef Tenderloin Ravioli nel menu = Beef Ravioli nel POS — non toccare)
- Veal Piccata · Chicken Lemon Piccata

**Principio stabilito:** MAI modificare pos_name con storico — solo aggiungere alias con pipe `|`

---

## DA FARE NELLA PROSSIMA SESSIONE (PRIORITÀ)

### 1. Salad Station — da completare
Task senza recipe_id ancora da collegare:
- Cantaloupe, Caprese seasoning, Goat cheese, halved tomatoes, Honey, Olives, Pears, Pecorino fresh wedge, Roasted Almonds, Romaine, Seed mix, Shaved Parm, Shredded Carrots, Sliced Mozzarella, Sliced Tomatoes, Spring mix, Walnuts, Watermelon Cubes
- Check Balsamic Glaze, Check Blue Cheese, Check Burrata, Check Crostini, Check Croutons, Check Goat Cheese, Check Raspberry → tutti checklist, verificare recipe_id dove applicabile

### 2. Fresh Pasta Station — da completare
- Grated Pecorino (id 438) → supporto, collegare a ricette che usano pecorino grattugiato
- Parmesan Grated (id 439) → supporto, collegare a ricette che usano parmigiano grattugiato

### 3. Ricette da creare (decise oggi, non ancora fatte)
- Mash Potato (Saucier) — supporto per Scallops Chefs Way e altri
- Salmon aioli (Saute) — supporto per Amalfi Salmon
- Costata della Casa — ricetta completa con BOM
- Porterhouse alla Fiorentina — BOM: arugola, parmigiano, riduzione balsamica
- 48 Hour Texas Wagyu Dino Rib — BOM da definire con Max

### 4. Spinach — gestione separata
- Ha due task in due stazioni (Manager e Saute/Butter Spinach)
- Butter Spinach già collegata a ricetta BUTTER SPINACH ✅
- Spinach (Manager Station id 318) → da decidere: è la stessa ricetta o prep separata?
- Regola Zenos: mezza porzione spinach = 80g aluminum cup

### 5. Basil flowers — BOM da collegare
- Collegare Basil flowers a tutte le ricette che le usano
- Attualmente nessun BOM collegato — il bot non sa quante prepararne

### 6. Confit tomatoes — ricetta da creare
- Usata in: Shrimp Gnocchi + Mediterranean Salad (confermato da Max)
- Aggiungere BOM su entrambe le ricette dopo creazione ricetta

### 7. CLEANUP prep_frequency_days
```sql
SELECT id, name, category, prep_frequency_days 
FROM prep_tasks 
WHERE prep_frequency_days IS NOT NULL AND archived = false
ORDER BY category, name;
```
Regola: NULL su tutto tranne cadenza fissa per ragione operativa specifica.

### 8. Riscrivere bot-preplist-builder
- Legge `current_stock` invece di `need_tomorrow`
- Usa `shelf_life_days` per calcolare quando rifare
- Usa `prep_type` per trattare diversamente finale/supporto/checklist

---


### 9. Prep card UI — due valori da mostrare (da fare dopo completamento categorizzazione)
**Decisione presa 28 giugno 2026:**
- Nella **prep card** al cuoco: mostrare solo il peso NETTO (es. "300g Romaine pulita")
- Nella **recipe preview**: mostrare entrambi i valori (es. "300g pulita → parti da 400g sporca")
- Nella **prep list / acquisti**: convertire in unità di acquisto (es. "2.5 buste")
- Logica: `qty_netta = current_stock_target`, `qty_lorda = qty_netta / yield_factor`, `unità_acquisto = qty_lorda / avg_unit_weight_g`
- `yield_factor` su `ingredients` (colonna dormiente, aggiunta 28 giugno — DEFAULT 1.0)
- `avg_unit_weight_g` su `ingredients` (già esistente — da popolare per Romaine e altri)
- Valori yield stabiliti: Romaine Hearts 0.75 · Pera 0.82 · Watermelon 0.85 · Cherry Tomatoes halved 0.95 · Spring mix 1.0
- **NON toccare food cost o riacquisti ancora** — questa è solo UI prep card

## STATO VERSIONI
- Brigade frontend: **v393**
- Edge Function gmail-touchbistro-import: **v22**
- Supabase project: `ydqmumpytgrlceuinoqt`
