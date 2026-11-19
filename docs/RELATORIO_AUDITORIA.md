# Relatório de auditoria multiusuário e correções — 19/11/2026

Fonte dos requisitos: pacote "Auditoria Multiusuários e Correções" (prompt mestre + 3 imagens).
Método: leitura do código e das funções reais do banco (migrações aplicadas num Postgres limpo) e testes com o papel `authenticated`, não service-role.
**Produção não foi tocada.** Nada foi aplicado fora do ambiente de teste e do PR.

Legenda: ✅ verificado · 🔧 corrigido neste PR · ⚠️ hipótese / decisão pendente · ⛔ não feito.

## A. Segurança e multiusuário

| # | Achado | Gravidade | Evidência | Status |
|---|---|---|---|---|
| A1 | Todas as tabelas de `public` têm RLS ligada; nenhuma view sem `security_invoker` | — | consulta ao catálogo | ✅ |
| A2 | Nenhuma tabela com `company_id` mostra linhas de outra empresa (100 tabelas, 2 empresas, leitura nos dois sentidos) | crítica se falhasse | `tests/rbac-isolation-db.test.ts` | ✅ |
| A3 | Usuário de uma empresa não insere nem altera dados de outra | crítica | mesmo teste (`row-level security`) | ✅ |
| A4 | Atendente não vê financeiro, pagamentos, compras nem auditoria, e não registra pagamento por RPC; produção não vê financeiro; vendedor não cancela compra | alta | mesmo teste | ✅ |
| A5 | Nenhuma função `SECURITY DEFINER` do schema `public` é executável pelo papel anônimo | alta | consulta ao catálogo | ✅ |
| A6 | Políticas de tabela estão atribuídas ao papel `public` (inclui `anon`) em vez de só `authenticated`. Hoje o anônimo não lê nada porque `current_company_id()` é nulo sem login; é defesa em profundidade | baixa | `pg_policies` | ⚠️ não alterei (mudar 100+ políticas sem homologação é risco maior que o ganho) |
| A7 | `whatsapp_webhook_events` com RLS e nenhuma política = negado a todos; só o servidor acessa | — | catálogo | ✅ (intencional) |
| A8 | WhatsApp: conversa só aparece ao dono do número, autorizados e gerência | alta | `tests/whatsapp-channels-db.test.ts` | ✅ |
| A9 | Revogação de permissão em sessão ativa, assinaturas realtime, cache, usuário com duas empresas, rate limit, MFA | — | — | ⛔ não testado (precisa de homologação com Supabase real) |

Matriz de cargos e decisões pendentes: `docs/MATRIZ_RBAC.md`.

## B. Número único orçamento → venda
- **Causa comprovada:** `approve_quote_unchecked` gerava a venda com `next_number('VEN', …)`, por isso ORC-2026-00128 virava VEN-2026-00012.
- 🔧 A venda criada na aprovação agora usa o **mesmo número do orçamento** (PDF, tela, conta a receber, mensagens e Pix usam `sale_number`, então acompanham sozinhos). Se esse número já existir em outra venda (dado antigo), cai na numeração antiga sem travar a aprovação.
- Repetir a aprovação devolve a mesma venda (✅ teste). Dois cliques/usuários: a função trava o orçamento (`for update`); o teste roda numa conexão só, então a corrida real entre conexões **não** foi exercitada ⚠️.
- **Legado:** nenhuma venda antiga foi renumerada.
- ⚠️ **Decisão pendente:** vendas lançadas à mão (sem orçamento) continuam como VEN-…; o sistema ficará com dois formatos. Confirmar se o prefixo "ORC" deve permanecer literalmente na venda.

## C. Ocultar mão de obra e deslocamento no impresso
- **Causa:** só sumia o item com "deslocamento" no nome.
- 🔧 Agora valem deslocamento, **mão de obra, instalação e visita técnica**, com a mesma regra de diluir o valor nos demais itens: o total do documento não muda (✅ `tests/quote-hidden-services.test.ts`). A opção na tela ficou "Ocultar valor de deslocamento e mão de obra no impresso".
- ⚠️ **Decisão pendente:** pintura e outros itens do tipo "Serviços" **não** foram incluídos (o cliente costuma querer ver o valor da pintura). Confirmar a lista. Regressão visual A4 dos orçamentos não foi refeita ⛔.

## D. Compras
| Pedido da imagem | Solução | Status |
|---|---|---|
| Receber a nota inteira, "apertar como recebido em tudo" | `receive_purchase_all`: marcado por padrão, escolhe o local; pode desmarcar itens; repetir não duplica; não confunde com pagamento | 🔧 ✅ |
| Selecionar mais de um item para desfazer | `undo_stock_receipts`: várias de uma vez, saída ligada a cada entrada, repetir só pula as já desfeitas | 🔧 ✅ |
| Entradas duplicadas | Causa **não reproduzida** com dados reais ⚠️. Proteção na criação: mesmo fornecedor e mesmo valor (±R$ 1) em 30 dias é barrado, com opção "É outra compra". Receber já era limitado ao saldo pendente | 🔧 ⚠️ |
| "Cancelar" que apaga tudo | `cancel_purchase_order`: tira o material do estoque (movimento de saída), cancela a conta a pagar e deixa só como Cancelada. **Bloqueia** com pagamento válido, devolução registrada ou material já usado | 🔧 ✅ |

Nada é apagado fisicamente; a trilha fica em `audit_logs` e `stock_movements`. Relatório de duplicatas suspeitas e conciliação automática entre módulos ⛔ não feitos.

## Rollback
A migração `20261119100000_compras_lote_cancelamento_numero_venda.sql` só substitui funções (`approve_quote_unchecked`, `create_manual_purchase_unchecked`, `cancel_purchase_order`) e cria três novas. Para voltar: reaplicar as definições anteriores (migrações `048…`, `20261117100000`/`20261117180000`, `20261117140000`) e `drop function receive_purchase_all, undo_stock_receipts`. Nenhum dado é modificado.

## Não feito neste ciclo
Teste de carga com vários usuários; teste de corrida com conexões paralelas; revogação em sessão ativa; E2E no navegador das telas novas de compras; plano para números legados.
