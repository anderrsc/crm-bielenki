-- Fila de ordens de serviço: todo pedido novo entra na fila; ao imprimir, sai da fila.
-- Pedidos antigos ficam fora da fila (os_queued_at nulo), mas podem ser impressos pela aba "Todas".
alter table public.orders add column if not exists os_queued_at timestamptz;
alter table public.orders add column if not exists os_printed_at timestamptz;
alter table public.orders add column if not exists os_print_sent_at timestamptz; -- mandou imprimir e ainda não confirmou
alter table public.orders add column if not exists os_printed_by uuid references public.profiles(id) on delete set null;
alter table public.orders alter column os_queued_at set default now();
create index if not exists orders_os_fila_idx on public.orders(company_id, os_queued_at) where os_printed_at is null;
create index if not exists orders_os_sem_confirmar_idx on public.orders(company_id) where os_print_sent_at is not null and os_printed_at is null;

-- Etapas: 'enviada' (clicou em imprimir, falta confirmar), 'impressa' (confirmou), 'fila' (volta para a fila).
create or replace function public.set_orders_os_print(p_order_ids uuid[], p_step text)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
  if p_step not in ('enviada','impressa','fila') then raise exception 'Etapa invalida'; end if;
  if public.current_company_id() is null or not public.has_table_access('orders','select') then
    raise exception 'Sem permissao' using errcode='42501'; end if;
  if coalesce(array_length(p_order_ids,1),0) > 200 then raise exception 'Selecione no maximo 200 ordens'; end if;
  update public.orders
     set os_print_sent_at = case p_step when 'enviada' then now() else null end,
         os_printed_at    = case p_step when 'impressa' then now() when 'fila' then null else os_printed_at end,
         os_printed_by    = case p_step when 'impressa' then auth.uid() when 'fila' then null else os_printed_by end,
         os_queued_at     = case p_step when 'fila' then coalesce(os_queued_at, now()) else os_queued_at end
   where id = any(p_order_ids) and company_id = public.current_company_id()
     and (p_step <> 'enviada' or os_printed_at is null);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_orders_os_print(uuid[],text) from public,anon;
grant execute on function public.set_orders_os_print(uuid[],text) to authenticated;
