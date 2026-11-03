alter policy profiles_company_select on public.profiles
  to authenticated
  using (
    company_id = (select public.current_company_id())
    and (
      id = (select auth.uid())
      or (select public.has_table_access('profiles', 'select'))
    )
  );
