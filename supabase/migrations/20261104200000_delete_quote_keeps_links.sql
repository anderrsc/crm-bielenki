-- Excluir orçamento: medições, eventos da agenda e arquivos que apontavam
-- para o orçamento ficam, só sem o vínculo (antes a exclusão falhava por
-- causa dessas ligações). Orçamento aprovado continua bloqueado: reverta a
-- aprovação primeiro. Pode ser rodada mais de uma vez.
create or replace function public.delete_draft_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare q public.quotes;
begin
  perform public.require_table_access('quotes', 'delete');
  select * into q from public.quotes where id = p_quote_id and company_id = public.current_company_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado'; end if;
  if q.status = 'aprovado' then
    raise exception 'Este orçamento está aprovado. Use "Reverter aprovação" antes de excluir.';
  end if;
  update public.measurements set quote_id = null where quote_id = q.id;
  update public.operational_events set quote_id = null where quote_id = q.id;
  update public.files set quote_id = null where quote_id = q.id;
  delete from public.quotes where id = q.id;
end $function$;

revoke all on function public.delete_draft_quote(uuid) from public, anon;
grant execute on function public.delete_draft_quote(uuid) to authenticated, service_role;
