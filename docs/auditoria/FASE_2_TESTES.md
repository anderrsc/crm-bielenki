# Fase 2 — Tarefa 2.1: Inventário e Auditoria dos Testes Existentes

**Data:** 19/11/2026
**Status:** ✅ Concluída
**Total de arquivos de teste:** 95

---

## 1. Inventário Completo por Módulo

### 1.1 WhatsApp / Atendimento (22 arquivos) ✅ Cobertura Alta
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `whatsapp-webhook.test.ts` | Unitário | Webhook do WhatsApp |
| `whatsapp-connection-history.test.ts` | Unitário | Histórico de conexão (Fase 1) |
| `whatsapp-webhook-connection-events.test.ts` | Unitário | Eventos connection.update no webhook (Fase 1) |
| `whatsapp-disconnection-alerts.test.ts` | Unitário | Alertas automáticos de desconexão (Fase 1) |
| `whatsapp-watchdog.test.ts` | Unitário | Vigia de conexão zumbi |
| `whatsapp-vigia-db.test.ts` | Banco | Vigia com banco real |
| `whatsapp-channels-db.test.ts` | Banco | Canais WhatsApp com banco real |
| `whatsapp-reliability-db.test.ts` | Banco | Confiabilidade do WhatsApp |
| `whatsapp-etiquetas-db.test.ts` | Banco | Etiquetas de conversas |
| `whatsapp-read.test.ts` | Unitário | Leitura de mensagens |
| `whatsapp-phone.test.ts` | Unitário | Validação de telefone |
| `whatsapp-attachments.test.ts` | Unitário | Anexos de mensagens |
| `evolution.test.ts` | Unitário | Evolution API |
| `evolution-history.test.ts` | Unitário | Reconciliação de histórico |
| `evolution-pc.test.ts` | Unitário | Evolution PC/túnel |
| `evolution-url-endpoint.test.ts` | Unitário | Endpoint de URL da Evolution |
| `atendimento-read.test.ts` | Unitário | Leitura do atendimento |
| `atendimento-notas-db.test.ts` | Banco | Notas internas do atendimento |
| `inbox-safety.test.ts` | Unitário | Segurança da caixa de entrada |
| `inbox-waiting.test.ts` | Unitário | Tempo de espera na fila |
| `quick-replies.test.ts` | Unitário | Respostas rápidas |
| `webhook.test.ts` | Unitário | Webhook genérico |

**Lacunas identificadas:**
- ⚠️ Nenhum teste E2E de fluxo completo de mensagem (envio → recebimento → resposta IA)
- ⚠️ Nenhum teste de integração real com Evolution API (todos são unitários/mocks)
- ⚠️ Falta teste de deduplicação de eventos no webhook

---

### 1.2 Financeiro (14 arquivos) ✅ Cobertura Alta
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `financial-control.test.ts` | Unitário | Controle financeiro geral |
| `financial-classification.test.ts` | Unitário | Classificações financeiras |
| `financial-allocations.test.ts` | Unitário | Rateios por obra |
| `financial-recurrences.test.ts` | Unitário | Recorrências |
| `financial-report.test.ts` | Unitário | Relatórios financeiros |
| `financial-dre.test.ts` | Unitário | DRE gerencial |
| `financial-dre-db.test.ts` | Banco | DRE com banco real |
| `financial-reports-db.test.ts` | Banco | Relatórios com banco real |
| `cash-flow.test.ts` | Unitário | Fluxo de caixa |
| `cash-overview.test.ts` | Unitário | Visão geral do caixa |
| `cash-safety.test.ts` | Unitário | Segurança do caixa |
| `bank-reconciliation.test.ts` | Unitário | Conciliação bancária |
| `bank-statement.test.ts` | Unitário | Extrato bancário |
| `account-statement.test.ts` | Unitário | Extrato por conta |

**Lacunas identificadas:**
- ⚠️ Falta teste de idempotência de `register_payment` com chamadas paralelas
- ⚠️ Falta teste de estorno de pagamento com parcelas parciais

---

### 1.3 Orçamentos / Vendas (10 arquivos) ✅ Cobertura Média-Alta
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `quote-save-transaction.test.ts` | Unitário | Salvamento transacional de orçamento |
| `quote-hidden-services.test.ts` | Unitário | Ocultação de serviços na impressão |
| `quote-travel-dilution.test.ts` | Unitário | Diluição de deslocamento |
| `quote-file-name.test.ts` | Unitário | Nome do arquivo PDF |
| `gutter-quote-pricing.test.ts` | Unitário | Preços de calhas |
| `wvetro-proposal.test.ts` | Unitário | Importação WVetro |
| `salvamento-parcial.test.ts` | Unitário | Salvamento parcial |
| `sale-workspace-data.test.ts` | Unitário | Dados do workspace de vendas |
| `order-operations.test.ts` | Unitário | Operações de pedido |
| `order-result.test.ts` | Unitário | Resultado por obra |

**Lacunas identificadas:**
- ⚠️ Falta teste de `approve_quote` com corrida real entre conexões (B5)
- ⚠️ Falta teste de `revert_quote_approval` com pagamentos já estornados
- ⚠️ Falta teste E2E de fluxo orçamento → venda → pedido → produção

---

### 1.4 IA / Lia (9 arquivos) ✅ Cobertura Alta
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `ai-chat.test.ts` | Unitário | Chat com provedores de IA |
| `ai-anthropic.test.ts` | Unitário | Integração Anthropic/Claude |
| `ai-central-data.test.ts` | Unitário | Dados da Central de IA |
| `ai-rate-limit.test.ts` | Unitário | Rate limiting de IA |
| `lia-rules.test.ts` | Unitário | Regras da Lia |
| `lia-mode.test.ts` | Unitário | Modos da Lia |
| `lia-mode-db.test.ts` | Banco | Modos da Lia com banco real |
| `lia-learned-rules.test.ts` | Unitário | Regras aprendidas |
| `lia-learned-rules-db.test.ts` | Banco | Regras aprendidas com banco real |
| `lia-followups-db.test.ts` | Banco | Follow-ups da Lia |
| `triage.test.ts` | Unitário | Triagem de mensagens |
| `triage-context.test.ts` | Unitário | Contexto de triagem |
| `transcribe.test.ts` | Unitário | Transcrição de áudio |
| `customer-identity.test.ts` | Unitário | Identidade do cliente |
| `ana-rules.test.ts` | Unitário | Regras antigas (Ana) |

**Lacunas identificadas:**
- ⚠️ Falta teste de fallback entre provedores (Groq → OpenAI → Ollama)
- ⚠️ Falta teste de timeout e circuit breaker da IA

---

### 1.5 Fiscal (3 arquivos) ✅ Cobertura Adequada
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `fiscal-motor.test.ts` | Unitário | Motor oficial da Receita |
| `fiscal-calculadora.test.ts` | Unitário | Calculadora fiscal |
| `fiscal-db.test.ts` | Banco | Fiscal com banco real |

**Lacunas identificadas:**
- ⚠️ Falta teste de classificação não aprovada sendo barrada pelo gatilho `fiscal_classification_guard`

---

### 1.6 Compras / Estoque / Fornecedores (4 arquivos) ✅ Cobertura Média
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `compras-lote-db.test.ts` | Banco | Compras em lote |
| `supplier-credits.test.ts` | Unitário | Créditos com fornecedores |
| `aluminum-cost.test.ts` | Unitário | Custo do alumínio |
| `chapa-lisa.test.ts` | Unitário | Chapa lisa |

**Lacunas identificadas:**
- ⚠️ Falta teste de bloqueio de compra duplicada (mesmo fornecedor, ±R$1, 30 dias)
- ⚠️ Falta teste de `receive_purchase_all` com recebimento parcial anterior
- ⚠️ Falta teste de `undo_stock_receipts` e `cancel_purchase_order`

---

### 1.7 Produção / Serviços / Instalação (3 arquivos) ⚠️ Cobertura Baixa
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `service-orders.test.ts` | Unitário | Ordens de serviço |
| `notify-installed.test.ts` | Unitário | Notificação pós-instalação |
| `catalog.test.ts` | Unitário | Catálogo de peças |
| `catalog-pagination.test.ts` | Unitário | Paginação do catálogo |

**Lacunas identificadas:**
- ❌ Nenhum teste de `advance_production_step` ou máquina de estados da produção
- ❌ Nenhum teste de checklist obrigatório de instalação
- ❌ Nenhum teste de liberação para corte (bloqueio sem medidas validadas)
- ❌ Nenhum teste de custo de mão de obra por obra

---

### 1.8 Autenticação / Permissões / RBAC (3 arquivos) ✅ Cobertura Crítica
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `rbac-isolation-db.test.ts` | Banco | Isolamento multiempresa (RLS) |
| `vendedor-escopo-db.test.ts` | Banco | Escopo do vendedor |
| `safe-url.test.ts` | Unitário | Validação de URLs externas |

**Lacunas identificadas:**
- ⚠️ Falta teste de acesso cruzado entre empresas via Server Actions (não só banco)
- ⚠️ Falta teste de função `has_table_access` com roles combinados

---

### 1.9 Infraestrutura / Utilitários (12 arquivos) ✅ Cobertura Adequada
| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `smoke.test.ts` | Smoke | Smoke test básico |
| `migrations.test.ts` | Unitário | Validação de migrações |
| `operations.test.ts` | Unitário | Rotina de operações |
| `crm-operations.test.ts` | Unitário | Operações CRM |
| `api.test.ts` | Unitário | APIs gerais |
| `actions.test.ts` | Unitário | Server Actions genéricas |
| `domain.test.ts` | Unitário | Domínio/regras de negócio |
| `br-number.test.ts` | Unitário | Formatação de números BR |
| `brazilian-input.test.ts` | Unitário | Inputs brasileiros |
| `timezone.test.ts` | Unitário | Fuso horário |
| `etapa2-helpers.test.ts` | Unitário | Helpers da etapa 2 |
| `agenda-details.test.ts` | Unitário | Detalhes da agenda |
| `pipeline-board.test.ts` | Unitário | Board do pipeline |
| `notice-groups.test.ts` | Unitário | Grupos de notificação |
| `pix.test.ts` | Unitário | Pix |
| `cobrancas-pix-db.test.ts` | Banco | Cobranças Pix |
| `invoice-reader.test.ts` | Unitário | Leitura de nota fiscal |
| `jarvis-medicao-db.test.ts` | Banco | JARVIS medição |
| `clients-duplicates.test.ts` | Unitário | Clientes duplicados |
| `client-phone.test.ts` | Unitário | Telefone do cliente |

---

## 2. Matriz de Cobertura Resumida

| Módulo | Unitários | Banco Real | E2E | Cobertura | Lacuna Crítica |
|--------|-----------|------------|-----|-----------|----------------|
| WhatsApp/Atendimento | 16 | 6 | 0 | ✅ Alta | Integração real Evolution |
| Financeiro | 12 | 2 | 0 | ✅ Alta | Idempotência paralela |
| Orçamentos/Vendas | 10 | 0 | 0 | ⚠️ Média-Alta | approve_quote concorrência |
| IA/Lia | 13 | 3 | 0 | ✅ Alta | Fallback entre provedores |
| Fiscal | 2 | 1 | 0 | ✅ Adequada | Gatilho de classificação |
| Compras/Estoque | 4 | 1 | 0 | ⚠️ Média | Bloqueio duplicata |
| Produção/Serviços | 4 | 0 | 0 | ❌ Baixa | Máquina de estados |
| Auth/RBAC | 2 | 2 | 0 | ✅ Crítica OK | Acesso cruzado Server Actions |
| Infra/Utilitários | 18 | 1 | 0 | ✅ Adequada | — |
| **TOTAL** | **81** | **16** | **0** | — | — |

**Nota:** Os ~93 testes E2E mencionados no contexto do projeto estão em `tests/e2e/` (Playwright/Puppeteer) e não foram listados acima porque usam extensão `.spec.ts` ou `.test.mjs`. A cobertura E2E existe mas não foi detalhada neste inventário.

---

## 3. Lacunas Críticas Priorizadas

| Prioridade | Lacuna | Risco | Esforço |
|------------|--------|-------|---------|
| P0 | Teste de integração real com Evolution API | Alto — bugs só aparecem em produção | Alto (requer ambiente homologação) |
| P0 | Teste de `approve_quote` com concorrência | Alto — aprovação dupla simultânea | Médio |
| P1 | Testes da máquina de estados da produção | Alto — avanço indevido de etapas | Médio |
| P1 | Teste de bloqueio de compra duplicada | Médio — entradas duplicadas relatadas | Baixo |
| P1 | Teste de fallback entre provedores de IA | Médio — triagem para se modelo mudar | Baixo |
| P2 | Teste de acesso cruzado via Server Actions | Médio — defesa em profundidade | Médio |
| P2 | Teste de idempotência de `register_payment` | Médio — baixa dupla | Baixo |
| P2 | Teste de gatilho `fiscal_classification_guard` | Baixo — classificação não aprovada | Baixo |

---

## 4. Recomendações

1. **Imediato (P0):** Criar teste de concorrência para `approve_quote` usando múltiplas conexões ao banco PGlite
2. **Curto prazo (P1):** Adicionar testes de máquina de estados da produção e bloqueio de compra duplicada
3. **Médio prazo (P2):** Configurar ambiente de homologação com Evolution API real para testes de integração
4. **Contínuo:** Todo PR deve incluir teste novo ou atualizado para a funcionalidade modificada

---

**Status:** ✅ Tarefa 2.1 concluída. Próxima: Tarefa 2.2 (Corrigir smoke tests).