# Fase 2 — Tarefa 2.3: Auditoria do Pipeline CI/CD

**Data:** 20/11/2026
**Status:** ✅ Concluída

---

## 1. Workflows Existentes

| Workflow | Arquivo | Trigger | Status |
|----------|---------|---------|--------|
| **CI Principal** | `ci.yml` | push/PR na main + manual | ✅ Funcional |
| **E2E Desktop/Mobile** | `e2e.yml` | Manual (`workflow_dispatch`) | ⚠️ Só manual |
| **Smoke Test Produção** | `smoke-test.yml` | Horário (hora em hora) + manual | ✅ Funcional |
| **Aplicar Migrations** | `aplicar-migrations.yml` | Label no PR + manual | ✅ Funcional |
| **Verificar Motor Fiscal** | `verificar-motor-fiscal.yml` | Manual | ✅ Funcional |

---

## 2. Análise do CI Principal (`ci.yml`)

### Job `validate` (Tipos, segurança e build)
| Etapa | Comando | Status |
|-------|---------|--------|
| Checkout | `actions/checkout@v4` | ✅ |
| Node.js 22 + cache npm | `actions/setup-node@v6` | ✅ |
| Instalar dependências | `npm ci` | ✅ |
| Typecheck | `npm run typecheck` | ✅ |
| Testes unitários (PGlite) | `npm run test:unit` | ✅ |
| Auditoria de dependências | `npm audit --omit=dev --audit-level=high` | ✅ |
| Build de produção | `npm run build` | ✅ |

### Job `test` (Banco real, consultas e E2E)
| Etapa | Comando | Status |
|-------|---------|--------|
| Postgres 16 service container | `postgres:16` com health check | ✅ |
| Instalar postgresql-client + poppler-utils | `apt-get install` | ✅ |
| Instalar Chromium via Playwright | `npx playwright install --with-deps chromium` | ✅ |
| Testes completos | `npm run test:full` (com `PG_ADMIN_URL`) | ✅ |
| Logs em caso de falha | `tail -n 80 .test-work/*.log` | ✅ |
| Upload de screenshots mobile | `actions/upload-artifact@v4` | ✅ |

### Pontos fortes
- ✅ Concurrency group com `cancel-in-progress: true` (evita filas desnecessárias)
- ✅ Cache de npm configurado
- ✅ Service container Postgres com health check robusto
- ✅ Timeout definido (15 min validate, 30 min test)
- ✅ Artifacts de screenshots sempre uploadados (`if: always()`)
- ✅ `npm audit` com nível `high` bloqueia vulnerabilidades críticas

### Lacunas identificadas
| # | Lacuna | Severidade | Recomendação |
|---|--------|------------|--------------|
| 1 | E2E (`e2e.yml`) só roda manualmente | Média | Adicionar trigger em PRs que alteram `components/` ou `app/` |
| 2 | Sem lint (ESLint) no pipeline | Baixa | Adicionar `npm run lint` se ESLint estiver configurado |
| 3 | Sem validação de sintaxe SQL das migrations no CI | Média | Adicionar step que valida SQL antes do merge |
| 4 | Sem verificação de RLS no CI | Alta | Adicionar teste automatizado de isolamento multiempresa no job `test` |
| 5 | Branch protection não verificada | Alta | Confirmar que `main` exige CI verde + review antes do merge |
| 6 | Sem notificação de falha (Slack/email) | Baixa | Opcional, mas útil para monitoramento proativo |

---

## 3. Análise do Workflow de Migrations (`aplicar-migrations.yml`)

### Pontos fortes
- ✅ Registro idempotente em `crm_admin.migrations` (pula já aplicadas)
- ✅ Verificação pós-aplicação com `verificar-banco-producao.sql` (deve voltar vazio)
- ✅ Diagnóstico do agente IA sempre roda (`if: always()`)
- ✅ Suporta reaplicação forçada via input `reaplicar`
- ✅ Seed automático das migrations antigas (< 20261103010001) na primeira execução
- ✅ Pode ser acionado por label `aplicar-migrations` no PR (antes do merge)

### Pontos de atenção
- ⚠️ Usa `psql` direto com `DATABASE_URL` (session pooler) — correto para GitHub Actions
- ⚠️ Comentário documenta risco de deadlock ao reaplicar migration 048 (recria gatilhos)
- ⚠️ Não há rollback automático em caso de falha (manual via revert do PR)

---

## 4. Análise do Workflow E2E (`e2e.yml`)

### Estado atual
- Trigger: **apenas** `workflow_dispatch` (manual)
- Usa secrets `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`
- Roda `npm run test:e2e` com Playwright

### Recomendação
Adicionar trigger automático em PRs que modificam arquivos de frontend:
```yaml
on:
  pull_request:
    branches: [main]
    paths:
      - 'components/**'
      - 'app/**'
      - 'tests/e2e/**'
  workflow_dispatch:
```

---

## 5. Matriz de Cobertura do Pipeline

| Verificação | CI Principal | E2E | Smoke | Migrations | Fiscal |
|-------------|-------------|-----|-------|------------|--------|
| Typecheck | ✅ | — | — | — | — |
| Testes unitários | ✅ | — | — | — | — |
| Testes banco real | ✅ | — | — | — | — |
| Testes E2E | ✅ (via test:full) | ✅ (manual) | — | — | — |
| Build produção | ✅ | — | — | — | — |
| Audit dependências | ✅ | — | — | — | — |
| Smoke test produção | — | — | ✅ (hora/hora) | — | — |
| Validação migrations | — | — | — | ✅ | — |
| Verificação motor fiscal | — | — | — | — | ✅ (manual) |
| Lint (ESLint) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Validação SQL migrations | ❌ | ❌ | ❌ | ⚠️ Parcial | ❌ |
| Teste RLS isolamento | ⚠️ Via rbac-isolation-db | ❌ | ❌ | ❌ | ❌ |
| Notificação de falha | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 6. Recomendações Priorizadas

### P0 (Crítico)
1. **Confirmar branch protection da `main`**: exigir CI verde + pelo menos 1 review antes do merge
2. **Garantir que `rbac-isolation-db.test.ts` roda em todo PR**: já está no `test:full`, mas confirmar que não está sendo pulado

### P1 (Alto)
3. **Adicionar trigger automático no E2E**: PRs que alteram `components/` ou `app/` devem rodar E2E automaticamente
4. **Adicionar validação de sintaxe SQL no CI**: step simples que faz `pg_dump --schema-only` ou parse das migrations novas

### P2 (Médio)
5. **Adicionar lint (ESLint)**: se configurado no projeto, adicionar ao job `validate`
6. **Notificação de falha**: integrar com Slack ou email para alertas proativos
7. **Cache do Playwright**: adicionar cache de `~/.cache/ms-playwright` para acelerar o job `test`

---

## 7. Conclusão

O pipeline CI/CD do CRM Bielenki é **robusto e funcional**, cobrindo typecheck, testes unitários, testes de banco real, E2E, build, auditoria de dependências, smoke test em produção e aplicação segura de migrations. As principais lacunas são a falta de trigger automático para E2E em PRs e a necessidade de confirmar a branch protection da `main`.

**Status:** ✅ Tarefa 2.3 concluída. Próxima: Tarefa 2.4 (Auditoria de Segurança).

---

**Documento gerado em:** 20/11/2026
**Responsável:** Engenheiro de Software Sênior (IA)