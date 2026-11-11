-- Atomic inbound counters and a generation token invalidate obsolete AI replies.
alter table public.conversations add column if not exists ai_generation_id uuid;
create or replace function public.inbox_receive(p_id uuid, p_company uuid, p_at timestamptz, p_preview text, p_generation uuid, p_historical boolean default false)
returns void language sql security invoker set search_path = public as $$
 update public.conversations set
 last_message_preview = case when last_message_at is null or p_at >= last_message_at then p_preview else last_message_preview end,
 last_message_at = greatest(last_message_at,p_at), last_inbound_at = greatest(last_inbound_at,p_at),
 unread_count = unread_count + case when p_historical then 0 else 1 end,
 ai_generation_id = p_generation, updated_at = now()
 where id=p_id and company_id=p_company;
$$;
revoke all on function public.inbox_receive(uuid,uuid,timestamptz,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.inbox_receive(uuid,uuid,timestamptz,text,uuid,boolean) to service_role;
-- Existing RLS remains the authorization boundary for realtime.
do $$ declare t text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach t in array array['messages','conversations','clients'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
    execute format('alter publication supabase_realtime add table public.%I',t);
   end if;
  end loop;
 end if;
end $$;
