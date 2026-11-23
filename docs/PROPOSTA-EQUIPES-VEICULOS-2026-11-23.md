# Equipes, veículos e carregamento

Situação: modelo aprovado pelo dono em 23/11/2026: “Confere, pode implementar e deixe pronto”. Implementado em `/equipes`, com testes de banco, ações, tela e fluxo no celular.

## O que já existe

No levantamento inicial não havia tabelas de equipes, membros ou veículos. Instalações guardava apenas um `responsible_id`; esse vínculo foi preservado.

- `profiles`: funcionário/usuário, empresa, nome e situação. Será reutilizado; não criar outro cadastro de pessoas.
- `installations`: pedido, responsável, agendamento, endereço, situação e conclusão.
- `measurements`: cliente/pedido, responsável, agendamento, endereço e conclusão.
- `order_measure_checks`: conferência de medidas, responsável e `agenda_event_id`.
- `operational_events`: agenda com início/fim, responsável, instalação e pedido. Reutilizar a agenda; não criar um calendário paralelo.
- `materials`, `order_items`, `stock_movements`: materiais e itens do pedido já cadastrados. O carregamento será conferência física, sem movimentação automática do estoque.

## Modelo proposto

| Entidade | Conteúdo e vínculo |
|---|---|
| Equipes | Empresa, nome, líder (`profiles`), ativa/inativa. |
| Membros | Equipe, funcionário (`profiles`), função e período de participação. Histórico preservado. |
| Veículos | Empresa, identificação/placa, tipo, capacidade e comprimento útil opcionais; disponível, manutenção ou inativo. |
| Alocação do dia | Data de Brasília, equipe, veículo, motorista e observações. Guarda os membros daquele dia, para trocas não alterarem o passado. |
| Serviços do dia | Alocação + registro existente de agenda, instalação ou medição + sequência de visitas. A view `v_operational_agenda` já reúne as fontes, dispensando outro vínculo ou calendário. Evento vinculado a instalação usa a instalação como chave para impedir duplicidade. |
| Carregamento | Alocação, pedido, itens/quantidades/unidade, materiais ou ferramentas; conferência de separado, carregado e devolvido, com responsável e horário. |

## Como funcionará

1. Gerência monta a equipe e cadastra os veículos.
2. No planejamento do dia, escolhe equipe, motorista, veículo e instalações/medições já agendadas.
3. O sistema impede alocar a mesma pessoa, equipe ou veículo em duas saídas do mesmo dia. Exceções por turno ficam para uma evolução aprovada separadamente.
4. A equipe abre a lista no celular: sequência, endereço e materiais por pedido.
5. Quem separa marca os itens; quem carrega confere. Sobras e ferramentas devolvidas ficam registradas.
6. Reagendar ou cancelar mantém o histórico e pede a revisão do carregamento; não apaga registros.

## Permissões e limites iniciais

- Gerência/administração: equipes, membros, frota e alocações.
- Produção/estoque: separar e conferir carregamento autorizado.
- Instalador/medidor: consultar sua alocação e atualizar suas conferências.
- RLS por empresa, validação dos vínculos e auditoria nas alterações. Veículo ou funcionário inativo não recebe nova alocação.
- Sem rastreamento, envio automático de WhatsApp, baixa financeira ou baixa automática de estoque.

## Operação e verificação

- Acesso pelo menu Operação → Equipes e veículos, ou pelo link na Agenda. O módulo começa sem cadastros e sem saídas; nenhuma reserva ou conferência é criada automaticamente.
- Gerência pode ajustar os membros de uma saída aberta, preservando snapshots anteriores. Uma pessoa removida conserva a leitura histórica, mas perde a conferência daquela saída.
- Cancelar libera as reservas e mantém visitas, itens e conferências. Devolução de item já carregado continua possível após encerramento/cancelamento. Ferramenta com devolução parcial exige motivo.
- Cada conferência guarda autor, horário, etapa e quantidade devolvida. Reabertura pela gerência exige motivo. Cliques repetidos na mesma etapa são idempotentes; página desatualizada não sobrescreve outra etapa.
- Migração aditiva `20261123204303_equipes_veiculos_carregamento.sql`: oito tabelas, índices de reserva/FKs, RLS por empresa e equipe do dia, gravação somente via RPC autenticada e auditoria. Planejamento usa trava por empresa para serializar disputas.
- Testes: `work-planning-db`, `work-planning-actions`, `work-planning-view` e E2E `work-planning` (375 px). Sem WhatsApp real, sem movimentar estoque/financeiro e sem apagar dados.
- Os formulários usam envio autenticado pela rota `/api/equipes`, com origem validada e retorno HTTP 303 para a lista completa. O E2E cobre envios consecutivos, confirmação de cancelamento e ausência de corte horizontal. Membro removido conserva a leitura, sem botões de conferência.
