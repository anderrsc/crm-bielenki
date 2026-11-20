-- Fotos nas etapas de produção (Fase 3 — Automatização Completa dos Pedidos)
-- Permite registrar fotos de corte, dobra, conferência e acabamento por etapa.

create table if not exists public.production_step_photos (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 production_order_id uuid not null references public.production_orders(id) on delete cascade,
 step_number integer not null,
 photo_url text not null,
 caption text,
 uploaded_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);

-- Índices para consulta eficiente
create index if not exists idx_production_step_photos_order
 on public.production_step_photos(company_id, production_order_id, step_number);
create index if not exists idx_production_step_photos_uploaded_by
 on public.production_step_photos(uploaded_by);

-- RLS: isolamento por empresa
alter table public.production_step_photos enable row level security;

drop policy if exists production_step_photos_select on public.production_step_photos;
create policy production_step_photos_select on public.production_step_photos
 for select to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('production_orders', 'select'));

drop policy if exists production_step_photos_insert on public.production_step_photos;
create policy production_step_photos_insert on public.production_step_photos
 for insert to authenticated
 with check (company_id = public.current_company_id() and public.has_table_access('production_orders', 'update'));

drop policy if exists production_step_photos_delete on public.production_step_photos;
create policy production_step_photos_delete on public.production_step_photos
 for delete to authenticated
 using (company_id = public.current_company_id() and public.has_table_access('production_orders', 'update'));

-- Função para adicionar foto a uma etapa de produção
create or replace function public.add_production_step_photo(
 p_production_order_id uuid,
 p_step_number integer,
 p_photo_url text,
 p_caption text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
 v_company_id uuid;
 v_photo_id uuid;
begin
 -- Valida permissão e obtém company_id
 select po.company_id into v_company_id
 from production_orders po
 where po.id = p_production_order_id
 and po.company_id = public.current_company_id();

 if v_company_id is null then
 raise exception 'Ordem de produção não encontrada ou sem permissão' using errcode = '42501';
 end if;

 -- Valida que a etapa existe nos logs
 if not exists(
 select 1 from production_step_logs psl
 where psl.production_order_id = p_production_order_id
 and psl.step_number = p_step_number
 ) then
 raise exception 'Etapa % não encontrada na ordem de produção', p_step_number;
 end if;

 -- Insere a foto
 insert into production_step_photos (company_id, production_order_id, step_number, photo_url, caption, uploaded_by)
 values (v_company_id, p_production_order_id, p_step_number, p_photo_url, nullif(btrim(coalesce(p_caption, '')), ''), auth.uid())
 returning id into v_photo_id;

 -- Registra auditoria
 insert into audit_logs (company_id, profile_id, table_name, record_id, action, new_data)
 values (v_company_id, auth.uid(), 'production_step_photos', v_photo_id, 'INSERT',
 jsonb_build_object('step_number', p_step_number, 'photo_url', p_photo_url, 'caption', p_caption));

 return v_photo_id;
end;
$$;

revoke all on function public.add_production_step_photo(uuid, integer, text, text) from public, anon;
grant execute on function public.add_production_step_photo(uuid, integer, text, text) to authenticated;

-- View consolidada de fotos por etapa para o frontend
create or replace view public.v_production_step_photos with (security_invoker=true) as
select
 psp.id,
 psp.company_id,
 psp.production_order_id,
 psp.step_number,
 psl.step_name,
 psp.photo_url,
 psp.caption,
 p.full_name as uploaded_by_name,
 psp.created_at
from production_step_photos psp
left join production_step_logs psl on psl.production_order_id = psp.production_order_id and psl.step_number = psp.step_number
left join profiles p on p.id = psp.uploaded_by
order by psp.production_order_id, psp.step_number, psp.created_at;