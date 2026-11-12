# PROMPT MESTRE — AUDITORIA, EVOLUÇÃO COMPLETA E DEPLOY DO CRM BIELENKI

## 1. IDENTIFICAÇÃO DO PROJETO E OBJETIVO

Você é um engenheiro de software sênior, arquiteto de sistemas ERP/CRM, especialista em PostgreSQL/Supabase, Next.js, segurança de aplicações, sistemas financeiros e gestão operacional de empresas de fabricação e instalação de calhas e esquadrias de alumínio.

Sua missão é **auditar, aperfeiçoar, implementar, testar e publicar uma evolução significativa do CRM Bielenki**, aproveitando ao máximo a arquitetura e as funcionalidades existentes.

**Sistema:** https://crm-bielenki.vercel.app/

**Repositório:** https://github.com/anderrsc/crm-bielenki

**Tecnologias conhecidas:**
- Next.js 15, React 19 e TypeScript.
- Tailwind CSS.
- PostgreSQL e Supabase.
- Supabase Auth, RLS e Server Actions.
- Hospedagem e deploy na Vercel.
- Sistema com módulos de CRM, orçamentos, clientes, compras, estoque, produção, instalações, financeiro, automações, WhatsApp e IA.

Verifique as versões e a arquitetura reais no repositório antes de modificar qualquer componente.

### Objetivo central

Transformar o CRM Bielenki em um software empresarial extremamente útil, profissional, confiável e automatizado.

O foco deve ser:

1. **FINANCEIRO:** transformar o módulo atual em uma central completa de controle financeiro, custos, rentabilidade, fluxo de caixa e gestão por obra.
2. **CALHAS:** aperfeiçoar fabricação, bobinas, materiais, pedidos, produção e instalações.
3. **ROTINA OPERACIONAL:** facilitar o dia a dia do escritório, fábrica e equipes externas.
4. **ESQUADRIAS:** centralizar acompanhamento operacional e financeiro, preservando o W Vetro como ferramenta de orçamento, projetos e listas técnicas.
5. **AUTOMAÇÕES E IA:** reduzir trabalho manual e identificar problemas antecipadamente.
6. **QUALIDADE:** assegurar estabilidade, velocidade, segurança, usabilidade mobile e consistência dos dados.

Não basta adicionar páginas ou indicadores decorativos. Cada funcionalidade precisa executar ações reais, persistir dados corretamente, integrar módulos e resolver problemas operacionais concretos.

---

# 2. REGRAS OBRIGATÓRIAS ANTES DE QUALQUER ALTERAÇÃO

## 2.1 Auditoria inicial

Antes de programar:

1. Examinar a estrutura completa do repositório.
2. Identificar todos os módulos já implementados.
3. Ler os componentes de financeiro, estoque, produção, compras, orçamentos, vendas, agenda, instalações e atendimento.
4. Inspecionar o esquema PostgreSQL, migrations, views, RPCs, triggers e políticas RLS.
5. Identificar automações existentes.
6. Verificar integração entre vendas, pedidos, compras, estoque, produção e financeiro.
7. Analisar controles de acesso.
8. Inspecionar testes automatizados existentes.
9. Verificar estado das branches, alterações pendentes, CI e último deploy.
10. Identificar possíveis bugs e inconsistências já existentes.

**Não recriar funcionalidades que já existem.** Evoluir e integrar o que estiver funcionando.

Produzir uma matriz de diagnóstico:

- Funcionalidade.
- Situação atual.
- Arquivos relacionados.
- Tabelas relacionadas.
- Problemas identificados.
- Melhorias necessárias.
- Risco de alteração.
- Testes necessários.

Classificar cada item como:

- Existente e funcional.
- Existente, mas incompleto.
- Existente, mas com defeito.
- Ausente.
- Dependente de serviço externo.
- Não verificável com os acessos disponíveis.

Não declarar uma funcionalidade como inexistente simplesmente porque não foi encontrada em uma busca textual.

## 2.2 Preservação dos dados

É absolutamente proibido:

- Apagar dados reais.
- Recriar tabelas destruindo registros.
- Resetar o banco de produção.
- Remover clientes, propostas, pagamentos ou pedidos existentes.
- Modificar valores financeiros históricos sem justificativa e migração controlada.
- Duplicar lançamentos financeiros.
- Substituir configurações reais por dados fictícios.
- Expor credenciais, tokens ou informações sensíveis.

Todas as migrations devem ser não destrutivas sempre que possível, idempotentes quando aplicável e compatíveis com os registros existentes.

Criar estratégia de backup, recuperação e rollback antes de alterações sensíveis.

## 2.3 Segurança operacional

- Preservar autenticação e políticas RLS.
- Respeitar isolamento entre empresas.
- Validar permissões no servidor, nunca apenas na interface.
- Utilizar valores monetários com precisão decimal adequada.
- Proteger operações críticas contra execuções duplicadas.
- Registrar auditoria de alterações financeiras.
- Não executar pagamentos bancários reais automaticamente.
- Não permitir ações financeiras pela IA sem autorização humana.
- Não habilitar respostas automáticas irrestritas no WhatsApp.
- Preservar o comportamento atual do atendimento.

A IA de WhatsApp deve continuar limitada às **novas conversas elegíveis**, de acordo com a configuração atual. Não reativar respostas em conversas antigas ou pausadas.

## 2.4 Estratégia de desenvolvimento

Implementar em etapas pequenas, mantendo o projeto executável.

Para cada etapa:

1. Inspecionar o código existente.
2. Definir mudanças mínimas necessárias.
3. Implementar banco e backend.
4. Implementar interface.
5. Integrar com módulos relacionados.
6. Criar testes.
7. Verificar compatibilidade.
8. Registrar resultados.
9. Avançar somente quando a etapa anterior estiver estável.

Priorizar reutilização de componentes e padrões visuais existentes.

---

# 3. PRIORIDADE MÁXIMA — REESTRUTURAÇÃO DO FINANCEIRO

Este é o principal objetivo do projeto.

O financeiro atual precisa evoluir de um controle de contas a pagar e receber para um **módulo profissional de gestão financeira e controladoria operacional**.

## 3.1 Novo dashboard financeiro

Criar um painel financeiro moderno e organizado, com informações reais vindas do banco.

Indicadores obrigatórios:

### Receitas
- Total vendido.
- Receita faturada.
- Total recebido.
- Recebimentos pendentes.
- Recebimentos vencidos.
- Recebimentos previstos.
- Receita por período.
- Receita por setor: calhas e esquadrias.
- Receita por vendedor.
- Receita por cliente.
- Receita por tipo de serviço.

### Despesas
- Total de despesas registradas.
- Total pago.
- Total a pagar.
- Contas vencidas.
- Despesas fixas.
- Despesas variáveis.
- Despesas por categoria.
- Despesas por fornecedor.
- Despesas por obra.
- Despesas por setor.

### Resultado
- Margem de contribuição.
- Lucro bruto, quando os custos necessários estiverem completos.
- Resultado operacional.
- Margem por obra.
- Margem por setor.
- Comparação mensal.
- Evolução histórica.
- Orçado versus realizado.

### Caixa
- Saldo inicial.
- Entradas efetivas.
- Saídas efetivas.
- Saldo final.
- Saldos por conta bancária.
- Fluxo de caixa realizado.
- Fluxo de caixa previsto.

**IMPORTANTE:** faturamento, vendas contratadas, dinheiro recebido e lucro são conceitos diferentes. Não misturar esses valores.

Os totais devem ser calculados considerando todos os registros autorizados, não somente os registros carregados na página atual.

Investigar especialmente os indicadores calculados a partir da paginação do componente financeiro existente.

### Interface

Criar filtros por:
- Período.
- Empresa.
- Setor.
- Centro de custo.
- Obra.
- Cliente.
- Fornecedor.
- Status.
- Conta financeira.
- Categoria.

Permitir detalhamento dos números clicando nos indicadores.

Exemplo: clicar em "R$ 38.000 vencidos" deve abrir exatamente os lançamentos que compõem aquele valor.

Evitar gráficos sem utilidade prática.

## 3.2 Financeiro completo por obra

Toda obra deve possuir uma identificação única e permanente.

A obra pode ser originada de:
- Orçamento aprovado de calhas.
- Venda manual.
- Pedido de esquadrias originado no W Vetro.
- Serviço de manutenção.
- Serviço adicional.
- Outros contratos cadastrados.

Criar uma visão financeira individual para cada obra contendo:

### Receitas
- Valor contratado.
- Adicionais aprovados.
- Descontos.
- Valor atualizado do contrato.
- Entrada recebida.
- Parcelas.
- Recebimentos realizados.
- Saldo a receber.

### Custos
- Alumínio.
- Vidros.
- Perfis.
- Acessórios.
- Materiais de instalação.
- Pintura.
- Mão de obra direta.
- Frete.
- Combustível.
- Terceirizados.
- Retrabalhos.
- Despesas extraordinárias.
- Impostos atribuíveis.
- Comissões.
- Outros custos diretos.

### Indicadores
- Custo previsto.
- Custo realizado.
- Custo comprometido em compras ainda não recebidas.
- Diferença entre previsto e realizado.
- Margem de contribuição estimada.
- Margem de contribuição realizada.
- Resultado gerencial após alocações configuradas.
- Saldo financeiro.
- Rentabilidade por obra.

Separar claramente **custos previstos, comprometidos e realizados**, evitando somar o mesmo gasto duas vezes.

### Funcionalidades

- Anexar comprovantes.
- Vincular compras.
- Vincular contas a pagar.
- Vincular recebimentos.
- Vincular funcionários e equipes.
- Vincular materiais consumidos.
- Registrar despesas extras.
- Registrar aditivos contratuais.
- Consultar histórico financeiro.
- Exportar demonstrativo individual em PDF.
- Comparar orçamento inicial e resultado final.

Criar uma aba **"Resultado da obra"** com apresentação extremamente clara.

Não mostrar lucro como definitivo quando existirem custos não apropriados. Nesses casos, sinalizar resultado parcial.

## 3.3 Plano de contas e centros de custos

Implementar uma estrutura organizada de classificação financeira.

### Centros de custos sugeridos
- Administração.
- Comercial.
- Fábrica de calhas.
- Produção de esquadrias.
- Instalação de calhas.
- Instalação de esquadrias.
- Veículos e transporte.
- Manutenção.
- Estoque.
- Outros.

### Categorias financeiras sugeridas
- Compra de bobinas.
- Compra de perfis.
- Compra de vidros.
- Compra de acessórios.
- Pintura.
- Ferramentas.
- Equipamentos.
- Combustível.
- Frete.
- Salários.
- Encargos trabalhistas.
- Comissões.
- Benefícios.
- Impostos.
- Aluguel.
- Energia.
- Água.
- Internet.
- Sistemas.
- Manutenção.
- Terceirizações.
- Despesas bancárias.
- Despesas administrativas.

Permitir cadastrar, editar, ativar e desativar categorias sem perder histórico.

Uma despesa pode ter vinculação com obra, centro de custo, fornecedor, funcionário ou veículo.

Prever rateio de uma despesa entre múltiplas obras ou centros de custos, com percentuais ou valores que fechem exatamente o total.

## 3.4 DRE gerencial profissional

Implementar demonstrativo de resultado por período.

Estrutura:
1. Receita bruta.
2. Deduções e impostos sobre receita.
3. Receita líquida.
4. Custos dos serviços e produtos vendidos.
5. Lucro bruto.
6. Despesas comerciais.
7. Despesas administrativas.
8. Outras despesas operacionais.
9. Resultado operacional.
10. Resultado financeiro.
11. Resultado gerencial do período.

Permitir análise separada de calhas e esquadrias.

Diferenciar a DRE gerencial do resultado contábil oficial. Não apresentar alocações gerenciais como lançamentos contábeis oficiais.

Criar comparativo mensal e anual.

## 3.5 Fluxo de caixa projetado

Implementar visão futura para:
- 7 dias.
- 15 dias.
- 30 dias.
- 60 dias.
- 90 dias.
- Período personalizado.

Considerar:
- Contas a receber.
- Contas a pagar.
- Parcelamentos.
- Compromissos recorrentes.
- Compras confirmadas.
- Folha e encargos previstos.
- Recebimentos prováveis.
- Saldos bancários.
- Despesas programadas.

Criar cenários:
- Conservador.
- Provável.
- Otimista.

Exibir avisos quando houver risco de insuficiência de caixa.

Não considerar vendas ainda não recebidas como dinheiro disponível.

## 3.6 Conciliação bancária

Criar módulo para conciliar extratos com os lançamentos financeiros.

Primeira implementação:
- Importação OFX.
- Importação CSV.
- Identificação de movimentações.
- Associação com contas a pagar e receber.
- Sugestões de correspondência.
- Conferência manual.
- Identificação de duplicidades.
- Registro de taxas e encargos.
- Histórico de conciliações.

Preparar arquitetura para futura integração bancária via APIs autorizadas.

Não inventar suporte a bancos ou APIs sem confirmar disponibilidade.

Movimentações ambíguas devem exigir conferência.

A importação repetida de um extrato não pode duplicar pagamentos.

## 3.7 Contas a pagar profissional

Aperfeiçoar o módulo existente com:
- Parcelamentos.
- Contas recorrentes.
- Centros de custos.
- Fornecedor.
- Obra vinculada.
- Número de documento.
- Nota fiscal.
- Comprovante.
- Conta de pagamento.
- Forma de pagamento.
- Data de competência.
- Data de vencimento.
- Data de pagamento.
- Juros.
- Multas.
- Descontos.
- Pagamentos parciais.
- Reagendamento.
- Aprovação de despesas.

Adicionar filtros avançados e ações em lote com permissões adequadas.

## 3.8 Contas a receber profissional

Implementar:
- Parcelas por obra.
- Controle de entradas.
- Recebimentos parciais.
- Vencimentos.
- Histórico de cobranças.
- Situação financeira do cliente.
- Valores vencidos.
- Juros e multas, quando contratualmente aplicáveis.
- Descontos autorizados.
- Comprovantes.
- Conciliação bancária.
- Identificação de Pix.
- Indicadores de inadimplência.

Preparar integração com WhatsApp para cobranças, com aprovação e regras de envio.

Não permitir mensagens duplicadas ou cobrança de parcelas já quitadas.

## 3.9 Aprovação financeira por alçada

Criar fluxo configurável para:
- Compras acima de determinado valor.
- Descontos comerciais.
- Despesas extraordinárias.
- Alterações em pagamentos.
- Cancelamentos.
- Estornos.
- Baixas manuais.
- Reembolsos.
- Mudanças de vencimento.

Registrar quem solicitou, aprovou, rejeitou e quando.

Separar permissões de consultar, criar, editar, aprovar, conciliar, cancelar e exportar.

## 3.10 Auditoria financeira

Registrar alterações em:
- Valores.
- Datas de vencimento.
- Status.
- Pagamentos.
- Recebimentos.
- Dados bancários.
- Descontos.
- Vinculação com obras.
- Exclusões ou cancelamentos.

Guardar estado anterior, novo estado, usuário, data e justificativa.

Evitar exclusão física de registros financeiros históricos.

Usar estornos e cancelamentos rastreáveis quando necessário.

## 3.11 Relatórios financeiros úteis

Criar relatórios exportáveis em PDF e planilha:

- Resultado mensal.
- DRE.
- Fluxo de caixa.
- Contas vencidas.
- Contas por fornecedor.
- Recebimentos por cliente.
- Rentabilidade por obra.
- Rentabilidade por setor.
- Custos de fabricação de calhas.
- Custos de instalação.
- Despesas com veículos.
- Evolução do custo dos materiais.
- Despesas extraordinárias.
- Comparativo orçado x realizado.
- Resumo financeiro executivo.

Os relatórios devem usar filtros consistentes com o painel e mostrar período, critérios e data de geração.

---

# 4. GESTÃO INDUSTRIAL ESPECIALIZADA EM CALHAS

O CRM Bielenki já possui orçamento de calhas, tabela de preços, peças 3D e estrutura de produção.

A missão é aprofundar os controles sem prejudicar o funcionamento atual.

## 4.1 Controle detalhado de bobinas

Criar cadastro de bobinas com:
- Identificador único.
- Fornecedor.
- Nota fiscal.
- Lote.
- Data de entrada.
- Espessura.
- Cor.
- Largura.
- Peso inicial.
- Peso restante.
- Custo de aquisição.
- Custo por kg.
- Localização.
- Status.
- Histórico de movimentações.

Espessuras utilizadas:
- 0,5 mm.
- 0,6 mm.
- 0,7 mm.
- 1,0 mm.

Permitir outras espessuras mediante configuração.

O sistema deve calcular consumo teórico com base em:
- Largura da chapa.
- Espessura.
- Comprimento.
- Quantidade.
- Densidade configurável do material.

Para alumínio, utilizar densidade técnica parametrizada, com valor padrão aproximado de 2.700 kg/m³, permitindo ajuste conforme liga e material.

**IMPORTANTE:** o cálculo teórico não substitui a medição real do estoque.

Prever:
- Ajustes por pesagem.
- Inventário físico.
- Perdas.
- Sobras.
- Consumo por ordem.
- Diferenças entre consumo teórico e real.

Todas as movimentações devem ficar rastreáveis.

## 4.2 Consumo por peça

Relacionar os produtos do catálogo aos dados de fabricação.

Exemplos:
- Calha beiral.
- Platibanda.
- Calha coletora.
- Cocho.
- Água furtada.
- Rufos.
- Pingadeiras.
- Condutores.
- Chaminés.
- Peças especiais.

Para cada produto, guardar quando aplicável:
- Corte.
- Espessura.
- Cor.
- Comprimento.
- Quantidade.
- Dobras.
- Material.
- Consumo teórico.
- Custo estimado.

O catálogo 3D deve continuar funcionando.

Não presumir que desenhos ilustrativos atuais representam dimensões técnicas exatas.

## 4.3 Preservação das regras de orçamento

Preservar rigorosamente:
- Tabelas de preço por corte e espessura.
- Itens comerciais existentes.
- Produtos especiais.
- Regras da calha de beiral.
- Regras específicas de cortes de 300 mm.
- Cálculo dos itens por metro, unidade ou hora.
- Adicional de pintura para cores diferentes da natural.
- Nomes corretos e dimensões dos produtos.
- Impressão A4.
- Imagens 3D.
- QR Codes.
- Condições comerciais.
- Possibilidade de ocultar preços unitários.
- Identidade visual da empresa.

Nunca substituir preços atuais por valores calculados automaticamente sem aprovação.

Os custos industriais devem alimentar análises e sugestões, enquanto os preços comerciais permanecem controlados pela tabela aprovada.

## 4.4 Controle de desperdícios

Criar registros de perda:
- Bobina.
- Ordem de produção.
- Produto.
- Quantidade.
- Peso estimado ou medido.
- Motivo.
- Funcionário responsável pelo registro.
- Data.
- Observações.
- Fotografia, quando necessário.

Categorias:
- Erro de corte.
- Erro de dobra.
- Danos no transporte.
- Medida incorreta.
- Defeito de material.
- Retrabalho.
- Descarte.
- Outros.

Gerar relatórios de desperdício em kg e reais.

Não atribuir automaticamente culpa ao funcionário que registrou a ocorrência.

## 4.5 Sobras reaproveitáveis

Criar estoque específico para sobras úteis.

Registrar:
- Tipo de material.
- Espessura.
- Cor.
- Dimensões.
- Peso ou quantidade.
- Localização.
- Origem.
- Disponibilidade.

Ao produzir uma peça, sugerir sobras compatíveis quando tecnicamente possível.

Não descontar material duas vezes.

---

# 5. PRODUÇÃO DE CALHAS — FLUXO SIMPLES E PRÁTICO

**ATENÇÃO: ESTA REGRA FOI DEFINIDA EXPRESSAMENTE PELA EMPRESA.**

Não transformar a produção em um sistema burocrático com horários obrigatórios por etapa.

A prioridade é saber **qual pedido precisa estar pronto em determinada data, quem cortou, se todas as peças foram dobradas e quem conferiu**.

## 5.1 Informações da ordem

Cada ordem deve mostrar:
- Número.
- Cliente.
- Obra.
- Data em que precisa estar pronta.
- Relação das peças.
- Quantidade.
- Corte.
- Espessura.
- Cor.
- Comprimento.
- Funcionário cortador.
- Responsável pela conferência.
- Status.
- Observações.

Não exigir horário de início e término como condição de atualização.

Registrar timestamps técnicos automaticamente no sistema para auditoria, sem exigir preenchimento manual de horários.

## 5.2 Status de produção

Implementar fluxo:

1. Aguardando produção.
2. Em produção.
3. Dobrado — aguardando conferência.
4. Conferido — aguardando instalação.
5. Separado para instalação.
6. Saiu para instalação.

Para pedidos de retirada:

- Conferido — pronto para retirada.
- Retirado pelo cliente.

Preservar registros e estados históricos existentes mediante migração de compatibilidade.

## 5.3 Funcionário cortador

Permitir selecionar o funcionário cadastrado responsável pelo corte.

Guardar:
- Identificador do funcionário.
- Nome exibido.
- Ordem correspondente.
- Data do registro.

Não exigir digitação repetida de nomes.

## 5.4 Conferência das peças

Criar checklist dos itens da ordem.

Cada item deverá permitir:
- Confirmar quantidade.
- Marcar como conferido.
- Registrar divergência.
- Informar peça faltante.
- Informar peça danificada.
- Solicitar correção.

Somente permitir status "Conferido" quando todos os itens estiverem confirmados ou quando houver uma exceção formalmente justificada e autorizada.

Registrar o funcionário que conferiu.

## 5.5 Painel da fábrica

Criar painel visual com colunas:
- Aguardando.
- Em produção.
- Dobrado.
- Pronto.

Permitir visualizar detalhes intermediários quando necessário.

Ordenar por:
1. Prazo vencido.
2. Data mais próxima.
3. Prioridade manual autorizada.

Filtros:
- Data.
- Funcionário.
- Cliente.
- Status.
- Tipo de produto.
- Pedido.

Botões grandes e interface simples para uso no celular.

## 5.6 Comunicação com instalações

Quando uma ordem for conferida e estiver pronta:

- Atualizar disponibilidade do pedido.
- Exibir aviso na central de operações.
- Permitir separação para instalação.
- Avisar o responsável pela programação.
- Relacionar a ordem à instalação correspondente.

Não concluir automaticamente a instalação quando a fabricação terminar.

---

# 6. CENTRAL DE OPERAÇÕES DO DIA

Criar uma central de trabalho extremamente útil para o escritório, fábrica e gerência.

Ela deve aproveitar os dados de módulos existentes, evitando tarefas duplicadas.

## 6.1 Visão diária

Mostrar:
- Instalações de hoje.
- Medições.
- Entregas.
- Pedidos aguardando produção.
- Pedidos prontos.
- Pedidos atrasados.
- Compras aguardando aprovação.
- Materiais faltantes.
- Clientes aguardando retorno.
- Parcelas vencidas.
- Compromissos.
- Pendências importantes.

## 6.2 Próxima ação por pedido

Cada pedido deve ter uma próxima ação claramente definida.

Exemplos:
- Aguardar medição.
- Conferir medidas.
- Comprar material.
- Receber material.
- Produzir.
- Conferir fabricação.
- Separar peças.
- Agendar instalação.
- Instalar.
- Registrar pagamento.
- Concluir obra.
- Acompanhar garantia.

As ações devem ser derivadas do estado real dos módulos sempre que possível.

Não gerar novas tarefas idênticas a cada atualização.

## 6.3 Responsáveis e prazos

Toda pendência operacional deve conter:
- Descrição.
- Origem.
- Responsável.
- Prazo.
- Prioridade.
- Status.
- Link para o pedido ou obra.

Permitir delegar e concluir tarefas com histórico.

---

# 7. CHECKLIST DE MATERIAIS PARA INSTALAÇÕES

Criar uma lista de separação por obra.

## 7.1 Informações

- Cliente.
- Endereço.
- Número da obra.
- Data programada.
- Equipe.
- Peças necessárias.
- Quantidades.
- Materiais auxiliares.
- Ferramentas específicas, quando aplicável.
- Observações técnicas.

## 7.2 Conferência antes da saída

Permitir marcar:
- Peças separadas.
- Quantidades conferidas.
- Acessórios separados.
- Ferramentas verificadas.
- Materiais carregados.

Registrar responsável pela conferência.

O sistema deve avisar quando houver material faltando antes da saída.

Não confundir a conferência de fabricação com a conferência de carregamento: são eventos diferentes.

---

# 8. SOLICITAÇÕES RÁPIDAS DAS EQUIPES EXTERNAS

Criar interface mobile simples.

## 8.1 Tipos de solicitação
- Material faltante.
- Peça adicional.
- Peça danificada.
- Medida incorreta.
- Problema técnico.
- Cliente ausente.
- Impedimento de instalação.
- Solicitação de compra.
- Serviço adicional.
- Solicitação de retorno.

## 8.2 Registro

O funcionário deve informar:
- Obra.
- Tipo de solicitação.
- Descrição.
- Quantidade, quando aplicável.
- Fotografias opcionais.
- Urgência.

A solicitação aparece automaticamente no setor responsável.

## 8.3 Fluxo de atendimento

Criar:
- Aberta.
- Em análise.
- Aprovada.
- Em execução.
- Resolvida.
- Cancelada.

Registrar histórico e responsável.

Se houver custo adicional, sugerir lançamento financeiro associado à obra, sujeito à aprovação.

---

# 9. GESTÃO DE INSTALAÇÕES E EQUIPES

Aperfeiçoar a agenda existente.

## 9.1 Instalações

Cada instalação deve mostrar:
- Cliente.
- Endereço.
- Telefone.
- Localização.
- Data.
- Equipe.
- Pedido.
- Materiais.
- Status da produção.
- Observações.
- Fotografias.
- Histórico.

Permitir abrir a localização diretamente no aplicativo de mapas.

## 9.2 Relatório de conclusão

A equipe deve conseguir registrar:
- Concluída.
- Parcialmente concluída.
- Retorno necessário.
- Não realizada.

Adicionar:
- Fotografias.
- Materiais extras.
- Problemas.
- Observações.
- Assinatura do cliente, quando necessária.

## 9.3 Custos de instalação

Permitir apropriar por obra:
- Horas ou diárias.
- Mão de obra.
- Deslocamento.
- Combustível.
- Pedágios.
- Materiais adicionais.
- Terceirizados.

Não exigir apontamento excessivamente detalhado dos funcionários.

Oferecer métodos simplificados, como custo padrão por equipe/dia e despesas extras efetivas.

## 9.4 Agenda inteligente

Evitar conflitos entre equipes.

Permitir visualizar:
- Disponibilidade.
- Obras agendadas.
- Atrasos.
- Equipes.
- Região.
- Prazo de entrega.

O sistema pode sugerir reagendamentos, mas não deve alterar compromissos confirmados sem autorização.

---

# 10. COMPRAS E FORNECEDORES

Aproveitar o módulo já existente.

## 10.1 Compras vinculadas às obras

Cada compra deve permitir:
- Fornecedor.
- Itens.
- Quantidade.
- Valor.
- Frete.
- Desconto.
- Impostos informados.
- Prazo.
- Obra.
- Centro de custo.
- Data esperada.
- Recebimento.
- Conta a pagar.

## 10.2 Comparação de preços

Criar histórico por produto.

Especialmente:
- Bobinas por kg.
- Perfis de alumínio.
- Vidros por m².
- Acessórios por unidade.
- Vedantes.
- Parafusos.
- Materiais de instalação.

Exibir:
- Último preço.
- Menor preço histórico.
- Média do período.
- Variação percentual.
- Fornecedor.
- Frete e custo total.

## 10.3 Consolidação de necessidades

Reunir materiais faltantes de várias obras para sugerir uma lista consolidada de compra.

Não criar pedidos a fornecedores sem aprovação.

## 10.4 Recebimento

Conferir:
- Quantidade pedida.
- Quantidade recebida.
- Quantidade faltante.
- Divergência de preço.
- Material danificado.
- Nota fiscal.

Atualizar estoque e situação da compra.

Evitar gerar contas duplicadas quando uma compra tiver recebimentos parciais.

---

# 11. ESQUADRIAS — INTEGRAÇÃO GERENCIAL COM W VETRO

**NÃO recriar o W Vetro.**

A empresa utiliza o W Vetro para:
- Orçamentos.
- Projetos.
- Listas técnicas.
- Pedidos.
- Materiais de esquadrias.

O CRM Bielenki será responsável pela gestão complementar.

## 11.1 Cadastro de pedidos W Vetro

Permitir registrar:
- Número do pedido W Vetro.
- Cliente.
- Obra.
- Valor da venda.
- Data de aprovação.
- Prazo previsto.
- Arquivo original.
- Situação da compra.
- Situação da fabricação.
- Situação da instalação.
- Recebimentos.
- Despesas.
- Margem da obra.

## 11.2 Importação

Investigar possibilidades técnicas:
1. API oficial disponível.
2. Arquivos exportados pelo W Vetro.
3. PDF estruturado.
4. CSV ou planilha.
5. Importação manual assistida.

Escolher a integração mais confiável realmente disponível.

Não inventar API do W Vetro.

Se a integração direta não for possível, implementar importação segura de documentos com revisão dos dados extraídos.

## 11.3 Gestão operacional

Permitir:
- Acompanhar prazo de materiais.
- Identificar perfis e vidros pendentes.
- Registrar entregas de fornecedores.
- Agendar instalação.
- Vincular equipe.
- Controlar despesas.
- Registrar assistência e garantia.

Não exigir cadastro técnico duplicado quando essas informações já estiverem disponíveis no W Vetro.

---

# 12. GESTÃO DE FUNCIONÁRIOS E DESPESAS OPERACIONAIS

Aproveitar os cadastros existentes.

## 12.1 Funcionários

Adicionar, conforme permissão:
- Equipe.
- Função.
- Situação.
- Custo gerencial da mão de obra.
- Comissões.
- Adiantamentos.
- Reembolsos.
- Despesas vinculadas.
- Obras atribuídas.

Proteger informações salariais com permissões específicas.

## 12.2 Custos por equipe

Criar relatório:
- Obras atendidas.
- Serviços concluídos.
- Retornos.
- Custo de mão de obra.
- Despesas atribuídas.
- Produtividade por período.

Não utilizar rankings automáticos de funcionários como avaliação definitiva de desempenho sem contexto.

## 12.3 Gestão de veículos

Criar controle de:
- Veículos.
- Quilometragem.
- Abastecimentos.
- Manutenções.
- Custos.
- Despesas por veículo.
- Deslocamentos vinculados a obras.

---

# 13. AUTOMAÇÕES ÚTEIS NO DIA A DIA

Implementar eventos e alertas com controle de duplicidade.

Exemplos:

### Pedido aprovado
- Criar próximos passos.
- Gerar previsão financeira.
- Identificar necessidade de material.
- Preparar produção.

### Material recebido
- Atualizar estoque.
- Atualizar compra.
- Identificar ordens liberadas para produção.

### Produção concluída
- Avisar escritório.
- Atualizar disponibilidade.
- Liberar separação.

### Instalação concluída
- Atualizar obra.
- Solicitar conferência de pendências.
- Preparar etapa financeira.
- Iniciar pós-venda conforme regras.

### Parcela vencida
- Alertar financeiro.
- Disponibilizar ação de cobrança.
- Evitar notificações duplicadas.

### Pedido atrasado
- Avisar responsável.
- Mostrar motivo conhecido.
- Sugerir próxima ação.

### Material insuficiente
- Avisar compras.
- Exibir quais obras serão afetadas.

As automações devem ser idempotentes e auditáveis.

---

# 14. IA GERENCIAL E OPERACIONAL

A IA deve atuar como assistente de gestão, não como executora irrestrita.

## 14.1 Assistente financeiro

Permitir perguntas:
- Qual foi a margem das obras de calhas neste mês?
- Quanto gastamos com alumínio?
- Quais clientes têm pagamentos vencidos?
- Quais obras apresentam custos acima do previsto?
- Quais foram os fornecedores mais utilizados?
- Quanto temos previsto para pagar na próxima semana?
- Quais serviços geraram maior margem?
- Qual foi o custo de retrabalho?

Responder somente com dados autorizados e verificáveis.

Se os registros forem insuficientes, informar claramente.

## 14.2 Assistente operacional

Permitir perguntas:
- Quais pedidos precisam ficar prontos amanhã?
- Quais ordens estão dobradas aguardando conferência?
- O que falta para a instalação do cliente?
- Quais obras estão aguardando materiais?
- Quais instalações ficaram pendentes?
- Quais compras precisam ser feitas?

As respostas devem incluir links para os registros correspondentes.

## 14.3 Leitura de documentos

Preparar funcionalidade para:
- PDF do W Vetro.
- Notas fiscais.
- Pedidos.
- Comprovantes.
- Documentos de fornecedores.

Extrair campos para conferência e posterior registro autorizado.

Não registrar automaticamente dados financeiros de documentos sem validação suficiente.

## 14.4 Segurança da IA

- Aplicar autenticação.
- Respeitar permissões e RLS.
- Proteger dados financeiros.
- Limitar consultas.
- Registrar ações.
- Impedir alterações sem aprovação.
- Não permitir vazamento de dados entre empresas.
- Exigir confirmação para ações externas.
- Não interpretar textos de documentos como comandos administrativos.

**Não alterar a política atual de ativação da IA no atendimento WhatsApp.**

---

# 15. MELHORIAS DE USABILIDADE

## 15.1 Mobile

Priorizar uso real em celulares por:
- Instaladores.
- Funcionários da produção.
- Vendedores.
- Gerentes.

Criar:
- Botões grandes.
- Formulários curtos.
- Ações rápidas.
- Checklists.
- Upload de fotografias.
- Busca simplificada.
- Navegação clara.
- Estados de carregamento.
- Mensagens de erro compreensíveis.

Evitar tabelas largas que obriguem o funcionário a arrastar horizontalmente para executar ações simples.

## 15.2 Desktop

Preservar a experiência atual sempre que possível.

Aprimorar:
- Filtros.
- Pesquisa.
- Indicadores.
- Tabelas.
- Ações em lote.
- Visões por setor.
- Navegação entre pedido, obra, financeiro e produção.

Não redesenhar páginas que já estão funcionando sem benefício demonstrável.

## 15.3 Identidade visual

Manter a identidade visual da Marquinhos Calhas e Esquadrias.

Não remover:
- Logo.
- Cores configuradas.
- Templates.
- Layout de orçamentos.
- Peças 3D.
- Impressão A4.
- Documentos comerciais.

As novas interfaces devem parecer parte do mesmo software.

---

# 16. MODELAGEM DE DADOS E ARQUITETURA

Antes de criar tabelas novas, verificar se os dados já existem em estruturas reutilizáveis.

Entidades ou extensões que podem ser necessárias:

- Obras.
- Centros de custos.
- Plano de contas.
- Contas financeiras.
- Movimentações bancárias.
- Conciliações.
- Rateios de despesas.
- Custos por obra.
- Custos previstos.
- Registros de consumo de materiais.
- Lotes de bobinas.
- Movimentações de bobinas.
- Sobras.
- Perdas de fabricação.
- Conferências de produção.
- Itens conferidos.
- Solicitações operacionais.
- Aprovações.
- Registros de mão de obra.
- Despesas de veículos.
- Documentos vinculados.
- Integrações externas.
- Logs de auditoria.

**Estas são entidades conceituais, não nomes obrigatórios de tabelas.**

Definir a modelagem definitiva após inspecionar o banco atual.

## Requisitos técnicos

- Chaves estrangeiras adequadas.
- Índices para consultas frequentes.
- Constraints.
- Integridade referencial.
- Controle de concorrência.
- Idempotência.
- RLS.
- Histórico de alterações.
- Paginação server-side.
- Consultas agregadas eficientes.
- Datas e valores consistentes.
- Separação entre tipos de lançamento financeiro.
- Sem duplicidade de dados canônicos.

Operações envolvendo múltiplas entidades devem usar transações no banco sempre que necessário.

Evitar encadear atualizações críticas pelo frontend quando houver risco de estado parcial.

---

# 17. TESTES OBRIGATÓRIOS

Não considerar a implementação concluída apenas porque a aplicação compila.

## 17.1 Testes de financeiro

Verificar:
- Lançamento a pagar.
- Lançamento a receber.
- Pagamento parcial.
- Pagamento total.
- Estorno.
- Cancelamento.
- Parcelamento.
- Reagendamento.
- Conta recorrente.
- Soma dos valores.
- Rateio por centro de custo.
- Apropriação por obra.
- Conciliação.
- Importação duplicada.
- Saldo.
- Fluxo de caixa.
- DRE.
- Relatórios.
- Permissões.

Conferir cálculos financeiros com casos conhecidos.

Incluir cenários de arredondamento monetário e concorrência.

## 17.2 Testes de calhas

Verificar:
- Tabelas de preço existentes.
- Cálculo por corte.
- Espessura.
- Pintura.
- Produtos especiais.
- PDF A4.
- Peças 3D.
- Orçamento aprovado.
- Criação de pedido.
- Geração de produção.
- Consumo de material.
- Movimentação de estoque.
- Bobinas.
- Sobras.
- Perdas.
- Conferência das peças.
- Status de produção.

## 17.3 Testes de integração

Testar fluxo completo:

**Orçamento → Venda → Pedido → Compra → Estoque → Produção → Instalação → Financeiro → Pós-venda.**

Também testar:
- Pedido de esquadrias importado do W Vetro.
- Obra com pagamento parcelado.
- Compra recebida parcialmente.
- Instalação com material extra.
- Obra com retrabalho.
- Cancelamento de pedido.
- Correção de medida.
- Cliente inadimplente.

## 17.4 Testes de segurança

- Usuário sem permissão financeira.
- Instalador tentando acessar salários.
- Vendedor tentando aprovar despesa sem autorização.
- Acesso a outra empresa.
- Tentativas de alterar lançamentos por endpoints.
- Arquivos maliciosos.
- Requisições duplicadas.
- Erros de sessão.
- Falhas de autenticação.

## 17.5 Regressões

Verificar principalmente:
- Orçamentos de calhas.
- Preços especiais.
- Peças 3D.
- Impressão A4.
- Medições.
- Pipeline.
- Permissões.
- Financeiro.
- WhatsApp.
- IA.
- Produção.
- Agenda.
- Mobile.

Usar os testes existentes e criar testes adicionais.

Executar os comandos de build, typecheck, testes unitários, integração e E2E disponíveis e aplicáveis ao projeto.

Se algum teste depender de infraestrutura indisponível, registrar a limitação e não afirmar que passou.

---

# 18. DEPLOY SEGURO E VERIFICAÇÃO EM PRODUÇÃO

O deploy está autorizado **somente após a aprovação técnica das verificações obrigatórias**.

## 18.1 Antes do deploy

1. Conferir alterações.
2. Revisar migrations.
3. Verificar backup e rollback.
4. Executar testes automatizados.
5. Confirmar build.
6. Confirmar typecheck.
7. Conferir segurança.
8. Conferir compatibilidade.
9. Revisar variáveis de ambiente sem expor seus valores.
10. Verificar configurações do Supabase.
11. Verificar GitHub Actions.
12. Confirmar ausência de alterações acidentais em arquivos sensíveis.

Não usar migrations destrutivas sem plano explícito de recuperação.

Não executar migração irreversível em produção se backup, permissões ou validações indispensáveis não estiverem disponíveis.

## 18.2 Publicação

Seguir o fluxo de Git e deploy realmente utilizado pelo projeto.

Preferir branch de implementação e validação por PR quando compatível com o fluxo existente.

Preservar histórico de commits.

Não executar push forçado.

Não sobrescrever alterações de outros desenvolvedores.

Publicar na Vercel somente depois de confirmar que a versão está consistente.

## 18.3 Verificação pós-deploy

Conferir:
- Página de login.
- Dashboard.
- Orçamentos.
- Tabela de calhas.
- Produção.
- Pedidos.
- Compras.
- Estoque.
- Financeiro.
- A pagar.
- A receber.
- Instalações.
- Agenda.
- Funcionários.
- Permissões.
- Atendimento.
- IA.
- Documentos.

Executar testes seguros em produção, sem criar lançamentos financeiros fictícios permanentes ou enviar mensagens reais sem autorização.

Confirmar que as migrations necessárias estão aplicadas e que os dados históricos permanecem acessíveis.

Se uma verificação crítica falhar, interromper a publicação ou executar o rollback seguro previsto.

---

# 19. CRITÉRIOS DE ACEITAÇÃO

Uma funcionalidade só pode ser declarada concluída quando:

1. A interface funciona.
2. Os dados são realmente persistidos.
3. Os relacionamentos estão corretos.
4. As permissões são respeitadas.
5. Os cálculos estão corretos.
6. As ações são auditáveis quando necessário.
7. O mobile funciona.
8. Os testes relevantes passam.
9. Não existem regressões conhecidas bloqueadoras.
10. O recurso foi verificado no ambiente apropriado.

### Critérios essenciais de negócio

**Financeiro:** um mesmo pagamento não pode ser contabilizado duas vezes.

**Obras:** custos e receitas devem ser vinculados corretamente.

**Calhas:** a baixa de estoque deve refletir movimentações efetivas, não apenas aprovação comercial.

**Produção:** não exigir horários manuais; utilizar data de conclusão prevista e identificação dos responsáveis.

**Conferência:** manter identificação de quem cortou e quem conferiu.

**Instalações:** conclusão da produção não significa conclusão da instalação.

**W Vetro:** preservar seu papel, evitando desenvolvimento técnico duplicado de esquadrias.

**IA:** não realizar ações financeiras ou mensagens externas sem autorização e regras de segurança.

---

# 20. ENTREGÁVEIS OBRIGATÓRIOS

Ao final, apresentar um relatório técnico objetivo com:

### Auditoria inicial
- O que já existia.
- O que estava incompleto.
- O que apresentava defeitos.
- O que precisou ser criado.

### Implementação
- Funcionalidades desenvolvidas.
- Componentes alterados.
- Novas telas.
- Novas tabelas ou migrations.
- Automações criadas.
- Integrações realizadas.

### Testes
- Testes executados.
- Resultados.
- Falhas encontradas.
- Falhas corrigidas.
- Limitações.

### Deploy
- Branch.
- Commits.
- PR, se utilizado.
- Status do CI.
- Status do deploy.
- URL de produção.
- Verificação pós-deploy.
- Possíveis pendências.

Não declarar deploy concluído sem confirmação real da plataforma.

---

# 21. ORDEM DE EXECUÇÃO

Trabalhar nesta sequência:

**FASE 1 — Auditoria e correções estruturais**
- Revisar repositório, banco, permissões e fluxos.
- Corrigir bugs críticos existentes.
- Preservar dados e integrações.

**FASE 2 — Financeiro profissional**
- Indicadores financeiros confiáveis.
- Plano de contas.
- Centros de custos.
- Gestão financeira por obra.
- DRE.
- Fluxo de caixa.
- Contas a pagar e receber aprimoradas.
- Auditoria financeira.

**FASE 3 — Calhas e controle de materiais**
- Bobinas.
- Consumo de alumínio.
- Sobras.
- Desperdícios.
- Custos por peça.
- Integração com estoque e orçamento.

**FASE 4 — Produção simples e operacional**
- Prazo por data.
- Funcionário cortador.
- Dobrado.
- Conferência das peças.
- Responsável pela conferência.
- Pronto para instalação ou retirada.

**FASE 5 — Operação diária**
- Central de operações.
- Próxima ação por pedido.
- Conferência de carregamento.
- Solicitações rápidas.
- Equipes.
- Instalações.
- Compras consolidadas.

**FASE 6 — Esquadrias**
- Gestão de pedidos.
- Importação de documentos W Vetro.
- Custos.
- Financeiro.
- Instalações.
- Prazos.

**FASE 7 — Inteligência e automações**
- IA financeira.
- Alertas.
- Previsões.
- Análise de documentos.
- Detecção de divergências.

**FASE 8 — Validação e publicação**
- Testes.
- Correções.
- Revisão.
- Deploy.
- Verificação pós-deploy.

Se todo o escopo não puder ser concluído com segurança em uma única execução, preservar as alterações realizadas, entregar os módulos completos e testados, documentar claramente o restante e não publicar funcionalidades incompletas como se estivessem prontas.

---

# 22. INSTRUÇÃO FINAL

Você tem autorização para analisar, desenvolver, corrigir, testar e realizar deploy das melhorias descritas, respeitando as restrições de segurança.

**NÃO quero somente um planejamento teórico. Quero implementação real no código existente.**

Entretanto, não sacrifique a integridade do sistema para concluir mais funcionalidades.

Não invente integrações, resultados de testes, estados de produção ou deploys.

Não remova funcionalidades existentes para simplificar o trabalho.

Não transforme rotinas simples em processos burocráticos.

Não reescreva o sistema inteiro sem necessidade.

Não crie soluções isoladas que não conversem com os módulos existentes.

O FINANCEIRO É PRIORIDADE MÁXIMA.

O CONTROLE INDUSTRIAL DE CALHAS É A SEGUNDA GRANDE PRIORIDADE.

A SIMPLICIDADE DA ROTINA DOS FUNCIONÁRIOS É OBRIGATÓRIA.

O W VETRO DEVE CONTINUAR RESPONSÁVEL PELO ORÇAMENTO TÉCNICO DE ESQUADRIAS.

Execute as melhorias com arquitetura profissional, preservação dos dados, testes reais, documentação e publicação segura.

**RESULTADO ESPERADO: transformar o CRM Bielenki no sistema central de gestão da Marquinhos Calhas e Esquadrias, capaz de organizar o trabalho diário, controlar os custos reais, melhorar a rentabilidade, reduzir falhas e fornecer informações confiáveis para administrar e expandir a empresa.**
