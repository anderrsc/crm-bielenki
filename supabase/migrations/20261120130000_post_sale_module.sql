-- Módulo de Pós-Venda Estruturado (Fase 3 — Automatização Completa dos Pedidos)
-- Registra avaliações, problemas, retornos e follow-ups após instalação/conclusão do pedido.

create table if not exists public.post_sales (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 order_id uuid not null references public.orders(id) on delete cascade,
 sale_id uuid references public.sales(id) on delete set null,
 client_id uuid not null references public.clients(id),
 type text not null check(type in ('avaliacao','problema','retorno_garantia','retorno_fora_garantia','follow_up')),
 status text not null default 'aberto' check(status in ('aberto','em_andamento','resolvido','cancelado')),
 priority text not null default 'normal' check(priority in ('baixa','normal','alta','urgente')),
 title text not null,
 description text,
 rating integer check(rating is null or (rating >= 1 and rating <= 5)),
 assigned_to uuid references public.profiles(id),
 resolved_at timestamptz,
 resolved_by uuid references public.profiles(id),
 resolution_notes text,
 scheduled_followup_at timestamptz,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

-- Fotos anexadas ao pós-venda (antes/depois, evidências de problema)
create table if not exists public.post_sale_photos (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 post_sale_id uuid not null references public.post_sales(id) on delete cascade,
 photo_url text not null,
 caption text,
 uploaded_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);

-- Histórico de interações do pós-venda (notas internas, mensagens, mudanças de status)
create table if not exists public.post_sale_history (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 post_sale_id uuid not null references public.post_sales(id) on delete cascade,
 action text not null,
 old_value text,
 new_value text,
 notes text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);

-- Índices
create index if not exists idx_post_sales_company_status on public.post_sales(company_id, status, created_at desc);
create index if not exists idx_post_sales_order on public.post_sales(order_id);
create index if not exists idx_post_sales_client on public.post_sales(client_id);
create index if not exists idx_post_sales_assigned on public.post_sales(assigned_to) where assigned_to is not null;
create index if not exists idx_post_sales_scheduled on public.post_sales(scheduled_followup_at) where scheduled_followup_at is not null and status = 'aberto';
create index if not exists idx_post_sale_photos_post on public.post_sale_photos(post_sale_id);
create index if not exists idx_post_sale_history_post on public.post_sale_history(post_sale_id, created_at desc);

-- Trigger de updated_at
create or replace trigger post_sales_touch_updated_at
 before update on public.post_sales
 for each row execute function public.touch_updated_at();

-- RLS: post_sales
alter table public.post_sales enable row level security;
drop policy if exists post_sales_select on public.post_sales;
drop policy if exists post_sales_select on public.post_sales;
create policy post_sales_select on public.post_sales for select to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('orders', 'select'));
drop policy if exists post_sales_insert on public.post_sales;
drop policy if exists post_sales_insert on public.post_sales;
create policy post_sales_insert on public.post_sales for insert to authenticated
 with check (company_id = public.current_company_id() and public.has_table_access('orders', 'update'));
drop policy if exists post_sales_update on public.post_sales;
drop policy if exists post_sales_update on public.post_sales;
create policy post_sales_update on public.post_sales for update to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('orders', 'update'))
 with check (company_id = public.current_company_id());

-- RLS: post_sale_photos
alter table public.post_sale_photos enable row level security;
drop policy if exists post_sale_photos_select on public.post_sale_photos;
drop policy if exists post_sale_photos_select on public.post_sale_photos;
create policy post_sale_photos_select on public.post_sale_photos for select to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('orders', 'select'));
drop policy if exists post_sale_photos_insert on public.post_sale_photos;
drop policy if exists post_sale_photos_insert on public.post_sale_photos;
create policy post_sale_photos_insert on public.post_sale_photos for insert to authenticated
 with check (company_id = public.current_company_id() and public.has_table_access('orders', 'update'));
drop policy if exists post_sale_photos_delete on public.post_sale_photos;
drop policy if exists post_sale_photos_delete on public.post_sale_photos;
create policy post_sale_photos_delete on public.post_sale_photos for delete to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('orders', 'update'));

-- RLS: post_sale_history
alter table public.post_sale_history enable row level security;
drop policy if exists post_sale_history_select on public.post_sale_history;
drop policy if exists post_sale_history_select on public.post_sale_history;
create policy post_sale_history_select on public.post_sale_history for select to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('orders', 'select'));
drop policy if exists post_sale_history_insert on public.post_sale_history;
drop policy if exists post_sale_history_insert on public.post_sale_history;
create policy post_sale_history_insert on public.post_sale_history for insert to authenticated
 with check (company_id = public.current_company_id() and public.has_table_access('orders', 'update'));

-- Função: criar pós-venda automaticamente ao concluir instalação
create or replace function public.create_post_sale_from_installation(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
 v_company_id uuid;
 v_client_id uuid;
 v_sale_id uuid;
 v_post_sale_id uuid;
begin
 select o.company_id, o.client_id, o.sale_id
 into v_company_id, v_client_id, v_sale_id
 from orders o
 where o.id = p_order_id and o.company_id = public.current_company_id();

 if v_company_id is null then
 raise exception 'Pedido não encontrado ou sem permissão' using errcode = '42501';
 end if;

 -- Verifica se já existe pós-venda aberto para este pedido
 if exists(select 1 from post_sales where order_id = p_order_id and status in ('aberto', 'em_andamento')) then
 return null; -- já existe, não duplica
 end if;

 insert into post_sales (company_id, order_id, sale_id, client_id, type, status, priority, title, created_by)
 values (v_company_id, p_order_id, v_sale_id, v_client_id, 'follow_up', 'aberto', 'normal',
 'Acompanhamento pós-instalação', auth.uid())
 returning id into v_post_sale_id;

 -- Registra no histórico
 insert into post_sale_history (company_id, post_sale_id, action, new_value, created_by)
 values (v_company_id, v_post_sale_id, 'CRIADO_AUTOMATICO', 'follow_up', auth.uid());

 return v_post_sale_id;
end;
$$;

revoke all on function public.create_post_sale_from_installation(uuid) from public, anon;
grant execute on function public.create_post_sale_from_installation(uuid) to authenticated;

-- Função: resolver pós-venda
create or replace function public.resolve_post_sale(
 p_post_sale_id uuid,
 p_resolution_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
 v_company_id uuid;
 v_old_status text;
begin
 select ps.company_id, ps.status into v_company_id, v_old_status
 from post_sales ps
 where ps.id = p_post_sale_id and ps.company_id = public.current_company_id()
 for update;

 if v_company_id is null then
 raise exception 'Pós-venda não encontrado ou sem permissão' using errcode = '42501';
 end if;

 if v_old_status = 'resolvido' then return; end if; -- já resolvido

 update post_sales
 set status = 'resolvido', resolved_at = now(), resolved_by = auth.uid(),
 resolution_notes = nullif(btrim(coalesce(p_resolution_notes, '')), '')
 where id = p_post_sale_id;

 insert into post_sale_history (company_id, post_sale_id, action, old_value, new_value, notes, created_by)
 values (v_company_id, p_post_sale_id, 'RESOLVIDO', v_old_status, 'resolvido', p_resolution_notes, auth.uid());
end;
$$;

revoke all on function public.resolve_post_sale(uuid, text) from public, anon;
grant execute on function public.resolve_post_sale(uuid, text) to authenticated;

-- View consolidada para dashboard de pós-venda
create or replace view public.v_post_sales_dashboard with (security_invoker=true) as
select
 ps.company_id,
 count(*) filter (where ps.status = 'aberto') as open_count,
 count(*) filter (where ps.status = 'em_andamento') as in_progress_count,
 count(*) filter (where ps.status = 'resolvido' and ps.resolved_at > now() - interval '30 days') as resolved_last_30d,
 count(*) filter (where ps.type = 'problema' and ps.status != 'resolvido') as open_problems,
 count(*) filter (where ps.type = 'avaliacao' and ps.rating is not null and ps.created_at > now() - interval '30 days') as ratings_last_30d,
 round(avg(ps.rating) filter (where ps.rating is not null and ps.created_at > now() - interval '90 days'), 2) as avg_rating_90d,
 count(*) filter (where ps.scheduled_followup_at is not null and ps.scheduled_followup_at <= now() and ps.status = 'aberto') as overdue_followups
from post_sales ps
group by ps.company_id;