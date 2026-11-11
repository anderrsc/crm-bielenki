-- Checkup: pin helper lookup paths; trigger functions are not public RPC APIs.
alter function public.client_phone_key(text) set search_path = pg_catalog, public;
alter function public.client_name_key(text) set search_path = pg_catalog, public;
alter function public.client_doc_key(text) set search_path = pg_catalog, public;
alter function public.br_phone_display(text) set search_path = pg_catalog, public;
alter function public.br_city(text) set search_path = pg_catalog, public;
alter function public.clients_normalize_contact() set search_path = pg_catalog, public;
alter function public.leads_normalize_phone() set search_path = pg_catalog, public;
alter function public.touch_quotes_updated_at() set search_path = pg_catalog, public;
revoke execute on function public.clients_block_duplicate() from public, anon, authenticated;
revoke execute on function public.leads_stage_history() from public, anon, authenticated;
revoke execute on function public.measurement_pipeline_sync() from public, anon, authenticated;
revoke execute on function public.quote_pipeline_sync() from public, anon, authenticated;
create index if not exists payments_receiving_account_idx on public.payments(receiving_account_id);
