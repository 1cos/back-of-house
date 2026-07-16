-- =============================================================
-- OEE PHASE 1 — ADDITIVE SCHEMA
-- Deployed: 2026-07-16 (Session A)
-- Project: ydqmumpytgrlceuinoqt
--
-- Creates: operational_events, operational_event_transitions
-- Adds nullable FK columns to prep_log and prep_stock_counts
--
-- IDEMPOTENT: All objects use IF NOT EXISTS or CREATE OR REPLACE.
-- Safe to inspect; do not re-apply if objects already exist.
-- =============================================================

-- ── 1. operational_events ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.operational_events (
  -- Identity
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_role          text        NOT NULL,
  type                text        NOT NULL,
  status              text        NOT NULL DEFAULT 'received',
  occurred_at         timestamptz NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),

  -- Producer (Phase 1: always user_ui)
  producer_type       text        NOT NULL DEFAULT 'user_ui',
  producer_id         text,

  -- Actor (resolved server-side from the session)
  actor_user_id       bigint      REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name_snapshot text        NOT NULL,

  -- Source
  source_module       text,

  -- Idempotency
  client_operation_id text        UNIQUE,

  -- Payload (raw, immutable after insert)
  payload             jsonb       NOT NULL DEFAULT '{}',

  -- Classification metadata
  category            text,
  urgency             text,

  -- Causation (derived facts only)
  causation_event_id  uuid        REFERENCES public.operational_events(id),

  -- Execution result
  write_result        text,
  write_error         text,

  -- Diagnostic metadata
  diagnostic_metadata jsonb       NOT NULL DEFAULT '{}',

  CONSTRAINT oe_event_role_check CHECK (
    event_role = ANY (ARRAY['root'::text, 'derived_fact'::text])
  ),
  CONSTRAINT oe_status_check CHECK (
    status = ANY (ARRAY[
      'received'::text, 'authorized'::text, 'execution_started'::text,
      'execution_completed'::text, 'execution_failed'::text,
      'completed'::text, 'failed'::text,
      'context_resolved'::text, 'proposal_created'::text,
      'pending_confirmation'::text, 'confirmation_received'::text,
      'confirmation_dismissed'::text, 'confirmation_expired'::text,
      'notification_dispatched'::text, 'cancelled'::text
    ])
  ),
  CONSTRAINT oe_category_check CHECK (
    (category = ANY (ARRAY[
      'PREP'::text, 'STOCK'::text, 'RECEIVING'::text,
      'WASTE'::text, 'STAFF'::text, 'SYSTEM'::text
    ])) OR (category IS NULL)
  ),
  CONSTRAINT oe_urgency_check CHECK (
    (urgency = ANY (ARRAY['critical'::text, 'high'::text, 'normal'::text, 'low'::text]))
    OR (urgency IS NULL)
  ),
  CONSTRAINT oe_write_result_check CHECK (
    (write_result = ANY (ARRAY['success'::text, 'failed'::text]))
    OR (write_result IS NULL)
  ),
  CONSTRAINT oe_producer_type_check CHECK (
    producer_type = ANY (ARRAY[
      'user_ui'::text, 'edge_function'::text, 'pipeline'::text,
      'webhook'::text, 'system_rule'::text, 'derived_event'::text
    ])
  )
);

CREATE INDEX IF NOT EXISTS idx_oe_actor     ON public.operational_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_oe_type      ON public.operational_events (type);
CREATE INDEX IF NOT EXISTS idx_oe_status    ON public.operational_events (status);
CREATE INDEX IF NOT EXISTS idx_oe_occurred  ON public.operational_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_oe_category  ON public.operational_events (category, status);
CREATE INDEX IF NOT EXISTS idx_oe_causation ON public.operational_events (causation_event_id);

-- ── 2. operational_event_transitions ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.operational_event_transitions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL
                              REFERENCES public.operational_events(id)
                              ON DELETE CASCADE,
  transition      text        NOT NULL,
  transitioned_at timestamptz NOT NULL DEFAULT now(),
  transitioned_by text        NOT NULL DEFAULT 'rpc',
  detail          jsonb       NOT NULL DEFAULT '{}',

  CONSTRAINT oet_transition_check CHECK (
    transition = ANY (ARRAY[
      'received'::text, 'authorized'::text, 'execution_started'::text,
      'execution_completed'::text, 'execution_failed'::text,
      'completed'::text, 'failed'::text,
      'context_resolved'::text, 'proposal_created'::text,
      'pending_confirmation'::text, 'confirmation_received'::text,
      'confirmation_dismissed'::text, 'confirmation_expired'::text,
      'notification_dispatched'::text, 'cancelled'::text,
      'recovery_detected'::text
    ])
  )
);

CREATE INDEX IF NOT EXISTS idx_oet_event      ON public.operational_event_transitions (event_id, transitioned_at);
CREATE INDEX IF NOT EXISTS idx_oet_transition ON public.operational_event_transitions (transition, transitioned_at DESC);

-- ── 3. Nullable FK columns on existing tables ───────────────────────────────

ALTER TABLE public.prep_log
  ADD COLUMN IF NOT EXISTS operational_event_id uuid
    REFERENCES public.operational_events(id) ON DELETE SET NULL;

ALTER TABLE public.prep_stock_counts
  ADD COLUMN IF NOT EXISTS operational_event_id uuid
    REFERENCES public.operational_events(id) ON DELETE SET NULL;
