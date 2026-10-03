-- =====================================================================
-- XCF-ORDINI 01 — schema additivo per il flusso "Compila Ordine"
-- Progetto: ydqmumpytgrlceuinoqt — 02/10/2026 (GO Max, email "X Claude fatture")
--
-- Solo aggiunte: colonne NULLABLE (o con default) su purchase_orders /
-- purchase_order_lines, stati in piu' nel CHECK, tabelle nuove con RLS
-- attiva e nessuna policy (scrivibili solo dalle RPC SECURITY DEFINER).
-- Il frontend attuale (insert/select diretti, status 'draft') continua a
-- funzionare: nessuna colonna obbligatoria nuova, 'draft' resta valido.
-- RLS su purchase_orders / purchase_order_lines e' nella 03 (va applicata
-- insieme al rilascio del nuovo frontend).
-- Rollback: migrations/rollback/20261002_xcf_ordini_rollback.sql
-- =====================================================================

-- ── purchase_orders ────────────────────────────────────────────────────
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS delivery_date          date,
  ADD COLUMN IF NOT EXISTS channel                text,
  ADD COLUMN IF NOT EXISTS revision               integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS summary_json           jsonb,
  ADD COLUMN IF NOT EXISTS summary_hash           text,
  ADD COLUMN IF NOT EXISTS ready_at               timestamptz,
  ADD COLUMN IF NOT EXISTS ready_by               text,
  ADD COLUMN IF NOT EXISTS confirmed_hash         text,
  ADD COLUMN IF NOT EXISTS confirmed_at           timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by           text,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_id   bigint,
  ADD COLUMN IF NOT EXISTS sent_at                timestamptz,
  ADD COLUMN IF NOT EXISTS sent_by                text,
  ADD COLUMN IF NOT EXISTS send_mode              text,
  ADD COLUMN IF NOT EXISTS send_idempotency_key   text,
  ADD COLUMN IF NOT EXISTS vendor_order_number    text,
  ADD COLUMN IF NOT EXISTS vendor_document_id     uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_at        timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by        text,
  ADD COLUMN IF NOT EXISTS received_at            timestamptz,
  ADD COLUMN IF NOT EXISTS received_by            text,
  ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by           text,
  ADD COLUMN IF NOT EXISTS cancel_reason          text,
  ADD COLUMN IF NOT EXISTS created_by_user_id     bigint,
  ADD COLUMN IF NOT EXISTS is_test                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_run_id            text;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status = ANY (ARRAY['draft','ready','confirmed','sent','sent_manual','acknowledged','received','cancelled']::text[]));

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_send_mode_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_send_mode_check
  CHECK (send_mode IS NULL OR send_mode = ANY (ARRAY['real','simulated','manual']::text[]));

-- Un ordine "inviato" non e' mai solo simulato, salvo ordini di prova.
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_simulated_only_test;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_simulated_only_test
  CHECK (send_mode IS DISTINCT FROM 'simulated' OR is_test);

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_vendor_document_fk;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_vendor_document_fk
  FOREIGN KEY (vendor_document_id) REFERENCES public.vendor_documents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_send_idem_uq
  ON public.purchase_orders (send_idempotency_key) WHERE send_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_vendor_document_uq
  ON public.purchase_orders (vendor_document_id) WHERE vendor_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_orders_vendor_status_idx
  ON public.purchase_orders (vendor_name, status, sent_at);

-- ── purchase_order_lines ──────────────────────────────────────────────
ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS position               integer,
  ADD COLUMN IF NOT EXISTS pack_description       text,
  ADD COLUMN IF NOT EXISTS ingredient_vendor_id   uuid,
  ADD COLUMN IF NOT EXISTS needs_review           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS line_status            text,
  ADD COLUMN IF NOT EXISTS issues                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_price        numeric,
  ADD COLUMN IF NOT EXISTS reference_price_unit   text,
  ADD COLUMN IF NOT EXISTS reference_price_date   date,
  ADD COLUMN IF NOT EXISTS price_stale            boolean,
  ADD COLUMN IF NOT EXISTS received_status        text,
  ADD COLUMN IF NOT EXISTS received_qty           numeric,
  ADD COLUMN IF NOT EXISTS received_note          text,
  ADD COLUMN IF NOT EXISTS received_photo_url     text,
  ADD COLUMN IF NOT EXISTS received_at            timestamptz,
  ADD COLUMN IF NOT EXISTS received_by            text;

ALTER TABLE public.purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_line_status_check;
ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_line_status_check
  CHECK (line_status IS NULL OR line_status = ANY (ARRAY['ok','warning','incomplete','ambiguous','blocked']::text[]));
ALTER TABLE public.purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_received_status_check;
ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_received_status_check
  CHECK (received_status IS NULL OR received_status = ANY (ARRAY['received','missing','damaged','partial']::text[]));

CREATE INDEX IF NOT EXISTS purchase_order_lines_order_idx ON public.purchase_order_lines (purchase_order_id, position);

-- ── po_settings (configurazione, chiave/valore) ───────────────────────
CREATE TABLE IF NOT EXISTS public.po_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
INSERT INTO public.po_settings (key, value, note) VALUES
  ('price_stale_days',          '30'::jsonb,    'Prezzo di riferimento piu'' vecchio di N giorni = segnalato'),
  ('duplicate_window_hours',    '48'::jsonb,    'Finestra (ore) per sospetto doppio ordine allo stesso fornitore'),
  ('confirmation_link_days',    '7'::jsonb,     'Finestra (giorni) per cercare la conferma del fornitore dopo l''invio'),
  ('compiler_user_ids',         '[2,3]'::jsonb, 'Oltre agli admin, chi puo'' compilare: Anto (2), Tela (3)'),
  ('real_send_enabled',         'false'::jsonb, 'Invio reale ai fornitori. FALSE = solo simulazione. Lo abilita solo Max.'),
  ('timezone',                  '"America/Chicago"'::jsonb, 'Fuso per "oggi" (data consegna)')
ON CONFLICT (key) DO NOTHING;

-- ── po_vendor_channels (canale d'ordine per fornitore) ────────────────
CREATE TABLE IF NOT EXISTS public.po_vendor_channels (
  vendor_name             text PRIMARY KEY,
  channel                 text NOT NULL DEFAULT 'manual'
                          CHECK (channel = ANY (ARRAY['email','portal','phone','manual']::text[])),
  email_to                text,
  portal_url              text,
  document_vendor_names   text[] NOT NULL DEFAULT '{}'::text[],
  real_send_allowed       boolean NOT NULL DEFAULT false,
  notes                   text,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              text
);
-- Nessun indirizzo email inventato: i canali email li configura Max.
INSERT INTO public.po_vendor_channels (vendor_name, channel, document_vendor_names, notes) VALUES
  ('Hardie''s Fresh Foods / Dairyland Produce', 'manual', ARRAY['Hardie''s Fresh Foods / Dairyland Produce'], 'Canale da confermare da Max. Conferme "CONFIRMATION OF SALE" in vendor_documents.'),
  ('Ben E. Keith',      'portal', ARRAY['Ben E. Keith','bek'], 'Portale Entree, nessuna integrazione: riepilogo + registrazione invio manuale.'),
  ('Walmart',           'portal', ARRAY['Walmart','Walmart Business'], 'Walmart Business, nessuna integrazione.'),
  ('Fruge Seafood',     'manual', ARRAY['Fruge Seafood'], 'Canale da confermare da Max.'),
  ('FreshPoint Dallas', 'manual', ARRAY['FreshPoint Dallas'], 'Canale da confermare da Max.'),
  ('H-E-B',             'manual', ARRAY['H-E-B'], 'Acquisto in negozio.')
ON CONFLICT (vendor_name) DO NOTHING;

-- ── po_send_attempts (ogni tentativo di invio, idempotente) ───────────
CREATE TABLE IF NOT EXISTS public.po_send_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  idempotency_key     text NOT NULL,
  summary_hash        text NOT NULL,
  mode                text NOT NULL CHECK (mode = ANY (ARRAY['simulated','real']::text[])),
  channel             text,
  state               text NOT NULL DEFAULT 'pending'
                      CHECK (state = ANY (ARRAY['pending','simulated','sent','failed']::text[])),
  payload             jsonb,
  result              jsonb,
  created_by          text,
  created_by_user_id  bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  is_test             boolean NOT NULL DEFAULT false,
  test_run_id         text,
  CONSTRAINT po_send_attempts_idem_uq UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS po_send_attempts_order_idx ON public.po_send_attempts (purchase_order_id, created_at);

-- ── po_manual_sends (invii fatti a mano: da Brigade o fuori da Brigade) ─
CREATE TABLE IF NOT EXISTS public.po_manual_sends (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name          text NOT NULL,
  purchase_order_id    uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  idempotency_key      text,
  channel              text,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  vendor_order_number  text,
  note                 text,
  recorded_by          text,
  recorded_by_user_id  bigint,
  created_at           timestamptz NOT NULL DEFAULT now(),
  is_test              boolean NOT NULL DEFAULT false,
  test_run_id          text
);
CREATE UNIQUE INDEX IF NOT EXISTS po_manual_sends_idem_uq
  ON public.po_manual_sends (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS po_manual_sends_vendor_idx ON public.po_manual_sends (vendor_name, sent_at);

-- ── po_events (storico immutabile delle transizioni) ──────────────────
CREATE TABLE IF NOT EXISTS public.po_events (
  id                 bigserial PRIMARY KEY,
  purchase_order_id  uuid REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  event              text NOT NULL,
  from_status        text,
  to_status          text,
  actor              text,
  actor_user_id      bigint,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  is_test            boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS po_events_order_idx ON public.po_events (purchase_order_id, created_at);

-- ── po_complaint_drafts (BOZZE di reclamo: nessuno stato "inviato") ───
CREATE TABLE IF NOT EXISTS public.po_complaint_drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  vendor_name        text,
  status             text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft','discarded']::text[])),
  subject            text,
  body               text,
  lines              jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  is_test            boolean NOT NULL DEFAULT false,
  test_run_id        text
);

-- ── Tabelle nuove: RLS attiva, nessuna policy, nessun privilegio diretto ─
ALTER TABLE public.po_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_vendor_channels   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_send_attempts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_manual_sends      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_complaint_drafts  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.po_settings, public.po_vendor_channels, public.po_send_attempts,
              public.po_manual_sends, public.po_events, public.po_complaint_drafts
  FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.po_events_id_seq FROM anon, authenticated;
