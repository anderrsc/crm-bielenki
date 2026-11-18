begin;
-- Corrigir credito lancado errado: editar ou excluir adiantamento, abatimento e ajuste.
-- Excedente e uso vem de uma baixa; corrige-se estornando a baixa. Tudo fica no historico.
create or replace function public.update_supplier_credit(p_id uuid, p_amount numeric, p_date date, p_account uuid, p_notes text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.supplier_credits; c uuid := public.current_company_id(); new_row public.supplier_credits;
begin
  perform public.require_table_access('financial_entries','update');
  select * into r from public.supplier_credits where id = p_id and company_id = c for update;
  if r.id is null then raise exception 'Crédito não encontrado'; end if;
  if r.kind not in ('adiantamento','abatimento','ajuste') then raise exception 'Este crédito veio de uma baixa. Para corrigir, estorne a baixa'; end if;
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
end $$;
revoke all on function public.update_supplier_credit(uuid,numeric,date,uuid,text) from public, anon;
grant execute on function public.update_supplier_credit(uuid,numeric,date,uuid,text) to authenticated;

create or replace function public.delete_supplier_credit(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.supplier_credits; c uuid := public.current_company_id();
begin
  perform public.require_table_access('financial_entries','update');
  select * into r from public.supplier_credits where id = p_id and company_id = c for update;
  if r.id is null then raise exception 'Crédito não encontrado'; end if;
  if r.kind not in ('adiantamento','abatimento','ajuste') then raise exception 'Este crédito veio de uma baixa. Para corrigir, estorne a baixa'; end if;
  if r.kind = 'ajuste' and not exists(select 1 from unnest(public.current_user_roles()) x where x::text in ('administrador','gerente')) then
    raise exception 'Somente a gerência exclui ajuste' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo'; end if;
  perform pg_advisory_xact_lock(hashtextextended('supplier-credit:' || r.supplier_id::text, 0));
  if crm_private.supplier_credit_balance(c, r.supplier_id) - r.amount < 0 then
    raise exception 'O crédito já foi usado; excluir deixaria o saldo negativo'; end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values (c, auth.uid(), 'supplier_credits', r.id, 'DELETE', to_jsonb(r), jsonb_build_object('motivo', left(btrim(p_reason),500)));
  delete from public.supplier_credits where id = r.id;
end $$;
revoke all on function public.delete_supplier_credit(uuid,text) from public, anon;
grant execute on function public.delete_supplier_credit(uuid,text) to authenticated;
commit;
