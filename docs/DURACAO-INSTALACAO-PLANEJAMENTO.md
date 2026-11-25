# Duração de instalação e ordens do dia — 24/11/2026

Decisões do dono: tempo somente no CRM, sem aparecer no orçamento impresso/PDF do cliente; jornada padrão de 8 horas por equipe, ajustável por dia.

## Orçamento

- Calhas e esquadrias têm **Duração da instalação (horas da equipe)** ao criar. Ex.: `1,5` corresponde a 1 h 30 min para a equipe executar o serviço no local, sem multiplicar pelo número de funcionários.
- Na ficha do orçamento, **Planejamento da instalação · interno** permite preencher ou ajustar depois, inclusive em orçamento aprovado, sem alterar itens, preço, pagamento ou aprovação. Administrador/gerente ou vendedor responsável com permissão de atualização.
- O valor é salvo em minutos inteiros, de 1 a 14.400, ou fica ausente. A entrada em horas usa passos de 15 minutos. Duplicar preserva a estimativa; um payload antigo que não envia o campo não apaga o tempo existente.
- Não altera o prazo comercial de instalação. A duração fica fora da folha do cliente e da rota de PDF.

## Equipes e ordens do dia

1. Agendar as instalações na agenda existente. A sugestão usa os horários já marcados; não cria ou remarca compromissos.
2. Em **Equipes e veículos**, escolher a data e criar as saídas com equipe, membros, motorista e veículo.
3. Em cada saída, **Ajustar jornada e reserva**: começa com 8 h, ajustável até 24 h, e reserva explícita em minutos para deslocamentos/imprevistos. A reserva começa em zero e precisa ser definida pela gerência; não há cálculo de rota.
4. **Sugestão de instalações por equipe** distribui instalações ainda não alocadas por tempo livre, respeitando a reserva e evitando horários sobrepostos. Visitas já incluídas também consomem a jornada. Se faltarem durações ou houver revisão pendente, a saída não recebe sugestões.
5. Revisar e selecionar. Somente **Incluir serviços nas saídas** grava as escolhas. O banco confere novamente empresa, cargo, saída, equipe, motorista, veículo, agenda, duração, conflitos e tempo disponível. O lote é atômico: se um serviço deixou de caber, nenhum item do lote é incluído.
6. **Imprimir OS do dia** abre uma folha A4 por equipe, com membros, veículo, horário, duração, endereço e checklist do carregamento. A mesma permissão da saída protege a impressão; não inclui valores comerciais.

Tempo sem preenchimento aparece como **A informar**, nunca como uma instalação de zero minutos. Serviços que ultrapassam o dia ou não cabem na capacidade ficam para revisão manual; esta versão não divide automaticamente uma instalação em vários dias. As etapas precisam ser planejadas pela gerência na agenda. Medições continuam disponíveis na inclusão manual, com duração ajustável na visita.

Alterar a duração de um orçamento marca as visitas futuras que herdaram seu tempo para revisão, mantendo o snapshot anterior até confirmar. **Salvar tempo da visita** registra um ajuste específico daquela visita, sem mudar a estimativa do orçamento. Alterações de agenda, equipe e carregamento preservam os controles e a auditoria existentes.

## Validação e implantação

- Migração aditiva e reaplicável `20261124183741_duracao_instalacao_planejamento_diario.sql`. Aplicar pelo workflow `aplicar-migrations.yml`, `ref` com SHA completo de 40 caracteres e `desde=20261124183741`, antes do merge.
- Verificação de produção regenerada com `DATABASE_URL=... node tests/db/generate-prod-check.mjs` em banco PostgreSQL isolado com todas as migrações.
- Testes de banco, ações, seleção explícita, distribuição, conflitos, autorização/empresas, reexecução e impressão sem informação interna no orçamento. E2E em celular cobre ajuste do orçamento, jornada, confirmação, atualização da lista e OS. Nenhum WhatsApp real, alteração financeira ou cliente real em testes.
