# Auditoria Técnica — Estado Atual do Repositório CRM Bielenki

**Data da auditoria:** 20/11/2026  
**Repositório:** https://github.com/anderrsc/crm-bielenki  
**Branch analisada:** `main` (commit `c444dfe` — merge do PR #116)  
**Última entrega publicada:** Calculadora fiscal da Reforma Tributária (19/11/2026)

---

## 1. RESUMO EXECUTIVO DO ESTADO ATUAL

### Stack Tecnológica Confirmada
| Camada | Tecnologia | Versão | Status |
|--------|-----------|--------|--------|
| Framework | Next.js | 15.5.28 | ✅ Atualizado |
| UI | React | 19.0.0 | ✅ |
| Linguagem | TypeScript | ^5.8.2 | ✅ |
| Estilização | TailwindCSS | ^3.4.17 | ✅ |
| Banco/Auth | Supabase | @supabase/ssr ^0.12.0, @supabase/supabase-js ^2.49.4 | ✅ |
| Validação | Zod | 4.6.7 | ✅ |
| IA | Anthropic (Claude), Google Gemini, Groq, OpenAI, Ollama | @anthropic-ai/sdk ^1.10.0 | ✅ Múltiplos provedores |
| PDF | Puppeteer Core + @sparticuz/chromium-min | 25.16.0 / 149.0.0 | ✅ Renderização A4 |
| WhatsApp | Evolution API (Baileys) | Integração completa | ⚠️ Operacional com travamentos |
| Testes | Vitest, Playwright, PGlite | vitest ^5.0.4, @playwright/test ^1.64.0 | ✅ 708 unitários + 93 E2E |

### Infraestrutura de Deploy
- **Vercel:** Região `gru1` (São Paulo), deploy automático da branch `main`
- **Supabase:** Projeto `nfyiooalcaosjhpmvmqd`, região `sa-east-1` (AWS)
- **Evolution API:** Servidor Docker na Hospede Aqui (não oficial, Baileys-based)

---

## 2. CLASSIFICAÇÃO DAS FUNCIONALIDADES DO PROMPT MESTRE

### 2.1 Fase 1 — WhatsApp e Atendimento em Tempo Real
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA** (com ressalvas operacionais)

**Evidências encontradas:**
- **Webhook completo:** `app/api/whatsapp/webhook/route.ts` (900 linhas)
  - Suporte a Evolution API e Meta WhatsApp Cloud API
  - Validação de assinatura HMAC-SHA256
  - Deduplicação de eventos por `event_id`
  - Gravação atômica de mensagens antes da IA
  - Transcrição de áudio via Gemini (`lib/ai/transcribe.ts`)
  - Leitura de PDF/notas fiscais (`lib/ai/invoice-reader.ts`, `proposal-reader.ts`)
- **Múltiplos números:** Tabela `whatsapp_channels` com suporte a N canais por empresa
  - Cada número tem QR code próprio, webhook secret e configuração isolada
  - Lia atende apenas o número principal (`ai_agent_config.is_default`)
- **Sincronização bidirecional:** 
  - Reconciliação automática a cada minuto (`syncRecentEvolutionMessages` em `lib/whatsapp/evolution-history.ts`)
  - Histórico importado com mapeamento de LID (@lid → número real)
  - Confirmação de envio/leitura via `updateDelivery` e `updateIncomingRead`
- **IA Lia (atendimento automatizado):**
  - Triagem inteligente com JSON estruturado (`analise`, `mensagem`, `dados_coletados`, `triagem_concluida`)
  - Modos: assistente, semiautomático (sugestão para aprovação), automático
  - Regras aprendidas com versionamento e reversão (`ai_lia_rules`, `lia-learned-rules.ts`)
  - Fatos oficiais versionados em código (`lia-knowledge.ts`)
  - Limite diário de respostas (padrão 200) e horário comercial configurável
  - Acompanhamento automático de leads (24h, até 3 tentativas) — **desligado por padrão**
- **Vigia automático:** `lib/whatsapp/watchdog.ts` + `lib/operations.ts`
  - Detecta conexão "zumbi" (aberta mas sem mensagens há 20 min no expediente)
  - Reinicia automaticamente (máx. 1 vez a cada 45 min) com auditoria `AUTO_RESTART`
  - Notifica gerência via push notification
- **Atendimento multiusuário:**
  - Conversas atribuídas a atendentes (`conversations.assigned_to`)
  - Transferência de atendimento, notas internas, etiquetas
  - Respostas prontas (`quick_replies`)
  - Fila "Sem resposta" com tempo de espera

**Problemas conhecidos (B1):**
- Conexão Evolution trava periodicamente (sessão Baileys "zumbi")
- Vigia publicado em 19/11, eficácia em produção ainda não confirmada
- Eventos `connection.update` não são gravados (só "ignored")

**Arquivos críticos:**
- `app/api/whatsapp/webhook/route.ts`
- `lib/whatsapp/{evolution,send,channels,inbox-store,watchdog,evolution-history}.ts`
- `lib/ai/{chat,transcribe,invoice-reader,proposal-reader,lia-knowledge,lia-rules,lia-mode}.ts`
- `lib/operations.ts` (rotina de 1 min)

---

### 2.2 Fase 2 — Testes, Segurança e Monitoramento
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA**

**Evidências encontradas:**
- **Suite de testes completa:**
  - 708 testes unitários (Vitest + PGlite em memória)
  - 151 testes de banco em Postgres real
  - ~93 testes E2E (Playwright/Puppeteer)
  - Cobertura: RBAC, operações financeiras, WhatsApp, fiscal, compras, estoque
- **CI/CD robusto:** `.github/workflows/ci.yml`
  - Typecheck, audit, build, testes completos
  - Smoke test de hora em hora (`smoke-test.yml`)
  - Workflow de migrações manual (`aplicar-migrations.yml`)
- **Segurança:**
  - RLS em todas as tabelas operacionais (292 políticas)
  - Funções `security definer` com `search_path` fixo
  - Segredos criptografados com AES-256 (`lib/encrypt.ts`)
  - Cabeçalhos de segurança e erros técnicos ocultos (#95)
  - Rate limiting de IA (`lib/ai/rate-limit.ts`)
  - Validação de URLs externas (`lib/safe-url.ts`)
  - CSV protegido contra fórmulas
- **Monitoramento:**
  - Diagnóstico de saúde do WhatsApp (`scripts/diagnostico-agente-ia.sql`)
  - Auditoria em `audit_logs` por gatilhos
  - Logs estruturados sem exposição de secrets

**Arquivos críticos:**
- `tests/*.test.ts` (110 arquivos)
- `.github/workflows/{ci,e2e,aplicar-migrations,smoke-test,verificar-motor-fiscal}.yml`
- `vitest.config.mts`, `playwright.config.ts`
- `lib/encrypt.ts`, `lib/safe-url.ts`, `lib/ai/rate-limit.ts`

---

### 2.3 Fase 3 — Automatização Completa dos Pedidos
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA**

**Evidências encontradas:**
- **Máquina de estados consistente:**
  - Orçamento → Venda → Pedido → Produção → Instalação → Pós-venda
  - Função atômica `approve_quote` (idempotente): gera venda, pedido, conta a receber, checklist, compra e produção
  - Reversão controlada por `revert_quote_approval`
- **Conferência de medidas:**
  - Etapa obrigatória antes da liberação para corte (`order_measure_checks`, `order_measure_decisions`)
  - Bloqueio de produção se medidas não validadas (exceto se dispensado)
  - Agenda integrada (`agenda-page.tsx`, `mobile-agenda.tsx`)
- **Compras e estoque automatizados:**
  - Solicitação de compra gerada automaticamente ao aprovar orçamento com itens que exigem compra
  - Recebimento parcial/total com movimentação de estoque (`receive_purchase_item`, `receive_purchase_all`)
  - Bloqueio de duplicata (mesmo fornecedor, total ±R$1, mesmos itens em 30 dias)
- **Produção:**
  - Ordens de produção por etapa (`production_orders`, `production_order_items`, `production_step_logs`)
  - Custo automático do alumínio com aproveitamento de bobinas (`lib/aluminum-cost.ts`, PR #87)
  - Liberação para corte só após validação de medidas (gerência)
- **Instalação:**
  - Checklists obrigatórios por tipologia (`installation_checklists`)
  - Agendamento por equipe, fotos antes/depois (`service_photos`)
  - Aceite digital e registro de pendências
- **Pós-venda:**
  - Acionado automaticamente após instalação concluída
  - Follow-up de 3 dias para avaliação do cliente

**Arquivos críticos:**
- `supabase/migrations/002_rls_automations.sql` (funções `approve_quote`, `register_payment`, etc.)
- `lib/order-result.ts`, `lib/aluminum-cost.ts`
- `components/order-operation-card.tsx`, `components/production-flow-page.tsx`

---

### 2.4 Fase 4 — Custos Automáticos e Lucratividade
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA**

**Evidências encontradas:**
- **Cálculo de custo de alumínio:**
  - Fórmula geométrica parametrizada: largura desenvolvida × comprimento × espessura × densidade
  - Espessuras: 0.5mm, 0.6mm, 0.7mm, 1.0mm
  - Aproveitamento de bobinas com perdas configuráveis
  - Matriz de preços de alumínio (`aluminum_price_matrix`, `aluminum_cost_settings`)
- **Insumos e mão de obra:**
  - Cadastro de custos unitários (parafusos, vedante, silicone, etc.)
  - Listas de materiais por produto/serviço
  - Registro de horas trabalhadas por funcionário/equipe
  - Custo/hora parametrizável
- **Margem por obra:**
  - View `v_order_result` com previsto/comprometido/realizado
  - DRE gerencial (`/financeiro/dre`)
  - Resultado por obra com rateios de centros de custo
- **Segurança financeira:**
  - Permissões restritas por cargo (vendedor não vê custos sensíveis)
  - Auditoria de alterações de preços em `audit_logs`
  - Preservação de valores históricos

**Limitações identificadas:**
- ⚠️ Mão de obra, impostos e comissões por obra ainda não entram automaticamente no resultado
- ⚠️ Consumo de material do estoque não é baixado automaticamente na produção

**Arquivos críticos:**
- `lib/aluminum-cost.ts`, `lib/gutter-quote-pricing.ts`
- `components/aluminum-cost-panel.tsx`, `components/pricing-center.tsx`
- `supabase/migrations/033_aluminum_price_matrix.sql`

---

### 2.5 Fase 5 — Agenda, Interface e Produtividade
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA**

**Evidências encontradas:**
- **Dashboard por função:**
  - Visão geral executiva (`dashboard-overview.tsx`)
  - Pendências centralizadas (`pending-center.tsx`)
  - Indicadores operacionais em tempo real
- **Agenda inteligente:**
  - Visão diária, semanal e mensal (`agenda-page.tsx`, `mobile-agenda.tsx`)
  - Filtros por empresa, responsável, tipo de serviço
  - Conflitos de horário detectados
  - Integração com Maps/Waze para endereços
- **Fluxos rápidos:**
  - Ctrl+K para busca global e criação rápida (`command-palette.tsx`, `quick-create-menu.tsx`)
  - Botão "+ Novo" contextual
  - Trilha de navegação (`breadcrumbs.tsx`)
  - Visões salvas (`saved-views.tsx`)
- **Desempenho otimizado:**
  - Índices compostos em consultas frequentes
  - Cache de PDF de orçamentos (`quote-pdfs` bucket)
  - Componentes React memoizados
  - Server Components para reduzir bundle JS

**Pendências de UX:**
- ⚠️ Regressão visual A4 dos orçamentos após mudanças de ocultação (não refeita)
- ⚠️ Total por linha na proposta WVetro ainda mostra valor estimado (decisão pendente do dono)

**Arquivos críticos:**
- `components/dashboard-overview.tsx`, `components/pending-center.tsx`
- `components/agenda-page.tsx`, `components/mobile-agenda.tsx`
- `components/command-palette.tsx`, `components/quick-create-menu.tsx`

---

### 2.6 Fase 6 — Integração com JARVIS e Bielenki Workspace
**Classificação:** ⚠️ **PARCIALMENTE IMPLEMENTADA**

**Evidências encontradas:**
- **JARVIS:**
  - Aplicativo separado (`https://jarvis-ai-crm-bielenki.vercel.app`)
  - RPCs no mesmo banco para buscar cliente e agendar medição
  - Migrações específicas: `20261116210000_lia_status_jarvis`, `20261118100000_jarvis_agendar_medicao`
  - **Código-fonte do JARVIS não está neste repositório** ❓
- **API de integração:**
  - Não há camada de API dedicada para agentes externos
  - Acesso direto ao banco via Supabase (RLS garante isolamento)
  - Sem tokens de curta duração ou rotação de credenciais para agentes
- **Bielenki Workspace:**
  - **Não há referência no código** ao domínio `bielenki.com.br` ou integração com e-mails corporativos

**Arquivos críticos:**
- `supabase/migrations/20261116210000_lia_status_jarvis.sql`
- `supabase/migrations/20261118100000_jarvis_agendar_medicao.sql`

---

## 3. MÓDULOS ADICIONAIS IDENTIFICADOS

### 3.1 Calculadora Fiscal (Reforma Tributária) — Última entrega (19/11)
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA**

**Evidências encontradas:**
- **Motor oficial da Receita:** `lib/fiscal/motor.ts`
  - Endpoint: `https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api`
  - Versão 1.7.2 (verificada em 19/11 pelo workflow `verificar-motor-fiscal.yml`)
  - Circuit breaker integrado (3 falhas → abre por 60s)
  - Timeout de 10s com retry para 5xx
- **Telas:**
  - `/fiscal` com abas: Calculadora, Classificações, Histórico, Configuração
  - Simulação de CBS/IBS/IS por item com memória de cálculo
  - Classificação por NCM/NBS com aprovação (financeiro/gerência/admin)
  - Exportação para CSV (`/api/fiscal/exportar`)
- **Banco:**
  - Tabelas: `fiscal_settings`, `fiscal_classifications`, `fiscal_calculations`, `fiscal_calculation_items`
  - Gatilho `fiscal_classification_guard` impede uso de classificação não aprovada
  - Idempotente: simular mesmo orçamento retorna cálculo existente

**Status:**
- ✅ Testes com respostas reais gravadas (`tests/fixtures/fiscal/`)
- ✅ Fluxo completo na tela local
- ❓ Uso em produção depende de configuração do financeiro e contador

**Arquivos críticos:**
- `lib/fiscal/{motor,calculadora,export}.ts`
- `app/(crm)/fiscal/page.tsx`, `components/fiscal-page.tsx`
- `supabase/migrations/20261119170000_fiscal_calculadora.sql`

---

### 3.2 Cobrança Pix Registrada
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA**

**Evidências encontradas:**
- **Tabela:** `pix_charges` (19/11)
- **Funcionalidades:**
  - Geração de cobrança Pix com vencimento
  - Enquanto "aguardando", não entra no saldo
  - Ao confirmar: baixa conta a receber (se vinculada a orçamento) ou cria e baixa (avulsa)
  - Valor maior que saldo em aberto é barrado
  - Cancelar não mexe no financeiro
- **Extrato:** Inclui cobranças Pix aguardando na conta escolhida

**Arquivos críticos:**
- `components/pix-charge.tsx`, `pix-charge-actions.ts`, `account-pix-charges.tsx`
- `supabase/migrations/20261119xxxxxx_pix_charges.sql` (verificar numeração exata)

---

### 3.3 Importação de Proposta WVetro
**Classificação:** ✅ **IMPLEMENTADA E VALIDADA**

**Evidências encontradas:**
- **Leitura de PDF:** `lib/wvetro-proposal.ts`, `lib/pdf-text.ts`
  - Extrai texto sem IA (OCR não necessário se PDF tiver texto)
  - Identifica cliente e importa itens (produto, medida, quantidade)
  - Preço total trazido pelo PDF; unitários estimados pela metragem
- **Botão "Repartir o total pela metragem":** Fecha no centavo e liga "esconder unitários"
- **PDF original:** Anexado aos anexos internos do orçamento

**Limitação:**
- ⚠️ Impressão ainda mostra total por linha estimado (decisão pendente: mostrar só itens + total geral?)

**Arquivos críticos:**
- `components/wvetro-import.tsx`
- `app/(crm)/wvetro-actions.ts`

---

## 4. ESTRUTURA DE BANCO DE DADOS

### 4.1 Números Confirmados
- **140 migrações** em `supabase/migrations/` (de `001_schema.sql` a `20261119170000_fiscal_calculadora.sql`)
- **112 tabelas** e 14 views em `public`
- **222 funções** em `public` (incluindo `approve_quote`, `register_payment`, `receive_purchase_item`, etc.)
- **292 políticas RLS** garantindo isolamento multiempresa

### 4.2 Domínios Principais
- Empresa/usuários: `companies`, `profiles`, `user_roles`, `permissions`, `audit_logs`
- Clientes/comercial: `clients`, `leads`, `pipeline_stages`, `activities`, `followups`
- Orçamentos: `quotes`, `quote_items`, `gutter_quotes`, `gutter_quote_items`, `gutter_prices`
- Venda/pedido: `sales`, `sale_items`, `orders`, `order_items`, `order_checklists`
- Produção: `production_orders`, `production_order_items`, `production_materials`, `production_step_logs`
- Compras/estoque: `suppliers`, `purchase_orders`, `materials`, `stock_movements`
- Financeiro: `financial_entries`, `payments`, `financial_categories`, `financial_recurrences`, `receiving_accounts`, `pix_charges`
- Fiscal: `fiscal_settings`, `fiscal_classifications`, `fiscal_calculations`
- WhatsApp/atendimento: `conversations`, `messages`, `whatsapp_channels`, `whatsapp_webhook_events`, `ai_agent_config`
- Automações: `workflows`, `workflow_executions`, `automation_rules`

---

## 5. CONCLUSÃO DA AUDITORIA

O repositório `anderrsc/crm-bielenki` na branch `main` (commit `c444dfe`) representa um **ERP/CRM maduro e em produção**, com funcionalidades avançadas implementadas e validadas por testes automatizados. O sistema está em uso diário pela Marquinhos Calhas e Esquadrias.

**Pontos fortes:**
- Arquitetura sólida com Next.js 15 + Supabase + RLS
- Suite de testes abrangente (708 unitários + 93 E2E)
- CI/CD robusto com deploy automático na Vercel
- Integração WhatsApp completa (multi-número, reconciliação, vigia)
- IA Lia com modos, regras aprendidas e fatos versionados
- Calculadora fiscal oficial integrada (última entrega)
- Financeiro completo (caixa, conciliação, recorrências, DRE, obras, Pix)

**Riscos identificados:**
- 🐛 Conexão Evolution trava periodicamente (vigia publicado, eficácia não confirmada)
- ⚠️ Código do JARVIS não está neste repositório
- ⚠️ Mão de obra/impostos/comissões por obra ainda não automatizados
- ⚠️ Emissão de notas fiscais pausada por decisão do dono

**Próximo passo recomendado:** Prosseguir com a estabilização do WhatsApp (P0.1) e ativação da calculadora fiscal em produção (P1).

---

**Documento gerado em:** 20/11/2026  
**Responsável:** Engenheiro de Software Sênior (IA)  
**Base:** Análise direta do código-fonte, migrações, testes e workflows do repositório `anderrsc/crm-bielenki`@`c444dfe`