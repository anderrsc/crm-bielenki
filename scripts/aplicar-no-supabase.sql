-- CRM Bielenki: migrations 040 a 048 (cole tudo no SQL Editor do Supabase e clique Run).
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
-- Se a rodada anterior desta migration falhou com "could not create unique
-- index", basta rodar esta versao: nada foi alterado naquela tentativa.
--
-- Pode ser rodada mais de uma vez.

begin;

alter table public.gutter_prices drop constraint if exists gutter_prices_company_id_product_thickness_cut_mm_key;

-- Espessura/corte vazios continuam contando como diferentes (igual a chave
-- antiga): o banco ja tem itens repetidos sem espessura/corte (ex.: condutores)
-- e trata-los como iguais faria a criacao do indice falhar.
-- Se ainda houver itens repetidos, a migration nao trava: avisa quais sao
-- (corrija na Central de Precos e rode esta migration de novo).
do $$
declare dup text;
begin
  select string_agg(format('%s / %s / %s / %s (%s vezes)', product, coalesce(thickness,'-'), coalesce(cut_mm::text,'-'), coalesce(color,'Aluminio Natural'), n), '; ')
    into dup
  from (
    select product, thickness, cut_mm, color, count(*) n
    from public.gutter_prices
    where thickness is not null and cut_mm is not null
    group by company_id, product, thickness, cut_mm, coalesce(color, 'Aluminio Natural'), color
    having count(*) > 1
  ) d;
  if dup is null then
    drop index if exists public.gutter_prices_unique_item_color;
    create unique index gutter_prices_unique_item_color on public.gutter_prices
      (company_id, product, thickness, cut_mm, coalesce(color, 'Aluminio Natural'));
  else
    raise warning 'Indice unico de precos nao criado: itens repetidos na tabela de calhas: %', dup;
  end if;
end $$;

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
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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

-- ===== supabase/migrations/048_sync_functions_and_triggers.sql =====
-- Migration 048 — Sincroniza funcoes e triggers com o estado final das migrations.
-- No banco de producao faltavam objetos das migrations 009 (vendas/compras
-- manuais), 033 (matriz de aluminio) e 035 (itens especiais de calhas).
-- Esta migration recria a matriz de aluminio e regrava todas as funcoes e
-- triggers do schema public. Pode ser rodada mais de uma vez.
-- Gerada por tests/db/generate-sync-migration.mjs.

begin;
set local check_function_bodies = off;

-- ─── 033: matriz de precos de aluminio ───────────────────────────────────────
do $$
begin
  if to_regclass('public.aluminum_price_matrix') is null then
    create table public.aluminum_price_matrix (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete cascade,
      thickness text not null,
      cut_mm integer not null,
      price_per_meter numeric not null default 0,
      updated_at timestamptz default now(),
      unique (company_id, thickness, cut_mm)
    );
    insert into public.aluminum_price_matrix(company_id, thickness, cut_mm, price_per_meter)
    select c.id, esp, corte, 0
    from public.companies c
    cross join (values ('0.5mm'),('0.6mm'),('0.7mm'),('1.0mm')) as t(esp)
    cross join (values (100),(150),(200),(250),(300),(333),(350),(400),(450),(500),(600),(700),(800),(1000)) as r(corte);
  end if;
end $$;

alter table public.aluminum_price_matrix enable row level security;
drop policy if exists "tenant_aluminum_matrix" on public.aluminum_price_matrix;
create policy "tenant_aluminum_matrix" on public.aluminum_price_matrix
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant all on public.aluminum_price_matrix to authenticated;
create index if not exists idx_aluminum_matrix_company on public.aluminum_price_matrix(company_id, thickness, cut_mm);

-- ─── funcoes ─────────────────────────────────────────────────────────────────
-- advance_production_step(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.advance_production_step(p_production_order_id uuid, p_responsible_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- approve_quote(uuid,date)
CREATE OR REPLACE FUNCTION public.approve_quote(p_quote_id uuid, p_due_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      begin
        perform public.require_table_access('quotes','update');
        perform public.require_table_access('sales','insert');
        return public.approve_quote_unchecked(p_quote_id,p_due_date);
      end $function$;

-- approve_quote_unchecked(uuid,date)
CREATE OR REPLACE FUNCTION public.approve_quote_unchecked(p_quote_id uuid, p_due_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.quotes; s uuid; o uuid; ck uuid; tpl uuid; pr uuid; po uuid;
begin
  select * into q from public.quotes where id=p_quote_id and company_id=public.current_company_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status='aprovado' then return q.sale_id; end if;
  insert into public.sales(company_id,sale_number,client_id,sale_type_id,seller_id,total,operational_status,next_action,next_action_date,notes)
    values(q.company_id,public.next_number('VEN','public.sales',q.company_id),q.client_id,q.sale_type_id,q.seller_id,q.total,'pedido_aberto','Confirmar entrada',current_date+2,q.notes) returning id into s;
  insert into public.sale_items(company_id,sale_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production) select company_id,s,product,description,unit,quantity,unit_price,requires_purchase,requires_production from public.quote_items where quote_id=q.id;
  insert into public.orders(company_id,order_number,sale_id,client_id,sale_type_id,next_action,next_action_date) values(q.company_id,public.next_number('PED','public.orders',q.company_id),s,q.client_id,q.sale_type_id,'Executar checklist inicial',current_date+1) returning id into o;
  insert into public.order_items(company_id,order_id,sale_item_id,product,description,unit,quantity) select company_id,o,id,product,description,unit,quantity from public.sale_items where sale_id=s;
  insert into public.financial_entries(company_id,entry_type,origin,client_id,sale_id,description,total_amount,due_date) values(q.company_id,'receber','venda',q.client_id,s,'Venda '||(select sale_number from public.sales where id=s),q.total,coalesce(p_due_date,current_date+7));
  select ct.id into tpl from public.checklist_templates ct where ct.sale_type_id=q.sale_type_id and ct.active order by ct.is_default desc limit 1;
  insert into public.order_checklists(company_id,order_id,template_id) values(q.company_id,o,tpl) returning id into ck;
  insert into public.order_checklist_items(company_id,checklist_id,order_id,title,due_date,required,sort_order) select q.company_id,ck,o,title,current_date+coalesce(due_days,sort_order),required,sort_order from public.checklist_template_items where template_id=tpl order by sort_order;
  if exists(select 1 from public.quote_items where quote_id=q.id and requires_purchase) then
    insert into public.purchase_requests(company_id,request_number,order_id,requested_by,status,needed_by,notes) values(q.company_id,public.next_number('SOL','public.purchase_requests',q.company_id),o,auth.uid(),'solicitacao_criada',current_date+7,'Gerada pelo orçamento '||q.quote_number) returning id into pr;
    insert into public.purchase_request_items(company_id,request_id,description,unit,requested_quantity) select q.company_id,pr,product,unit,quantity from public.quote_items where quote_id=q.id and requires_purchase;
  end if;
  if exists(select 1 from public.quote_items where quote_id=q.id and requires_production) then insert into public.production_orders(company_id,production_number,order_id,status) values(q.company_id,public.next_number('OP','public.production_orders',q.company_id),o,'aguardando_material') returning id into po; end if;
  update public.quotes set status='aprovado',approved_at=now(),sale_id=s where id=q.id;
  return s;
end $function$;

-- auto_create_installation_checklist()
CREATE OR REPLACE FUNCTION public.auto_create_installation_checklist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  install_id uuid;
  deadline_date date := current_date + interval '15 days';
begin
  -- So aciona quando operational_status muda para 'finalizado' ou 'aguardando_instalacao'
  if (NEW.operational_status = OLD.operational_status) then
    return NEW;
  end if;
  if NEW.operational_status not in ('finalizado', 'aguardando_instalacao') then
    return NEW;
  end if;

  -- Busca a instalação do pedido
  select id into install_id
    from installations
   where order_id = NEW.id
   limit 1;

  if install_id is null then return NEW; end if;

  -- Verifica se já tem checklist
  if exists (select 1 from installation_checklists where installation_id = install_id limit 1) then
    -- Apenas atualiza deadlines se ainda nao tiver
    update installation_checklists
       set deadline = coalesce(deadline, deadline_date)
     where installation_id = install_id
       and deadline is null;
    return NEW;
  end if;

  -- Cria checklist padrão de instalação com 15 dias
  insert into installation_checklists (company_id, installation_id, title, completed, sort_order, deadline)
  values
    (NEW.company_id, install_id, 'Confirmar medidas no local',        false, 1, deadline_date),
    (NEW.company_id, install_id, 'Verificar estrutura de fixação',    false, 2, deadline_date),
    (NEW.company_id, install_id, 'Instalar calhas/esquadrias',        false, 3, deadline_date),
    (NEW.company_id, install_id, 'Testar funcionalidade e vedação',   false, 4, deadline_date),
    (NEW.company_id, install_id, 'Limpeza e acabamento final',        false, 5, deadline_date),
    (NEW.company_id, install_id, 'Aprovação e assinatura do cliente', false, 6, deadline_date),
    (NEW.company_id, install_id, 'Registrar fotos do serviço',        false, 7, deadline_date);

  return NEW;
end $function$;

-- auto_order_checklist()
CREATE OR REPLACE FUNCTION public.auto_order_checklist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- bootstrap_company(text,text,uuid)
CREATE OR REPLACE FUNCTION public.bootstrap_company(p_name text, p_tax_id text DEFAULT NULL::text, p_user_id uuid DEFAULT auth.uid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid; u uuid:=coalesce(p_user_id,auth.uid()); st uuid; tpl uuid; sale_name text; template_item text; n int;
begin
  if u is null then raise exception 'Autenticação obrigatória'; end if;
  if exists(select 1 from public.profiles where id=u) then raise exception 'Usuário já pertence a uma empresa'; end if;
  insert into public.companies(name,tax_id) values(p_name,p_tax_id) returning id into c;
  insert into public.profiles(id,company_id,full_name) select u,c,coalesce(raw_user_meta_data->>'full_name',split_part(email,'@',1)) from auth.users where id=u;
  insert into public.user_roles(company_id,profile_id,role) values(c,u,'administrador');
  insert into public.client_types(company_id,name) select c,x from unnest(array['Cliente final','Construtora','Arquiteto','Engenheiro','Lojista','Revenda','Cliente online','Cliente balcão','Cliente recorrente','Cliente avulso']) x;
  insert into public.supplier_categories(company_id,name) select c,x from unnest(array['Perfis de alumínio','Acessórios','Vidros','Chapas e bobinas','Ferragens','Pintura','Embalagens','Outros']) x;
  insert into public.material_categories(company_id,name) select c,x from unnest(array['Perfis de alumínio','Acessórios','Vidros','Borrachas','Fechaduras','Rodízios','Trilhos','Parafusos','Silicone','PU','Chapas de calha','Bobinas','Pintura','Embalagens','Motores','Ferragens','Outros']) x;
  insert into public.stock_locations(company_id,name) values(c,'Estoque principal');
  insert into public.pipeline_stages(company_id,name,color,sort_order,is_won,is_lost) values(c,'Novo lead','#94a3b8',1,false,false),(c,'Contato realizado','#60a5fa',2,false,false),(c,'Orçamento enviado','#f59e0b',3,false,false),(c,'Negociação','#8b5cf6',4,false,false),(c,'Ganho','#22c55e',5,true,false),(c,'Perdido','#ef4444',6,false,true);
  insert into public.sale_types(company_id,name,requires_purchase,requires_production,requires_installation) values
    (c,'Esquadrias sob medida',true,true,true),(c,'Calhas instaladas',true,true,true),(c,'Venda avulsa de acessórios',false,false,false),(c,'Venda avulsa de janelas online',false,false,false),(c,'Venda de calhas dobradas na hora',true,true,false),(c,'Manutenção',false,false,true),(c,'Serviço avulso',false,false,false),(c,'Estruturas metálicas',true,true,true),(c,'Fachadas',true,true,true),(c,'Portões',true,true,true);
  for st,sale_name in select id,name from public.sale_types where company_id=c loop
    insert into public.checklist_templates(company_id,sale_type_id,name,is_default) values(c,st,'Checklist - '||sale_name,true) returning id into tpl;
    n:=0;
    for template_item in select x from unnest(case
      when sale_name='Calhas instaladas' then array['Orçamento aprovado','Entrada recebida','Medidas conferidas','Chapa separada','Calhas dobradas','Instalação agendada','Instalação realizada','Cobrança final','Pós-venda realizado','Pedido finalizado']
      when sale_name='Venda avulsa de acessórios' then array['Pedido confirmado','Pagamento confirmado','Produto separado','Entrega/retirada','Finalizado']
      when sale_name='Venda avulsa de janelas online' then array['Pedido recebido','Pagamento confirmado','Produto conferido','Embalagem','Envio/retirada','Código de rastreio','Finalizado']
      when sale_name='Venda de calhas dobradas na hora' then array['Produto escolhido','Espessura definida','Corte definido','Metragem definida','Dobra realizada','Pagamento recebido','Produto entregue']
      else array['Contrato feito','Contrato assinado','Entrada recebida','Medidas conferidas','Projeto/desenho conferido','Acessórios conferidos','Compra solicitada','Compra aprovada','Compra realizada','Compra conferida','Material recebido','Material separado','Liberado para produção','Produção iniciada','Produção conferida','Instalação agendada','Instalação realizada','Instalação conferida','Cliente cobrado','Pagamento final recebido','Pós-venda realizado','Pedido finalizado'] end) x loop
      n:=n+1; insert into public.checklist_template_items(company_id,template_id,title,required,sort_order,due_days) values(c,tpl,template_item,true,n,n);
    end loop;
  end loop;
  return c;
end $function$;

-- bulk_save_prices(jsonb)
CREATE OR REPLACE FUNCTION public.bulk_save_prices(p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  row_data jsonb;
  v_cid uuid;
  v_cut integer;
  v_category text;
begin
  select company_id into v_cid from public.profiles where id = auth.uid();
  if v_cid is null then raise exception 'Empresa não encontrada'; end if;

  for row_data in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    v_cut := nullif(row_data->>'cut_mm','')::integer;
    v_category := coalesce(nullif(row_data->>'category',''), public.gutter_catalog_category(row_data->>'product'));

    if (row_data->>'id') is not null and (row_data->>'id') <> '' then
      update public.gutter_prices set
        product          = coalesce(nullif(row_data->>'product',''), product),
        category         = v_category,
        item_type        = coalesce(nullif(row_data->>'item_type',''), public.gutter_catalog_item_type(v_category)),
        thickness        = nullif(row_data->>'thickness',''),
        cut_mm           = v_cut,
        unit             = coalesce(nullif(row_data->>'unit',''), unit),
        color            = nullif(row_data->>'color',''),
        unit_price       = coalesce(nullif(row_data->>'unit_price','')::numeric, unit_price),
        labor_price      = coalesce(nullif(row_data->>'labor_price','')::numeric, labor_price),
        paint_price      = coalesce(nullif(row_data->>'paint_price','')::numeric, paint_price),
        install_price    = coalesce(nullif(row_data->>'install_price','')::numeric, install_price),
        freight_price    = coalesce(nullif(row_data->>'freight_price','')::numeric, freight_price),
        min_price        = coalesce(nullif(row_data->>'min_price','')::numeric, min_price),
        margin_pct       = coalesce(nullif(row_data->>'margin_pct','')::numeric, margin_pct),
        max_discount_pct = coalesce(nullif(row_data->>'max_discount_pct','')::numeric, max_discount_pct),
        notes            = nullif(row_data->>'notes',''),
        active           = coalesce(nullif(row_data->>'active','')::boolean, active),
        updated_at       = now()
      where id = (row_data->>'id')::uuid and company_id = v_cid;
    else
      insert into public.gutter_prices(
        company_id, product, category, item_type, thickness, cut_mm, unit, color,
        unit_price, labor_price, paint_price, install_price, freight_price,
        min_price, margin_pct, max_discount_pct, notes, active
      ) values (
        v_cid,
        row_data->>'product',
        v_category,
        coalesce(nullif(row_data->>'item_type',''), public.gutter_catalog_item_type(v_category)),
        nullif(row_data->>'thickness',''),
        v_cut,
        coalesce(nullif(row_data->>'unit',''),'Metro Linear (m)'),
        nullif(row_data->>'color',''),
        coalesce(nullif(row_data->>'unit_price','')::numeric,0),
        coalesce(nullif(row_data->>'labor_price','')::numeric,0),
        coalesce(nullif(row_data->>'paint_price','')::numeric,0),
        coalesce(nullif(row_data->>'install_price','')::numeric,0),
        coalesce(nullif(row_data->>'freight_price','')::numeric,0),
        coalesce(nullif(row_data->>'min_price','')::numeric,0),
        coalesce(nullif(row_data->>'margin_pct','')::numeric,0),
        coalesce(nullif(row_data->>'max_discount_pct','')::numeric,0),
        nullif(row_data->>'notes',''),
        coalesce(nullif(row_data->>'active','')::boolean,true)
      );
    end if;
  end loop;
end;
$function$;

-- calcular_score_triagem(uuid)
CREATE OR REPLACE FUNCTION public.calcular_score_triagem(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sess public.triage_sessions; v_score int:=0; v_class text; v_prioridade text;
begin
  select * into sess from public.triage_sessions where id=p_session_id;
  if sess.id is null then return null; end if;
  if sess.nome         is not null then v_score:=v_score+10; end if;
  if sess.cidade       is not null then v_score:=v_score+5;  end if;
  if sess.tipo_servico is not null then v_score:=v_score+10; end if;
  if sess.produto      is not null then v_score:=v_score+10; end if;
  if coalesce(sess.possui_medidas,false)  then v_score:=v_score+15; end if;
  if sess.tipo_obra    is not null then v_score:=v_score+5;  end if;
  if sess.linha        is not null then v_score:=v_score+5;  end if;
  if sess.cor          is not null then v_score:=v_score+5;  end if;
  if sess.prazo        is not null then v_score:=v_score+5;  end if;
  if coalesce(sess.possui_projeto,false)  then v_score:=v_score+10; end if;
  if coalesce(sess.possui_fotos,false)    then v_score:=v_score+5;  end if;
  if sess.rua          is not null then v_score:=v_score+5;  end if;
  if v_score>=80 then v_prioridade:='maxima'; v_class:='Cliente quente – conversão imediata';
  elsif v_score>=60 then v_prioridade:='alta'; v_class:='Boa oportunidade – agilizar proposta';
  elsif v_score>=40 then v_prioridade:='media'; v_class:='Oportunidade em desenvolvimento';
  else v_prioridade:='baixa'; v_class:='Coletar mais informações'; end if;
  update public.triage_sessions set score=v_score, prioridade=v_prioridade where id=p_session_id;
  return jsonb_build_object('score',v_score,'prioridade',v_prioridade,'classificacao',v_class);
end $function$;

-- cancel_lead_followups()
CREATE OR REPLACE FUNCTION public.cancel_lead_followups()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('ganho','perdido') AND OLD.status = 'aberto' THEN
    UPDATE public.lead_followups
    SET status = 'cancelado'
    WHERE lead_id = NEW.id AND status = 'pendente';
  END IF;
  RETURN NEW;
END $function$;

-- check_order_completion()
CREATE OR REPLACE FUNCTION public.check_order_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists(select 1 from public.order_checklist_items where order_id=new.order_id and required and status<>'concluido') then
    update public.order_checklists set status='concluido',completed_at=now() where order_id=new.order_id;
    update public.orders set operational_status='finalizado',next_action=null,next_action_date=null where id=new.order_id;
  else update public.order_checklists set status='em_andamento',completed_at=null where order_id=new.order_id; end if;
  return new;
end $function$;

-- complete_installation()
CREATE OR REPLACE FUNCTION public.complete_installation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s public.sales;
begin
  if new.status='concluida' and old.status is distinct from new.status then
    update public.orders set installation_status='concluida',next_action='Realizar pós-venda',next_action_date=current_date+3 where id=new.order_id;
    select s1.* into s from public.sales s1 join public.orders o on o.sale_id=s1.id where o.id=new.order_id;
    if s.open_amount>0 and exists(select 1 from public.financial_entries where sale_id=s.id and open_amount>0) then
      update public.financial_entries set due_date=current_date+3,notes=concat_ws(E'\n',notes,'Saldo final cobrado após instalação.') where sale_id=s.id and open_amount>0;
    elsif s.open_amount>0 then
      insert into public.financial_entries(company_id,entry_type,origin,client_id,sale_id,description,total_amount,due_date) values(s.company_id,'receber','venda',s.client_id,s.id,'Saldo final da venda '||s.sale_number,s.open_amount,current_date+3);
    end if;
    insert into public.followups(company_id,client_id,sale_id,due_at,action,status,notes) values(s.company_id,s.client_id,s.id,now()+interval '3 days','Pós-venda da instalação','pendente','Gerado automaticamente');
  end if; return new;
end $function$;

-- configure_automation_cron(text,text)
CREATE OR REPLACE FUNCTION public.configure_automation_cron(p_dispatcher_url text, p_automation_secret text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'extensions'
AS $function$
declare existing bigint; job_id bigint; command text;
begin
  if p_dispatcher_url !~ '^https://.+/functions/v1/automation-dispatcher$' or length(p_automation_secret)<24 then raise exception 'URL ou segredo inválido'; end if;
  select jobid into existing from cron.job where jobname='crm-bielenki-whatsapp-dispatcher';
  if existing is not null then perform cron.unschedule(existing); end if;
  command:=format($cmd$select net.http_post(url:=%L,headers:=jsonb_build_object('content-type','application/json','x-automation-secret',%L),body:='{}'::jsonb,timeout_milliseconds:=50000)$cmd$,p_dispatcher_url,p_automation_secret);
  select cron.schedule('crm-bielenki-whatsapp-dispatcher','*/5 * * * *',command) into job_id;
  return job_id;
end $function$;

-- create_default_installation_checklist()
CREATE OR REPLACE FUNCTION public.create_default_installation_checklist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists(select 1 from public.installation_checklists where installation_id=new.id) then
    insert into public.installation_checklists(company_id,installation_id,title,sort_order,required)
    select new.company_id,new.id,x.title,x.ord,true from (values
      (1,'Confirmar cliente, endereço e acesso'),(2,'Conferir medidas e projeto'),(3,'Conferir peças, acessórios e ferramentas'),
      (4,'Proteger pisos, paredes e móveis'),(5,'Executar instalação e fixação'),(6,'Realizar vedação e acabamento'),
      (7,'Testar abertura, fechamento e funcionamento'),(8,'Limpar o local e recolher resíduos'),
      (9,'Registrar fotos finais'),(10,'Obter conferência/aceite do cliente')
    ) as x(ord,title);
  end if;
  return new;
end $function$;

-- create_gutter_quote(jsonb)
CREATE OR REPLACE FUNCTION public.create_gutter_quote(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c uuid := public.current_company_id();
  st uuid;
  q uuid;
  g uuid;
  subtotal_value numeric := 0;
begin
  perform public.require_table_access('quotes','insert');
  if c is null then raise exception 'Usuario sem empresa'; end if;
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente invalido'; end if;

  select id into st
  from public.sale_types
  where (company_id=c or company_id is null) and name ilike 'Calhas%' and active
  order by company_id nulls last
  limit 1;
  if st is null then raise exception 'Cadastre o tipo de venda Calhas instaladas'; end if;

  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0
     and jsonb_array_length(coalesce(p_payload->'special_items','[]'::jsonb))=0 then
    raise exception 'Informe ao menos um item';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'meters','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
       or coalesce(nullif(item->>'install_price','')::numeric,0) < 0
  ) then
    raise exception 'Item invalido';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
  ) then
    raise exception 'Item complementar invalido';
  end if;

  select
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'meters','')::numeric,0)
        * (
          coalesce(nullif(item->>'unit_price','')::numeric,0)
          + coalesce(nullif(item->>'install_price','')::numeric,0)
        )
      )
      from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    ),0)
    +
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'unit_price','')::numeric,0)
      )
      from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    ),0)
  into subtotal_value;

  if subtotal_value <= 0 then raise exception 'Total do orcamento deve ser positivo'; end if;

  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until,installation_deadline,hide_unit_prices)
  values(
    c,
    public.next_number('ORC','public.quotes',c),
    (p_payload->>'client_id')::uuid,
    st,
    auth.uid(),
    subtotal_value,
    coalesce(nullif(p_payload->>'discount','')::numeric,0),
    coalesce(nullif(p_payload->>'freight','')::numeric,0),
    p_payload->>'notes',
    coalesce(nullif(p_payload->>'valid_until','')::date, current_date + coalesce((select default_validity_days from public.companies where id=c),15)),
    nullif(p_payload->>'installation_deadline',''),
    coalesce(nullif(p_payload->>'hide_unit_prices','')::boolean,false)
  ) returning id into q;

  insert into public.gutter_quotes(company_id,quote_id) values(c,q) returning id into g;

  insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price)
  select
    c,
    g,
    coalesce(nullif(item->>'category',''), public.gutter_catalog_category(item->>'product')),
    'fabricacao',
    item->>'product',
    item->>'thickness',
    item->>'cut',
    nullif(item->>'color',''),
    'Metro Linear (m)',
    (item->>'quantity')::numeric,
    (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0),
    coalesce(nullif(item->>'install_price','')::numeric,0)
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type)
  select
    c,
    q,
    item->>'product',
    concat_ws(' | ', nullif(item->>'category',''), nullif(item->>'thickness',''), nullif(item->>'cut',''), nullif(item->>'color','')),
    'm',
    (item->>'quantity')::numeric * (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0) + coalesce(nullif(item->>'install_price','')::numeric,0),
    true,
    true,
    'calha'
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

  return q;
end;
$function$;

-- create_gutter_quote_unchecked(jsonb)
CREATE OR REPLACE FUNCTION public.create_gutter_quote_unchecked(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); st uuid; q uuid; g uuid; x jsonb; sub numeric:=0;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  select id into st from public.sale_types where (company_id=c or company_id is null) and name ilike 'Calhas%' order by company_id nulls last limit 1;
  if st is null then raise exception 'Cadastre o tipo de venda Calhas instaladas'; end if;
  select coalesce(sum((i->>'quantity')::numeric*(i->>'meters')::numeric*(i->>'unit_price')::numeric),0) into sub from jsonb_array_elements(p_payload->'items') i;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until)
    values(c,public.next_number('ORC','public.quotes',c),(p_payload->>'client_id')::uuid,st,auth.uid(),sub,
      coalesce((p_payload->>'discount')::numeric,0),coalesce((p_payload->>'freight')::numeric,0),
      p_payload->>'notes',current_date+coalesce(nullif((select default_validity_days from public.companies where id=c),null),15))
    returning id into q;
  insert into public.gutter_quotes(company_id,quote_id) values(c,q) returning id into g;
  for x in select * from jsonb_array_elements(p_payload->'items') loop
    insert into public.gutter_quote_items(company_id,gutter_quote_id,product,thickness,cut,color,quantity,meters,unit_price)
    values(c,g,x->>'product',x->>'thickness',x->>'cut',x->>'color',
      (x->>'quantity')::numeric,(x->>'meters')::numeric,(x->>'unit_price')::numeric);
    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
    values(c,q,x->>'product',(x->>'thickness')||' · corte '||(x->>'cut'),'m',
      (x->>'quantity')::numeric*(x->>'meters')::numeric,(x->>'unit_price')::numeric,true,true);
  end loop;
  return q;
end $function$;

-- create_manual_purchase(jsonb)
CREATE OR REPLACE FUNCTION public.create_manual_purchase(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      begin
        perform public.require_table_access('purchase_orders','insert');
        return public.create_manual_purchase_unchecked(p_payload);
      end $function$;

-- create_manual_purchase_unchecked(jsonb)
CREATE OR REPLACE FUNCTION public.create_manual_purchase_unchecked(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); po uuid; entry_id uuid; item jsonb; total_value numeric; paid_value numeric:=coalesce((p_payload->>'paid_amount')::numeric,0); supplier uuid; material uuid; category_id uuid; item_name text;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  supplier:=(p_payload->>'supplier_id')::uuid;
  if not exists(select 1 from public.suppliers where id=supplier and company_id=c) then raise exception 'Fornecedor inválido'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into total_value from jsonb_array_elements(p_payload->'items') x;
  if total_value<=0 then raise exception 'Inclua ao menos um item com valor'; end if;
  if paid_value<0 or paid_value>total_value then raise exception 'Valor pago inválido'; end if;
  insert into public.purchase_orders(company_id,order_number,supplier_id,buyer_id,status,total,ordered_at,expected_at,notes)
  values(c,public.next_number('COM','public.purchase_orders',c),supplier,auth.uid(),'pedido_enviado_ao_fornecedor',total_value,current_date,nullif(p_payload->>'expected_at','')::date,p_payload->>'notes') returning id into po;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    item_name:=trim(item->>'description'); material:=null; category_id:=null;
    if nullif(item->>'material_id','') is not null then select id into material from public.materials where id=(item->>'material_id')::uuid and company_id=c; end if;
    if material is null then
      select id into category_id from public.material_categories where company_id=c and lower(name)=lower(coalesce(item->>'category','Outros')) limit 1;
      if category_id is null then insert into public.material_categories(company_id,name) values(c,coalesce(nullif(item->>'category',''),'Outros')) returning id into category_id; end if;
      select id into material from public.materials where company_id=c and lower(name)=lower(item_name) limit 1;
      if material is null then insert into public.materials(company_id,category_id,name,unit,active) values(c,category_id,item_name,coalesce(nullif(item->>'unit',''),'un'),true) returning id into material; end if;
    end if;
    insert into public.purchase_order_items(company_id,purchase_order_id,material_id,category,description,unit,requested_quantity,purchased_quantity,unit_price,supplier_id,status,notes)
    values(c,po,material,item->>'category',item_name,coalesce(nullif(item->>'unit',''),'un'),(item->>'quantity')::numeric,(item->>'quantity')::numeric,(item->>'unit_price')::numeric,supplier,'comprado',item->>'notes');
  end loop;
  if paid_value>0 then select id into entry_id from public.financial_entries where purchase_order_id=po and origin='compra'; perform public.register_payment(entry_id,paid_value,coalesce(nullif(p_payload->>'paid_at','')::date,current_date),p_payload->>'payment_method','Pagamento informado no cadastro da compra'); end if;
  return po;
end $function$;

-- create_manual_sale(jsonb)
CREATE OR REPLACE FUNCTION public.create_manual_sale(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      begin
        perform public.require_table_access('sales','insert');
        return public.create_manual_sale_unchecked(p_payload);
      end $function$;

-- create_manual_sale_unchecked(jsonb)
CREATE OR REPLACE FUNCTION public.create_manual_sale_unchecked(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); s uuid; f uuid; item jsonb; total_value numeric; paid_value numeric:=coalesce((p_payload->>'paid_amount')::numeric,0); client uuid; sale_type uuid;
begin
  if c is null then raise exception 'Usuário sem empresa'; end if;
  client:=(p_payload->>'client_id')::uuid; sale_type:=(p_payload->>'sale_type_id')::uuid;
  if not exists(select 1 from public.clients where id=client and company_id=c) then raise exception 'Cliente inválido'; end if;
  if not exists(select 1 from public.sale_types where id=sale_type and company_id=c) then raise exception 'Tipo de venda inválido'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into total_value from jsonb_array_elements(p_payload->'items') x;
  if total_value<=0 then raise exception 'Inclua ao menos um item com valor'; end if;
  if paid_value<0 or paid_value>total_value then raise exception 'Valor pago inválido'; end if;
  insert into public.sales(company_id,sale_number,client_id,sale_type_id,seller_id,total,operational_status,next_action,next_action_date,notes)
  values(c,public.next_number('VEN','public.sales',c),client,sale_type,auth.uid(),total_value,'venda_avulsa','Acompanhar pagamento',coalesce(nullif(p_payload->>'due_date','')::date,current_date),p_payload->>'notes') returning id into s;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    insert into public.sale_items(company_id,sale_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,notes)
    values(c,s,item->>'product',item->>'description',coalesce(nullif(item->>'unit',''),'un'),(item->>'quantity')::numeric,(item->>'unit_price')::numeric,coalesce((item->>'requires_purchase')::boolean,false),coalesce((item->>'requires_production')::boolean,false),item->>'notes');
  end loop;
  insert into public.financial_entries(company_id,entry_type,origin,client_id,sale_id,description,total_amount,due_date,notes)
  values(c,'receber','venda',client,s,'Venda manual '||(select sale_number from public.sales where id=s),total_value,coalesce(nullif(p_payload->>'due_date','')::date,current_date),p_payload->>'notes') returning id into f;
  if paid_value>0 then perform public.register_payment(f,paid_value,coalesce(nullif(p_payload->>'paid_at','')::date,current_date),p_payload->>'payment_method','Pagamento informado no cadastro da venda'); end if;
  insert into public.activities(company_id,client_id,sale_id,activity_type,subject,description,created_by) values(c,client,s,'venda','Venda cadastrada manualmente',p_payload->>'notes',auth.uid());
  return s;
end $function$;

-- create_measurement_from_client(uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.create_measurement_from_client(p_client_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); client_row public.clients; measurement_id uuid; item text; n integer:=0;
begin
  perform public.require_table_access('measurements','insert');
  select * into client_row from public.clients where id=p_client_id and company_id=c;
  if client_row.id is null then raise exception 'Cliente invalido'; end if;
  insert into public.measurements(company_id,measurement_number,client_id,scheduled_at,address,phone,status,created_by)
  values(c,public.next_number('MED','public.measurements',c),client_row.id,p_scheduled_at,client_row.address,coalesce(client_row.whatsapp,client_row.phone),'agendado',auth.uid())
  returning id into measurement_id;
  for item in select x from unnest(array[
    'Medidas conferidas','Produto definido','Cor definida','Vidro definido','Acessorios definidos',
    'Forma de instalacao definida','Fotos realizadas','Cliente aprovou medidas','Producao liberada'
  ]) x loop
    n:=n+1;
    insert into public.measurement_checklists(company_id,measurement_id,title,sort_order) values(c,measurement_id,item,n);
  end loop;
  return measurement_id;
end $function$;

-- create_order_checklist(uuid,text)
CREATE OR REPLACE FUNCTION public.create_order_checklist(p_order_id uuid, p_type text DEFAULT 'calhas'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

-- create_quote_from_measurement(uuid,text)
CREATE OR REPLACE FUNCTION public.create_quote_from_measurement(p_measurement_id uuid, p_sale_type_name text DEFAULT 'Esquadrias sob medida'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); m public.measurements; sale_type_id uuid; new_quote_id uuid; subtotal_value numeric:=0;
begin
  perform public.require_table_access('measurements','select');
  perform public.require_table_access('quotes','insert');
  select * into m from public.measurements where id=p_measurement_id and company_id=c;
  if m.id is null or m.client_id is null then raise exception 'Medicao invalida'; end if;
  select id into sale_type_id from public.sale_types where company_id=c and name=p_sale_type_name and active limit 1;
  if sale_type_id is null then select id into sale_type_id from public.sale_types where company_id=c and active order by name limit 1; end if;
  if sale_type_id is null then raise exception 'Tipo de venda nao configurado'; end if;
  select coalesce(sum(quantity*0),0) into subtotal_value from public.measurement_items where measurement_id=m.id;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,notes,valid_until)
  values(c,public.next_number('ORC','public.quotes',c),m.client_id,sale_type_id,coalesce(m.seller_id,auth.uid()),subtotal_value,coalesce(m.notes,'')||E'\nGerado a partir da medicao '||coalesce(m.measurement_number,m.id::text),current_date+15)
  returning id into new_quote_id;
  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
  select c,new_quote_id,product,concat_ws(' | ',environment,width||' x '||height,color,glass_type,notes),'un',quantity,0,true,true
  from public.measurement_items where measurement_id=m.id;
  update public.measurements set quote_id=new_quote_id,status='medicao_concluida',completed_at=coalesce(completed_at,now()) where id=m.id;
  return new_quote_id;
end $function$;

-- create_window_quote(jsonb)
CREATE OR REPLACE FUNCTION public.create_window_quote(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); sale_type uuid; quote_id uuid; item jsonb; subtotal_value numeric:=0;
begin
  perform public.require_table_access('quotes','insert');
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente invalido'; end if;
  select id into sale_type from public.sale_types where company_id=c and name ilike 'Esquadrias%' and active limit 1;
  if sale_type is null then raise exception 'Tipo de venda Esquadrias nao configurado'; end if;
  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then raise exception 'Informe ao menos um item'; end if;
  select coalesce(sum((i->>'quantity')::numeric*(i->>'unit_price')::numeric),0) into subtotal_value from jsonb_array_elements(p_payload->'items') i;
  if subtotal_value<=0 then raise exception 'Total deve ser positivo'; end if;
  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,notes,valid_until,installation_deadline)
  values(c,public.next_number('ORC','public.quotes',c),(p_payload->>'client_id')::uuid,sale_type,auth.uid(),subtotal_value,
    coalesce((p_payload->>'discount')::numeric,0),coalesce((p_payload->>'freight')::numeric,0),p_payload->>'notes',
    nullif(p_payload->>'valid_until','')::date,nullif(p_payload->>'installation_deadline','')) returning id into quote_id;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    if (item->>'quantity')::numeric<=0 or (item->>'unit_price')::numeric<0 then raise exception 'Item invalido'; end if;
    insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production)
    values(c,quote_id,item->>'product',concat_ws(' | ',nullif(item->>'line',''),nullif(item->>'measurements',''),nullif(item->>'glass',''),nullif(item->>'accessories',''),nullif(item->>'color','')),
      'un',(item->>'quantity')::numeric,(item->>'unit_price')::numeric,true,true);
  end loop;
  return quote_id;
end $function$;

-- current_company_id()
CREATE OR REPLACE FUNCTION public.current_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select company_id from public.profiles where id=auth.uid()
$function$;

-- current_user_roles()
CREATE OR REPLACE FUNCTION public.current_user_roles()
 RETURNS app_role[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(role), array[]::public.app_role[]) from public.user_roles where profile_id=auth.uid()
$function$;

-- dashboard_executivo()
CREATE OR REPLACE FUNCTION public.dashboard_executivo()
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

-- dashboard_summary()
CREATE OR REPLACE FUNCTION public.dashboard_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cid AS (SELECT public.current_company_id() AS id)
  SELECT jsonb_build_object(
    'leads_novos',         (SELECT COUNT(*) FROM public.leads l, cid WHERE l.company_id=cid.id AND l.status='aberto' AND l.deleted_at IS NULL AND l.created_at > now()-INTERVAL '7 days'),
    'leads_total',         (SELECT COUNT(*) FROM public.leads l, cid WHERE l.company_id=cid.id AND l.status='aberto' AND l.deleted_at IS NULL),
    'orcamentos_pendentes',(SELECT COUNT(*) FROM public.quotes q, cid WHERE q.company_id=cid.id AND q.status='pendente'),
    'orcamentos_aprovados',(SELECT COUNT(*) FROM public.quotes q, cid WHERE q.company_id=cid.id AND q.status='aprovado'),
    'vendas_mes',          (SELECT COALESCE(SUM(s.total),0) FROM public.sales s, cid WHERE s.company_id=cid.id AND s.created_at > date_trunc('month',now())),
    'em_producao',         (SELECT COUNT(*) FROM public.orders o, cid WHERE o.company_id=cid.id AND o.production_status IN ('liberado','em_producao')),
    'instalacoes_pendentes',(SELECT COUNT(*) FROM public.installations i, cid WHERE i.company_id=cid.id AND i.status IN ('agendada','em_andamento')),
    'receitas_abertas',    (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='receber' AND fe.status NOT IN ('pago','cancelado')),
    'despesas_abertas',    (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='pagar' AND fe.status NOT IN ('pago','cancelado')),
    'overdue_receivable',  (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='receber' AND fe.status NOT IN ('pago','cancelado') AND fe.due_date < CURRENT_DATE),
    'overdue_payable',     (SELECT COALESCE(SUM(fe.open_amount),0) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.entry_type='pagar' AND fe.status NOT IN ('pago','cancelado') AND fe.due_date < CURRENT_DATE),
    'due_today',           (SELECT COUNT(*) FROM public.financial_entries fe, cid WHERE fe.company_id=cid.id AND fe.status NOT IN ('pago','cancelado') AND fe.due_date = CURRENT_DATE),
    'alertas_ativos',      (SELECT COUNT(*) FROM public.operational_alerts oa, cid WHERE oa.company_id=cid.id AND oa.resolved=false),
    'followups_hoje',      (SELECT COUNT(*) FROM public.lead_followups lf JOIN public.leads l ON l.id=lf.lead_id, cid WHERE l.company_id=cid.id AND lf.status='pendente' AND lf.scheduled_at::date = CURRENT_DATE)
  );
$function$;

-- delete_draft_quote(uuid)
CREATE OR REPLACE FUNCTION public.delete_draft_quote(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_table_access('quotes','delete');
  if not exists(select 1 from public.quotes where id=p_quote_id and company_id=public.current_company_id() and status<>'aprovado') then
    raise exception 'Somente orcamentos nao aprovados podem ser excluidos';
  end if;
  delete from public.quotes where id=p_quote_id and company_id=public.current_company_id();
end $function$;

-- duplicate_quote(uuid)
CREATE OR REPLACE FUNCTION public.duplicate_quote(p_quote_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c uuid := public.current_company_id();
  source public.quotes;
  target uuid;
  old_gutter uuid;
  new_gutter uuid;
begin
  perform public.require_table_access('quotes','insert');
  select * into source from public.quotes where id=p_quote_id and company_id=c;
  if source.id is null then raise exception 'Orcamento nao encontrado'; end if;

  insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,subtotal,discount,freight,status,valid_until,installation_deadline,notes,seller_name,payment_methods,client_notes,hide_unit_prices)
  values(c,public.next_number('ORC','public.quotes',c),source.client_id,source.sale_type_id,auth.uid(),source.subtotal,source.discount,source.freight,'rascunho',current_date+15,source.installation_deadline,source.notes,source.seller_name,source.payment_methods,source.client_notes,source.hide_unit_prices)
  returning id into target;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type,metadata)
  select c,target,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type,coalesce(metadata,'{}'::jsonb)
  from public.quote_items
  where quote_id=source.id;

  select id into old_gutter from public.gutter_quotes where quote_id=source.id;
  if old_gutter is not null then
    insert into public.gutter_quotes(company_id,quote_id) values(c,target) returning id into new_gutter;
    insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price,sort_order)
    select c,new_gutter,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price,sort_order
    from public.gutter_quote_items
    where gutter_quote_id=old_gutter;
  end if;
  return target;
end;
$function$;

-- enqueue_due_automations()
CREATE OR REPLACE FUNCTION public.enqueue_due_automations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare queued integer:=0; row record;
begin
  for row in
    select fe.id entry_id,fe.company_id,fe.open_amount,fe.due_date,c.id client_id,c.name client_name,coalesce(c.whatsapp,c.phone) phone,coalesce(co.trade_name,co.name) company_name,r.id rule_id,r.days_before,r.send_time,t.id template_id,t.body
    from public.financial_entries fe join public.clients c on c.id=fe.client_id join public.companies co on co.id=fe.company_id join public.automation_rules r on r.company_id=fe.company_id and r.automation_type='payment_reminder' and r.enabled join public.message_templates t on t.id=r.template_id and t.active
    where fe.entry_type='receber' and fe.open_amount>0 and fe.status not in ('pago','cancelado') and coalesce(c.whatsapp,c.phone) is not null and fe.due_date<=current_date+r.days_before
  loop
    insert into public.outbound_messages(company_id,client_id,template_id,automation_type,phone,body,payload,scheduled_at,dedupe_key)
    values(row.company_id,row.client_id,row.template_id,'payment_reminder',row.phone,public.render_message(row.body,jsonb_build_object('cliente',row.client_name,'empresa',row.company_name,'valor',to_char(row.open_amount,'FM999G999G990D00'),'vencimento',to_char(row.due_date,'DD/MM/YYYY'))),jsonb_build_object('financial_entry_id',row.entry_id),greatest(now(),(row.due_date+row.send_time-row.days_before*interval '1 day')::timestamptz), 'payment-reminder-'||row.entry_id::text||'-'||current_date::text)
    on conflict do nothing; if found then queued:=queued+1; end if;
  end loop;
  for row in
    select i.id installation_id,i.company_id,i.scheduled_at,c.id client_id,c.name client_name,coalesce(c.whatsapp,c.phone) phone,coalesce(co.trade_name,co.name) company_name,r.days_before,r.send_time,t.id template_id,t.body
    from public.installations i join public.orders o on o.id=i.order_id join public.clients c on c.id=o.client_id join public.companies co on co.id=i.company_id join public.automation_rules r on r.company_id=i.company_id and r.automation_type='appointment_reminder' and r.enabled join public.message_templates t on t.id=r.template_id and t.active
    where i.status not in ('concluida','cancelada') and i.scheduled_at is not null and i.scheduled_at::date<=current_date+r.days_before and coalesce(c.whatsapp,c.phone) is not null
  loop
    insert into public.outbound_messages(company_id,client_id,template_id,automation_type,phone,body,payload,scheduled_at,dedupe_key)
    values(row.company_id,row.client_id,row.template_id,'appointment_reminder',row.phone,public.render_message(row.body,jsonb_build_object('cliente',row.client_name,'empresa',row.company_name,'data',to_char(row.scheduled_at,'DD/MM/YYYY HH24:MI'))),jsonb_build_object('installation_id',row.installation_id),greatest(now(),row.scheduled_at-row.days_before*interval '1 day'),'appointment-reminder-'||row.installation_id::text)
    on conflict do nothing; if found then queued:=queued+1; end if;
  end loop;
  return queued;
end $function$;

-- financial_summary(text)
CREATE OR REPLACE FUNCTION public.financial_summary(p_entry_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); result jsonb;
begin
  perform public.require_table_access('financial_entries','select');
  select jsonb_build_object(
    'open_amount', coalesce(sum(open_amount) filter(where open_amount>0 and status<>'cancelado'),0),
    'open_count', count(*) filter(where open_amount>0 and status<>'cancelado'),
    'overdue_amount', coalesce(sum(open_amount) filter(where open_amount>0 and due_date<current_date and status not in ('pago','cancelado')),0),
    'overdue_count', count(*) filter(where open_amount>0 and due_date<current_date and status not in ('pago','cancelado')),
    'due_today_count', count(*) filter(where open_amount>0 and due_date=current_date and status not in ('pago','cancelado')),
    'done_count', count(*) filter(where status in ('pago','cancelado')),
    'total_count', count(*)
  ) into result
  from public.financial_entries
  where company_id=c and (p_entry_type is null or entry_type::text=p_entry_type);
  return result;
end $function$;

-- generate_operational_alerts()
CREATE OR REPLACE FUNCTION public.generate_operational_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

-- global_search(text)
CREATE OR REPLACE FUNCTION public.global_search(p_query text)
 RETURNS TABLE(entity_type text, entity_id uuid, title text, subtitle text, status text, href text, priority integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

-- guard_installation_completion()
CREATE OR REPLACE FUNCTION public.guard_installation_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'concluida' and old.status is distinct from new.status and exists (
    select 1 from public.installation_checklists
    where installation_id = new.id and required and not completed
  ) then
    raise exception 'Conclua todos os itens obrigatórios do checklist antes de finalizar a instalação';
  end if;
  return new;
end $function$;

-- gutter_catalog_category(text)
CREATE OR REPLACE FUNCTION public.gutter_catalog_category(p_product text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when coalesce(p_product,'') ilike '%pingadeira%' then 'Pingadeiras'
    when coalesce(p_product,'') ilike '%rufo%' then 'Rufos'
    when coalesce(p_product,'') ilike '%condutor%' or coalesce(p_product,'') ilike '%joelho%' or coalesce(p_product,'') ilike '%bocal%' then 'Condutores'
    when coalesce(p_product,'') ilike '%suporte%' or coalesce(p_product,'') ilike '%rebite%' or coalesce(p_product,'') ilike '%silicone%' or coalesce(p_product,'') ilike '%vedante%' or coalesce(p_product,'') ilike '%cabeceira%' or coalesce(p_product,'') ilike '%fixador%' then 'Acessórios'
    when coalesce(p_product,'') ilike '%mão de obra%' or coalesce(p_product,'') ilike '%mao de obra%' or coalesce(p_product,'') ilike '%frete%' or coalesce(p_product,'') ilike '%deslocamento%' then 'Serviços'
    when coalesce(p_product,'') ilike '%coifa%' or coalesce(p_product,'') ilike '%chamin%' or coalesce(p_product,'') ilike '%exaustor%' or coalesce(p_product,'') ilike '%duto%' or coalesce(p_product,'') ilike '%sob medida%' or coalesce(p_product,'') ilike '%corte e dobra%' then 'Itens Especiais'
    else 'Calhas'
  end
$function$;

-- gutter_catalog_item_type(text)
CREATE OR REPLACE FUNCTION public.gutter_catalog_item_type(p_category text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_category = 'Serviços' then 'servico'
    when p_category in ('Acessórios','Itens Especiais') then 'item_especial'
    when p_category = 'Condutores' then 'condutor'
    else 'fabricacao'
  end
$function$;

-- gutter_quote_item_unit(text,text)
CREATE OR REPLACE FUNCTION public.gutter_quote_item_unit(p_item_type text, p_unit text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_unit IS NOT NULL AND p_unit <> '' THEN p_unit
    WHEN p_item_type IN ('condutor','acessorio','especial') THEN 'Unidade'
    WHEN p_item_type = 'servico'                           THEN 'Serviço'
    ELSE 'Metro Linear (m)'  -- fabricacao, calha, rufo, pingadeira
  END;
$function$;

-- handle_new_user()
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid; r public.app_role;
begin
  c := nullif(new.raw_app_meta_data->>'company_id','')::uuid;
  if c is null then return new; end if;
  insert into public.profiles(id,company_id,full_name) values(new.id,c,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)));
  r := coalesce(nullif(new.raw_app_meta_data->>'role','')::public.app_role,'atendente');
  insert into public.user_roles(company_id,profile_id,role) values(c,new.id,r);
  return new;
end $function$;

-- has_role(app_role[])
CREATE OR REPLACE FUNCTION public.has_role(roles app_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(select 1 from public.user_roles where profile_id=auth.uid() and role=any(roles))
$function$;

-- has_table_access(text,text)
CREATE OR REPLACE FUNCTION public.has_table_access(resource text, action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare allowed boolean;
begin
  if public.has_role(array['administrador','gerente']::public.app_role[]) then return true; end if;
  select bool_or(case $2
    when 'select' then p.can_view
    when 'insert' then p.can_create
    when 'update' then p.can_update
    when 'delete' then p.can_delete
    else false end)
  into allowed
  from public.permissions p
  join public.user_roles ur on ur.role = p.role
  where ur.profile_id = auth.uid() and p.resource = $1;
  return coalesce(allowed, false);
end $function$;

-- log_pricing_audit()
CREATE OR REPLACE FUNCTION public.log_pricing_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO audit_logs(company_id, table_name, record_id, action, old_data, new_data)
  VALUES (
    COALESCE(NEW.company_id, OLD.company_id),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD)::jsonb ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END $function$;

-- log_pricing_change()
CREATE OR REPLACE FUNCTION public.log_pricing_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.pricing_change_log(company_id, user_id, table_name, record_id, operation, old_data, new_data)
  values (
    coalesce(NEW.company_id, OLD.company_id),
    auth.uid(),
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    TG_OP,
    case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end
  );
  return coalesce(NEW, OLD);
end $function$;

-- next_number(text,regclass,uuid)
CREATE OR REPLACE FUNCTION public.next_number(prefix text, relation regclass, company uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n bigint;
  col text;
  tbl text := regexp_replace(relation::text, '^.*\.', '');
begin
  perform pg_advisory_xact_lock(hashtextextended(tbl || ':' || prefix, 0));

  select column_name into col
  from information_schema.columns
  where table_schema = 'public' and table_name = tbl and column_name like '%\_number' escape '\'
  limit 1;

  execute format(
    'select coalesce(max(substring(%I from ''(\d+)$'')::bigint), 0) + 1 from %s where company_id = $1 and %I like $2',
    col, relation, col
  ) into n using company, prefix || '-%';

  return prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(n::text, 5, '0');
end;$function$;

-- next_order_number(uuid)
CREATE OR REPLACE FUNCTION public.next_order_number(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_num int;
begin
  select nextval('public.seq_order_number') into v_num;
  return 'PED-' || lpad(v_num::text, 5, '0');
end;$function$;

-- next_purchase_number(uuid)
CREATE OR REPLACE FUNCTION public.next_purchase_number(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_num int;
begin
  select nextval('public.seq_purchase_number') into v_num;
  return 'COM-' || lpad(v_num::text, 5, '0');
end;$function$;

-- next_quote_number(uuid)
CREATE OR REPLACE FUNCTION public.next_quote_number(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_num int;
begin
  select nextval('public.seq_quote_number') into v_num;
  return 'ORC-' || lpad(v_num::text, 5, '0');
end;$function$;

-- on_installation_done_workflow()
CREATE OR REPLACE FUNCTION public.on_installation_done_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status is distinct from new.status and new.status = 'concluida' then
    perform public.trigger_workflow_event(
      new.company_id, 'instalacao_concluida',
      jsonb_build_object('installation_id',new.id,'order_id',new.order_id,'responsible_id',new.responsible_id)
    );
  end if;
  return new;
end $function$;

-- on_lead_created_workflow()
CREATE OR REPLACE FUNCTION public.on_lead_created_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.trigger_workflow_event(
    new.company_id, 'lead_criado',
    jsonb_build_object('lead_id',new.id,'nome',new.name,'telefone',new.phone,'email',new.email,'origem',new.source,'stage_id',new.stage_id)
  );
  return new;
end $function$;

-- on_new_company_ai_config()
CREATE OR REPLACE FUNCTION public.on_new_company_ai_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.ai_agent_config(company_id, active, agent_name, openai_model)
  values (new.id, false, 'Ana', 'gpt-4o')
  on conflict(company_id) do nothing;
  return new;
end $function$;

-- on_new_company_workflows()
CREATE OR REPLACE FUNCTION public.on_new_company_workflows()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin perform public.seed_company_workflow_templates(new.id); return new; end $function$;

-- on_quote_changed_workflow()
CREATE OR REPLACE FUNCTION public.on_quote_changed_workflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status is distinct from new.status then
    perform public.trigger_workflow_event(
      new.company_id, 'orcamento_' || new.status,
      jsonb_build_object('quote_id',new.id,'numero',new.quote_number,'status',new.status,'total',new.total,'client_id',new.client_id)
    );
  end if;
  return new;
end $function$;

-- pending_center()
CREATE OR REPLACE FUNCTION public.pending_center()
 RETURNS TABLE(record_id uuid, category text, priority text, title text, subtitle text, link text, due_date date, days_late integer, amount numeric, client_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- queue_payment_confirmation()
CREATE OR REPLACE FUNCTION public.queue_payment_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e public.financial_entries; c public.clients; rule public.automation_rules; template public.message_templates; company_name text; remaining numeric;
begin
  select * into e from public.financial_entries where id=new.financial_entry_id;
  if e.entry_type<>'receber' or e.client_id is null then return new; end if;
  select * into rule from public.automation_rules where company_id=e.company_id and automation_type='payment_confirmation' and enabled;
  if rule.id is null then return new; end if;
  select * into c from public.clients where id=e.client_id; select * into template from public.message_templates where id=rule.template_id and active;
  if template.id is null or coalesce(c.whatsapp,c.phone) is null then return new; end if;
  select coalesce(trade_name,name) into company_name from public.companies where id=e.company_id;
  remaining:=greatest(e.total_amount-(e.paid_amount+new.amount),0);
  insert into public.outbound_messages(company_id,client_id,template_id,automation_type,phone,body,payload,dedupe_key)
  values(e.company_id,c.id,template.id,'payment_confirmation',coalesce(c.whatsapp,c.phone),public.render_message(template.body,jsonb_build_object('cliente',c.name,'empresa',company_name,'valor_pago',to_char(new.amount,'FM999G999G990D00'),'saldo',to_char(remaining,'FM999G999G990D00'))),jsonb_build_object('payment_id',new.id),'payment-confirmation-'||new.id::text)
  on conflict do nothing;
  return new;
end $function$;

-- recalculate_quote()
CREATE OR REPLACE FUNCTION public.recalculate_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q uuid:=coalesce(new.quote_id,old.quote_id);
begin update public.quotes set subtotal=coalesce((select sum(total) from public.quote_items where quote_id=q),0) where id=q; return coalesce(new,old); end $function$;

-- receive_purchase_item(uuid,numeric,uuid,numeric,text)
CREATE OR REPLACE FUNCTION public.receive_purchase_item(p_item_id uuid, p_quantity numeric, p_location_id uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare i public.purchase_order_items; movement uuid; all_received boolean; prod uuid;
begin
  perform public.require_table_access('purchase_order_items','update');
  perform public.require_table_access('stock_movements','insert');
  select * into i from public.purchase_order_items
    where id=p_item_id and company_id=public.current_company_id() for update;
  if i.id is null or i.material_id is null then raise exception 'Item ou material invalido'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity>i.pending_quantity then raise exception 'Quantidade excede o saldo pendente'; end if;
  if not exists(select 1 from public.stock_locations where id=p_location_id and company_id=i.company_id and active) then
    raise exception 'Local de estoque invalido';
  end if;
  update public.purchase_order_items set
    received_quantity=received_quantity+p_quantity,
    status=case when received_quantity+p_quantity>=purchased_quantity then 'recebido_completo' else 'recebido_parcial' end
  where id=i.id;
  insert into public.stock_movements(company_id,material_id,location_id,movement_type,quantity,unit_cost,purchase_order_item_id,order_id,notes,created_by)
  values(i.company_id,i.material_id,p_location_id,'entrada',p_quantity,coalesce(p_unit_cost,i.unit_price),i.id,i.order_id,p_notes,auth.uid())
  returning id into movement;
  select bool_and(pending_quantity=0) into all_received
  from public.purchase_order_items where purchase_order_id=i.purchase_order_id;
  update public.purchase_orders set
    status=case when all_received then 'recebido_completo' else 'recebido_parcial' end,
    received_at=case when all_received then current_date else null end
  where id=i.purchase_order_id and company_id=i.company_id;
  if i.order_id is not null then
    update public.production_materials pm set
      received_quantity=least(pm.required_quantity,pm.received_quantity+p_quantity),
      status=case when pm.received_quantity+p_quantity>=pm.required_quantity then 'recebido_completo' else 'recebido_parcial' end
    from public.production_orders po
    where pm.production_order_id=po.id and po.order_id=i.order_id and pm.material_id=i.material_id
    returning pm.production_order_id into prod;
    if prod is not null and not exists(
      select 1 from public.production_materials where production_order_id=prod and required and received_quantity<required_quantity
    ) then
      update public.production_orders set status='liberado' where id=prod and company_id=i.company_id;
      update public.orders set production_status='liberado',purchase_status='recebido_completo'
      where id=i.order_id and company_id=i.company_id;
    end if;
  end if;
  return movement;
end $function$;

-- register_payment(uuid,numeric,date,text,text)
CREATE OR REPLACE FUNCTION public.register_payment(p_entry_id uuid, p_amount numeric, p_paid_at date, p_method text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e public.financial_entries; pid uuid; total_paid numeric;
begin
  perform public.require_table_access('payments','insert');
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries
    where id=p_entry_id and company_id=public.current_company_id() for update;
  if e.id is null then raise exception 'Lancamento nao encontrado'; end if;
  if p_amount is null or p_amount<=0 or p_amount>e.open_amount then
    raise exception 'Valor invalido ou superior ao saldo aberto';
  end if;
  insert into public.payments(company_id,financial_entry_id,amount,paid_at,payment_method,notes,created_by)
  values(e.company_id,e.id,p_amount,p_paid_at,p_method,p_notes,auth.uid()) returning id into pid;
  select coalesce(sum(amount),0) into total_paid from public.payments where financial_entry_id=e.id and reversed_at is null;
  update public.financial_entries set
    paid_amount=total_paid,
    paid_at=case when total_paid>=total_amount then p_paid_at else null end,
    payment_method=p_method,
    status=case when total_paid>=total_amount then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end
  where id=e.id;
  if e.sale_id is not null then
    update public.sales set paid_amount=total_paid,
      financial_status=case when total_paid>=total then 'pago'::public.financial_status else 'parcialmente_pago'::public.financial_status end
    where id=e.sale_id and company_id=e.company_id;
  end if;
  if e.purchase_order_id is not null then
    update public.purchase_orders set paid_amount=total_paid
    where id=e.purchase_order_id and company_id=e.company_id;
  end if;
  return pid;
end $function$;

-- register_payment_with_adjustment(uuid,numeric,date,text,text,numeric,numeric,integer,date)
CREATE OR REPLACE FUNCTION public.register_payment_with_adjustment(p_entry_id uuid, p_amount numeric, p_paid_at date, p_method text, p_notes text DEFAULT NULL::text, p_interest numeric DEFAULT 0, p_discount numeric DEFAULT 0, p_installments integer DEFAULT 1, p_first_due_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e public.financial_entries; base_amount numeric; adjusted_total numeric; installment_amount numeric; allocated numeric:=0; i integer; payment_id uuid; remaining numeric; part record; part_paid numeric;
begin
  perform public.require_table_access('payments','insert');
  perform public.require_table_access('financial_entries','update');
  select * into e from public.financial_entries where id=p_entry_id and company_id=public.current_company_id() for update;
  if e.id is null then raise exception 'Lancamento nao encontrado'; end if;
  if p_interest<0 or p_discount<0 then raise exception 'Juros e desconto devem ser positivos'; end if;
  base_amount:=e.total_amount-e.interest_amount+e.discount_amount;
  adjusted_total:=greatest(base_amount+p_interest-p_discount,0);
  if adjusted_total<e.paid_amount then raise exception 'Desconto inferior ao valor ja pago'; end if;
  if p_installments<1 or p_installments>60 then raise exception 'Quantidade de parcelas invalida'; end if;
  if e.paid_amount>0 and p_installments<>e.installment_count then raise exception 'Parcelamento nao pode mudar apos o primeiro pagamento'; end if;
  update public.financial_entries set total_amount=adjusted_total,interest_amount=p_interest,discount_amount=p_discount,
    installment_count=p_installments,first_installment_due_date=coalesce(p_first_due_date,due_date,current_date) where id=e.id;
  if e.paid_amount=0 then
    delete from public.financial_installments where financial_entry_id=e.id;
    installment_amount:=trunc((adjusted_total/p_installments)::numeric,2);
    for i in 1..p_installments loop
      insert into public.financial_installments(company_id,financial_entry_id,installment_number,amount,due_date)
      values(e.company_id,e.id,i,case when i=p_installments then adjusted_total-allocated else installment_amount end,
        coalesce(p_first_due_date,e.due_date,current_date)+(i-1)*interval '1 month');
      allocated:=allocated+installment_amount;
    end loop;
  end if;
  payment_id:=public.register_payment(p_entry_id,p_amount,p_paid_at,p_method,p_notes);
  select paid_amount into remaining from public.financial_entries where id=e.id;
  for part in select id,amount,due_date from public.financial_installments where financial_entry_id=e.id order by installment_number loop
    part_paid:=least(part.amount,greatest(remaining,0));remaining:=remaining-part_paid;
    update public.financial_installments set paid_amount=part_paid,status=case when part_paid>=part.amount then 'paga' when part_paid>0 then 'parcial' when part.due_date<current_date then 'vencida' else 'aberta' end where id=part.id;
  end loop;
  return payment_id;
end $function$;

-- render_message(text,jsonb)
CREATE OR REPLACE FUNCTION public.render_message(p_body text, p_values jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare result text:=p_body; item record;
begin
  for item in select key,value from jsonb_each_text(p_values) loop result:=replace(result,'{{'||item.key||'}}',item.value); end loop;
  return result;
end $function$;

-- replace_user_roles(uuid,app_role[])
CREATE OR REPLACE FUNCTION public.replace_user_roles(p_profile_id uuid, p_roles app_role[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c uuid:=public.current_company_id(); target_company uuid; current_is_admin boolean; requested_admin boolean;
begin
  if not public.has_role(array['administrador','gerente']::public.app_role[]) then
    raise exception 'Sem permissao para alterar cargos' using errcode='42501';
  end if;
  select company_id into target_company from public.profiles where id=p_profile_id;
  if target_company is null or target_company<>c then raise exception 'Funcionario invalido'; end if;
  current_is_admin:=exists(select 1 from public.user_roles where profile_id=p_profile_id and role='administrador');
  requested_admin:='administrador'=any(coalesce(p_roles,array[]::public.app_role[]));
  if current_is_admin and not requested_admin and
     (select count(*) from public.user_roles where company_id=c and role='administrador')<=1 then
    raise exception 'A empresa deve manter ao menos um administrador';
  end if;
  delete from public.user_roles where profile_id=p_profile_id and company_id=c;
  insert into public.user_roles(company_id,profile_id,role)
  select c,p_profile_id,role from unnest(coalesce(p_roles,array[]::public.app_role[])) role;
end $function$;

-- reporting_summary(date,date)
CREATE OR REPLACE FUNCTION public.reporting_summary(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

-- require_table_access(text,text)
CREATE OR REPLACE FUNCTION public.require_table_access(p_resource text, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.has_table_access(p_resource, p_action) then
    raise exception 'Sem permissao para realizar esta operacao' using errcode='42501';
  end if;
end $function$;

-- reschedule_entry(uuid,date,text)
CREATE OR REPLACE FUNCTION public.reschedule_entry(p_entry_id uuid, p_new_due_date date, p_reason text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company_id UUID := public.current_company_id();
BEGIN
  PERFORM public.require_table_access('financial_entries','update');
  IF p_new_due_date IS NULL THEN RAISE EXCEPTION 'Data de vencimento obrigatória'; END IF;
  PERFORM 1 FROM public.financial_entries fe WHERE fe.id=p_entry_id AND fe.company_id=v_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
  UPDATE public.financial_entries SET due_date=p_new_due_date,updated_at=NOW() WHERE id=p_entry_id AND company_id=v_company_id;
  INSERT INTO public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
  VALUES(v_company_id,auth.uid(),'financial_entries',p_entry_id,'RESCHEDULE',jsonb_build_object('new_due_date',p_new_due_date,'reason',p_reason));
END; $function$;

-- reverse_payment(uuid,text)
CREATE OR REPLACE FUNCTION public.reverse_payment(p_payment_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.payments; e public.financial_entries; total_paid numeric; remaining numeric; part record; part_paid numeric;
begin
  perform public.require_table_access('payments','update');
  select * into p from public.payments where id=p_payment_id and company_id=public.current_company_id() for update;
  if p.id is null or p.reversed_at is not null then raise exception 'Pagamento invalido ou ja estornado'; end if;
  update public.payments set reversed_at=now(),reversed_by=auth.uid(),reversal_notes=p_notes where id=p.id;
  select * into e from public.financial_entries where id=p.financial_entry_id for update;
  select coalesce(sum(amount),0) into total_paid from public.payments where financial_entry_id=e.id and reversed_at is null;
  update public.financial_entries set paid_amount=total_paid,paid_at=null,
    status=case when total_paid=0 then 'aguardando_pagamento'::public.financial_status else 'parcialmente_pago'::public.financial_status end
  where id=e.id;
  remaining:=total_paid;
  for part in select id,amount,due_date from public.financial_installments where financial_entry_id=e.id order by installment_number loop
    part_paid:=least(part.amount,greatest(remaining,0));remaining:=remaining-part_paid;
    update public.financial_installments set paid_amount=part_paid,status=case when part_paid>=part.amount then 'paga' when part_paid>0 then 'parcial' when part.due_date<current_date then 'vencida' else 'aberta' end where id=part.id;
  end loop;
  if e.sale_id is not null then update public.sales set paid_amount=total_paid,
    financial_status=case when total_paid=0 then 'aguardando_pagamento'::public.financial_status else 'parcialmente_pago'::public.financial_status end
    where id=e.sale_id and company_id=e.company_id; end if;
  if e.purchase_order_id is not null then update public.purchase_orders set paid_amount=total_paid where id=e.purchase_order_id and company_id=e.company_id; end if;
end $function$;

-- schedule_lead_followups()
CREATE OR REPLACE FUNCTION public.schedule_lead_followups()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'aberto' THEN
    INSERT INTO public.lead_followups(company_id, lead_id, stage, scheduled_at) VALUES
      (NEW.company_id, NEW.id, '24h', NOW() + INTERVAL '24 hours'),
      (NEW.company_id, NEW.id, '72h', NOW() + INTERVAL '72 hours'),
      (NEW.company_id, NEW.id, '7d',  NOW() + INTERVAL '7 days'),
      (NEW.company_id, NEW.id, '15d', NOW() + INTERVAL '15 days'),
      (NEW.company_id, NEW.id, '30d', NOW() + INTERVAL '30 days');
  END IF;
  RETURN NEW;
END $function$;

-- seed_company_automations(uuid)
CREATE OR REPLACE FUNCTION public.seed_company_automations(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare reminder uuid; confirmation uuid; appointment uuid;
begin
  insert into public.message_templates(company_id,name,event,body) values
    (p_company_id,'Lembrete de cobrança','payment_reminder','Olá, {{cliente}}! Aqui é da {{empresa}}. Lembramos que há um valor de {{valor}} com vencimento em {{vencimento}}. Se já realizou o pagamento, desconsidere esta mensagem.'),
    (p_company_id,'Pagamento confirmado','payment_confirmation','Olá, {{cliente}}! Confirmamos o recebimento de {{valor_pago}}. Obrigado! Saldo atual: {{saldo}}.'),
    (p_company_id,'Lembrete de agendamento','appointment_reminder','Olá, {{cliente}}! Sua visita/instalação com a {{empresa}} está agendada para {{data}}. Responda CONFIRMAR para confirmar ou REAGENDAR para falar com nossa equipe.'),
    (p_company_id,'Boas-vindas do chatbot','chatbot_welcome','Olá! Sou o atendimento virtual da {{empresa}}. Digite: 1 Financeiro, 2 Agendamento, 3 Falar com atendente.')
  on conflict do nothing;
  select id into reminder from public.message_templates where company_id=p_company_id and event='payment_reminder' order by created_at limit 1;
  select id into confirmation from public.message_templates where company_id=p_company_id and event='payment_confirmation' order by created_at limit 1;
  select id into appointment from public.message_templates where company_id=p_company_id and event='appointment_reminder' order by created_at limit 1;
  insert into public.automation_rules(company_id,automation_type,template_id,enabled,days_before,send_time) values
    (p_company_id,'payment_reminder',reminder,true,1,'09:00'),
    (p_company_id,'payment_confirmation',confirmation,true,0,'09:00'),
    (p_company_id,'appointment_reminder',appointment,true,1,'09:00')
  on conflict(company_id,automation_type) do nothing;
end $function$;

-- seed_company_workflow_templates(uuid)
CREATE OR REPLACE FUNCTION public.seed_company_workflow_templates(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.message_templates(company_id, name, event, category, channel, body) values
    (p_company_id,'Boas-vindas ao lead','workflow','primeiro_contato','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 👋 Aqui é [VENDEDOR_NOME] da [EMPRESA_NOME]. Acabamos de receber seu contato e já estamos preparando as melhores opções para o seu projeto! Em breve te retorno. 😊'),
    (p_company_id,'Follow-up 24h — orçamento','workflow','pos_orcamento','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! Tudo bem? Enviei o orçamento nº [ORCAMENTO_NUMERO] (R$ [ORCAMENTO_VALOR_TOTAL]). Ficou com alguma dúvida ou quer conversar sobre o projeto? Estou à disposição! 😊'),
    (p_company_id,'Follow-up 72h — orçamento','workflow','pos_orcamento','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! [VENDEDOR_NOME] aqui da [EMPRESA_NOME]. Passaram alguns dias e queria saber se ainda está pensando no projeto. Nosso orçamento ainda está válido e posso ajustar se precisar. 🏠'),
    (p_company_id,'Orçamento aprovado — parabéns','workflow','pos_orcamento','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 🎉 Ótima notícia! Seu orçamento foi aprovado. Nossa equipe já está preparando tudo. Em breve você receberá os próximos passos. Obrigado pela confiança na [EMPRESA_NOME]!'),
    (p_company_id,'Confirmação de visita','workflow','pos_visita','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 📅 Confirmamos sua visita para [VISITA_DATA] às [VISITA_HORA]. Nossa equipe estará no local. Qualquer dúvida é só falar!'),
    (p_company_id,'Pós-instalação — satisfação','workflow','pos_venda','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! 🌟 Sua instalação foi concluída com sucesso! Como foi a experiência com nossa equipe? Sua opinião é muito importante para nós. Obrigado pela confiança na [EMPRESA_NOME]!'),
    (p_company_id,'Reativação — lead frio','workflow','reativacao','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! Tudo bem? Aqui é [VENDEDOR_NOME] da [EMPRESA_NOME]. Faz um tempinho que não conversamos e queria saber se ainda está interessado no projeto. Temos novidades e condições especiais! 🏠'),
    (p_company_id,'Cobrança amigável','workflow','cobranca','whatsapp',
     'Olá, [CLIENTE_PRIMEIRO_NOME]! Aqui é da [EMPRESA_NOME]. Passando para lembrar sobre o pagamento pendente. Qualquer dúvida estou à disposição para resolver da melhor forma. 😊')
  on conflict do nothing;

  -- Seed de workflows prontos
  insert into public.workflows(company_id, name, description, status, trigger_type, steps) values
    (p_company_id,
     '🎯 Novo lead — boas-vindas automática',
     'Envia mensagem de boas-vindas imediatamente quando um lead entra no CRM.',
     'inativo', 'lead_criado',
     '[{"id":"s1","type":"send_whatsapp","name":"Enviar boas-vindas","config":{"template":"Boas-vindas ao lead","delay_minutes":5}}]'::jsonb),
    (p_company_id,
     '📋 Orçamento enviado — follow-up automático',
     'Faz follow-up 24h e 72h após o orçamento ser enviado sem aprovação.',
     'inativo', 'orcamento_enviado',
     '[{"id":"s1","type":"wait","name":"Aguardar 24h","config":{"hours":24}},{"id":"s2","type":"send_whatsapp","name":"Follow-up 24h","config":{"template":"Follow-up 24h — orçamento","delay_minutes":0}},{"id":"s3","type":"wait","name":"Aguardar mais 72h","config":{"hours":72}},{"id":"s4","type":"send_whatsapp","name":"Follow-up 72h","config":{"template":"Follow-up 72h — orçamento","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '🎉 Orçamento aprovado — notificar operação',
     'Quando um orçamento é aprovado, notifica gerente e operação para criar o pedido.',
     'inativo', 'orcamento_aprovado',
     '[{"id":"s1","type":"notify_user","name":"Notificar gerente","config":{"message":"Orçamento aprovado! Criar pedido para o cliente.","role":"gerente"}},{"id":"s2","type":"send_whatsapp","name":"Parabéns ao cliente","config":{"template":"Orçamento aprovado — parabéns","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '✅ Instalação concluída — pós-venda',
     'Envia pesquisa de satisfação 1h após a instalação ser marcada como concluída.',
     'inativo', 'instalacao_concluida',
     '[{"id":"s1","type":"wait","name":"Aguardar 1h","config":{"hours":1}},{"id":"s2","type":"send_whatsapp","name":"Pesquisa de satisfação","config":{"template":"Pós-instalação — satisfação","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '💤 Lead frio — reativação 30 dias',
     'Reativa leads sem interação há mais de 30 dias com mensagem personalizada.',
     'inativo', 'scheduled',
     '[{"id":"s1","type":"send_whatsapp","name":"Mensagem de reativação","config":{"template":"Reativação — lead frio","delay_minutes":0}}]'::jsonb),
    (p_company_id,
     '📅 Visita agendada — confirmação',
     'Envia confirmação de visita 1 dia antes da data agendada.',
     'inativo', 'instalacao_agendada',
     '[{"id":"s1","type":"wait","name":"24h antes da visita","config":{"hours":24}},{"id":"s2","type":"send_whatsapp","name":"Confirmar visita","config":{"template":"Confirmação de visita","delay_minutes":0}}]'::jsonb)
  on conflict do nothing;
end $function$;

-- seed_default_templates(uuid)
CREATE OR REPLACE FUNCTION public.seed_default_templates(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- seed_gutter_products(uuid)
CREATE OR REPLACE FUNCTION public.seed_gutter_products(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- seed_lead_sources(uuid)
CREATE OR REPLACE FUNCTION public.seed_lead_sources(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.lead_sources(company_id,name,channel,sort_order) values
   (p_company_id,'Google','busca',10),(p_company_id,'Meta (Facebook/Instagram)','social',20),
   (p_company_id,'Indicação','indicacao',30),(p_company_id,'Arquiteto','parceiro',40),
   (p_company_id,'Engenheiro','parceiro',50),(p_company_id,'Telefone','telefone',60),
   (p_company_id,'WhatsApp','mensagem',70),(p_company_id,'Cliente recorrente','relacionamento',80),
   (p_company_id,'Visita à loja','presencial',90),(p_company_id,'Site','site',100),
   (p_company_id,'Marketplace','marketplace',110),(p_company_id,'Outros','outros',999)
  on conflict(company_id,name) do nothing;
end $function$;

-- seed_new_company_automations()
CREATE OR REPLACE FUNCTION public.seed_new_company_automations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin perform public.seed_company_automations(new.id); return new; end $function$;

-- seed_new_company_defaults()
CREATE OR REPLACE FUNCTION public.seed_new_company_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.document_templates where company_id = new.id) then
    perform public.seed_default_templates(new.id);
  end if;
  if not exists (select 1 from public.gutter_prices where company_id = new.id) then
    perform public.seed_gutter_products(new.id);
  end if;
  return new;
end $function$;

-- seed_new_company_lead_sources()
CREATE OR REPLACE FUNCTION public.seed_new_company_lead_sources()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin perform public.seed_lead_sources(new.id);return new;end $function$;

-- set_default_document_template(uuid,text)
CREATE OR REPLACE FUNCTION public.set_default_document_template(p_template_id uuid, p_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c UUID:=public.current_company_id();
BEGIN
  IF NOT public.has_role(ARRAY['administrador','gerente']::public.app_role[]) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':template:'||p_type,0));
  PERFORM 1 FROM public.document_templates WHERE id=p_template_id AND company_id=c AND type=p_type FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template não encontrado'; END IF;
  UPDATE public.document_templates SET is_default=false,status='rascunho' WHERE company_id=c AND type=p_type AND is_default;
  UPDATE public.document_templates SET is_default=true,status='em_uso' WHERE id=p_template_id AND company_id=c;
END; $function$;

-- set_updated_at()
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$;

-- sync_client_lead_source_name()
CREATE OR REPLACE FUNCTION public.sync_client_lead_source_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare source_name text;begin if new.lead_source_id is not null then select name into source_name from public.lead_sources where id=new.lead_source_id and company_id=new.company_id;if source_name is null then raise exception 'Origem de lead inválida';end if;new.lead_source:=source_name;end if;return new;end $function$;

-- sync_installation_checklist()
CREATE OR REPLACE FUNCTION public.sync_installation_checklist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists(select 1 from public.installation_checklists where installation_id=new.installation_id) and
     not exists(select 1 from public.installation_checklists where installation_id=new.installation_id and required and not completed) then
    update public.installations set status='concluida',completed_at=coalesce(completed_at,now()) where id=new.installation_id and status<>'concluida';
  elsif exists(select 1 from public.installations where id=new.installation_id and status in ('nao_agendada','agendada')) then
    update public.installations set status='em_andamento' where id=new.installation_id;
  end if;
  return new;
end $function$;

-- sync_lead_source_name()
CREATE OR REPLACE FUNCTION public.sync_lead_source_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare source_name text;begin if new.lead_source_id is not null then select name into source_name from public.lead_sources where id=new.lead_source_id and company_id=new.company_id;if source_name is null then raise exception 'Origem de lead inválida';end if;new.source:=source_name;end if;return new;end $function$;

-- sync_profile_email()
CREATE OR REPLACE FUNCTION public.sync_profile_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

-- sync_purchase_payable()
CREATE OR REPLACE FUNCTION public.sync_purchase_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.total>0 then
    insert into public.financial_entries(company_id,entry_type,origin,supplier_id,purchase_order_id,description,total_amount,due_date,status)
      values(new.company_id,'pagar','compra',new.supplier_id,new.id,'Compra '||new.order_number,new.total,coalesce(new.expected_at,current_date+30),'aguardando_pagamento')
      on conflict do nothing;
    update public.financial_entries set total_amount=new.total,supplier_id=new.supplier_id where purchase_order_id=new.id and origin='compra';
  end if; return new;
end $function$;

-- touch_quotes_updated_at()
CREATE OR REPLACE FUNCTION public.touch_quotes_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
end $function$;

-- touch_updated_at()
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ begin new.updated_at=now(); return new; end $function$;

-- trigger_workflow_event(uuid,text,jsonb)
CREATE OR REPLACE FUNCTION public.trigger_workflow_event(p_company_id uuid, p_trigger_type text, p_trigger_data jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare matched integer := 0; w record;
begin
  for w in
    select id, jsonb_array_length(steps) as step_count
    from public.workflows
    where company_id = p_company_id
      and status = 'ativo'
      and trigger_type = p_trigger_type
  loop
    insert into public.workflow_executions(
      company_id, workflow_id, trigger_type, trigger_data, steps_total
    ) values (
      p_company_id, w.id, p_trigger_type, p_trigger_data, w.step_count
    );
    update public.workflows
      set runs_count = runs_count + 1, last_run_at = now(), updated_at = now()
      where id = w.id;
    matched := matched + 1;
  end loop;
  return matched;
end $function$;

-- update_gutter_quote(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.update_gutter_quote(p_quote_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c uuid := public.current_company_id();
  q public.quotes;
  gutter_id uuid;
  subtotal_value numeric := 0;
begin
  perform public.require_table_access('quotes','update');
  select * into q from public.quotes where id=p_quote_id and company_id=c for update;
  if q.id is null then raise exception 'Orcamento nao encontrado'; end if;
  if q.status='aprovado' then raise exception 'Orcamento aprovado nao pode ser editado'; end if;
  if not exists(select 1 from public.clients where id=(p_payload->>'client_id')::uuid and company_id=c) then raise exception 'Cliente invalido'; end if;

  if jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0
     and jsonb_array_length(coalesce(p_payload->'special_items','[]'::jsonb))=0 then
    raise exception 'Informe ao menos um item';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'meters','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
       or coalesce(nullif(item->>'install_price','')::numeric,0) < 0
  ) then
    raise exception 'Item invalido';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    where coalesce(nullif(item->>'quantity','')::numeric,0) <= 0
       or coalesce(nullif(item->>'unit_price','')::numeric,0) < 0
  ) then
    raise exception 'Item complementar invalido';
  end if;

  select
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'meters','')::numeric,0)
        * (
          coalesce(nullif(item->>'unit_price','')::numeric,0)
          + coalesce(nullif(item->>'install_price','')::numeric,0)
        )
      )
      from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item
    ),0)
    +
    coalesce((
      select sum(
        coalesce(nullif(item->>'quantity','')::numeric,0)
        * coalesce(nullif(item->>'unit_price','')::numeric,0)
      )
      from jsonb_array_elements(coalesce(p_payload->'special_items','[]'::jsonb)) item
    ),0)
  into subtotal_value;

  if subtotal_value <= 0 then raise exception 'Total do orcamento deve ser positivo'; end if;

  select id into gutter_id from public.gutter_quotes where quote_id=q.id;
  if gutter_id is null then
    insert into public.gutter_quotes(company_id,quote_id) values(c,q.id) returning id into gutter_id;
  end if;

  delete from public.gutter_quote_items where gutter_quote_id=gutter_id;
  delete from public.quote_items where quote_id=q.id;

  update public.quotes set
    client_id=(p_payload->>'client_id')::uuid,
    subtotal=subtotal_value,
    discount=coalesce(nullif(p_payload->>'discount','')::numeric,0),
    freight=coalesce(nullif(p_payload->>'freight','')::numeric,0),
    notes=p_payload->>'notes',
    valid_until=nullif(p_payload->>'valid_until','')::date,
    installation_deadline=nullif(p_payload->>'installation_deadline',''),
    hide_unit_prices=coalesce(nullif(p_payload->>'hide_unit_prices','')::boolean,false),
    updated_at=now()
  where id=q.id;

  insert into public.gutter_quote_items(company_id,gutter_quote_id,category,item_type,product,thickness,cut,color,unit,quantity,meters,unit_price,install_price)
  select
    c,
    gutter_id,
    coalesce(nullif(item->>'category',''), public.gutter_catalog_category(item->>'product')),
    'fabricacao',
    item->>'product',
    item->>'thickness',
    item->>'cut',
    nullif(item->>'color',''),
    'Metro Linear (m)',
    (item->>'quantity')::numeric,
    (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0),
    coalesce(nullif(item->>'install_price','')::numeric,0)
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,requires_purchase,requires_production,item_type)
  select
    c,
    q.id,
    item->>'product',
    concat_ws(' | ', nullif(item->>'category',''), nullif(item->>'thickness',''), nullif(item->>'cut',''), nullif(item->>'color','')),
    'm',
    (item->>'quantity')::numeric * (item->>'meters')::numeric,
    coalesce(nullif(item->>'unit_price','')::numeric,0) + coalesce(nullif(item->>'install_price','')::numeric,0),
    true,
    true,
    'calha'
  from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;

  return q.id;
end;
$function$;

-- validate_user_role_company()
CREATE OR REPLACE FUNCTION public.validate_user_role_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare profile_company uuid;
begin
  select company_id into profile_company from public.profiles where id=new.profile_id;
  if profile_company is null or profile_company<>new.company_id then
    raise exception 'Perfil nao pertence a empresa informada';
  end if;
  return new;
end $function$;

-- Permissoes das funcoes que podiam nao existir (009/023/035).
revoke all on function public.create_manual_sale_unchecked(jsonb) from public, anon, authenticated;
revoke all on function public.create_manual_purchase_unchecked(jsonb) from public, anon, authenticated;
revoke all on function public.create_manual_sale(jsonb) from public, anon;
revoke all on function public.create_manual_purchase(jsonb) from public, anon;
grant execute on function public.create_manual_sale(jsonb) to authenticated;
grant execute on function public.create_manual_purchase(jsonb) to authenticated;
revoke all on function public.gutter_quote_item_unit(text, text) from public, anon;
grant execute on function public.gutter_quote_item_unit(text, text) to authenticated;

-- ─── triggers ────────────────────────────────────────────────────────────────
drop trigger if exists trg_aluminum_matrix_updated on aluminum_price_matrix;
CREATE TRIGGER trg_aluminum_matrix_updated BEFORE UPDATE ON public.aluminum_price_matrix FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists clients_lead_source_name on clients;
CREATE TRIGGER clients_lead_source_name BEFORE INSERT OR UPDATE OF lead_source_id ON public.clients FOR EACH ROW EXECUTE FUNCTION sync_client_lead_source_name();
drop trigger if exists clients_touch on clients;
CREATE TRIGGER clients_touch BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists companies_seed_defaults on companies;
CREATE TRIGGER companies_seed_defaults AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION seed_new_company_defaults();
drop trigger if exists companies_touch on companies;
CREATE TRIGGER companies_touch BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists company_ai_config_seed on companies;
CREATE TRIGGER company_ai_config_seed AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION on_new_company_ai_config();
drop trigger if exists company_automation_defaults on companies;
CREATE TRIGGER company_automation_defaults AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION seed_new_company_automations();
drop trigger if exists company_lead_source_defaults on companies;
CREATE TRIGGER company_lead_source_defaults AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION seed_new_company_lead_sources();
drop trigger if exists company_workflow_seed on companies;
CREATE TRIGGER company_workflow_seed AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION on_new_company_workflows();
drop trigger if exists trg_document_templates_updated on document_templates;
CREATE TRIGGER trg_document_templates_updated BEFORE UPDATE ON public.document_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists financial_entries_touch on financial_entries;
CREATE TRIGGER financial_entries_touch BEFORE UPDATE ON public.financial_entries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists gutter_prices_audit on gutter_prices;
CREATE TRIGGER gutter_prices_audit AFTER INSERT OR DELETE OR UPDATE ON public.gutter_prices FOR EACH ROW EXECUTE FUNCTION log_pricing_audit();
drop trigger if exists trg_gutter_prices_updated on gutter_prices;
CREATE TRIGGER trg_gutter_prices_updated BEFORE UPDATE ON public.gutter_prices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists installation_checklist_progress on installation_checklists;
CREATE TRIGGER installation_checklist_progress AFTER UPDATE OF completed ON public.installation_checklists FOR EACH ROW EXECUTE FUNCTION sync_installation_checklist();
drop trigger if exists installation_completed on installations;
CREATE TRIGGER installation_completed AFTER UPDATE OF status ON public.installations FOR EACH ROW EXECUTE FUNCTION complete_installation();
drop trigger if exists installation_completion_guard on installations;
CREATE TRIGGER installation_completion_guard BEFORE UPDATE OF status ON public.installations FOR EACH ROW EXECUTE FUNCTION guard_installation_completion();
drop trigger if exists installation_default_checklist on installations;
CREATE TRIGGER installation_default_checklist AFTER INSERT ON public.installations FOR EACH ROW EXECUTE FUNCTION create_default_installation_checklist();
drop trigger if exists wf_installation_done on installations;
CREATE TRIGGER wf_installation_done AFTER UPDATE ON public.installations FOR EACH ROW EXECUTE FUNCTION on_installation_done_workflow();
drop trigger if exists leads_source_name on leads;
CREATE TRIGGER leads_source_name BEFORE INSERT OR UPDATE OF lead_source_id ON public.leads FOR EACH ROW EXECUTE FUNCTION sync_lead_source_name();
drop trigger if exists leads_touch on leads;
CREATE TRIGGER leads_touch BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists trg_cancel_followups on leads;
CREATE TRIGGER trg_cancel_followups AFTER UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION cancel_lead_followups();
drop trigger if exists trg_lead_followups on leads;
CREATE TRIGGER trg_lead_followups AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION schedule_lead_followups();
drop trigger if exists wf_lead_created on leads;
CREATE TRIGGER wf_lead_created AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION on_lead_created_workflow();
drop trigger if exists checklist_completion on order_checklist_items;
CREATE TRIGGER checklist_completion AFTER UPDATE OF status ON public.order_checklist_items FOR EACH ROW EXECUTE FUNCTION check_order_completion();
drop trigger if exists orders_touch on orders;
CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists trg_auto_checklist_on_order on orders;
CREATE TRIGGER trg_auto_checklist_on_order AFTER UPDATE OF operational_status ON public.orders FOR EACH ROW EXECUTE FUNCTION auto_create_installation_checklist();
drop trigger if exists trg_auto_order_checklist on orders;
CREATE TRIGGER trg_auto_order_checklist AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION auto_order_checklist();
drop trigger if exists payment_confirmation_queue on payments;
CREATE TRIGGER payment_confirmation_queue AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION queue_payment_confirmation();
drop trigger if exists pricing_commercial_tables_audit on pricing_commercial_tables;
CREATE TRIGGER pricing_commercial_tables_audit AFTER INSERT OR DELETE OR UPDATE ON public.pricing_commercial_tables FOR EACH ROW EXECUTE FUNCTION log_pricing_audit();
drop trigger if exists pricing_commercial_tables_log on pricing_commercial_tables;
CREATE TRIGGER pricing_commercial_tables_log AFTER INSERT OR DELETE OR UPDATE ON public.pricing_commercial_tables FOR EACH ROW EXECUTE FUNCTION log_pricing_change();
drop trigger if exists pricing_paints_audit on pricing_paints;
CREATE TRIGGER pricing_paints_audit AFTER INSERT OR DELETE OR UPDATE ON public.pricing_paints FOR EACH ROW EXECUTE FUNCTION log_pricing_audit();
drop trigger if exists pricing_paints_log on pricing_paints;
CREATE TRIGGER pricing_paints_log AFTER INSERT OR DELETE OR UPDATE ON public.pricing_paints FOR EACH ROW EXECUTE FUNCTION log_pricing_change();
drop trigger if exists pricing_services_audit on pricing_services;
CREATE TRIGGER pricing_services_audit AFTER INSERT OR DELETE OR UPDATE ON public.pricing_services FOR EACH ROW EXECUTE FUNCTION log_pricing_audit();
drop trigger if exists pricing_services_log on pricing_services;
CREATE TRIGGER pricing_services_log AFTER INSERT OR DELETE OR UPDATE ON public.pricing_services FOR EACH ROW EXECUTE FUNCTION log_pricing_change();
drop trigger if exists pricing_special_parts_audit on pricing_special_parts;
CREATE TRIGGER pricing_special_parts_audit AFTER INSERT OR DELETE OR UPDATE ON public.pricing_special_parts FOR EACH ROW EXECUTE FUNCTION log_pricing_audit();
drop trigger if exists pricing_special_parts_log on pricing_special_parts;
CREATE TRIGGER pricing_special_parts_log AFTER INSERT OR DELETE OR UPDATE ON public.pricing_special_parts FOR EACH ROW EXECUTE FUNCTION log_pricing_change();
drop trigger if exists profiles_touch on profiles;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists purchase_orders_touch on purchase_orders;
CREATE TRIGGER purchase_orders_touch BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists purchase_payable on purchase_orders;
CREATE TRIGGER purchase_payable AFTER INSERT OR UPDATE OF total, supplier_id ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION sync_purchase_payable();
drop trigger if exists quote_item_totals on quote_items;
CREATE TRIGGER quote_item_totals AFTER INSERT OR DELETE OR UPDATE ON public.quote_items FOR EACH ROW EXECUTE FUNCTION recalculate_quote();
drop trigger if exists quotes_touch on quotes;
CREATE TRIGGER quotes_touch BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION touch_quotes_updated_at();
drop trigger if exists wf_quote_status on quotes;
CREATE TRIGGER wf_quote_status AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION on_quote_changed_workflow();
drop trigger if exists sales_touch on sales;
CREATE TRIGGER sales_touch BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists suppliers_touch on suppliers;
CREATE TRIGGER suppliers_touch BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
drop trigger if exists user_roles_company_guard on user_roles;
CREATE TRIGGER user_roles_company_guard BEFORE INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION validate_user_role_company();

commit;
