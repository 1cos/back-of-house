# BOM Chain Bot — Test & Verifica

## Prerequisiti

1. `bot-direct-deduction` già eseguito per la stessa data
2. `stock_deductions` con `source='direct_recipe'` presenti

## Trigger manuale

Edge Functions → `bot-bom-chain-deduction` → Invoke:

```json
{ "business_date": "2026-07-06" }
```

## Query di verifica

### 1. Distribuzione per source
```sql
SELECT source, item_type, COUNT(*), ROUND(SUM(quantity),1)
FROM stock_deductions
WHERE business_date = '2026-07-06'
GROUP BY source, item_type ORDER BY source, item_type;
```

### 2. Coccoli Toscani (test completo)
```sql
SELECT source, item_type, target_name, quantity, unit, calculation_path
FROM stock_deductions
WHERE business_date = '2026-07-06' AND pos_item_name ILIKE '%coccoli%'
ORDER BY source, target_name;
```
Atteso:
- direct_recipe / prep / Gnocco Dough / 500g
- bom_chain / ingredient / Parma Ham / 500g
- bom_chain / ingredient / Burrata / 10oz

### 3. Siciliana — stop su cartoccio
```sql
SELECT source, item_type, target_name, quantity, unit
FROM stock_deductions
WHERE business_date = '2026-07-06' AND pos_item_name = 'Siciliana'
ORDER BY source, target_name;
```
Atteso (solo 3 righe direct_recipe, nessun figlio del cartoccio):
- direct_recipe / prep / Garlic oil / 60g
- direct_recipe / prep / Siciliana cartoccio / 2pz
- direct_recipe / prep / Spinach / 2cup

### 4. Check duplicati
```sql
SELECT pos_item_name, target_name, COUNT(*), STRING_AGG(source, ', ')
FROM stock_deductions
WHERE business_date = '2026-07-06'
GROUP BY pos_item_name, target_name
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;
```
Atteso: solo duplicati `direct_recipe/direct_recipe` da pos_daily_clean (da fixare in Sprint 3 v2).

### 5. Stock intatto
```sql
SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL
SELECT 'stock_daily_snapshot', COUNT(*) FROM stock_daily_snapshot;
```

## Risultati su 2026-07-06

| Metrica | Valore |
|---|---|
| direct_recipe prep | 99 |
| bom_chain ingredient | 238 (10 aggregati) |
| bom_chain prep | 0 (tutti già in direct_recipe) |
| Totale | 337 |
| Observations | 0 |
| stock_movements | 335 (pre-esistenti) |
| stock_daily_snapshot | 0 |
