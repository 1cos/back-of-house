# POS_TOUCHBISTRO_BOT_COMMIS — Manuale di Stazione

## Identità
- **Nome:** pos-touchbistro-commis
- **Versione:** v1
- **Tipo:** modulo dentro bot-pos-touchbistro-bot
- **Brigata:** Sprint 1 — Fondazione

## Responsabilità (una sola)
Controllare l'output del POS TouchBistro Bot e scrivere osservazioni in `commis_observations`.

## NON fa mai
- Modificare `pos_daily_raw`
- Modificare `current_stock`
- Modificare ricette o BOM
- Correggere il nome di un item POS
- Aggiornare `menu_item_status`

## Scrive solo in
`commis_observations` con `bot_name='pos-touchbistro-bot'` e `commis_name='pos-touchbistro-commis'`

## Idempotenza
Prima di scrivere, cancella le observation esistenti per:
- `business_date = target_date`
- `bot_name = 'pos-touchbistro-bot'`
- `commis_name = 'pos-touchbistro-commis'`

## Regole deterministiche (zero LLM)

### Regola 1a — Item storico assente dal report ieri
- Cerca item con media post-cambio (>= 2026-06-27) stesso DOW > 3
- Se assente nel report di ieri → `severity: warning`
- Se `menu_item_status.status = 'removed'` o `'archived'` → skip silenzioso
- Richiede almeno 2 occorrenze post-cambio per generare warning

### Regola 1b — Item presente ma venduto 0
- Se porzioni = 0 e media post-cambio > 3 → `severity: warning`
- Se storico insufficiente (< 2 occorrenze) → `severity: info` con nota "insufficient history"
- Se `menu_item_status` dice rimosso → skip

### Regola 2 — Vendita anomalmente alta
- Se ieri > 2.5× la media post-cambio stesso DOW → `severity: info`
- Richiede min 2 occorrenze post-cambio

### Regola 3 — Nome non mappato a ricetta
- Controlla se il nome matcha qualche alias in `recipes.pos_name` (pipe-delimited)
- Se nessun match e porzioni > 0 → `severity: info`, `category: missing_mapping`

## Filosofia menu lifecycle (2026-06-27)
- Storico prima del 27/06 ignorato nelle medie
- Con poco storico post-cambio (< 2 occorrenze stesso DOW): "insufficient post-menu-change history"
- Meglio pochi warning veri che rumore falso
- `menu_item_status` usata solo se popolata — se vuota, non assume nulla

## Metadata obbligatorio in ogni observation
```json
{
  "menu_change_date": "2026-06-27",
  "history_window": "post_menu_change",
  "occurrences": N,
  "avg_portions": X.XX
}
```
