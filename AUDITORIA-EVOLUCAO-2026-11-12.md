# Evolução do CRM — entrega financeira inicial

Base publicada antes desta entrega: `main` em `475a375017802781d748c559ab08317e70365cd8`, PRs #64 e #65 integrados. Este documento distingue o que foi verificado do escopo ainda pendente do prompt mestre. Não certifica a conclusão das oito fases.

## Diagnóstico e cobertura

| Área do pedido | Evidência existente | Resultado / trabalho restante |
| --- | --- | --- |
| Auditoria de estrutura, dados e permissões | Migrations, `scripts/verificar-banco-producao.sql`, testes PostgreSQL e RLS | Estrutura esperada anterior conferida em produção. Auditoria funcional integral por perfil e fluxo ainda pendente. Nenhum histórico reescrito nesta entrega. |
| Financeiro: indicadores e filtros | `components/financial-page.tsx`, `financial_entries`, `payments`, `financial_installments` | Corrigidos cancelados contados como quitados, datas inválidas, paginação instável e totais parciais silenciosos. Totais consideram todos os registros filtrados. |
| Projeção financeira | Nova RPC `financial_control_totals` | Recebimentos, pagamentos e variação acumulada em 7/15/30/60/90 dias. Parcelas usam suas próprias datas e alocação do valor pago, sem somar novamente o título pai. Vencidos e contas sem data ficam fora da projeção, explicitamente. |
| Caixa, DRE e rentabilidade | `components/reports-page.tsx`, `reporting_summary` | Relatórios básicos existentes. Saldo inicial de banco, competência, custos completos e margens por obra ainda precisam de implementação e validação. A projeção nova não representa saldo bancário nem lucro. |
| Plano de contas, centros de custos e obra | Pedidos, vendas e compras já relacionados no schema | Classificação, rateios e apuração completa ainda pendentes. Reutilizar `orders` como vínculo da obra; não criar cadastros paralelos sem integração. |
| Contas a pagar/receber e auditoria | Pagamentos parciais, ajustes, parcelamento, estorno; RLS e `audit_logs` | Fluxos transacionais já existem e têm testes. Alçadas, conciliação OFX/CSV idempotente, recorrências e relatórios completos exigem evolução própria. |
| Calhas e estoque industrial | `gutter_prices`, orçamentos de calhas, `materials`, `stock_movements` | Preços e orçamento preservados. Bobinas por lote, peso/densidade, consumo por peça, sobras e perdas não foram entregues nesta etapa. |
| Produção | `production_orders`, `production_steps`, `components/production-flow-page.tsx` | Etapas operacionais existentes. Cortador, conferente, prazo simples por data e liberação por conferência ainda precisam ser confrontados integralmente com os requisitos. |
| Operação diária e solicitações | Pedidos, próxima ação, responsáveis, pendências, agenda e `lib/operations.ts` | Bases existentes; central unificada, solicitações rápidas e conferência de carregamento completas ainda pendentes. |
| Instalação, equipes e veículos | `installations`, checklist obrigatório e agenda | Checklist e bloqueios existentes testados. Custos detalhados, carga de equipe, salários com acesso restrito e veículos ainda não entregues. |
| Compras | Compras manuais, requisições, itens vinculados a pedidos, recebimento e movimentos | Recebimento parcial e isolamento de empresa têm testes existentes. Comparação histórica e consolidação de necessidades ainda pendentes. |
| Esquadrias / W Vetro | Fluxos de venda e produção existentes | Preservados. Importação assistida de documentos, revisão e custos completos não implementados; nenhuma API W Vetro inventada. |
| IA e automações | Central de IA, triagem, `automation-dispatcher`, operações e notificações | Otimizações e dispatcher anteriores aplicados. Assistentes financeiros/operacionais completos e leitura revisada de documentos ainda pendentes. Nenhuma mensagem real enviada pela auditoria. |
| Desktop, celular e documentos | Listas, preços responsivos, catálogo e PDF | Melhorias do PR #65 publicadas. Validação autenticada integral dos novos fluxos em desktop/celular continua necessária. |
| Infraestrutura e segurança | Supabase, Vercel, Evolution local | Deploy anterior pronto; Evolution e PostgreSQL locais saudáveis. Removida do instalador a exclusão automática de volume em erro de senha; agora preserva dados, salva cópia do compose e interrompe com erro. Rotação de Groq/Evolution ainda pendente. |

## Implementação desta entrega

- Uma função SQL somente de leitura, `SECURITY INVOKER`, restrita a `authenticated`, com filtro explícito da empresa e RLS. A RPC antiga permanece compatível com versões anteriores.
- Nenhuma tabela criada, nenhum lançamento alterado, nenhuma credencial rotacionada e nenhum envio executado.
- A projeção acompanha os filtros de títulos da tela. Os vencimentos das parcelas determinam em qual prazo os saldos selecionados entram. Períodos são acumulados e não devem ser somados entre si.
- Pagamentos são alocados por ordem das parcelas a partir do valor pago do título. Isso evita depender de saldos de parcelas desatualizados após um estorno.
- Em caso de erro de consulta, a tela mostra indisponibilidade; não apresenta uma página de 60 registros como se fosse o total geral.

## Verificação e publicação

Testes novos cobrem mais de 60 títulos, cancelamentos, filtro de quitados, decimais, limites de datas, pagamentos parciais, parcelas, estorno, outra empresa, execução anônima e falhas de consulta na tela. O instalador tem teste que impede a reintrodução de exclusão de volumes.

Validação local concluída: 449 testes aprovados em 53 arquivos, `npm run typecheck` e `npm run build` aprovados. A bateria completa de PostgREST, banco e navegação será executada pelo CI antes do merge; os testes locais não substituem o uso autenticado em produção.

A migration `20261112145112_financial_control_summary.sql` foi criada pela CLI. Sua ordenação anterior à migration de filtros já existente é suportada: a função consulta o vínculo de serviço em `sales`, sem depender da coluna que a view recebe posteriormente. A sequência completa foi aplicada no PostgreSQL isolado.

Publicar somente depois de testar e aplicar a migration. Reversão: voltar ao deploy anterior; a função adicional pode permanecer sem uso. Não é necessário desfazer dados. CI, merge e deploy devem ser confirmados nas plataformas antes de declarar publicação concluída.

## Plano gratuito e credenciais

Estas alterações usam recursos disponíveis sem plano Pro. A proteção contra senhas vazadas do Supabase foi exibida como recurso Pro; não foi ativada nem contratado plano.

A rotação de Groq/Evolution exige sincronizar as novas chaves com os consumidores e testar a conexão antes de revogar as antigas. Pelo navegador, o titular precisa criar, preencher e submeter novas credenciais. Não publicar chaves em Git, relatórios ou chat.

O restante do prompt mestre segue pendente conforme a matriz acima. As próximas entregas devem concluir os módulos financeiros de classificação e apuração por obra antes do controle industrial.
