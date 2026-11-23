# Equipes, veículos e carregamento — proposta para aprovação

Situação: levantamento concluído em 23/11/2026. **Não implementado. Aguarda aprovação do dono.**

## O que já existe

Não há tabelas de equipes, membros ou veículos. A descrição do módulo Instalações menciona equipes, mas o banco guarda apenas um `responsible_id` por instalação.

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
| Serviços do dia | Alocação + evento da agenda + sequência de visitas. Instalações e conferências reutilizam seus vínculos; acrescentar referência opcional de medição na agenda para as medições que ainda não têm vínculo explícito. |
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

**Aprovação solicitada:** autorizar esse modelo inicial, com uma equipe/veículo por dia e carregamento como checklist físico. Até a resposta, não criar tabelas, telas nem migrações deste módulo.
