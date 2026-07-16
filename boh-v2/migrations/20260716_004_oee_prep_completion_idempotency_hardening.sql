-- =============================================================
-- OEE SESSION C-B — PREP_COMPLETED IDEMPOTENCY HARDENING
-- Deployed: 2026-07-16
-- Project: ydqmumpytgrlceuinoqt
--
-- Hardens rpc_oee_record_prep_completion idempotent replay:
--   When an existing completed event is found for p_client_operation_id,
--   validate that it matches the incoming request before treating as replay.
--   Matching rules (all must be true):
--     event_role  = 'root'
--     type        = 'PREP_COMPLETED'
--     source_module = 'station_prep'
--     (payload->>'task_id')::bigint = p_task_id
--     (payload->>'quantity')::numeric = p_quantity
--     payload->>'unit' = p_unit
--   Match    → return original log+task result, idempotent:true
--   Mismatch → { ok:false, reason:'IDEMPOTENCY_KEY_CONFLICT', event_id }
--
-- Same validation applied in the concurrent UNIQUE-violation path.
--
-- Domain behavior unchanged:
--   - FOR UPDATE lock on prep_tasks
--   - stock from locked DB row (additive)
--   - prep_log insert with operational_event_id
--   - suggested_qty/suggested_note cleared
--   - suggested_by/suggested_at preserved
--   - PREP_STOCK_UPDATED derived fact
--   - 5 root transitions
--
-- Does NOT modify:
--   rpc_oee_record_prep_start
--   rpc_oee_record_stock_count
--   any schema tables
-- =============================================================

CREATE OR REPLACE FUNCTION public.rpc_oee_record_prep_completion(
  p_token               text,
  p_task_id             bigint,
  p_quantity            numeric,
  p_unit                text,
  p_client_operation_id text,
  p_occurred_at         timestamptz,
  p_in_progress_at      timestamptz DEFAULT NULL,
  p_is_suggested_qty    boolean     DEFAULT false,
  p_producer_id         text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
DECLARE
  v_session_result  jsonb;
  v_user_id         bigint;
  v_user_name       text;
  v_user_role       text;
  v_task            public.prep_tasks%ROWTYPE;
  v_inp             text;
  v_tsk             text;
  v_qty_native      numeric;
  v_max_qty         numeric;
  v_duration_min    integer;
  v_new_stock       numeric;
  v_log_id          bigint;
  v_event_id        uuid;
  v_derived_id      uuid;
  v_base_stock      numeric;
  v_occurred_at     timestamptz;
  v_client_key_uuid uuid;
BEGIN

  -- ── 0. Input validation ─────────────────────────────────────────────
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'token_required');
  END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'task_id_required');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'quantity_must_be_positive');
  END IF;
  IF p_unit IS NULL OR length(trim(p_unit)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'unit_required');
  END IF;
  IF p_client_operation_id IS NULL OR length(trim(p_client_operation_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'client_operation_id_required');
  END IF;

  v_occurred_at := COALESCE(p_occurred_at, now());

  BEGIN
    v_client_key_uuid := p_client_operation_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'client_operation_id_must_be_uuid');
  END;

  -- ── 1. Session validation ────────────────────────────────────────────
  v_session_result := public.brigade_validate_session(p_token);
  IF NOT (v_session_result->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AUTH_ERROR',
      'detail', v_session_result->>'error');
  END IF;

  v_user_id   := (v_session_result->'user'->>'id')::bigint;
  v_user_name := v_session_result->'user'->>'name';
  v_user_role := COALESCE(v_session_result->'user'->>'role', 'staff');

  -- ── 2. Idempotency check with payload validation ─────────────────────
  SELECT oe.id INTO v_event_id
  FROM public.operational_events oe
  WHERE oe.client_operation_id = p_client_operation_id
    AND oe.status = 'completed';

  IF FOUND THEN
    -- Validate: type, role, source, task_id, quantity, unit must all match.
    IF NOT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE id            = v_event_id
        AND type          = 'PREP_COMPLETED'
        AND event_role    = 'root'
        AND source_module = 'station_prep'
        AND (payload->>'task_id')::bigint   = p_task_id
        AND (payload->>'quantity')::numeric  = p_quantity
        AND payload->>'unit'                 = p_unit
    ) THEN
      RETURN jsonb_build_object(
        'ok',       false,
        'reason',   'IDEMPOTENCY_KEY_CONFLICT',
        'event_id', v_event_id
      );
    END IF;

    -- Exact match — safe replay. Reconstruct result from linked rows.
    DECLARE
      v_log_row  public.prep_log%ROWTYPE;
      v_task_row public.prep_tasks%ROWTYPE;
    BEGIN
      SELECT pl.* INTO v_log_row
      FROM public.prep_log pl
      WHERE pl.operational_event_id = v_event_id
      LIMIT 1;

      SELECT pt.* INTO v_task_row
      FROM public.prep_tasks pt
      WHERE pt.id = p_task_id;

      RETURN jsonb_build_object(
        'ok',         true,
        'idempotent', true,
        'event_id',   v_event_id,
        'log', jsonb_build_object(
          'item',             v_log_row.item,
          'station',          v_log_row.station,
          'qty',              v_log_row.qty,
          'unit',             v_log_row.unit,
          'user_name',        v_log_row.user_name,
          'started_at',       v_log_row.started_at,
          'duration_minutes', v_log_row.duration_minutes,
          'is_suggested_qty', v_log_row.is_suggested_qty,
          'created_at',       v_log_row.created_at
        ),
        'task', jsonb_build_object(
          'id',            v_task_row.id,
          'current_stock', v_task_row.current_stock,
          'need_tomorrow', v_task_row.need_tomorrow,
          'in_progress',   v_task_row.in_progress,
          'in_progress_at', v_task_row.in_progress_at,
          'in_progress_by', v_task_row.in_progress_by
        )
      );
    END;
  END IF;

  -- ── 3. Lock task row ─────────────────────────────────────────────────
  SELECT * INTO v_task
  FROM public.prep_tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND');
  END IF;
  IF v_task.archived = true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND',
      'detail', 'archived');
  END IF;

  -- ── 4. Unit normalisation ────────────────────────────────────────────
  v_inp := lower(trim(COALESCE(p_unit, '')));
  v_tsk := lower(trim(COALESCE(v_task.unit, '')));

  IF v_inp IN ('pz','pezzi','each','pieces','pcs','piece') THEN v_inp := 'pz'; END IF;
  IF v_tsk IN ('pz','pezzi','each','pieces','pcs','piece','checklist') THEN v_tsk := 'pz'; END IF;

  IF v_inp NOT IN ('pz','g','kg','nests','cup','buste','filetto','mazzi','batch','squeezer','porzioni','') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'unit_not_allowed', 'unit', p_unit);
  END IF;
  IF v_tsk = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'task_unit_missing');
  END IF;

  IF v_inp = '' OR v_inp = v_tsk THEN
    v_qty_native := p_quantity;
  ELSIF v_inp = 'kg' AND v_tsk = 'g' THEN
    v_qty_native := p_quantity * 1000;
  ELSIF v_inp = 'g' AND v_tsk = 'kg' THEN
    v_qty_native := p_quantity / 1000;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'unit_conversion_unsupported', 'from', p_unit, 'to', v_task.unit);
  END IF;

  -- ── 5. Maximum quantity cap ──────────────────────────────────────────
  v_max_qty := CASE
    WHEN v_tsk = 'g'     THEN 50000
    WHEN v_tsk = 'kg'    THEN 50
    WHEN v_tsk = 'pz'    THEN 500
    WHEN v_tsk = 'nests' THEN 200
    ELSE 200
  END;
  IF v_qty_native > v_max_qty THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'qty_exceeds_maximum',
      'qty_native', v_qty_native, 'max', v_max_qty, 'unit', v_task.unit);
  END IF;

  -- ── 6. Duration calculation ──────────────────────────────────────────
  IF p_in_progress_at IS NOT NULL THEN
    v_duration_min := GREATEST(0,
      ROUND(EXTRACT(EPOCH FROM (v_occurred_at - p_in_progress_at)) / 60)::integer
    );
  ELSE
    v_duration_min := NULL;
  END IF;

  -- ── 7. Insert event envelope (concurrency-safe) ──────────────────────
  BEGIN
    INSERT INTO public.operational_events (
      event_role, type, status, occurred_at, received_at,
      producer_type, producer_id,
      actor_user_id, actor_name_snapshot,
      source_module, client_operation_id,
      payload, category, urgency
    ) VALUES (
      'root', 'PREP_COMPLETED', 'received', v_occurred_at, now(),
      'user_ui', p_producer_id,
      v_user_id, v_user_name,
      'station_prep', p_client_operation_id,
      jsonb_build_object(
        'task_id',  p_task_id,
        'quantity', p_quantity,
        'unit',     p_unit
      ),
      'PREP', 'low'
    )
    RETURNING id INTO v_event_id;

  EXCEPTION WHEN unique_violation THEN
    -- Concurrent call won the INSERT race. Apply same matching rules.
    SELECT id INTO v_event_id
    FROM public.operational_events
    WHERE client_operation_id = p_client_operation_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE id            = v_event_id
        AND type          = 'PREP_COMPLETED'
        AND event_role    = 'root'
        AND source_module = 'station_prep'
        AND (payload->>'task_id')::bigint   = p_task_id
        AND (payload->>'quantity')::numeric  = p_quantity
        AND payload->>'unit'                 = p_unit
    ) THEN
      RETURN jsonb_build_object(
        'ok',       false,
        'reason',   'IDEMPOTENCY_KEY_CONFLICT',
        'event_id', v_event_id
      );
    END IF;

    -- Matching concurrent replay.
    PERFORM pg_sleep(0.1);
    DECLARE
      v_log_row  public.prep_log%ROWTYPE;
      v_task_row public.prep_tasks%ROWTYPE;
    BEGIN
      SELECT pl.* INTO v_log_row
      FROM public.prep_log pl
      WHERE pl.operational_event_id = v_event_id
      LIMIT 1;
      SELECT pt.* INTO v_task_row FROM public.prep_tasks pt WHERE pt.id = p_task_id;
      RETURN jsonb_build_object(
        'ok', true, 'idempotent', true, 'event_id', v_event_id,
        'log', jsonb_build_object(
          'item', v_log_row.item, 'station', v_log_row.station,
          'qty', v_log_row.qty, 'unit', v_log_row.unit,
          'user_name', v_log_row.user_name, 'started_at', v_log_row.started_at,
          'duration_minutes', v_log_row.duration_minutes,
          'is_suggested_qty', v_log_row.is_suggested_qty, 'created_at', v_log_row.created_at
        ),
        'task', jsonb_build_object(
          'id', v_task_row.id, 'current_stock', v_task_row.current_stock,
          'need_tomorrow', v_task_row.need_tomorrow, 'in_progress', v_task_row.in_progress,
          'in_progress_at', v_task_row.in_progress_at, 'in_progress_by', v_task_row.in_progress_by
        )
      );
    END;
  END;

  -- ── 8. Transitions: received → authorized → execution_started ─────────
  INSERT INTO public.operational_event_transitions (event_id, transition, detail)
  VALUES
    (v_event_id, 'received',          jsonb_build_object('client_operation_id', p_client_operation_id)),
    (v_event_id, 'authorized',        jsonb_build_object('user_id', v_user_id, 'role', v_user_role)),
    (v_event_id, 'execution_started', jsonb_build_object('task_id', p_task_id, 'qty_native', v_qty_native));

  -- ── 9. Insert prep_log ────────────────────────────────────────────────
  INSERT INTO public.prep_log (
    item, station, qty, unit,
    user_name, is_suggested_qty,
    started_at, duration_minutes,
    prep_task_id, client_key, operational_event_id
  ) VALUES (
    v_task.name,
    v_task.category,
    p_quantity,
    p_unit,
    v_user_name,
    COALESCE(p_is_suggested_qty, false),
    p_in_progress_at,
    v_duration_min,
    p_task_id,
    v_client_key_uuid,
    v_event_id
  )
  RETURNING id INTO v_log_id;

  -- ── 10. Update prep_tasks (additive stock from locked DB row) ─────────
  v_base_stock := COALESCE(v_task.current_stock, 0);
  v_new_stock  := v_base_stock + v_qty_native;

  UPDATE public.prep_tasks SET
    current_stock  = v_new_stock,
    in_progress    = false,
    in_progress_at = NULL,
    in_progress_by = NULL,
    need_tomorrow  = false,
    suggested_qty  = NULL,
    suggested_note = NULL
  WHERE id = p_task_id;

  -- Re-read for return
  SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id;

  -- ── 11. Insert derived fact: PREP_STOCK_UPDATED ───────────────────────
  INSERT INTO public.operational_events (
    event_role, type, status, occurred_at, received_at,
    producer_type, actor_user_id, actor_name_snapshot,
    source_module, causation_event_id,
    payload, category, urgency, write_result
  ) VALUES (
    'derived_fact', 'PREP_STOCK_UPDATED', 'completed', v_occurred_at, now(),
    'derived_event', v_user_id, v_user_name,
    'station_prep', v_event_id,
    jsonb_build_object(
      'task_id',        p_task_id,
      'previous_stock', v_base_stock,
      'new_stock',      v_new_stock,
      'delta',          v_qty_native,
      'source',         'prep_completion'
    ),
    'PREP', 'low', 'success'
  )
  RETURNING id INTO v_derived_id;

  -- ── 12. Finalize root event ───────────────────────────────────────────
  INSERT INTO public.operational_event_transitions (event_id, transition, detail)
  VALUES
    (v_event_id, 'execution_completed', jsonb_build_object(
       'log_id', v_log_id, 'new_stock', v_new_stock, 'derived_event_id', v_derived_id)),
    (v_event_id, 'completed', jsonb_build_object());

  UPDATE public.operational_events
  SET status = 'completed', write_result = 'success'
  WHERE id = v_event_id;

  -- ── 13. Return ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',         true,
    'idempotent', false,
    'event_id',   v_event_id,
    'log', jsonb_build_object(
      'item',             v_task.name,
      'station',          v_task.category,
      'qty',              p_quantity,
      'unit',             p_unit,
      'user_name',        v_user_name,
      'started_at',       p_in_progress_at,
      'duration_minutes', v_duration_min,
      'is_suggested_qty', COALESCE(p_is_suggested_qty, false),
      'created_at',       now()
    ),
    'task', jsonb_build_object(
      'id',             v_task.id,
      'current_stock',  v_task.current_stock,
      'need_tomorrow',  v_task.need_tomorrow,
      'in_progress',    v_task.in_progress,
      'in_progress_at', v_task.in_progress_at,
      'in_progress_by', v_task.in_progress_by
    )
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_oee_record_prep_completion(
  text, bigint, numeric, text, text, timestamptz, timestamptz, boolean, text
) TO anon, authenticated;
