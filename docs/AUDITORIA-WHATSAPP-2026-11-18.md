# Auditoria do WhatsApp / Atendimento — 18/11/2026

Escopo: `app/api/whatsapp/webhook/route.ts`, `app/api/whatsapp/import-history`, `app/(crm)/atendimento-actions.ts`,
`app/(crm)/whatsapp-connect-actions.ts`, `lib/whatsapp/*`, `lib/ai/*`, `lib/operations.ts`, migrations de
`conversations`, `messages`, `ai_agent_config`, `whatsapp_webhook_events`, `whatsapp_lid_map`.

Legenda de gravidade: **A** alta (perde mensagem/responde errado), **M** média, **B** baixa.

## Riscos investigados

| # | Risco | Situação encontrada | Grav. | Fase / solução |
|---|---|---|---|---|
| 1 | Uma única config WhatsApp por empresa | **Confirmado.** Tudo vem de `ai_agent_config` (1 linha por empresa): URL/chave Evolution, instância, token Meta, IA. | A (bloqueia multinúmero) | Fase 2: tabela `whatsapp_channels` (+ credenciais) com backfill de um canal padrão por empresa. |
| 2 | Instância Evolution padrão `crm` | **Confirmado** (`evolution_instance || "crm"` em vários pontos; `EVOLUTION_INSTANCE`). | M | Fase 2: nome de instância único por canal. |
| 3 | Conversa = empresa + contato, sem canal | **Confirmado.** Índice único `conversations_one_per_contact (company_id, channel, external_id)`; `channel` é sempre `'whatsapp'`. | A (bloqueia multinúmero) | Fase 2: `channel_id` e unicidade (empresa, canal, contato), sem fundir históricos. |
| 4 | Deduplicação sem canal | **Parcial.** `whatsapp_webhook_events (provider, event_id)` e `messages (company_id, external_id)`. IDs de mensagem do WhatsApp são únicos por mensagem, então a colisão real é improvável hoje; com dois números da mesma empresa recebendo a mesma mensagem encaminhada, os IDs são diferentes. | B | Fase 2: incluir `channel_id` na chave. |
| 5 | Sincronização por páginas limitadas | **Confirmado.** `syncRecentEvolutionMessages` lê só a 1ª página; importação completa é manual (Central de IA). | M | Fase 1 (feito): reconciliação automática periódica da página recente. Fase 2: checkpoint por canal (`whatsapp_sync_checkpoints`). |
| 6 | Sincronização dependente de abrir o Atendimento | **Confirmado.** `refreshInboxMessages` rodava só em `loadInbox` (`after`). | A | **Fase 1 (feito):** `runOperations` (rotina agendada) reconcilia cada empresa Evolution conectada. |
| 7 | Envio e gravação independentes | **Confirmado.** `sendInboxMessage` enviava e só depois gravava; timeout virava "falhou" e a pessoa reenviava (duplicado). | A | **Fase 1 (feito):** grava antes ("enviando") com chave de idempotência (`client_ref`), depois envia; timeout vira "desconhecido" e o eco do WhatsApp confirma. |
| 8 | Corrida webhook × humano × IA | **Parcial.** Já existia `ai_generation_id` + checagem antes do envio, mas checagem e envio não eram atômicos (dois processos podiam enviar). | A | **Fase 1 (feito):** `claim_ai_reply` reserva a geração atomicamente antes do envio. |
| 9 | Prompt/regras da Marquinhos no código | **Confirmado.** `SYSTEM_PROMPT` no webhook cita "Marquinhos Calhas e Esquadrias" para qualquer empresa. | A (para a Bielenki) | Fase 6: identidade/regras por empresa e canal. |
| 10 | `@lid`, telefones, mensagens do celular | **Tratado** (PR #84): mapa `whatsapp_lid_map`, eco `fromMe` grava como "equipe" e pausa a IA. | B | Fase 2: mapa por canal. |
| 11 | Leitura interna × confirmação real | **Parcial.** `markInboxRead` envia leitura ao provedor; o estado "lida" do cliente vem dos recibos. Não há separação explícita dos 4 níveis. | M | Fase 4. |
| 12 | Falhas silenciosas | **Parcial.** Log técnico de webhook (`whatsapp_webhook_log`), `ai_decisions`, mas `recordOwnMessage` engole erros e não há fila de reprocessamento. | M | Fase 1 (diagnóstico ampliado) e Fase 8 (painel de saúde/filas). |

## Pontos verificados que já estavam corretos
- Webhook grava a mensagem do cliente **antes** da IA; falha da IA não perde a mensagem (`recordInbound` → depois IA).
- Histórico/sincronização (`messages.upsert` em lote, `contacts.*`) nunca entra no fluxo da IA (`sync_only`).
- Mensagens antigas (`timing.live = false`) não disparam IA (`history_only`).
- Mensagens da equipe (`fromMe`) não disparam IA e pausam a Lia.
- IA só para contato novo (`client_id` nulo) e para quando a equipe responde (`ai_paused`).
- Segredo do webhook Evolution e assinatura Meta conferidos antes de processar.
- Reenvio do provedor: trava em `whatsapp_webhook_events` + unicidade de `messages.external_id`.

## Fase 1 — entregue neste PR
1. Reconciliação automática (rotina agendada `crm_private.operations_tick` → `/api/internal/operations`).
2. Envio da equipe com idempotência e estado "desconhecido" (sem reenvio às cegas); eco do celular confirma.
3. Reserva atômica da resposta da Lia (`claim_ai_reply`).
4. Diagnóstico: última execução da rotina, última reconciliação, mensagens sem confirmação.

Nada muda em dados existentes; a IA não é ligada nem desligada por esta mudança.

## Próximas fases (ordem do prompt mestre)
- **Fase 2 — multinúmero:** `whatsapp_channels`, credenciais por canal, `channel_id` em conversas/mensagens/eventos com backfill de um canal padrão por empresa; roteamento de resposta pelo canal da conversa; webhook identifica o canal pela instância/Phone Number ID; consultas de auditoria (órfãos, duplicidades).
- **Fase 3 — segundo número:** tela "Canais de Atendimento", assistente com QR por canal, testes com dois canais.
- **Fase 4 — interface:** filtros por canal/status/etiqueta, status de entrega completos, leitura em 4 níveis, rascunhos.
- **Fase 5 — multiatendimento:** departamentos por empresa, filas, etiquetas, lembretes.
- **Fase 6 — IA:** identidade/regras por empresa e canal, modos por canal, aprendizado supervisionado versionado, assistente interno.
- **Fase 7 — integrações** (lead, orçamento, agenda, serviços, financeiro) a partir da conversa.
- **Fase 8 — saúde e relatórios:** painel por canal, fila/reprocessamento, métricas.
- **Fase 9 — testes e publicação.**

## Pendências que dependem de validação real
- Confirmar em produção que a rotina agendada está ativa (diagnóstico mostra "operações última execução").
- Envio com estado "desconhecido": validar com o celular quando ocorrer timeout real.
- Segundo número: depende de conectar um segundo WhatsApp (Evolution ou Meta).
