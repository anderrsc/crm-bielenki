-- LIA V2 — Ativa 1 regra de diretriz por categoria (rule_number = range_start de cada bloco).
-- Conteúdo vem dos blocos já importados em lia_knowledge_blocks.
-- As outras 954 regras permanecem como is_active=false para validação futura.
begin;

update public.lia_rules r
set
  title            = 'Diretriz: ' || kb.category,
  name             = 'diretriz_' || kb.block_number,
  description      = kb.content,
  is_active        = true,
  validation_status = 'validated',
  autonomy_level   = case kb.block_number
    -- Informacional/operacional básico → automático
    when 1  then 'auto'   -- Identidade
    when 2  then 'auto'   -- Empresa
    when 3  then 'auto'   -- Calhas
    when 4  then 'auto'   -- Esquadrias
    when 5  then 'auto'   -- Triagem
    when 6  then 'auto'   -- Multimídia
    when 15 then 'auto'   -- WhatsApp (operacional)
    -- Comercial / financeiro → aprovação obrigatória
    when 7  then 'approval'  -- Orçamentos
    when 8  then 'approval'  -- Negociação
    when 9  then 'approval'  -- Agenda
    when 10 then 'approval'  -- Pagamentos
    when 11 then 'approval'  -- Contratos
    when 12 then 'approval'  -- Produção
    when 13 then 'approval'  -- Pós-venda
    when 14 then 'approval'  -- Follow-up
    when 16 then 'approval'  -- Integração CRM
    -- Governança / segurança → somente humano
    when 17 then 'human_only'  -- Segurança
    when 18 then 'human_only'  -- Autonomia
    when 19 then 'human_only'  -- Painel
    else 'approval'
  end,
  risk_level       = case kb.block_number
    when 1  then 'low'
    when 2  then 'low'
    when 3  then 'low'
    when 4  then 'low'
    when 5  then 'low'
    when 6  then 'low'
    when 7  then 'medium'
    when 8  then 'medium'
    when 9  then 'medium'
    when 10 then 'high'
    when 11 then 'high'
    when 12 then 'medium'
    when 13 then 'medium'
    when 14 then 'low'
    when 15 then 'low'
    when 16 then 'medium'
    when 17 then 'high'
    when 18 then 'critical'
    when 19 then 'critical'
    else 'medium'
  end,
  updated_at       = now()
from public.lia_knowledge_blocks kb
where r.company_id      = kb.company_id
  and r.block_id        = kb.block_number
  and r.rule_number     = kb.rule_range_start;  -- somente o primeiro ID de cada bloco

commit;
