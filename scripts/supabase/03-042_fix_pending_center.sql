-- Passo 3 de 10 — 042_fix_pending_center.sql
-- Cole no SQL Editor do Supabase (New query, sem nada selecionado) e clique Run. Pode ser repetido.

-- Migration 042 - Central de Pendencias voltava erro e ficava vazia
--
-- pending_center() (migration 030) referenciava colunas que nao existem
-- (purchase_orders.total_amount e purchase_orders.deleted_at), entao a
-- funcao inteira falhava com "column pu.total_amount does not exist".
-- Alem disso filtrava por status que o sistema nunca grava:
--   - orcamentos: 'pendente' (o sistema usa 'rascunho' ate aprovar/recusar)
--   - medicoes: 'agendada'/'pendente' (o check da tabela usa 'agendado',
--     'confirmado', 'em_deslocamento', 'em_medicao', 'reagendado')
--   - compras: considerava recebidas como pendentes ('concluido' nao existe)
--
-- Pode ser rodada mais de uma vez.

begin;

drop function if exists public.pending_center();

create function public.pending_center()
returns table (
  record_id   uuid,
  category    text,
  priority    text,
  title       text,
  subtitle    text,
  link        text,
  due_date    date,
  days_late   integer,
  amount      numeric,
  client_name text
) language plpgsql security definer stable set search_path = public as $$
declare v_cid uuid;
begin
  select p.company_id into v_cid from public.profiles p where p.id = auth.uid();
  if v_cid is null then return; end if;

  -- Orcamentos em aberto ha mais de 2 dias
  return query
  select q.id, 'orcamento'::text,
    case when q.created_at < now() - interval '7 days' then 'high'
         when q.created_at < now() - interval '3 days' then 'medium'
         else 'low' end,
    ('Orçamento ' || q.quote_number)::text,
    'Aguardando resposta do cliente'::text,
    ('/orcamentos/' || q.id)::text,
    q.valid_until,
    case when q.valid_until < current_date then (current_date - q.valid_until)::int else null end,
    q.total,
    c.name
  from public.quotes q join public.clients c on c.id = q.client_id
  where q.company_id = v_cid
    and q.status not in ('aprovado', 'recusado', 'cancelado', 'perdido')
    and q.created_at < now() - interval '2 days'
  order by q.created_at asc limit 20;

  -- Financeiro vencido
  return query
  select fe.id, ('financeiro_' || fe.entry_type)::text,
    case when (current_date - fe.due_date) > 15 then 'high'
         when (current_date - fe.due_date) > 7  then 'medium'
         else 'low' end,
    fe.description::text,
    ('Vencida há ' || (current_date - fe.due_date)::text || ' dias')::text,
    ('/financeiro/' || fe.entry_type)::text,
    fe.due_date,
    (current_date - fe.due_date)::int,
    fe.open_amount,
    coalesce(cl.name, sup.name)
  from public.financial_entries fe
  left join public.clients   cl  on cl.id  = fe.client_id
  left join public.suppliers sup on sup.id = fe.supplier_id
  where fe.company_id = v_cid
    and fe.status in ('aguardando_pagamento', 'parcialmente_pago', 'vencido')
    and fe.open_amount > 0
    and fe.due_date < current_date
  order by fe.due_date asc limit 20;

  -- Producoes atrasadas
  return query
  select po.id, 'producao'::text, 'high'::text,
    ('Produção ' || po.production_number)::text,
    case when po.planned_end is not null and po.planned_end < current_date
         then ('Atrasada ' || (current_date - po.planned_end)::text || ' dias')
         else 'Em produção há mais de 7 dias' end::text,
    ('/producao/' || po.id)::text,
    po.planned_end,
    case when po.planned_end is not null then (current_date - po.planned_end)::int else null end,
    null::numeric, c.name
  from public.production_orders po
  join public.orders  o on o.id = po.order_id
  join public.clients c on c.id = o.client_id
  where po.company_id = v_cid
    and po.status not in ('concluido', 'concluida', 'finalizado', 'cancelado')
    and ((po.planned_end is not null and po.planned_end < current_date)
         or po.started_at < now() - interval '7 days')
  order by po.planned_end asc nulls last limit 10;

  -- Compras aguardando recebimento
  return query
  select pu.id, 'compra'::text,
    case when pu.expected_at is not null and pu.expected_at < current_date then 'medium' else 'low' end,
    ('Compra ' || pu.order_number)::text,
    case when pu.expected_at is not null and pu.expected_at < current_date
         then ('Entrega atrasada ' || (current_date - pu.expected_at)::text || ' dias')
         else 'Aguardando recebimento' end::text,
    ('/compras/' || pu.id)::text,
    pu.expected_at,
    case when pu.expected_at is not null and pu.expected_at < current_date then (current_date - pu.expected_at)::int else null end,
    pu.total, sup.name
  from public.purchase_orders pu join public.suppliers sup on sup.id = pu.supplier_id
  where pu.company_id = v_cid
    and pu.status not in ('recebido_completo', 'conferido', 'liberado_para_producao', 'cancelado')
  order by pu.expected_at asc nulls last limit 10;

  -- Instalacoes nas proximas 48h
  return query
  select i.id, 'instalacao'::text, 'medium'::text,
    ('Instalação — ' || c.name)::text,
    ('Agendada para ' || to_char(i.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))::text,
    ('/instalacoes/' || i.id)::text,
    (i.scheduled_at at time zone 'America/Sao_Paulo')::date, null::int, null::numeric, c.name
  from public.installations i
  join public.orders  o on o.id = i.order_id
  join public.clients c on c.id = o.client_id
  where i.company_id = v_cid and i.status in ('agendada', 'em_andamento')
    and i.scheduled_at between now() - interval '2 hours' and now() + interval '48 hours'
  order by i.scheduled_at asc limit 10;

  -- Medicoes sem data, atrasadas ou nas proximas 48h
  return query
  select m.id, 'medicao'::text,
    case when m.scheduled_at is not null and m.scheduled_at < now() - interval '24 hours' then 'high'
         when m.scheduled_at is null then 'medium' else 'low' end,
    ('Medição ' || coalesce(m.measurement_number, '—'))::text,
    case when m.scheduled_at is null then 'Sem data agendada'
         else ('Agendada ' || to_char(m.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))
    end::text,
    ('/medicoes/' || m.id)::text,
    (m.scheduled_at at time zone 'America/Sao_Paulo')::date,
    case when m.scheduled_at is not null and m.scheduled_at < now()
         then extract(day from now() - m.scheduled_at)::int else null end,
    null::numeric, c.name
  from public.measurements m join public.clients c on c.id = m.client_id
  where m.company_id = v_cid
    and m.status in ('agendado', 'confirmado', 'em_deslocamento', 'em_medicao', 'reagendado')
    and (m.scheduled_at is null or m.scheduled_at < now() + interval '48 hours')
  order by m.scheduled_at asc nulls first limit 10;
end;
$$;

revoke all on function public.pending_center() from public, anon;
grant execute on function public.pending_center() to authenticated;

commit;
