# Integração fiscal (Reforma Tributária) — Fase 1: diagnóstico e arquitetura

**Data:** 19/11/2026 · **Escopo:** leitura do ERP atual e dos três repositórios oficiais da Receita Federal.
**Nada foi alterado no ERP nem em produção nesta fase.** Este documento responde ao item "Fase 1 — Diagnóstico".

---

## 1. Resumo para decisão

1. **O ERP não tem módulo fiscal.** Não há NCM, CFOP, CST/cClassTrib, regime tributário, inscrição estadual/municipal, certificado digital nem emissão de NF-e/NFS-e. O único ponto fiscal é a **leitura de nota de compra por IA** (pré-preenche a Nova compra).
2. **O motor oficial do Regime Regular funciona e foi testado aqui.**
   - Ele compilou, gerou a base oficial, subiu em 10 s e respondeu em cerca de 40 ms por cálculo.
   - O exemplo oficial da documentação deu resultado idêntico ao publicado.
   - Ele **precisa de um servidor com Java** (cerca de 500 MB de memória) e **não roda na Vercel**.
3. **O motor do Simples Nacional (0.0.6) ainda não está maduro.**
   - Do jeito que foi publicado, não roda: o guia manda gerar o banco com uma pasta `flyway/` que não existe no repositório.
   - Ele não calcula a alíquota efetiva do Simples. O próprio motor exige que ela seja informada (`pIBSSN`/`pCBSSN`); quem calcula é o PGDAS-D, com integração prevista só para a Release 16.
4. **A calculadora não emite nota.**
   - Ela calcula e gera e valida os grupos de IBS/CBS/IS do XML.
   - Construir a nota inteira, assinar com o certificado, transmitir à SEFAZ ou à prefeitura/ADN e guardar a autorização exige um emissor.
   - O ERP não tem emissor. A recomendação é contratar um provedor homologado em vez de construir assinatura e transmissão do zero.
5. **O gerador de DANFSe está pronto (1.0.0)** e pode ser compilado para WebAssembly. Assim ele rodaria **dentro do próprio ERP**, sem outro servidor.
6. **Multiempresa:**
   - O ERP já isola os dados por empresa (RLS testada em 100 tabelas).
   - Hoje, porém, **cada usuário pertence a uma única empresa** (`profiles.company_id`).
   - Para o mesmo usuário trabalhar em Bielenki Metal e Marquinhos, falta um vínculo usuário↔empresas e a troca de empresa. É uma mudança grande, a ser feita em fase própria.

**Decisões que só você pode tomar (seção 9)**:
- o regime de cada empresa;
- quais notas cada empresa emite hoje e por qual sistema;
- onde hospedar o motor;
- se contrata um emissor.

---

## 2. Repositórios oficiais estudados

| Repositório | Versão | Tecnologia | Licença | Situação |
|---|---|---|---|---|
| calculadora-rtc-regime-regular | 1.6.1 (22/10/2026), base V0059 (30/09/2026) | Java 21, Spring Boot 3.5.16, SQLite somente leitura, Flyway | MIT | **Usável.** 157 testes Java e 96 casos oficiais (45 "cálculos corretos", 33 validações, XML NF-e/NFS-e) |
| calculadora-rtc-simples-nacional | 0.0.6 (22/10/2026) | Java 21, Spring Boot, SQLite | MIT | **Imaturo.** Sem scripts do banco no repositório; só 9 arquivos de teste e nenhum caso JSON; exige a alíquota efetiva informada |
| calculadora-rtc-gerador-danfse | 1.0.0 (22/10/2026) | Go 1.27, também em WebAssembly | MIT | **Pronto** para gerar o PDF do DANFSe a partir do XML **autorizado** da NFS-e |

### O que o motor do Regime Regular oferece (lido no código, README e exemplos)
- `POST /api/calculadora/regime-geral`: a operação inteira falha no primeiro erro (HTTP 422).
- `POST /api/calculadora/observabilidade/regime-geral`: devolve erro **por item**, sem interromper os demais.
  - Estados de cada item: `CALCULADO`, `CALCULO_SIMULADO`, `INCONSISTENCIA_ENTRADA`, `NAO_IMPLEMENTADO` ou `FALHA_TECNICA`.
- **Memória de cálculo** em texto e **fundamentação legal** em cada item.
- Base de cálculo unificada (NF-e/NFC-e e NFS-e).
- Geração do grupo XML a partir do resultado (`/xml/generate`) e validação contra o XSD (`/xml/validate`).
- Dados abertos: CST, cClassTrib, fundamentações, NCM/NBS e alíquotas de referência (União/UF/município), além de `/dados-abertos/versao`.
- **Regra importante:** a partir de 2027 o campo `aliquotasNominais` passa a ser **obrigatório**. Cálculos com alíquotas informadas saem como `CALCULO_SIMULADO`, com o cabeçalho `x-warning-dados-simulados`. Antes de 2027 esse campo é proibido.
- **Não tem autenticação nem controle de acesso.** Não pode ficar exposto na internet: precisa de um proxy com segredo ou de rede privada.

### Instalação online oficial (piloto)
O código aponta para `https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora/...`, que serve de referência de versão (`/dados-abertos/versao`).
- Ela pode servir para **homologação e comparação**.
- **Não serve de base para produção**: é piloto, sem garantia de disponibilidade ou limite documentado. Ainda não foi acessada daqui.

---

## 3. Evidências da execução local (feita nesta fase, fora do ERP)

| Passo | Resultado |
|---|---|
| Gerar a base oficial (`flyway:migrate`) | 5,3 MB em 21 s |
| Compilar (`mvn package`) | JAR de 93 MB em 18 s |
| Subir (`-Xmx384m`, perfil offline) | Pronto em 10 s; `/versao` respondeu: app 1.6.1, base V0059 |
| Memória do processo | ~490 MB (RSS) |
| Exemplo oficial `docs/exemplos.md` (4 itens) | **Idêntico ao publicado.** Item 3: vCBS 42,24 (redução de 60%). Totais: vIS 15,00, vBC 1.465,00, vIBS 0,64, vCBS 56,76. Item 4 recusado com REG-011 |
| Tempo de resposta | 1ª chamada 0,54 s; seguintes ~0,04 s |
| Testes oficiais do motor (`mvn test`) | **1.090 testes, 0 falhas, 10 pulados pelo próprio projeto. BUILD SUCCESS** |

---

## 4. Auditoria do ERP (verificada no código e no banco)

| Funcionalidade | Situação | Onde está | Ação |
|---|---|---|---|
| Cadastro da empresa | Parcial: nome, CNPJ (`tax_id`), endereço, cidade e UF | `companies` | **Completar**: razão social, IE, IM, regime, IBGE do município, ambiente fiscal |
| Cadastro de cliente | Parcial: CPF/CNPJ, endereço, CEP | `clients` | **Completar**: IE/indicador de IE e IBGE (exigidos na NF-e) |
| Produtos e serviços | Não há cadastro único: os itens do orçamento são texto (`quote_items.product`) e a tabela de preços (`gutter_prices`) é por nome | `gutter_prices`, `quote_items`, `sale_items` | **Criar a classificação fiscal por produto/serviço** (NCM ou NBS, CST, cClassTrib, unidade tributável), ligada ao nome usado no orçamento |
| Cálculo tributário | **Ausente** | — | **Integrar o motor oficial** (seção 5) |
| Orçamentos | Existente: calhas, esquadrias, importação WVetro, impressão A4 | `quotes`, `create_gutter_quote`, `create_window_quote` | **Só ler**: simulação fiscal à parte, sem mexer em preço nem na impressão |
| Pedidos e vendas | Existente: `approve_quote` gera venda, pedido e conta a receber | `sales`, `orders`, `financial_entries` | **Conectar**: cálculo fiscal no pedido, com vínculo ao orçamento (que já existe) |
| Emissão NF-e/NFS-e | **Ausente** | — | **Contratar um emissor ou criar um adaptador** (seção 6) |
| DANFE/DANFSe, XML e PDF | Ausente (só existe o PDF do orçamento) | bucket `quote-pdfs` | DANFSe pelo gerador oficial em WASM; DANFE pelo emissor |
| Notas de compra | Existente: leitura por IA | `invoice-reader` | Manter |
| Financeiro | Existente: receber, pagar, caixa, extrato por conta, conciliação, DRE, centro de custo | `financial_entries`, `payments` etc. | **Conectar só relatórios** (simulado × emitido × recolhido), sem lançar nada sozinho |
| Histórico e auditoria | `audit_logs` já existe | `audit_logs` | **Reaproveitar** e criar o histórico de cálculos fiscais |
| Segredos | Criptografia AES-256 no servidor (`lib/encrypt.ts`) | — | **Reaproveitar** para o certificado A1 e as chaves do emissor |
| Integrações | Tabela `integrations` existe, mas não é usada | `integrations` | **Reaproveitar** para a configuração do motor e do emissor |
| Permissões | 9 cargos e a tabela `permissions` por recurso, com RLS | `permissions`, `has_table_access` | **Acrescentar recursos fiscais** (calcular, configurar, emitir, cancelar) |
| Multiempresa | Isolamento por empresa: sim. Usuário em várias empresas: **não** | `profiles.company_id` | **Fase própria**: vínculo usuário↔empresa e troca de empresa |
| Liberação gradual (feature flag) | Ausente | — | Criar uma chave simples por empresa (ex.: `fiscal_enabled`) |
| CI/CD | GitHub Actions: tipos, segurança, build, testes de banco e e2e; migrações por workflow manual | `.github/workflows` | Acrescentar os testes fiscais e de contrato |

---

## 5. Arquitetura proposta

```
Tela do ERP (Next.js)
  → Ação no servidor do ERP (Vercel): permissão, empresa, validação com zod
      → Adaptador fiscal (TypeScript, lib/fiscal/*)
           seleciona o motor pelo regime da empresa, monta o contrato tipado,
           timeout 5 s, 1 nova tentativa só em falha de rede, circuit breaker,
           chave de idempotência por operação
      → Serviço fiscal (motor oficial em Docker, servidor próprio, HTTPS,
           protegido por segredo no cabeçalho; nunca exposto ao navegador)
  ← Resposta validada (estado por item, memória de cálculo, versão do motor e da base)
  → Supabase: fiscal_calculations + fiscal_calculation_items (RLS por empresa, auditoria)
  → Orçamento / pedido: mostra a simulação como "simulada", sem mudar preço
Emissão (fase 5): ERP → emissor homologado (NF-e/NFS-e) → autorização → XML/PDF no storage
```

- **Sem cálculo alternativo:** se o motor estiver fora, o ERP mostra "cálculo fiscal indisponível". Ele nunca troca o motor por uma conta própria.
- **Origem registrada:** cada cálculo guarda a versão do app e da base (`/versao`), o endpoint usado, o estado de cada item e quem pediu.
- **Simulado × definitivo:** valores do motor são sempre "simulação" até existir uma nota **autorizada** pelo órgão. Antes de 2027 isso também vale para os `CALCULO_SIMULADO`.
- **Homologação:** uma segunda instância do motor (ou a instalação piloto oficial) para testes, separada da de produção.
- **Atualizações:** uma rotina diária compara a versão local com o `/versao` do piloto oficial e com as releases do GitHub. Quando há novidade, o administrador recebe um aviso. A atualização é feita **à mão**, depois de rodar os casos oficiais, com registro de versão anterior e nova e de como voltar atrás.

### Onde hospedar o motor (precisa da sua decisão)
| Opção | Custo | Prós | Contras |
|---|---|---|---|
| A. Servidor da Hospede Aqui (onde está a Evolution) | R$ 0 a mais, se houver ~1 GB livre | Já existe e tem Docker | Divide o servidor com o WhatsApp, que travou hoje; um problema derruba os dois |
| B. Oracle Cloud (conta gratuita, VM ARM) | R$ 0 | Separado e com folga de memória | Precisa criar e manter a VM; a conta gratuita pode ser recolhida se ficar ociosa |
| C. Hospedagem gerenciada de container (ex.: Fly.io, Render, Railway; 512 MB a 1 GB) | ~US$ 5–10/mês | Menos manutenção, HTTPS pronto | Custo mensal; servidor fora do Brasil |

Recomendação: **B ou C para produção** e o **piloto oficial para homologação**.

---

## 6. Emissão de notas: o que a calculadora não faz

| Etapa | Calculadora oficial | Precisa de |
|---|---|---|
| 1. Cálculo tributário | Sim | — |
| 2. Grupos IBS/CBS/IS do XML e validação XSD | Sim | — |
| 3. Montar a NF-e/NFS-e completa (emitente, destinatário, ICMS/ISS da transição, totais) | Não | Emissor |
| 4. Assinar com o certificado A1 | Não | Emissor + certificado da empresa |
| 5. Transmitir (SEFAZ-SC para NF-e; Emissor Nacional/ADN ou prefeitura para NFS-e) | Não | Emissor |
| 6. Receber autorização, rejeição e protocolo | Não | Emissor |
| 7. Guardar XML/PDF, cancelar, carta de correção | Não | Emissor + storage do ERP |
| DANFSe (PDF da NFS-e autorizada) | Gerador oficial | — |

**Recomendação:** contratar um emissor homologado via API e ligá-lo por um adaptador, de modo que a troca de fornecedor seja possível depois. Construir assinatura e transmissão próprias é caro e arriscado.
- Hoje já existem notas emitidas por outro sistema, e o WVetro gera propostas. Antes de decidir, é preciso saber **qual sistema emite as notas atualmente**.

---

## 7. Fases (atualizadas pelo diagnóstico)

| Fase | Entrega | Depende de |
|---|---|---|
| 1 ✅ | Este diagnóstico, com o motor testado localmente | — |
| 2 | Motor do Regime Regular em servidor próprio (Docker, HTTPS, segredo, health check) + instância de homologação | Escolha da hospedagem (seção 5) |
| 3 | Adaptador TypeScript, contratos com zod, tabelas `fiscal_*` com RLS, testes com os 45 casos oficiais, circuit breaker e idempotência | Fase 2 |
| 4 | Cadastro fiscal da empresa, do cliente e dos produtos/serviços (classificação aprovada pelo contador), simulação no orçamento e no pedido, pendências sem inventar classificação | Classificações fornecidas pelo contador |
| 5 | Emissor (NF-e de mercadoria, NFS-e de instalação), DANFSe em WASM, XML/PDF no storage | Contrato com o emissor + certificado A1 |
| 6 | Relatórios fiscais no financeiro (simulado × emitido × recolhido) e exportação para o contador | Fase 5 |
| 7 | Painel fiscal (visão geral, calculadora, histórico, configurações) | Fases 3 e 4 |
| 8–9 | Homologação, liberação por empresa e rollback | — |
| — | Multiempresa por usuário (vínculo usuário↔empresas e troca de empresa) | Decisão sobre a Bielenki Metal no mesmo ERP |
| — | Simples Nacional | Motor oficial executável (Release 16) **ou** uso da instalação oficial, com a alíquota efetiva informada pelo contador |

---

## 8. Testes oficiais do motor

`mvn test` na versão 1.6.1, rodado aqui com a base V0059: **1.090 testes, 0 falhas, 0 erros, 10 pulados (marcados assim no próprio projeto)**.
Os 45 casos de "cálculos corretos" do repositório oficial serão os testes de referência do adaptador na Fase 3. **Nenhum resultado esperado será inventado.**

---

## 9. Perguntas para você (sem as respostas, não implemento cálculo real)

1. **Regime tributário** de cada empresa (Marquinhos Calhas e Esquadrias; Bielenki Metal): Simples Nacional, Lucro Presumido ou Lucro Real? Se for Simples, a empresa vai optar pelo IBS/CBS no regime regular?
2. **Notas emitidas hoje:**
   - NF-e de mercadoria? NFS-e de instalação?
   - Por qual sistema (SEFAZ, portal da prefeitura de Jaraguá do Sul, Emissor Nacional, algum ERP, contador)?
   - Existe certificado A1?
3. **Hospedagem do motor:** opção A, B ou C (seção 5)?
4. **Emissor:** podemos cotar um emissor homologado por API?
5. **Contador:** quem vai fornecer e aprovar NCM, NBS, CST e cClassTrib por produto/serviço? Sem essa aprovação, o ERP só mostra a pendência.
6. **Bielenki Metal:** ela será uma segunda empresa neste mesmo ERP, com os mesmos usuários? Isso define a fase de multiempresa.
