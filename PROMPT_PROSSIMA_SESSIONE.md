# PROMPT PROSSIMA SESSIONE — Brigade — INGREDIENTI/FOOD COST (CRITICO)

## CARICA SUBITO
1. Token GitHub da file `x_claude_GIthub.txt` nel progetto
2. Repo `1cos/back-of-house`, branch `brigade-main` SEMPRE
3. Leggi i file da GitHub LIVE, mai da memoria
4. Supabase project: ydqmumpytgrlceuinoqt

---

## ⚠️ REGOLA D'ORO (non violare mai)
- Per Max si chiamano SEMPRE "ingredienti", MAI "BOM"/"JSON"/"cassetto". Max è un cuoco: apre la ricetta, vede ingredienti, modifica, salva.
- NON chiedere mai a Max di ricreare gli ingredienti — LI HA GIÀ. Leggi il database prima di chiedere.

---

## COME FUNZIONA DAVVERO IL FOOD COST (verità tecnica verificata 21/6)
Catena del food cost:
```
recipe_bom.item_id → ingredients.id → ingredient_vendors (price_per_100g / price_per_each)
recipe_bom.sub_recipe_id → recipes (sub-ricetta, food cost ricorsivo)
```
**Il food cost VERO si calcola dal recipe_bom**, NON dal campo JSON `recipes.ingredients`.

Esistono DUE posti dove vivono gli ingredienti:
1. `recipes.ingredients` (JSON `[{qty,name,unit,comment}]`) → quello che il FORM di Brigade legge/mostra/scrive
2. `recipe_bom` (tabella con item_id/sub_recipe_id/quantity/unit/notes/prep_task_id) → quello che fa FOOD COST + PRODUZIONE + collega prep_tasks

Il form (`saveRecipeBOM` in js/recipes.js) quando Max salva scrive in ENTRAMBI.

---

## IL PROBLEMA DA RISOLVERE (priorità #1)

**Bug architetturale:** il JSON `recipes.ingredients` e il `recipe_bom` sono due fonti separate che possono divergere. Il food cost dipende dal BOM (con item_id), ma il form mostra il JSON. Se il JSON non ha i collegamenti (item_id/sub_recipe_id), salvare dal form CANCELLA il BOM buono e lo riscrive senza collegamenti → SI PERDE IL FOOD COST.

**Errore commesso il 21/6 (da sistemare):** durante la sessione BOM, le ricette nuove sono state scritte nel JSON SENZA ingredient_id/sub_recipe_id (solo nome testuale). Queste ricette hanno il BOM corretto (con collegamenti) ma il JSON "scollegato". RISCHIO: se Max salva una di queste dal form, perde i collegamenti food cost.

Ricette a rischio (JSON senza link, BOM ok) — toccate il 21/6:
Mini Caesar Salad, Truffle Fettuccine, COCCOLI TOSCANI, CAPRESE, Chicken Parmesan, Penne Midnight, Penne Midnight Half, Spaghetti Al Ragu, Chef Max Risotto, Artichoke, Tuscany Road Trip, Branzino Chef Style, WAGYU TOMAHAWK, Tomato And Basil Soup, Spaghetti al Pomodoro Half, Risotto Base, Tempura Batter, Artichoke Sauce, Bresaola, Fettuccine Arrabbiata Half, Ribeye Prime Green Peppers Corn, Asparagus, Lasagna Pan, MACCHERONI AL RAGU.

**NOTA:** verificato che ANCHE le ricette vecchie verdi (es. Lobster Fettucine) NON hanno ingredient_id nel JSON — eppure sono verdi e hanno food cost. Quindi il collegamento verde nella VISTA ricetta avviene per MATCH PER NOME a runtime, NON dal JSON. Va capito ESATTAMENTE come js/recipes.js (riga ~462 linkedColor, ~482 autocomplete, riga ~934 saveRecipeBOM) determina item_id quando Max salva: se fa match per nome al salvataggio, allora il rischio è minore; se si basa su dataset.ingredientId già presente, allora le ricette del 21/6 sono a rischio. DA VERIFICARE NEL CODICE PRIMA DI TOCCARE.

---

## DECISIONE ARCHITETTURALE DA PRENDERE CON MAX
Max vuole UNA COSA SOLA: modifica un ingrediente nella ricetta → si aggiorna food cost + produzione. Senza sapere di BOM/JSON.

Opzione consigliata: rendere recipe_bom l'UNICA fonte di verità. Il form legge gli ingredienti dal BOM (join con ingredients per i nomi) e scrive solo nel BOM. Il JSON o diventa una copia auto-generata o viene eliminato. Così: niente più divergenza, food cost sempre corretto.

Lavoro su js/recipes.js: funzione caricamento ingredienti nel form + saveRecipeBOM. Testare bene su una ricetta prima di applicare a tutte.

---

## STATO TECNICO
- Frontend: v305 (sw.js boh-v305)
- recipe_bom: ha colonna prep_task_id (FK a prep_tasks) — già esiste
- recipes: ha serving_unit/serving_qty (decidemmo NON servono, il BOM con base_servings=1 basta)
- prep_tasks: 162 righe, FK recipe_id → recipes
- Tabelle food cost: ingredients (428), ingredient_vendors (69, prezzi), ingredient_links (77, match fattura→ingrediente), items (94, vecchia tabella prezzi legacy?)
- VERIFICARE se `items` (94 righe, price_per_gram_usd) è una tabella prezzi alternativa/legacy o se è usata

## REGOLE OPERATIVE
- SHA fresco prima di ogni PUT; bump boh-vN in sw.js ad ogni push; node --check prima di push
- Commit: "vN file — descrizione"; solo brigade-main
- pos_production_daily.total_portions è GENERATA, mai UPDATE manuale
- Nomi ricette = identici al POS (cambiare title, mai pos_name)
- Domenica niente Focus Mode (già fatto v303)

## SICUREZZA (segnalato da Supabase, NON urgente, decidere con calma)
42 tabelle hanno RLS disabilitato — chiunque con anon key può leggere/scrivere. NON abilitare RLS senza prima creare le policy (bloccherebbe tutto). Valutare in sessione dedicata sicurezza.
