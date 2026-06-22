-- Migration 020 — Checklist automático ao fechar pedido + alerta 15 dias

-- Função que gera checklist de instalação com deadline de 15 dias
create or replace function public.auto_create_installation_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  install_id uuid;
  deadline_date date := current_date + interval '15 days';
begin
  -- So aciona quando operational_status muda para 'finalizado' ou 'aguardando_instalacao'
  if (NEW.operational_status = OLD.operational_status) then
    return NEW;
  end if;
  if NEW.operational_status not in ('finalizado', 'aguardando_instalacao') then
    return NEW;
  end if;

  -- Busca a instalação do pedido
  select id into install_id
    from installations
   where order_id = NEW.id
   limit 1;

  if install_id is null then return NEW; end if;

  -- Verifica se já tem checklist
  if exists (select 1 from installation_checklists where installation_id = install_id limit 1) then
    -- Apenas atualiza deadlines se ainda nao tiver
    update installation_checklists
       set deadline = coalesce(deadline, deadline_date)
     where installation_id = install_id
       and deadline is null;
    return NEW;
  end if;

  -- Cria checklist padrão de instalação com 15 dias
  insert into installation_checklists (company_id, installation_id, title, completed, sort_order, deadline)
  values
    (NEW.company_id, install_id, 'Confirmar medidas no local',        false, 1, deadline_date),
    (NEW.company_id, install_id, 'Verificar estrutura de fixação',    false, 2, deadline_date),
    (NEW.company_id, install_id, 'Instalar calhas/esquadrias',        false, 3, deadline_date),
    (NEW.company_id, install_id, 'Testar funcionalidade e vedação',   false, 4, deadline_date),
    (NEW.company_id, install_id, 'Limpeza e acabamento final',        false, 5, deadline_date),
    (NEW.company_id, install_id, 'Aprovação e assinatura do cliente', false, 6, deadline_date),
    (NEW.company_id, install_id, 'Registrar fotos do serviço',        false, 7, deadline_date);

  return NEW;
end $$;

-- Trigger no orders
drop trigger if exists trg_auto_checklist_on_order on public.orders;
create trigger trg_auto_checklist_on_order
  after update of operational_status on public.orders
  for each row execute function public.auto_create_installation_checklist();

-- View para alertas de checklist de instalacao vencidos/proximos
create or replace view public.v_installation_checklist_alerts as
select
  ic.id,
  ic.title,
  ic.deadline,
  ic.completed,
  ic.responsible_id,
  p.full_name as responsible_name,
  i.order_id,
  i.id as installation_id,
  i.company_id,
  o.order_number,
  c.name as client_name,
  case
    when ic.completed then 'concluido'
    when ic.deadline < current_date then 'vencido'
    when ic.deadline = current_date then 'vence_hoje'
    when ic.deadline <= current_date + interval '2 days' then 'proximo'
    else 'ok'
  end as alert_status
from installation_checklists ic
join installations i on i.id = ic.installation_id
join orders o on o.id = i.order_id
join clients c on c.id = o.client_id
left join profiles p on p.id = ic.responsible_id
where ic.deadline is not null;
