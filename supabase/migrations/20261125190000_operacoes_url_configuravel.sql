-- O agendador do Supabase chamava o endereço fixo da Vercel.
-- Agora o endereço do CRM fica em crm_operations_config.site_url (padrão: Vercel),
-- para trocar de hospedagem (Railway) sem mexer no código.
begin;
alter table public.crm_operations_config add column if not exists site_url text;

create or replace function crm_private.operations_tick() returns bigint language plpgsql security invoker set search_path='' as $$
declare request_id bigint;
begin
 select net.http_post(
  url:=rtrim(coalesce(nullif(btrim(site_url), ''), 'https://crm-bielenki.vercel.app'), '/') || '/api/internal/operations',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cron_secret),
  body:='{}'::jsonb,timeout_milliseconds:=55000
 ) into request_id from public.crm_operations_config where id=true;
 return request_id;
end; $$;
revoke all on function crm_private.operations_tick() from public,anon,authenticated;
commit;
