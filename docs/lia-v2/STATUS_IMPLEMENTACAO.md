# LIA V2 — Status da Implementação

**Data:** 2026-11-25  
**Branch:** `claude/lia-v2-motor-central`  
**Base:** Pacote `LIA_BIELENKI_V2_COMPLETO.zip` — 19 blocos, 973 IDs, status `reconstrucao_parcial_nao_publicavel`

---

## O que foi implementado nesta sessão

### 1. Banco de dados (`supabase/migrations/20261125000000_lia_v2_motor_completo.sql`)
- Novos campos em `lia_rules`: `rule_number`, `block_id`, `autonomy_level`, `risk_level`, `approver_role`, `financial_limit`, `scope_json`, `validation_status`, `revision`
- Tabela `lia_knowledge_blocks`: 19 blocos de conhecimento por empresa, upsert, RLS
- Tabela `lia_action_requests`: fila de aprovações com alçadas, validade, payload_hash
- Tabela `lia_audit_events`: registro imutável (sem UPDATE/DELETE para autenticados)
- Função `crm_private.seed_lia_v2(company_id)`: importa 19 blocos + reserva 973 IDs com `is_active=false, validation_status='pending'`
- Executada automaticamente para todas as empresas existentes

### 2. Tipos (`lib/ai/lia-types.ts`)
- `AutonomyLevel`: auto | approval | human_only | forbidden
- `RiskLevel`: low | medium | high | critical
- `ValidationStatus`: pending | validated | needs_review | archived
- `LiaRuleRow`, `LiaKnowledgeBlockRow`, `LiaActionRequestRow`, `LiaAuditRow`
- `BLOCKS[]`: mapa dos 19 blocos com ranges

### 3. Server actions (`app/(crm)/lia-central-actions.ts`)
- `listLiaRules()` — lista todas as regras da empresa
- `toggleLiaRule(id, active)` — liga/desliga regra (gerente/admin)
- `updateRuleAutonomy(id, autonomy, risk)` — define nível de autonomia
- `listKnowledgeBlocks()` — lista blocos de conhecimento
- `updateKnowledgeBlock(id, content)` — edita bloco (gerente/admin)
- `listActionRequests(status?)` — lista pedidos de aprovação
- `decideActionRequest(id, decision, reason?)` — aprova ou rejeita
- `listAuditEvents(limit)` — lista eventos de auditoria
- Todas inserem em `lia_audit_events` para rastreabilidade

### 4. Carregamento de dados (`lib/ai/lia-v2-data.ts`)
- `loadLiaV2Data(db, companyId)` — carrega regras, blocos, pedidos e auditoria em paralelo
- Retorna `LiaV2Data` com stats (total, active, pending, pendingApprovals, blocks)

### 5. Componentes UI
- `components/lia-rules-manager.tsx` — 19 categorias expansíveis, 973 regras, busca, toggles, seletor de autonomia/risco
- `components/lia-knowledge-panel.tsx` — 19 blocos editáveis com histórico de versão
- `components/lia-approvals-queue.tsx` — fila de aprovações com aprovar/rejeitar + motivo
- `components/lia-audit-log.tsx` — log imutável de eventos
- `components/ai-central.tsx` — atualizado com 5 abas: Central | Regras | Conhecimento | Aprovações | Auditoria
- `app/forms.css` — novos estilos `.lia-section-*`, `.lia-rule-*`, `.lia-switch-on/off`

### 6. Rota (`app/(crm)/[[...path]]/page.tsx`)
- `/central-ia` agora carrega `loadCentralData` + `loadLiaV2Data` em paralelo
- Passa `v2` prop para `AiCentral`

---

## Restrições vigentes (PROMPT MASTER)

> Nenhuma regra é ativada automaticamente. Todas começam com `is_active=false, validation_status='pending'`.  
> Deploy em produção somente com aprovação expressa do gestor.  
> Dados reais de clientes não são usados em testes sem anonimização.  
> As validações determinísticas do servidor não podem ser contornadas.  
> O motor não envia mensagens reais nem altera dados de produção sem confirmação real da API.

---

## Lacunas documentadas (LACUNAS.md do pacote)

- **Prazo de esquadrias**: "30 dias" mencionado — unidade não especificada (dias úteis? corridos?). Regras 81–130 estão como `pending`.
- **Exceções de entrada**: condições de exceção dos 50% de entrada não totalmente especificadas.
- **Escopos setoriais**: interseção de permissões entre setores precisa de validação individual.
- **Aprovação de emergência**: fluxo não detalhado no pacote.
- **Regras de retry**: política de retry não especificada formalmente.

---

## Próximas etapas (não implementadas)

1. **Motor de políticas operacional**: avaliação de regras em tempo real durante atendimento (orquestrador → motor → aprovação → executor → auditoria)
2. **Simulador WhatsApp**: ambiente fictício para testar regras antes de ativar
3. **Editor de prompt versionado**: interface para editar e publicar o prompt operacional da LIA com controle de versão
4. **Integração operacional**: conectar os módulos (orçamentos, agenda, pagamentos) às alçadas definidas nas regras
5. **Validação individual das 973 regras**: cada regra precisa ser lida, confirmada e ativada pelo gestor
6. **Regras com `validation_status = 'validated'`**: nenhuma regra é validada automaticamente — requer revisão humana

---

## Como aplicar a migration em produção

```bash
# Somente após aprovação expressa do gestor
supabase db push
# ou via painel Supabase: SQL Editor → executar o arquivo
```

**Nunca executar em produção sem aprovação.**
