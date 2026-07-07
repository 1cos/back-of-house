# Chef AI — Inventory & Stock Rules

## Principio fondamentale (stabilito da Max)

"L'unita di inventario deve essere quello che il cuoco vede e conta fisicamente nel frigo o in cucina."

- Grammi → si pesa sulla bilancia
- Pezzi/pz → si conta (salmon cakes, chicken parm, artichoke, lobster...)
- Nests → si contano i nidi di pasta (spaghetti, fettuccine)
- Cup → si conta la cup (spinaci — 1 cup = 80g)
- Buste → si conta la busta (soffritto livornese, spring mix)
- MAI "porzioni" come unita astratta — non e qualcosa che si pesa o conta fisicamente

## Stock NULL vs 0

- current_stock = NULL → il bot SALTA il task completamente (non calcola nulla)
- current_stock = 0 → il bot calcola e propone la quantita da fare
- Se un prep task non ha mai avuto un inventario fisico → lasciare NULL finche non si fa l'inventario

## Modello 3 livelli

1. INVENTARIO → grammi o pezzi (quello che il cuoco misura/conta)
2. BOT NOTTURNO → legge grammi/pezzi, calcola fabbisogno, dice quanti batch fare in linguaggio cucina
3. PREP CARD → il cuoco vede i batch da fare, li fa, conferma i batch completati

## Quando il cuoco segna DONE

- La qty prodotta si AGGIUNGE allo stock esistente (non sostituisce)
- suggested_note e suggested_qty vengono azzerati
- Bot alle 4AM riscrive tutto partendo dallo stock reale

## Unita stock per stazione

Fresh Pasta: nests (spaghetti, fettuccine), g (gnocchi)
Pastry: pezzi (cheesecake, creme brulee, cremino, mint bavarese), g (brownies, berry coulis)
Salad: g (romaine, shredded carrots, seed mix, pecorino wedge), buste (spring mix)
Oven: g (brussels sprouts, calamari, rosemary potatoes), pezzi (chicken parm, salmon cakes, artichoke)
Saucier: g (arrabbiata, pomodoro, cacio e pepe, bechamel), buste (soffritto livornese)
Sauté: g (butter spinach, asparagus, risotto base), cup (spinach — 1cup=80g)
Table Side: pezzi (salmon filets, scallops, lobster tail, filets tenderloin)
Pastry: pezzi per dessert, g per creme/salse

## Query inventario per stazione

SELECT name, current_stock, unit, suggested_note, expected_duration_days
FROM prep_tasks
WHERE category = '{stazione}' AND archived = false
ORDER BY name;

## Prep tasks critici con note speciali

- Artichoke (id 260): unit=pezzi, 2 pezzi per porzione → bot deve tenere conto del fattore 2
- Spinach (id 318): unit=cup, 1 cup = 80g dalla ricetta Butter Spinach, recipe_id = Butter Spinach
- Chop Romaine (id 364): unit=g, ingredient_id collegato a Romaine, expected_duration_days=2
- Gnocchi (id 388): unit=g, recipe_id c3836a65, shelf_life 30gg (congelati)
- Tempura (id 283): prep_type=checklist, daily_reset=true, si fa fresca ogni mattina
