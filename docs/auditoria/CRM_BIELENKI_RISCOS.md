# Matriz de Riscos — CRM Bielenki

**Data:** 20/11/2026 
**Versão:** 2.0 (atualizada com código real de produção) 
**Base:** Análise direta do repositório `anderrsc/crm-bielenki`@`c444dfe`, 140 migrações, testes e workflows

---

## 1. RISCOS CRÍTICOS (P0/P1)

### R01 — Instabilidade da Conexão Evolution API (WhatsApp)
**Probabilidade:** ALTA (confirmada em diagnóstico de produção 19/11) 
**Impacto:** CRÍTICO (paralisa atendimento, IA Lia e automações) 
**Descrição:** Sessão Baileys no servidor Evolution (Hospede Aqui) entra em estado "zumbi": conexão aparece como "open" mas para de receber mensagens por longos períodos (ex.: principal sem mensagens desde 15:04 em 19/11). Vigia automático publicado (#112) reinicia conexão quando detecta 20 min sem eventos de mensagem no expediente, mas eficácia ainda não foi confirmada em produção.

**Mitigação:**
- Monitorar logs de reinício automático por 48-72h
- Validar que mensagens paradas são entregues após reinício
- Ter procedimento manual de QR code pronto se reinício falhar
- Avaliar migração para WhatsApp Cloud API oficial (Meta) se problemas persistirem

**Plano de Contingência:**
- Procedimento documentado para reconectar QR code manualmente
- Número reserva configurado em `whatsapp_channels`
- Comunicação proativa aos clientes via canal alternativo (e-mail/SMS)

**Responsável:** Equipe técnica + proprietário (acompanhamento)

---

### R02 — Ausência de Ambiente de Homologação Dedicado
**Probabilidade:** MÉDIA 
**Impacto:** ALTO (testes podem afetar dados reais ou não refletir produção) 
**Descrição:** Não há projeto Supabase separado para staging/homologação. Testes usam banco local com PGlite ou Postgres isolado, mas deploy de novas funcionalidades vai direto para produção na Vercel após merge na `main`.

**Mitigação:**
- Usar feature flags (`fiscal_settings.enabled`, `ai_agent_config.lia_followups_enabled`) para desligar funcionalidades em desenvolvimento
- Criar projeto Supabase de staging (gratuito) para testes pré-produção
- Validar migrações em banco local antes de aplicar em produção

**Plano de Contingência:**
- Rollback rápido via revert de PR na `main` (Vercel publica versão anterior automaticamente)
- Backup diário do Supabase (verificar política atual em produção)

---

### R03 — Código do JARVIS Fora do Repositório
**Probabilidade:** 100% (confirmado) 
**Impacto:** ALTO (impossível auditar, testar ou evoluir integração completa) 
**Descrição:** JARVIS é um aplicativo separado (`https://jarvis-ai-crm-bielenki.vercel.app`) cujo código-fonte **não está neste repositório**. Existem apenas RPCs no banco para buscar cliente e agendar medição, mas agentes, regras de negócio e lógica de IA estão em outro lugar não auditável.

**Mitigação:**
- Solicitar acesso ao repositório do JARVIS para auditoria completa
- Documentar endpoints e contratos de API entre CRM e JARVIS
- Trazer código do JARVIS para este repositório (monorepo) ou criar repositório separado com documentação clara

**Plano de Contingência:**
- Tratar JARVIS como "caixa preta" por enquanto
- Focar em API segura para agentes externos (Fase 6 do plano)

---

### R04 — Emissão de Notas Fiscais Pausada
**Probabilidade:** 100% (decisão do dono) 
**Impacto:** MÉDIO (sistema fiscal incompleto, dependência de processo manual) 
**Descrição:** Calculadora fiscal está implementada e funcional, mas **emissão de NF-e/NFS-e foi pausada** por decisão do proprietário. Sistema só simula tributos, não emite documentos fiscais reais.

**Mitigação:**
- Manter calculadora ativa para planejamento tributário
- Exportar CSV das simulações para contador
- Aguardar decisão do dono para retomar emissão (depende de certificado digital A1/A3, emissor homologado, etc.)

**Plano de Contingência:**
- Processo manual de emissão fora do sistema (contador)
- Documentar fluxo futuro para quando emissão for retomada

---

## 2. RISCOS TÉCNICOS (P1/P2)

### R05 — Falta de Testes de Integração Real com WhatsApp
**Probabilidade:** ALTA 
**Impacto:** ALTO (bugs de sincronização só aparecem em produção) 
**Descrição:** Existem testes unitários do webhook (`tests/whatsapp-webhook.test.ts`) e E2E, mas **nenhum teste integra Evolution API real** ou simula cenários de travamento/reconexão. Problemas de sincronização bidirecional só são detectados em produção.

**Mitigação:**
- Criar ambiente de teste com número WhatsApp dedicado (sandbox)
- Simular webhooks de diferentes estados (open, disconnected, reconnecting)
- Testar reconciliação de histórico com grandes volumes de mensagens

**Plano de Contingência:**
- Monitoramento manual intensivo nos primeiros dias após deploy
- Procedimento rápido de rollback se bugs críticos forem detectados

---

### R06 — Dependência de API Não Oficial (Evolution/Baileys)
**Probabilidade:** ALTA 
**Impacto:** ALTO (risco de bloqueio do número pelo WhatsApp) 
**Descrição:** Evolution API usa biblioteca Baileys (não oficial do WhatsApp Meta). Uso automatizado em escala pode ser detectado como spam/bot, resultando em banimento do número.

**Mitigação:**
- Limitar volume de mensagens automáticas (configurar `lia_daily_limit`)
- Adicionar delays humanos entre respostas (já implementado em `lib/ai/rate-limit.ts`)
- Avaliar migração para WhatsApp Business API oficial (custo por conversa, mas seguro)

**Plano de Contingência:**
- Ter número reserva configurado em `whatsapp_channels`
- Documentar processo de recuperação de número banido (suporte Meta)

---

### R07 — Políticas RLS Atribuídas a `public` (Incluindo `anon`)
**Probabilidade:** BAIXA 
**Impacto:** CRÍTICO (potencial vazamento de dados entre empresas) 
**Descrição:** Auditoria identificou que algumas políticas RLS foram criadas com `to public` em vez de `to authenticated`. Isso inclui role `anon` do Supabase, que tecnicamente poderia acessar dados se descobrisse URL/anon key.

**Mitigação:**
- Migrar todas as políticas para `to authenticated` em próxima janela de manutenção
- Revisar matriz RBAC (`docs/MATRIZ_RBAC.md`) para garantir isolamento total
- Testar tentativas de acesso cruzado entre empresas com perfis diferentes

**Plano de Contingência:**
- Revogação imediata de permissões se vazamento for detectado
- Auditoria emergencial de `audit_logs`

---

### R08 — Mão de Obra/Impostos/Comissões Não Automatizados por Obra
**Probabilidade:** MÉDIA 
**Impacto:** MÉDIO (resultado por obra incompleto, margens imprecisas) 
**Descrição:** View `v_order_result` calcula previsto/comprometido/realizado para materiais e compras, mas **não inclui custo de mão de obra, impostos e comissões** automaticamente. Financeiro precisa lançar manualmente fora do sistema.

**Mitigação:**
- Implementar tabela `order_labor_costs` e rateio automático (Fase 6 do plano)
- Configurar percentuais de impostos por tipo de venda
- Automatizar cálculo de comissões sobre venda líquida

**Plano de Contingência:**
- Planilha externa temporária para rateio manual (contator)
- Documentar limitação para usuários saberem que números são aproximados

---

### R09 — Regressão Visual A4 dos Orçamentos
**Probabilidade:** MÉDIA 
**Impacto:** BAIXO/MÉDIO (impressão fica feia, mas funcional) 
**Descrição:** Após mudanças de ocultação de valores unitários e diluição de deslocamento/mão de obra, **layout A4 não foi refeito** conforme relatado em `docs/RELATORIO_AUDITORIA.md`. Elementos podem estar desalinhados ou cortados na impressão.

**Mitigação:**
- Testar impressão com orçamentos reais de diferentes tamanhos
- Ajustar CSS de impressão (`quote-paper.css`) para responsividade
- Validar em navegadores diferentes (Chrome, Edge, Firefox)

**Plano de Contingência:**
- PDF gerado via Puppeteer na Vercel deve ser consistente; se problema for só em impressão direta do navegador, orientar usuário a usar botão "Gerar PDF"

---

## 3. RISCOS OPERACIONAIS

### R10 — Decisão Pendente: WVetro × Total por Linha
**Probabilidade:** 100% (aguardando dono) 
**Impacto:** BAIXO/MÉDIO (confusão visual para cliente, possível questionamento) 
**Descrição:** Orçamentos importados do WVetro mostram **total por linha estimado pela metragem** (não vem do WVetro, só o total geral). Cliente pode achar que valores unitários são reais e questionar discrepâncias.

**Mitigação:**
- Aguardar decisão do dono (Opção A: manter / Opção B: ocultar unitários / Opção C: toggle)
- Implementar opção escolhida rapidamente (1-2 dias de dev)

**Plano de Contingência:**
- Explicar verbalmente ao cliente que valores por linha são estimativas para fechar no total
- Se questionado, gerar PDF sem detalhamento por linha

---

### R11 — Formulário da Lia Não Respondido
**Probabilidade:** 100% (aguardando dono) 
**Impacto:** ALTO (automações pendentes travadas, IA subutilizada) 
**Descrição:** Documento `docs/LIA_FORMULARIO_PENDENCIAS.md` contém questões críticas sobre pré-orçamento, visão de foto/PDF, ferramentas tipadas, aprovações, lembrete de visita, pedido pronto, pós-venda Google, encerramento em 2h e resumo diário. **Sem respostas, não é possível implementar automações.**

**Mitigação:**
- Agendar reunião com dono para responder formulário
- Priorizar automações de maior impacto (ex.: pré-orçamento automático)
- Implementar gradualmente conforme decisões forem tomadas

**Plano de Contingência:**
- Manter Lia em modo assistente/semiautomático até automações serem liberadas
- Equipe responde manualmente o que a IA faria

---

### R12 — Validade Padrão do Orçamento: Divergência (7 vs 10 dias)
**Probabilidade:** MÉDIA 
**Impacto:** BAIXO (confusão de comunicação, possível insatisfação) 
**Descrição:** Lia informa **10 dias** de validade em conversas (`lia-knowledge.ts`), mas configuração padrão do sistema é **7 dias** (`companies.default_validity_days` definido na migração `20261105190000`). Cliente pode receber informações conflitantes.

**Mitigação:**
- Confirmar com dono qual validade usar (provavelmente 10 dias por ser mais comercial)
- Alinhar `companies.default_validity_days` com texto da Lia
- Ou personalizar por tipo de orçamento (calhas vs esquadrias)

**Plano de Contingência:**
- Informar equipe comercial para esclarecer validade ao enviar orçamento
- Incluir validade explicitamente no PDF do orçamento

---

## 4. RISCOS DE SEGURANÇA

### R13 — Exposição de Secrets em Logs
**Probabilidade:** BAIXA 
**Impacto:** CRÍTICO (chaves de API, tokens e credenciais comprometidos) 
**Descrição:** Embora haja criptografia de secrets no banco (`lib/encrypt.ts`), **logs de debug ou erro podem expor variáveis de ambiente** se desenvolvedores usarem `console.log(process.env)` acidentalmente.

**Mitigação:**
- Revisar todos os `console.log` e `console.error` em código sensível
- Usar biblioteca de logging estruturado com filtro de dados sensíveis
- Variáveis de ambiente nunca devem ser impressas diretamente

**Plano de Contingência:**
- Rotação imediata de todas as chaves se exposição for detectada
- Remover logs sensíveis do histórico (Vercel logs têm retenção limitada)

---

### R14 — Webhook sem Validação de Assinatura em Dev
**Probabilidade:** MÉDIA 
**Impacto:** ALTO (payloads maliciosos podem injetar mensagens falsas) 
**Descrição:** Webhook do WhatsApp (`app/api/whatsapp/webhook/route.ts`) **ignora validação de assinatura** se `WHATSAPP_APP_SECRET` não estiver configurado e ambiente for `development`. Em produção, validação é obrigatória, mas configuração incorreta pode deixar brecha.

**Mitigação:**
- Garantir que `EVOLUTION_WEBHOOK_SECRET` esteja configurado em produção
- Bloquear webhook sem segredo mesmo em dev (usar valor fixo para teste)
- Validar origem do request por IP whitelist se possível

**Plano de Contingência:**
- Bloquear IP de origem se payloads suspeitos forem detectados
- Rotacionar segredo do webhook

---

### R15 — Motor Fiscal Sem Autenticação Própria
**Probabilidade:** BAIXA 
**Impacto:** MÉDIO (uso indevido se URL vazar, mas motor é público) 
**Descrição:** Calculadora oficial da Receita (`piloto-cbs.tributos.gov.br`) **não tem autenticação**. Se CRM usar motor próprio futuro (Fly.io cotado como plano B), ele precisará de proxy com segredo para evitar abuso.

**Mitigação:**
- Manter chamada ao motor oficial apenas pelo backend (nunca frontend)
- Implementar rate limiting interno para chamadas fiscais
- Se contratar motor próprio, adicionar autenticação JWT/API key

**Plano de Contingência:**
- Se URL do motor próprio vazar, rotacionar segredo imediatamente
- Monitorar uso anormal via logs

---

## 5. MATRIZ RESUMO

| Risco | Prob. | Impacto | Prioridade | Status |
|-------|-------|---------|------------|--------|
| R01 — WhatsApp instável | ALTA | CRÍTICO | **P0** | ⚠️ Vigia publicado, eficácia não confirmada |
| R02 — Sem homologação | MÉDIA | ALTO | P1 | ❌ Pendente |
| R03 — JARVIS fora do repo | 100% | ALTO | P1 | ❓ Aguardando acesso |
| R04 — Emissão fiscal pausada | 100% | MÉDIO | P1 | ✅ Decisão do dono |
| R05 — Testes WhatsApp limitados | ALTA | ALTO | P1 | ❌ Pendente |
| R06 — API não oficial | ALTA | ALTO | P1 | ⚠️ Conhecido |
| R07 — RLS para `public` | BAIXA | CRÍTICO | P1 | ❓ Não verificado |
| R08 — Custos obra incompletos | MÉDIA | MÉDIO | P2 | ❌ Pendente |
| R09 — Regressão visual A4 | MÉDIA | BAIXO/MÉDIO | P2 | ❌ Pendente |
| R10 — Decisão WVetro | 100% | BAIXO/MÉDIO | P1 | ⏳ Aguardando dono |
| R11 — Formulário Lia | 100% | ALTO | P1 | ⏳ Aguardando dono |
| R12 — Validade divergente | MÉDIA | BAIXO | P2 | ❓ Não alinhado |
| R13 — Secrets em logs | BAIXA | CRÍTICO | P1 | ✅ Mitigado (boas práticas) |
| R14 — Webhook sem validação | MÉDIA | ALTO | P1 | ⚠️ Parcial (dev ignora) |
| R15 — Motor fiscal sem auth | BAIXA | MÉDIO | P2 | ✅ Mitigado (backend only) |

---

## 6. RECOMENDAÇÕES PRIORITÁRIAS

1. **Imediato (P0):** Monitorar eficácia do vigia automático do WhatsApp por 48-72h. Se reinícios não resolverem, preparar reconexão manual e avaliar WhatsApp Cloud API oficial.

2. **Curto prazo (1-2 semanas, P1):**
 - Responder formulário da Lia com dono e implementar automações aprovadas
 - Decidir sobre WVetro × total por linha e ajustar impressão
 - Confirmar cobrança Pix com envio real e validar extrato
 - Ativar calculadora fiscal em produção (configurar classificações)

3. **Médio prazo (1 mês, P2):**
 - Criar ambiente de homologação Supabase dedicado
 - Implementar custos completos por obra (mão de obra, impostos, comissões)
 - Migrar políticas RLS de `public` para `authenticated`
 - Trazer código do JARVIS para auditoria ou documentar API de integração

4. **Longo prazo (trimestre):**
 - Migrar de Evolution API para WhatsApp Business API oficial (segurança)
 - Reduzir dependência de colaborador único (documentação + treinamento)
 - Implementar suite completa de testes de integração WhatsApp

---

**Próxima revisão:** Após conclusão das fases P0.1 (estabilização WhatsApp) e P1 (ativação fiscal + decisões pendentes), ou quando novos riscos forem identificados em produção.