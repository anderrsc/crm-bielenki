-- Endurecimento de seguranca (auditoria de 02/11/2026). Pode ser rodada mais
-- de uma vez.

-- A01: configuracao do Agente IA (contem chaves de API) so para
-- administrador/gerente. Em producao havia uma policy antiga (ai_cfg_rls) que
-- liberava para qualquer pessoa da empresa; policies permissivas se somam
-- (OR), entao todas sao removidas e so a restrita e recriada.
-- A04: o mesmo para as conversas de triagem (telefone e mensagens) e para o
-- historico de execucoes de automacoes.
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['ai_agent_config', 'triage_sessions', 'workflow_executions'] loop
    for p in select polname from pg_policy where polrelid = ('public.' || t)::regclass loop
      execute format('drop policy %I on public.%I', p.polname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (company_id = (select public.current_company_id()) and (select public.has_role(array['administrador','gerente']::public.app_role[])))
      with check (company_id = (select public.current_company_id()) and (select public.has_role(array['administrador','gerente']::public.app_role[])))$p$,
      t || '_gestao', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- A03: usuario desativado perde o acesso a todos os dados da empresa (as
-- policies dependem de current_company_id) e ninguem altera o proprio status,
-- nem a empresa; so administrador/gerente da empresa (ou o servidor). O
-- e-mail fica de fora: e sincronizado do login pelo gatilho sync_profile_email.
create or replace function public.current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and status = 'ativo'
$$;

create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- servidor (service_role) e SQL Editor
  if (new.status, new.company_id) is distinct from (old.status, old.company_id)
     and not (old.company_id = public.current_company_id() and public.has_role(array['administrador','gerente']::public.app_role[])) then
    raise exception 'Somente administrador ou gerente altera status ou empresa do perfil';
  end if;
  if new.id = auth.uid() and new.status is distinct from old.status then
    raise exception 'Ninguem altera o proprio status';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_update on public.profiles;
create trigger trg_guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- A02: funcoes privilegiadas (SECURITY DEFINER) deixam de ser executaveis sem
-- login. Para usuarios logados ficam so as que o aplicativo chama, as usadas
-- pelas policies/views e as de gatilho (gatilhos nao precisam de EXECUTE);
-- rotinas internas (fila de automacoes, bootstrap, seeds, numeracao...) so
-- pelo servidor ou por outras funcoes privilegiadas.
do $$
declare
  f record;
  permitidas constant text[] := array[
    -- chamadas pelo aplicativo (supabase.rpc)
    'advance_production_step','approve_quote','bulk_save_prices','create_gutter_quote','create_manual_purchase',
    'create_manual_sale','create_window_quote','current_user_roles','dashboard_executivo','dashboard_summary',
    'delete_draft_quote','duplicate_quote','global_search','has_role','has_table_access','pending_center',
    'receive_purchase_item','register_payment_with_adjustment','replace_user_roles','reporting_summary',
    'reschedule_entry','reverse_payment','session_access','set_default_document_template','update_gutter_quote',
    -- usadas em policies, views e checagens
    'current_company_id','require_table_access'
  ];
begin
  for f in
    select p.oid::regprocedure sig, p.proname, p.prosecdef, p.prorettype = 'trigger'::regtype gatilho
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if not f.prosecdef or (f.proname = any(permitidas) and not f.gatilho) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;
-- Funcoes criadas daqui para frente tambem nao ficam abertas sem login.
alter default privileges in schema public revoke execute on functions from public, anon;

-- A07: cada evento do WhatsApp (id da mensagem no provedor) e processado uma
-- vez so, mesmo que o provedor reenvie.
create table if not exists public.whatsapp_webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.whatsapp_webhook_events enable row level security;
revoke all on public.whatsapp_webhook_events from anon, authenticated;
grant all on public.whatsapp_webhook_events to service_role;

-- A12: indice duplicado (mesmas colunas de measurements_company_date_idx).
drop index if exists public.idx_measurements_company_scheduled;
