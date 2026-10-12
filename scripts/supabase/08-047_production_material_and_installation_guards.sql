-- Passo 8 de 9 — 047_production_material_and_installation_guards.sql
-- Cole no SQL Editor do Supabase (New query, sem nada selecionado) e clique Run. Pode ser repetido.

-- Migration 047 - Regras de producao e instalacao
--
-- 1. advance_production_step(): nao deixa avancar a producao enquanto houver
--    material obrigatorio da ordem ainda nao recebido (ou se ela foi cancelada).
--    Ordens sem material vinculado seguem normalmente.
-- 2. Instalacao: nao pode ser marcada como concluida com itens obrigatorios do
--    checklist pendentes.
--
-- Pode ser rodada mais de uma vez.

begin;

CREATE OR REPLACE FUNCTION public.advance_production_step(p_production_order_id uuid, p_responsible_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare po public.production_orders; total_steps integer; step_name text; next_step integer;
begin
  perform public.require_table_access('production_orders','update');
  select * into po from public.production_orders
    where id=p_production_order_id and company_id=public.current_company_id() for update;
  if po.id is null then raise exception 'Ordem de producao nao encontrada'; end if;
  -- Nao avanca enquanto falta material obrigatorio (ou a ordem foi cancelada).
  -- So o status 'aguardando_material' nao basta: toda ordem nasce assim, e as
  -- que nao tem material vinculado nunca seriam liberadas.
  if po.status = 'cancelado' then raise exception 'Produção cancelada'; end if;
  if exists (select 1 from public.production_materials pm
             where pm.production_order_id = po.id and pm.required
               and coalesce(pm.received_quantity, 0) < pm.required_quantity) then
    raise exception 'Produção bloqueada: material obrigatório ainda não recebido';
  end if;
  total_steps:=case when po.flow_type='esquadrias' then 9 else 7 end;
  if po.current_step<1 or po.current_step>total_steps then raise exception 'Fluxo de producao ja finalizado'; end if;
  if p_responsible_id is not null and not exists(
    select 1 from public.profiles where id=p_responsible_id and company_id=po.company_id and status='ativo'
  ) then raise exception 'Responsavel invalido'; end if;
  step_name:=(case when po.flow_type='esquadrias' then
    array['Medicao','Projeto','Corte','Usinagem','Montagem','Solda','Acabamento','Pintura','Controle de Qualidade']
  else array['Medicao','Corte','Dobra','Pintura','Agendamento','Instalacao','Pos-venda'] end)[po.current_step];
  insert into public.production_step_logs(
    company_id,production_order_id,step_number,step_name,started_at,completed_at,responsible_id,notes
  ) values(po.company_id,po.id,po.current_step,step_name,now(),now(),p_responsible_id,p_notes)
  on conflict(production_order_id,step_number) do update set
    step_name=excluded.step_name,completed_at=excluded.completed_at,
    responsible_id=excluded.responsible_id,notes=excluded.notes;
  next_step:=po.current_step+1;
  update public.production_orders set current_step=next_step,
    status=case when next_step>total_steps then 'finalizado' else 'em_producao' end
  where id=po.id;
  return next_step;
end $$;

revoke all on function public.advance_production_step(uuid,uuid,text) from public;
grant execute on function public.advance_production_step(uuid,uuid,text) to authenticated;

create or replace function public.guard_installation_completion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'concluida' and old.status is distinct from new.status and exists (
    select 1 from public.installation_checklists
    where installation_id = new.id and required and not completed
  ) then
    raise exception 'Conclua todos os itens obrigatórios do checklist antes de finalizar a instalação';
  end if;
  return new;
end $$;

drop trigger if exists installation_completion_guard on public.installations;
create trigger installation_completion_guard before update of status on public.installations
for each row execute function public.guard_installation_completion();

commit;
