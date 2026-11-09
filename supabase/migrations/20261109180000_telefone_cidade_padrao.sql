-- Telefone sempre "(47) 98835-8243" (sem o 55 do WhatsApp) e "Jaraguá" sempre "Jaraguá do Sul".
create or replace function public.br_phone_display(v text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(v,''), '\D', '', 'g');
begin
  if d = '' then return nullif(trim(coalesce(v,'')), ''); end if;
  if length(d) >= 12 and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) = 10 and substr(d, 3, 1) in ('6','7','8','9') then d := left(d, 2) || '9' || substr(d, 3); end if;
  if length(d) = 11 then return '(' || left(d, 2) || ') ' || substr(d, 3, 5) || '-' || substr(d, 8); end if;
  if length(d) = 10 then return '(' || left(d, 2) || ') ' || substr(d, 3, 4) || '-' || substr(d, 7); end if;
  return trim(v);
end $$;

create or replace function public.br_city(v text) returns text language plpgsql immutable as $$
declare k text := regexp_replace(translate(lower(trim(coalesce(v,''))), 'áàâãäéêëíïóôõöúüç', 'aaaaaeeeiiooooouuc'), '\s+', ' ', 'g');
begin
  if k in ('jaragua', 'jaragua do sul', 'jaragua sul', 'jgs', 'jaragua do sul sc', 'jaragua sc', 'jaragua - sc', 'jaragua do sul - sc') then return 'Jaraguá do Sul'; end if;
  return nullif(trim(coalesce(v,'')), '');
end $$;

create or replace function public.clients_normalize_contact() returns trigger language plpgsql as $$
begin
  new.phone := public.br_phone_display(new.phone);
  new.whatsapp := public.br_phone_display(new.whatsapp);
  new.city := public.br_city(new.city);
  if new.city = 'Jaraguá do Sul' and coalesce(new.state, '') = '' then new.state := 'SC'; end if;
  return new;
end $$;
drop trigger if exists clients_normalize_contact on public.clients;
create trigger clients_normalize_contact before insert or update of phone, whatsapp, city, state on public.clients
  for each row execute function public.clients_normalize_contact();

create or replace function public.leads_normalize_phone() returns trigger language plpgsql as $$
begin new.phone := public.br_phone_display(new.phone); return new; end $$;
drop trigger if exists leads_normalize_phone on public.leads;
create trigger leads_normalize_phone before insert or update of phone on public.leads
  for each row execute function public.leads_normalize_phone();

-- Corrige o que já está cadastrado.
update public.clients set phone = phone
  where phone is distinct from public.br_phone_display(phone) or whatsapp is distinct from public.br_phone_display(whatsapp)
     or city is distinct from public.br_city(city) or (public.br_city(city) = 'Jaraguá do Sul' and coalesce(state,'') = '');
update public.leads set phone = phone where phone is distinct from public.br_phone_display(phone);
