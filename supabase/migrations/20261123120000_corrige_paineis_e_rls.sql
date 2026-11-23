-- Corrige os painéis por função de 20/11 (20261120150000) e as políticas novas de 20/11.
-- Aditiva e pode ser rodada mais de uma vez.
--
-- 1) dashboard_producao() e dashboard_instalacao() davam erro ao abrir:
--    installations não tem scheduled_date (é scheduled_at, com hora), installation_checklists
--    não tem status (é completed) e production_orders não tem updated_at (é finished_at).
--    "Hoje" passa a ser o dia em Brasília (o banco roda em UTC).

create or replace function public.dashboard_producao()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
 v_company_id uuid := public.current_company_id();
 v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
 v_result jsonb;
begin
 if v_company_id is null then return '{}'::jsonb; end if;

 select jsonb_build_object(
 'em_producao', (select count(*) from production_orders po where po.company_id = v_company_id and po.status not in ('concluida','cancelada')),
 'aguardando_material', (select count(*) from production_orders po where po.company_id = v_company_id and po.status = 'aguardando_material'),
 'liberados_corte', (select count(*) from orders o where o.company_id = v_company_id and o.op_stage = 'liberado_corte' and o.operational_status not in ('finalizado','cancelado')),
 'aguardando_liberacao', (select count(*) from orders o where o.company_id = v_company_id and o.op_stage = 'aguardando_liberacao_corte' and o.operational_status not in ('finalizado','cancelado')),
 'compras_pendentes', (select count(*) from purchase_orders po where po.company_id = v_company_id and po.status not in ('recebido_completo','cancelado','cancelada')),
 'instalacoes_hoje', (select count(*) from installations i where i.company_id = v_company_id and (i.scheduled_at at time zone 'America/Sao_Paulo')::date = v_hoje and i.status not in ('concluida','cancelada')),
 'pedidos_atrasados', (select count(*) from orders o where o.company_id = v_company_id and o.next_action_date < v_hoje and o.operational_status not in ('finalizado','cancelado') and o.next_action_date is not null),
 'producao_concluida_mes', (select count(*) from production_orders po where po.company_id = v_company_id and po.status = 'concluida' and po.finished_at >= date_trunc('month', v_hoje))
 ) into v_result;

 return v_result;
end $$;

revoke all on function public.dashboard_producao() from public, anon;
grant execute on function public.dashboard_producao() to authenticated;

create or replace function public.dashboard_instalacao()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
 v_company_id uuid := public.current_company_id();
 v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
 v_result jsonb;
begin
 if v_company_id is null then return '{}'::jsonb; end if;

 select jsonb_build_object(
 'instalacoes_hoje', (select count(*) from installations i where i.company_id = v_company_id and (i.scheduled_at at time zone 'America/Sao_Paulo')::date = v_hoje and i.status not in ('concluida','cancelada')),
 'instalacoes_semana', (select count(*) from installations i where i.company_id = v_company_id and (i.scheduled_at at time zone 'America/Sao_Paulo')::date between v_hoje and v_hoje + 6 and i.status not in ('concluida','cancelada')),
 'instalacoes_pendentes', (select count(*) from installations i where i.company_id = v_company_id and i.status not in ('concluida','cancelada')),
 'instalacoes_atrasadas', (select count(*) from installations i where i.company_id = v_company_id and (i.scheduled_at at time zone 'America/Sao_Paulo')::date < v_hoje and i.status not in ('concluida','cancelada')),
 'concluidas_mes', (select count(*) from installations i where i.company_id = v_company_id and i.status = 'concluida' and i.completed_at >= date_trunc('month', v_hoje)),
 'checklists_incompletos', (select count(distinct i.id) from installations i join installation_checklists ic on ic.installation_id = i.id where i.company_id = v_company_id and i.status not in ('concluida','cancelada') and not ic.completed),
 'pos_venda_aberto', (select count(*) from post_sales ps where ps.company_id = v_company_id and ps.type = 'follow_up' and ps.status in ('aberto','em_andamento')),
 'problemas_abertos', (select count(*) from post_sales ps where ps.company_id = v_company_id and ps.type = 'problema' and ps.status in ('aberto','em_andamento'))
 ) into v_result;

 return v_result;
end $$;

revoke all on function public.dashboard_instalacao() from public, anon;
grant execute on function public.dashboard_instalacao() to authenticated;

-- 2) Políticas novas de 20/11 no padrão do projeto: funções de sessão dentro de "(select ...)",
--    avaliadas uma vez por consulta (mesma lógica da 20261103000000). O resultado é o mesmo.
do $$
declare
  p record;
  q text;
  c text;
  wrap constant text[] := array[
    '(?<!SELECT )(current_company_id\(\))',
    '(?<!SELECT )(auth\.uid\(\))',
    '(?<!SELECT )(has_table_access\(''[a-z_]+''::text, ''[a-z_]+''::text\))',
    '(?<!SELECT )(has_role\(ARRAY\[[^\]]*\]\))'
  ];
  w text;
begin
  for p in
    select pol.polname, cls.relname, pg_get_expr(pol.polqual, pol.polrelid) qual, pg_get_expr(pol.polwithcheck, pol.polrelid) chk
    from pg_policy pol join pg_class cls on cls.oid = pol.polrelid
    where cls.relnamespace = 'public'::regnamespace
  loop
    q := p.qual; c := p.chk;
    foreach w in array wrap loop
      q := regexp_replace(q, w, '(SELECT \1)', 'g');
      c := regexp_replace(c, w, '(SELECT \1)', 'g');
    end loop;
    if q is distinct from p.qual or c is distinct from p.chk then
      execute format('alter policy %I on public.%I', p.polname, p.relname)
        || case when q is null then '' else format(' using (%s)', q) end
        || case when c is null then '' else format(' with check (%s)', c) end;
    end if;
  end loop;
end $$;
