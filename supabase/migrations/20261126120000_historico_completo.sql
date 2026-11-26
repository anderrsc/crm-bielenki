-- Histórico completo: toda criação, alteração e remoção nos cadastros e operações do CRM fica
-- registrada em audit_logs com quem fez, quando e o que mudou (antes → depois).
-- Aditiva e pode ser rodada mais de uma vez. Nunca trava a gravação original: se o registro do
-- histórico falhar, a operação do usuário segue normalmente.
begin;
set local client_min_messages = warning;

alter table public.audit_logs add column if not exists summary text;
comment on column public.audit_logs.summary is 'Nome legível do registro (cliente, número do orçamento, descrição...) para busca no Histórico.';
alter table public.audit_logs add column if not exists automatic boolean not null default false;
comment on column public.audit_logs.automatic is 'Registro gravado pelo histórico automático. Quando a própria função já registrou a operação (mais detalhada), o automático da mesma transação não é mantido.';
create index if not exists audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);
create index if not exists audit_logs_record_idx on public.audit_logs (table_name, record_id);

create or replace function crm_private.audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  ignored text[] := array['updated_at','last_seen_at','last_activity_at','last_sign_in_at','search_vector','search_text'];
  k text; v jsonb;
  od jsonb := '{}'; nd jsonb := '{}';
  who uuid; company uuid; rid uuid; label text;
begin
  begin
    company := nullif(r->>'company_id','')::uuid;
    if company is null then return null; end if;

    if tg_op = 'UPDATE' then
      for k in select jsonb_object_keys(n) loop
        if k = any(ignored) then continue; end if;
        if (o->k) is distinct from (n->k) then
          od := od || jsonb_build_object(k, o->k);
          nd := nd || jsonb_build_object(k, n->k);
        end if;
      end loop;
      if nd = '{}'::jsonb then return null; end if;
      o := od; n := nd;
    end if;

    -- Segredos nunca vão para o histórico; textos muito longos ficam resumidos.
    for k, v in select * from jsonb_each(coalesce(o,'{}') || coalesce(n,'{}')) loop
      if k ~* '(secret|token|password|senha|api_key|apikey)' then
        if o ? k then o := o || jsonb_build_object(k, '[oculto]'); end if;
        if n ? k then n := n || jsonb_build_object(k, '[oculto]'); end if;
      elsif jsonb_typeof(v) = 'string' and length(v #>> '{}') > 1500 then
        if o ? k and length(o->>k) > 1500 then o := o || jsonb_build_object(k, left(o->>k, 300) || '…'); end if;
        if n ? k and length(n->>k) > 1500 then n := n || jsonb_build_object(k, left(n->>k, 300) || '…'); end if;
      end if;
    end loop;

    -- Quem fez: o usuário logado; em ações feitas pelo servidor, quem a linha diz que fez.
    who := auth.uid();
    if who is null then
      who := coalesce(nullif(r->>'updated_by','')::uuid, nullif(r->>'created_by','')::uuid, nullif(r->>'requested_by','')::uuid);
    end if;
    if who is not null and not exists (select 1 from public.profiles p where p.id = who) then who := null; end if;

    if (r->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then rid := (r->>'id')::uuid; end if;
    label := left(coalesce(
      nullif(r->>'quote_number',''), nullif(r->>'order_number',''), nullif(r->>'number',''),
      nullif(r->>'full_name',''), nullif(r->>'name',''), nullif(r->>'title',''),
      nullif(r->>'description',''), nullif(r->>'code',''), nullif(r->>'phone','')), 160);

    -- A função do sistema já registrou esta operação nesta mesma transação: não duplica.
    if rid is not null and exists (select 1 from public.audit_logs a where a.table_name = tg_table_name and a.record_id = rid
                                   and a.created_at = now() and not a.automatic) then return null; end if;
    insert into public.audit_logs(company_id, profile_id, table_name, record_id, action, old_data, new_data, summary, automatic)
    values (company, who, tg_table_name, rid, tg_op, o, n, label, true);
  exception when others then
    raise warning 'histórico não registrado (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

revoke all on function crm_private.audit_change() from public;

-- Registro feito pela função do sistema depois da alteração: substitui o automático da mesma transação.
create or replace function crm_private.audit_dedupe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.automatic and new.record_id is not null then
    delete from public.audit_logs a where a.automatic and a.table_name = new.table_name and a.record_id = new.record_id and a.created_at = now();
  end if;
  return null;
end $$;
revoke all on function crm_private.audit_dedupe() from public;
drop trigger if exists audit_logs_dedupe on public.audit_logs;
create trigger audit_logs_dedupe after insert on public.audit_logs for each row execute function crm_private.audit_dedupe();

do $$
declare t text;
begin
  foreach t in array array[
    'activities','ai_lia_rules','aluminum_price_matrix','automation_rules',
    'bank_statement_imports','checklist_template_items','checklist_templates','client_types','clients',
    'commissions','conversation_labels','discount_rules','document_templates','files',
    'financial_categories','financial_cost_centers','financial_entries','financial_entry_allocations',
    'financial_installments','financial_recurrences','followups','gutter_quote_items','gutter_quotes',
    'installation_checklists','installations','lead_sources','leads','lia_command_phones',
    'lia_knowledge_blocks','lia_prompt_versions','lia_rules','material_categories','materials',
    'measurement_checklists','measurement_items','measurements','message_templates',
    'order_checklist_items','order_checklists','order_consumables','order_items',
    'order_labor_costs','order_measure_checks','orders','payment_receipts','payments','pipeline_stages',
    'pix_charges','post_sale_photos','post_sales','production_materials','production_order_items',
    'production_orders','production_step_photos','profiles','purchase_order_items','purchase_orders',
    'purchase_request_items','purchase_requests','purchase_returns','quick_replies',
    'quote_internal_attachments','quote_items','quotes','receiving_accounts','sale_items','sale_types',
    'sales','service_orders','service_photos','stock_locations','stock_movements','supplier_categories',
    'supplier_credits','suppliers','tasks','user_roles','work_day_jobs',
    'work_day_members','work_days','work_team_members','work_teams','work_vehicles','workflows'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    -- Tabelas que já gravam o registro completo por conta própria não duplicam.
    if exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and not g.tgisinternal
               and g.tgfoid in ('public.log_pricing_audit'::regproc)) then continue; end if;
    execute format('drop trigger if exists zz_historico on public.%I', t);
    execute format('create trigger zz_historico after insert or update or delete on public.%I for each row execute function crm_private.audit_change()', t);
  end loop;
end $$;

commit;
