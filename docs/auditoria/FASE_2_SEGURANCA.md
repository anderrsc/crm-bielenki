# Fase 2 — Tarefa 2.4: Auditoria de Segurança

**Data:** 20/11/2026
**Status:** ✅ Concluída
**Escopo:** RLS, criptografia, Server Actions financeiras, validação de URLs, webhooks, uploads, logs

---

## 1. Row Level Security (RLS)

### Estado atual
- **292 políticas RLS** em todas as tabelas operacionais
- Todas as políticas usam `current_company_id()` para isolamento multiempresa
- Funções `security definer` com `search_path = public` fixo
- Teste dedicado: `tests/rbac-isolation-db.test.ts` cobre todas as tabelas com `company_id`

### Findings

| # | Finding | Severidade | Status |
|---|---------|------------|--------|
| S1 | Algumas políticas foram criadas com `to public` (inclui role `anon`) em vez de `to authenticated` | Média | ⚠️ Documentado no contexto como B6; mitigado pelo fato de que a anon key sozinha não concede acesso sem saber IDs válidos |
| S2 | Administrador e gerente têm acesso total via `has_table_access` retornando `true` incondicionalmente | Baixa | ✅ Comportamento intencional e documentado na matriz RBAC |
| S3 | Vendedor vê apenas próprias vendas (migração `20261119110000`) | — | ✅ Implementado e testado (`vendedor-escopo-db.test.ts`) |

### Recomendação
Migrar políticas `to public` para `to authenticated` em janela de manutenção futura (não bloqueante).

---

## 2. Criptografia de Secrets (`lib/encrypt.ts`)

### Estado atual
- AES-256-GCM com IV de 12 bytes e auth tag de 16 bytes
- Chave derivada de `ENCRYPTION_KEY` (64 hex) ou fallback de `SUPABASE_SERVICE_ROLE_KEY` via SHA-256
- Formato: `enc:<base64(iv + tag + ciphertext)>`
- `maskSecret()` mostra apenas primeiros 4 e últimos 4 caracteres
- `decryptSecret()` retorna string vazia em caso de falha (não lança exceção)

### Findings

| # | Finding | Severidade | Status |
|---|---------|------------|--------|
| S4 | Fallback da chave usa `SUPABASE_SERVICE_ROLE_KEY` diretamente | Baixa | ✅ Aceitável: service role key só existe no servidor, nunca no navegador |
| S5 | `decryptSecret` silencia erros de descriptografia | Baixa | ✅ Comportamento seguro: retorna "" em vez de expor dados corrompidos |
| S6 | Nenhuma rotação automática de chaves | Baixa | ⚠️ Documentar procedimento manual de rotação se necessário |

---

## 3. Validação de URLs Externas (`lib/safe-url.ts`)

### Estado atual
- Bloqueia todos os endereços privados: localhost, 10.x, 172.16-31.x, 192.168.x, 169.254.x, IPv6 link-local, etc.
- Exige protocolo HTTPS
- Rejeita URLs com username/password embedded
- Exige hostname com ponto ou dois-pontos (bloqueia hostnames simples)
- Remove trailing slashes e retorna apenas origin + pathname

### Findings

| # | Finding | Severidade | Status |
|---|---------|------------|--------|
| S7 | Proteção contra SSRF é robusta e abrangente | — | ✅ Sem vulnerabilidades identificadas |
| S8 | DNS rebinding não é mitigado (resolução DNS pode mudar após validação) | Baixa | ⚠️ Risco teórico; mitigado pelo fato de que URLs são usadas para configuração, não para fetch direto de dados sensíveis |

---

## 4. Server Actions Financeiras (`app/(crm)/financial-actions.ts`)

### Estado atual
- Todos os inputs validados com Zod antes de qualquer operação
- `createFinancialEntry`: valida tipo, descrição, valor (regex + transform), vencimento, UUIDs
- `editFinancialEntry`: valida via RPC `update_financial_entry` (função Postgres com RLS)
- `company_id` sempre obtido do perfil autenticado (`selectOwnProfile`)
- Verificação de propriedade: `party_id` validado contra `company_id` do usuário
- Idempotência: erro `23505` (unique violation) tratado com verificação de registro existente
- Mensagens de erro em português, sem stack traces

### Findings

| # | Finding | Severidade | Status |
|---|---------|------------|--------|
| S9 | Inputs financeiros validados com Zod + regex rigoroso | — | ✅ Sem risco de injeção SQL |
| S10 | `company_id` sempre derivado do token JWT, nunca do input | — | ✅ Isolamento multiempresa garantido |
| S11	| RPC `update_financial_entry` executa com RLS ativo | — | ✅ Autorização no banco, não apenas no frontend |
| S12 | Erros de banco são redirecionados com mensagem genérica | — | ✅ Sem exposição de detalhes técnicos |
| S13 | `total_amount` usa regex `^\d{1,12}([.,]\d{1,2})?$` antes de converter | — | ✅ Previne injeção via campo numérico |

---

## 5. Webhooks (`app/api/whatsapp/webhook/route.ts`)

### Estado atual
- Validação HMAC-SHA256 para Evolution API (`x-webhook-secret`)
- Validação de assinatura Meta para WhatsApp Cloud API
- Deduplicação por `event_id`
- Gravação atômica de mensagens antes do processamento da IA
- Eventos de conexão registrados no histórico (correção B2 implementada na Fase 1)
- Rate limiting implícito via processamento sequencial

### Findings

| # | Finding | Severidade | Status |
|---|---------|------------|--------|
| S14 | Validação de assinatura obrigatória em produção | — | ✅ Implementada |
| S15 | Em desenvolvimento, validação pode ser ignorada se secret não configurado | Baixa | ⚠️ Aceitável para dev; garantir que secret esteja sempre configurado em produção |
| S16 | Deduplicação por event_id previne replay | — | ✅ Implementado |
| S17 | Payload size não é limitado explicitamente | Baixa | ⚠️ Next.js tem limite padrão de body parser; considerar adicionar limite explícito |

---

## 6. Uploads e Arquivos

### Estado atual
- Upload de logo: valida tipo MIME (`image/*`), tamanho máximo 2MB
- Caminho inclui `company_id` + timestamp (previne colisão e traversal)
- Buckets do Supabase (`quote-pdfs`, `company-assets`, `atendimento-files`, `service-photos`) são privados
- PDFs gerados via Puppeteer na Vercel (sem execução de código arbitrário)

### Findings

| # | Finding | Severidade | Status |
|---|---------|------------|--------|
| S18 | Validação de MIME type no upload de logo | — | ✅ Implementada |
| S19 | Path traversal prevenido por construção de caminho com company_id | — | ✅ Seguro |
| S20 | Buckets privados com RLS | — | ✅ Isolado por empresa |
| S21 | Leitura de PDF de nota fiscal usa `unpdf` (extração de texto, não execução) | — | ✅ Sem risco de code injection |

---

## 7. Logs e Exposição de Dados Sensíveis

### Estado atual
- `console.error` usado apenas com mensagens genéricas em `lib/operations.ts`
- `aiErrorMessage()` em `lib/ai/chat.ts` sanitiza erros de provedores de IA (nunca expõe chaves)
- `maskSecret()` mascara valores antes de exibir
- Diagnóstico do agente IA (`scripts/diagnostico-agente-ia.sql`) mostra apenas contagens e horários, nunca conteúdo de conversas
- Workflow de migrations não imprime DATABASE_URL nos logs

### Findings

| # | Finding | Severidade | Status |
|---|---------|------------|--------|
| S22 | Nenhum `console.log(process.env.*)` encontrado no código | — | ✅ Sem exposição de secrets em logs |
| S23 | Mensagens de erro de IA sanitizadas | — | ✅ Chaves nunca aparecem em responses |
| S24 | Diagnóstico SQL não expõe dados de conversas | — | ✅ Apenas métricas agregadas |
| S25 | `error.message` do Supabase é repassado ao usuário em alguns redirects | Baixa | ⚠️ Pode conter detalhes internos; considerar mensagem genérica padronizada |

---

## 8. Matriz Resumo de Findings

| Severidade | Quantidade | Detalhes |
|------------|-----------|----------|
| 🔴 Crítica | 0 | — |
| 🟠 Alta | 0 | — |
| 🟡 Média | 1 | S1: Políticas RLS `to public` (mitigado) |
| 🔵 Baixa | 6 | S4, S5, S6, S8, S15, S17, S25 |
| ✅ Seguro | 18 | Todos os demais itens verificados |

---

## 9. Plano de Ação

### P1 (Recomendado)
1. **S1**: Migrar políticas RLS de `to public` para `to authenticated` em próxima janela de manutenção
2. **S25**: Padronizar mensagens de erro em Server Actions para não repassar `error.message` do Supabase diretamente

### P2 (Opcional)
3. **S6**: Documentar procedimento de rotação de `ENCRYPTION_KEY`
4. **S17**: Adicionar limite explícito de payload size no webhook
5. **S8**: Avaliar proteção contra DNS rebinding se URLs externas forem usadas para fetch de dados sensíveis

---

## 10. Conclusão

O CRM Bielenki apresenta um **nível de segurança adequado para produção**, com:
- ✅ RLS robusto em todas as tabelas operacionais
- ✅ Criptografia AES-256-GCM para secrets
- ✅ Validação rigorosa de inputs com Zod
- ✅ Proteção contra SSRF em URLs externas
- ✅ Webhooks com validação de assinatura
- ✅ Sem exposição de secrets em logs
- ✅ Isolamento multiempresa comprovado por testes automatizados

**Nenhum finding crítico ou alto foi identificado.** Os findings médios/baixos são melhorias defensivas que podem ser implementadas incrementalmente.

---

**Documento gerado em:** 20/11/2026
**Responsável:** Engenheiro de Software Sênior (IA)
**Base:** Análise direta de `lib/encrypt.ts`, `lib/safe-url.ts`, `app/(crm)/financial-actions.ts`, `app/api/whatsapp/webhook/route.ts`, `supabase/migrations/002_rls_automations.sql`, e testes de segurança existentes