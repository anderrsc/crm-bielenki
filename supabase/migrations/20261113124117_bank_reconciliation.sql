begin;
-- Imported facts are immutable. Importing never creates or changes payments.
create unique index if not exists bank_account_company_key on public.receiving_accounts(id,company_id);
create unique index if not exists bank_payment_company_key on public.payments(id,company_id);
create table if not exists public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), account_id uuid not null,
  filename text not null check(length(filename) between 1 and 180), content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
  payload_checksum text not null, format text not null check(format in ('OFX','CSV')), row_count integer not null check(row_count between 1 and 2000),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  unique(company_id,account_id,content_hash), unique(id,company_id,account_id),
  foreign key(account_id,company_id) references public.receiving_accounts(id,company_id)
);
create table if not exists public.bank_account_sources (
  account_id uuid primary key, company_id uuid not null references public.companies(id), source_key text not null check(source_key~'^[a-f0-9]{64}$'),
  account_hint text check(length(account_hint)<=80), created_at timestamptz not null default now(),
  unique(company_id,source_key), foreign key(account_id,company_id) references public.receiving_accounts(id,company_id)
);
create table if not exists public.bank_statement_rows (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), account_id uuid not null, import_id uuid not null,
  external_id text not null check(length(btrim(external_id)) between 1 and 255), posted_at date not null check(posted_at between date '1900-01-01' and date '2100-12-31'),
  amount numeric(14,2) not null check(amount<>0 and amount between -999999999999.99 and 999999999999.99),
  description text not null check(length(btrim(description)) between 1 and 500),
  status text not null default 'pending' check(status in ('pending','matched','ignored')),
  payment_id uuid, generated_payment_id uuid, generated_kind text check(generated_kind in ('fee','settle')),
  note text check(length(note)<=1000), matched_by uuid references public.profiles(id), matched_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,account_id,external_id), unique(company_id,payment_id),
  check((status='matched')=(payment_id is not null)), check((generated_payment_id is null)=(generated_kind is null)),
  foreign key(import_id,company_id,account_id) references public.bank_statement_imports(id,company_id,account_id),
  foreign key(account_id,company_id) references public.receiving_accounts(id,company_id),
  foreign key(payment_id,company_id) references public.payments(id,company_id),
  foreign key(generated_payment_id,company_id) references public.payments(id,company_id)
);
create index if not exists bank_rows_page_idx on public.bank_statement_rows(company_id,account_id,status,posted_at desc,id);
create index if not exists bank_rows_duplicate_idx on public.bank_statement_rows(company_id,account_id,posted_at,amount);
create index if not exists bank_rows_import_idx on public.bank_statement_rows(import_id);
create index if not exists bank_rows_generated_payment_idx on public.bank_statement_rows(generated_payment_id);
create index if not exists bank_import_actor_idx on public.bank_statement_imports(created_by);
create index if not exists bank_rows_actor_idx on public.bank_statement_rows(matched_by);

insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete)
  select r,'bank_reconciliation',r::text in ('administrador','gerente','financeiro'),r::text in ('administrador','gerente','financeiro'),r::text in ('administrador','gerente','financeiro'),false
  from unnest(enum_range(null::public.app_role)) r on conflict(role,resource) do nothing;
do $$ declare t text; begin
  foreach t in array array['bank_statement_imports','bank_statement_rows','bank_account_sources'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists bank_read on public.%I',t);
    execute format('create policy bank_read on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and (select public.has_table_access(''bank_reconciliation'',''select'')) and exists(select 1 from public.profiles where id=(select auth.uid()) and status=''ativo''))',t);
  end loop;
end $$;

create or replace function crm_private.bank_context(p_action text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=public.current_company_id();
begin
  if auth.uid() is null or c is null or not exists(select 1 from public.profiles where id=auth.uid() and company_id=c and status='ativo')
     or not public.has_table_access('bank_reconciliation','select') or not public.has_table_access('bank_reconciliation',p_action) then raise exception 'Sem permissao para conciliacao bancaria' using errcode='42501'; end if;
  return c;
end $$;
revoke all on function crm_private.bank_context(text) from public,anon;
grant usage on schema crm_private to authenticated;
grant execute on function crm_private.bank_context(text) to authenticated;

create or replace function crm_private.import_bank_statement(p_account uuid,p_filename text,p_hash text,p_format text,p_rows jsonb,p_source_key text default null,p_hint text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.bank_context('insert'); imp public.bank_statement_imports; previous public.bank_statement_rows;
  item jsonb; added integer:=0; repeated integer:=0; d date; a numeric; external text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'Importe de 1 a 2000 movimentacoes'; end if;
  if p_filename is null or length(p_filename) not between 1 and 180 or p_hash is null or p_hash!~'^[a-f0-9]{64}$' or p_format is null or p_format not in ('OFX','CSV') then raise exception 'Arquivo invalido'; end if;
  perform 1 from public.receiving_accounts where id=p_account and company_id=c and active for update;
  if not found then raise exception 'Conta indisponivel'; end if;
  if p_source_key is not null then
    if p_source_key!~'^[a-f0-9]{64}$' or length(coalesce(p_hint,''))>80 then raise exception 'Identificacao bancaria invalida'; end if;
    if exists(select 1 from public.bank_account_sources where company_id=c and (account_id=p_account and source_key<>p_source_key or source_key=p_source_key and account_id<>p_account)) then
      raise exception 'Este OFX pertence a outra conta. Confira a conta selecionada';
    end if;
    insert into public.bank_account_sources(account_id,company_id,source_key,account_hint) values(p_account,c,p_source_key,p_hint) on conflict(account_id) do nothing;
  end if;
  insert into public.bank_statement_imports(company_id,account_id,filename,content_hash,payload_checksum,format,row_count,created_by)
    values(c,p_account,p_filename,p_hash,md5(p_rows::text),p_format,jsonb_array_length(p_rows),auth.uid()) on conflict(company_id,account_id,content_hash) do nothing;
  select * into imp from public.bank_statement_imports where company_id=c and account_id=p_account and content_hash=p_hash;
  if imp.payload_checksum<>md5(p_rows::text) then raise exception 'Conteudo diferente para um arquivo ja importado'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    external:=btrim(item->>'external_id');
    if external is null or length(external) not between 1 and 255 or coalesce(item->>'posted_at','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or coalesce(item->>'amount','')!~'^-?[0-9]{1,12}(\.[0-9]{1,2})?$' or length(btrim(coalesce(item->>'description',''))) not between 1 and 500 then raise exception 'Movimentacao invalida'; end if;
    d:=(item->>'posted_at')::date; a:=(item->>'amount')::numeric;
    select * into previous from public.bank_statement_rows where company_id=c and account_id=p_account and external_id=external;
    if found then
      if previous.posted_at<>d or previous.amount<>a then raise exception 'Identificador ja importado com data ou valor diferente'; end if;
      repeated:=repeated+1;
    else
      insert into public.bank_statement_rows(company_id,account_id,import_id,external_id,posted_at,amount,description)
        values(c,p_account,imp.id,external,d,a,btrim(item->>'description'));
      added:=added+1;
    end if;
  end loop;
  if added>0 then
    insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,new_data)
      values(c,auth.uid(),'bank_statement_imports',imp.id,'IMPORT',jsonb_build_object('account_id',p_account,'new_rows',added,'existing_rows',repeated,'format',p_format));
  end if;
  return jsonb_build_object('import_id',imp.id,'new_rows',added,'existing_rows',repeated);
end $$;
revoke all on function crm_private.import_bank_statement(uuid,text,text,text,jsonb,text,text) from public,anon;
grant execute on function crm_private.import_bank_statement(uuid,text,text,text,jsonb,text,text) to authenticated;
create or replace function public.import_bank_statement(p_account uuid,p_filename text,p_hash text,p_format text,p_rows jsonb,p_source_key text default null,p_hint text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select crm_private.import_bank_statement(p_account,p_filename,p_hash,p_format,p_rows,p_source_key,p_hint) $$;
revoke all on function public.import_bank_statement(uuid,text,text,text,jsonb,text,text) from public,anon;
grant execute on function public.import_bank_statement(uuid,text,text,text,jsonb,text,text) to authenticated;

create or replace function crm_private.audit_bank_reconciliation() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_table_schema<>'public' or tg_table_name<>'bank_statement_rows' then raise exception 'Unsupported audit target'; end if;
  if (to_jsonb(new)-'updated_at') is not distinct from (to_jsonb(old)-'updated_at') then return new; end if;
  insert into public.audit_logs(company_id,profile_id,table_name,record_id,action,old_data,new_data)
    values(new.company_id,auth.uid(),'bank_statement_rows',new.id,'RECONCILE',to_jsonb(old),to_jsonb(new));
  return new;
end $$;
revoke all on function crm_private.audit_bank_reconciliation() from public,anon,authenticated;
drop trigger if exists bank_rows_audit on public.bank_statement_rows;
create trigger bank_rows_audit after update on public.bank_statement_rows for each row execute function crm_private.audit_bank_reconciliation();

-- Reconciliation is metadata unless the user explicitly chooses settle/fee.
-- Account lock serializes duplicate checks. NOWAIT avoids cycles with payment reversal.
create or replace function crm_private.reconcile_bank_row(p_row uuid,p_mode text,p_target uuid default null,p_note text default null,p_category uuid default null,p_distinct boolean default false)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.bank_context('update'); r public.bank_statement_rows; payment public.payments; entry public.financial_entries;
  account uuid; pid uuid; entry_id uuid; v_note text:=btrim(coalesce(p_note,''));
begin
  if p_mode is null or p_mode not in ('match','settle','fee','undo','ignore') or length(v_note) not between 3 and 1000 then raise exception 'Informe a acao e uma justificativa de 3 a 1000 caracteres'; end if;
  select account_id into account from public.bank_statement_rows where id=p_row and company_id=c;
  if account is null then raise exception 'Movimentacao nao encontrada'; end if;
  perform 1 from public.receiving_accounts where id=account and company_id=c for update;
  select * into r from public.bank_statement_rows where id=p_row and company_id=c for update;
  if p_mode='undo' then
    update public.bank_statement_rows set status='pending',payment_id=null,matched_at=null,matched_by=null,note=v_note,updated_at=now() where id=r.id;
    return null;
  end if;
  if p_mode='ignore' then
    if r.status='matched' then raise exception 'Desvincule a baixa antes de ignorar a movimentacao'; end if;
    update public.bank_statement_rows set status='ignored',note=v_note,updated_at=now() where id=r.id;
    return null;
  end if;
  if not public.has_table_access('financial_entries','update') or not public.has_table_access('payments','select') then raise exception 'Sem permissao financeira para conciliar baixas' using errcode='42501'; end if;
  if r.posted_at>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Movimentacao futura deve aguardar a data do extrato'; end if;
  if r.status='ignored' then raise exception 'Reabra a movimentacao antes de conciliar'; end if;
  if r.status='matched' then
    select * into payment from public.payments where id=r.payment_id and company_id=c;
    if (p_mode='match' and p_target=r.payment_id) or (p_mode='settle' and p_target=payment.financial_entry_id and r.generated_kind='settle') or (p_mode='fee' and r.generated_kind='fee') then return r.payment_id; end if;
    raise exception 'Movimentacao ja conciliada. Desvincule antes de alterar';
  end if;
  if p_mode='match' then
    select * into payment from public.payments where id=p_target and company_id=c for update nowait;
    if payment.id is null or payment.reversed_at is not null then raise exception 'Baixa indisponivel'; end if;
    select * into entry from public.financial_entries where id=payment.financial_entry_id and company_id=c;
    if entry.id is null or payment.amount<>abs(r.amount) or (entry.entry_type::text='receber')<>(r.amount>0) then raise exception 'Valor ou tipo da baixa nao corresponde ao extrato'; end if;
    if payment.receiving_account_id is not null and payment.receiving_account_id<>r.account_id then raise exception 'Baixa pertence a outra conta'; end if;
    if exists(select 1 from public.bank_statement_rows where company_id=c and payment_id=payment.id and id<>r.id) then raise exception 'Baixa ja conciliada em outra movimentacao'; end if;
    if payment.receiving_account_id is null then
      if not public.has_table_access('payments','update') then raise exception 'Sem permissao para informar a conta da baixa' using errcode='42501'; end if;
      update public.payments set receiving_account_id=r.account_id where id=payment.id;
    end if;
    pid:=payment.id;
  else
    if not public.has_table_access('payments','insert') then raise exception 'Sem permissao para registrar baixas' using errcode='42501'; end if;
    if exists(select 1 from public.payments where id=r.generated_payment_id and company_id=c and reversed_at is null) then raise exception 'Ja existe uma baixa gerada. Associe a baixa existente ou estorne antes de gerar outra'; end if;
    if exists(select 1 from public.bank_statement_rows where company_id=c and account_id=r.account_id and id<>r.id and posted_at=r.posted_at and amount=r.amount and status='matched')
       and (not coalesce(p_distinct,false) or length(v_note)<10) then raise exception 'Possivel duplicidade: confirme que e outra movimentacao e justifique com pelo menos 10 caracteres'; end if;
    if p_mode='fee' then
      if r.amount>=0 or not public.has_table_access('financial_entries','insert') then raise exception 'Taxas exigem saida bancaria e permissao para cadastrar despesas'; end if;
      if not exists(select 1 from public.financial_categories where id=p_category and company_id=c and active and entry_type::text='pagar') then raise exception 'Selecione uma categoria ativa de despesa'; end if;
      if r.generated_kind='fee' then
        select e.id into entry_id from public.payments p join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
          where p.id=r.generated_payment_id and p.company_id=c and e.status::text<>'cancelado';
        if entry_id is not null and not exists(select 1 from public.financial_entries where id=entry_id and company_id=c and category_id=p_category and total_amount=abs(r.amount)) then
          raise exception 'A despesa anterior ja existe. Confira e de baixa na conta existente';
        end if;
      end if;
      if entry_id is null then
        insert into public.financial_entries(company_id,entry_type,origin,description,total_amount,due_date,competence_date,category_id,notes)
          values(c,'pagar','despesa','Taxa bancaria: '||left(r.description,180),abs(r.amount),r.posted_at,r.posted_at,p_category,v_note) returning id into entry_id;
      end if;
    else
      entry_id:=p_target;
    end if;
    select * into entry from public.financial_entries where id=entry_id and company_id=c for update nowait;
    if entry.id is null or entry.status::text='cancelado' or (entry.entry_type::text='receber')<>(r.amount>0) or entry.open_amount<abs(r.amount) then raise exception 'Conta indisponivel, tipo incorreto ou valor superior ao saldo'; end if;
    pid:=public.register_payment_with_adjustment(entry.id,abs(r.amount),r.posted_at,'transferencia',v_note,entry.interest_amount,entry.discount_amount,entry.installment_count,coalesce(entry.first_installment_due_date,entry.due_date,r.posted_at));
    update public.payments set receiving_account_id=r.account_id where id=pid and company_id=c;
  end if;
  update public.bank_statement_rows set status='matched',payment_id=pid,matched_by=auth.uid(),matched_at=now(),note=v_note,updated_at=now(),
    generated_payment_id=case when p_mode in ('fee','settle') then pid else generated_payment_id end,
    generated_kind=case when p_mode in ('fee','settle') then p_mode else generated_kind end where id=r.id;
  return pid;
exception when lock_not_available then raise exception 'Lancamento em uso por outra operacao. Tente novamente';
end $$;
revoke all on function crm_private.reconcile_bank_row(uuid,text,uuid,text,uuid,boolean) from public,anon;
grant execute on function crm_private.reconcile_bank_row(uuid,text,uuid,text,uuid,boolean) to authenticated;
create or replace function public.reconcile_bank_row(p_row uuid,p_mode text,p_target uuid default null,p_note text default null,p_category uuid default null,p_distinct boolean default false)
returns uuid language sql security invoker set search_path=pg_catalog as $$ select crm_private.reconcile_bank_row(p_row,p_mode,p_target,p_note,p_category,p_distinct) $$;
revoke all on function public.reconcile_bank_row(uuid,text,uuid,text,uuid,boolean) from public,anon;
grant execute on function public.reconcile_bank_row(uuid,text,uuid,text,uuid,boolean) to authenticated;

create or replace function public.bank_reconciliation_candidates(p_row uuid,p_window integer default 7,p_query text default null)
returns table(payment_id uuid,description text,amount numeric,paid_at date,account_id uuid)
language sql stable security invoker set search_path=pg_catalog,public as $$
  select p.id,e.description,p.amount,p.paid_at,p.receiving_account_id
  from public.bank_statement_rows r join public.payments p on p.company_id=r.company_id and p.amount=abs(r.amount) and p.reversed_at is null
  join public.financial_entries e on e.id=p.financial_entry_id and e.company_id=p.company_id
  where r.id=p_row and r.company_id=crm_private.bank_context('select') and r.status='pending'
    and (e.entry_type::text='receber')=(r.amount>0) and (p.receiving_account_id is null or p.receiving_account_id=r.account_id)
    and p.paid_at between r.posted_at-least(greatest(coalesce(p_window,7),1),90) and r.posted_at+least(greatest(coalesce(p_window,7),1),90)
    and (nullif(btrim(p_query),'') is null or e.description ilike '%'||left(p_query,80)||'%')
    and not exists(select 1 from public.bank_statement_rows b where b.company_id=r.company_id and b.payment_id=p.id)
  order by abs(p.paid_at-r.posted_at),p.paid_at,p.id limit 20;
$$;
revoke all on function public.bank_reconciliation_candidates(uuid,integer,text) from public,anon;
grant execute on function public.bank_reconciliation_candidates(uuid,integer,text) to authenticated;

create or replace function crm_private.bank_reconciliation_history(p_row uuid,p_before bigint default null)
returns table(id bigint,occurred_at timestamptz,actor text,old_status text,new_status text,payment_id text,note text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c uuid:=crm_private.bank_context('select');
begin
  if not exists(select 1 from public.bank_statement_rows where bank_statement_rows.id=p_row and company_id=c) then raise exception 'Movimentacao nao encontrada'; end if;
  return query select a.id,a.created_at,p.full_name,a.old_data->>'status',a.new_data->>'status',a.new_data->>'payment_id',a.new_data->>'note'
    from public.audit_logs a left join public.profiles p on p.id=a.profile_id and p.company_id=a.company_id
    where a.company_id=c and a.table_name='bank_statement_rows' and a.record_id=p_row and (p_before is null or a.id<p_before)
    order by a.id desc limit 50;
end $$;
revoke all on function crm_private.bank_reconciliation_history(uuid,bigint) from public,anon;
grant execute on function crm_private.bank_reconciliation_history(uuid,bigint) to authenticated;
create or replace function public.bank_reconciliation_history(p_row uuid,p_before bigint default null)
returns table(id bigint,occurred_at timestamptz,actor text,old_status text,new_status text,payment_id text,note text)
language sql stable security invoker set search_path=pg_catalog as $$ select * from crm_private.bank_reconciliation_history(p_row,p_before) $$;
revoke all on function public.bank_reconciliation_history(uuid,bigint) from public,anon;
grant execute on function public.bank_reconciliation_history(uuid,bigint) to authenticated;

create or replace function crm_private.invalidate_bank_payment_match() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.reversed_at is not null or new.amount is distinct from old.amount or new.financial_entry_id is distinct from old.financial_entry_id or new.paid_at is distinct from old.paid_at or new.receiving_account_id is distinct from old.receiving_account_id then
    update public.bank_statement_rows set status='pending',payment_id=null,matched_by=null,matched_at=null,updated_at=now(),note='Baixa alterada ou estornada; conferir novamente.' where company_id=new.company_id and payment_id=new.id;
  end if;
  return new;
end $$;
revoke all on function crm_private.invalidate_bank_payment_match() from public,anon,authenticated;
drop trigger if exists bank_payment_match_invalidate on public.payments;
create trigger bank_payment_match_invalidate after update of reversed_at,amount,financial_entry_id,paid_at,receiving_account_id on public.payments for each row execute function crm_private.invalidate_bank_payment_match();
commit;
