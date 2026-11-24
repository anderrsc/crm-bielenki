begin;
create or replace function crm_private.guard_lia_request() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.approved_by is not null or new.decided_at is not null then
      raise exception 'Solicitação deve iniciar pendente';
    end if;
    if auth.uid() is not null then new.requested_by := auth.uid(); end if;
    return new;
  end if;
  if old.status <> 'pending' or new.status not in ('approved','rejected','cancelled','expired') then
    raise exception 'Transição de aprovação inválida';
  end if;
  if (to_jsonb(new) - array['status','approved_by','decided_at','updated_at','rejection_reason']) is distinct from
     (to_jsonb(old) - array['status','approved_by','decided_at','updated_at','rejection_reason']) then
    raise exception 'Dados originais da solicitação são imutáveis';
  end if;
  if new.status in ('approved','rejected') then
    if auth.uid() is null or old.requested_by is null or old.requested_by = auth.uid()
       or not coalesce(public.has_role(array['administrador','gerente']::public.app_role[]),false)
       or (old.approver_role is not null and not coalesce(public.has_role(array[old.approver_role::public.app_role]),false))
       or old.expires_at <= now() then
      raise exception 'Decisão exige aprovador independente, autorizado e solicitação vigente';
    end if;
    new.approved_by := auth.uid();
  elsif new.status = 'expired' and (old.expires_at is null or old.expires_at > now()) then
    raise exception 'Solicitação ainda vigente';
  else
    new.approved_by := null;
  end if;
  new.decided_at := now();
  new.updated_at := now();
  return new;
end $$;
create trigger lia_request_transition before insert or update on public.lia_action_requests
for each row execute function crm_private.guard_lia_request();

create function public.publish_lia_prompt(p_version uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  tenant uuid := public.current_company_id();
  candidate public.lia_prompt_versions%rowtype;
begin
  if not coalesce(public.has_role(array['administrador','gerente']::public.app_role[]),false) then
    raise exception 'Publicação exige gerência';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text,0));
  select * into strict candidate from public.lia_prompt_versions where company_id=tenant and id=p_version for update;
  if candidate.status <> 'draft' or candidate.created_by is null or candidate.created_by = auth.uid() then
    raise exception 'Publicação exige rascunho de outro autor';
  end if;
  update public.lia_prompt_versions set status='archived',updated_at=now() where company_id=tenant and status='active';
  update public.lia_prompt_versions set status='active',approved_by=auth.uid(),published_at=now(),updated_at=now() where id=p_version;
  insert into public.lia_audit_events(company_id,event_type,actor_id,target_type,outcome,details)
    values(tenant,'config_changed',auth.uid(),'config','changed',jsonb_build_object('action','prompt_published','version_id',p_version));
end $$;
revoke all on function public.publish_lia_prompt(uuid) from public;
grant execute on function public.publish_lia_prompt(uuid) to authenticated;
commit;
