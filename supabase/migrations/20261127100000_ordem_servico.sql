-- Ordem de serviço do pedido (1/4 de A4). Aditiva: só cria colunas opcionais e uma função.
-- O instalador fica no pedido; medidor, prazo e data de fechamento continuam vindo do orçamento.
alter table public.orders add column if not exists installer_id uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists installer_name text;
comment on column public.orders.installer_id is 'Funcionário que vai instalar (sai na ordem de serviço).';
comment on column public.orders.installer_name is 'Instalador sem usuário no CRM (só o nome). Quando preenchido, installer_id fica vazio.';
create index if not exists orders_installer_id_idx on public.orders(installer_id);

create or replace function public.set_order_installer(p_order_id uuid, p_profile_id uuid default null, p_name text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.orders := crm_private.order_for_operation(p_order_id); nome text := nullif(btrim(coalesce(p_name,'')),'');
begin
  if p_profile_id is not null and not exists(select 1 from public.profiles where id=p_profile_id and company_id=o.company_id) then
    raise exception 'Instalador invalido'; end if;
  if nome is not null then p_profile_id := null; nome := left(nome,80); end if;
  update public.orders set installer_id=p_profile_id, installer_name=nome, updated_at=now() where id=o.id;
  perform crm_private.order_op_log(o.id,o.company_id,'INSTALADOR',
    jsonb_build_object('installer_id',o.installer_id,'installer_name',o.installer_name),
    jsonb_build_object('installer_id',p_profile_id,'installer_name',nome));
end $$;
revoke all on function public.set_order_installer(uuid,uuid,text) from public,anon;
grant execute on function public.set_order_installer(uuid,uuid,text) to authenticated;
