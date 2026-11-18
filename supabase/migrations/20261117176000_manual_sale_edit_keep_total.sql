begin;
-- Corrigir venda lancada a mao (sem orcamento): cliente, itens, vencimento, observacao.
-- Venda de orcamento se corrige revertendo a aprovacao. Cancelar: sem pagamento valido e sem pedido.
create or replace function public.update_manual_sale(p_id uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); s public.sales; e public.financial_entries; item jsonb; it public.sale_items; new_total numeric;
  client uuid := nullif(p_payload->>'client_id','')::uuid; before jsonb; changed boolean := false;
begin
  perform public.require_table_access('sales','update');
  select * into s from public.sales where id = p_id and company_id = c for update;
  if s.id is null then raise exception 'Venda não encontrada'; end if;
  if exists(select 1 from public.quotes where sale_id = s.id) then raise exception 'Esta venda veio de um orçamento. Para corrigir, reverta a aprovação no orçamento'; end if;
  if s.operational_status = 'cancelado' then raise exception 'Venda cancelada não pode ser editada'; end if;
  if client is not null and not exists(select 1 from public.clients where id = client and company_id = c) then raise exception 'Cliente inválido'; end if;
  select jsonb_build_object('venda', to_jsonb(s), 'itens', coalesce(jsonb_agg(to_jsonb(i)), '[]')) into before from public.sale_items i where i.sale_id = s.id;
  if jsonb_typeof(p_payload->'items') = 'array' then
    for item in select * from jsonb_array_elements(p_payload->'items') loop
      select * into it from public.sale_items where id = (item->>'id')::uuid and sale_id = s.id for update;
      if it.id is null then raise exception 'Item inválido'; end if;
      if (item->>'quantity')::numeric <= 0 or (item->>'unit_price')::numeric < 0 then raise exception 'Quantidade ou valor inválido'; end if;
      if (item->>'quantity')::numeric <> it.quantity or (item->>'unit_price')::numeric <> it.unit_price then changed := true; end if;
      update public.sale_items set description = coalesce(nullif(btrim(item->>'description'),''), description), quantity = (item->>'quantity')::numeric, unit_price = (item->>'unit_price')::numeric where id = it.id;
    end loop;
  end if;
  -- O total so e recalculado quando quantidade/valor dos itens mudou.
  if changed then
    select round(coalesce(sum(total),0),2) into new_total from public.sale_items where sale_id = s.id;
    if new_total <= 0 then raise exception 'A venda precisa ter valor'; end if;
  else new_total := s.total; end if;
  if new_total < s.paid_amount then raise exception 'O novo total (%) é menor que o já recebido (%). Estorne o pagamento antes', new_total, s.paid_amount; end if;
  update public.sales set total = new_total, client_id = coalesce(client, client_id),
    notes = case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'),'') else notes end,
    financial_status = case when paid_amount >= new_total then 'pago'::public.financial_status when paid_amount > 0 then 'parcialmente_pago'::public.financial_status else 'aguardando_pagamento'::public.financial_status end
    where id = s.id;
  select * into e from public.financial_entries where sale_id = s.id and entry_type = 'receber' and status <> 'cancelado' order by created_at limit 1 for update;
  if e.id is not null then
    if (select count(*) from public.financial_entries where sale_id = s.id and entry_type = 'receber' and status <> 'cancelado') > 1 then
      raise exception 'Venda com várias contas a receber: corrija cada conta no Financeiro'; end if;
    update public.financial_entries set total_amount = new_total, client_id = coalesce(client, client_id),
      due_date = case when p_payload ? 'due_date' then nullif(p_payload->>'due_date','')::date else due_date end,
      status = case when paid_amount >= new_total then 'pago'::public.financial_status when paid_amount > 0 then 'parcialmente_pago'::public.financial_status else 'aguardando_pagamento'::public.financial_status end
      where id = e.id;
  end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'sales', s.id, 'EDIT', before, p_payload);
end $$;
revoke all on function public.update_manual_sale(uuid,jsonb) from public, anon;
grant execute on function public.update_manual_sale(uuid,jsonb) to authenticated;

create or replace function public.cancel_manual_sale(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare c uuid := public.current_company_id(); s public.sales;
begin
  perform public.require_table_access('sales','update');
  select * into s from public.sales where id = p_id and company_id = c for update;
  if s.id is null then raise exception 'Venda não encontrada'; end if;
  if exists(select 1 from public.quotes where sale_id = s.id) then raise exception 'Esta venda veio de um orçamento. Reverta a aprovação no orçamento'; end if;
  if s.operational_status = 'cancelado' then raise exception 'Venda já cancelada'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  if exists(select 1 from public.payments p join public.financial_entries e on e.id = p.financial_entry_id where e.sale_id = s.id and p.reversed_at is null) then
    raise exception 'Estorne os pagamentos desta venda antes de cancelar'; end if;
  if exists(select 1 from public.orders where sale_id = s.id) then raise exception 'Esta venda já tem pedido em andamento. Não é possível cancelar por aqui'; end if;
  update public.sales set operational_status = 'cancelado', financial_status = 'cancelado', next_action = null, next_action_date = null,
    notes = concat_ws(E'\n', notes, 'Cancelada: ' || left(btrim(p_reason),300)) where id = s.id;
  update public.financial_entries set status = 'cancelado' where sale_id = s.id;
  update public.commissions set status = 'cancelado' where sale_id = s.id and status = 'pendente' and paid_at is null;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'sales', s.id, 'CANCEL', to_jsonb(s), jsonb_build_object('motivo', left(btrim(p_reason),500)));
end $$;
revoke all on function public.cancel_manual_sale(uuid,text) from public, anon;
grant execute on function public.cancel_manual_sale(uuid,text) to authenticated;
commit;
