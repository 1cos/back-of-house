-- ============================================================
-- pos_modifier_depletion_rules v3 — Schema + Righe Proposte
-- Brigade · Zenos on the Square · Weatherford TX
-- Aggiornato: Phase 2.2 — 8 luglio 2026
-- NON APPLICARE senza approvazione Max
-- ============================================================
--
-- FILOSOFIA (Phase 2.2):
--   Il cuoco scrive nella misura che conosce.
--   La app converte. Mai chiedere al cuoco quanti grammi sono 2 fl oz.
--
--   display_qty       = quello che il cuoco/server vede ("2 fl oz ramekin")
--   qty_per_modifier  = il numero che ha digitato il cuoco (2)
--   unit              = l'unità che ha usato ("fl_oz")
--   normalized_qty_g  = quello che usa il bot (59.147g)
--   normalized_qty_ml = cross-check volume (59.147ml)
--   density_g_per_ml  = 1.0 default; affinabile per ricetta specifica
--   usage_mode        = 'fixed_quantity' (qty fisica) o 'use_recipe_serving' (usa BOM/yield ricetta)
--                       o 'no_depletion' (no scarico stock)
--
-- REGOLA CUCINA CONFERMATA (Max, 8 lug 2026):
--   TUTTI i salad dressing vengono serviti nello stesso ramekin da 2 fl oz.
--   Source of truth = 2 fl oz ramekin.
--   I vecchi valori 74g (Balsamic/Ranch) e 78g (Citronette) erano dati legacy nel DB
--   e NON sono più una scelta aperta — sono superati dalla regola cucina.
--
-- REGOLA FONDAMENTALE: active=false per TUTTO.
-- Solo confidence='confirmed' + active=true viene letto dal bot (Fase 3).
-- ============================================================

-- Unit conversion reference (embedded dalla unit_conversion_table del DB):
-- 1 fl_oz  = 29.5735 ml   → con density=1.0 → 29.5735 g
-- 2 fl_oz  = 59.147  ml   → con density=1.0 → 59.147  g  (≈ 60g operativo)
-- 1 cup    = 236.588 ml
-- 1 L      = 1000    ml
-- 1 kg     = 1000    g
-- buste    = 907     g    (Spring Mix bag — da unit_conversion_table)

CREATE TABLE IF NOT EXISTS pos_modifier_depletion_rules (
  id                    uuid          DEFAULT gen_random_uuid() PRIMARY KEY,

  -- ── IDENTIFICAZIONE MODIFIER ──────────────────────────────────────────────
  modifier_canonical    text          NOT NULL,
  modifier_aliases      text[]        NOT NULL DEFAULT '{}',

  -- ── TARGET DEPLETION ─────────────────────────────────────────────────────
  linked_recipe_id      uuid          REFERENCES recipes(id) ON DELETE SET NULL,
  linked_prep_task_id   bigint        REFERENCES prep_tasks(id) ON DELETE SET NULL,

  -- ── MODALITÀ DI SCARICO ──────────────────────────────────────────────────
  usage_mode            text          NOT NULL DEFAULT 'fixed_quantity'
                        CHECK (usage_mode IN ('fixed_quantity', 'use_recipe_serving', 'no_depletion')),
  -- fixed_quantity:     usa i campi qty/unit/normalized qui sotto
  -- use_recipe_serving: consuma 1 porzione logica della ricetta collegata usando
  --                     la resa/BOM della ricetta come source of truth.
  --                     Esempio: + Add Chicken → linked_recipe = Add Chicken →
  --                     la ricetta sa già cosa contiene, non chiedere di nuovo in grammi.
  --                     Esempio: + Meatballs → Meatball Appetizer → use_recipe_serving.
  -- no_depletion:       modifier non scarica stock (es. preferenza, istruzione cucina)

  -- ── QUANTITÀ — CHEF FACING (quello che vede e capisce il cuoco) ──────────
  display_qty           text,
  -- Stringa leggibile. Es: "2 fl oz ramekin", "1 pezzo", "160g"
  -- Questo non viene mai parsato — è solo per display e audit.

  qty_per_modifier      numeric       CHECK (qty_per_modifier IS NULL OR qty_per_modifier > 0),
  -- Il numero scritto dal cuoco. NULL = da confermare.

  unit                  text          NOT NULL DEFAULT 'g',
  -- Unità originale del cuoco. Es: 'fl_oz', 'g', 'ml', 'pezzi', 'nests'

  -- ── QUANTITÀ — BOT FACING (calcolato da unit-normalizer.js) ─────────────
  normalized_qty_ml     numeric,
  -- Millilitri normalizzati. NULL per unità peso o count.
  -- Calcolo: qty_per_modifier × conversion_factor(unit→ml)

  normalized_qty_g      numeric,
  -- Grammi normalizzati. NULL per count.
  -- Calcolo: normalized_qty_ml × density_g_per_ml (per volumi)
  --          OPPURE: qty_per_modifier × conversion_factor(unit→g) (per pesi)

  density_g_per_ml      numeric       NOT NULL DEFAULT 1.0,
  -- Densità g/ml usata per conversione volume↔peso.
  -- Default 1.0 (≈ acqua, valido per dressings a base acqua/olio leggero).
  -- Affinabile per ricetta specifica se necessario.

  -- ── CONTROLLO ────────────────────────────────────────────────────────────
  confidence            text          NOT NULL DEFAULT 'review'
                        CHECK (confidence IN ('confirmed','estimated','review','missing')),
  active                boolean       NOT NULL DEFAULT false,

  -- Constraint: solo 'confirmed' può essere attivato
  CONSTRAINT no_active_unconfirmed
    CHECK (NOT (active = true AND confidence != 'confirmed')),

  -- Constraint: fixed_quantity richiede qty e unit
  CONSTRAINT fixed_qty_requires_values
    CHECK (usage_mode != 'fixed_quantity' OR (qty_per_modifier IS NOT NULL AND unit IS NOT NULL)),

  -- ── AUDIT ─────────────────────────────────────────────────────────────────
  notes                 text,
  created_by            text          DEFAULT 'brigade_audit',
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now(),
  last_reviewed_by      text,
  last_reviewed_at      timestamptz
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION pmdr_update_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER pmdr_updated_at
  BEFORE UPDATE ON pos_modifier_depletion_rules
  FOR EACH ROW EXECUTE FUNCTION pmdr_update_timestamp();

-- Indici
CREATE INDEX IF NOT EXISTS idx_pmdr_canonical ON pos_modifier_depletion_rules (modifier_canonical) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_pmdr_recipe ON pos_modifier_depletion_rules (linked_recipe_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_pmdr_usage ON pos_modifier_depletion_rules (usage_mode);

-- ============================================================
-- RIGHE DRESSING — REGOLA CUCINA: 2 fl oz ramekin per tutti
-- Confermato da Max: 8 luglio 2026.
-- 2 fl oz = 59.147 ml = 59.147 g (density=1.0)
-- I vecchi valori DB (74g Balsamic/Ranch, 78g Citronette) sono legacy —
-- superati dalla regola cucina. NON sono valori competing.
-- confidence='estimated' per tutti — diventa 'confirmed' quando Max
-- esegue l'approvazione finale in Fase 3.
-- active=false — nessun bot production change.
-- ============================================================

INSERT INTO pos_modifier_depletion_rules (
  modifier_canonical, modifier_aliases,
  linked_recipe_id, usage_mode,
  display_qty, qty_per_modifier, unit,
  normalized_qty_ml, normalized_qty_g, density_g_per_ml,
  confidence, active, notes, created_by
) VALUES

-- ── BALSAMIC ─────────────────────────────────────────────────────────────────
-- Regola cucina: 2 fl oz ramekin. Confermato Max 8 lug 2026.
-- Recipe collegata: BALSAMIC VINAIGRETTE (e834c1e2).
-- Legacy note: serving_qty nel DB era 74g — superato dalla regola cucina.
(
  'Balsamic',
  ARRAY['Balsamic','balsamic','BALSAMIC ON SIDE','Balsamic on side',
        'Balsamic for salad','Extra balsamic','Balsamic reduction',
        'Side balsamic vinaigrette','Salad now balsamic dressing','Balsamic and tomatoes on side'],
  'e834c1e2-c9a7-4c5c-b525-a4e092df42df',
  'fixed_quantity',
  '2 fl oz ramekin',
  2,
  'fl_oz',
  59.147,
  59.147,
  1.0,
  'estimated',
  false,
  'Regola cucina confermata Max 8/7/2026: 1 ramekin = 2 fl oz per tutti i dressing. 59.147g per porzione. 151 usi/60gg → ~8.9kg/60gg non tracciati. Legacy DB serving_qty=74g superato.',
  'brigade_audit'
),

-- ── CITRONETTE ────────────────────────────────────────────────────────────────
-- Regola cucina: 2 fl oz ramekin. Confermato Max 8 lug 2026.
-- Recipe collegata: CITRONETTE (3f433b8b).
-- Legacy note: serving_qty nel DB era 78g — superato dalla regola cucina.
(
  'citronette',
  ARRAY['citronette','Citronette','Citronette on side','Add Citronette ots','Citronette on the side'],
  '3f433b8b-eb7f-4f55-90c6-64d25801d9b7',
  'fixed_quantity',
  '2 fl oz ramekin',
  2,
  'fl_oz',
  59.147,
  59.147,
  1.0,
  'estimated',
  false,
  'Regola cucina confermata Max 8/7/2026: 1 ramekin = 2 fl oz per tutti i dressing. 59.147g per porzione. 195 usi/60gg → ~11.5kg/60gg non tracciati. Legacy DB serving_qty=78g superato.',
  'brigade_audit'
),

-- ── CAESAR ───────────────────────────────────────────────────────────────────
-- Regola cucina: 2 fl oz ramekin. Confermato Max 8 lug 2026.
-- QTÀ CONFERMATA: 2 fl oz = 59.147g.
-- PENDING SOLO: collegamento recipe/prep_task corretto.
--   Recipe "Caesar Dressing" non esiste nel DB come entità separata.
--   Prep_task "Check Caesar" usa unit=squeezer (non grammi) — non utilizzabile per deduction.
--   Da fare prima di Fase 3: creare recipe Caesar Dressing o collegare prep_task corretto.
(
  'Caesar',
  ARRAY['Caesar','caesar','Caesar dressing','Extra side of Caesar dressing',
        'Ceasar is split between both seats','Add Ceasar dressing side for arugula'],
  NULL,   -- pending: recipe Caesar Dressing non in DB; da creare o collegare prep_task
  'fixed_quantity',
  '2 fl oz ramekin',
  2,
  'fl_oz',
  59.147,
  59.147,
  1.0,
  'estimated',
  false,
  'Qty confermata: 2 fl oz ramekin = 59.147g (Max 8/7/2026). PENDING solo: linked_recipe_id — recipe "Caesar Dressing" non esiste nel DB. Prep_task "Check Caesar" usa unit=squeezer, inutilizzabile per deduction. Da creare recipe o identificare prep_task corretto prima di Fase 3. 312 usi/60gg → ~18.5kg/60gg non tracciati.',
  'brigade_audit'
),

-- ── RANCH ─────────────────────────────────────────────────────────────────────
-- Regola cucina: 2 fl oz ramekin. Confermato Max 8 lug 2026.
-- Recipe collegata: Ranch Dressing (3cee627c).
-- Legacy note: serving_qty nel DB era 74g — superato dalla regola cucina.
(
  'Ranch',
  ARRAY['Ranch','ranch'],
  '3cee627c-5eb6-48aa-ad50-91949dcbfc9a',
  'fixed_quantity',
  '2 fl oz ramekin',
  2,
  'fl_oz',
  59.147,
  59.147,
  1.0,
  'estimated',
  false,
  'Regola cucina confermata Max 8/7/2026: 1 ramekin = 2 fl oz per tutti i dressing. 59.147g per porzione. 86 usi/60gg → ~5.1kg/60gg non tracciati. Legacy DB serving_qty=74g superato.',
  'brigade_audit'
);

-- ============================================================
-- PROTEINE — usage_mode='use_recipe_serving'
-- NON inserire ancora — commentate per riferimento Fase 3.
-- use_recipe_serving = consuma 1 porzione logica della ricetta
-- collegata usando la resa/BOM come source of truth.
-- Non si chiedono grammi — la recipe sa già cosa contiene.
-- ============================================================

-- INSERT INTO pos_modifier_depletion_rules (...) VALUES
-- ('Add chicken', ..., 'use_recipe_serving', linked_recipe_id=<Diced Grilled Chicken>, active=false),
-- ('Add shrimp',  ..., 'use_recipe_serving', linked_recipe_id=<Shrimp recipe>,          active=false),
-- ('Meatballs',   ..., 'use_recipe_serving', linked_recipe_id=<Meatball Appetizer>,      active=false),
-- ...

-- ============================================================
-- QUERY INVENTORY CALCULATOR (read-only)
-- Esempio: 5kg di Balsamic → quanti ramekin?
-- ============================================================
--
-- WITH stock AS (
--   SELECT 5000 AS stock_g  -- cuoco pesa 5 kg
-- ),
-- rule AS (
--   SELECT normalized_qty_g AS portion_g, display_qty
--   FROM pos_modifier_depletion_rules
--   WHERE modifier_canonical = 'Balsamic' AND active = false
--   LIMIT 1
-- )
-- SELECT
--   stock.stock_g,
--   rule.portion_g,
--   rule.display_qty,
--   ROUND(stock.stock_g / NULLIF(rule.portion_g, 0), 1) AS ramekins_available,
--   ROUND(stock.stock_g / 2000.0, 2) AS batches_available  -- 2LT per batch
-- FROM stock, rule;
--
-- Result: 5000g ÷ 59.147g = 84.5 ramekin · 5000 ÷ 2000 = 2.5 batch

-- ============================================================
-- INVENTORY NORMALIZATION VIEW (read-only helper)
-- ============================================================
CREATE OR REPLACE VIEW v_modifier_depletion_summary AS
SELECT
  r.modifier_canonical,
  r.display_qty,
  r.qty_per_modifier,
  r.unit,
  r.normalized_qty_ml,
  r.normalized_qty_g,
  r.density_g_per_ml,
  r.usage_mode,
  r.confidence,
  r.active,
  rec.title AS recipe_title,
  rec.base_weight_g AS recipe_batch_g,
  -- Porzioni per batch (se base_weight_g noto)
  CASE
    WHEN r.normalized_qty_g > 0 AND rec.base_weight_g > 0
    THEN ROUND(rec.base_weight_g / r.normalized_qty_g, 1)
    ELSE NULL
  END AS portions_per_batch
FROM pos_modifier_depletion_rules r
LEFT JOIN recipes rec ON rec.id = r.linked_recipe_id;
