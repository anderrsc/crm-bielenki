-- Passo 6 de 10 — 045_fix_dashboard_and_alerts.sql
-- Cole no SQL Editor do Supabase (New query, sem nada selecionado) e clique Run. Pode ser repetido.

-- Migration 045 - Dashboard executivo e alertas operacionais falhavam
--
-- dashboard_executivo() referenciava purchase_orders.deleted_at e
-- sales.seller_name, que nao existem: a funcao inteira falhava e os
-- indicadores do dashboard ficavam zerados. Tambem contava orcamentos com
-- status 'pendente' (o sistema usa 'rascunho') e compras recebidas como
-- pendentes.
-- generate_operational_alerts() usava leads.updated_at, que nao existia.
-- auto_order_checklist() (trigger AFTER UPDATE em orders) lia NEW.status e
-- sales.order_id, que nao existem: QUALQUER update em pedidos falhava com
-- 'record "new" has no field "status"'.
-- create_order_checklist() inseria itens sem checklist_id e title (NOT NULL).
--
-- Pode ser rodada mais de uma vez.

begin;

alter table public.leads add column if not exists updated_at timestamptz;
update public.leads set updated_at = created_at where updated_at is null;
alter table public.leads alter column updated_at set default now();
alter table public.leads alter column updated_at set not null;
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
for each row execute function public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.dashboard_executivo()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_cid UUID;
  v_result JSON;
  v_inicio  DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
  v_fim     DATE := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  v_ant_ini DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::DATE;
  v_ant_fim DATE := (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')::DATE;
BEGIN
  SELECT company_id INTO v_cid FROM public.profiles WHERE id = auth.uid();
  IF v_cid IS NULL THEN RETURN '{}'::JSON; END IF;

  SELECT json_build_object(
    -- Leads
    'leads_mes',      (SELECT COUNT(*)              FROM public.leads WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'leads_mes_ant',  (SELECT COUNT(*)              FROM public.leads WHERE company_id = v_cid AND created_at::DATE BETWEEN v_ant_ini AND v_ant_fim),
    -- Vendas
    'vendas_mes',     (SELECT COALESCE(SUM(total),0) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'vendas_mes_ant', (SELECT COALESCE(SUM(total),0) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_ant_ini AND v_ant_fim),
    'qtd_vendas_mes', (SELECT COUNT(*)               FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    -- Ticket médio
    'ticket_medio',   (SELECT COALESCE(AVG(total),0) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    -- Taxa de conversão
    'taxa_conversao', (
      SELECT CASE WHEN leads_tot > 0 THEN ROUND((vendas_tot::NUMERIC / leads_tot * 100)::NUMERIC, 1) ELSE 0 END
      FROM (
        SELECT
          (SELECT COUNT(*) FROM public.leads WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim) AS leads_tot,
          (SELECT COUNT(*) FROM public.sales WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim) AS vendas_tot
      ) sub
    ),
    -- Orçamentos
    'orcamentos_mes',       (SELECT COUNT(*) FROM public.quotes WHERE company_id = v_cid AND created_at::DATE BETWEEN v_inicio AND v_fim),
    'orcamentos_pendentes', (SELECT COUNT(*) FROM public.quotes WHERE company_id = v_cid AND status NOT IN ('aprovado','recusado','cancelado','perdido')),
    -- Operação
    'em_producao',        (SELECT COUNT(*) FROM public.production_orders WHERE company_id = v_cid AND status NOT IN ('concluido','concluida','finalizado','cancelado')),
    'instalacoes_hoje',   (SELECT COUNT(*) FROM public.installations WHERE company_id = v_cid AND status IN ('agendada','em_andamento') AND (scheduled_at AT TIME ZONE 'America/Sao_Paulo')::DATE = (now() AT TIME ZONE 'America/Sao_Paulo')::DATE),
    'compras_pendentes',  (SELECT COUNT(*) FROM public.purchase_orders WHERE company_id = v_cid AND status NOT IN ('recebido_completo','conferido','liberado_para_producao','cancelado')),
    -- Financeiro
    'receitas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status NOT IN ('pago','cancelado')),
    'despesas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status NOT IN ('pago','cancelado')),
    'receitas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'receber' AND p.paid_at BETWEEN v_inicio AND v_fim),
    'despesas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'pagar'  AND p.paid_at BETWEEN v_inicio AND v_fim),
    'overdue_receivable', (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'overdue_payable',    (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'due_today',          (SELECT COUNT(*) FROM public.financial_entries WHERE company_id = v_cid AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date = CURRENT_DATE),
    -- Top vendedores do mês
    'top_vendedores', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (row_to_json(t)->>'total_vendido')::NUMERIC DESC), '[]'::JSON)
      FROM (
        SELECT
          COALESCE(p.full_name, 'Sem vendedor')     AS nome,
          COUNT(*)::INT                              AS qtd_vendas,
          COALESCE(SUM(s.total), 0)                 AS total_vendido
        FROM public.sales s
        LEFT JOIN public.profiles p ON p.id = s.seller_id
        WHERE s.company_id = v_cid
          AND s.created_at::DATE BETWEEN v_inicio AND v_fim
        GROUP BY COALESCE(p.full_name, 'Sem vendedor')
        ORDER BY total_vendido DESC
        LIMIT 5
      ) t
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

grant execute on function public.dashboard_executivo() to authenticated;

create or replace function public.auto_order_checklist() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  if new.production_status = 'em_producao' and old.production_status is distinct from new.production_status then
    select lower(coalesce(st.name, '')) into v_type from public.sale_types st where st.id = new.sale_type_id;
    if v_type like '%esquadria%' then
      perform public.create_order_checklist(new.id, 'esquadrias');
    elsif v_type like '%calha%' then
      perform public.create_order_checklist(new.id, 'calhas');
    else
      perform public.create_order_checklist(new.id, 'geral');
    end if;
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.create_order_checklist(p_order_id uuid, p_type text DEFAULT 'calhas'::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c UUID;
  v_checklist UUID;
  items TEXT[];
  item TEXT;
  i INT := 1;
BEGIN
  SELECT company_id INTO c FROM public.orders WHERE id = p_order_id;
  IF c IS NULL THEN RETURN; END IF;

  -- order_checklist_items.checklist_id e obrigatorio: usa o checklist do pedido (ou cria).
  SELECT id INTO v_checklist FROM public.order_checklists WHERE order_id = p_order_id ORDER BY created_at LIMIT 1;
  IF v_checklist IS NULL THEN
    INSERT INTO public.order_checklists(company_id, order_id) VALUES (c, p_order_id) RETURNING id INTO v_checklist;
  END IF;

  -- Deleta checklists genéricos anteriores e recria por tipo
  DELETE FROM public.order_checklist_items WHERE order_id = p_order_id AND category = 'operacional';

  IF p_type = 'esquadrias' THEN
    items := ARRAY[
      'Medidas finais conferidas',
      'Linha e modelo definidos',
      'Cor escolhida e aprovada',
      'Vidro especificado',
      'Ferragens definidas',
      'Acessórios listados',
      'Contramarcos medidos',
      'Arremates definidos',
      'Conferência técnica realizada',
      'Lista de perfis emitida',
      'Lista de acessórios emitida',
      'Lista de vidros emitida',
      'Compra de perfis realizada',
      'Compra de acessórios realizada',
      'Compra de vidros realizada',
      'Recebimento conferido',
      'Produção concluída',
      'Instalação agendada',
      'Entrega realizada',
      'Pós-venda concluído'
    ];
  ELSIF p_type = 'calhas' THEN
    items := ARRAY[
      'Medidas conferidas',
      'Espessura definida',
      'Cor definida',
      'Largura confirmada',
      'Acessórios conferidos',
      'Programação de dobra realizada',
      'Materiais separados',
      'Produção concluída',
      'Instalação realizada',
      'Conferência final feita',
      'Cobrança emitida',
      'Pós-venda concluído'
    ];
  ELSE
    items := ARRAY[
      'Contrato gerado',
      'Contrato assinado',
      'Entrada recebida',
      'Medidas conferidas',
      'Aprovação técnica',
      'Compras realizadas',
      'Compras conferidas',
      'Produção concluída',
      'Conferência de produção',
      'Instalação realizada',
      'Conferência final',
      'Cobrança final emitida',
      'Pós-venda concluído'
    ];
  END IF;

  FOREACH item IN ARRAY items LOOP
    INSERT INTO public.order_checklist_items(company_id, checklist_id, order_id, title, item_name, sort_order, status, category)
    VALUES (c, v_checklist, p_order_id, item, item, i, 'pendente', 'operacional')
    ON CONFLICT DO NOTHING;
    i := i + 1;
  END LOOP;
END $$;

commit;
