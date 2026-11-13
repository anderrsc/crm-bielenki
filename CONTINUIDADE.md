# CRM Bielenki — continuidade em 13/11/2026

## Concluído e aplicado
- PR #71 caixa: CI completo aprovado (476 testes de unidade/banco + suíte Postgres/PostgREST/navegador). Migrations `20261113120000` e `20261113121725` aplicadas; diagnóstico sem pendências, workflow 43433007273. Merge main `81e6095c6af857fa6f4ca75aaafab2d603ffdc10`. Vercel Production Ready em 13/11 10:25 BRT.
- PR #72 conciliação OFX/CSV: 487 testes locais, tipos/build e CI completo aprovados. Migration `20261113124117` aplicada; diagnóstico sem pendências, workflow 43434280207. Merge main `36305151cdff03e8363df32a458599910169cbf8`. Vercel Production Ready em 13/11 10:34 BRT.
- Conciliação importa sem baixar pagamentos, impede reimportação duplicada, oferece associação/baixa/taxa explícita, justificativa e histórico; isola empresas e invalida conferência após estorno/alteração. Não movimenta banco externo.
- Chaves Groq/Evolution já tratadas; antigas Groq mantidas por decisão do usuário. Não repetir rotações.

## Em desenvolvimento, ainda sem aplicação ou publicação
- Pasta `C:\Users\Cliente\Documents\ChatGPT\crm bielenki\crm-financial-recurrences`, branch `codex/financial-recurrences`.
- Recorrências mensais/trimestrais/semestrais/anuais, datas com último dia do mês, edição/pausa sem reescrever contas existentes, criação explícita por competência sem pagamento e chave única por mês.
- Previsão agregada da folha restrita; sem folha individual. Contas geradas ficam no financeiro comum, com aviso na interface.
- Projeção inclui competências ainda não lançadas e compras confirmadas sem conta; substitui previsão por conta sem duplicar. Compras com conta cancelada não são recriadas na previsão. Aviso de projeção parcial por permissões.
- Migration CLI `20261113132712_financial_recurrences.sql`, ações, tela e teste E2E criados. Sete testes de banco focados passaram, incluindo replay, acesso entre empresas e perfil inativo; typecheck e build passaram; bateria local de 493 testes aprovada antes do teste adicional de isolamento. Ainda precisa concluir validação, comparar remoto/local, PR, CI completo, aplicação e deploy.

## Próximos módulos ainda pendentes
1. Alçadas de aprovação e permissões de aprovação/cancelamento/exportação.
2. Auditoria financeira integral e relatórios PDF/planilha com filtros.
3. Resultado completo por obra: previsto/comprometido/realizado, extras, materiais, compras, mão de obra, instalações, impostos/comissões; indicar margem parcial enquanto faltarem custos.
4. Bobinas/lotes/consumo/sobras/perdas; produção por corte/dobra/conferência e liberação.
5. Operação diária, solicitações/carregamento, equipes/veículos e folha individual restrita.
6. Compras consolidadas, comparação/histórico, importação W Vetro assistida/revisada.
7. IA financeira/operacional com autorização e auditoria.
8. Validação autenticada integral, PDFs, perfis e integrações reais. Sessão do CRM estava desconectada; solicitação de login enviada sem interromper testes isolados.

## Operação
- Referência: `REQUISITOS-PROMPT-MESTRE.md` no repositório. Não declarar o projeto inteiro pronto.
- Original `crm-bielenki` e alterações locais do usuário preservados. Outros worktrees: `crm-finance-finalizacao`, `crm-bank-reconciliation`.
- Git em `$env:TEMP\crm-git\cmd\git.exe`; Node em `$env:TEMP\crm-tools\node-v22.23.5-win-x64`. Sem credencial CLI de push; publicação pela interface GitHub autenticada.
- Supabase CLI 2.101.0; criar migrations com CLI. SQL em LF. Diagnóstico: `node --experimental-strip-types tests/db/generate-prod-check.mjs --pglite`.
- Aplicação via label `aplicar-migrations` após CI verde. Conferir logs, diagnóstico, merge e Vercel Ready/Production/commit exato.
- Não apagar dados reais, volumes Docker ou reconfigurar WhatsApp. Testes usam banco isolado.
