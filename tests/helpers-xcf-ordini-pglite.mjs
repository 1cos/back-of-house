// Helper condiviso dai test XCF-ORDINI su PGlite (vedi xcf-ordini-*.pglite.test.mjs).
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = f => fs.readFileSync(path.join(HERE, '..', 'migrations', f), 'utf8');

export const T = { max: 'a'.repeat(64), tela: 'b'.repeat(64), anto: 'c'.repeat(64), cook: 'd'.repeat(64) };

export async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

    create table public.users (id bigint primary key, name text, role text, is_admin boolean, active boolean default true);
    insert into public.users values (1,'Max','admin',true,true),(2,'Anto','staff',false,true),(3,'Tela','staff',false,true),(20,'David','staff',false,true);
    create table public.test_tokens (token text primary key, user_id bigint);
    insert into public.test_tokens values ('${T.max}',1),('${T.tela}',3),('${T.anto}',2),('${T.cook}',20);
    -- stub fedele nel contratto di brigade_validate_session (ok/error/user)
    create function public.brigade_validate_session(p_token text) returns jsonb language plpgsql security definer as $$
    declare u public.users%rowtype;
    begin
      if p_token is null or length(p_token) <> 64 then return jsonb_build_object('ok',false,'error','invalid_token'); end if;
      select us.* into u from public.test_tokens t join public.users us on us.id = t.user_id where t.token = p_token and us.active;
      if not found then return jsonb_build_object('ok',false,'error','session_expired_or_invalid'); end if;
      return jsonb_build_object('ok',true,'user',jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'is_admin',u.is_admin));
    end $$;

    create table public.ingredients (id uuid primary key default gen_random_uuid(), name text);
    create table public.ingredient_vendors (id uuid primary key default gen_random_uuid(), ingredient_id uuid, vendor text,
      vendor_sku text, purchase_unit text default 'lb', pack_description text, unit_price numeric, conversion_to_base numeric,
      order_count int default 0, active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now(),
      price_per_100g numeric, last_invoice_date date, price_type text default 'per_case', price_per_each numeric,
      do_not_order boolean default false, do_not_order_reason text, do_not_order_set_at timestamptz, do_not_order_set_by text);
    create table public.vendor_documents (id uuid primary key default gen_random_uuid(), vendor text, document_type text,
      document_number text, document_date date, delivery_date date, raw_text text, parsed_json jsonb, status text default 'pending',
      warnings jsonb default '[]', uploaded_by text, created_at timestamptz default now(), updated_at timestamptz default now(),
      source_email_subject text, source_email_from text);
    create table public.office_items (id uuid primary key default gen_random_uuid(), chef_action text, chef_action_at timestamptz, chef_action_by text);
    create table public.purchase_orders (id uuid primary key default gen_random_uuid(), vendor_name text, status text default 'draft',
      created_by text, notes text, created_at timestamptz default now(), updated_at timestamptz default now(),
      constraint purchase_orders_status_check check (status = any (array['draft','ready','sent','cancelled'])));
    create table public.purchase_order_lines (id uuid primary key default gen_random_uuid(),
      purchase_order_id uuid references public.purchase_orders(id) on delete cascade, ingredient_id uuid references public.ingredients(id),
      vendor_name text, vendor_sku text, requested_text text, matched_name text, quantity numeric, unit text, match_confidence numeric,
      match_source text, created_at timestamptz default now(), updated_at timestamptz default now(),
      constraint purchase_order_lines_match_source_check check (match_source = any (array['ingredient_vendors','vendor_item_aliases','ingredient_links','manual'])));
  `);
  for (const f of ['20261002_xcf_ordini_01_schema.sql', '20261002_xcf_ordini_02_rpc.sql', '20261002_xcf_ordini_04_dno_per_sku.sql', '20261002_xcf_ordini_05_search_path.sql', '20261002_xcf_ordini_03_rls.sql']) {
    await db.exec(MIG(f));
  }
  return db;
}

