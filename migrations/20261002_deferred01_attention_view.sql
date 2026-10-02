-- DEFERRED01 — "Deferred by Chef": an alert the Chef knows about but cannot resolve yet
-- (e.g. a yield nobody knows) leaves Today and the badge without being closed, snoozed or faked.
-- Mechanism: office_items.chef_action = 'working_on_it' (an existing Ufficio value; the Guardian
-- never resets it) → attention 'backlog', reason 'deferred_by_chef'. Same view as ATTENTION01,
-- one new rule placed before the generic "chef_action is not null → info" rule.

create or replace view public.attention_items
with (security_invoker = true) as
with oi as (
  select o.id, o.source, o.issue_type, o.created_at, o.recipe_id, o.chef_action, o.snoozed_until,
         o.from_user, coalesce(o.title, '') as title,
         coalesce(o.summary, '') || ' ' || coalesce(o.body, '') as txt,
         r.id is not null as r_exists, coalesce(r.category, '') as r_cat,
         y.portions, coalesce(y.has_yield, false) as has_yield,
         (select count(*) from public.recipe_bom b where b.parent_recipe_id = o.recipe_id) as bom_n
  from public.office_items o
  left join public.recipes r on r.id = o.recipe_id
  left join public.recipe_yield y on y.id = o.recipe_id
  where o.status = 'open' and o.is_demo is not true
),
office as (
  select oi.*, c.attention, c.reason, c.decision_key from oi
  cross join lateral (select
    case
      when oi.snoozed_until > now()                                   then 'info|snoozed|'
      when oi.chef_action = 'working_on_it'                           then 'backlog|deferred_by_chef|deferred:' || oi.id   -- DEFERRED01: known, unresolved, out of Today
      when oi.chef_action is not null                                 then 'info|acted_on|'
      when oi.recipe_id is not null and not oi.r_exists               then 'info|recipe_gone|'
      when oi.r_cat ~* 'archiv'                                       then 'info|recipe_archived|'
      when oi.source in ('tell_chef', 'operation_note', 'sous_chef_chat') then
        case
          when oi.from_user = 'Chef AI'                               then 'info|ai_copy|'
          when oi.txt ~* 'great service' or oi.txt ~ '⭐'             then 'info|praise|'
          when oi.source = 'sous_chef_chat' and oi.title ~* '^proposta' then 'needs_chef|recipe_proposal|proposal:' || oi.id
          when oi.created_at < now() - interval '14 days' then
            case when oi.source = 'tell_chef' then 'needs_chef|old_team_message|old_team_messages'
                 else 'info|old_note|' end
          else 'action_now|team_message|team:' || oi.id
        end
      when oi.issue_type in ('missing_photo', 'missing_procedure')    then 'backlog|recipe_completeness|completeness:' || oi.issue_type
      when oi.issue_type in ('missing_base_servings', 'missing_yield') then   -- missing_yield: Guardian v14.1 (YIELD01)
        case
          when oi.portions > 0                                        then 'info|yield_resolved|'
          when not oi.has_yield                                       then 'action_now|no_yield|yield:' || oi.recipe_id
          when oi.txt ~* 'sold [0-9]+ times'                          then 'needs_chef|portions_unknown|yield:' || oi.recipe_id
          else 'backlog|portions_unknown|yield:' || oi.recipe_id
        end
      when oi.issue_type in ('bom_empty', 'empty_bom') then
        case when oi.bom_n > 0 then 'info|bom_now_present|' else 'action_now|no_ingredients|bom:' || oi.recipe_id end
      when oi.issue_type = 'bom_partial' then
        case when oi.bom_n >= 4 then 'info|bom_now_present|' else 'needs_chef|bom_maybe_incomplete|bom_partial_review' end
      when oi.issue_type = 'missing_serving_fields'                   then 'info|portion_optional|'
      when oi.issue_type = 'missing_pos_name'                         then 'data_quality_unknown|pos_link_unknown|'
      when oi.issue_type = 'null_stock'                               then 'data_quality_unknown|stock_untrusted|'
      else 'needs_chef|unclassified|other:' || coalesce(oi.issue_type, oi.source)
    end as cls) k
  cross join lateral (select split_part(k.cls, '|', 1) as attention,
                             split_part(k.cls, '|', 2) as reason,
                             nullif(split_part(k.cls, '|', 3), '') as decision_key) c
),
docs as (
  select w.document_id, d.vendor, d.status, d.document_number, d.document_date,
         d.source_email_subject, d.raw_text,
         array_agg(distinct w.code) as codes, min(w.created_at) as created_at
  from public.invoice_warnings w
  join public.vendor_documents d on d.id = w.document_id
  where w.status <> 'resolved'
  group by 1, 2, 3, 4, 5, 6, 7
),
invoices as (
  select docs.*, split_part(k.cls, '|', 1) as attention, split_part(k.cls, '|', 2) as reason,
         nullif(split_part(k.cls, '|', 3), '') as decision_key
  from docs cross join lateral (select
    case
      when docs.status = 'ignored' or 'BUYER-BAR-001' = any(docs.codes) then 'info|excluded|'
      when docs.status = 'imported'                                   then 'info|imported_with_notes|'
      when 'TREVIPAY_REVISION_AFTER_IMPORT' = any(docs.codes)         then 'needs_chef|revision_after_import|invoice:' || docs.document_id
      when docs.vendor ilike 'walmart%' and ('TREVIPAY_SUMMARY_ONLY' = any(docs.codes)
           or ('PARSE_ERROR' = any(docs.codes) and docs.raw_text ~ '(^|\n)[0-9]{12,} [0-9]+ \$[0-9]')) then
        case when docs.created_at < now() - interval '7 days'
             then 'action_now|walmart_revision_missing|invoice:' || docs.document_id
             else 'info|walmart_waiting_revision|' end
      when docs.source_email_subject ~* '^R\.M\.A\.'                  then 'info|return_pickup_slip|'
      when docs.vendor = 'bek'                                        then 'info|legacy_record|'
      when docs.status = 'error'                                      then 'action_now|unreadable_invoice|invoice:' || docs.document_id
      when docs.status = 'pending' and docs.created_at < now() - interval '3 days' then 'needs_chef|invoice_stuck_in_review|invoice:' || docs.document_id
      when docs.status = 'pending'                                    then 'backlog|vendor_review|'
      else 'info|other|'
    end as cls) k
)
select 'office'::text as origin, office.id::text as item_id, office.source,
       coalesce(office.issue_type, office.source) as family,
       office.attention, office.reason, office.decision_key,
       office.recipe_id, null::uuid as document_id, office.created_at
from office
union all
select 'invoice', invoices.document_id::text, 'invoice_warnings', 'invoice',
       invoices.attention, invoices.reason, invoices.decision_key,
       null::uuid, invoices.document_id, invoices.created_at
from invoices;

comment on view public.attention_items is
  'ATTENTION01: one classification of every open signal (office_items + invoices with open warnings): action_now / needs_chef / backlog / info / data_quality_unknown. Counters count distinct decision_key. Read-only.';

grant select on public.attention_items to anon, authenticated, service_role;

-- Undo: re-apply migrations/20261002_attention01_canonical_view.sql
