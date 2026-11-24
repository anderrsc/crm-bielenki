-- Fase 5 — Dashboards por Função
-- Views e funções para painéis específicos por cargo: vendedor, produção, instalação, financeiro.

-- ─── Dashboard do Vendedor ──────────────────────────────────────────────────
create or replace function public.dashboard_vendedor()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
 v_profile_id uuid := auth.uid();
 v_company_id uuid := public.current_company_id();
 v_mes_inicio date := date_trunc('month', now());
 v_result jsonb;
begin
 if v_company_id is null then return '{}'::jsonb; end if;

 select jsonb_build_object(
 'orcamentos_mes', (select count(*) from quotes q where q.company_id = v_company_id and q.seller_id = v_profile_id and q.created_at >= v_mes_inicio),
 'orcamentos_pendentes', (select count(*) from quotes q where q.company_id = v_company_id and q.seller_id = v_profile_id and q.status in ('rascunho','enviado')),
 'vendas_mes', (select coalesce(sum(s.total),0) from sales s where s.company_id = v_company_id and s.seller_id = v_profile_id and s.created_at >= v_mes_inicio),
 'qtd_vendas_mes', (select count(*) from sales s where s.company_id = v_company_id and s.seller_id = v_profile_id and s.created_at >= v_mes_inicio),
 'leads_abertos', (select count(*) from leads l where l.company_id = v_company_id and l.owner_id = v_profile_id and l.status not in ('ganho','perdido')),
 'followups_hoje', (select count(*) from followups f where f.company_id = v_company_id and f.responsible_id = v_profile_id and f.due_at::date = current_date and f.status = 'pendente'),
 'pedidos_ativos', (select count(*) from orders o join sales s on s.id = o.sale_id where o.company_id = v_company_id and s.seller_id = v_profile_id and o.operational_status not in ('finalizado','cancelado')),
 'receber_aberto', (select coalesce(sum(fe.open_amount),0) from financial_entries fe join sales s on s.id = fe.sale_id where fe.company_id = v_company_id and s.seller_id = v_profile_id and fe.entry_type::text = 'receber' and fe.status::text not in ('pago','cancelado'))
 ) into v_result;

 return v_result;
end $$;

revoke all on function public.dashboard_vendedor() from public, anon;
grant execute on function public.dashboard_vendedor() to authenticated;

-- ─── Dashboard da Produção ──────────────────────────────────────────────────
create or replace function public.dashboard_producao()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
 v_company_id uuid := public.current_company_id();
 v_result jsonb;
begin
 if v_company_id is null then return '{}'::jsonb; end if;

 select jsonb_build_object(
 'em_producao', (select count(*) from production_orders po where po.company_id = v_company_id and po.status not in ('concluida','cancelada')),
 'aguardando_material', (select count(*) from production_orders po where po.company_id = v_company_id and po.status = 'aguardando_material'),
 'liberados_corte', (select count(*) from orders o where o.company_id = v_company_id and o.op_stage = 'liberado_corte' and o.operational_status not in ('finalizado','cancelado')),
 'aguardando_liberacao', (select count(*) from orders o where o.company_id = v_company_id and o.op_stage = 'aguardando_liberacao_corte' and o.operational_status not in ('finalizado','cancelado')),
 'compras_pendentes', (select count(*) from purchase_orders po where po.company_id = v_company_id and po.status not in ('recebido_completo','cancelado','cancelada')),
 'instalacoes_hoje', (select count(*) from installations i where i.company_id = v_company_id and i.scheduled_at::date = current_date and i.status not in ('concluida','cancelada')),
 'pedidos_atrasados', (select count(*) from orders o where o.company_id = v_company_id and o.next_action_date < current_date and o.operational_status not in ('finalizado','cancelado') and o.next_action_date is not null),
 'producao_concluida_mes', (select count(*) from production_orders po where po.company_id = v_company_id and po.status = 'concluida' and po.updated_at >= date_trunc('month', now()))
 ) into v_result;

 return v_result;
end $$;

revoke all on function public.dashboard_producao() from public, anon;
grant execute on function public.dashboard_producao() to authenticated;

-- ─── Dashboard da Instalação ────────────────────────────────────────────────
create or replace function public.dashboard_instalacao()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
 v_company_id uuid := public.current_company_id();
 v_result jsonb;
begin
 if v_company_id is null then return '{}'::jsonb; end if;

 select jsonb_build_object(
 'instalacoes_hoje', (select count(*) from installations i where i.company_id = v_company_id and i.scheduled_at::date = current_date and i.status not in ('concluida','cancelada')),
 'instalacoes_semana', (select count(*) from installations i where i.company_id = v_company_id and i.scheduled_at::date between current_date and current_date + 6 and i.status not in ('concluida','cancelada')),
 'instalacoes_pendentes', (select count(*) from installations i where i.company_id = v_company_id and i.status not in ('concluida','cancelada')),
 'instalacoes_atrasadas', (select count(*) from installations i where i.company_id = v_company_id and i.scheduled_at::date < current_date and i.status not in ('concluida','cancelada')),
 'concluidas_mes', (select count(*) from installations i where i.company_id = v_company_id and i.status = 'concluida' and i.completed_at >= date_trunc('month', now())),
 'checklists_incompletos', (select count(distinct i.id) from installations i join installation_checklists ic on ic.installation_id = i.id where i.company_id = v_company_id and i.status not in ('concluida','cancelada') and ic.completed = false),
 'pos_venda_aberto', (select count(*) from post_sales ps where ps.company_id = v_company_id and ps.type = 'follow_up' and ps.status in ('aberto','em_andamento')),
 'problemas_abertos', (select count(*) from post_sales ps where ps.company_id = v_company_id and ps.type = 'problema' and ps.status in ('aberto','em_andamento'))
 ) into v_result;

 return v_result;
end $$;

revoke all on function public.dashboard_instalacao() from public, anon;
grant execute on function public.dashboard_instalacao() to authenticated;