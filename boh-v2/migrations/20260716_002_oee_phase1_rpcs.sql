-- =============================================================
-- OEE PHASE 1 — ATOMIC RPCS
-- Deployed: 2026-07-16 (Session A)
-- Project: ydqmumpytgrlceuinoqt
--
-- Creates:
--   rpc_oee_record_prep_start
--   rpc_oee_record_prep_completion
--   rpc_oee_record_stock_count
--
-- All three are CREATE OR REPLACE — idempotent to re-apply.
-- Requires operational_events and operational_event_transitions from
-- migration 001 to already exist.
-- =============================================================

-- ── rpc_oee_record_prep_start ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_oee_record_prep_start(
  p_token               text,
  p_task_id             bigint,
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
  v_event_id        uuid;
  v_occurred_at     timestamptz;
BEGIN

  IF p_token IS NULL OR length(p_token) <> 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'token_required');
  END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'task_id_required');
  END IF;
  IF p_client_operation_id IS NULL OR length(trim(p_client_operation_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'client_operation_id_required');
  END IF;

  v_occurred_at := COALESCE(p_occurred_at, now());

  v_session_result := public.brigade_validate_session(p_token);
  IF NOT (v_session_result->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AUTH_ERROR', 'detail', v_session_result->>'error');
  END IF;

  v_user_id   := (v_session_result->'user'->>'id')::bigint;
  v_user_name := v_session_result->'user'->>'name';
  v_user_role := COALESCE(v_session_result->'user'->>'role', 'staff');

  SELECT id INTO v_event_id
  FROM public.operational_events
  WHERE client_operation_id = p_client_operation_id
    AND status = 'completed';

  IF FOUND THEN
    SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id;
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'event_id', v_event_id,
      'task', jsonb_build_object(
        'id', v_task.id, 'in_progress', v_task.in_progress,
        'in_progress_at', v_task.in_progress_at, 'in_progress_by', v_task.in_progress_by
      )
    );
  END IF;

  SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND');
  END IF;
  IF v_task.archived = true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND', 'detail', 'archived');
  END IF;

  BEGIN
    INSERT INTO public.operational_events (
      event_role, type, status, occurred_at, received_at,
      producer_type, producer_id, actor_user_id, actor_name_snapshot,
      source_module, client_operation_id, payload, category, urgency, write_result
    ) VALUES (
      'root', 'PREP_STARTED', 'received', v_occurred_at, now(),
      'user_ui', p_producer_id, v_user_id, v_user_name,
      'station_prep', p_client_operation_id,
      jsonb_build_object('task_id', p_task_id), 'PREP', 'low', NULL
    )
    RETURNING id INTO v_event_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_event_id FROM public.operational_events WHERE client_operation_id = p_client_operation_id;
    SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id;
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'event_id', v_event_id,
      'task', jsonb_build_object(
        'id', v_task.id, 'in_progress', v_task.in_progress,
        'in_progress_at', v_task.in_progress_at, 'in_progress_by', v_task.in_progress_by
      )
    );
  END;

  INSERT INTO public.operational_event_transitions (event_id, transition, detail)
  VALUES
    (v_event_id, 'received',          jsonb_build_object('client_operation_id', p_client_operation_id)),
    (v_event_id, 'authorized',        jsonb_build_object('user_id', v_user_id, 'role', v_user_role)),
    (v_event_id, 'execution_started', jsonb_build_object('task_id', p_task_id));

  UPDATE public.prep_tasks SET
    in_progress    = true,
    in_progress_at = v_occurred_at,
    in_progress_by = v_user_name
  WHERE id = p_task_id AND archived IS NOT TRUE
  RETURNING * INTO v_task;

  IF NOT FOUND THEN
    UPDATE public.operational_events
    SET status = 'failed', write_result = 'failed', write_error = 'task_vanished_during_write'
    WHERE id = v_event_id;
    INSERT INTO public.operational_event_transitions (event_id, transition, detail)
    VALUES (v_event_id, 'execution_failed', jsonb_build_object('error', 'task_vanished')),
           (v_event_id, 'failed', jsonb_build_object());
    RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND', 'event_id', v_event_id);
  END IF;

  INSERT INTO public.operational_event_transitions (event_id, transition, detail)
  VALUES
    (v_event_id, 'execution_completed', jsonb_build_object('task_id', p_task_id, 'in_progress_at', v_occurred_at)),
    (v_event_id, 'completed', jsonb_build_object());

  UPDATE public.operational_events SET status = 'completed', write_result = 'success' WHERE id = v_event_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'event_id', v_event_id,
    'task', jsonb_build_object(
      'id', v_task.id, 'in_progress', v_task.in_progress,
      'in_progress_at', v_task.in_progress_at, 'in_progress_by', v_task.in_progress_by
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_oee_record_prep_start(text, bigint, text, timestamptz, text)
  TO anon, authenticated;

-- ── rpc_oee_record_prep_completion (full body from live DB) ────────────────

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
  v_task_unit       text;
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
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'token_required');
  END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'task_id_required');
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'quantity_must_be_positive');
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
  SELECT oe.id INTO v_event_id FROM public.operational_events oe
  WHERE oe.client_operation_id = p_client_operation_id AND oe.status = 'completed';
  IF FOUND THEN
    DECLARE
      v_log_row  public.prep_log%ROWTYPE;
      v_task_row public.prep_tasks%ROWTYPE;
    BEGIN
      SELECT pl.* INTO v_log_row FROM public.prep_log pl WHERE pl.operational_event_id = v_event_id LIMIT 1;
      SELECT pt.* INTO v_task_row FROM public.prep_tasks pt WHERE pt.id = p_task_id;
      RETURN jsonb_build_object(
        'ok', true, 'idempotent', true, 'event_id', v_event_id,
        'log', jsonb_build_object('item', v_log_row.item, 'station', v_log_row.station,
          'qty', v_log_row.qty, 'unit', v_log_row.unit, 'user_name', v_log_row.user_name,
          'started_at', v_log_row.started_at, 'duration_minutes', v_log_row.duration_minutes,
          'is_suggested_qty', v_log_row.is_suggested_qty, 'created_at', v_log_row.created_at),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock,
          'need_tomorrow', v_task_row.need_tomorrow, 'in_progress', v_task_row.in_progress,
          'in_progress_at', v_task_row.in_progress_at, 'in_progress_by', v_task_row.in_progress_by));
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
  IF v_inp = '' OR v_inp = v_tsk THEN v_qty_native := p_quantity;
  ELSIF v_inp = 'kg' AND v_tsk = 'g' THEN v_qty_native := p_quantity * 1000;
  ELSIF v_inp = 'g' AND v_tsk = 'kg' THEN v_qty_native := p_quantity / 1000;
  ELSE RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'unit_conversion_unsupported', 'from', p_unit, 'to', v_task.unit);
  END IF;
  v_max_qty := CASE WHEN v_tsk='g' THEN 50000 WHEN v_tsk='kg' THEN 50 WHEN v_tsk='pz' THEN 500 WHEN v_tsk='nests' THEN 200 ELSE 200 END;
  IF v_qty_native > v_max_qty THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'qty_exceeds_maximum', 'qty_native', v_qty_native, 'max', v_max_qty, 'unit', v_task.unit);
  END IF;
  IF p_in_progress_at IS NOT NULL THEN
    v_duration_min := GREATEST(0, ROUND(EXTRACT(EPOCH FROM (v_occurred_at - p_in_progress_at)) / 60)::integer);
  ELSE v_duration_min := NULL; END IF;
  BEGIN
    INSERT INTO public.operational_events (event_role, type, status, occurred_at, received_at,
      producer_type, producer_id, actor_user_id, actor_name_snapshot, source_module, client_operation_id,
      payload, category, urgency)
    VALUES ('root', 'PREP_COMPLETED', 'received', v_occurred_at, now(),
      'user_ui', p_producer_id, v_user_id, v_user_name, 'station_prep', p_client_operation_id,
      jsonb_build_object('task_id', p_task_id, 'quantity', p_quantity, 'unit', p_unit), 'PREP', 'low')
    RETURNING id INTO v_event_id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_sleep(0.1);
    SELECT id INTO v_event_id FROM public.operational_events WHERE client_operation_id = p_client_operation_id;
    DECLARE
      v_log_row  public.prep_log%ROWTYPE;
      v_task_row public.prep_tasks%ROWTYPE;
    BEGIN
      SELECT pl.* INTO v_log_row FROM public.prep_log pl WHERE pl.operational_event_id = v_event_id LIMIT 1;
      SELECT pt.* INTO v_task_row FROM public.prep_tasks pt WHERE pt.id = p_task_id;
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'event_id', v_event_id,
        'log', jsonb_build_object('item', v_log_row.item, 'station', v_log_row.station,
          'qty', v_log_row.qty, 'unit', v_log_row.unit, 'user_name', v_log_row.user_name,
          'started_at', v_log_row.started_at, 'duration_minutes', v_log_row.duration_minutes,
          'is_suggested_qty', v_log_row.is_suggested_qty, 'created_at', v_log_row.created_at),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock,
          'need_tomorrow', v_task_row.need_tomorrow, 'in_progress', v_task_row.in_progress,
          'in_progress_at', v_task_row.in_progress_at, 'in_progress_by', v_task_row.in_progress_by));
    END;
  END;
  INSERT INTO public.operational_event_transitions (event_id, transition, detail) VALUES
    (v_event_id, 'received', jsonb_build_object('client_operation_id', p_client_operation_id)),
    (v_event_id, 'authorized', jsonb_build_object('user_id', v_user_id, 'role', v_user_role)),
    (v_event_id, 'execution_started', jsonb_build_object('task_id', p_task_id, 'qty_native', v_qty_native));
  INSERT INTO public.prep_log (item, station, qty, unit, user_name, is_suggested_qty,
    started_at, duration_minutes, prep_task_id, client_key, operational_event_id)
  VALUES (v_task.name, v_task.category, p_quantity, p_unit, v_user_name,
    COALESCE(p_is_suggested_qty, false), p_in_progress_at, v_duration_min,
    p_task_id, v_client_key_uuid, v_event_id)
  RETURNING id INTO v_log_id;
  v_base_stock := COALESCE(v_task.current_stock, 0);
  v_new_stock  := v_base_stock + v_qty_native;
  UPDATE public.prep_tasks SET
    current_stock=v_new_stock, in_progress=false, in_progress_at=NULL, in_progress_by=NULL,
    need_tomorrow=false, suggested_qty=NULL, suggested_note=NULL
  WHERE id = p_task_id;
  SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id;
  INSERT INTO public.operational_events (event_role, type, status, occurred_at, received_at,
    producer_type, actor_user_id, actor_name_snapshot, source_module, causation_event_id,
    payload, category, urgency, write_result)
  VALUES ('derived_fact', 'PREP_STOCK_UPDATED', 'completed', v_occurred_at, now(),
    'derived_event', v_user_id, v_user_name, 'station_prep', v_event_id,
    jsonb_build_object('task_id', p_task_id, 'previous_stock', v_base_stock,
      'new_stock', v_new_stock, 'delta', v_qty_native, 'source', 'prep_completion'),
    'PREP', 'low', 'success')
  RETURNING id INTO v_derived_id;
  INSERT INTO public.operational_event_transitions (event_id, transition, detail) VALUES
    (v_event_id, 'execution_completed', jsonb_build_object('log_id', v_log_id, 'new_stock', v_new_stock, 'derived_event_id', v_derived_id)),
    (v_event_id, 'completed', jsonb_build_object());
  UPDATE public.operational_events SET status='completed', write_result='success' WHERE id=v_event_id;
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'event_id', v_event_id,
    'log', jsonb_build_object('item', v_task.name, 'station', v_task.category, 'qty', p_quantity,
      'unit', p_unit, 'user_name', v_user_name, 'started_at', p_in_progress_at,
      'duration_minutes', v_duration_min, 'is_suggested_qty', COALESCE(p_is_suggested_qty, false), 'created_at', now()),
    'task', jsonb_build_object('id', v_task.id, 'current_stock', v_task.current_stock,
      'need_tomorrow', v_task.need_tomorrow, 'in_progress', v_task.in_progress,
      'in_progress_at', v_task.in_progress_at, 'in_progress_by', v_task.in_progress_by));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_oee_record_prep_completion(text, bigint, numeric, text, text, timestamptz, timestamptz, boolean, text)
  TO anon, authenticated;

-- ── rpc_oee_record_stock_count (full body from live DB) ────────────────────

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
  IF p_token IS NULL OR length(p_token) <> 64 THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'token_required'); END IF;
  IF p_task_id IS NULL OR p_task_id <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'task_id_required'); END IF;
  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'counted_quantity_must_be_non_negative'); END IF;
  IF p_unit IS NULL OR length(trim(p_unit)) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'unit_required'); END IF;
  IF p_client_operation_id IS NULL OR length(trim(p_client_operation_id)) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'client_operation_id_required'); END IF;
  v_occurred_at := COALESCE(p_occurred_at, now());
  BEGIN v_client_key_uuid := p_client_operation_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'client_operation_id_must_be_uuid'); END;
  v_session_result := public.brigade_validate_session(p_token);
  IF NOT (v_session_result->>'ok')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', 'AUTH_ERROR', 'detail', v_session_result->>'error'); END IF;
  v_user_id   := (v_session_result->'user'->>'id')::bigint;
  v_user_name := v_session_result->'user'->>'name';
  v_user_role := COALESCE(v_session_result->'user'->>'role', 'staff');
  SELECT oe.id INTO v_event_id FROM public.operational_events oe WHERE oe.client_operation_id = p_client_operation_id AND oe.status = 'completed';
  IF FOUND THEN
    DECLARE v_count_row public.prep_stock_counts%ROWTYPE; v_task_row public.prep_tasks%ROWTYPE; BEGIN
      SELECT psc.* INTO v_count_row FROM public.prep_stock_counts psc WHERE psc.operational_event_id = v_event_id LIMIT 1;
      SELECT pt.* INTO v_task_row FROM public.prep_tasks pt WHERE pt.id = p_task_id;
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'event_id', v_event_id,
        'count', jsonb_build_object('id', v_count_row.id, 'prep_task_id', v_count_row.prep_task_id,
          'counted_qty', v_count_row.counted_qty, 'unit', v_count_row.unit, 'counted_by', v_count_row.counted_by,
          'source', v_count_row.source, 'counted_at', v_count_row.counted_at, 'prev_bot_stock', v_count_row.prev_bot_stock,
          'prev_bot_suggestion', v_count_row.prev_bot_suggestion, 'prev_suggested_by', v_count_row.prev_suggested_by),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock));
    END;
  END IF;
  SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND'); END IF;
  IF v_task.archived = true THEN RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND', 'detail', 'archived'); END IF;
  v_inp := lower(trim(COALESCE(p_unit, ''))); v_tsk := lower(trim(COALESCE(v_task.unit, '')));
  IF v_inp IN ('pz','pezzi','each','pieces','pcs','piece') THEN v_inp := 'pz'; END IF;
  IF v_tsk IN ('pz','pezzi','each','pieces','pcs','piece','checklist') THEN v_tsk := 'pz'; END IF;
  IF v_inp NOT IN ('pz','g','kg','nests','cup','buste','filetto','mazzi','batch','squeezer','porzioni','') THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'unit_not_allowed', 'unit', p_unit); END IF;
  IF v_tsk = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'task_unit_missing'); END IF;
  IF v_inp = '' OR v_inp = v_tsk THEN v_qty_native := p_counted_quantity;
  ELSIF v_inp = 'kg' AND v_tsk = 'g' THEN v_qty_native := p_counted_quantity * 1000;
  ELSIF v_inp = 'g' AND v_tsk = 'kg' THEN v_qty_native := p_counted_quantity / 1000;
  ELSE RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'unit_conversion_unsupported', 'from', p_unit, 'to', v_task.unit); END IF;
  IF v_qty_native < 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT', 'detail', 'qty_must_be_non_negative'); END IF;
  IF v_task.current_stock IS NULL THEN v_diag_flag := false; v_diag_reason := 'no_prior_stock';
  ELSIF v_task.current_stock = 0 THEN v_diag_flag := false; v_diag_reason := 'prior_stock_zero';
  ELSE
    v_abs_delta := abs(v_qty_native - v_task.current_stock); v_rel_delta := v_abs_delta / v_task.current_stock;
    v_thr_abs := CASE v_tsk WHEN 'g' THEN 2000 WHEN 'kg' THEN 2 WHEN 'pz' THEN 10 WHEN 'nests' THEN 20 ELSE NULL END;
    v_diag_flag := (v_rel_delta > v_thr_rel) AND (v_thr_abs IS NULL OR v_abs_delta > v_thr_abs);
    v_diag_reason := CASE WHEN v_diag_flag THEN 'threshold_exceeded' ELSE 'within_threshold' END;
  END IF;
  BEGIN
    INSERT INTO public.operational_events (event_role, type, status, occurred_at, received_at,
      producer_type, producer_id, actor_user_id, actor_name_snapshot, source_module, client_operation_id,
      payload, category, urgency, diagnostic_metadata)
    VALUES ('root', 'STOCK_COUNT_RECORDED', 'received', v_occurred_at, now(),
      'user_ui', p_producer_id, v_user_id, v_user_name, 'station_prep', p_client_operation_id,
      jsonb_build_object('task_id', p_task_id, 'counted_quantity', p_counted_quantity, 'unit', p_unit),
      'STOCK', 'normal',
      jsonb_build_object('diag_flag', v_diag_flag, 'diag_reason', v_diag_reason,
        'relative_delta', v_rel_delta, 'absolute_delta', v_abs_delta,
        'threshold_relative', v_thr_rel, 'threshold_absolute', v_thr_abs, 'prior_stock', v_task.current_stock))
    RETURNING id INTO v_event_id;
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_sleep(0.1);
    SELECT id INTO v_event_id FROM public.operational_events WHERE client_operation_id = p_client_operation_id;
    DECLARE v_count_row public.prep_stock_counts%ROWTYPE; v_task_row public.prep_tasks%ROWTYPE; BEGIN
      SELECT psc.* INTO v_count_row FROM public.prep_stock_counts psc WHERE psc.operational_event_id = v_event_id LIMIT 1;
      SELECT pt.* INTO v_task_row FROM public.prep_tasks pt WHERE pt.id = p_task_id;
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'event_id', v_event_id,
        'count', jsonb_build_object('id', v_count_row.id, 'prep_task_id', v_count_row.prep_task_id,
          'counted_qty', v_count_row.counted_qty, 'unit', v_count_row.unit, 'counted_by', v_count_row.counted_by,
          'source', v_count_row.source, 'counted_at', v_count_row.counted_at,
          'prev_bot_stock', v_count_row.prev_bot_stock, 'prev_bot_suggestion', v_count_row.prev_bot_suggestion,
          'prev_suggested_by', v_count_row.prev_suggested_by),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock));
    END;
  END;
  INSERT INTO public.operational_event_transitions (event_id, transition, detail) VALUES
    (v_event_id, 'received', jsonb_build_object('client_operation_id', p_client_operation_id)),
    (v_event_id, 'authorized', jsonb_build_object('user_id', v_user_id, 'role', v_user_role)),
    (v_event_id, 'execution_started', jsonb_build_object('task_id', p_task_id, 'qty_native', v_qty_native));
  INSERT INTO public.prep_stock_counts (prep_task_id, counted_qty, unit, qty_native, counted_by, counted_at,
    source, prev_bot_stock, prev_bot_suggestion, prev_suggested_by, client_key, operational_event_id)
  VALUES (p_task_id, p_counted_quantity, p_unit, v_qty_native, v_user_name, v_occurred_at, 'kitchen_count',
    v_task.current_stock, v_task.suggested_qty, v_task.suggested_by, v_client_key_uuid, v_event_id)
  ON CONFLICT (client_key) DO NOTHING
  RETURNING id INTO v_count_id;
  IF v_count_id IS NULL THEN
    DECLARE v_exist_count public.prep_stock_counts%ROWTYPE; v_task_row public.prep_tasks%ROWTYPE; BEGIN
      SELECT * INTO v_exist_count FROM public.prep_stock_counts WHERE client_key = v_client_key_uuid;
      SELECT * INTO v_task_row FROM public.prep_tasks WHERE id = p_task_id;
      UPDATE public.operational_events SET status='completed', write_result='success' WHERE id=v_event_id;
      INSERT INTO public.operational_event_transitions (event_id, transition, detail) VALUES
        (v_event_id, 'execution_completed', jsonb_build_object('duplicate_count_skipped', true)),
        (v_event_id, 'completed', jsonb_build_object());
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'event_id', v_event_id,
        'count', jsonb_build_object('id', v_exist_count.id, 'prep_task_id', v_exist_count.prep_task_id,
          'counted_qty', v_exist_count.counted_qty, 'unit', v_exist_count.unit, 'counted_by', v_exist_count.counted_by,
          'source', v_exist_count.source, 'counted_at', v_exist_count.counted_at,
          'prev_bot_stock', v_exist_count.prev_bot_stock, 'prev_bot_suggestion', v_exist_count.prev_bot_suggestion,
          'prev_suggested_by', v_exist_count.prev_suggested_by),
        'task', jsonb_build_object('id', v_task_row.id, 'current_stock', v_task_row.current_stock));
    END;
  END IF;
  UPDATE public.prep_tasks SET current_stock = v_qty_native WHERE id = p_task_id RETURNING current_stock INTO v_new_stock;
  INSERT INTO public.operational_events (event_role, type, status, occurred_at, received_at,
    producer_type, actor_user_id, actor_name_snapshot, source_module, causation_event_id, payload, category, urgency, write_result)
  VALUES ('derived_fact', 'PREP_STOCK_VERIFIED', 'completed', v_occurred_at, now(),
    'derived_event', v_user_id, v_user_name, 'station_prep', v_event_id,
    jsonb_build_object('task_id', p_task_id, 'counted_quantity', v_qty_native, 'unit', v_task.unit,
      'prev_stock', v_task.current_stock, 'diag_flag', v_diag_flag),
    'STOCK', 'normal', 'success')
  RETURNING id INTO v_derived_id;
  INSERT INTO public.operational_event_transitions (event_id, transition, detail) VALUES
    (v_event_id, 'execution_completed', jsonb_build_object('count_id', v_count_id, 'new_stock', v_new_stock, 'derived_event_id', v_derived_id, 'diag_flag', v_diag_flag)),
    (v_event_id, 'completed', jsonb_build_object());
  UPDATE public.operational_events SET status='completed', write_result='success' WHERE id=v_event_id;
  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'event_id', v_event_id,
    'count', jsonb_build_object('id', v_count_id, 'prep_task_id', p_task_id, 'counted_qty', p_counted_quantity,
      'unit', p_unit, 'counted_by', v_user_name, 'source', 'kitchen_count', 'counted_at', v_occurred_at,
      'prev_bot_stock', v_task.current_stock, 'prev_bot_suggestion', v_task.suggested_qty, 'prev_suggested_by', v_task.suggested_by),
    'task', jsonb_build_object('id', p_task_id, 'current_stock', v_new_stock));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_oee_record_stock_count(text, bigint, numeric, text, text, timestamptz, text)
  TO anon, authenticated;
