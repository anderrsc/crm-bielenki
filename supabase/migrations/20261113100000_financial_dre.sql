begin;
-- DRE gerencial por competencia. Aditivo: nenhum valor, baixa ou vencimento muda.
-- Cada categoria aponta para uma linha da DRE; a conta guarda a data de competencia
-- (quando o fato aconteceu), separada do vencimento e do pagamento.
alter table public.financial_categories add column if not exists dre_group text;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.financial_categories'::regclass and conname='financial_categories_dre_group_check') then
    alter table public.financial_categories add constraint financial_categories_dre_group_check
      check(dre_group is null or dre_group in ('receita','deducao','custo','comercial','administrativa','outras','financeiro'));
  end if;
end $$;
-- Sugestao inicial pela descricao; so preenche o que ainda esta vazio.
update public.financial_categories set dre_group = case
  when entry_type::text='receber' then 'receita'
  when name ilike any(array['%imposto%','%tribut%','%simples nacional%']) then 'deducao'
  when name ilike any(array['%bobina%','%perfil%','%perfis%','%vidro%','%acess%','%pintura%','%frete%','%terceiriz%','%ferrament%','%material%','%instala%']) then 'custo'
  when name ilike any(array['%comiss%','%marketing%','%propaganda%','%anúncio%','%anuncio%']) then 'comercial'
  when name ilike any(array['%banc%','%juros%','%tarifa%','%financ%']) then 'financeiro'
  else 'administrativa' end
where dre_group is null;

alter table public.financial_entries add column if not exists competence_date date;
create index if not exists financial_entries_competence_idx
  on public.financial_entries(company_id, (coalesce(competence_date, (created_at at time zone 'America/Sao_Paulo')::date)));

-- Linhas da DRE por mes de competencia. Valores positivos nas linhas de receita e despesa;
-- no grupo 'financeiro' o valor ja vem com sinal (receita +, despesa -). security invoker: vale a permissao financeira de quem consulta.
-- Com p_sale_type, entram so receitas das vendas daquele tipo e custos ligados a venda ou rateados para obras daquele tipo.
create or replace function public.financial_dre_lines(p_start date, p_end date, p_sale_type uuid default null)
returns table(month date, grp text, category text, amount numeric)
language sql stable security invoker set search_path=pg_catalog,public as $$
  with e as (
    select fe.id, fe.entry_type::text as kind, fe.total_amount, coalesce(fe.interest_amount,0) as interest, coalesce(fe.discount_amount,0) as discount,
      date_trunc('month', coalesce(fe.competence_date, (fe.created_at at time zone 'America/Sao_Paulo')::date))::date as month,
      fc.name as category, fc.dre_group, sl.sale_type_id,
      exists(select 1 from public.financial_entry_allocations a where a.entry_id=fe.id) as allocated
    from public.financial_entries fe
    left join public.financial_categories fc on fc.id=fe.category_id and fc.company_id=fe.company_id
    left join public.sales sl on sl.id=fe.sale_id and sl.company_id=fe.company_id
    where fe.company_id=(select public.current_company_id()) and fe.status::text<>'cancelado'
      and coalesce(fe.competence_date, (fe.created_at at time zone 'America/Sao_Paulo')::date) between p_start and p_end
  ), share as (
    -- Parte da conta que pertence ao tipo de venda pedido (1 = inteira).
    select e.*, case
      when p_sale_type is null then 1::numeric
      when e.allocated then coalesce((select sum(a.amount) filter (where o.sale_type_id=p_sale_type) / nullif(sum(a.amount),0)
        from public.financial_entry_allocations a left join public.orders o on o.id=a.order_id where a.entry_id=e.id),0)
      when e.sale_type_id=p_sale_type then 1::numeric else 0::numeric end as part
    from e
  ), lines as (
    select month, case when kind='receber' then coalesce(dre_group,'receita') else coalesce(dre_group,'outras') end as grp,
      coalesce(category, case when kind='receber' then 'Receitas sem categoria' else 'Despesas sem categoria' end) as category,
      round((total_amount - interest + discount) * part, 2)
        * case when kind='pagar' and coalesce(dre_group,'outras')='financeiro' then -1 else 1 end as amount from share where part > 0
    union all
    select month, 'deducao', 'Descontos concedidos', round(discount * part, 2) from share where kind='receber' and discount > 0 and part > 0
    union all
    select month, 'financeiro', 'Juros recebidos', round(interest * part, 2) from share where kind='receber' and interest > 0 and part > 0
    union all
    select month, 'financeiro', 'Juros pagos', round(-interest * part, 2) from share where kind='pagar' and interest > 0 and part > 0
    union all
    select month, 'financeiro', 'Descontos obtidos', round(discount * part, 2) from share where kind='pagar' and discount > 0 and part > 0
  )
  select month, grp, category, sum(amount) from lines group by month, grp, category having sum(amount) <> 0;
$$;
revoke all on function public.financial_dre_lines(date,date,uuid) from public,anon;
grant execute on function public.financial_dre_lines(date,date,uuid) to authenticated;
commit;
