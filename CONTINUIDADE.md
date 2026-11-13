# CRM Bielenki — continuidade em 13/11/2026

## Aplicado e publicado
- PR #71: caixa por conta, três cenários, proteção/auditoria do saldo e baixas futuras. CI completo aprovado; migrations 20261113120000 e 20261113121725 aplicadas, diagnóstico vazio (run 43433007273). Merge 81e6095c6af857fa6f4ca75aaafab2d603ffdc10; Vercel Production Ready 10:25 BRT.
- PR #72: conciliação OFX/CSV sem baixa automática, idempotência, associação/baixa/taxa explícita, histórico e permissões. 487 testes locais e CI completo aprovados; migration 20261113124117 aplicada, diagnóstico vazio (run 43434280207). Merge 36305151cdff03e8363df32a458599910169cbf8; Vercel Production Ready 10:34 BRT.
- PR #73: recorrências mensais/trimestrais/semestrais/anuais e previsão agregada restrita da folha. Criação explícita por competência, sem pagamentos e sem duplicar previsão. Inclui compras confirmadas ainda sem conta; não recria contas canceladas. CI completo aprovado no head f8272ae2939db671a6ab18254645b8996c17000e; migration 20261113132712 aplicada e diagnóstico vazio (run 43438708056). Merge 3bd6a6cfec408f409fe247f9f4139f2e3f7b9c78. Vercel Production Ready em 13/11 11:05 BRT, domínio principal vinculado ao commit correto.
- Groq/Evolution já tratados; antigas Groq mantidas por decisão do usuário. Não repetir rotações.

## Etapa atual — relatórios, ainda sem PR/aplicação/deploy
- Pasta C:\Users\Cliente\Documents\ChatGPT\crm bielenki\crm-financial-reports, branch codex/financial-reports.
- Migration CLI 20261113134630_financial_reports.sql: permissão financial_exports, grupos de relatório em categorias (sem classificação automática histórica), RPC de relatórios e auditoria de exportação; DRE agregada em JSON evita corte no limite da API e rejeita períodos acima de 36 meses.
- Nova view v_order_financial_report preserva a view anterior para permitir replay das migrations antigas. Totais de recebimentos/recebíveis incluem extras rateados; margem permanece explicitamente parcial.
- Tela /financeiro/relatorios e API /api/financeiro/relatorio: PDF A4 e CSV protegido contra fórmulas. Período, critérios e geração; permissões no servidor, isolamento por empresa, cache privado e registro de exportação. Prévia limitada explicitamente a 100 linhas; exportação inclui todas, até limites informados.
- Relatórios: executivo, mensal, DRE, caixa, vencidos, fornecedores, recebimentos por cliente, obras, setores, fabricação, instalação, veículos, materiais, extraordinárias e contratado x custos lançados. Grupos de custos dependem de classificação explícita. Custos não lançados e orçamento completo por obra continuam pendentes; telas/arquivos avisam.
- Validação: 502 testes locais passaram; tipos e build aprovados. PDF real de 10 páginas renderizado e conferido na primeira/última página, sem cortes. Amostra interna em output/pdf/relatorio-validacao.pdf no diretório raiz da tarefa (somente dados de teste).
- E2E novo verifica preview, PDF/CSV, critérios, auditoria e celular; ainda precisa CI completo. Diagnóstico regenerado: 1242 colunas,153 funções,65 gatilhos.
- Próximo: concluir envio, comparar remoto/local, abrir PR contra main, aguardar CI, aplicar migration, merge e confirmar Vercel.

## Em PR (sessão Claude, branch claude/crm-system-not-working-3qhgyk) — resultado por obra
- Migration 20261113160000_order_result.sql (aditiva; não altera v_order_financials nem v_order_financial_report): coluna orders.expected_cost, função set_order_expected_cost (permissão financeira + auditoria) e view v_order_result.
- v_order_result por obra: contratado (venda + receitas extras rateadas), custo previsto, comprometido (contas de compras da obra ainda não recebidas por completo), realizado (rateios + contas ligadas à venda ou a compra já recebida), pago, margem prevista e margem atual. Nada é contado duas vezes.
- Tela /financeiro/obras: busca por cliente/pedido, filtro de situação, paginação de 25, formulário do custo previsto e aviso de obra acima do previsto. Link no Financeiro. Rota incluída em scripts/route-inventory.json.
- Testes: tests/order-result.test.ts (banco isolado). Sem cenário próprio de navegador além do inventário de rotas.
- Ainda pendente do item 2 da fila: mão de obra, impostos e comissões automáticos por obra, consumo de material do estoque e a paginação/seleção de obras na tela de rateios.
- Atenção: duas sessões (Codex e Claude) trabalham neste repositório. Antes de começar um item, conferir os PRs abertos para não duplicar. Um rascunho duplicado de conciliação/recorrências da sessão Claude ficou só em stash local e NÃO deve ser publicado.

## Fila ainda pendente
1. Alçadas de aprovação e permissões próprias para aprovar/cancelar; auditoria financeira integral com justificativas.
2. Resultado completo por obra: previsto/comprometido/realizado, extras, consumo, compras, mão de obra, instalações, impostos/comissões. Corrigir também limites/paginação e seleção de obras na tela de rateios.
3. Bobinas/lotes/peso/densidade/consumo/sobras/perdas. Produção por corte/dobra/conferência/liberação/prazo.
4. Operação diária, solicitações/carregamento, equipes/veículos e folha individual restrita (a previsão atual é agregada).
5. Compras consolidadas, comparação/histórico e W Vetro assistido/revisado.
6. IA financeira/operacional/documentos com autorização e auditoria; sem movimentar dinheiro ou enviar WhatsApp automaticamente.
7. Validação autenticada integral, PDFs/perfis e integrações reais. CRM estava desconectado; pedido de login enviado, sem resposta até esta atualização. Testes isolados continuam.

## Operação e preservação
- Referência completa: REQUISITOS-PROMPT-MESTRE.md. Não declarar o projeto inteiro pronto.
- Checkout original crm-bielenki e CONTINUIDADE.md do usuário preservados. Outros worktrees: crm-finance-finalizacao, crm-bank-reconciliation, crm-financial-recurrences.
- Git: $env:TEMP\crm-git\cmd\git.exe. Node: $env:TEMP\crm-tools\node-v22.23.5-win-x64. Sem credencial CLI de push; publicação pela UI GitHub autenticada.
- Supabase CLI 2.101.0; migrations criadas via CLI, SQL em LF. Diagnóstico: node --experimental-strip-types tests/db/generate-prod-check.mjs --pglite.
- CI: testes de unidade/banco, tipos/build e suíte Postgres/PostgREST/Puppeteer completa. Não retirar verificações para aprovar.
- Aplicar via label aplicar-migrations após CI verde; workflow registra crm_admin.migrations e não reaplica antigas. Conferir diagnóstico, merge e Vercel Ready/Production/commit exato.
- Nenhum dado real/volume Docker pode ser apagado. Testes usam banco isolado. Reversão das novas funcionalidades: pausar programações/desabilitar acesso; preservar tabelas, contas existentes e auditoria.