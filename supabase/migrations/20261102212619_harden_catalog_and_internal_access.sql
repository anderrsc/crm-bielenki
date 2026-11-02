-- The two reports must use the caller's row-level security policies.
alter view public.v_workflow_analytics set (security_invoker=true);
alter view public.v_installation_checklist_alerts set (security_invoker=true);
revoke all on public.v_workflow_analytics,public.v_installation_checklist_alerts from public,anon;
grant select on public.v_workflow_analytics,public.v_installation_checklist_alerts to authenticated,service_role;

-- These unchecked implementations are only used by their checked DEFINER
-- wrappers (not directly by any application route).
revoke execute on function public.approve_quote_unchecked(uuid,date) from public,anon,authenticated;
revoke execute on function public.create_gutter_quote_unchecked(jsonb) from public,anon,authenticated;
grant execute on function public.approve_quote_unchecked(uuid,date),public.create_gutter_quote_unchecked(jsonb) to service_role;

-- Fix only the seven functions reported with a mutable search path.
alter function public.touch_updated_at() set search_path=public,pg_temp;
alter function public.render_message(text,jsonb) set search_path=public,pg_temp;
alter function public.sync_profile_email() set search_path=public,pg_temp;
alter function public.set_updated_at() set search_path=public,pg_temp;
alter function public.touch_quotes_updated_at() set search_path=public,pg_temp;
alter function public.gutter_catalog_category(text) set search_path=public,pg_temp;
alter function public.gutter_catalog_item_type(text) set search_path=public,pg_temp;
