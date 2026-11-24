# Plano de Implementação — LIA Bielenki V2

## Fases de Execução

### Fase 1: Infraestrutura e Motor de Regras
- [ ] Criar tabelas `lia_rules`, `lia_knowledge` e `lia_approvals`.
- [ ] Implementar validações server-side para regras financeiras (entrada 50%, parcela mín. R$100).
- [ ] Migrar regras críticas dos prompts para o banco de dados.

### Fase 2: Estabilização WhatsApp e Multimídia
- [ ] Integrar serviço de transcrição de áudio (ex: Gemini/Whisper).
- [ ] Implementar análise de imagens para extração de medidas preliminares.
- [ ] Refinar o watchdog para reconexão automática em caso de falhas prolongadas.

### Fase 3: Central de Controle LIA
- [ ] Desenvolver interface administrativa com 19 categorias.
- [ ] Implementar simulador de conversas para testes de regressão.
- [ ] Criar editor de prompt versionado com diff e rollback.

### Fase 4: Autonomia Progressiva
- [ ] Liberar operações de baixo risco (triagem, agendamento de visita).
- [ ] Implementar fluxo de aprovação humana para orçamentos e alterações contratuais.
- [ ] Ativar kill switch granular por setor ou operação.

## Critérios de Aceite
- 973 IDs de regras mapeados e validados.
- Simulador isolado da produção funcionando.
- Zero falhas críticas nos testes de segurança e RLS.