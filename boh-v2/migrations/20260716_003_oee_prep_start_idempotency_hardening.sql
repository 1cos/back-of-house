-- =============================================================
-- OEE SESSION B.2B — PREP_STARTED IDEMPOTENCY HARDENING
-- Deployed: 2026-07-16
-- Project: ydqmumpytgrlceuinoqt
--
-- Hardens rpc_oee_record_prep_start idempotent replay:
--   When an existing completed event is found for p_client_operation_id,
--   validate that it matches the incoming request before treating as replay.
--   Matching rules:
--     event_role = 'root'
--     type       = 'PREP_STARTED'
--     (payload->>'task_id')::bigint = p_task_id
--     source_module = 'station_prep'
--   Match  → return original success with idempotent:true
--   Mismatch → return { ok:false, reason:'IDEMPOTENCY_KEY_CONFLICT', event_id }
--
--   Same rules applied in the concurrent UNIQUE-violation path.
--
-- Does NOT modify:
--   rpc_oee_record_prep_completion
--   rpc_oee_record_stock_count
--   any schema tables
-- =============================================================

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
  v_payload_task_id bigint;
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
  IF p_client_operation_id IS NULL OR length(trim(p_client_operation_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT',
      'detail', 'client_operation_id_required');
  END IF;

  v_occurred_at := COALESCE(p_occurred_at, now());

  -- ── 1. Session validation ────────────────────────────────────────────
  v_session_result := public.brigade_validate_session(p_token);
  IF NOT (v_session_result->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AUTH_ERROR',
      'detail', v_session_result->>'error');
  END IF;

  v_user_id   := (v_session_result->'user'->>'id')::bigint;
  v_user_name := v_session_result->'user'->>'name';
  v_user_role := COALESCE(v_session_result->'user'->>'role', 'staff');

  -- ── 2. Idempotency check (pre-insert) ──────────────────────────────
  -- If a completed event with this key already exists, validate it matches
  -- the incoming request before treating as a safe replay.
  SELECT id INTO v_event_id
  FROM public.operational_events
  WHERE client_operation_id = p_client_operation_id
    AND status = 'completed';

  IF FOUND THEN
    -- Read the payload task_id from the existing event.
    SELECT (payload->>'task_id')::bigint
    INTO v_payload_task_id
    FROM public.operational_events
    WHERE id = v_event_id;

    -- Validate: type, role, task_id, and source must all match.
    IF NOT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE id          = v_event_id
        AND type        = 'PREP_STARTED'
        AND event_role  = 'root'
        AND source_module = 'station_prep'
        AND (payload->>'task_id')::bigint = p_task_id
    ) THEN
      -- Same key, different operation — definitive conflict.
      RETURN jsonb_build_object(
        'ok',       false,
        'reason',   'IDEMPOTENCY_KEY_CONFLICT',
        'event_id', v_event_id
      );
    END IF;

    -- Exact match — safe replay.
    SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id;
    RETURN jsonb_build_object(
      'ok',         true,
      'idempotent', true,
      'event_id',   v_event_id,
      'task', jsonb_build_object(
        'id',             v_task.id,
        'in_progress',    v_task.in_progress,
        'in_progress_at', v_task.in_progress_at,
        'in_progress_by', v_task.in_progress_by
      )
    );
  END IF;

  -- ── 3. Lock task row (FOR UPDATE) ──────────────────────────────────
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

  -- ── 4. Insert event envelope (concurrency-safe via UNIQUE constraint) ─
  BEGIN
    INSERT INTO public.operational_events (
      event_role, type, status, occurred_at, received_at,
      producer_type, producer_id,
      actor_user_id, actor_name_snapshot,
      source_module,
      client_operation_id,
      payload, category, urgency,
      write_result
    ) VALUES (
      'root', 'PREP_STARTED', 'received', v_occurred_at, now(),
      'user_ui', p_producer_id,
      v_user_id, v_user_name,
      'station_prep',
      p_client_operation_id,
      jsonb_build_object('task_id', p_task_id), 'PREP', 'low',
      NULL
    )
    RETURNING id INTO v_event_id;

  EXCEPTION WHEN unique_violation THEN
    -- A concurrent call won the INSERT race with the same key.
    -- Apply the same matching rules as the pre-insert check.
    SELECT id INTO v_event_id
    FROM public.operational_events
    WHERE client_operation_id = p_client_operation_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE id          = v_event_id
        AND type        = 'PREP_STARTED'
        AND event_role  = 'root'
        AND source_module = 'station_prep'
        AND (payload->>'task_id')::bigint = p_task_id
    ) THEN
      -- Same key, different operation — concurrent conflict.
      RETURN jsonb_build_object(
        'ok',       false,
        'reason',   'IDEMPOTENCY_KEY_CONFLICT',
        'event_id', v_event_id
      );
    END IF;

    -- Matching concurrent replay.
    SELECT * INTO v_task FROM public.prep_tasks WHERE id = p_task_id;
    RETURN jsonb_build_object(
      'ok',         true,
      'idempotent', true,
      'event_id',   v_event_id,
      'task', jsonb_build_object(
        'id',             v_task.id,
        'in_progress',    v_task.in_progress,
        'in_progress_at', v_task.in_progress_at,
        'in_progress_by', v_task.in_progress_by
      )
    );
  END;

  -- ── 5. Transitions: received → authorized → execution_started ────────
  INSERT INTO public.operational_event_transitions (event_id, transition, detail)
  VALUES
    (v_event_id, 'received',          jsonb_build_object('client_operation_id', p_client_operation_id)),
    (v_event_id, 'authorized',        jsonb_build_object('user_id', v_user_id, 'role', v_user_role)),
    (v_event_id, 'execution_started', jsonb_build_object('task_id', p_task_id));

  -- ── 6. Domain write: mark task in-progress ───────────────────────────
  UPDATE public.prep_tasks SET
    in_progress    = true,
    in_progress_at = v_occurred_at,
    in_progress_by = v_user_name
  WHERE id = p_task_id AND archived IS NOT TRUE
  RETURNING * INTO v_task;

  IF NOT FOUND THEN
    UPDATE public.operational_events
    SET status = 'failed', write_result = 'failed',
        write_error = 'task_vanished_during_write'
    WHERE id = v_event_id;
    INSERT INTO public.operational_event_transitions (event_id, transition, detail)
    VALUES (v_event_id, 'execution_failed', jsonb_build_object('error', 'task_vanished')),
           (v_event_id, 'failed',           jsonb_build_object());
    RETURN jsonb_build_object('ok', false, 'reason', 'TASK_NOT_FOUND',
      'event_id', v_event_id);
  END IF;

  -- ── 7. Transitions: execution_completed → completed ──────────────────
  INSERT INTO public.operational_event_transitions (event_id, transition, detail)
  VALUES
    (v_event_id, 'execution_completed', jsonb_build_object(
       'task_id', p_task_id, 'in_progress_at', v_occurred_at)),
    (v_event_id, 'completed', jsonb_build_object());

  -- ── 8. Finalize event status ──────────────────────────────────────────
  UPDATE public.operational_events
  SET status = 'completed', write_result = 'success'
  WHERE id = v_event_id;

  -- ── 9. Return ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'ok',         true,
    'idempotent', false,
    'event_id',   v_event_id,
    'task', jsonb_build_object(
      'id',             v_task.id,
      'in_progress',    v_task.in_progress,
      'in_progress_at', v_task.in_progress_at,
      'in_progress_by', v_task.in_progress_by
    )
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_oee_record_prep_start(text, bigint, text, timestamptz, text)
  TO anon, authenticated;
