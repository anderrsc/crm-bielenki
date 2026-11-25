# CONTEXTO COMPLETO DO PROJETO — CRM Bielenki (Marquinhos Calhas e Esquadrias)

> Memória técnica e documento de transferência de contexto entre IAs.
> **Gerado em 19/11/2026, atualizado em 23/11/2026** (auditoria e correções do WhatsApp, PRs #126–#131) a partir do código em `main` no commit `386dbc9` (merge do PR #115), do banco montado localmente com todas as 140 migrações, dos testes, dos workflows, dos documentos do repositório, do histórico Git (321 commits, PRs até #115) e das conversas desta sessão.
> Sem segredos, senhas, chaves ou dados pessoais de clientes.

**Como ler as marcações**

| Marca | Significado |
|---|---|
| ✅ | Implementado **e verificado** por teste automatizado, CI ou execução real registrada |
| ⚠️ | Implementado parcialmente ou com ressalva importante |
| ❌ | Não implementado |
| 🐛 | Problema conhecido |
| ❓ | Não foi possível verificar daqui (ex.: depende de produção, celular ou servidor externo) |
| **[fato]** | Lido no código ou no banco, ou visto em execução |
| **[relatado]** | Dito pelo dono ou registrado em documento, mas não conferido diretamente |
| **[hipótese]** | Inferência a confirmar |

---

## Sumário
1. [Resumo executivo](#1-resumo-executivo)
2. [Contexto geral e objetivos](#2-contexto-geral-e-objetivos)
3. [Arquitetura e tecnologias](#3-arquitetura-e-tecnologias)
4. [Estrutura de arquivos](#4-estrutura-de-arquivos)
5. [Banco de dados](#5-banco-de-dados)
6. [Módulos e funcionalidades](#6-módulos-e-funcionalidades)
7. [APIs e integrações](#7-apis-e-integrações)
8. [Regras de negócio](#8-regras-de-negócio)
9. [Usuários e permissões](#9-usuários-e-permissões)
10. [Inteligência artificial e automações](#10-inteligência-artificial-e-automações)
11. [Interface e experiência do usuário](#11-interface-e-experiência-do-usuário)
12. [Histórico de desenvolvimento](#12-histórico-de-desenvolvimento)
13. [Bugs e problemas conhecidos](#13-bugs-e-problemas-conhecidos)
14. [Funcionalidades pendentes](#14-funcionalidades-pendentes)
15. [Segurança e infraestrutura](#15-segurança-e-infraestrutura)
16. [Roadmap priorizado](#16-roadmap-priorizado)
17. [Instalação, testes e deploy](#17-instalação-testes-e-deploy)
18. [LEIA ISTO ANTES DE CONTINUAR O DESENVOLVIMENTO](#18-leia-isto-antes-de-continuar-o-desenvolvimento)
19. [Glossário e informações adicionais](#19-glossário-e-informações-adicionais)
20. [Checklist de continuidade](#20-checklist-de-continuidade)

---

## 1. Resumo executivo

- **O que é.** ERP/CRM web da **Marquinhos Calhas e Esquadrias** (Jaraguá do Sul/SC). Fabrica e instala calhas, rufos, pingadeiras e acabamentos de alumínio; vende e instala esquadrias, vidros e box. O nome técnico do repositório é **CRM Bielenki**. "Bielenki" é o sobrenome do dono e desenvolvedor (usuário mestre).
- **Onde roda.** Produção em `https://crm-bielenki.vercel.app` (Vercel, região `gru1`). Banco e autenticação no **Supabase** (projeto `nfyiooalcaosjhpmvmqd`, região sa-east-1). Repositório `github.com/anderrsc/crm-bielenki`.
- **Empresas atendidas.** **Só a Marquinhos** usa e vai continuar usando o sistema (decisão do dono em 19/11/2026). O banco é multiempresa (isolamento por `company_id` com RLS), mas cada usuário pertence a uma única empresa.
- **Estado atual.** O sistema está em uso diário: atendimento por WhatsApp, orçamentos de calhas e esquadrias, vendas, pedidos, produção, instalação, compras, estoque e financeiro completo, mais IA de atendimento (Lia).
  - **Última entrega publicada (19/11, 18:24 BRT):** calculadora fiscal da Reforma Tributária (IBS/CBS/IS) usando o motor oficial da Receita.
  - **Emissão de notas fiscais: pausada** por decisão do dono.
- **Maiores riscos hoje:**
  1. **WhatsApp:** a conexão da Evolution (servidor não oficial, hospedado na Hospede Aqui) "trava" e para de receber mensagens. Um vigia automático foi publicado em 19/11; a eficácia em produção ainda não está confirmada (§13).
  2. **Contas a ativar:** IA (Lia) e automações dependem de chaves e configuração em produção.
  3. **Ambiente local:** não há banco de homologação separado; os testes usam banco local isolado.
- **Testes (19/11):**
  - 708 testes unitários e de banco (vitest/PGlite) ✅;
  - 151 testes de banco em Postgres real ✅;
  - ~93 testes ponta a ponta (Puppeteer) no CI ✅;
  - tipos (`tsc`) e build no CI ✅.

---

## 2. Contexto geral e objetivos

### 2.1 Problema que resolve **[fato + relatado]**
Centraliza a operação de uma pequena indústria e instaladora: atendimento (WhatsApp), orçamento, venda, pedido, medição, produção (corte/dobra), compras de material, estoque, instalação, pós-venda, financeiro (receber/pagar/caixa/conciliação/DRE/obras) e, agora, simulação fiscal. Antes, isso ficava espalhado em WhatsApp, planilhas, papel e no **WVetro** (software de esquadrias que continua sendo usado para projetar e gerar propostas de esquadrias).

### 2.2 Perfis de usuário (cargos reais do banco, enum `app_role`) **[fato]**
`administrador`, `gerente`, `vendedor`, `atendente`, `compras`, `estoque`, `producao`, `instalador`, `financeiro`. Detalhes em §9.

### 2.3 Objetivos (do `REQUISITOS-PROMPT-MESTRE.md`) **[relatado]**
1. **Financeiro:** central de controle financeiro, custos, rentabilidade, fluxo de caixa e gestão por obra.
2. **Calhas:** fabricação, bobinas, materiais, pedidos, produção e instalação.
3. **Rotina operacional:** escritório, fábrica e equipes externas.
4. **Esquadrias:** acompanhamento operacional e financeiro, **preservando o WVetro** para orçamentos, projetos e listas técnicas.
5. **Automações e IA:** reduzir trabalho manual e antecipar problemas.
6. **Qualidade:** estabilidade, velocidade, segurança, uso no celular e consistência dos dados.

### 2.4 Visão de longo prazo **[relatado]**
- ERP confiável e auditável, com IA supervisionada: a Lia no atendimento e o JARVIS como assistente interno.
- Preparado para a Reforma Tributária: a calculadora já existe; a emissão está pausada.
- Bobinas e lotes de alumínio; produção por etapa com fotos; equipes e veículos; folha de pagamento individual restrita.

### 2.5 Empresas, setores e operações **[fato + relatado]**
- **Empresa:** Marquinhos Calhas e Esquadrias, CNPJ 26.887.887/0001-75. Endereço comercial em Jaraguá do Sul/SC; cidades atendidas em `lib/ai/lia-knowledge.ts`.
- **Regime tributário [relatado]:** Simples Nacional em 2026. Em 2027 passa ao **"híbrido"** (Simples com IBS/CBS apurados no regime regular), a confirmar com o contador.
- **Bielenki Metal:** foi mencionada no prompt fiscal como possível empresa futura. **O dono decidiu que só a Marquinhos usa o sistema.**

---

## 3. Arquitetura e tecnologias

### 3.1 Stack **[fato — `package.json`]**

| Camada | Tecnologia (versão) |
|---|---|
| Framework | **Next.js 15.5.28** (App Router, Server Components, **Server Actions**), React 19.0.0, TypeScript 5.8 |
| UI | Tailwind CSS 3.4, Radix UI (dialog, dropdown, slot), lucide-react, recharts, class-variance-authority, clsx, tailwind-merge |
| Validação | **zod 4.6.7** |
| Banco/Auth | **Supabase** (`@supabase/supabase-js` 2.49, `@supabase/ssr` 0.12): Postgres 16, RLS, Auth, Storage, `pg_cron`, `pg_net` |
| PDF | `puppeteer-core` 25.16 + `@sparticuz/chromium-min` (PDF do orçamento na Vercel), `pdf-lib` 1.17.1, `unpdf` 2.1.0 (leitura de PDF com texto) |
| IA | `@anthropic-ai/sdk` (Claude), `ollama` 0.6.4 (Ollama Cloud), Groq/OpenAI via HTTP compatível, Google Gemini via HTTP |
| Outros | `qrcode`, `web-push` 3.6.7 (notificações push), `date-fns` |
| Testes | vitest 5, `@electric-sql/pglite` (Postgres em memória), jsdom, Testing Library, `pg`, Playwright/Puppeteer (E2E), Chromium |
| Node | v22 no ambiente de desenvolvimento (não há `engines` no package.json) |

### 3.2 Visão geral
```mermaid
flowchart LR
  U[Usuário navegador/celular] -->|HTTPS| V[Next.js na Vercel gru1<br/>Server Components + Server Actions]
  V -->|supabase-js com sessão do usuário<br/>RLS| DB[(Supabase Postgres<br/>RLS por empresa e cargo)]
  V -->|service role só no servidor| DB
  DB -->|pg_cron a cada minuto<br/>pg_net POST com segredo| OPS[/api/internal/operations/]
  OPS --> V
  EVO[Evolution API<br/>servidor Hospede Aqui] -->|webhook messages/contacts/connection| WH[/api/whatsapp/webhook/]
  WH --> DB
  V -->|enviar mensagens, QR, reconciliar, reiniciar| EVO
  META[WhatsApp Cloud API Meta<br/>suporte existente, não é o principal] -.-> WH
  V -->|chamadas de IA| IA[Claude / Gemini / Groq / OpenAI / Ollama]
  V -->|simulação fiscal| RFB[Calculadora oficial da Receita<br/>piloto-cbs.tributos.gov.br]
  JV[JARVIS app separado<br/>jarvis-ai-crm-bielenki.vercel.app] -->|RPCs no mesmo Supabase| DB
```

### 3.3 Padrões arquiteturais **[fato]**
- **Server Actions** em `app/(crm)/*-actions.ts` fazem as gravações. As regras críticas ficam em **funções Postgres** (`security definer` + `require_table_access` ou `security invoker` + RLS).
- **Página "catch-all"** `app/(crm)/[[...path]]/page.tsx` atende a maioria dos módulos por segmento de URL. As telas mais complexas têm página própria (`app/(crm)/financeiro/*`, `compras/*`, `servicos/*`, `fiscal`, `dashboard`).
- **Rotas de impressão** em `app/(print)/*`, sem a casca do app: orçamento A4, ficha de visita e extrato.
- **Proteção:** `middleware.ts` → `lib/supabase/middleware.ts` (sessão) + `lib/module-access.ts` (mapa rota → recurso de permissão). O menu esconde o que o cargo não vê, mas **a barreira real é o banco** (RLS e funções).
- **Segredos** de terceiros salvos no banco são criptografados com AES-256 (`lib/encrypt.ts`, chave `ENCRYPTION_KEY`).
- **Auditoria** em `audit_logs` por gatilhos e funções.

### 3.4 Variáveis de ambiente (nomes apenas) **[fato — código e `.env.example`]**

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Operações de servidor (rotina agendada, webhook, admin de usuários) |
| `NEXT_PUBLIC_SITE_URL` | URL pública |
| `ENCRYPTION_KEY` | 64 hex. Criptografa chaves salvas no banco; sem ela, deriva da service role |
| `EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` | Evolution. Em geral a configuração vem do banco (`ai_agent_config`/`whatsapp_channels`); as variáveis são alternativa |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` | WhatsApp Cloud API (Meta) |
| `OLLAMA_API_KEY` | Ollama Cloud (opcional) |
| `FISCAL_MOTOR_URL` | Opcional. Padrão: instalação online oficial da Receita |
| `SMOKE_TEST_BASE_URL` | Smoke test agendado |

As chaves de IA (Anthropic, Gemini, Groq, OpenAI) e da Evolution **ficam no banco**, criptografadas, e são cadastradas na **Central de IA**.

---

## 4. Estrutura de arquivos

```
/                          README.md, CONTINUIDADE.md (13/11), REQUISITOS-PROMPT-MESTRE.md (1721 linhas),
                           AUDITORIA-EVOLUCAO-2026-11-12.md, VALIDACAO-2026-11-12.md, vercel.json (gru1; deploy só da main),
                           middleware.ts, next.config.ts, tailwind.config.ts, vitest.config.mts, playwright.config.ts
app/
  layout.tsx               tema claro fixo (data-theme="light"), fontes, PWA
  login/                   tela de login
  (crm)/                   área autenticada
    [[...path]]/page.tsx   roteador da maioria dos módulos
    layout.tsx             casca: AppShell + permissões do usuário
    dashboard/ financeiro/{caixa,classificacoes,conciliacao,dre,lancamento/[id],obras,rateios,recorrencias,relatorios}
    compras/{nova,[id]} fornecedores/[id] servicos/{,novo,[id]} fiscal/
    *-actions.ts           Server Actions por domínio (ver §6)
  (print)/                 orcamentos/[id]/impressao, ficha/{[clientId],branco}, financeiro/extrato
  api/                     (ver §7)
  marquinhos.css, mobile.css, quote-paper.css, brand-tokens.css, brand-fonts.css, globals.css
components/                115 componentes (telas inteiras e peças reutilizáveis; ver §11)
  ui-feedback/             toast.tsx, confirm.tsx (diálogo de confirmação próprio)
lib/
  supabase/{client,server,middleware}.ts   clientes Supabase
  ai/                      chat.ts (provedores), lia-knowledge.ts (fatos oficiais), lia-rules.ts (regras em código),
                           lia-mode.ts, lia-learned-rules.ts, ana-*.ts (nome antigo da Lia), triage-context.ts,
                           transcribe.ts (áudio via Gemini), invoice-reader.ts (nota de compra), proposal-reader.ts,
                           customer-identity.ts, central-data.ts, rate-limit.ts
  whatsapp/                evolution.ts (API Evolution), evolution-history.ts (reconciliação), send.ts, channels.ts,
                           inbox-store.ts, delivery.ts, watchdog.ts (vigia), phone.ts, attachments.ts, …
  fiscal/                  motor.ts (adaptador do motor oficial), calculadora.ts, export.ts
  operations.ts            rotina de 1 min (saúde do WhatsApp, reconciliação, vigia, lembretes, push, Lia follow-up)
  gutters.ts, gutter-catalog.ts, marquinhos-catalog.json, gutter-quote-pricing.ts, aluminum-cost.ts
  cash-flow.ts, financial-*.ts, bank-statement.ts, account-statement.ts, order-result.ts
  wvetro-proposal.ts, pdf-text.ts, pix.ts, encrypt.ts, module-access.ts, modules.ts, utils.ts, …
supabase/migrations/       140 migrações (001_… até 20261119170000_fiscal_calculadora.sql)
scripts/                   verificar-banco-producao.sql, diagnostico-agente-ia.sql, route-inventory.json,
                           fiscal/verificar-motor.sh, desenhar-pecas.py, pecas-sem-fundo.py, smoke-test.mjs, …
tests/                     ~110 arquivos vitest (*.test.ts), db/ (Postgres real), e2e/ (Puppeteer), static/check-queries.mjs,
                           fixtures/ (inclui respostas reais do motor fiscal), helpers/database.ts (PGlite)
docs/                      MATRIZ_RBAC.md, RELATORIO_AUDITORIA.md, AUDITORIA-WHATSAPP-2026-11-18.md,
                           LIA_DIAGNOSTICO_E_PLANO.md, LIA_FORMULARIO_PENDENCIAS.md, DESIGN-SYSTEM.md,
                           GUIA_UX_STATUS.md, FISCAL_DIAGNOSTICO_E_ARQUITETURA.md
public/catalogo/           desenhos das peças (pecas/ transparente, pecas-impressao/ fundo branco, 330×190)
.github/workflows/         ci.yml, e2e.yml, aplicar-migrations.yml, smoke-test.yml (de hora em hora), verificar-motor-fiscal.yml
```

---

## 5. Banco de dados

### 5.1 Números **[fato — banco local com as 140 migrações]**
- **112 tabelas** e 14 views em `public`; 222 funções em `public`; 292 políticas RLS.
- **Schemas:** `public`, `auth`, `storage`, `extensions`, `cron`, `net`, `crm_admin` (registro de migrações aplicadas e log técnico do webhook), `crm_private` (funções internas, ex.: `notify_team`, `operations_tick`).

### 5.2 Tabelas por domínio **[fato]**

| Domínio | Tabelas |
|---|---|
| Empresa/usuários | `companies`, `profiles`, `user_roles`, `permissions`, `audit_logs`, `notifications`, `push_subscriptions`, `document_templates`, `integrations` (existe, **não usada** pelo código) |
| Clientes/comercial | `clients`, `client_types`, `lead_sources`, `leads`, `lead_followups`, `pipeline_stages`, `activities`, `followups`, `tasks`, `discount_rules` |
| Orçamentos | `quotes`, `quote_items`, `quote_internal_attachments`, `gutter_quotes`, `gutter_quote_items`, `gutter_prices` (tabela de preços), `pricing_commercial_tables`, `pricing_paints`, `pricing_services`, `pricing_special_parts`, `pricing_change_log`, `aluminum_price_matrix`, `aluminum_cost_settings` |
| Venda/pedido | `sales`, `sale_items`, `sale_types`, `orders`, `order_items`, `order_checklists`, `order_checklist_items`, `order_measure_checks`, `order_aluminum_costs`, `commissions`, `checklist_templates`, `checklist_template_items` |
| Medição/agenda | `measurements`, `measurement_items`, `measurement_checklists`, `operational_events`, `operational_alerts` |
| Produção | `production_orders`, `production_order_items`, `production_materials`, `production_step_logs` |
| Instalação/serviços | `installations`, `installation_checklists`, `service_orders`, `service_photos` |
| Compras/estoque | `suppliers`, `supplier_categories`, `supplier_credits`, `purchase_requests`, `purchase_request_items`, `purchase_orders`, `purchase_order_items`, `purchase_returns`, `materials`, `material_categories`, `stock_locations`, `stock_movements` |
| Financeiro | `financial_entries`, `financial_installments`, `payments`, `financial_categories`, `financial_cost_centers`, `financial_entry_allocations` (rateios), `financial_recurrences`, `financial_recurrence_occurrences`, `receiving_accounts` (contas Pix/banco, saldo inicial), `bank_account_sources`, `bank_statement_imports`, `bank_statement_rows`, **`pix_charges`** (19/11) |
| Fiscal (19/11) | `fiscal_settings`, `fiscal_classifications`, `fiscal_calculations`, `fiscal_calculation_items` |
| WhatsApp/atendimento | `conversations`, `messages`, `conversation_events`, `conversation_labels`, `conversation_label_links`, `quick_replies`, `message_templates`, `outbound_messages`, `whatsapp_channels`, `whatsapp_channel_members`, `whatsapp_webhook_events`, `whatsapp_lid_map`, `whatsapp_health` |
| IA | `ai_agent_config` (1 por empresa: provedor, modelo, chaves criptografadas, Evolution do número principal, modos da Lia), `ai_decisions`, `ai_lia_rules`, `triage_sessions`, `chatbot_sessions`, `lia_automation_executions` |
| Automações | `workflows`, `workflow_executions`, `workflow_webhooks`, `automation_rules`, `campaigns`, `crm_operations_config` (segredo e estado da rotina de 1 min) |
| Arquivos | `files` |

**Views:** `v_financial_entries`, `v_order_overview`, `v_order_pending`, `v_order_result`, `v_order_financials`, `v_order_financial_report`, `v_order_materials`, `v_stock_balance`, `v_supplier_summary`, `v_supplier_credit_balance`, `v_operational_agenda`, `v_operational_alerts`, `v_installation_checklist_alerts`, `v_workflow_analytics`. Todas com `security_invoker`.

### 5.3 Fluxo principal de dados
```mermaid
flowchart LR
  L[lead / conversa] --> C[clients]
  C --> Q[quotes + quote_items]
  Q -->|approve_quote| S[sales + sale_items]
  S --> O[orders + order_items]
  S --> FE[financial_entries receber]
  O --> PO[production_orders]
  O --> PR[purchase_requests → purchase_orders]
  PR -->|receive_purchase_item / receive_purchase_all| SM[stock_movements]
  PR --> FEp[financial_entries pagar]
  O --> I[installations] --> POS[pós-venda]
  FE -->|register_payment*| P[payments → receiving_accounts]
```

### 5.4 Funções críticas (regras no banco) **[fato]**
- `approve_quote` / `approve_quote_unchecked`: orçamento → venda (mesmo número do orçamento; se o número já existir, usa `VEN-…`), pedido, conta a receber, checklist, solicitação de compra e ordem de produção. É idempotente: repetir devolve a mesma venda.
- `revert_quote_approval`: desfaz o que a aprovação criou (com regras para pagamentos estornados).
- `register_payment`, `register_payment_with_adjustment`, `register_payment_with_supplier_credit`, `reverse_payment`, `set_payment_account`: baixas, juros, desconto, parcelas, estorno e conta onde caiu.
- `create_gutter_quote`, `create_window_quote`, `update_gutter_quote`, `delete_draft_quote`.
- Compras: `create_manual_purchase(_unchecked)` (barra duplicata: mesmo fornecedor, total ±R$ 1, mesmos itens em 30 dias, salvo `allow_duplicate`), `receive_purchase_all`, `undo_stock_receipts`, `cancel_purchase_order`.
- Operação: `order_measure_decision`, `order_schedule_measure_check`, `order_finish_measure_check`, `order_validate_measures`, `order_release_cut`, `advance_production_step`, `service_set_status`, `service_schedule`, `service_complete`, `operational_indicators`.
- Financeiro: `cash_overview`, `account_statement`, `financial_report_data`, `set_order_expected_cost`, conciliação bancária e recorrências.
- WhatsApp/IA: `claim_ai_reply` (uma só resposta da IA por mensagem), `record_whatsapp_health`, `collect_unanswered_conversations`, `collect_quote_followups`, `lia_followup_candidates`, `my_whatsapp_channels`.
- Pix: `record_pix_charge`, `confirm_pix_charge`, `cancel_pix_charge`.
- Fiscal: `save_fiscal_calculation` (idempotente), gatilho `fiscal_classification_guard`, `notify_team_service` (só `service_role`).
- Permissões: `has_table_access(recurso, ação)`, `require_table_access`, `has_role(roles[])`, `current_company_id()`, `bootstrap_company(nome, cnpj, usuário)`.

### 5.5 Migrações **[fato]**
- 140 arquivos em `supabase/migrations/`, numerados (`001_…` a `048_…`) e com data (`2026110…` a `20261119170000`).
- Em produção, a aplicação é feita **só pelo workflow** `aplicar-migrations.yml` (manual), que registra em `crm_admin.migrations` e **pula as já aplicadas**.
- Depois de aplicar, o workflow roda `scripts/verificar-banco-producao.sql` (deve voltar vazio) e `scripts/diagnostico-agente-ia.sql`. O diagnóstico só mostra contagens e horários, nunca o conteúdo das conversas.
- **Regra do projeto:** migrações **aditivas** (nunca destrutivas sem aprovação).

---

## 6. Módulos e funcionalidades

> A situação considera testes automatizados, CI e verificações feitas nesta sessão. "Em uso pelo dono" é **[relatado]**.

### 6.1 Casca, navegação e busca
- **Arquivos:** `components/app-shell.tsx`, `command-palette.tsx`, `global-search.tsx`, `breadcrumbs.tsx`, `quick-create-menu.tsx`, `saved-views.tsx`, `notification-center.tsx`, `priority-queue.tsx`, `unsaved-guard.tsx`.
- **Funcionalidades:**
  - menu lateral por grupos recolhíveis (Principal, Operação, Compras e estoque, Financeiro, Sistema), favoritos e recentes;
  - Ctrl+K, botão "+ Novo", trilha de navegação, visões salvas e aviso de alterações não salvas;
  - central de avisos agrupada e "O que fazer agora".
- **Situação:** ✅ (testes `navegacao-ux`, `command-palette`, `quick-create-menu`, `notice-groups`; E2E de rotas).

### 6.2 Dashboard e Pendências
`app/(crm)/dashboard/page.tsx`, `components/dashboard-overview.tsx`, `pending-center.tsx`, `operational-indicators.tsx`. ✅ (E2E de rotas). Os indicadores dependem dos dados reais.

### 6.3 Clientes e pipeline
- **Arquivos:** `client-form.tsx`, `client-phone-field.tsx`, `client-address-fields.tsx`, `pipeline-*.tsx`; ações em `actions.ts` (`createClientRecord`).
- **Funcionalidades:**
  - cadastro que bloqueia duplicado e junta duplicados (PR #48);
  - telefone corrigido para celular de 9 dígitos; "Jaraguá" sempre vira "Jaraguá do Sul";
  - nomes normalizados por `formatRegistrationName` (maiúscula inicial);
  - pipeline com etapas e arraste; ao cadastrar o cliente, já pode lançar no pipeline.
- **Situação:** ✅.

### 6.4 Orçamentos
- **Calhas** (`components/gutter-quote.tsx`, `lib/gutter-quote-pricing.ts`, `gutters.ts`): preço automático da tabela (produto × espessura × corte × cor); calha de beiral com 1 ou 2 pisos; itens especiais; medidor e atendente responsável.
- **Esquadrias** (`components/window-quote.tsx`): itens com produto, linha, medidas, vidro, acessórios, cor, quantidade e valor.
  - **Importar proposta do WVetro** (PR #110): `components/wvetro-import.tsx`, `app/(crm)/wvetro-actions.ts`, `lib/wvetro-proposal.ts`, `lib/pdf-text.ts`. Lê o PDF pelo texto (sem IA) e acha ou cadastra o cliente. Se o PDF não tiver texto, a IA lê como reserva.
  - O WVetro só traz o **total**. O botão "Repartir o total pela metragem" fecha no centavo e liga "esconder unitários". O PDF original vai para os anexos internos.
  - ⚠️ **Pendente com o dono:** a impressão ainda mostra o **total por linha**, que é estimado pela metragem. Ver §14.
- **Documento/PDF:**
  - `components/quote-document.tsx`, `app/api/orcamentos/[id]/pdf` (Chromium na Vercel, cache em `quote-pdfs`), `app/(print)/orcamentos/[id]/impressao`;
  - marca d'água, QR e desenho de cada peça do catálogo 3D (`lib/quote-piece-media.ts`, `lib/marquinhos-catalog.json`, 23 peças; sobrecalha e rufo colarinho adicionados em 19/11);
  - ocultar valor de deslocamento, mão de obra, instalação e visita técnica (o valor é diluído nos demais itens e o total não muda);
  - nome do arquivo "Cliente - ORC-…".
- **Ações:** duplicar, excluir rascunho, marcar como enviado (lança no pipeline), aprovar (gera venda/pedido/financeiro), reverter aprovação, anexos internos, **Simular tributos** (link para `/fiscal`, fora da impressão).
- **Situação:** ✅ (E2E `quote-flow`, `print-a4`, testes de catálogo, WVetro, preços). A importação WVetro foi testada com um PDF real (10 itens, R$ 51.154,78).

### 6.5 Vendas e pedidos
- **Arquivos:** `sale-detail.tsx`, `sale-edit-form.tsx`, `sale-correction.tsx`, `manual-sale-form.tsx`, `order-operation-card.tsx`; `order-operation-actions.ts`, `sale-edit-actions.ts`.
- **Funcionalidades:**
  - venda manual com número `VEN-…`;
  - venda por orçamento com o mesmo número do orçamento;
  - **vendedor vê só as vendas dele** (migração `20261119110000`);
  - etapa do pedido: conferência de medidas → validação (só gerência) → liberação para corte. A produção não avança antes da liberação.
- **Situação:** ✅ (`tests/order-operations.test.ts`, `vendedor-escopo-db`).

### 6.6 Medições, agenda e serviços
- **Agenda:** `agenda-page.tsx`, `mobile-agenda.tsx`, `agenda-actions.ts`; Maps/Waze; ficha de visita A4 (`/ficha`). ✅
- **Serviços avulsos** (`/servicos`, `service-actions.ts`): SRV-…, fotos antes/depois, agendar, concluir e cobrar (cria conta a receber). ✅ (`service-orders.test.ts`, E2E).

### 6.7 Produção
`production-flow-page.tsx`, `order-materials-page.tsx`: ordens, etapas com histórico (`production_step_logs`), voltar etapa, materiais do pedido. Custo automático do alumínio com aproveitamento de bobinas (`lib/aluminum-cost.ts`, PR #87). ✅. ⚠️ Corte/dobra/conferência por responsável com fotos ainda não existe.

### 6.8 Compras, fornecedores e estoque
- **Arquivos:** `compras/nova`, `compras/[id]`, `manual-purchase-form.tsx`, `purchase-edit-form.tsx`, `supplier-credits.tsx`, `invoice-upload.tsx`.
- **Funcionalidades:**
  - nova compra simplificada, **leitura de nota fiscal por IA** (PDF/foto) e previsão;
  - receber tudo ou parte, desfazer várias entradas, devolução de material, cancelar compra;
  - crédito com fornecedor, tela do fornecedor e bloqueio de duplicata.
- **Situação:** ✅ (`compras-lote-db`, `supplier-credits`, E2E). ⚠️ A causa das "entradas duplicadas" relatadas **não foi reproduzida**; o que existe é proteção na criação.

### 6.9 Financeiro
| Funcionalidade | Onde | Situação |
|---|---|---|
| Contas a receber e a pagar, parcelas, juros, desconto, estorno | `financial-page.tsx`, `payment-*.tsx`, `/financeiro/lancamento/[id]` | ✅ |
| Contas de recebimento (Pix/banco), saldo inicial, conta na baixa | `receiving-accounts-manager.tsx` | ✅ |
| Caixa com saldo por conta e projeção em 3 cenários | `/financeiro/caixa`, `lib/cash-flow.ts`, `cash_overview` | ✅ |
| Extrato por conta para imprimir (inclui **cobranças Pix aguardando**) | `/financeiro/extrato`, `account_statement` | ✅ |
| Conciliação OFX/CSV (sem baixa automática) | `/financeiro/conciliacao` | ✅ |
| Recorrências e compromissos na projeção | `/financeiro/recorrencias` | ✅ |
| Categorias, centros de custo, rateio por obra | `/financeiro/classificacoes`, `/financeiro/rateios` | ✅ |
| Resultado por obra (previsto/comprometido/realizado) | `/financeiro/obras`, `v_order_result` | ✅ ⚠️ Mão de obra, impostos e comissões por obra ainda não entram |
| DRE gerencial | `/financeiro/dre` | ✅ |
| Relatórios PDF/CSV com auditoria de exportação | `/financeiro/relatorios`, `/api/financeiro/relatorio` | ✅ |
| **Cobrança Pix registrada** (19/11) | `components/pix-charge.tsx`, `pix-charge-actions.ts`, `account-pix-charges.tsx` | ✅ teste de banco e tela local; ❓ envio real pelo WhatsApp não testado |

### 6.10 Tributos — calculadora fiscal (19/11) **[fato]**
- **Arquivos:** `/fiscal` (`app/(crm)/fiscal/page.tsx`, `components/fiscal-page.tsx`), `app/(crm)/fiscal-actions.ts`, `lib/fiscal/{motor,calculadora,export}.ts`, `app/api/fiscal/exportar`, migração `20261119170000`.
- **Abas:**
  - **Calculadora:** orçamento + data → CBS/IBS/IS por item, memória de cálculo e gravação no histórico;
  - **Classificações:** NCM ou NBS, CST, cClassTrib e unidade por produto. Aprovam financeiro, gerência ou administrador; mudar um código tira a aprovação;
  - **Histórico:** por mês, lista e CSV para o contador;
  - **Configuração:** começa **desligada**; regime, UF, IBGE, alíquotas informadas por ano com fonte e teste do motor.
- **Motor:** instalação online oficial (`https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api`), conferida em 19/11 pelo workflow "Verificar motor fiscal": versão 1.7.2, base V0073, exemplo oficial igual ao publicado. Se cair, a tela mostra "indisponível" e **nunca** calcula por conta própria.
- **Situação:**
  - ✅ testes do adaptador com respostas reais gravadas, da montagem e do banco;
  - ✅ fluxo completo na tela local, com o motor oficial 1.6.1 local (ORC de R$ 1.500 → CBS 13,50 e IBS 1,50 em 2026);
  - ❓ uso em produção: o financeiro ainda precisa configurar e classificar.
- **Emissão de NF-e/NFS-e:** ❌ (**pausada** por decisão do dono).

### 6.11 Atendimento (WhatsApp)
- **Arquivos:** `components/atendimento-page.tsx` (com cara de WhatsApp), `atendimento-actions.ts`, `inbox-attachments.tsx`, `quick-replies.tsx`, `conversation-labels.tsx`, `pix-charge.tsx`, `whatsapp-channels.tsx`, `whatsapp-connect.tsx`, `lib/whatsapp/*`.
- **Funcionalidades:**
  - **Conversas:** mídia (foto, áudio, vídeo, documento), notas internas, transferência, status, busca no histórico, etiquetas;
  - **Fila e tempo:** filtro "Sem resposta", tempo de espera, lembrete de 2 h;
  - **Envio:** respostas prontas, reenviar, envio idempotente com estado "desconhecido";
  - **Ficha do cliente** com financeiro, orçamento a partir da conversa e cobrança Pix.
- **Vários números** (`whatsapp_channels`): cada usuária lê o QR do seu número, que só ela, os autorizados e a gerência veem. **A Lia só atende o número principal.**
- **Tela "WhatsApp"** (`/atendimento/canais`): números, conexão principal, saúde, mensagens recentes e **botão "Reiniciar conexão"**.
- **Situação:**
  - ✅ testes de banco e E2E;
  - 23/11: recebimento em dia (última mensagem 1–3 min antes de cada diagnóstico, 434 recebidas em 24 h);
  - não lidas contam também mensagens atrasadas ou recuperadas pela reconciliação (marca `read_through_at`);
  - reações, citações, envio de vídeo/Word/Excel/DWG (16 MB) e mídia do 2º número funcionando (#130, #131);
  - vigia com teste ativo e conferência do webhook a cada hora; painel de saúde por número na tela WhatsApp;
  - notas, mensagens e ações isoladas por número no banco (RLS + `inbox_conversation`).

### 6.12 IA — Central de IA, Lia e JARVIS → ver §10.

### 6.13 Automações
`/automacoes` (`automations-hub.tsx`, `workflow-builder.tsx`, `automation-settings.tsx`), `workflows`, `automation_rules`. ⚠️ O construtor existe (E2E salva rascunho), mas o uso real em produção **não foi verificado** ❓. O despacho de mensagens agendadas é feito por `pg_cron` (`crm-bielenki-whatsapp-dispatcher`, a cada 5 min).

### 6.14 Configurações e administração
- **Telas:**
  - funcionários e usuários (`employees-page.tsx`);
  - cargos (`roles-page.tsx`, matriz `permissions`);
  - identidade da empresa (logo, cores, rodapé, QR);
  - templates, origens de lead, tabela de calhas e central de preços (`pricing-center.tsx`, `pricing-spreadsheet.tsx`, matriz de alumínio);
  - auditoria (`audit-log-page.tsx`) e guia visual (`/design-system`).
- **Situação:** ✅ (E2E `remaining`, `forms`).

### 6.15 Equipes, veículos e carregamento (23/11)
**24/11 — TrackCEO:** `/equipes/rastreamento` adiciona conexão protegida, vínculo de rastreadores à frota e mapa da última posição. Somente administrador/gerente, credenciais criptografadas em schema privado, consultas manuais e integração inicialmente desligada. Sem comandos nos rastreadores. Manual e limites em `docs/INTEGRACAO-TRACKCEO.md`.

`/equipes` (`work-planning-page.tsx`, `work-planning-actions.ts`, `lib/work-planning.ts`). Tabelas `work_teams`, `work_team_members`, `work_vehicles`, `work_days`, `work_day_members`, `work_day_jobs`, `work_load_items` e `work_load_events`. Gerência planeja; produção/estoque conferem; equipe externa acompanha e confere suas saídas. Usa a agenda existente, snapshots do dia, reservas exclusivas e checklist físico auditado. Sem cadastros ou operações automáticas. Detalhes em `docs/PROPOSTA-EQUIPES-VEICULOS-2026-11-23.md`.

---

## 7. APIs e integrações

### 7.1 Rotas HTTP (`app/api`) **[fato]**

| Rota | Método | Autenticação | Função |
|---|---|---|---|
| `/api/whatsapp/webhook` | GET/POST | Segredo Evolution (`x-webhook-secret`) ou assinatura Meta; fica fora do middleware | Recebe mensagens, recibos, contatos e conexão; grava antes da IA; Lia |
| `/api/whatsapp/media/[id]` | GET | Sessão (checada na rota) | Mídia do chat |
| `/api/whatsapp/import-history` | POST | Sessão | Importa o histórico da Evolution |
| `/api/whatsapp/evolution-url` | POST | Segredo | O PC ou túnel avisa o endereço da Evolution (legado) |
| `/api/internal/operations` | POST | `Bearer` = `crm_operations_config.cron_secret` (comparação em tempo constante) | Rotina de 1 min (§10.4) |
| `/api/orcamentos/[id]/pdf` | GET | Sessão + permissão `quotes` | PDF A4 (Chromium) com cache |
| `/api/financeiro/relatorio` | GET | Sessão + `financial_exports` | PDF/CSV de relatórios, com auditoria |
| `/api/fiscal/exportar` | GET | Sessão + `fiscal` | CSV das simulações fiscais |
| `/api/notifications` | — | Sessão | Avisos e push |
| `/api/servicos/foto/[id]` | GET | Sessão | Fotos dos serviços |
| `/api/proxy-image` | GET | Sessão | Proxy de imagens (logos e QR) |

### 7.2 Integrações

| Integração | Situação | Detalhes |
|---|---|---|
| **Supabase** (Postgres/Auth/Storage/pg_cron/pg_net) | ✅ operacional | Buckets privados: `quote-pdfs`, `company-assets`, `atendimento-files`, `service-photos` |
| **Evolution API** (WhatsApp não oficial, Baileys) **v2.3.7** | ⚠️ operacional, com travamentos | Servidor na **Hospede Aqui** (Docker) [relatado]. Já houve tentativas em PC Windows e Oracle (scripts em `lib/whatsapp/evolution.ts`). 2 números: "WhatsApp principal" e "Número da Calha". Webhook com segredo; reconciliação a cada minuto; **vigia** (§10.4) |
| **WhatsApp Cloud API (Meta)** | ⚠️ código existe | Suportado no webhook e no envio; **não é o canal principal** hoje |
| **Claude (Anthropic)** | ✅ configurado [diagnóstico: chave criptografada presente] | Provedor da Lia (`ai_provider = anthropic`, modelo `claude-sonnet-5-5` no diagnóstico de 19/11); leitura de notas e propostas |
| **Google Gemini** | ✅ chave presente [diagnóstico] | Transcrição de áudio (`lib/ai/transcribe.ts`); alternativa na leitura de notas e propostas |
| **Groq / OpenAI / Ollama** | ⚠️ suportados | Groq com chave presente; OpenAI sem chave; Ollama por `OLLAMA_API_KEY` |
| **Calculadora da Receita (Regime Regular)** | ✅ (simulação) | Online oficial; motor próprio é plano B (Fly.io, ~US$ 7–11/mês, **não contratado**) |
| **JARVIS** | ⚠️ app separado | `https://jarvis-ai-crm-bielenki.vercel.app` (link no menu para gerência). Usa RPCs do mesmo banco (migrações `20261116210000_lia_status_jarvis`, `20261118100000_jarvis_agendar_medicao`: buscar cliente e agendar medição). **O código do JARVIS não está neste repositório** ❓ |
| **Catálogo 3D de peças** | ✅ | Site `marquinhos-calhas.vercel.app` (repositório `anderrsc/tabela-e-3d---marquinhos-calhas`); o orçamento mostra desenho e QR |
| **WVetro** | ✅ importação de PDF | Sem API; leitura do PDF da proposta |
| **E-mail** | ❌ | Não há serviço de e-mail integrado (só o Supabase Auth) ❓ |
| **"Bielenki Workspace"** | ❓ | **Não há referência no código.** "workspace" aparece só como nome de componente (`quote-workspace.tsx`, `lib/sales/workspace.ts`) |
| **Web Push** | ✅ | `web-push` + chaves VAPID em `crm_operations_config` |

---

## 8. Regras de negócio

### 8.1 Comerciais e operacionais (Lia e sistema) **[fato — `lib/ai/lia-knowledge.ts`, `lia-rules.ts`]**
- **Entrada e saldo:** **50%** de entrada, normalmente Pix ou dinheiro. Saldo no Pix ou dinheiro, ou cartão de crédito em até **6x** com parcela mínima de **R$ 200**.
- **Exceções:** cartão na entrada e exceções só com aprovação de administrador ou gerente; boleto só para empresas [relatado: `docs/LIA_FORMULARIO_PENDENCIAS.md`].
- **Desconto e validade:** desconto máximo de **3%**, e a Lia **nunca** concede desconto nem informa preço. Validade do orçamento: **10 dias** no texto da Lia. No sistema, `companies.default_validity_days` tem padrão **7** (migração `20261105190000_validade_padrao_7_dias.sql`) ⚠️ divergência.
- **Prazos:**
  - calhas: **24 h** para retirada; **48 h** para cobertura, platibanda, centrais e coletoras;
  - rufos e pingadeiras: **20 dias**;
  - esquadrias: **40 dias** após as medidas finais e a entrada.
- **Garantias:** calhas, esquadrias, vidros e box **12 meses**; portões e cercas **6 meses**.
- **Atendimento humano:** segunda a quinta, 07:30–12:00 e 13:00–17:30; sexta, 07:00–12:00.
- **Cidades:** cidades atendidas e cidades de calha padrão estão em `lia-knowledge.ts`. "Jaraguá" sempre vira "Jaraguá do Sul".
- **Escopo:** não faz calhas galvanizadas, esquadrias de PVC nem manutenção de calhas de terceiros.
- **Orçamento de calhas:** a Lia pede calhas e rufos por **metragem e largura**, nunca por unidade.

### 8.2 Orçamento → venda **[fato]**
- A aprovação gera venda, pedido, conta a receber, checklist, compra e produção; o número da venda é o mesmo do orçamento.
- Orçamento aprovado não mostra "Editar" nem "Excluir"; só "Reverter aprovação", que desfaz tudo com regras.
- No impresso, deslocamento, mão de obra, instalação e visita técnica podem ser ocultados e diluídos nos demais itens; **pintura sempre aparece** (decisão do dono).
- Proposta WVetro: o preço por item é estimado pela metragem, só para fechar no total.

### 8.3 Financeiro **[fato]**
- **Baixa:** escolhe a conta. O caixa considera baixas a partir da data do saldo inicial de cada conta.
- **Conciliação bancária:** **não** dá baixa automática.
- **Cobrança Pix:**
  - enquanto "aguardando", **não** entra no saldo;
  - ao confirmar: se for de orçamento, exige o orçamento aprovado e baixa a conta a receber da venda; se for avulsa, cria a conta a receber e já baixa;
  - valor maior que o saldo em aberto é barrado;
  - cancelar não mexe no financeiro.
- **Recorrências:** criadas por competência, sem pagamento automático.
- **Tributos:** os tributos simulados **nunca** viram despesa nem lançamento.

### 8.4 Fiscal **[fato + decisões do dono]**
- **Classificação:** só itens com classificação **aprovada** vão ao motor; o resto vira pendência. **Nunca inventar** NCM, CST, cClassTrib nem alíquota.
- **2026:** a base oficial tem CBS 0,9%, IBS UF 0,1% e IBS municipal 0%.
- **2027:** a base oficial **não tem** alíquota. Só se calcula com alíquota informada **com fonte**, e o resultado sai "simulado".
- **Município:** Jaraguá do Sul = IBGE **4208906** (conferido na base oficial).
- **Emissão:** pausada.

### 8.5 Compras/estoque **[fato]**
- Compra duplicada (mesmo fornecedor, ±R$ 1, mesmos itens, 30 dias) é barrada, salvo confirmação.
- Cancelar compra tira o material do estoque e cancela a conta a pagar. Fica bloqueado se houver pagamento, devolução ou material já usado.
- Nada é apagado fisicamente; a trilha fica em `audit_logs` e `stock_movements`.

### 8.6 Ações que exigem aprovação humana **[fato + relatado]**
- **Gerência:** validar medidas (só gerência); aprovar regra crítica da Lia e exceções de pagamento (administrador ou gerente).
- **Financeiro, gerência ou administrador:** aprovar classificação fiscal.
- **Confirmação no sistema:** confirmar o recebimento de Pix e dar baixas (nada é baixado sozinho).
- **Lia:** em modo semiautomático, a sugestão vai para a equipe aprovar; o pré-orçamento sempre exige aprovação humana [relatado].
- **Proibições fixas:** **nunca** enviar WhatsApp real em testes; **nunca** movimentar dinheiro automaticamente.

---

## 9. Usuários e permissões

### 9.1 Modelo **[fato]**
1. **Empresa:** `current_company_id()` (de `profiles.company_id`) em todas as políticas RLS. Isolamento provado por `tests/rbac-isolation-db.test.ts`, que cobre todas as tabelas com `company_id`.
2. **Cargo:** `user_roles` (vários cargos por usuário) + `permissions` (cargo × recurso: ver, criar, editar, excluir). `has_table_access` lê a matriz. **Administrador e gerente sempre têm acesso total** à própria empresa.
3. **WhatsApp:** a conversa só aparece ao dono do número, aos autorizados e à gerência (`my_whatsapp_channels()`).
4. **Vendedor:** vê só as próprias vendas. Quem tem também outro cargo vê todas.
5. **Gerente** não altera cargo de administrador.

### 9.2 Matriz
Ver `docs/MATRIZ_RBAC.md`, que traz a tabela completa extraída do banco em 19/11. Resumo:
- **Financeiro:** VCE em financeiro, pagamentos, conciliação, recorrências e vendas.
- **Vendedor e atendente:** VCE em clientes, conversas, leads, orçamentos e vendas; sem financeiro.
- **Compras:** compras, fornecedores e estoque.
- **Estoque e produção:** VE em produção e estoque.
- **Instalador:** VE em instalações.
- **`fiscal` (19/11):** financeiro VCE, vendedor VC (só simula), demais sem acesso.

### 9.3 Decisões pendentes de permissão **[fato — MATRIZ_RBAC]**
- Atendente: deve ver só as conversas atribuídas? (hoje vê as dos números que acessa)
- Quem pode exportar ou imprimir com valores?

---

## 10. Inteligência artificial e automações

### 10.1 Central de IA (`/central-ia`, `components/ai-central.tsx`) **[fato]**
- Escolha de provedor e modelo; chaves criptografadas (salvar não sobrescreve com o valor mascarado — PR #101).
- Modos da Lia, regras aprendidas, acompanhamento de leads; a conexão WhatsApp foi movida para a tela "WhatsApp".

### 10.2 Lia — IA de atendimento no WhatsApp (antes "Ana")
- **Fluxo [fato]:**
  1. o webhook grava a mensagem;
  2. só **contato novo** (sem `client_id`), com a Lia ativa, conversa não assumida, **número principal** e **fora de grupos**;
  3. um prompt devolve JSON de triagem (`analise`, `mensagem`, `dados_coletados`, `triagem_concluida`, `prioridade`, `score`);
  4. a resposta segue o modo: assistente, semiautomático ou automático, com horário e limite diário;
  5. `claim_ai_reply` garante uma só resposta;
  6. ao concluir a triagem, cria o lead.
- **Recursos:**
  - **fatos oficiais versionados** no código (`lia-knowledge.ts`) e regras de pagamento e prazo em código (`lia-rules.ts`);
  - **áudio transcrito** pelo Gemini;
  - **opt-out** ("parar de receber");
  - **regras aprendidas** com aprovação, versão e reversão (`ai_lia_rules`); decisões registradas em `ai_decisions`.
- **Acompanhamento automático de lead** (24 h, até 3 tentativas, só no expediente, limite diário): implementado e **desligado por padrão** (`ai_agent_config.lia_followups_enabled = false`).
- **Situação:** ✅ triagem por texto (em uso [relatado]).
- **Ainda não feito:** ⚠️/❌ pré-orçamento pela tabela de preços, análise de foto e PDF, ferramentas tipadas, fila de aprovações, lembrete de visita, aviso de pedido pronto, pós-venda (avaliação Google), encerramento de sessão em 2 h e resumo diário. Ver `docs/LIA_DIAGNOSTICO_E_PLANO.md` e `docs/LIA_FORMULARIO_PENDENCIAS.md`.
  - **O formulário de pendências (§B–E) ainda não foi respondido pelo dono.**

### 10.3 JARVIS
Assistente interno da gerência, em **aplicativo separado** (link no menu, aba "Sistema"). Neste banco existem RPCs de busca de cliente, agendamento de medição e status da Lia para ele. ❓ O código, os agentes e os recursos do JARVIS não estão neste repositório.

### 10.4 Rotina agendada de 1 minuto (`lib/operations.ts`) **[fato]**
- **Disparo:** `pg_cron` chama `crm_private.operations_tick()`, que faz `net.http_post` para `/api/internal/operations` com segredo.
  - O agendamento do `operations_tick` **não está nas migrações** (foi configurado no banco de produção). Que ele roda a cada minuto foi comprovado pelo diagnóstico ("operações última execução" atualizando).
- **Para cada número:**
  - grava o estado da conexão (`evolution connectionState`) e a saúde (`record_whatsapp_health`): 2 falhas seguidas avisam "WhatsApp desconectado";
  - **vigia** (PR #112): conexão `open` sem nenhum evento de **mensagem** há 20 min, de segunda a sábado entre 7h e 20h → `POST /instance/restart` (fallback PUT), no máximo 1 vez a cada 45 min, com auditoria `AUTO_RESTART` e aviso à gerência;
  - reconciliação: até 5 páginas de mensagens recentes da Evolution.
- **Depois:** acompanhamento da Lia (se ligado), lembrete de orçamento sem resposta (3 dias), conversas sem resposta há mais de 2 h e envio de push.
- **Outros agendamentos:**
  - `pg_cron` `crm-bielenki-whatsapp-dispatcher` a cada 5 min (mensagens agendadas);
  - GitHub Actions `smoke-test.yml` de hora em hora.

---

## 11. Interface e experiência do usuário

- **Identidade:** marca Marquinhos (logo em `public/brand/original/marquinhos-logo.svg`), vermelho de destaque (`#d71920` / `brand-strong`), **só tema claro** (o modo escuro foi removido por decisão do dono). Tokens em `app/brand-tokens.css` e `app/marquinhos.css`; guia em `docs/DESIGN-SYSTEM.md` e na tela `/design-system`.
- **Layout:** barra superior de 64 px (busca Ctrl+K, + Novo, favorito, avisos, usuário); menu lateral recolhível por grupo; cartões (`.card`), campos (`.field`), botões (`.button`, `.button-ghost`), rótulos (`.label`); abas segmentadas.
- **Componentes reutilizáveis:**
  - `module-table.tsx` (listas), `status-badge.tsx`, `timeline.tsx`;
  - `confirm-button.tsx` com `ui-feedback/confirm.tsx` (título conforme a ação: só exclusão diz "Confirmar exclusão");
  - `ui-feedback/toast.tsx`, `submit-button.tsx`, `client-select.tsx` (busca no servidor), `check-all.tsx`, `saved-views.tsx`;
  - skeletons e `loading.tsx`.
- **Celular:** `mobile.css`, barra inferior (Clientes/Orçamento/Agenda), agenda móvel e Atendimento responsivo (E2E `mobile.test.mjs`).
- **Impressão:** `quote-paper.css` (A4), ficha de visita e extrato.
- **Atendimento:** visual de WhatsApp Web (lista, conversa e ficha lateral).
- **Pendências de UX:** ver `docs/GUIA_UX_STATUS.md`.
  - Regressão visual A4 dos orçamentos depois das mudanças de ocultação: não refeita ⛔ [RELATORIO_AUDITORIA].
  - Total por linha na proposta WVetro: decisão pendente.

---

## 12. Histórico de desenvolvimento

- **25/11 — validação das políticas herdadas:** migração aditiva `20261125110519` envolve `auth.uid()` em subconsulta nas políticas `lia_requests_update` e `lia_sessions_own`, preservando os predicados e permissões existentes. Corrige a verificação RLS da suíte completa após atualizar com a main. Teste de isolamento das sessões por dono e verificação de produção regenerada.

- **25/11 — integração da entrega de duração com a main atual:** PR #152 atualizado com as entregas já publicadas por outras sessões. Verificação de banco regenerada incluindo o novo recibo (a confirmação legada foi desativada por essa entrega). Corrigidas regressões herdadas que impediam o CI: contexto de permissões consulta perfil ativo e `current_user_roles`, sem a coluna inexistente `profiles.role`; tipografia da interface alinhada aos testes existentes; teste de histórico cobre leitura reversa, limite e recuperação sem duplicação. Sem novos recursos da Lia.

> Fonte: `git log` da `main` (321 commits, de 04/11/2026 a 19/11/2026), PRs #46–#115, `CONTINUIDADE.md` e documentos em `docs/`. As datas são as dos merges.

| Período | Entregas principais |
|---|---|
| 04–05/11 | Catálogo Marquinhos e peças 3D no orçamento; tirar peças fora de linha; excluir orçamento; marcar enviado → pipeline; vendedor e medidor no orçamento; ocultar deslocamento e unitário; juntar clientes duplicados; calha de beiral 1/2 pisos; nome do PDF com cliente |
| 07–09/11 | Atendimento estilo Octadesk e WhatsApp (Evolution) com conexão pela Central de IA; "Ana" virou **Lia**; importar histórico; mídias; respostas prontas; contas de recebimento; **Cobrar via Pix (só mensagem)**; agenda e celular; testes de permissões, pagamentos e A4 |
| 10–12/11 | Pipeline organizado; busca ao digitar; correções de Evolution e segurança da IA; checkup completo (#64); orçamentos e IA mais rápidos (#65); categorias, centros de custo, rateio por obra (#67, #69); produção automática e DRE (#70) |
| 13/11 | **Financeiro:** caixa por conta (#71), conciliação OFX/CSV (#72), recorrências (#73), relatórios PDF/CSV (#74), resultado por obra (#75) |
| 15–16/11 | Pós-venda operacional (medidas, liberação para corte, Serviços, painel) (#76); correção de mensagens @lid e sincronização (#83–#86); custo do alumínio por bobina (#87); regras aprendidas da Lia (#78) |
| 17/11 | Estorno de baixa e telas financeiras restritas (#88); crédito com fornecedores e nova compra simples (#89); tela da conta e do fornecedor (#90); corrigir lançamentos errados (#92); desfazer estoque e etapa (#93) |
| 18/11 | Lia: modos e sugestões (#79); atendimento com notas e transferências (#80); segurança (cabeçalhos, erros ocultos, limite de IA) (#95); JARVIS medição (#96); devolução de material (#97); **nota fiscal por IA** (#98); PDF sem borrões (#99); Claude/Gemini (#100); chaves não sobrescritas (#101); **WhatsApp fase 1 e 2** (confiabilidade e vários números) (#102, #103); Atendimento "Sem resposta" e recuperação (#104); interface com movimento, Ctrl+K e linha do tempo (#105) |
| 20/11 | (Outra sessão) Fases 1–5 da auditoria geral: histórico de conexão do WhatsApp, alertas de desconexão, fotos nas etapas da produção, pós-venda estruturado, mão de obra e insumos por obra, painéis por função. Migrações aplicadas; o CI da `main` ficou vermelho e foi corrigido em 23/11 (#126) |
| 23/11 | Horário de hoje no Atendimento igual ao WhatsApp + CI verde de novo + painéis de produção/instalação corrigidos (#126); fotos em álbum (#127); peça **Calha platibanda com pingadeira** no CRM (#128) e no site 3D; **Manta asfáltica** e "outro item" digitado no orçamento (#129); **auditoria do WhatsApp** (relatório no chat) e correções: não lidas após atraso/recuperação, mídia do 2º número, aprovação da Lia para @lid, isolamento por número (#130); vigia com teste ativo, conferência do webhook, envios sem confirmação, reações, citações, envio de vídeo/Word/Excel/DWG, painel de saúde por número e endereço completo no "Novo cliente" (#131); Lia roda depois de responder ao webhook (#132); linhas do vigia no diagnóstico (#133); **"Responder" citando mensagem** no Atendimento (#134); WVetro impresso só com o total geral, validade de 10 dias, fotos privadas por etapa da produção, deduplicação por número (P10) e **equipes, veículos e carregamento** (#136–#139); mensagens de empresas (modelo/botões/lista) aparecem (#140) |
| 19/11 | Auditoria multiusuário, compras em lote, cancelamento, vendedor só suas vendas, etiquetas, lembrete 2 h, regras da Lia, áudio e acompanhamento (#106); tema só claro e refino (#107); menu recolhível, sobrecalha e rufo colarinho (#108, #109); **importação WVetro** e confirmação correta (#110); **cobrança Pix registrada** (#111); **vigia do WhatsApp** (#112); **fiscal**: diagnóstico (#113), verificação do motor (#114), **calculadora** (#115) |

### Decisões e descartes registrados
- **24/11 — duração de instalação e OS por equipe, autorizado pelo dono:** estimativa interna nas criações de calhas/esquadrias e na ficha do orçamento, sem aparecer no impresso/PDF do cliente. Jornada padrão de 8 h por equipe com ajuste por dia e reserva explícita de tempo. Sugestão usa instalações da agenda e saídas existentes, horários e tempo livre, com revisão/seleção e confirmação manual. Banco revalida o lote atomicamente, sem sobrecarga, sobreposição ou alocação duplicada. Sem criação automática de compromissos, envio de mensagens ou operações financeiras. Mudança da estimativa marca visitas futuras herdadas para revisão; tempo específico da visita pode ser ajustado. OS interna A4 por equipe em `/equipes/[id]/ordem-do-dia`, com a mesma autorização da saída. Migração aditiva `20261124183741`, verificação de produção regenerada. Serviços longos/sem duração ficam para planejamento manual; não divide instalações entre dias automaticamente. Manual em `docs/DURACAO-INSTALACAO-PLANEJAMENTO.md`.
- **24/11 — correção do login TrackCEO após #149:** o quadro incorporado voltava ao login real e foi substituído por janela própria, aberta pelo botão do painel no CRM. A sessão normal do portal foi conferida com seis veículos. A janela mantém a sessão normal e fica aberta ao navegar no CRM; novo clique localiza ou reabre, com alternativa em nova guia se bloqueada. `opener` desligado antes da navegação; sem leitura/cópia de senha, URL, cookies, tokens ou GPS. O CRM informa apenas a abertura, sem afirmar login concluído. Testes cobrem bloqueio, foco, reabertura, isolamento e login completo no portal fictício com cookie Lax e recarregamento. Sem migração ou alteração de proteções do navegador. A entrada anterior sobre o quadro descreve a tentativa substituída; abrir o login não comprovou autenticação.
- **24/11 — painel TrackCEO dentro do CRM, pedido pelo dono:** botão “Abrir painel TrackCEO” em Rastreamento abre o próprio portal em `/equipes/rastreamento?painel=1`, após a mesma autorização de administrador/gerente. Sem coleta de senha, token, localização ou dados pelo CRM nessa modalidade. Sessão do site depende do navegador; não sincroniza cadastros. Origem fixa, referrer omitido, isolamento do quadro e alternativa em nova guia. Teste real de exibição mostrou o login do portal dentro da página, sem alteração da conta. API continua desconectada por recusa 10007 na autenticação; o painel não usa a API. Testes de acesso e conteúdo, E2E mobile com portal fictício, sem migração.
- **24/11 — diagnóstico TrackCEO após recusa:** o primeiro acesso real foi recusado e a integração permanece desconectada. A mensagem anterior agrupava quatro recusas; o retorno agora distingue o código oficial e a etapa (autenticação, lista ou localização), sem ecoar mensagens, conta, senha, token, IMEI ou URL do fornecedor. Código 10007 não prova bloqueio da API nem restrição por IP. Testes cobrem as quatro recusas nas três etapas e o retorno autenticado. A resposta antiga não guardou o código; o dono precisa repetir a conexão na tela protegida para obter o diagnóstico exato. Sem trocar endpoints, reutilizar tokens do portal ou ampliar permissões.
- **24/11 — integração TrackCEO aprovada pelo dono:** implementados conexão protegida, mapa e vínculo à frota existente; reutiliza `integrations`, sem dados reais até o dono conectar a conta. GPS restrito à gerência; senha/token criptografados no servidor, consultas com trava por empresa e erro sem exposição de segredos. Posição atrasada não sobrescreve GPS mais recente; desconectar preserva os dados. Migração aditiva `20261124162014`, verificação de produção regenerada, testes de API/serviço/RLS/tela e E2E local em build de produção (375 px), usando apenas provedor e usuários fictícios. Nenhum comando de rastreador, WhatsApp real, baixa de estoque ou movimento financeiro.
- **23/11 — validação final de equipes:** E2E local em build de produção passou no celular (375 px): criar saída, selecionar visita, incluir ferramenta, separar/carregar/devolver e cancelar sem apagar o histórico. Formulários usam POST autenticado com validação de origem e retorno 303 para preservar a lista após envios consecutivos; membro removido fica somente com leitura. Incluídos testes da rota e dos controles da tela.
- **23/11 — conferência às 18:05:** diagnóstico de produção verde, banco em dia, canais abertos e zero falhas seguidas; `webhook_ok` renovado até 17:21. Sem `probe_ok`/`probe_failed`; últimos eventos às 17:55 e 18:04, sem 20 minutos de silêncio na coleta. Vigia ainda depende dessa observação natural. Equipes/veículos/carregamento publicados no PR #139; Typecheck e 887 testes locais passaram, incluindo isolamento, reservas, agenda, snapshots e retornos. Advisors sem apontamentos nas novas tabelas.
- **23/11 — WhatsApp P10:** deduplicação inclui o canal, mantendo IDs externos brutos e os dados existentes. Recibos, reações, citações, ecos e histórico também ficam no número de origem. Diagnósticos às 15:06/15:28: conexão e rotina em dia, zero envios sem confirmação, `webhook_ok` presente; sondas após 20 min de silêncio ainda pendentes. Avaliação da edição cifrada na Evolution 2.3.7 registrada em `docs/AUDITORIA-WHATSAPP-2026-11-23.md`, §10, sem alterar o provedor ou a Lia.
- **23/11 — validade e fotos:** padrão de orçamento alinhado para 10 dias (empresas com 7 passam a 10; prazos personalizados e orçamentos existentes preservados). Fotos por etapa ligadas à Produção e à galeria do pedido, bucket privado, URLs temporárias, validação de imagem e permissão no RPC; arquivamento preserva arquivo e registro. Verificação de produção regenerada em PostgreSQL isolado.
- **23/11 — equipes, veículos e carregamento:** dono aprovou o modelo. Implementado `/equipes`, menu Operação e link na Agenda; cadastro de equipe/membros com histórico, frota, motorista e membros do dia, visitas das instalações/medições existentes e checklist físico com autor/horário/retorno. Reservas impedem pessoa, equipe ou veículo em duas saídas no mesmo dia. Reagendamento, cancelamento e inativação exigem revisão; histórico preservado, sem baixa automática de estoque/financeiro. Migração aditiva `20261123204303`, RLS por empresa e alocação, RPC autenticada e testes de banco, ações, tela e celular. Modelo e limites em `docs/PROPOSTA-EQUIPES-VEICULOS-2026-11-23.md`.
- **23/11 — conferência das fotos no CI:** migração adicional otimiza a avaliação das permissões RLS por consulta; verificação de produção regenerada e políticas verificadas em PostgreSQL isolado.
- **23/11 — WVetro e impressão:** propostas importadas e orçamentos com `hide_unit_prices=true` mostram itens, medidas e somente o total geral, sem unitário nem total por linha. A importação marca a opção sempre; PDFs usam nova versão de cache. Cobertura de renderização, importação e E2E `print-a4`.
- **23/11 — prioridades do dono:** calculadora fiscal pausada; emissão de notas, resultado por obra completo, alçadas e relatório de compras duplicadas ficam para o futuro. Pix funciona. O dono atualizará o formulário da Lia; não implementar mudanças da Lia antes disso.
- **Lia:** só contato novo e só número principal; não responde grupos; mensagens automáticas com limites e desligadas por padrão; áudio sim.
- **Tema:** só claro.
- **Vendas e impressão:** vendedor só vê as próprias vendas; venda manual continua VEN-; pintura com valor no impresso.
- **Empresa:** só a Marquinhos usa o sistema (multiempresa por usuário **descartada**).
- **Fiscal:** emissão de nota **pausada**; o financeiro **continua** normal; quem aprova a classificação é o **financeiro**; motor da Receita online em vez de servidor próprio (Fly.io cotado como plano B, não contratado).
- **Rufo para Chaminé = Rufo colarinho** (mesma peça).
- Duas sessões de IA (Codex e Claude) já trabalharam no repositório. Um rascunho duplicado de conciliação e recorrências ficou só em `git stash` local e **não deve ser publicado** [CONTINUIDADE.md].

---

## 13. Bugs e problemas conhecidos

| # | Problema | Gravidade | Impacto | Evidência | Causa provável | Solução recomendada |
|---|---|---|---|---|---|---|
| B1 | 🐛 **WhatsApp para de receber mensagens** com a conexão "aberta" | **Crítica** | O Atendimento fica sem mensagens novas (19/11: principal sem mensagens desde 15:04, Calha desde 15:40) | Diagnóstico de produção em 19/11 às 16:26, 16:43 e 16:49 | Sessão Baileys "zumbi" na Evolution 2.3.7 (não recebe nem mesmo pelo findMessages). Às 16:45 o servidor ficou "unreachable" e voltou | Vigia e "Reiniciar conexão" publicados (#112). **Confirmar eficácia.** Se o reinício não resolve: conferir "Aparelhos conectados" no celular e ler o QR de novo. Avaliar servidor e versão da Evolution, ou a API oficial da Meta |
| B2 | ✅ Resolvido (20/11): `connection.update` grava em `whatsapp_connection_history` | — | — | — | — | — |
| B3 | ⚠️ Causa das "entradas duplicadas" de compras não reproduzida | Média | Pode voltar a ocorrer | RELATORIO_AUDITORIA D | Desconhecida | Relatório de duplicatas suspeitas |
| B4 | ⚠️ Proposta WVetro mostra o total por linha estimado | Baixa/Média | O cliente vê valores por item que não vêm do WVetro | Teste local de 19/11 | Escolha de implementação | Esperar a decisão do dono (só itens + total geral?) |
| B5 | ⚠️ Corrida real entre conexões em `approve_quote` não exercitada | Baixa | Aprovação dupla simultânea | Teste com uma conexão só | — | Teste com conexões paralelas |
| B6 | ⚠️ Políticas RLS atribuídas a `public` (inclui `anon`) | Baixa | Defesa em profundidade | `pg_policies` (A6) | Histórico | Migrar para `to authenticated` |
| B7 | ⚠️ Teste E2E de funcionários era instável | — | **Corrigido** (#108: o nome do teste é normalizado) | — | Nome com maiúscula inicial | — |
| B8 | ❓ A rotina `operations_tick` é agendada fora das migrações | Média | Uma recriação do banco perderia o agendamento | Não há `cron.schedule` para ela nas migrações | Configuração manual | Documentar ou criar migração idempotente de agendamento |
| B9 | ⚠️ Validade padrão do orçamento: Lia diz 10 dias, histórico diz 7 | Baixa | Divergência de comunicação | `lia-knowledge.ts` × migração `20261105190000` | — | Confirmar com o dono e alinhar `companies.default_validity_days` |
| B10 | ⚠️ Mensagens sem confirmação ("desconhecido") | Baixa | Aviso âmbar na tela | 23/11: 0 em 7 dias | Timeout da Evolution | Equipe, Lia e aprovação de sugestão já usam "desconhecido"; o eco do celular e a reconciliação confirmam (#130, #131) |
| B11 | ⚠️ Vigia: o teste ativo (`chat/whatsappNumbers`) ainda não foi visto numa conexão travada de verdade | Média | Se a conexão travada responder ao teste, só reinicia após 2 h (reserva) | #131 | — | Acompanhar `probe_ok`/`probe_failed` no diagnóstico e no painel de saúde |
| B12 | ⚠️ `secretEncryptedMessage` (edição de mensagem, criptografada) e mensagens interativas não aparecem | Baixa | Edição feita pelo cliente não atualiza o texto | Diagnóstico 23/11 (11 no dia) | Conteúdo cifrado pelo WhatsApp | Avaliar com a Evolution |

---

## 14. Funcionalidades pendentes

- **Fiscal:**
  - emissão NF-e/NFS-e (**pausada**);
  - preencher e aprovar as classificações (financeiro + contador);
  - alíquotas de 2027 (aguardar publicação oficial ou informar com fonte);
  - motor do Simples Nacional (aguardar a Release 16 da Receita).
- **Lia:**
  - responder o formulário `docs/LIA_FORMULARIO_PENDENCIAS.md`;
  - pré-orçamento pela tabela, visão de foto e PDF, ferramentas tipadas, aprovações;
  - lembrete de visita, pedido pronto, pós-venda Google, encerrar em 2 h, resumo diário;
  - ligar o acompanhamento de leads (decisão do dono).
- **WhatsApp:**
  - confirmar o vigia;
  - histórico de conexão;
  - departamentos e filas;
  - IA por número (só o principal tem Lia).
- **Financeiro e obra:**
  - mão de obra, impostos e comissões automáticos por obra;
  - consumo de material do estoque;
  - paginação e seleção de obras nos rateios;
  - alçadas de aprovação;
  - auditoria integral com justificativa.
- **Produção:**
  - bobinas, lotes, peso, sobras e perdas;
  - corte, dobra e conferência por responsável com fotos;
  - status "aguardando conferência das peças".
- **Operação:** equipes, veículos e carregamento implementados (§6.15); folha individual restrita continua pendente.
- **Compras:** consolidação, comparação e histórico; WVetro assistido para compras.
- **Testes e homologação:**
  - homologação com Supabase real (revogação em sessão ativa, realtime, rate limit, MFA);
  - carga;
  - regressão visual A4.

---

## 15. Segurança e infraestrutura

- **Hospedagem e deploy:**
  - **Vercel:** projeto ligado à `main`. `vercel.json` permite deploy só da `main`, na região `gru1`. Domínio `crm-bielenki.vercel.app`.
  - **Supabase:** projeto `nfyiooalcaosjhpmvmqd`, Postgres 16, sa-east-1 (aws-1-sa-east-1).
  - **Evolution:** servidor na Hospede Aqui (Docker) [relatado]. Instâncias dos números "WhatsApp principal" e "Número da Calha".
- **Segredos:**
  - variáveis na Vercel e secrets do GitHub (`SUPABASE_DB_URL` usado pelo workflow de migrações);
  - chaves de terceiros criptografadas no banco (`lib/encrypt.ts`);
  - o segredo da rotina fica em `crm_operations_config.cron_secret`.
- **Proteções existentes:**
  - RLS em todas as tabelas; funções `security definer` com `search_path` fixo e sem execução por `anon`;
  - cabeçalhos de segurança e erros técnicos ocultos (#95); limite de uso da IA (`lib/ai/rate-limit.ts`);
  - webhook com segredo e assinatura; URLs externas validadas (`lib/safe-url.ts`, só HTTPS público);
  - CSV protegido contra fórmulas; auditoria.
- **Atenção:**
  - o motor fiscal oficial **não tem autenticação**: se for usado um motor próprio, ele precisa de proxy com segredo;
  - a Evolution é **API não oficial**: há risco de bloqueio do número com mensagens automáticas em massa.

---

## 16. Roadmap priorizado

### P0 — Crítico
**P0.1 Confirmar e estabilizar o recebimento do WhatsApp** — *23/11: etapas C1, C2 e D da auditoria publicadas (#130, #131). Falta: ver o teste ativo numa queda real (B11), tirar a Lia de dentro do webhook (fila) e decidir sobre a API oficial da Meta.*
- **Objetivo:** nenhuma janela longa sem mensagens.
- **Estado:** vigia publicado em 19/11; o número principal seguia sem receber às 16:49.
- **Dependências:** acesso ao celular do número principal e ao servidor da Evolution.
- **Arquivos:** `lib/operations.ts`, `lib/whatsapp/{watchdog,evolution}.ts`, `app/api/whatsapp/webhook/route.ts`, `scripts/diagnostico-agente-ia.sql`.
- **Critérios de aceite:** depois de travar, mensagens voltam em ≤ 25 min sem ação humana; o diagnóstico mostra `reinicio` e "ultima recebida" atualizada.
- **Testes:** `tests/whatsapp-watchdog.test.ts` e diagnóstico em produção.
- **Riscos:** reinícios em excesso; conexão desvinculada no celular (exige QR).

**P0.2 Agendamento da rotina dentro das migrações (B8)**
- **Objetivo:** não perder a rotina num restore.
- **Critério de aceite:** migração idempotente que agenda `operations_tick` a cada minuto sem duplicar.
- **Risco:** agendar duas vezes.

### P1 — Alta
1. **Ativar a calculadora fiscal em produção:** configuração (SC, 4208906, regime) e classificações aprovadas com o contador. Critério: simular um orçamento real.
2. **Decisão WVetro × total por linha (B4):** se o dono quiser, criar a opção "mostrar só itens e total geral" para orçamentos importados. Testes: `print-a4` e `wvetro-proposal`.
3. **Responder o formulário da Lia** e implementar as automações aprovadas (pré-orçamento com aprovação humana, pedido pronto, pós-venda). Arquivos: `lib/ai/*`, `lib/lia-followups.ts`, `app/api/whatsapp/webhook/route.ts`.
4. **Confirmar a cobrança Pix com envio real** (primeira cobrança após o #111): ver se aparece no extrato da conta.

### P2 — Média
- Resultado por obra completo (mão de obra, impostos, comissões, consumo).
- Alçadas de aprovação e auditoria com justificativa.
- Histórico de conexão do WhatsApp (B2); departamentos e filas.
- Relatório de compras duplicadas suspeitas (B3).
- Políticas RLS `to authenticated` (B6).

### P3 — Evolução
- **Emissão fiscal** (quando o dono retomar). Opções avaliadas: emissor homologado por API + certificado **A1** (confirmar o tipo), DANFSe pelo gerador oficial em WASM.
- **Produção:** bobinas, lotes e etapas com fotos.
- **Operação:** equipes e veículos implementados (§6.15); folha individual pendente.
- **Tributos:** motor do Simples Nacional (Release 16 da Receita).

---

## 17. Instalação, testes e deploy

### 17.1 Pré-requisitos
Node 22, npm, Postgres 16 (para a suíte completa), Chromium (E2E e PDF), Python 3 (scripts auxiliares).

### 17.2 Comandos confirmados (`package.json`)
```bash
npm install                 # dependências
npm run dev                 # desenvolvimento (Next com turbopack)
npm run build && npm start  # produção local
npm run typecheck           # tsc --noEmit
npm run test:unit           # vitest (PGlite em memória; não precisa de Postgres) — 708 testes em 19/11
npm run test:full           # tests/run-all.sh: banco novo + todas as migrações + PostgREST + fake Supabase + build + E2E
PG_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:full
npm run test:queries        # confere as consultas do código contra o banco (precisa do backend da suíte)
```

### 17.3 Suíte completa (`tests/run-all.sh`) **[fato]**
1. Cria o banco `crm_test` e aplica os stubs do Supabase e todas as migrações (`tests/db/apply-migrations.sh`).
2. Baixa e sobe o **PostgREST 12.2.3** (porta 54330) e o **fake Supabase** (`tests/e2e/start-backend.mjs`, porta 54321), e cria o admin de teste `admin@teste.local` (senha só de teste, definida no próprio script).
3. Popula com `tests/db/seed-sample.sql`; roda `check-queries` e os testes de banco (`tests/db/*.test.mjs`).
4. Faz `next build` e `next start` na porta 3000, depois roda os E2E: `api`, `quote-flow`, `business`, `ui-actions`, `remaining`, `forms`, `crawl`, `print-a4`, `mobile` e `aluminum-cost`.

### 17.4 CI (`.github/workflows/ci.yml`)
- **"Tipos, segurança e build":** `npm ci`, typecheck, `test:unit`, `npm audit --omit=dev --audit-level=high` e build.
- **"Testes (banco, consultas e ponta a ponta)":** Postgres 16 + poppler + `test:full`.
- **Regras:** não remover verificações; nunca pular, desativar ou colocar teste em quarentena para ficar verde.

### 17.5 Deploy (fluxo usado em todas as entregas)
```mermaid
sequenceDiagram
  participant Dev as Branch de trabalho
  participant GH as GitHub PR
  participant CI as CI
  participant WF as Workflow "Aplicar migrations"
  participant DB as Supabase prod
  participant V as Vercel
  Dev->>GH: push + PR para main
  GH->>CI: tipos/build + testes completos
  CI-->>GH: verde
  Note over WF: só se houver migração nova
  GH->>WF: workflow_dispatch (ref=SHA do PR, desde=número da 1ª migração nova)
  WF->>DB: aplica só as não registradas em crm_admin.migrations
  WF->>DB: verificar-banco-producao.sql (vazio) + diagnóstico
  GH->>V: merge na main → deploy automático (gru1)
```
- **Migração vem antes do merge,** para o código novo não procurar tabelas inexistentes.
- **Rollback:** as migrações são aditivas. Para reverter, desligue a funcionalidade (ex.: `fiscal_settings.enabled = false`, Lia desligada) ou faça revert do PR (a Vercel publica de novo). **Não apagar tabelas nem dados.**
- **Diagnóstico sob demanda:** rode o mesmo workflow com `desde = 99999999999999` (nenhuma migração é aplicada; só verificação e diagnóstico). Use o **SHA completo** em `ref` (o SHA curto travou o checkout).
- **Motor fiscal:** workflow "Verificar motor fiscal" (manual), com a URL do motor como entrada.

---

## 18. LEIA ISTO ANTES DE CONTINUAR O DESENVOLVIMENTO

1. **O que é e como está organizado.**
   - ERP/CRM da Marquinhos Calhas e Esquadrias, em Next.js 15 (App Router + Server Actions) com Supabase (Postgres + RLS).
   - A maioria das telas passa por `app/(crm)/[[...path]]/page.tsx`. As ações ficam em `app/(crm)/*-actions.ts` e as regras críticas em funções do banco (`supabase/migrations`).
   - Os mapas de leitura deste documento são as seções §4 (arquivos), §5 (banco) e §6 (módulos).
2. **O que já existe e não deve ser recriado.**
   - Tudo da §6: orçamentos de calhas, esquadrias e WVetro, aprovação → venda/pedido/financeiro, financeiro completo, caixa, conciliação, recorrências, relatórios, obras, compras e estoque, produção, serviços, Atendimento multinúmero, Lia, Pix registrado e calculadora fiscal.
   - **Antes de criar tabela, tela ou serviço, procure** (`grep`, `lib/`, `components/`, `docs/`). Há uma tabela `integrations` vazia que pode ser reaproveitada.
3. **Decisões a respeitar (§12):**
   - só a Marquinhos; tema claro; vendedor vê só as próprias vendas; pintura com valor no impresso; venda manual como VEN-;
   - Lia só para contato novo, número principal e fora de grupos; automações desligadas por padrão; nunca preço nem desconto pela Lia;
   - emissão fiscal pausada; o financeiro aprova a classificação; nunca inventar NCM, CST, cClassTrib ou alíquota; tributo simulado nunca vira lançamento;
   - nenhuma baixa ou movimentação financeira automática;
   - migrações **aditivas**; nunca apagar dados reais nem volumes Docker; nunca enviar WhatsApp real em testes.
4. **Prioridades atuais (§16):** P0.1 WhatsApp recebendo de forma estável; ativar a calculadora fiscal; decisão WVetro; formulário da Lia.
5. **Rodar localmente:** §17.2–17.3. Para a suíte completa use um Postgres local e `PG_ADMIN_URL`. As telas logadas podem ser testadas com `admin@teste.local` no backend falso.
6. **Testes:**
   - `npm run test:unit` em toda mudança, mais testes novos ao lado (`tests/*.test.ts`, banco com `createTestDatabase`);
   - `npm run test:full` antes de mudanças grandes;
   - rota nova vai em `scripts/route-inventory.json`;
   - tabela com gatilho de UPDATE precisa de coluna `id` (a varredura `tests/db/function-sweep.mjs` usa `id`);
   - não gerar resultado esperado arbitrário: no fiscal, use respostas reais do motor (`tests/fixtures/fiscal`).
7. **Deploy:** §17.5. Branch → PR → CI verde → (migração pelo workflow) → merge → Vercel. O dono acompanha os horários em **Brasília (UTC−3)** e prefere mensagens curtas em português.
8. **Atenção especial:**
   - `app/api/whatsapp/webhook/route.ts`: grande e sensível; gravar antes da IA; idempotência; segredo;
   - `lib/operations.ts`: roda a cada minuto para todas as empresas;
   - funções `approve_quote*`, `register_payment*`, `revert_quote_approval`: dinheiro;
   - impressão A4 (`quote-document.tsx`, `quote-paper.css`);
   - `lib/encrypt.ts`: não mudar o formato, ou as chaves salvas se perdem.
9. **A verificar:** eficácia do vigia do WhatsApp; código e capacidades do JARVIS (outro repositório); "Bielenki Workspace" (sem referência); uso real das automações (`/automacoes`); tipo do certificado (A1 ou A3); validade padrão do orçamento (7 ou 10 dias); se o link de avaliação Google abre a tela de avaliar; quem é o gerente que recebe as reclamações.
10. **Continuar sem quebrar:** mudança pequena e testada; sem refatoração ampla não pedida; mantenha os nomes e padrões existentes (`zod` nas ações, RLS + `has_table_access`, auditoria); recurso novo começa **desligado**; confira PRs abertos de outras sessões antes de começar.

---

## 19. Glossário e informações adicionais

| Termo | Significado |
|---|---|
| Lia (antes Ana) | IA de atendimento no WhatsApp |
| JARVIS | Assistente interno da gerência (aplicativo separado) |
| Evolution | API não oficial de WhatsApp (Baileys) usada pelos números da empresa |
| Canal / número | Registro em `whatsapp_channels` (principal = Lia) |
| Rotina / operations tick | Execução de 1 em 1 minuto (`lib/operations.ts`) |
| Vigia | Reinício automático da conexão "zumbi" do WhatsApp |
| WVetro | Software de projeto e orçamento de esquadrias; o CRM importa o PDF da proposta |
| ORC- / VEN- / SRV- | Prefixos de orçamento, venda manual e serviço avulso |
| Calha de beiral, platibanda, coletora, central; rufo; pingadeira; sobrecalha; rufo colarinho (= rufo para chaminé) | Peças fabricadas (catálogo 3D) |
| CBS / IBS / IS | Tributos da Reforma (LC 214/2025): federal, estadual+municipal e seletivo |
| NCM / NBS / CST / cClassTrib | Classificação de mercadoria, de serviço, situação tributária e classificação tributária do IBS/CBS |
| Regime híbrido | Simples Nacional com IBS/CBS apurados pelo regime regular (a partir de 2027, a confirmar com o contador) |
| Motor oficial | Calculadora de Tributos da Receita (Regime Regular); online em `piloto-cbs.tributos.gov.br` |
| Obra | Pedido/venda visto pelo resultado financeiro |

**Documentos relacionados no repositório:** `REQUISITOS-PROMPT-MESTRE.md`, `CONTINUIDADE.md` (de 13/11; parcialmente desatualizado), `docs/MATRIZ_RBAC.md`, `docs/RELATORIO_AUDITORIA.md`, `docs/AUDITORIA-WHATSAPP-2026-11-18.md`, `docs/LIA_DIAGNOSTICO_E_PLANO.md`, `docs/LIA_FORMULARIO_PENDENCIAS.md`, `docs/FISCAL_DIAGNOSTICO_E_ARQUITETURA.md`, `docs/DESIGN-SYSTEM.md`, `docs/GUIA_UX_STATUS.md`.

---

## 20. Checklist de continuidade

- [ ] Ler §1, §8, §12 e §18 inteiros.
- [ ] `npm install && npm run typecheck && npm run test:unit` passando antes de mexer.
- [ ] Conferir PRs abertos e a branch de trabalho (não duplicar o trabalho de outra sessão).
- [ ] Rodar o diagnóstico de produção (workflow com `desde=99999999999999`) e ver o estado do WhatsApp (`canal|`, `reinicio|`, `saude|`).
- [ ] Confirmar com o dono: vigia do WhatsApp; decisão WVetro × total por linha; formulário da Lia; validade padrão do orçamento; certificado A1/A3.
- [ ] Toda mudança: teste novo ao lado, `tsc`, `test:unit`; rota nova no `route-inventory.json`; migração aditiva com teste em `tests/*-db.test.ts`.
- [ ] Deploy: PR → CI verde → migração pelo workflow (SHA completo) → `verificar-banco` vazio → merge → conferir a Vercel.
- [ ] Atualizar este arquivo (§6, §12, §13, §16) ao final de cada entrega relevante.
