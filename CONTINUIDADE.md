# Continuidade — 13/11/2026

## Estado confirmado
- Produção main: 88584c1a454119e8b21ce1282fe3cd7022bffa67 (PR #70), deployment Production com sucesso.
- #67: categorias/centros, classificação e preservação de ajustes/parcelas nas baixas — integrado.
- #68: consultas de venda/instalação em paralelo — integrado.
- #69: rateios e resultado inicial por obra — integrado; margem completa ainda pendente.
- #70: produção automática/por fase, aviso de instalado e DRE por competência — integrado; DRE sem exportação.
- #71: caixa por conta/cenários — ABERTO, ainda sem merge/deploy. Base original 1987dad teve CI aprovado.

## Trabalho atual
- Workspace ativo: C:\Users\Cliente\Documents\ChatGPT\crm bielenki\crm-finance-finalizacao
- Branch local: codex/finance-finalizacao, criada da branch remota claude/crm-system-not-working-3qhgyk (#71).
- O checkout antigo crm-bielenki, incluindo CONTINUIDADE.md modificado, foi preservado.
- Acrescentada migration 20261113121725_cash_safety.sql: saldo de hoje exclui baixas futuras, mas as projeta na data; usa dia de Brasília; exige permissão financeira também em gravação direta do saldo; bloqueia data inicial futura e valores não finitos; audita saldo inicial com usuário/antes/depois em função privada.
- Tela/ação do caixa limitam a data inicial. Cenário E2E novo salva saldo e verifica os três cenários no celular.
- Validação: bateria local de 475 testes aprovada, TypeScript aprovado; teste adicional de valor não finito aprovado no conjunto focado de 4 testes de segurança do caixa. Build de produção aprovado.
- Nada desta revisão foi aplicado ao banco de produção nem publicado ainda.
- Próximo: enviar revisão à branch do #71, aguardar CI completo, aplicar migrations, integrar e confirmar Vercel. Depois desenvolver conciliação.

## Fila restante
1. Caixa: concluir #71 e revisão de segurança descrita acima.
2. Conciliação OFX/CSV: não há código enviado no remoto, apesar da afirmação na imagem anterior. Implementar importação idempotente, sugestões e conferência explícita, taxas e histórico; não baixar dinheiro silenciosamente.
3. Recorrências, folha/encargos e compras confirmadas não lançadas na projeção; não duplicar compromissos.
4. Alçadas de aprovação e permissões próprias para conciliação/aprovação/exportação.
5. Auditoria financeira completa (valores, vencimentos, baixas, cancelamentos, dados bancários e justificativas); não excluir história financeira.
6. Relatórios PDF/planilha com filtros e data/período, incluindo DRE/caixa/obra/setor/cliente/fornecedor.
7. Resultado completo por obra: previsto/comprometido/realizado, consumo, compras, mão de obra, instalações, extras, impostos/comissões; sinalizar parcial. Corrigir recebimentos de adicionais e integração de compras/estoque.
8. Calhas: bobinas/lotes/peso/densidade, consumo por peça, sobras e perdas; não baixar estoque ao orçar.
9. Produção simples: cortador/dobra/conferência/conferente/prazo por data/liberação de peças.
10. Operação diária, solicitações e carregamento.
11. Equipes, custos de instalação, folha restrita e veículos.
12. Compras consolidadas/comparação de preços/histórico.
13. W Vetro: importação assistida/revisada e gestão; orçamento técnico continua externo.
14. IA financeira/operacional/documentos com autorização e auditoria, sem movimentar dinheiro ou enviar mensagens por conta própria.
15. Validação autenticada integral desktop/celular/PDF/perfis e integrações reais.

## Regras e ferramentas
- Referência completa: REQUISITOS-PROMPT-MESTRE.md. Uma etapa por vez; não declarar o escopo inteiro pronto.
- Nenhum volume Docker ou histórico real pode ser apagado. Não enviar WhatsApp real na auditoria.
- Groq nova chave CRM funciona; chaves antigas mantidas por decisão do usuário. Evolution rotacionado/testado, banco preservado. Não repetir rotação.
- Git: $env:TEMP\crm-git\cmd\git.exe. Node/npm: $env:TEMP\crm-tools\node-v22.23.5-win-x64; NODE_OPTIONS=--use-system-ca.
- Supabase CLI fixada em 2.101.0; novas migrations via migration new. Regenerar diagnóstico com node --experimental-strip-types tests/db/generate-prod-check.mjs --pglite.
- CI: npm run test:unit, npm run typecheck, npm run build; PostgREST/banco/E2E no workflow ci.yml.
- Workflow aplicar-migrations por label no PR usa secret já existente e crm_admin.migrations. Não reaplicar migrations antigas indiscriminadamente.
- Publicação anterior via GitHub UI autenticada, sem credencial CLI de push. Conferir ferramentas atuais antes de escolher a interface.
- Este arquivo deve registrar o estado real de CI/migration/merge/deploy ao concluir cada etapa.
