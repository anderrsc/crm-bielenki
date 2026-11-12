-- Read-only management totals; existing historical RPC remains compatible.
create or replace function public.financial_control_totals(p_type text default null, p_q text default null, p_from date default null,
  p_to date default null, p_status text default null, p_sale_type uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with f as (
    select * from public.v_financial_entries v
    where v.company_id = public.current_company_id() and (p_type is null or v.entry_type::text = p_type)
      and (p_q is null or v.description ilike '%'||p_q||'%' or v.client_name ilike '%'||p_q||'%' or v.supplier_name ilike '%'||p_q||'%')
      and (p_from is null or v.due_date >= p_from) and (p_to is null or v.due_date <= p_to)
      and (p_sale_type is null or exists (select 1 from public.sales sl where sl.id=v.sale_id and sl.company_id=v.company_id and sl.sale_type_id=p_sale_type))
      and (p_status is null
        or (p_status = 'aberto' and v.open_amount > 0 and v.display_status <> 'cancelado')
        or (p_status = 'vencido' and v.display_status = 'vencido')
        or (p_status = 'hoje' and v.display_status = 'vence_hoje')
        or (p_status = 'pago' and v.display_status = 'pago'))
  )
  , parts as (
    select f.id, f.entry_type, i.due_date, i.amount, f.paid_amount,
      coalesce(sum(i.amount) over (partition by f.id order by i.installment_number, i.id rows between unbounded preceding and 1 preceding),0) as prior_amount
    from f join public.financial_installments i on i.financial_entry_id=f.id and i.company_id=f.company_id
    where f.open_amount>0 and f.display_status not in ('cancelado','pago')
  ), cashflows as (
    select id,entry_type,due_date,greatest(amount-greatest(paid_amount-prior_amount,0),0) as open_amount from parts
    union all
    select f.id,f.entry_type,f.due_date,f.open_amount from f
    where f.open_amount>0 and f.display_status not in ('cancelado','pago') and not exists(select 1 from parts p where p.id=f.id)
  )
  select jsonb_build_object(
    'pending_total', coalesce(sum(open_amount) filter (where display_status in ('aguardando_pagamento','parcialmente_pago','vence_hoje','vencido') and open_amount > 0), 0),
    'pending_count', count(*) filter (where display_status in ('aguardando_pagamento','parcialmente_pago','vence_hoje','vencido') and open_amount > 0),
    'overdue_total', coalesce(sum(open_amount) filter (where display_status = 'vencido' and open_amount > 0), 0),
    'overdue_count', count(*) filter (where display_status = 'vencido' and open_amount > 0),
    'today_count', count(*) filter (where display_status = 'vence_hoje'),
    'done_count', count(*) filter (where display_status = 'pago'),
    
    'paid_total', coalesce(sum(paid_amount) filter (where display_status <> 'cancelado'), 0),
    'receivable_total', coalesce(sum(open_amount) filter (where entry_type = 'receber' and display_status <> 'cancelado'), 0),
    'payable_total', coalesce(sum(open_amount) filter (where entry_type = 'pagar' and display_status <> 'cancelado'), 0),
    'undated_count', (select count(distinct id) from cashflows where due_date is null and open_amount>0),
    'projection', (select jsonb_agg(jsonb_build_object(
      'days', h.days,
      'receivable', (select coalesce(sum(open_amount),0) from cashflows where entry_type='receber' and due_date between current_date and current_date+h.days),
      'payable', (select coalesce(sum(open_amount),0) from cashflows where entry_type='pagar' and due_date between current_date and current_date+h.days)
    ) order by h.days) from (values (7),(15),(30),(60),(90)) h(days))
  ) from f;
$$;
revoke all on function public.financial_control_totals(text,text,date,date,text,uuid) from public, anon;
grant execute on function public.financial_control_totals(text,text,date,date,text,uuid) to authenticated;
