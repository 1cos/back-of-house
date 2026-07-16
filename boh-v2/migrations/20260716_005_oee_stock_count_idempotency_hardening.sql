-- =============================================================
-- OEE SESSION D-B.1 — STOCK_COUNT_RECORDED IDEMPOTENCY HARDENING
-- Deployed: 2026-07-16
-- Project: ydqmumpytgrlceuinoqt
--
-- Hardens rpc_oee_record_stock_count idempotent replay:
--   When an existing completed event is found for p_client_operation_id,
--   validate that it matches the incoming request before treating as replay.
--   Matching rules (all must be true):
--     event_role   = 'root'
--     type         = 'STOCK_COUNT_RECORDED'
--     source_module = 'station_prep'
--     (payload->>'task_id')::bigint          = p_task_id
--     (payload->>'counted_quantity')::numeric = p_counted_quantity
--     payload->>'unit'                        = p_unit
--   Match    → return original count+task result, idempotent:true
--   Mismatch → { ok:false, reason:'IDEMPOTENCY_KEY_CONFLICT', event_id }
--
-- Same validation applied in the concurrent UNIQUE-violation path.
--
-- Domain behavior unchanged:
--   - FOR UPDATE lock on prep_tasks
--   - absolute stock write (not additive)
--   - prep_stock_counts insert with ON CONFLICT DO NOTHING
--   - diagnostic metadata
--   - PREP_STOCK_VERIFIED derived fact
--   - 5 root transitions (normal path)
--
-- Does NOT modify:
--   rpc_oee_record_prep_start
--   rpc_oee_record_prep_completion
--   any schema tables
-- =============================================================

CREATE OR REPLACE FUNCTION public.rpc_oee_record_stock_count(
  p_token               text,
  p_task_id             bigint,
  p_counted_quantity    numeric,
  p_unit                text,
  p_client_operation_id text,
  p_occurred_at         timestamptz,
  p_producer_id         text DEFAULT NULL
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
  v_count_id        bigint;
  v_new_stock       numeric;
  v_event_id        uuid;
  v_derived_id      uuid;
  v_client_key_uuid uuid;
  v_occurred_at     timestamptz;
  v_rel_delta       numeric;
  v_abs_delta       numeric;
  v_thr_rel         numeric := 0.40;
  v_thr_abs         numeric;
  v_diag_flag       boolean := false;
  v_diag_reason     text;
BEGIN

  IF p_token IS NULL OR length(p_token) <> 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'token_required');
  END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'task_id_required');
  END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'counted_quantity_must_be_non_negative');
  END IF;
  IF p_unit IS NULL OR length(trim(p_unit)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'unit_required');
  END IF;
  IF p_client_operation_id IS NULL OR length(trim(p_client_operation_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'client_operation_id_required');
  END IF;

  v_occurred_at := COALESCE(p_occurred_at, now());

  BEGIN
    v_client_key_uuid := p_client_operation_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'client_operation_id_must_be_uuid');
  END;

  v_session_result := public.brigade_validate_session(p_token);
  IF NOT (v_session_result->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AUTH_ERROR', 'detail', v_session_result->>'error');
  END IF;

  v_user_id   := (v_session_result->'user'->>'id')::bigint;
  v_user_name := v_session_result->'user'->>'name';
  v_user_role := COALESCE(v_session_result->'user'->>'role', 'staff');

  -- Idempotency check with payload validation
  SELECT oe.id INTO v_event_id
  FROM public.operational_events oe
  WHERE oe.client_operation_id = p_client_operation_id
    AND oe.status = 'completed';

  IF FOUND THEN
    -- Validate all six fields before treating as safe replay.
    IF NOT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE id            = v_event_id
        AND type          = 'STOCK_COUNT_RECORDED'
        AND event_role    = 'root'
        AND source_module = 'station_prep'
        AND (payload->>'task_id')::bigint          = p_task_id
        AND (payload->>'counted_quantity')::numeric = p_counted_quantity
        AND payload->>'unit'                        = p_unit
    ) THEN
      RETURN jsonb_build_object(
        'ok',       false,
        'reason',   'IDEMPOTENCY_KEY_CONFLICT',
        'event_id', v_event_id
      );
    END IF;

    -- Exact match — safe replay.
    DECLARE
      v_count_row public.prep_stock_counts%ROWTYPE;
      v_task_row  public.prep_tasks%ROWTYPE;
    BEGIN
      SELECT psc.* INTO v_count_row
      FROM public.prep_stock_counts psc
      WHERE psc.operational_event_id = v_event_id
      LIMIT 1;
      SELECT pt.* INTO v_task_row FROM public.prep_tasks pt WHERE pt.id = p_task_id;
      RETURN jsonb_build_object(
        'ok', true, 'idempotent', true, 'event_id', v_event_id,
        'count', jsonb_build_object(
          'id', v_count_row.id, 'prep_task_id', v_count_row.prep_task_id,
          'counted_qty', v_count_row.counted_qty, 'unit', v_count_row.unit,
          'counted_by', v_count_row.counted_by, 'source', v_count_row.source,
          'counted_at', v_count_row.counted_at,
          'prev_bot_stock', v_count_row.prev_bot_stock,
          'prev_bot_suggestion', v_count_row.prev_bot_suggestion,
          'prev_suggested_by', v_count_row.prev_suggested_by
        ),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock)
      );
    END;
  END IF;

  SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND'); END IF;
  IF v_task.archived = true THEN RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND', 'detail', 'archived'); END IF;

  v_inp := lower(trim(COALESCE(p_unit, '')));
  v_tsk := lower(trim(COALESCE(v_task.unit, '')));
  IF v_inp IN ('pz','pezzi','each','pieces','pcs','piece') THEN v_inp := 'pz'; END IF;
  IF v_tsk IN ('pz','pezzi','each','pieces','pcs','piece','checklist') THEN v_tsk := 'pz'; END IF;
  IF v_inp NOT IN ('pz','g','kg','nests','cup','buste','filetto','mazzi','batch','squeezer','porzioni','') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'unit_not_allowed', 'unit', p_unit);
  END IF;
  IF v_tsk = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'task_unit_missing'); END IF;
  IF v_inp = '' OR v_inp = v_tsk THEN v_qty_native := p_counted_quantity;
  ELSIF v_inp = 'kg' AND v_tsk = 'g' THEN v_qty_native := p_counted_quantity * 1000;
  ELSIF v_inp = 'g' AND v_tsk = 'kg' THEN v_qty_native := p_counted_quantity / 1000;
  ELSE RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'unit_conversion_unsupported', 'from', p_unit, 'to', v_task.unit);
  END IF;
  IF v_qty_native < 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'qty_must_be_non_negative'); END IF;

  IF v_task.current_stock IS NULL THEN v_diag_flag := false; v_diag_reason := 'no_prior_stock';
  ELSIF v_task.current_stock = 0 THEN v_diag_flag := false; v_diag_reason := 'prior_stock_zero';
  ELSE
    v_abs_delta := abs(v_qty_native - v_task.current_stock);
    v_rel_delta := v_abs_delta / v_task.current_stock;
    v_thr_abs := CASE v_tsk WHEN 'g' THEN 2000 WHEN 'kg' THEN 2 WHEN 'pz' THEN 10 WHEN 'nests' THEN 20 ELSE NULL END;
    v_diag_flag := (v_rel_delta > v_thr_rel) AND (v_thr_abs IS NULL OR v_abs_delta > v_thr_abs);
    v_diag_reason := CASE WHEN v_diag_flag THEN 'threshold_exceeded' ELSE 'within_threshold' END;
  END IF;

  BEGIN
    INSERT INTO public.operational_events (
      event_role, type, status, occurred_at, received_at,
      producer_type, producer_id, actor_user_id, actor_name_snapshot,
      source_module, client_operation_id, payload, category, urgency, diagnostic_metadata
    ) VALUES (
      'root', 'STOCK_COUNT_RECORDED', 'received', v_occurred_at, now(),
      'user_ui', p_producer_id, v_user_id, v_user_name,
      'station_prep', p_client_operation_id,
      jsonb_build_object('task_id', p_task_id, 'counted_quantity', p_counted_quantity, 'unit', p_unit),
      'STOCK', 'normal',
      jsonb_build_object(
        'diag_flag', v_diag_flag, 'diag_reason', v_diag_reason,
        'relative_delta', v_rel_delta, 'absolute_delta', v_abs_delta,
        'threshold_relative', v_thr_rel, 'threshold_absolute', v_thr_abs,
        'prior_stock', v_task.current_stock
      )
    )
    RETURNING id INTO v_event_id;

  EXCEPTION WHEN unique_violation THEN
    -- Concurrent call won the INSERT race. Apply same matching rules.
    PERFORM pg_sleep(0.1);
    SELECT id INTO v_event_id FROM public.operational_events WHERE client_operation_id = p_client_operation_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE id            = v_event_id
        AND type          = 'STOCK_COUNT_RECORDED'
        AND event_role    = 'root'
        AND source_module = 'station_prep'
        AND (payload->>'task_id')::bigint          = p_task_id
        AND (payload->>'counted_quantity')::numeric = p_counted_quantity
        AND payload->>'unit'                        = p_unit
    ) THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'IDEMPOTENCY_KEY_CONFLICT', 'event_id', v_event_id
      );
    END IF;

    DECLARE
      v_count_row public.prep_stock_counts%ROWTYPE;
      v_task_row  public.prep_tasks%ROWTYPE;
    BEGIN
      SELECT psc.* INTO v_count_row FROM public.prep_stock_counts psc WHERE psc.operational_event_id = v_event_id LIMIT 1;
      SELECT pt.* INTO v_task_row FROM public.prep_tasks pt WHERE pt.id = p_task_id;
      RETURN jsonb_build_object(
        'ok', true, 'idempotent', true, 'event_id', v_event_id,
        'count', jsonb_build_object(
          'id', v_count_row.id, 'prep_task_id', v_count_row.prep_task_id,
          'counted_qty', v_count_row.counted_qty, 'unit', v_count_row.unit,
          'counted_by', v_count_row.counted_by, 'source', v_count_row.source,
          'counted_at', v_count_row.counted_at,
          'prev_bot_stock', v_count_row.prev_bot_stock,
          'prev_bot_suggestion', v_count_row.prev_bot_suggestion,
          'prev_suggested_by', v_count_row.prev_suggested_by
        ),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock)
      );
    END;
  END;

  INSERT INTO public.operational_event_transitions (event_id, transition, detail)
  VALUES
    (v_event_id, 'received',          jsonb_build_object('client_operation_id', p_client_operation_id)),
    (v_event_id, 'authorized',        jsonb_build_object('user_id', v_user_id, 'role', v_user_role)),
    (v_event_id, 'execution_started', jsonb_build_object('task_id', p_task_id, 'qty_native', v_qty_native));

  INSERT INTO public.prep_stock_counts (
    prep_task_id, counted_qty, unit, qty_native, counted_by, counted_at, source,
    prev_bot_stock, prev_bot_suggestion, prev_suggested_by, client_key, operational_event_id
  ) VALUES (
    p_task_id, p_counted_quantity, p_unit, v_qty_native, v_user_name, v_occurred_at, 'kitchen_count',
    v_task.current_stock, v_task.suggested_qty, v_task.suggested_by, v_client_key_uuid, v_event_id
  )
  ON CONFLICT (client_key) DO NOTHING
  RETURNING id INTO v_count_id;

  IF v_count_id IS NULL THEN
    DECLARE
      v_exist_count public.prep_stock_counts%ROWTYPE;
      v_task_row    public.prep_tasks%ROWTYPE;
    BEGIN
      SELECT * INTO v_exist_count FROM public.prep_stock_counts WHERE client_key = v_client_key_uuid;
      SELECT * INTO v_task_row FROM public.prep_tasks WHERE id = p_task_id;
      UPDATE public.operational_events SET status='completed', write_result='success' WHERE id=v_event_id;
      INSERT INTO public.operational_event_transitions (event_id, transition, detail) VALUES
        (v_event_id, 'execution_completed', jsonb_build_object('duplicate_count_skipped', true)),
        (v_event_id, 'completed', jsonb_build_object());
      RETURN jsonb_build_object(
        'ok', true, 'idempotent', true, 'event_id', v_event_id,
        'count', jsonb_build_object(
          'id', v_exist_count.id, 'prep_task_id', v_exist_count.prep_task_id,
          'counted_qty', v_exist_count.counted_qty, 'unit', v_exist_count.unit,
          'counted_by', v_exist_count.counted_by, 'source', v_exist_count.source,
          'counted_at', v_exist_count.counted_at,
          'prev_bot_stock', v_exist_count.prev_bot_stock,
          'prev_bot_suggestion', v_exist_count.prev_bot_suggestion,
          'prev_suggested_by', v_exist_count.prev_suggested_by
        ),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock)
      );
    END;
  END IF;

  UPDATE public.prep_tasks SET current_stock = v_qty_native WHERE id = p_task_id
  RETURNING current_stock INTO v_new_stock;

  INSERT INTO public.operational_events (
    event_role, type, status, occurred_at, received_at,
    producer_type, actor_user_id, actor_name_snapshot, source_module, causation_event_id,
    payload, category, urgency, write_result
  ) VALUES (
    'derived_fact', 'PREP_STOCK_VERIFIED', 'completed', v_occurred_at, now(),
    'derived_event', v_user_id, v_user_name, 'station_prep', v_event_id,
    jsonb_build_object('task_id', p_task_id, 'counted_quantity', v_qty_native,
      'unit', v_task.unit, 'prev_stock', v_task.current_stock, 'diag_flag', v_diag_flag),
    'STOCK', 'normal', 'success'
  )
  RETURNING id INTO v_derived_id;

  INSERT INTO public.operational_event_transitions (event_id, transition, detail) VALUES
    (v_event_id, 'execution_completed', jsonb_build_object(
       'count_id', v_count_id, 'new_stock', v_new_stock,
       'derived_event_id', v_derived_id, 'diag_flag', v_diag_flag)),
    (v_event_id, 'completed', jsonb_build_object());

  UPDATE public.operational_events SET status='completed', write_result='success' WHERE id=v_event_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'event_id', v_event_id,
    'count', jsonb_build_object(
      'id', v_count_id, 'prep_task_id', p_task_id,
      'counted_qty', p_counted_quantity, 'unit', p_unit,
      'counted_by', v_user_name, 'source', 'kitchen_count', 'counted_at', v_occurred_at,
      'prev_bot_stock', v_task.current_stock, 'prev_bot_suggestion', v_task.suggested_qty,
      'prev_suggested_by', v_task.suggested_by
    ),
    'task', jsonb_build_object('id', p_task_id, 'current_stock', v_new_stock)
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_oee_record_stock_count(text, bigint, numeric, text, text, timestamptz, text)
  TO anon, authenticated;
