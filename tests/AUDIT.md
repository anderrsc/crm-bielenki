# Varredura operacional — 12/10/2026

## Resultado verificado

- 210 testes automatizados executados: lógica, renderização e interação de telas,
  Server Actions, APIs e transações em PostgreSQL local (PGlite).
- TypeScript e build de produção verificados.
- Dependências de produção verificadas com `npm audit --omit=dev --audit-level=high`.
- 84 cenários Playwright preparados e descobertos, em desktop e celular. **Não
  executados contra o site autenticado**: a tentativa de acesso retornou
  “E-mail ou senha inválidos”. Nenhum dado de cliente foi alterado em produção.

## Correções

| Área | Falha corrigida e verificação |
|---|---|
| Pendências | Campos inexistentes `purchase_orders.total_amount` e `deleted_at`; status incompatíveis; compras recebidas e produção finalizada aparecendo abertas; medições sem cliente desaparecendo; isolamento de empresa e permissões; contador financeiro; ordenação de urgência; estado vazio enganoso sem configuração. |
| Dashboard | Campo `sales.seller_name` inexistente; pagamentos estornados; consultas agregadas sujeitas às permissões; atalho de novo orçamento. |
| Agenda | Tipo de evento alterado ao salvar; horário sem fuso; origem da linha ausente; conclusão de medição/instalação com status errado; erros ignorados; mês pulado em dias 29–31; eventos noturnos invisíveis. |
| Perfis | Consultas `.single()` sem identificar o usuário falhavam com múltiplos funcionários. Corrigidas em cadastro, preços, identidade, configuração, automações, agenda e ficha impressa. |
| Financeiro | Renegociação não validava a empresa do lançamento. Testados pagamento parcial/integral, estorno, excesso de pagamento, parcelamento e rollback. |
| Compras/estoque | Testados criação de conta a pagar, recebimento parcial/integral, saldo de estoque, quantidades inválidas e local de outra empresa. |
| Produção/pedidos | Avanço bloqueado sem material; gatilho de pedido consultava `NEW.status` e `sales.order_id` inexistentes; checklist agora usa as colunas reais e preserva andamento existente. |
| Instalação | Checklist obrigatório impede conclusão prematura; conclusão por checklist gera pós-venda e atualiza o pedido. |
| Documentos | Upload de logo não respeitava pasta exigida pela política Storage; erros de gravação ignorados; mudança de template padrão agora é transacional. |
| Busca/listagens | Busca curta vazava resultados de outros módulos; caracteres especiais quebravam filtro; página inválida gerava range inválido; paginação sem ordenação estável. |
| Formulários | Campos opcionais impediam salvar venda/compra; quantidade zero e pagamentos negativos; JSON inválido quebrava salvamento de orçamento. |
| WhatsApp | Middleware exigia login de navegador para callback; validação do callback não usa token padrão conhecido; payloads inválidos são rejeitados antes de abrir cliente privilegiado. Nenhuma mensagem real foi enviada. |
| Migrações | Corrigidos aliases SQL e substituições incompatíveis de funções/views. Migrações de negócio executadas na ordem em banco limpo. |
| Teste de produção | Cookie SSR compatível com a versão instalada; 39 rotas; redirecionamentos e erros em respostas 200 passam a reprovar; instalação de dependências no workflow. |

## Aplicação em ambiente existente

1. Revisar e executar `supabase/migrations/042_pending_center_operational_fixes.sql`
   no projeto Supabase **antes** do deploy do código. A agenda nova depende da
   coluna `source` da view. Os ajustes nos arquivos históricos servem a instalações
   novas; não é necessário reexecutar todos eles no banco atual.
2. Publicar o código depois do sucesso da migração.
3. Configurar os secrets `SMOKE_TEST_*` do runner e os secrets `E2E_BASE_URL`,
   `E2E_EMAIL`, `E2E_PASSWORD` com uma conta de teste autorizada.
4. Executar o workflow de navegação desktop/celular e o smoke test.

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
npm run test:e2e -- --list
```

## Limites reais

Os testes do banco executam funções, gatilhos, constraints e RLS em PostgreSQL.
Auth/Storage recebem uma estrutura local compatível para testar o domínio; os
serviços hospedados de autenticação, upload e envio não são substituídos por uma
validação de integração real. `pg_cron`/`pg_net` (migração 006) e a limpeza de dados
de produção (039) não são executados nesse ambiente.

Ainda exigem validação autenticada: configuração real do Supabase, execução de
cron e Edge Functions, ida e volta WhatsApp/IA com fornecedores, renderização de
PDF pelo Chromium em Vercel, permissões de cada conta e uso real desktop/celular.
Os 84 cenários de navegador fazem navegação e preenchimento sem salvar registros;
as gravações e transições são cobertas pelos testes transacionais isolados.

A auditoria sem dependências de desenvolvimento ficou limpa. A auditoria completa
também apontou dependências de desenvolvimento do Tailwind 3; o `npm audit fix`
recomenda Tailwind 4 como alteração incompatível. Essa migração de estilo não foi
aplicada nesta correção.

**Passar testes locais não prova que todas as funções do site estão perfeitas.**
O encerramento da validação de produção depende dos passos de aplicação e acesso.


## Revisão e integração (12/10/2026)

Este pacote foi integrado sobre a `main` que já continha as correções do PR #14
(migrations 040–045, `selectOwnProfile`, cache do PDF, testes em `tests/e2e/*.mjs`).
A migração deste relatório entrou como **`046_review_operational_fixes.sql`** (a 042
já existia) com estes ajustes:

- Mantidas: permissões por categoria nas pendências, medição sem cliente, instalação
  sem data, renegociação validando empresa/permissão, busca curta, relatórios sem
  estornos, dashboard sujeito às permissões, `source` na agenda, template padrão
  transacional.
- `create_order_checklist`/`generate_operational_alerts`: a versão do pacote exigia
  usuário logado e quebrava atualizações de pedido feitas pelo sistema; agora o
  checklist não é recriado (preserva andamento), a função não é exposta e os alertas
  ficam restritos à empresa de quem chama (sem usuário, processa todas).
- `orcamentos_pendentes` e `instalacoes_hoje` usam os status reais e o fuso de São Paulo.
- Chave única de `gutter_prices` e `leads.updated_at` ficam com as migrations 044/045.

**Regras de negócio aprovadas pelo responsável (migration 047):**

1. A produção não avança enquanto houver material obrigatório da ordem ainda não
   recebido, nem se a ordem estiver cancelada. Diferente do pacote, o status
   `aguardando_material` sozinho não bloqueia: toda ordem nasce assim e as que não
   têm material vinculado nunca seriam liberadas.
2. A instalação não pode ser concluída com itens obrigatórios do checklist pendentes.

Testes em `tests/operations.test.ts` (material pendente bloqueia e libera ao
receber; ordem sem material avança; cancelada não avança; checklist pendente
impede concluir e libera ao completar).
