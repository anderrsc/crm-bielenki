# Fase 2 — Tarefa 2.2: Auditoria dos Smoke Tests

**Data:** 19/11/2026
**Status:** ✅ Verificada — Nenhuma correção necessária

---

## Investigação

### Arquivos analisados
- `scripts/smoke-test.mjs` (92 linhas)
- `.github/workflows/smoke-test.yml` (36 linhas)

### Resultado

**Não foi encontrado bug de normalização indevida de espaços em credenciais.**

#### `scripts/smoke-test.mjs` (linha 32)
```javascript
const { error } = await db.auth.signInWithPassword({
  email: env.SMOKE_TEST_EMAIL,
  password: env.SMOKE_TEST_PASSWORD
});
```
As variáveis `SMOKE_TEST_EMAIL` e `SMOKE_TEST_PASSWORD` são usadas **diretamente**, sem `.trim()` ou qualquer transformação. Senhas com espaços são preservadas exatamente como configuradas.

#### `.github/workflows/smoke-test.yml` (linhas 29-34)
```yaml
env:
  SMOKE_TEST_EMAIL: ${{ secrets.SMOKE_TEST_EMAIL }}
  SMOKE_TEST_PASSWORD: ${{ secrets.SMOKE_TEST_PASSWORD }}
```
As secrets do GitHub Actions são injetadas diretamente no ambiente, sem processamento adicional.

### Conclusão

O código atual do smoke test **já trata corretamente** credenciais com espaços. Se houve falha anterior relacionada a isso (PR #16 mencionada no PROMPT MESTRE), ela já foi corrigida ou nunca existiu neste arquivo específico.

### Recomendações futuras (não bloqueantes)

1. Adicionar mensagem de erro mais diagnóstica quando a autenticação falhar, diferenciando:
   - Credencial inválida (401)
   - Secret ausente (variável vazia)
   - Erro de conexão (timeout/DNS)
   - Conta desativada/bloqueada
2. Adicionar log estruturado (JSON) para facilitar análise em CI
3. Considerar adicionar verificação de health endpoint (`/api/health`) antes de testar rotas autenticadas

---

**Próxima tarefa:** 2.3 — Auditoria do Pipeline CI/CD