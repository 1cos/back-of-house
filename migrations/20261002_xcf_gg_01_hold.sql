-- XCF-GG 01 — Global Gourmet: i documenti arrivano, ma restano FERMI.
--
-- Il collector Apps Script (GlobalGourmetImport.gs) manda i PDF di
-- *@ggourmetfoods.com a gmail-vendor-import, che li salva in Storage e
-- crea un vendor_documents in 'pdf_received'. Il worker deployato oggi
-- non sa leggerli (sono scansioni: pdfjs non estrae testo) e non ha il
-- parser Global Gourmet. Senza questo trigger li porterebbe in 'error'
-- con un "No text extracted" che non spiega niente.
--
-- Qui li si ferma all'ingresso, in modo tracciato: stato 'error' (l'unico
-- stato del CHECK che nessun job rilegge da solo), warning bloccante con
-- un codice proprio, e il motivo in parsed_json.gg_hold. Il PDF resta in
-- Storage, parsed_json.storage_path resta intatto.
--
-- Il rilascio NON e' qui: e' in 20261002_xcf_gg_02_release.sql, da
-- eseguire SOLO dopo il deploy del parser e della correzione prezzi.
create or replace function public.vd_hold_global_gourmet()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pdf_received'
     and coalesce(new.source_email_from, '') ~* '@ggourmetfoods\.com' then
    new.vendor   := 'Global Gourmet Foods';
    new.status   := 'error';
    new.warnings := coalesce(new.warnings, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'code', 'GG_HOLD_PARSER_NOT_DEPLOYED',
      'severity', 'blocking',
      'message', 'Global Gourmet: PDF ricevuto e conservato. In attesa del deploy di OCR + parser Global Gourmet e della correzione prezzi al libbra (XCF-GG). Non processare a mano.'));
    new.parsed_json := coalesce(new.parsed_json, '{}'::jsonb) || jsonb_build_object(
      'gg_hold', jsonb_build_object(
        'since', now(),
        'by', 'trigger vd_hold_global_gourmet (XCF-GG 01)',
        'release', 'migrations/20261002_xcf_gg_02_release.sql'));
  end if;
  return new;
end
$$;

drop trigger if exists trg_vd_hold_global_gourmet on public.vendor_documents;
create trigger trg_vd_hold_global_gourmet
  before insert on public.vendor_documents
  for each row execute function public.vd_hold_global_gourmet();

revoke all on function public.vd_hold_global_gourmet() from public, anon, authenticated;
