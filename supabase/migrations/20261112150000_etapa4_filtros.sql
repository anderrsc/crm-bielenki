-- Etapa 4: filtros do financeiro com totais de todos os lancamentos (nao so da pagina).
create or replace view public.v_financial_entries with (security_invoker=true) as
select
  fe.id, fe.company_id, fe.description, fe.entry_type, fe.origin,
  fe.total_amount, fe.paid_amount, fe.open_amount, fe.interest_amount, fe.discount_amount, fe.installment_count, fe.first_installment_due_date, fe.due_date, fe.status,
  fe.payment_method, fe.paid_at, fe.notes, fe.created_at,
  fe.client_id, fe.supplier_id, fe.sale_id, fe.purchase_order_id,
  case
    when fe.status = 'pago' then 'pago'
    when fe.status = 'cancelado' then 'cancelado'
    when fe.due_date < current_date then 'vencido'
    when fe.due_date = current_date then 'vence_hoje'
    when fe.status = 'parcialmente_pago' then 'parcialmente_pago'
    else 'aguardando_pagamento'
  end as display_status,
  c.name as client_name,
  s.name as supplier_name,
  sl.sale_type_id
from public.financial_entries fe
left join public.clients c on c.id = fe.client_id and c.company_id = fe.company_id
left join public.suppliers s on s.id = fe.supplier_id and s.company_id = fe.company_id
left join public.sales sl on sl.id = fe.sale_id and sl.company_id = fe.company_id;

create or replace function public.financial_totals(p_type text default null, p_q text default null, p_from date default null,
  p_to date default null, p_status text default null, p_sale_type uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with f as (
    select * from public.v_financial_entries v
    where (p_type is null or v.entry_type::text = p_type)
      and (p_q is null or v.description ilike '%'||p_q||'%' or v.client_name ilike '%'||p_q||'%' or v.supplier_name ilike '%'||p_q||'%')
      and (p_from is null or v.due_date >= p_from) and (p_to is null or v.due_date <= p_to)
      and (p_sale_type is null or v.sale_type_id = p_sale_type)
      and (p_status is null
        or (p_status = 'aberto' and v.open_amount > 0 and v.display_status <> 'cancelado')
        or (p_status = 'vencido' and v.display_status = 'vencido')
        or (p_status = 'hoje' and v.display_status = 'vence_hoje')
        or (p_status = 'pago' and v.display_status in ('pago','cancelado')))
  )
  select jsonb_build_object(
    'pending_total', coalesce(sum(open_amount) filter (where display_status in ('aguardando_pagamento','parcialmente_pago','vence_hoje','vencido') and open_amount > 0), 0),
    'pending_count', count(*) filter (where display_status in ('aguardando_pagamento','parcialmente_pago','vence_hoje','vencido') and open_amount > 0),
    'overdue_total', coalesce(sum(open_amount) filter (where display_status = 'vencido' and open_amount > 0), 0),
    'overdue_count', count(*) filter (where display_status = 'vencido' and open_amount > 0),
    'today_count', count(*) filter (where display_status = 'vence_hoje'),
    'done_count', count(*) filter (where display_status in ('pago','cancelado')),
    'paid_total', coalesce(sum(paid_amount), 0)
  ) from f;
$$;
revoke all on function public.financial_totals(text,text,date,date,text,uuid) from public, anon;
grant execute on function public.financial_totals(text,text,date,date,text,uuid) to authenticated;
