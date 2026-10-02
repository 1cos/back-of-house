-- CLEAN0210 — "resa non dichiarata" segue la regola unica della resa.
--
-- FC05 (food_cost.recipe_breakdown) segnalava resa_non_dichiarata quando
-- mancava la resa a PESO/VOLUME (y_qty), anche se la ricetta dichiara le
-- porzioni. La regola unica (YIELD01, 01/10) dice: resa = kg OPPURE
-- porzioni. Al 02/10: 151 ricette segnalate, 122 con porzioni gia'
-- dichiarate (114 piatti finali + 8 sotto-ricette); 187 -> 54 segnalazioni.
--
-- Cambia SOLO la diagnostica informativa. Non tocca:
--   - resa_mancante sul GENITORE (sotto-ricetta usata a peso senza resa a
--     peso): resta identica, quindi i 13 blocchi veri restano visibili;
--   - il semaforo (resa_non_dichiarata non lo ha mai influenzato);
--   - nessuna ricetta.
--
-- Sostituzione testuale guardata sulla definizione live: se la riga
-- attesa non c'e' esattamente una volta, la migrazione si ferma.

do $mig$
declare
  d   text := pg_get_functiondef('food_cost.recipe_breakdown(uuid,uuid,uuid[])'::regprocedure);
  old text := E'  if y_qty is null then\n    issues := issues || jsonb_build_object(''code'', ''resa_non_dichiarata''';
  new text := E'  if y_qty is null and n_port is null then  -- CLEAN0210: resa = kg OPPURE porzioni\n    issues := issues || jsonb_build_object(''code'', ''resa_non_dichiarata''';
  n   int;
begin
  n := (length(d) - length(replace(d, old, ''))) / length(old);
  if n <> 1 then
    raise exception 'CLEAN0210: riga attesa trovata % volte, mi fermo', n;
  end if;
  execute replace(d, old, new);
end
$mig$;

-- Undo: stessa sostituzione al contrario (new -> old).
