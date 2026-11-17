begin;
-- Revisao: credito com fornecedor coerente em relatorio e conciliacao; travas de edicao.
CREATE OR REPLACE FUNCTION public.reporting_summary(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'sales_total',coalesce((select sum(total) from sales where (created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end),0),
  'sales_count',(select count(*) from sales where (created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end),
  'average_ticket',coalesce((select avg(total) from sales where (created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end),0),
  'received',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='receber' and p.reversed_at is null and p.paid_at between p_start and p_end),0),
  'paid',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='pagar' and p.reversed_at is null and p.payment_method is distinct from 'credito_fornecedor' and p.paid_at between p_start and p_end),0)+coalesce((select sum(sc.amount) from supplier_credits sc where sc.company_id=public.current_company_id() and sc.kind in ('excedente','adiantamento') and sc.account_id is not null and sc.moved_at between p_start and p_end),0),
  'receivable',coalesce((select sum(open_amount) from financial_entries where entry_type='receber' and status not in ('pago','cancelado')),0),
  'payable',coalesce((select sum(open_amount) from financial_entries where entry_type='pagar' and status not in ('pago','cancelado')),0),
  'overdue_receivable',coalesce((select sum(open_amount) from financial_entries where entry_type='receber' and open_amount>0 and due_date<current_date and status<>'cancelado'),0),
  'late_purchases',(select count(*) from purchase_orders where expected_at<current_date and status not in ('recebido_completo','conferido','liberado_para_producao','cancelado')),
  'blocked_orders',(select count(*) from orders where blocked_reason is not null and operational_status<>'finalizado'),
  'waiting_materials',(select count(*) from production_orders where status='aguardando_material'),
  'quotes_open',(select count(*) from quotes where status not in ('aprovado','recusado','cancelado') and (created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end),
  'sales_by_type',coalesce((select jsonb_agg(x order by x.total desc) from (select st.name,sum(s.total) total,count(*) quantity from sales s join sale_types st on st.id=s.sale_type_id where (s.created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end group by st.name) x),'[]'::jsonb),
  'quotes_by_status',coalesce((select jsonb_agg(x order by x.quantity desc) from (select status,count(*) quantity,coalesce(sum(total),0) total from quotes where (created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end group by status) x),'[]'::jsonb),
  'pipeline_by_stage',coalesce((select jsonb_agg(x order by x.sort_order) from (select ps.name,ps.color,ps.sort_order,count(l.id) quantity,coalesce(sum(l.estimated_value),0) total from pipeline_stages ps left join leads l on l.stage_id=ps.id and l.status='aberto' and l.deleted_at is null group by ps.id,ps.name,ps.color,ps.sort_order) x),'[]'::jsonb),
  'monthly_sales',coalesce((select jsonb_agg(x order by x.mes) from (select date_trunc('month',created_at at time zone 'America/Sao_Paulo')::date mes,sum(total) total,count(*) quantity from sales where (created_at at time zone 'America/Sao_Paulo')>=date_trunc('month',p_end::timestamp)-interval '5 months' and (created_at at time zone 'America/Sao_Paulo')<date_trunc('month',p_end::timestamp)+interval '1 month' group by 1) x),'[]'::jsonb)
)
$function$;
CREATE OR REPLACE FUNCTION public.bank_reconciliation_candidates(p_row uuid, p_window integer DEFAULT 7, p_query text DEFAULT NULL::text)
 RETURNS TABLE(payment_id uuid, description text, amount numeric, paid_at date, account_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select p.id,e.description,p.amount,p.paid_at,p.receiving_account_id
  from public.bank_statement_rows r join public.payments p on p.company_id=r.company_id and p.amount=abs(r.amount) and p.reversed_at is null and p.payment_method is distinct from 'credito_fornecedor'
  join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
  where r.id=p_row and r.company_id=crm_private.bank_context('select') and r.status='pending'
    and (e.entry_type::text='receber')=(r.amount>0) and (p.receiving_account_id is null or p.receiving_account_id=r.account_id)
    and p.paid_at between r.posted_at-least(greatest(coalesce(p_window,7),1),90) and r.posted_at+least(greatest(coalesce(p_window,7),1),90)
    and (nullif(btrim(p_query),'') is null or e.description ilike '%'||left(p_query,80)||'%')
    and not exists(select 1 from public.bank_statement_rows b where b.company_id=r.company_id and b.payment_id=p.id)
  order by abs(p.paid_at-r.posted_at),p.paid_at,p.id limit 20;
$function$;
-- Ajuste gerado por estorno de baixa (tem payment_id) nao e editavel: corrige-se pela baixa.
create or replace function crm_private.supplier_credit_editable(r public.supplier_credits) returns boolean
language sql immutable set search_path = pg_catalog, public as $$ select r.kind in ('adiantamento','abatimento','ajuste') and r.payment_id is null and r.financial_entry_id is null $$;
revoke all on function crm_private.supplier_credit_editable(public.supplier_credits) from public, anon;
grant execute on function crm_private.supplier_credit_editable(public.supplier_credits) to authenticated;
CREATE OR REPLACE FUNCTION public.update_supplier_credit(p_id uuid, p_amount numeric, p_date date, p_account uuid, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare r public.supplier_credits; c uuid := public.current_company_id(); new_row public.supplier_credits;
begin
  perform public.require_table_access('financial_entries','update');
  select * into r from public.supplier_credits where id = p_id and company_id = c for update;
  if r.id is null then raise exception 'Crédito não encontrado'; end if;
  if not crm_private.supplier_credit_editable(r) then raise exception 'Este crédito veio de uma baixa. Para corrigir, estorne a baixa'; end if;
  if r.kind = 'ajuste' and not exists(select 1 from unnest(public.current_user_roles()) x where x::text in ('administrador','gerente')) then
    raise exception 'Somente a gerência altera ajuste' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or (r.kind <> 'ajuste' and p_amount < 0) then raise exception 'Valor inválido'; end if;
  if r.kind = 'adiantamento' and p_account is null then raise exception 'Informe a conta de onde saiu o dinheiro'; end if;
  if p_account is not null and not exists(select 1 from public.receiving_accounts where id = p_account and company_id = c) then raise exception 'Conta inválida'; end if;
  if nullif(btrim(coalesce(p_notes,'')),'') is null then raise exception 'Informe o motivo'; end if;
  perform pg_advisory_xact_lock(hashtextextended('supplier-credit:' || r.supplier_id::text, 0));
  if crm_private.supplier_credit_balance(c, r.supplier_id) - r.amount + round(p_amount,2) < 0 then
    raise exception 'O crédito já foi usado; o novo valor deixaria o saldo negativo'; end if;
  update public.supplier_credits set amount = round(p_amount,2), moved_at = coalesce(p_date, moved_at),
    account_id = case when kind = 'adiantamento' then p_account end, notes = left(btrim(p_notes),500)
    where id = r.id returning * into new_row;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'supplier_credits', r.id, 'UPDATE', to_jsonb(r), to_jsonb(new_row));
end $function$;
CREATE OR REPLACE FUNCTION public.delete_supplier_credit(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare r public.supplier_credits; c uuid := public.current_company_id();
begin
  perform public.require_table_access('financial_entries','update');
  select * into r from public.supplier_credits where id = p_id and company_id = c for update;
  if r.id is null then raise exception 'Crédito não encontrado'; end if;
  if not crm_private.supplier_credit_editable(r) then raise exception 'Este crédito veio de uma baixa. Para corrigir, estorne a baixa'; end if;
  if r.kind = 'ajuste' and not exists(select 1 from unnest(public.current_user_roles()) x where x::text in ('administrador','gerente')) then
    raise exception 'Somente a gerência exclui ajuste' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  perform pg_advisory_xact_lock(hashtextextended('supplier-credit:' || r.supplier_id::text, 0));
  if crm_private.supplier_credit_balance(c, r.supplier_id) - r.amount < 0 then
    raise exception 'O crédito já foi usado; excluir deixaria o saldo negativo'; end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'supplier_credits', r.id, 'DELETE', to_jsonb(r), jsonb_build_object('motivo', left(btrim(p_reason),500)));
  delete from public.supplier_credits where id = r.id;
end $function$;
CREATE OR REPLACE FUNCTION public.cancel_financial_entry(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare e public.financial_entries; c uuid := public.current_company_id();
begin
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries where id = p_id and company_id = c for update;
  if e.id is null then raise exception 'Lançamento não encontrado'; end if;
  if e.status = 'cancelado' then raise exception 'Conta já cancelada'; end if;
  if e.sale_id is not null or e.purchase_order_id is not null or e.origin not in ('manual','despesa','ajuste') then raise exception 'Esta conta vem de uma venda, compra ou comissão. Cancele pela origem'; end if;
  if exists(select 1 from public.payments where financial_entry_id = e.id and reversed_at is null) then raise exception 'Estorne os pagamentos antes de cancelar'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  update public.financial_entries set status = 'cancelado', notes = concat_ws(E'\n', notes, 'Cancelada: ' || left(btrim(p_reason),300)) where id = e.id;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'financial_entries', e.id, 'CANCEL', to_jsonb(e), jsonb_build_object('motivo', left(btrim(p_reason),500)));
end $function$;
commit;
