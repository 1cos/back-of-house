-- WM01 — una fattura senza articoli, o gia' importata con lo stesso numero,
-- non puo' diventare 'imported'. Barriera nel database: non dipende dal
-- pulsante Approve, dal worker o da chi scrive.
--
-- Misurato prima di applicarla (01/10/2026): su tutti i documenti 'imported'
-- un solo caso senza articoli e senza invoice_lines (Hardie's, 29/06), e
-- nessun numero importato due volte. Il trigger guarda solo il PASSAGGIO a
-- 'imported': i documenti gia' importati non vengono toccati.

create or replace function public.vendor_documents_guard_import()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'imported' and (tg_op = 'INSERT' or old.status is distinct from 'imported') then
    if jsonb_array_length(case when jsonb_typeof(new.parsed_json -> 'items') = 'array'
                               then new.parsed_json -> 'items' else '[]'::jsonb end) = 0
       and not exists (select 1 from public.invoice_lines l where l.import_id = new.id) then
      raise exception 'WM01: % #% has no item details, so it cannot be marked imported',
        coalesce(new.vendor, '?'), coalesce(new.document_number, '?')
        using errcode = 'check_violation';
    end if;

    if new.document_number is not null and exists (
         select 1 from public.vendor_documents d
          where d.id <> new.id and d.status = 'imported'
            and d.vendor = new.vendor and d.document_type = new.document_type
            and d.document_number = new.document_number) then
      raise exception 'WM01: % #% is already imported, refusing a second import',
        new.vendor, new.document_number
        using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists vendor_documents_guard_import on public.vendor_documents;
create trigger vendor_documents_guard_import
  before insert or update of status on public.vendor_documents
  for each row execute function public.vendor_documents_guard_import();

comment on function public.vendor_documents_guard_import() is
  'WM01: blocks marking a vendor document imported when it has no items and no invoice_lines, or when the same vendor+type+number is already imported.';

-- Undo:
--   drop trigger if exists vendor_documents_guard_import on public.vendor_documents;
--   drop function if exists public.vendor_documents_guard_import();
