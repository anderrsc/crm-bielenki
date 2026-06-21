-- Origens configuráveis para clientes e oportunidades comerciais.
create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  channel text not null default 'outros',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,name)
);
alter table public.clients add column if not exists lead_source_id uuid references public.lead_sources(id);
alter table public.leads add column if not exists lead_source_id uuid references public.lead_sources(id);
create index clients_lead_source_idx on public.clients(company_id,lead_source_id);
create index leads_lead_source_idx on public.leads(company_id,lead_source_id);

alter table public.lead_sources enable row level security;
create policy lead_sources_read on public.lead_sources for select to authenticated
using(company_id=public.current_company_id() and public.has_table_access('lead_sources','select'));
create policy lead_sources_create on public.lead_sources for insert to authenticated
with check(company_id=public.current_company_id() and public.has_table_access('lead_sources','insert'));
create policy lead_sources_update on public.lead_sources for update to authenticated
using(company_id=public.current_company_id() and public.has_table_access('lead_sources','update')) with check(company_id=public.current_company_id());
create policy lead_sources_delete on public.lead_sources for delete to authenticated
using(company_id=public.current_company_id() and public.has_table_access('lead_sources','delete'));

insert into public.permissions(role,resource,can_view,can_create,can_update,can_delete) values
 ('vendedor','lead_sources',true,false,false,false),('compras','lead_sources',false,false,false,false),
 ('producao','lead_sources',false,false,false,false),('estoque','lead_sources',false,false,false,false),
 ('instalador','lead_sources',false,false,false,false),('financeiro','lead_sources',true,false,false,false),
 ('atendente','lead_sources',true,false,false,false)
on conflict(role,resource) do update set can_view=excluded.can_view,can_create=excluded.can_create,can_update=excluded.can_update,can_delete=excluded.can_delete;

create or replace function public.seed_lead_sources(p_company_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.lead_sources(company_id,name,channel,sort_order) values
   (p_company_id,'Google','busca',10),(p_company_id,'Meta (Facebook/Instagram)','social',20),
   (p_company_id,'Indicação','indicacao',30),(p_company_id,'Arquiteto','parceiro',40),
   (p_company_id,'Engenheiro','parceiro',50),(p_company_id,'Telefone','telefone',60),
   (p_company_id,'WhatsApp','mensagem',70),(p_company_id,'Cliente recorrente','relacionamento',80),
   (p_company_id,'Visita à loja','presencial',90),(p_company_id,'Site','site',100),
   (p_company_id,'Marketplace','marketplace',110),(p_company_id,'Outros','outros',999)
  on conflict(company_id,name) do nothing;
end $$;
do $$ declare c uuid; begin for c in select id from public.companies loop perform public.seed_lead_sources(c); end loop; end $$;

create or replace function public.seed_new_company_lead_sources() returns trigger
language plpgsql security definer set search_path=public as $$ begin perform public.seed_lead_sources(new.id);return new;end $$;
create trigger company_lead_source_defaults after insert on public.companies for each row execute function public.seed_new_company_lead_sources();

update public.clients c set lead_source_id=s.id from public.lead_sources s where s.company_id=c.company_id and lower(s.name)=lower(c.lead_source) and c.lead_source_id is null;
update public.leads l set lead_source_id=s.id from public.lead_sources s where s.company_id=l.company_id and lower(s.name)=lower(l.source) and l.lead_source_id is null;

create or replace function public.sync_client_lead_source_name() returns trigger
language plpgsql security definer set search_path=public as $$ declare source_name text;begin if new.lead_source_id is not null then select name into source_name from public.lead_sources where id=new.lead_source_id and company_id=new.company_id;if source_name is null then raise exception 'Origem de lead inválida';end if;new.lead_source:=source_name;end if;return new;end $$;
create trigger clients_lead_source_name before insert or update of lead_source_id on public.clients for each row execute function public.sync_client_lead_source_name();

create or replace function public.sync_lead_source_name() returns trigger
language plpgsql security definer set search_path=public as $$ declare source_name text;begin if new.lead_source_id is not null then select name into source_name from public.lead_sources where id=new.lead_source_id and company_id=new.company_id;if source_name is null then raise exception 'Origem de lead inválida';end if;new.source:=source_name;end if;return new;end $$;
create trigger leads_source_name before insert or update of lead_source_id on public.leads for each row execute function public.sync_lead_source_name();
