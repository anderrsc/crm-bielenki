# PONTO EXATO PARA RETOMAR

- PR #67 (categorias, centros de custos e baixas que preservam juros/desconto/parcelas): INTEGRADO na main (dab1b5b) com CI completo verde. Deploy da Vercel não foi conferido pela IA (sem acesso de rede ao site): conferir Ready/Production/Current no painel.
- Pendência 2 (vínculo e rateios por obra/pedido): IMPLEMENTADA na branch claude/crm-system-not-working-3qhgyk. Ver o PR aberto com o label aplicar-migrations. Só marcar publicada depois de migration, CI, merge e deploy confirmados.
- Próxima da fila depois dela: item 3 (DRE por competência, custos completos e margem por obra). Nenhum código de DRE iniciado.

## O QUE A PENDÊNCIA 2 ENTREGA
- Migration 20261112170000_financial_allocations.sql (aditiva e reaplicável): tabela financial_entry_allocations com RLS (leitura por permissão financeira; gravação só pela função), função set_financial_entry_allocations(conta, linhas) e view v_order_financials.
- Rateio por valor ou percentual entre obras (pedidos) e centros de custos. A soma precisa fechar exatamente o total; no percentual a última linha recebe a sobra dos centavos. Linhas repetidas, cadastro de outra empresa, centro inativo e conta cancelada são recusados. Lista vazia remove o rateio. Auditoria com antes/depois em audit_logs.
- Resultado por obra sem duplicar: conta rateada entra só pela parte rateada; conta a pagar sem rateio ligada à venda entra inteira; receita extra só de contas a receber sem venda.
- Tela /financeiro/rateios (lista de contas, formulário de rateio e resultado por obra), links no Financeiro e botão "Ratear" em cada conta.
- Arquivos: app/(crm)/financeiro/rateios/page.tsx, app/(crm)/financial-allocation-actions.ts, components/financial-allocation-form.tsx, tests/financial-allocations.test.ts, scripts/verificar-banco-producao.sql regenerado.
- Limites conhecidos: o rateio não tem cenário próprio no teste de navegador (coberto por testes de banco e pela varredura de páginas); a obra é o pedido (orders) existente, sem cadastro separado de obra.

---

# Continuidade — CRM Bielenki

## Regra de continuidade
Trabalhar uma pendência de cada vez. Só marcar publicada depois de confirmar migration, CI, merge e deploy. Não apagar dados nem volumes Docker. Não enviar WhatsApp real para testar. Não declarar o prompt mestre integralmente concluído.

## Ambiente
- Repositório: C:\Users\Cliente\Documents\ChatGPT\crm bielenki\crm-bielenki
- GitHub: https://github.com/anderrsc/crm-bielenki
- Produção: https://crm-bielenki.vercel.app
- Supabase: nfyiooalcaosjhpmvmqd
- Main: dab1b5b (PR #67 integrado).
- Branch atual de trabalho: claude/crm-system-not-working-3qhgyk.
- Git local: $env:TEMP\crm-git\cmd\git.exe
- Node/npm: $env:TEMP\crm-tools\node-v22.23.5-win-x64
- Supabase CLI: npx --yes supabase@2.101.0. Criar migrations pela CLI.
- TLS npm: NODE_OPTIONS=--use-system-ca. Não desativar verificação TLS.
- Não há credencial Git para push via CLI. Publicação anterior por UI GitHub autenticada. Verificar ferramentas conectadas antes de usar navegador.
- Nunca copiar chaves para chat/Git/relatórios.

## Concluído e publicado
- PRs #64/#65: persistência transacional de orçamento, busca leve de clientes, Central IA reduzida, detalhes paralelos e preços mobile.
- PR #66: totais financeiros corretos, cancelados fora de quitados, erros explícitos e projeções 7/15/30/60/90 dias com parcelas.
- Migration 20261112145112_financial_control_summary.sql aplicada. Hash da função d178aace8d70c397d9fb8172185b9b5b.
- 449 testes locais aprovados em 53 arquivos, TypeScript/build aprovados; CI completo verde no PR #66.
- Evolution: nova chave aplicada, antiga rejeitada, túnel HTTP 200 e PostgreSQL conectado; nenhum volume excluído. Titular confirmou chave salva no CRM.
- Groq: nova chave CRM criada/salva/testada pelo titular, uso registrado em 12/11. Antigas bielenki/marquinhos mantidas por decisão do usuário; revogação não é tarefa automática pendente.
- Dispatcher reimplantado antes; não enviar mensagens reais na auditoria.
- Não é necessário Pro para estas melhorias. Proteção Supabase contra senhas vazadas foi indicada pela plataforma como Pro; manter fora do escopo gratuito.

## Em andamento
1. Categorias financeiras e centros de custos: cadastrar, editar, ativar/desativar e classificar títulos novos/existentes com RLS, mesma empresa e auditoria. Migration criada pela CLI: 20261112152640_financial_classification.sql. Implementada e testada localmente: 455 testes em 55 arquivos, TypeScript/build aprovados; diagnóstico gerado retorna vazio no PostgreSQL isolado. Incluído cenário de navegação para sugestões, classificação de conta existente e criação de conta classificada, a executar no CI. Não aplicada nem publicada ainda.

## Fila restante, em ordem
2. Vínculo financeiro por obra/pedido e rateios exatos sem duplicar custos/receitas.
3. DRE por competência, custos completos e margem por obra; distinguir previsto, contratado e realizado.
4. Caixa com saldos iniciais/contas e projeção completa.
5. Conciliação OFX/CSV com revisão e idempotência.
6. Recorrências, contas pagar/receber aprimoradas, alçadas e auditoria financeira completa.
7. Relatórios financeiros/exportação PDF e planilha.
8. Calhas: bobinas por lote, peso/densidade configurável, consumo por peça; sobras, perdas e custos integrados ao estoque sem baixar estoque no orçamento.
9. Produção simples: prazo por data, cortador, dobrado, conferente e liberação após conferir peças.
10. Operação: central diária, próxima ação, responsáveis, solicitações e conferência de carregamento.
11. Instalações/equipes/veículos: agenda, conclusão, custos reais e salários com acesso restrito.
12. Compras: histórico/comparação de preços, necessidades consolidadas e recebimento integrado.
13. W Vetro: gestão e importação revisada de documentos; preservar orçamento técnico externo, não inventar API.
14. IA financeira/operacional e documentos, com acesso por perfil e auditoria; sem movimentar dinheiro ou enviar mensagens autonomamente.
15. Auditoria funcional autenticada integral por perfil, desktop/mobile, PDF e integrações reais.

## Verificações e publicação
- Testes: npm run test:unit -- --reporter=dot; npm run typecheck; npm run build.
- PostgreSQL isolado: tests/helpers/database.ts aplica migrations no PGlite; não equivale a integração hospedada.
- Atualizar scripts/verificar-banco-producao.sql ao mudar estrutura/funções/triggers.
- Workflow aplicar-migrations: PR com label aplicar-migrations, usa secret SUPABASE_DB_URL já configurado, ignora registros existentes em crm_admin.migrations. Nunca reaplicar migrations antigas indiscriminadamente.
- Antes do merge: aguardar CI completo (tipos/segurança/build e banco/PostgREST/E2E) e migration.
- Depois: confirmar Vercel Ready/Production/Current e commit correto.
- Reversão preferencial: deploy anterior; manter novas estruturas aditivas sem apagar dados.

## Documentação de referência
- Prompt mestre original: C:\Users\Cliente\.codex\attachments\5350eac8-0519-498d-b9f8-d08076143794\Texto colado.txt
- Diagnóstico no repo: AUDITORIA-EVOLUCAO-2026-11-12.md.
- Resultado operacional posterior: C:\Users\Cliente\Documents\ChatGPT\crm bielenki\ENTREGA-CONFIRMADA-2026-11-12.md.
- Este arquivo deve ser atualizado a cada conclusão e antes de interromper o trabalho. Preservar a fila e indicar claramente arquivos em desenvolvimento, testes, branch, PR, migrations aplicadas e deploy confirmado.

## Arquivos desta etapa
- Migration transacional 20261112152640_financial_classification.sql: duas tabelas com RLS; vínculos por empresa/tipo; validação de ativos; auditoria privada; sugestões idempotentes; view ampliada.
- app/(crm)/financeiro/classificacoes/page.tsx: consulta/gestão e classificação de contas existentes.
- app/(crm)/financial-classification-actions.ts: gravações validadas e autorizadas.
- components/financial-classification-fields.tsx, lib/financial-classification.ts: campos compartilhados e carregamento paginado.
- Formulário e ação de novas contas e listagem financeira integrados.
- Testes financeiros de classificação, campos e cenário em tests/e2e/business.test.mjs.
- Gerador de diagnóstico aceita --pglite e inclui funções privadas: node --experimental-strip-types tests/db/generate-prod-check.mjs --pglite.
- REQUISITOS-PROMPT-MESTRE.md contém a referência original completa para continuidade.
- Antes de publicar: criar PR, conferir diff remoto idêntico, aguardar CI e aplicar-migrations, integrar, conferir deploy e atualizar este status.
