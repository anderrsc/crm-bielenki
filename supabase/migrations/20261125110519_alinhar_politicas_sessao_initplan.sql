-- Mesmas permissões; avalia a identidade da sessão uma vez por consulta.
begin;
alter policy lia_requests_update on public.lia_action_requests
  using (company_id = (select public.current_company_id()) and (
    requested_by = (select auth.uid())
    or (select public.has_role(array['administrador','gerente']::public.app_role[]))
  ));
alter policy lia_sessions_own on public.lia_chat_sessions
  using (company_id = (select public.current_company_id()) and user_id = (select auth.uid()))
  with check (company_id = (select public.current_company_id()) and user_id = (select auth.uid()));
commit;
