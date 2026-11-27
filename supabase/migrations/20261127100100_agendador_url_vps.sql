-- Produção agora na VPS: o agendador do Supabase passa a chamar o CRM lá (antes caía na Vercel pausada).
-- Só troca se estiver vazio ou ainda na Vercel/Railway; pode rodar mais de uma vez.
update public.crm_operations_config
   set site_url = 'https://crm.178-92-204-54.sslip.io'
 where id
   and (site_url is null or btrim(site_url) = '' or site_url ilike '%vercel.app%' or site_url ilike '%railway.app%');
