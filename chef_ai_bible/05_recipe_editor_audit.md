# Chef AI — Recipe Editor Audit

## Quando viene chiamato
Bottone "Controlla ricetta" nel Recipe Editor (recipes.js). Solo admin.

## Dati ricevuti
- recipes row completo
- recipe_bom rows con ingredienti e sub-recipe joinati
- linked_prep_tasks (prep_tasks collegati via recipe_id)
- mcr_issues (office_items aperti con nome ricetta nel titolo)

## Check da eseguire in ordine

### 1. POS name
- Se menu_group e Pasta/Entrees/Appetizers/Salads/Sides/Soups → pos_name obbligatorio
- Se menu_group e Bases/Sauces/Condiments → pos_name opzionale (sono prep intermedie)
- Se pos_name ha pipe (|) → verifica che tutti gli alias siano separati da | senza spazi extra

### 2. Base servings e base_weight_g
- Entrambi devono essere presenti se la ricetta ha BOM
- serving_weight_g deve essere uguale a base_weight_g / base_servings (±5%)
- Se base_servings presente ma base_weight_g mancante → warning per il bot

### 3. BOM completezza
- Minimo 1 riga in recipe_bom
- Nessun ITEM che dovrebbe essere RECIPE (es. "Grated Pecorino" come ITEM invece di RECIPE)
- Sub-recipe devono avere base_weight_g per permettere il calcolo del bot

### 4. Serving qty e serving unit
- Obbligatori se prep_type='finale' o se ha pos_name
- serving_unit validi: g, kg, cup, nests, pezzi, filetto, porzione, buste
- Esempi corretti: Butter Spinach=2 cup, Fettuccine=2 nests, Lobster=1 filetto, Arrabbiata=200 g

### 5. Shelf life
- shelf_life_days dovrebbe essere presente
- Ma nota: expected_duration_days su prep_tasks ha priorita su shelf_life_days della ricetta

### 6. Unita BOM
- Unita fisicamente convertibili: g, kg, ml, l, oz, lb, cup, tbsp, tsp, each, pz, nests
- Unita NON valide: batch, porzioni, contenitore (ambigue per il bot)

## Output JSON richiesto

```json
{
  "status": "ok|warning|critical",
  "understood": ["lista cose corrette"],
  "issues": [{"severity":"info|warning|critical","field":"campo","message":"descrizione"}],
  "bot_impact": ["impatti sul bot-preplist-builder"],
  "suggested_fixes": [{"action":"cosa fare","detail":"dettaglio"}],
  "follow_up_question": "domanda per Max",
  "follow_up_options": ["opzione 1","opzione 2"],
  "write_plan": null,
  "confidence": 0.0
}
```

## Regole pasta Zenos

- Porzione intera = 2 nests (60-65g ciascuno)
- Mezza porzione = 1 nest
- Add-on (chicken/shrimp/salmon/scallops/lobster) = mezza porzione per produzione
- Penne Midnight sauce = Arrabbiata sauce
- Chicken Parmesan sides = Arrabbiata
- Chicken Piccata sides = piccata sauce (pasta only, no extra sauce)
