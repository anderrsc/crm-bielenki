# Fase 2 — Testes, Segurança e Monitoramento (P0)

**Status:** Em andamento
**Data de início:** 19/11/2026
**Duração estimada:** 4-5 dias

---

## Objetivo

Impedir que novas atualizações quebrem módulos existentes através de:
- Pipeline de CI/CD reproduzível
- Suite de testes automatizados confiável
- Auditoria de segurança e isolamento multiempresa
- Monitoramento de erros e regressões

---

## Tarefas

### 2.1 Auditoria dos testes existentes

**Status:** ⏳ Pendente

**Objetivo:** Inventariar todos os testes existentes, classificar por cobertura e identificar lacunas críticas.

**Ações:**
1. Mapear todos os arquivos de teste (`tests/*.test.ts`, `tests/*-db.test.ts`, `tests/e2e/*.spec.ts`)
2. Classificar por módulo:
   - WhatsApp/atendimento
   - Financeiro
   - Orçamentos/vendas
   - Compras/estoque
   - Produção
   - Fiscal
   - Autenticação/permissões
3. Identificar módulos sem cobertura de testes
4. Verificar se há testes de RLS e isolamento multiempresa

**Critérios de aceite:**
- [ ] Documento com inventário completo dos testes
- [ ] Matriz de cobertura por módulo
- [ ] Lista de lacunas críticas identificadas

---

### 2.2 Corrigir smoke tests (PR #16)

**Status:** ⏳ Pendente

**Objetivo:** Investigar e corrigir falhas nos smoke tests e fluxo de autenticação.

**Contexto:** PR #16 menciona tratamento de espaços no e-mail configurado como secret.

**Ações:**
1. Localizar arquivo `scripts/smoke-test.mjs`
2. Identificar lógica de autenticação
3. Verificar tratamento de espaços em e-mails/senhas
4. Corrigir sem normalização indevida (preservar senhas exatamente como cadastradas)
5. Diferenciar tipos de falha:
   - Falha de credencial
   - Secret ausente
   - Erro de conexão
   - Erro de autorização
   - Incompatibilidade de migração
   - Falha de aplicação
   - Falha transitória
6. Garantir que logs não exponham tokens, senhas ou secrets

**Critérios de aceite:**
- [ ] Smoke test passa em ambiente limpo
- [ ] Mensagens de erro são diagnósticas e não expõem secrets
- [ ] Tratamento de espaços em credenciais preservado

---

### 2.3 Pipeline de CI/CD

**Status:** ⏳ Pendente

**Objetivo:** Garantir que cada PR execute verificações obrigatórias antes do merge.

**Pipeline esperado:**
1. Instalação reproduzível das dependências
2. Lint (ESLint, se configurado)
3. Typecheck (`npm run typecheck`)
4. Testes unitários (`npm run test:unit`)
5. Testes de integração (banco real com migrations)
6. Validação de migrações (sintaxe SQL, dependências)
7. Testes de segurança (RLS, isolamento multiempresa)
8. Build de produção (`npm run build`)
9. E2E em homologação (Playwright/Puppeteer)
10. Relatório de falhas

**Ações:**
1. Inspecionar `.github/workflows/ci.yml`
2. Verificar se todas as etapas estão implementadas
3. Adicionar etapas faltantes
4. Configurar proteção de branch (impedir merge com CI vermelho)
5. Testar pipeline com PR de exemplo

**Critérios de aceite:**
- [ ] Todas as 10 etapas executando
- [ ] Pipeline reproduzível (mesmo resultado em execuções diferentes)
- [ ] Branch `main` protegida (merge bloqueado se CI falhar)
- [ ] Relatório de falhas claro e acionável

---

### 2.4 Auditoria de segurança

**Status:** ⏳ Pendente

**Objetivo:** Identificar vulnerabilidades, violações de RLS e riscos de isolamento multiempresa.

**Checklist:**

#### 2.4.1 Row Level Security (RLS)
- [ ] Todas as tabelas operacionais têm políticas RLS?
- [ ] Políticas usam `current_company_id()` para isolamento?
- [ ] Há políticas `to public` que deveriam ser `to authenticated`?
- [ ] Funções `security definer` têm `search_path` fixo?
- [ ] Execução por `anon` foi revogada?

#### 2.4.2 Server Actions
- [ ] Validam input com Zod?
- [ ] Usam prepared statements (Supabase client)?
- [ ] Há concatenação de strings em queries?
- [ ] Tratam erros adequadamente (não expõem stack traces)?

#### 2.4.3 Secrets e credenciais
- [ ] Chaves de API estão criptografadas no banco (`lib/encrypt.ts`)?
- [ ] Variáveis de ambiente são logadas acidentalmente?
- [ ] `.env.local` está no `.gitignore`?
- [ ] Há hardcoded secrets no código?

#### 2.4.4 Webhooks
- [ ] Validam assinatura/segredo?
- [ ] Rejeitam requests sem auth?
- [ ] Têm rate limiting?
- [ ] Validam URLs externas (`lib/safe-url.ts`)?

#### 2.4.5 Uploads e arquivos
- [ ] Validam tipo MIME e tamanho?
- [ ] Caminhos são sanitizados?
- [ ] Buckets do Supabase têm políticas RLS?

#### 2.4.6 Logs e auditoria
- [ ] Logs expõem tokens, senhas ou dados sensíveis?
- [ ] Tabela `audit_logs` registra operações críticas?
- [ ] Há retenção adequada de logs?

**Ações:**
1. Usar agente `security` para auditoria automatizada
2. Testar tentativas de acesso cruzado entre empresas
3. Verificar isolamento de dados por `company_id`
4. Produzir relatório de findings com severidade (Crítica/Alta/Média/Baixa)
5. Recomendar mitigações priorizadas

**Critérios de aceite:**
- [ ] Relatório de auditoria de segurança produzido
- [ ] Findings classificados por severidade
- [ ] Mitigações recomendadas para cada finding
- [ ] Testes de isolamento multiempresa passando

---

### 2.5 Monitoramento de erros

**Status:** ⏳ Pendente

**Objetivo:** Implementar ou melhorar monitoramento de erros e regressões.

**Ações:**
1. Verificar se há integração com Sentry ou similar
2. Adicionar identificadores de correlação (request ID)
3. Implementar logs estruturados (JSON)
4. Configurar alertas de falha de deploy
5. Criar dashboard de saúde por módulo

**Critérios de aceite:**
- [ ] Erros são capturados e reportados automaticamente
- [ ] Logs estruturados facilitam debugging
- [ ] Alertas distinguem avisos de incidentes críticos
- [ ] Dashboard de saúde disponível

---

## Entregáveis

1. **Relatório de auditoria de testes** (`docs/auditoria/FASE_2_TESTES.md`)
   - Inventário completo
   - Matriz de cobertura
   - Lacunas identificadas

2. **Correção dos smoke tests** (PR separado)
   - Commit com correção
   - Testes passando

3. **Relatório de auditoria de segurança** (`docs/auditoria/FASE_2_SEGURANCA.md`)
   - Findings classificados
   - Mitigações recomendadas
   - Plano de ação

4. **Pipeline CI/CD atualizado** (PR separado)
   - `.github/workflows/ci.yml` com todas as etapas
   - Proteção de branch configurada

5. **Relatório final da Fase 2** (`docs/auditoria/FASE_2_RELATORIO.md`)
   - Resumo das entregas
   - Evidências de validação
   - Riscos residuais

---

## Riscos identificados

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Testes existentes estão quebrados | Média | Alto | Executar suite completa antes de adicionar novos testes |
| RLS mal configurado permite vazamento | Baixa | Crítico | Auditoria manual + testes automatizados de isolamento |
| Secrets expostos em logs | Baixa | Crítico | Revisão de código + ferramenta de scanning |
| Pipeline CI/CD muito lento (>10min) | Média | Médio | Paralelização de etapas + cache de dependências |

---

## Dependências

- Fase 1 (WhatsApp) já completa ✅
- Acesso ao repositório GitHub (branch protection)
- Ambiente de homologação (banco Supabase de staging)

---

## Critérios de conclusão da Fase 2

- [ ] Relatório de auditoria de testes produzido
- [ ] Smoke tests corrigidos e passando
- [ ] Pipeline CI/CD com todas as etapas funcionais
- [ ] Relatório de auditoria de segurança produzido
- [ ] Findings críticos de segurança mitigados
- [ ] Monitoramento de erros implementado
- [ ] Todos os testes automatizados passando
- [ ] Branch protection configurada

---

**Status atual:** Iniciando tarefa 2.1 (Auditoria dos testes existentes)