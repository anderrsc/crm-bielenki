-- Execute configure_automation_cron uma vez após publicar a Edge Function.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.configure_automation_cron(p_dispatcher_url text,p_automation_secret text) returns bigint
language plpgsql security definer set search_path=public,pg_catalog,extensions as $$
declare existing bigint; job_id bigint; command text;
begin
  if p_dispatcher_url !~ '^https://.+/functions/v1/automation-dispatcher$' or length(p_automation_secret)<24 then raise exception 'URL ou segredo inválido'; end if;
  select jobid into existing from cron.job where jobname='crm-bielenki-whatsapp-dispatcher';
  if existing is not null then perform cron.unschedule(existing); end if;
  command:=format($cmd$select net.http_post(url:=%L,headers:=jsonb_build_object('content-type','application/json','x-automation-secret',%L),body:='{}'::jsonb,timeout_milliseconds:=50000)$cmd$,p_dispatcher_url,p_automation_secret);
  select cron.schedule('crm-bielenki-whatsapp-dispatcher','*/5 * * * *',command) into job_id;
  return job_id;
end $$;
revoke all on function public.configure_automation_cron(text,text) from public,anon,authenticated;
