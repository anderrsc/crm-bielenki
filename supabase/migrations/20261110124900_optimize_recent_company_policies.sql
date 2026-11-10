-- Mantém as mesmas regras por empresa; calcula a empresa da sessão uma vez
-- por consulta, seguindo a otimização já usada nas demais políticas.
-- Corrige também o teste de desempenho RLS das funcionalidades recentes.
alter policy quick_replies_rls on public.quick_replies
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

alter policy receiving_accounts_rls on public.receiving_accounts
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
