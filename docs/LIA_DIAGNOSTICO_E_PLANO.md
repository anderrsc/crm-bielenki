# Lia — diagnóstico técnico e plano de implementação (19/11/2026)

Base: leitura do código (`app/api/whatsapp/webhook/route.ts`, `lib/ai/*`, `lib/whatsapp/*`, `lib/operations.ts`) e das migrações.
**Nada foi alterado na Lia nem em produção por este documento.** Ele responde à instrução "primeiro o diagnóstico e o plano".

Legenda: ✅ funcionando · 🟡 parcial · 🔴 com problema · ⬜ não existe · ♻️ duplicado/obsoleto.

## 1. Como a Lia funciona hoje
Fluxo: Evolution → webhook → grava a mensagem → (só contato novo, fora de cliente cadastrado, com a Lia ativa e conversa não assumida) → **um único prompt** que devolve JSON (`analise`, `mensagem`, `dados_coletados`, `triagem_concluida`, `prioridade`, `score`) → decide **responder / sugerir / encaminhar** (modo assistente, semiautomática ou automática, horário e limite diário) → cria/atualiza lead ao concluir a triagem.
IA: Claude (Sonnet 5.5 ou Haiku 5.5) ou outros provedores, escolhida na Central de IA; regras da empresa em texto, regras aprendidas com aprovação, identidade do cliente, decisões registradas em `ai_decisions`.

## 2. Inventário por funcionalidade

| Área do prompt mestre | Estado | Observação |
|---|---|---|
| Receber mensagem sem duplicar (idempotência) | ✅ | `whatsapp_webhook_events` + `messages.external_id`; envio com `client_ref` |
| Resposta atômica (um só processo responde) | ✅ | `claim_ai_reply` |
| Modos assistente/semi/automática, horário, limite diário | ✅ | `lia-mode.ts` |
| Triagem comercial por perguntas, cria lead | ✅ | prompt único + `createOrUpdateLead` |
| Cliente cadastrado não é atendido pela Lia | ✅ | `client_id` nulo |
| Pausa quando a equipe assume | ✅ | `ai_paused` |
| Sugestão para a equipe aprovar | ✅ | `ai_suggestion` |
| Aprender com correções, com aprovação e versão | 🟡 | `ai_lia_rules` (proposta/ativa/arquivada, versão). Falta separar "estilo" (automático) de "crítico" (só admin/gerente) |
| Transferência para humano, histórico, aviso | 🟡 | `conversation_transfer` existe. Falta resumo automático, urgência e destino por tipo (garantia → gerente) |
| Isolamento entre empresas | ✅ | RLS testada em 100 tabelas |
| Múltiplos números | ✅ | `whatsapp_channels`; a Lia só atende o principal |
| Texto | ✅ | |
| **Áudio** | 🔴 | o prompt diz "você não consegue ouvir áudio". Não há transcrição |
| **Fotos / PDF / planta** | 🔴 | mídia é gravada, mas a IA só vê "[foto]"; não analisa imagem |
| Agrupar mensagens em sequência (janela) | ⬜ | cada mensagem dispara uma geração (a geração antiga é cancelada) |
| **Ferramentas tipadas (Claude tool use)** | ⬜ | a IA não consulta nada: não há busca de cliente, pedido, agenda, preço |
| **Pré-orçamento por tabela oficial** | ⬜ | prompt manda "preço só no orçamento". Existem tabelas (`gutter_prices`, `pricing_*`, `aluminum_price_matrix`) que ainda não alimentam a Lia |
| Aprovação humana de proposta/desconto/exceção | ⬜ | não há fila de aprovação da Lia (só sugestão de texto) |
| Regras financeiras (50%, parcelas, desconto 3%) como regra de código | ⬜ | hoje só texto no prompt, sem validação |
| Consulta de pedido com validação de identidade | ⬜ | |
| Registro de reclamação/garantia → gerente | ⬜ | |
| Acompanhamento 24 h, até 3 tentativas | ⬜ | só existe aviso **interno** de orçamento sem resposta em 3 dias |
| Lembrete de visita, pedido pronto, pós-venda (Google, pesquisa) | ⬜ | |
| Encerrar sessão após 2 h de inatividade | ⬜ | |
| Resumo diário gerencial | ⬜ | `lia_status` mostra números, sem resumo diário |
| Grupos (só quando mencionada) | ⬜ | instância criada com `groupsIgnore: true` |
| Observabilidade | 🟡 | `ai_decisions`, `whatsapp_health`, painel de rotina. Falta painel por número e fila de reprocesso |
| Base de conhecimento versionada | 🟡 | regras da empresa em texto único (`ai_agent_config`). Sem versões, sem separar produto/política/garantia |
| Identidade/regras no código | 🔴 | `SYSTEM_PROMPT` fixo no webhook, com nome da empresa e condições comerciais embutidas |

## 3. Conflitos entre o prompt atual e as regras novas (precisam de decisão)
1. **Prazo:** o prompt atual diz "até 20 dias corridos". As regras novas: calhas 24 h/48 h, rufos e pingadeiras 15 dias, esquadrias 40 dias.
2. **Pagamento:** o prompt atual diz "50% no Pix ou dinheiro e o resto em até 6x no cartão". As regras novas: entrada de cartão exige aprovação humana; saldo após a instalação quando houver instalação; mínimo R$ 200 por parcela; boleto só para empresa.
3. **Áudio:** hoje a Lia diz que não ouve. As regras novas pedem entender áudio. Claude não transcreve áudio; precisa de um serviço de transcrição (há chave Gemini já prevista na Central de IA).
4. **Mensagens automáticas ao cliente** (24 h, pós-venda, lembrete) saem pela Evolution, que não é a API oficial. Mensagem automática em massa aumenta o risco de bloqueio do número. Recomendo limites e só para quem já conversou.
5. **Grupos:** exigem ligar grupos na Evolution; risco de a Lia responder onde não deve.

## 4. Informações que faltam (não vou inventar)
- Lista de **produtos e linhas** liberados para pré-orçamento e a **tabela de preços aprovada** de cada um (hoje há várias tabelas; qual vale?).
- Quantidade mínima por tipo de peça.
- Texto do **catálogo** e das fotos de trabalhos realizados.
- Link da **avaliação no Google** (o de Maps é de localização).
- Quem é o **gerente** para reclamação/garantia e quem aprova exceção (cargos Administrador/Gerente já existem).
- Horário em que a Lia pode **iniciar** mensagens automáticas.

## 5. Arquitetura proposta (reaproveitando o que existe)
- **Orquestrador:** trocar o prompt único por chamada Claude com **ferramentas tipadas**; o JSON de triagem vira uma das ferramentas (`registrar_triagem`). Mantém `claim_ai_reply`, modos, horário e limite.
- **Ferramentas** (cada uma valida empresa, cargo/identidade, dados obrigatórios e grava auditoria em `lia_tool_executions`): buscar/cadastrar cliente, criar lead, consultar catálogo e preço, preparar pré-orçamento (rascunho que **exige aprovação**), consultar agenda, criar visita **pendente**, consultar pedido (só após validar identidade), registrar reclamação/garantia, criar tarefa, transferir atendimento, consultar conhecimento aprovado, resumir conversa. Sem SQL livre.
- **Motor de regras (código, não prompt):** entrada 50%, parcelas (mín. R$ 200, até 6), desconto ≤ 3%, formas de pagamento, prazos. A Lia **propõe**; a regra valida; fora do limite vira `lia_approval_requests` para Administrador/Gerente.
- **Base de conhecimento versionada** (`lia_knowledge` + versões): categorias produto, política, garantia, região, prazo. Alteração crítica só por Administrador/Gerente, com histórico e reversão. Mensagem de cliente nunca altera.
- **Mídia:** foto/planta/PDF por visão do Claude; áudio por transcrição (Gemini). Falha de processamento → a Lia diz que não conseguiu, nunca finge.
- **Janela de agrupamento** configurável (padrão 8 s) antes de gerar a resposta.
- **Automações** em `operations_tick`: acompanhamento (24 h, máx. 3, para na resposta/recusa), lembrete de visita, pedido pronto, pós-venda, encerramento em 2 h, resumo diário. Cada execução com chave única (`lia_automation_executions`) para não duplicar.
- **Reaproveitar:** `ai_agent_config`, `ai_decisions`, `ai_lia_rules`, `lia_mode`, `conversation_transfer`, `notify_team`, `whatsapp_channels`, `operations_tick`, tabelas de preço existentes. Tabelas novas só onde não há equivalente.

## 6. Fases e ordem recomendada
| Fase | Entrega | Depende de |
|---|---|---|
| 1 | Este diagnóstico + regras oficiais cadastradas e versionadas (conhecimento) + motor de regras financeiras com testes | respostas da seção 3 e 4 |
| 2 | Ferramentas tipadas: cliente, lead, conhecimento, transferência com resumo, reclamação/garantia | fase 1 |
| 3 | Aprovações humanas (fila + tela) e pré-orçamento por tabela oficial | tabela de preços definida |
| 4 | Foto, PDF e áudio | chave de transcrição |
| 5 | Agrupamento de mensagens e grupos (se aprovado) | |
| 6 | Automações (24 h, visita, pronto, pós-venda, 2 h, resumo diário) | decisão sobre risco da Evolution |
| 7 | Os 40 cenários de teste com evidências e homologação | tudo acima |
| 8 | Deploy com plano de rollback, **só com sua autorização** | |

Custo: com Sonnet para toda a conversa e Haiku para resumos/automações, a estimativa anterior (R$ 100–300/mês para o volume atual) continua válida; mídia e transcrição somam pouco, mas vão ser medidos nos testes.

## 7. Status de prontidão
A Lia atual está **pronta para triagem por texto** (já em uso). **Não está pronta** para orçamento, áudio, imagens, automações nem aprovações. Nenhum dos 40 cenários do prompt foi executado ainda.
