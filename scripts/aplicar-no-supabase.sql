-- CRM Bielenki: migrations 040 a 047 (cole tudo no SQL Editor do Supabase e clique Run).
-- Se o editor cortar o texto, use os arquivos separados em scripts/supabase/.

-- ===== supabase/migrations/040_quote_pdf_cache.sql =====
-- Migration 040 - Cache do PDF do orcamento
--
-- O download do PDF gerava o arquivo do zero a cada clique (headless
-- Chromium navegando a pagina real), levando varios segundos. Agora o PDF
-- e pre-gerado em segundo plano assim que o orcamento e salvo/atualizado, e
-- guardado no storage. O download so precisa buscar o arquivo pronto; so
-- gera na hora se o cache ainda nao existir ou estiver desatualizado.

begin;

alter table public.quotes
  add column if not exists pdf_generated_at timestamptz;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quote-pdfs','quote-pdfs',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760;

drop policy if exists "company reads own quote pdfs" on storage.objects;
create policy "company reads own quote pdfs" on storage.objects for select to authenticated
using(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists "company writes own quote pdfs" on storage.objects;
create policy "company writes own quote pdfs" on storage.objects for insert to authenticated
with check(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text);

drop policy if exists "company updates own quote pdfs" on storage.objects;
create policy "company updates own quote pdfs" on storage.objects for update to authenticated
using(bucket_id='quote-pdfs' and (storage.foldername(name))[1]=public.current_company_id()::text);

commit;

-- ===== supabase/migrations/041_quote_pdf_cache_freshness.sql =====
-- Migration 041 - Cache do PDF do orcamento nunca era aproveitado
--
-- O trigger quotes_touch (touch_updated_at) grava updated_at = now() em
-- qualquer update. Quando o sistema marcava pdf_generated_at depois de gerar
-- o PDF, o proprio trigger empurrava updated_at para depois de
-- pdf_generated_at, entao o cache sempre parecia desatualizado e todo
-- download gerava o PDF do zero (lento). Agora um update que so mexe em
-- pdf_generated_at nao altera updated_at.
--
-- Pode ser rodada mais de uma vez.

begin;

create or replace function public.touch_quotes_updated_at() returns trigger language plpgsql as $$
begin
  -- "total" e coluna gerada: num trigger BEFORE ela ainda vem nula em NEW,
  -- entao fica fora da comparacao (ela deriva de subtotal/discount/freight).
  if (to_jsonb(new) - 'pdf_generated_at' - 'updated_at' - 'total')
     = (to_jsonb(old) - 'pdf_generated_at' - 'updated_at' - 'total') then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists quotes_touch on public.quotes;
create trigger quotes_touch before update on public.quotes
for each row execute function public.touch_quotes_updated_at();

commit;

-- ===== supabase/migrations/042_fix_pending_center.sql =====
-- Migration 042 - Central de Pendencias voltava erro e ficava vazia
--
-- pending_center() (migration 030) referenciava colunas que nao existem
-- (purchase_orders.total_amount e purchase_orders.deleted_at), entao a
-- funcao inteira falhava com "column pu.total_amount does not exist".
-- Alem disso filtrava por status que o sistema nunca grava:
--   - orcamentos: 'pendente' (o sistema usa 'rascunho' ate aprovar/recusar)
--   - medicoes: 'agendada'/'pendente' (o check da tabela usa 'agendado',
--     'confirmado', 'em_deslocamento', 'em_medicao', 'reagendado')
--   - compras: considerava recebidas como pendentes ('concluido' nao existe)
--
-- Pode ser rodada mais de uma vez.

begin;

drop function if exists public.pending_center();

create function public.pending_center()
returns table (
  record_id   uuid,
  category    text,
  priority    text,
  title       text,
  subtitle    text,
  link        text,
  due_date    date,
  days_late   integer,
  amount      numeric,
  client_name text
) language plpgsql security definer stable set search_path = public as $$
declare v_cid uuid;
begin
  select p.company_id into v_cid from public.profiles p where p.id = auth.uid();
  if v_cid is null then return; end if;

  -- Orcamentos em aberto ha mais de 2 dias
  return query
  select q.id, 'orcamento'::text,
    case when q.created_at < now() - interval '7 days' then 'high'
         when q.created_at < now() - interval '3 days' then 'medium'
         else 'low' end,
    ('Orçamento ' || q.quote_number)::text,
    'Aguardando resposta do cliente'::text,
    ('/orcamentos/' || q.id)::text,
    q.valid_until,
    case when q.valid_until < current_date then (current_date - q.valid_until)::int else null end,
    q.total,
    c.name
  from public.quotes q join public.clients c on c.id = q.client_id
  where q.company_id = v_cid
    and q.status not in ('aprovado', 'recusado', 'cancelado', 'perdido')
    and q.created_at < now() - interval '2 days'
  order by q.created_at asc limit 20;

  -- Financeiro vencido
  return query
  select fe.id, ('financeiro_' || fe.entry_type)::text,
    case when (current_date - fe.due_date) > 15 then 'high'
         when (current_date - fe.due_date) > 7  then 'medium'
         else 'low' end,
    fe.description::text,
    ('Vencida há ' || (current_date - fe.due_date)::text || ' dias')::text,
    ('/financeiro/' || fe.entry_type)::text,
    fe.due_date,
    (current_date - fe.due_date)::int,
    fe.open_amount,
    coalesce(cl.name, sup.name)
  from public.financial_entries fe
  left join public.clients   cl  on cl.id  = fe.client_id
  left join public.suppliers sup on sup.id = fe.supplier_id
  where fe.company_id = v_cid
    and fe.status in ('aguardando_pagamento', 'parcialmente_pago', 'vencido')
    and fe.open_amount > 0
    and fe.due_date < current_date
  order by fe.due_date asc limit 20;

  -- Producoes atrasadas
  return query
  select po.id, 'producao'::text, 'high'::text,
    ('Produção ' || po.production_number)::text,
    case when po.planned_end is not null and po.planned_end < current_date
         then ('Atrasada ' || (current_date - po.planned_end)::text || ' dias')
         else 'Em produção há mais de 7 dias' end::text,
    ('/producao/' || po.id)::text,
    po.planned_end,
    case when po.planned_end is not null then (current_date - po.planned_end)::int else null end,
    null::numeric, c.name
  from public.production_orders po
  join public.orders  o on o.id = po.order_id
  join public.clients c on c.id = o.client_id
  where po.company_id = v_cid
    and po.status not in ('concluido', 'concluida', 'finalizado', 'cancelado')
    and ((po.planned_end is not null and po.planned_end < current_date)
         or po.started_at < now() - interval '7 days')
  order by po.planned_end asc nulls last limit 10;

  -- Compras aguardando recebimento
  return query
  select pu.id, 'compra'::text,
    case when pu.expected_at is not null and pu.expected_at < current_date then 'medium' else 'low' end,
    ('Compra ' || pu.order_number)::text,
    case when pu.expected_at is not null and pu.expected_at < current_date
         then ('Entrega atrasada ' || (current_date - pu.expected_at)::text || ' dias')
         else 'Aguardando recebimento' end::text,
    ('/compras/' || pu.id)::text,
    pu.expected_at,
    case when pu.expected_at is not null and pu.expected_at < current_date then (current_date - pu.expected_at)::int else null end,
    pu.total, sup.name
  from public.purchase_orders pu join public.suppliers sup on sup.id = pu.supplier_id
  where pu.company_id = v_cid
    and pu.status not in ('recebido_completo', 'conferido', 'liberado_para_producao', 'cancelado')
  order by pu.expected_at asc nulls last limit 10;

  -- Instalacoes nas proximas 48h
  return query
  select i.id, 'instalacao'::text, 'medium'::text,
    ('Instalação — ' || c.name)::text,
    ('Agendada para ' || to_char(i.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))::text,
    ('/instalacoes/' || i.id)::text,
    (i.scheduled_at at time zone 'America/Sao_Paulo')::date, null::int, null::numeric, c.name
  from public.installations i
  join public.orders  o on o.id = i.order_id
  join public.clients c on c.id = o.client_id
  where i.company_id = v_cid and i.status in ('agendada', 'em_andamento')
    and i.scheduled_at between now() - interval '2 hours' and now() + interval '48 hours'
  order by i.scheduled_at asc limit 10;

  -- Medicoes sem data, atrasadas ou nas proximas 48h
  return query
  select m.id, 'medicao'::text,
    case when m.scheduled_at is not null and m.scheduled_at < now() - interval '24 hours' then 'high'
         when m.scheduled_at is null then 'medium' else 'low' end,
    ('Medição ' || coalesce(m.measurement_number, '—'))::text,
    case when m.scheduled_at is null then 'Sem data agendada'
         else ('Agendada ' || to_char(m.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))
    end::text,
    ('/medicoes/' || m.id)::text,
    (m.scheduled_at at time zone 'America/Sao_Paulo')::date,
    case when m.scheduled_at is not null and m.scheduled_at < now()
         then extract(day from now() - m.scheduled_at)::int else null end,
    null::numeric, c.name
  from public.measurements m join public.clients c on c.id = m.client_id
  where m.company_id = v_cid
    and m.status in ('agendado', 'confirmado', 'em_deslocamento', 'em_medicao', 'reagendado')
    and (m.scheduled_at is null or m.scheduled_at < now() + interval '48 hours')
  order by m.scheduled_at asc nulls first limit 10;
end;
$$;

revoke all on function public.pending_center() from public, anon;
grant execute on function public.pending_center() to authenticated;

commit;

-- ===== supabase/migrations/043_seed_new_company_defaults.sql =====
-- Migration 043 - Empresa nova ja nasce com templates e tabela de calhas
--
-- As migrations 029 (seed_gutter_products) e 031 (seed_default_templates)
-- so populavam as empresas que ja existiam quando foram rodadas. Uma empresa
-- criada depois (bootstrap_company) ficava sem templates de documento
-- ("Nenhum modelo encontrado. Execute a migration 031") e sem tabela de
-- precos de calhas. Agora isso e feito automaticamente ao criar a empresa.
--
-- Pode ser rodada mais de uma vez.

begin;

-- A versao da 031 percorria o array 2D sem SLICE 1 e falhava com
-- "cannot assign non-composite value to a record variable".
CREATE OR REPLACE FUNCTION public.seed_default_templates(p_company_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tmpl TEXT[];
  defaults TEXT[][] := ARRAY[
    ARRAY['Orçamento de Calhas — Padrão',    'orcamento_calhas'],
    ARRAY['Orçamento de Esquadrias — Padrão','orcamento_esquadrias'],
    ARRAY['Ficha de Medição — Padrão',        'ficha_medicao'],
    ARRAY['Ficha de Medição em Branco',       'ficha_medicao_branco'],
    ARRAY['Pedido de Venda — Padrão',         'pedido'],
    ARRAY['Ordem de Produção — Padrão',       'ordem_producao'],
    ARRAY['Ordem de Instalação — Padrão',     'ordem_instalacao'],
    ARRAY['Contrato — Padrão',                'contrato']
  ];
BEGIN
  FOREACH tmpl SLICE 1 IN ARRAY defaults LOOP
    INSERT INTO public.document_templates(company_id, name, type, status, is_default, config)
    VALUES (
      p_company_id,
      tmpl[1], tmpl[2],
      'em_uso', TRUE,
      jsonb_build_object(
        'logo_width', 80, 'logo_align', 'left',
        'logo_margin_top', 0, 'logo_margin_bottom', 0,
        'show_logo', true, 'show_header', true, 'show_footer', true,
        'font_size', 10, 'primary_color', null
      )
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;


create or replace function public.seed_new_company_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.document_templates where company_id = new.id) then
    perform public.seed_default_templates(new.id);
  end if;
  if not exists (select 1 from public.gutter_prices where company_id = new.id) then
    perform public.seed_gutter_products(new.id);
  end if;
  return new;
end $$;

drop trigger if exists companies_seed_defaults on public.companies;
create trigger companies_seed_defaults after insert on public.companies
for each row execute function public.seed_new_company_defaults();

-- Empresas que ficaram sem templates (criadas depois da 031).
do $$
declare r record;
begin
  for r in select c.id from public.companies c
           where not exists (select 1 from public.document_templates t where t.company_id = c.id) loop
    perform public.seed_default_templates(r.id);
  end loop;
end $$;

commit;

-- ===== supabase/migrations/044_gutter_prices_unique_with_color.sql =====
-- Migration 044 - Mesma calha em cores diferentes na tabela de precos
--
-- A chave unica de gutter_prices era (empresa, produto, espessura, corte),
-- sem a cor. Mas o orcamento busca o preco por produto + espessura + corte
-- + cor, e a tela oferece 8 cores: cadastrar "Calha de Beiral 0.5mm 200mm"
-- em Pintura Branco depois da versao Aluminio Natural dava
-- "duplicate key value violates unique constraint". A cor agora faz parte
-- da chave (cor vazia conta como Aluminio Natural).
--
-- Pode ser rodada mais de uma vez.

begin;

alter table public.gutter_prices drop constraint if exists gutter_prices_company_id_product_thickness_cut_mm_key;

create unique index if not exists gutter_prices_unique_item_color on public.gutter_prices
  (company_id, product, coalesce(thickness, ''), coalesce(cut_mm, 0), coalesce(color, 'Aluminio Natural'));

-- seed_gutter_products (029) usava ON CONFLICT nas colunas da chave antiga.
CREATE OR REPLACE FUNCTION public.seed_gutter_products(p_company_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.gutter_prices(company_id, product, thickness, cut_mm, unit_price, active)
  VALUES
    -- Calhas
    (p_company_id,'Calha Platibanda','0.43',200,0,true),
    (p_company_id,'Calha Platibanda','0.50',200,0,true),
    (p_company_id,'Calha Platibanda','0.65',200,0,true),
    (p_company_id,'Calha de Beiral','0.43',150,0,true),
    (p_company_id,'Calha de Beiral','0.50',150,0,true),
    (p_company_id,'Calha de Beiral','0.65',150,0,true),
    (p_company_id,'Calha Condutora','0.43',125,0,true),
    (p_company_id,'Calha Coletora','0.50',200,0,true),
    (p_company_id,'Calha de Meio Fio','0.43',150,0,true),
    -- Rufos
    (p_company_id,'Rufo Simples','0.43',200,0,true),
    (p_company_id,'Rufo com Pingadeira','0.43',200,0,true),
    (p_company_id,'Rufo de Acabamento','0.43',150,0,true),
    (p_company_id,'Rufo Água Furtada','0.43',200,0,true),
    (p_company_id,'Rufo de Cumeeira','0.43',250,0,true),
    (p_company_id,'Rufo Sobre Calha','0.43',200,0,true),
    -- Pingadeiras
    (p_company_id,'Pingadeira','0.43',150,0,true),
    (p_company_id,'Pingadeira com Rufo','0.43',200,0,true),
    (p_company_id,'Pingadeira de Marquise','0.50',200,0,true),
    -- Chaminé
    (p_company_id,'Chaminé Quadrada','0.50',200,0,true),
    (p_company_id,'Chaminé Redonda','0.50',200,0,true),
    -- Condutores e acessórios
    (p_company_id,'Condutor Redondo','0.43',100,0,true),
    (p_company_id,'Condutor Quadrado','0.43',100,0,true),
    (p_company_id,'Caixa Coletora','0.50',200,0,true),
    (p_company_id,'Curva 90°','0.43',100,0,true),
    (p_company_id,'Joelho 45°','0.43',100,0,true),
    (p_company_id,'Saída de Água','0.43',100,0,true),
    (p_company_id,'Emenda','0.43',200,0,true),
    (p_company_id,'Tampa Lateral','0.43',200,0,true),
    (p_company_id,'Suporte Universal','0.43',100,0,true),
    (p_company_id,'Corrente para Condutor','0.43',1,0,true),
    (p_company_id,'Tela Anti Folhas','0.43',200,0,true),
    -- Serviços e outros
    (p_company_id,'PU MS40','0.43',1,0,true),
    (p_company_id,'Pintura','0.43',1,0,true),
    (p_company_id,'Mão de Obra','0.43',1,0,true),
    (p_company_id,'Frete','0.43',1,0,true),
    (p_company_id,'Deslocamento','0.43',1,0,true),
    (p_company_id,'Manutenção','0.43',1,0,true)
  ON CONFLICT DO NOTHING;
END;
$$;


commit;

-- ===== supabase/migrations/045_fix_dashboard_and_alerts.sql =====
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
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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

-- ===== supabase/migrations/046_review_operational_fixes.sql =====
-- Migration 046 - Revisao de correcoes operacionais (vindas de uma auditoria externa)
--
-- - pending_center(): respeita has_table_access por categoria (a funcao e
--   SECURITY DEFINER e ignorava as permissoes: vendedor via contas a pagar),
--   medicao sem cliente nao some, instalacao sem data aparece, joins presos a
--   mesma empresa, so perfis ativos.
-- - dashboard_executivo(), dashboard_summary(), reporting_summary(): passam a
--   respeitar as permissoes (SECURITY INVOKER) e ignoram pagamentos estornados.
-- - reschedule_entry(): nao validava empresa nem permissao (qualquer usuario
--   alterava o vencimento de qualquer lancamento pelo id).
-- - global_search(): busca com 1 caractere devolvia tudo de pedidos,
--   orcamentos, vendas, compras, fornecedores e materiais.
-- - v_operational_agenda: coluna "source" para a agenda saber qual tabela
--   atualizar ao mudar status.
-- - set_default_document_template(): troca do template padrao em uma transacao.
-- - create_order_checklist(): nao recria (e nao apaga o andamento de) um
--   checklist existente e deixa de ser chamavel por qualquer usuario.
-- - generate_operational_alerts(): limitada a empresa de quem chama.
--
-- Pode ser rodada mais de uma vez.
BEGIN;

CREATE OR REPLACE FUNCTION public.pending_center()
RETURNS TABLE (
  record_id   UUID,
  category    TEXT,
  priority    TEXT,
  title       TEXT,
  subtitle    TEXT,
  link        TEXT,
  due_date    DATE,
  days_late   INTEGER,
  amount      NUMERIC,
  client_name TEXT
) LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v_cid UUID;
BEGIN
  SELECT p.company_id INTO v_cid FROM public.profiles p WHERE p.id = auth.uid() AND p.status = 'ativo';
  IF v_cid IS NULL THEN RETURN; END IF;

  -- Orçamentos pendentes > 2 dias
  RETURN QUERY
  SELECT q.id AS record_id, 'orcamento'::TEXT,
    CASE WHEN q.created_at < NOW() - INTERVAL '7 days' THEN 'high'
         WHEN q.created_at < NOW() - INTERVAL '3 days' THEN 'medium'
         ELSE 'low' END,
    ('Orçamento ' || q.quote_number)::TEXT,
    CASE WHEN q.status='rascunho' THEN 'Preparar e enviar ao cliente' ELSE 'Aguardando resposta do cliente' END::TEXT,
    ('/orcamentos/' || q.id)::TEXT,
    q.valid_until,
    CASE WHEN q.valid_until < CURRENT_DATE THEN (CURRENT_DATE - q.valid_until)::INT ELSE NULL END,
    q.total,
    c.name
  FROM public.quotes q JOIN public.clients c ON c.id = q.client_id AND c.company_id = q.company_id
  WHERE q.company_id = v_cid AND public.has_table_access('quotes','select') AND q.status IN ('rascunho','enviado','pendente')
    AND (q.status='rascunho' OR q.created_at < NOW() - INTERVAL '2 days')
  ORDER BY q.created_at ASC;

  -- Financeiro vencido
  RETURN QUERY
  SELECT fe.id AS record_id, ('financeiro_' || fe.entry_type)::TEXT,
    CASE WHEN (CURRENT_DATE - fe.due_date) > 15 THEN 'high'
         WHEN (CURRENT_DATE - fe.due_date) > 7  THEN 'medium'
         ELSE 'low' END,
    fe.description::TEXT,
    ('Vencida há ' || (CURRENT_DATE - fe.due_date)::TEXT || ' dias')::TEXT,
    ('/financeiro/' || fe.entry_type)::TEXT,
    fe.due_date,
    (CURRENT_DATE - fe.due_date)::INT,
    fe.open_amount,
    COALESCE(cl.name, sup.name)
  FROM public.financial_entries fe
  LEFT JOIN public.clients   cl  ON cl.id  = fe.client_id AND cl.company_id = fe.company_id
  LEFT JOIN public.suppliers sup ON sup.id = fe.supplier_id AND sup.company_id = fe.company_id
  WHERE fe.company_id = v_cid AND public.has_table_access('financial_entries','select')
    AND fe.status IN ('aguardando_pagamento','parcialmente_pago','vencido')
    AND fe.open_amount > 0
    AND fe.due_date < CURRENT_DATE
  ORDER BY fe.due_date ASC;

  -- Produções atrasadas
  RETURN QUERY
  SELECT po.id AS record_id, 'producao'::TEXT, 'high'::TEXT,
    ('Produção ' || po.production_number)::TEXT,
    CASE WHEN po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE
         THEN ('Atrasada ' || (CURRENT_DATE - po.planned_end)::TEXT || ' dias')
         ELSE 'Em produção há mais de 7 dias' END::TEXT,
    ('/producao/' || po.id)::TEXT,
    po.planned_end,
    CASE WHEN po.planned_end IS NOT NULL THEN (CURRENT_DATE - po.planned_end)::INT ELSE NULL END,
    NULL::NUMERIC, c.name
  FROM public.production_orders po
  JOIN public.orders  o ON o.id = po.order_id AND o.company_id = po.company_id
  JOIN public.clients c ON c.id = o.client_id AND c.company_id = o.company_id
  WHERE po.company_id = v_cid AND public.has_table_access('production_orders','select') AND po.status NOT IN ('concluido','concluida','finalizado','cancelado')
    AND ((po.planned_end IS NOT NULL AND po.planned_end < CURRENT_DATE)
         OR po.started_at < NOW() - INTERVAL '7 days')
  ORDER BY po.planned_end ASC NULLS LAST;

  -- Compras aguardando
  RETURN QUERY
  SELECT pu.id AS record_id, 'compra'::TEXT,
    CASE WHEN pu.expected_at IS NOT NULL AND pu.expected_at < CURRENT_DATE THEN 'medium' ELSE 'low' END,
    ('Compra ' || pu.order_number)::TEXT,
    'Aguardando recebimento'::TEXT,
    ('/compras/' || pu.id)::TEXT,
    pu.expected_at,
    CASE WHEN pu.expected_at IS NOT NULL THEN (CURRENT_DATE - pu.expected_at)::INT ELSE NULL END,
    pu.total, sup.name
  FROM public.purchase_orders pu JOIN public.suppliers sup ON sup.id = pu.supplier_id AND sup.company_id = pu.company_id
  WHERE pu.company_id = v_cid AND public.has_table_access('purchase_orders','select') AND pu.status NOT IN ('concluido','cancelado','recebido_completo','conferido','liberado_para_producao')
  ORDER BY pu.expected_at ASC NULLS LAST;

  -- Instalações próximas 48h
  RETURN QUERY
  SELECT i.id AS record_id, 'instalacao'::TEXT, CASE WHEN i.scheduled_at < NOW() THEN 'high' ELSE 'medium' END::TEXT,
    ('Instalação — ' || c.name)::TEXT,
    COALESCE('Agendada para ' || TO_CHAR(i.scheduled_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'), 'Sem data agendada')::TEXT,
    ('/instalacoes/' || i.id)::TEXT,
    (i.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::DATE, NULL::INT, NULL::NUMERIC, c.name
  FROM public.installations i
  JOIN public.orders  o ON o.id = i.order_id AND o.company_id = i.company_id
  JOIN public.clients c ON c.id = o.client_id AND c.company_id = o.company_id
  WHERE i.company_id = v_cid AND public.has_table_access('installations','select') AND i.status IN ('nao_agendada','agendada','em_andamento')
    AND (i.scheduled_at IS NULL OR i.scheduled_at < NOW() + INTERVAL '48 hours')
  ORDER BY i.scheduled_at ASC;

  -- Medições pendentes
  RETURN QUERY
  SELECT m.id AS record_id, 'medicao'::TEXT,
    CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at < NOW() - INTERVAL '24 hours' THEN 'high'
         WHEN m.scheduled_at IS NULL THEN 'medium' ELSE 'low' END,
    ('Medição ' || COALESCE(m.measurement_number, '—'))::TEXT,
    CASE WHEN m.scheduled_at IS NULL THEN 'Sem data agendada'
         ELSE ('Agendada ' || TO_CHAR(m.scheduled_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'))
    END::TEXT,
    ('/medicoes/' || m.id)::TEXT,
    (m.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::DATE,
    CASE WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at < NOW()
         THEN EXTRACT(DAY FROM NOW() - m.scheduled_at)::INT ELSE NULL END,
    NULL::NUMERIC, c.name
  FROM public.measurements m LEFT JOIN public.clients c ON c.id = m.client_id AND c.company_id = m.company_id
  WHERE m.company_id = v_cid AND public.has_table_access('measurements','select') AND m.status IN ('agendado','confirmado','reagendado','em_deslocamento','em_medicao')
    AND (m.scheduled_at IS NULL OR m.scheduled_at < NOW() + INTERVAL '48 hours')
  ORDER BY m.scheduled_at ASC NULLS FIRST;

END;
$$;

REVOKE ALL ON FUNCTION public.pending_center() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pending_center() TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_executivo()
RETURNS JSON LANGUAGE plpgsql SECURITY INVOKER STABLE SET search_path = public AS $$
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
    'em_producao',        (SELECT COUNT(*) FROM public.production_orders WHERE company_id = v_cid AND status NOT IN ('concluido','finalizado','cancelado','recebido_completo','conferido','liberado_para_producao')),
    'instalacoes_hoje',   (SELECT COUNT(*) FROM public.installations WHERE company_id = v_cid AND status IN ('agendada','em_andamento') AND (scheduled_at AT TIME ZONE 'America/Sao_Paulo')::DATE = (now() AT TIME ZONE 'America/Sao_Paulo')::DATE),
    'compras_pendentes',  (SELECT COUNT(*) FROM public.purchase_orders WHERE company_id = v_cid AND status NOT IN ('concluido','finalizado','cancelado','recebido_completo','conferido','liberado_para_producao')),
    -- Financeiro
    'receitas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status NOT IN ('pago','cancelado')),
    'despesas_abertas',   (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status NOT IN ('pago','cancelado')),
    'receitas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'receber' AND p.reversed_at IS NULL AND p.paid_at BETWEEN v_inicio AND v_fim),
    'despesas_mes',       (SELECT COALESCE(SUM(amount),0) FROM public.payments p JOIN public.financial_entries fe ON fe.id = p.financial_entry_id WHERE fe.company_id = v_cid AND fe.entry_type = 'pagar'  AND p.reversed_at IS NULL AND p.paid_at BETWEEN v_inicio AND v_fim),
    'overdue_receivable', (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'receber' AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'overdue_payable',    (SELECT COALESCE(SUM(open_amount),0) FROM public.financial_entries WHERE company_id = v_cid AND entry_type = 'pagar'  AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date < CURRENT_DATE),
    'due_today',          (SELECT COUNT(*) FROM public.financial_entries WHERE company_id = v_cid AND status IN ('aguardando_pagamento','parcialmente_pago') AND due_date = CURRENT_DATE),
    -- Top vendedores do mês
    'top_vendedores', (
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY (row_to_json(t)->>'total_vendido')::NUMERIC DESC), '[]'::JSON)
      FROM (
        SELECT
          COALESCE(p.full_name, 'Sem vendedor')   AS nome,
          COUNT(*)::INT                              AS qtd_vendas,
          COALESCE(SUM(s.total), 0)                 AS total_vendido
        FROM public.sales s
        LEFT JOIN public.profiles p ON p.id=s.seller_id AND p.company_id=s.company_id
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


CREATE OR REPLACE VIEW public.v_operational_agenda WITH (security_invoker = true) AS
  SELECT
    e.id, e.company_id, e.event_type,
    e.title, e.starts_at, e.ends_at, e.status, e.notes,
    COALESCE(c.name, e.client_name)          AS client_name,
    COALESCE(p.full_name, e.responsible_name) AS responsible_name,
    'operational_events'::text AS source
  FROM public.operational_events e
  LEFT JOIN public.clients  c ON c.id = e.client_id  AND c.company_id = e.company_id
  LEFT JOIN public.profiles p ON p.id = e.responsible_id AND p.company_id = e.company_id

  UNION ALL

  SELECT
    m.id, m.company_id, 'medicao'::TEXT AS event_type,
    COALESCE('Medição - ' || c.name, 'Medição técnica') AS title,
    m.scheduled_at AS starts_at, NULL AS ends_at,
    m.status, m.notes,
    c.name AS client_name,
    p.full_name AS responsible_name,
    'measurements'::text AS source
  FROM public.measurements m
  LEFT JOIN public.clients  c ON c.id = m.client_id  AND c.company_id = m.company_id
  LEFT JOIN public.profiles p ON p.id = m.responsible_id AND p.company_id = m.company_id
  WHERE m.scheduled_at IS NOT NULL

  UNION ALL

  SELECT
    i.id, i.company_id, 'instalacao'::TEXT AS event_type,
    COALESCE('Instalação - Pedido ' || o.order_number, 'Instalação') AS title,
    i.scheduled_at AS starts_at, i.completed_at AS ends_at,
    i.status, i.notes,
    c.name AS client_name,
    p.full_name AS responsible_name,
    'installations'::text AS source
  FROM public.installations i
  LEFT JOIN public.orders   o ON o.id = i.order_id    AND o.company_id = i.company_id
  LEFT JOIN public.clients  c ON c.id = o.client_id   AND c.company_id = i.company_id
  LEFT JOIN public.profiles p ON p.id = i.responsible_id AND p.company_id = i.company_id
  WHERE i.scheduled_at IS NOT NULL

  UNION ALL

  SELECT
    t.id, t.company_id, 'tarefa'::TEXT AS event_type,
    t.title, t.due_at AS starts_at, NULL AS ends_at,
    t.status, t.description AS notes,
    NULL AS client_name,
    p.full_name AS responsible_name,
    'tasks'::text AS source
  FROM public.tasks t
  LEFT JOIN public.profiles p ON p.id = t.assigned_to AND p.company_id = t.company_id
  WHERE t.due_at IS NOT NULL;

GRANT SELECT ON public.v_operational_agenda TO authenticated;



CREATE OR REPLACE FUNCTION public.reschedule_entry(p_entry_id UUID, p_new_due_date DATE, p_reason TEXT DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company_id UUID := public.current_company_id();
BEGIN
  PERFORM public.require_table_access('financial_entries','update');
  IF p_new_due_date IS NULL THEN RAISE EXCEPTION 'Data de vencimento obrigatória'; END IF;
  PERFORM 1 FROM public.financial_entries fe WHERE fe.id=p_entry_id AND fe.company_id=v_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  UPDATE public.financial_entries SET due_date=p_new_due_date,updated_at=NOW() WHERE id=p_entry_id AND company_id=v_company_id;
  INSERT INTO public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
  VALUES(v_company_id,auth.uid(),'financial_entries',p_entry_id,'RESCHEDULE',jsonb_build_object('new_due_date',p_new_due_date,'reason',p_reason));
END; $$;
REVOKE ALL ON FUNCTION public.reschedule_entry(UUID,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_entry(UUID,DATE,TEXT) TO authenticated;
create or replace function public.global_search(p_query text)
returns table(entity_type text,entity_id uuid,title text,subtitle text,status text,href text,priority integer)
language sql stable security invoker set search_path=public as $$
  with term as (select '%'||trim(p_query)||'%' as value where length(trim(p_query))>=2), matches as (
    select 'cliente'::text,c.id,c.name,
      concat_ws(' · ',nullif(c.whatsapp,''),nullif(c.phone,''),nullif(c.city,''))::text,
      c.status::text,('/clientes/'||c.id)::text,1
    from clients c,term where length(trim(p_query))>=2
      and (c.name ilike term.value or c.phone ilike term.value or c.whatsapp ilike term.value or c.email ilike term.value or c.tax_id ilike term.value)
    union all
    select 'pedido',o.id,o.order_number,concat_ws(' · ',c.name,st.name),
      o.operational_status,('/pedidos/'||o.id),2
    from orders o join clients c on c.id=o.client_id join sale_types st on st.id=o.sale_type_id,term
    where o.order_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'orçamento',q.id,q.quote_number,concat_ws(' · ',c.name,st.name),
      q.status,('/orcamentos/'||q.id),3
    from quotes q join clients c on c.id=q.client_id join sale_types st on st.id=q.sale_type_id,term
    where q.quote_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'venda',s.id,s.sale_number,concat_ws(' · ',c.name,st.name),
      s.financial_status::text,('/vendas/'||s.id),4
    from sales s join clients c on c.id=s.client_id join sale_types st on st.id=s.sale_type_id,term
    where s.sale_number ilike term.value or c.name ilike term.value or c.phone ilike term.value
    union all
    select 'compra',po.id,po.order_number,sup.name,
      po.status,('/compras/'||po.id),5
    from purchase_orders po join suppliers sup on sup.id=po.supplier_id,term
    where po.order_number ilike term.value or sup.name ilike term.value
    union all
    select 'fornecedor',s.id,s.name,concat_ws(' · ',s.city,s.state),
      s.status::text,('/fornecedores/'||s.id),6
    from suppliers s,term where s.name ilike term.value or s.tax_id ilike term.value or s.phone ilike term.value
    union all
    select 'material',m.id,m.name,concat_ws(' · ',m.sku,m.unit),
      case when m.active then 'ativo' else 'inativo' end,('/estoque?material='||m.id),7
    from materials m,term where m.name ilike term.value or m.sku ilike term.value
  ) select * from matches order by 7,3 limit 60
$$;
grant execute on function public.global_search(text) to authenticated;

create or replace function public.reporting_summary(p_start date, p_end date) returns jsonb
language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
  'sales_total',coalesce((select sum(total) from sales where created_at::date between p_start and p_end),0),
  'sales_count',(select count(*) from sales where created_at::date between p_start and p_end),
  'average_ticket',coalesce((select avg(total) from sales where created_at::date between p_start and p_end),0),
  'received',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='receber' and p.reversed_at is null and p.paid_at between p_start and p_end),0),
  'paid',coalesce((select sum(p.amount) from payments p join financial_entries f on f.id=p.financial_entry_id where f.entry_type='pagar' and p.reversed_at is null and p.paid_at between p_start and p_end),0),
  'receivable',coalesce((select sum(open_amount) from financial_entries where entry_type='receber' and status not in ('pago','cancelado')),0),
  'payable',coalesce((select sum(open_amount) from financial_entries where entry_type='pagar' and status not in ('pago','cancelado')),0),
  'overdue_receivable',coalesce((select sum(open_amount) from financial_entries where entry_type='receber' and open_amount>0 and due_date<current_date and status<>'cancelado'),0),
  'late_purchases',(select count(*) from purchase_orders where expected_at<current_date and status not in ('recebido_completo','conferido','liberado_para_producao','cancelado')),
  'blocked_orders',(select count(*) from orders where blocked_reason is not null and operational_status<>'finalizado'),
  'waiting_materials',(select count(*) from production_orders where status='aguardando_material'),
  'quotes_open',(select count(*) from quotes where status not in ('aprovado','recusado','cancelado') and created_at::date between p_start and p_end),
  'sales_by_type',coalesce((select jsonb_agg(x order by x.total desc) from (select st.name,sum(s.total) total,count(*) quantity from sales s join sale_types st on st.id=s.sale_type_id where s.created_at::date between p_start and p_end group by st.name) x),'[]'::jsonb),
  'quotes_by_status',coalesce((select jsonb_agg(x order by x.quantity desc) from (select status,count(*) quantity,coalesce(sum(total),0) total from quotes where created_at::date between p_start and p_end group by status) x),'[]'::jsonb),
  'pipeline_by_stage',coalesce((select jsonb_agg(x order by x.sort_order) from (select ps.name,ps.color,ps.sort_order,count(l.id) quantity,coalesce(sum(l.estimated_value),0) total from pipeline_stages ps left join leads l on l.stage_id=ps.id and l.status='aberto' group by ps.id,ps.name,ps.color,ps.sort_order) x),'[]'::jsonb),
  'monthly_sales',coalesce((select jsonb_agg(x order by x.mes) from (select date_trunc('month',created_at)::date mes,sum(total) total,count(*) quantity from sales where created_at>=date_trunc('month',p_end::timestamp)-interval '5 months' and created_at<date_trunc('month',p_end::timestamp)+interval '1 month' group by 1) x),'[]'::jsonb)
)
$$;
grant execute on function public.reporting_summary(date,date) to authenticated;


-- Keep dashboard summaries subject to the same table permissions as lists.
ALTER FUNCTION public.dashboard_summary() SECURITY INVOKER;


-- create_order_checklist (045): nao recria o checklist se o pedido ja tem
-- itens operacionais (antes apagava e recriava, perdendo o andamento) e nao
-- fica exposta para chamada direta (aceitava o id de pedido de outra empresa).
CREATE OR REPLACE FUNCTION public.create_order_checklist(p_order_id uuid, p_type text DEFAULT 'calhas'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  -- Ja existe checklist operacional: preserva o andamento (antes apagava e recriava).
  IF EXISTS (SELECT 1 FROM public.order_checklist_items WHERE order_id = p_order_id AND category = 'operacional') THEN RETURN; END IF;

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
REVOKE ALL ON FUNCTION public.create_order_checklist(UUID, TEXT) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.set_default_document_template(p_template_id UUID,p_type TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c UUID:=public.current_company_id();
BEGIN
  IF NOT public.has_role(ARRAY['administrador','gerente']::public.app_role[]) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':template:'||p_type,0));
  PERFORM 1 FROM public.document_templates WHERE id=p_template_id AND company_id=c AND type=p_type FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template não encontrado'; END IF;
  UPDATE public.document_templates SET is_default=false,status='rascunho' WHERE company_id=c AND type=p_type AND is_default;
  UPDATE public.document_templates SET is_default=true,status='em_uso' WHERE id=p_template_id AND company_id=c;
END; $$;
REVOKE ALL ON FUNCTION public.set_default_document_template(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_document_template(UUID,TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.generate_operational_alerts()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total INT := 0;
  r RECORD;
BEGIN
  -- Sem usuario (cron/servico) processa todas as empresas; usuario so a dele.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(ARRAY['administrador','gerente']::public.app_role[]) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  -- a) Leads sem resposta há mais de 24h
  FOR r IN
    SELECT l.id, l.company_id, l.name,
      EXTRACT(EPOCH FROM (now() - COALESCE(l.updated_at, l.created_at)))/3600 AS hrs
    FROM public.leads l
    WHERE (auth.uid() IS NULL OR l.company_id=public.current_company_id()) AND l.status = 'aberto' AND l.deleted_at IS NULL
      AND COALESCE(l.updated_at, l.created_at) < now() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.operational_alerts oa
        WHERE oa.entity_id = l.id AND oa.type = 'lead_sem_resposta' AND oa.resolved = false
          AND oa.created_at > now() - INTERVAL '1 day'
      )
  LOOP
    INSERT INTO public.operational_alerts(company_id, type, severity, title, description, entity_type, entity_id)
    VALUES (r.company_id, 'lead_sem_resposta',
      CASE WHEN r.hrs > 168 THEN 'high' WHEN r.hrs > 72 THEN 'medium' ELSE 'low' END,
      'Lead sem interação: ' || r.name,
      ROUND(r.hrs)::text || 'h sem atividade',
      'lead', r.id);
    total := total + 1;
  END LOOP;

  -- b) Parcelas vencidas
  FOR r IN
    SELECT fe.id, fe.company_id, fe.description
    FROM public.financial_entries fe
    WHERE (auth.uid() IS NULL OR fe.company_id=public.current_company_id()) AND fe.open_amount>0 AND fe.status NOT IN ('pago','cancelado')
      AND fe.due_date < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1 FROM public.operational_alerts oa
        WHERE oa.entity_id = fe.id AND oa.type = 'parcela_vencida' AND oa.resolved = false
          AND oa.created_at > now() - INTERVAL '1 day'
      )
  LOOP
    INSERT INTO public.operational_alerts(company_id, type, severity, title, description, entity_type, entity_id)
    VALUES (r.company_id, 'parcela_vencida', 'high',
      'Parcela vencida: ' || r.description, 'Vencimento ultrapassado', 'financial_entry', r.id);
    total := total + 1;
  END LOOP;

  -- c) Pedidos parados (sem atualização há 7+ dias em produção)
  FOR r IN
    SELECT o.id, o.company_id, o.order_number
    FROM public.orders o
    WHERE (auth.uid() IS NULL OR o.company_id=public.current_company_id()) AND o.production_status = 'em_producao'
      AND o.updated_at < now() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.operational_alerts oa
        WHERE oa.entity_id = o.id AND oa.type = 'producao_atrasada' AND oa.resolved = false
          AND oa.created_at > now() - INTERVAL '1 day'
      )
  LOOP
    INSERT INTO public.operational_alerts(company_id, type, severity, title, description, entity_type, entity_id)
    VALUES (r.company_id, 'producao_atrasada', 'medium',
      'Produção parada: ' || r.order_number, 'Sem atualização há 7+ dias', 'order', r.id);
    total := total + 1;
  END LOOP;

  RETURN total;
END $$;

REVOKE ALL ON FUNCTION public.generate_operational_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_operational_alerts() TO authenticated;


COMMIT;

-- ===== supabase/migrations/047_production_material_and_installation_guards.sql =====
-- Migration 047 - Regras de producao e instalacao
--
-- 1. advance_production_step(): nao deixa avancar a producao enquanto houver
--    material obrigatorio da ordem ainda nao recebido (ou se ela foi cancelada).
--    Ordens sem material vinculado seguem normalmente.
-- 2. Instalacao: nao pode ser marcada como concluida com itens obrigatorios do
--    checklist pendentes.
--
-- Pode ser rodada mais de uma vez.

begin;

CREATE OR REPLACE FUNCTION public.advance_production_step(p_production_order_id uuid, p_responsible_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare po public.production_orders; total_steps integer; step_name text; next_step integer;
begin
  perform public.require_table_access('production_orders','update');
  select * into po from public.production_orders
    where id=p_production_order_id and company_id=public.current_company_id() for update;
  if po.id is null then raise exception 'Ordem de producao nao encontrada'; end if;
  -- Nao avanca enquanto falta material obrigatorio (ou a ordem foi cancelada).
  -- So o status 'aguardando_material' nao basta: toda ordem nasce assim, e as
  -- que nao tem material vinculado nunca seriam liberadas.
  if po.status = 'cancelado' then raise exception 'Produção cancelada'; end if;
  if exists (select 1 from public.production_materials pm
             where pm.production_order_id = po.id and pm.required
               and coalesce(pm.received_quantity, 0) < pm.required_quantity) then
    raise exception 'Produção bloqueada: material obrigatório ainda não recebido';
  end if;
  total_steps:=case when po.flow_type='esquadrias' then 9 else 7 end;
  if po.current_step<1 or po.current_step>total_steps then raise exception 'Fluxo de producao ja finalizado'; end if;
  if p_responsible_id is not null and not exists(
    select 1 from public.profiles where id=p_responsible_id and company_id=po.company_id and status='ativo'
  ) then raise exception 'Responsavel invalido'; end if;
  step_name:=(case when po.flow_type='esquadrias' then
    array['Medicao','Projeto','Corte','Usinagem','Montagem','Solda','Acabamento','Pintura','Controle de Qualidade']
  else array['Medicao','Corte','Dobra','Pintura','Agendamento','Instalacao','Pos-venda'] end)[po.current_step];
  insert into public.production_step_logs(
    company_id,production_order_id,step_number,step_name,started_at,completed_at,responsible_id,notes
  ) values(po.company_id,po.id,po.current_step,step_name,now(),now(),p_responsible_id,p_notes)
  on conflict(production_order_id,step_number) do update set
    step_name=excluded.step_name,completed_at=excluded.completed_at,
    responsible_id=excluded.responsible_id,notes=excluded.notes;
  next_step:=po.current_step+1;
  update public.production_orders set current_step=next_step,
    status=case when next_step>total_steps then 'finalizado' else 'em_producao' end
  where id=po.id;
  return next_step;
end $$;

revoke all on function public.advance_production_step(uuid,uuid,text) from public;
grant execute on function public.advance_production_step(uuid,uuid,text) to authenticated;

create or replace function public.guard_installation_completion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'concluida' and old.status is distinct from new.status and exists (
    select 1 from public.installation_checklists
    where installation_id = new.id and required and not completed
  ) then
    raise exception 'Conclua todos os itens obrigatórios do checklist antes de finalizar a instalação';
  end if;
  return new;
end $$;

drop trigger if exists installation_completion_guard on public.installations;
create trigger installation_completion_guard before update of status on public.installations
for each row execute function public.guard_installation_completion();

commit;
