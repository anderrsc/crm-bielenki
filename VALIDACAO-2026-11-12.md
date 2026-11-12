# CRM Bielenki — validação de 12/11/2026

Base: PR #64, commit `0818ff69e6a127d295e40c698dfc2cadc04b1eb8`.
Branch local: `codex/performance-mobile`.

## Implementado localmente

| Pendência | Alteração |
| --- | --- |
| Salvar orçamentos com menos etapas | Uma RPC transacional para cabeçalho, itens, complementos, vendedor e preferências; falhas revertem a operação. Anexos e geração de PDF mantêm seu fluxo próprio. |
| Listas de clientes leves | Até 30 opções por consulta, busca por nome/telefone com espera de 300 ms e preservação do cliente selecionado, inclusive em rascunhos. Aplicado a calhas, esquadrias, venda manual e conta a receber. |
| Central de IA mais leve | Retorna somente as últimas entradas necessárias do histórico; seleciona apenas as colunas utilizadas; conexão e regras carregam ao abrir seus painéis. |
| Consultas de detalhes em paralelo | Registro e checklist do pedido consultados simultaneamente. |
| Preços no celular | Planilha em cartões editáveis; tabelas de pintura, peças e serviços adaptadas; botões da matriz disponíveis ao toque. |

## Validação executada

- TypeScript aprovado.
- Build de produção aprovado. Aviso existente do Supabase no Edge Runtime permanece.
- 443 testes aprovados em 51 arquivos, incluindo PostgreSQL/PGlite, rollback, isolamento por empresa, busca e edição mobile.
- Migration reaplicada com sucesso em banco isolado; diagnóstico de estrutura retornou vazio.
- Novas RPCs usam `SECURITY INVOKER` e não permitem execução anônima.
- JavaScript da rota compartilhada: 85,8 kB na base → 83,3 kB nesta entrega. First Load JS: 270 → 269 kB. Medidas de build, sem benchmark de tempo em produção.
- A bateria completa de navegador/PostgREST não foi executada nesta máquina.

## Estado externo confirmado e pendências

- PR #64 integrado em `main`, commit `2931c8ade4be6467a6acd59c853e1acdc0671892`. As três migrations anteriores constam em `crm_admin.migrations` em produção.
- Nova migration aplicada em produção por transação; os hashes das duas funções conferem com a versão testada localmente. Execução anônima permanece bloqueada.
- `automation-dispatcher` reimplantado com recuperação de reservas interrompidas e reserva atômica antes do envio. O endpoint de envio não foi invocado durante a validação.
- PR #65 integrado em `main`, commit `475a375017802781d748c559ab08317e70365cd8`, CI aprovado e deploy Vercel confirmado como Ready / Production.
- Evolution local respondeu HTTP 200 (v2.3.7); PostgreSQL e túnel foram verificados sem exclusão de volumes. Não foi necessário reexecutar o instalador. Rotação de Groq/Evolution ainda pendente; novas credenciais pelo navegador exigem atuação do titular.
- A auditoria integral do prompt mestre, incluindo financeiro e controle industrial, não está concluída nem certificada por esta entrega.

## Publicação e reversão

1. Aplicar a nova migration antes de publicar o aplicativo: `20261112134348_quote_save_and_central_performance.sql`. Ela adiciona funções e permissões; não migra nem apaga registros existentes.
2. Executar `scripts/verificar-banco-producao.sql`; o resultado deve estar vazio. O workflow existente com o label `aplicar-migrations` já percorre arquivos ainda não registrados, independentemente da data do nome.
3. Publicar a branch após integrar o PR #64 e validar os fluxos de criação/edição de orçamento, cliente fora das primeiras 30 opções e preços no celular.
4. Em caso de regressão, retornar o deploy à versão anterior. As duas novas funções podem permanecer sem uso, sem necessidade de reverter dados de clientes ou orçamentos.
