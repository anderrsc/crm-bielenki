-- Banca de revisao (08/11/2026): gerente nao pode virar administrador nem mexer em admin.
begin;

create or replace function public.replace_user_roles(p_profile_id uuid, p_roles public.app_role[])
returns void language plpgsql security definer set search_path=public as $$
declare c uuid:=public.current_company_id(); target_company uuid; current_is_admin boolean; requested_admin boolean;
begin
  if not public.has_role(array['administrador','gerente']::public.app_role[]) then
    raise exception 'Sem permissao para alterar cargos' using errcode='42501';
  end if;
  select company_id into target_company from public.profiles where id=p_profile_id;
  if target_company is null or target_company<>c then raise exception 'Funcionario invalido'; end if;
  current_is_admin:=exists(select 1 from public.user_roles where profile_id=p_profile_id and role='administrador');
  requested_admin:='administrador'=any(coalesce(p_roles,array[]::public.app_role[]));
  -- So administrador da ou tira o cargo de administrador (e mexe nos cargos de um admin).
  if (current_is_admin or requested_admin) and not public.has_role(array['administrador']::public.app_role[]) then
    raise exception 'Somente administrador pode alterar cargos de administrador' using errcode='42501';
  end if;
  if current_is_admin and not requested_admin and
     (select count(*) from public.user_roles where company_id=c and role='administrador')<=1 then
    raise exception 'A empresa deve manter ao menos um administrador';
  end if;
  delete from public.user_roles where profile_id=p_profile_id and company_id=c;
  insert into public.user_roles(company_id,profile_id,role)
  select c,p_profile_id,role from unnest(coalesce(p_roles,array[]::public.app_role[])) role;
end $$;
revoke all on function public.replace_user_roles(uuid,public.app_role[]) from public;
grant execute on function public.replace_user_roles(uuid,public.app_role[]) to authenticated;

-- Cache de PDF do orcamento: so quem pode editar orcamento grava o arquivo.
drop policy if exists "company writes own quote pdfs" on storage.objects;
create policy "company writes own quote pdfs" on storage.objects for insert to authenticated
with check(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text
  and public.has_table_access('quotes','update'));

drop policy if exists "company updates own quote pdfs" on storage.objects;
create policy "company updates own quote pdfs" on storage.objects for update to authenticated
using(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text
  and public.has_table_access('quotes','update'));

-- Logo: sem SVG (SVG pode carregar script).
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp']
 where id = 'company-assets';

-- Relatorios: dia/mes no horario de Brasilia (antes UTC: venda apos 21h caia no dia seguinte) e sem leads excluidos.
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
  'paid',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='pagar' and p.reversed_at is null and p.paid_at between p_start and p_end),0),
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

-- Telefone com zero no DDD: (047) 98495-3693 = 47984953693 (antes virava outro cliente).
create or replace function public.client_phone_key(raw text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
begin
  if length(d) in (12, 13) and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) in (11, 12) and left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) = 10 and substr(d, 3, 1) between '6' and '9' then d := left(d, 2) || '9' || substr(d, 3); end if;
  if length(d) in (10, 11) then return d; end if;
  if length(d) >= 12 then return '+' || d; end if;
  return null; -- sem DDD não dá para saber se é o mesmo número
end $$;
reindex index public.clients_phone_key_idx;

-- Desconto e frete negativos (RPC chamado direto) inflavam o total. NOT VALID: vale para o que for gravado daqui pra frente.
alter table public.quotes drop constraint if exists quotes_discount_freight_nonneg;
alter table public.quotes add constraint quotes_discount_freight_nonneg
  check (coalesce(discount, 0) >= 0 and coalesce(freight, 0) >= 0) not valid;

commit;
