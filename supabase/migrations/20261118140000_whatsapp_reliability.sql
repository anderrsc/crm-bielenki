begin;
-- Fase 1 (confiabilidade do WhatsApp), tudo aditivo:
-- 1) Envio da equipe com chave de idempotencia: a mensagem e gravada ANTES de ir ao
--    provedor ("enviando"); duplo clique/reenvio com a mesma chave nao manda duas vezes;
--    timeout vira "desconhecido" (nao se reenvia as cegas).
alter table public.messages add column if not exists client_ref uuid;
create unique index if not exists messages_company_client_ref_key on public.messages(company_id, client_ref) where client_ref is not null;

-- 2) Resposta da Lia: reserva atomica da geracao antes de enviar. So um processo envia
--    por mensagem do cliente, e nada sai se a equipe assumiu, a Lia foi pausada/desligada,
--    o contato virou cliente ou chegou mensagem nova (geracao trocada).
create or replace function public.claim_ai_reply(p_conversation uuid, p_company uuid, p_generation uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare claimed uuid;
begin
  if p_generation is null then return false; end if;
  if not exists(select 1 from public.ai_agent_config where company_id = p_company and active is true) then return false; end if;
  update public.conversations set ai_generation_id = null
    where id = p_conversation and company_id = p_company and ai_generation_id = p_generation
      and coalesce(ai_paused, false) = false and client_id is null
    returning id into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_ai_reply(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_reply(uuid,uuid,uuid) to service_role;

-- 3) Marca da ultima reconciliacao automatica (independe de alguem abrir o Atendimento).
alter table public.ai_agent_config add column if not exists inbox_reconciled_at timestamptz;
commit;
