# Comandos da Lia pelo WhatsApp

Mande do seu WhatsApp para o número da empresa. Só os números cadastrados em
`lia_command_phones` (Anderson e Financeiro) usam comandos. Os outros números caem no atendimento normal.

**Tudo que lança, envia ou estorna mostra um resumo e só executa depois do "sim".**
"não" cancela. Qualquer outra resposta corrige o resumo (ex.: "valor 35", "conta Caixa").
Um resumo pendente vence em 30 minutos.

| Comando | O que faz | Exemplo |
|---|---|---|
| /entrada (ou /adicionar) | Recebimento numa conta | `/entrada Anderson recebeu 30,00 na conta, calha vendida na hora` |
| /saida | Despesa paga por uma conta | `/saida 85,00 gasolina, Pix Marquinhos` |
| /transferir | Entre contas | `/transferir 500 da conta Anderson pro caixa Marquinhos` |
| /saldo | Saldo das contas (ou de uma) | `/saldo` · `/saldo Anderson` |
| /extrato | Últimos lançamentos de uma conta | `/extrato Anderson 7 dias` |
| /baixa | Baixa em conta a receber + recibo ao cliente | `/baixa Jonata 2.000 Pix orçamento 1738` |
| /cliente | Ficha: orçamentos, vendido, pago, saldo | `/cliente Alexei` |
| /devendo | Saldos em aberto por cliente | `/devendo` |
| /recibo | Reenvia o último recibo do cliente | `/recibo Jonata` |
| /compra | Conta a pagar de fornecedor | `/compra Figueira 1.250,00 perfis, boleto 30 dias` |
| /relatorio | Semana ou mês; "financeiro" envia ao financeiro | `/relatorio mês financeiro` |
| /caixa | Entradas, saídas e saldos de hoje | `/caixa hoje` |
| /editar | Corrige o resumo pendente, ou o último lançado | `/editar valor 35` · `/editar último valor 35` |
| /desfazer | Estorna o último lançamento feito por comando | `/desfazer` |
| /cancelar | Cancela o resumo pendente | `/cancelar` |
| /ajuda | Lista dos comandos | `/ajuda` |

## Falando ou escrevendo sem barra
Comece com **"Lia"**, por texto ou **áudio**: "Lia, lança uma entrada de 30 reais na conta do Anderson, calha vendida na hora".
A Lia transcreve o áudio, descobre o comando e manda o mesmo resumo para confirmar. Para confirmar por áudio, diga "sim" (ou "Lia, sim").

## Como funciona
- Webhook do WhatsApp (`app/api/whatsapp/webhook/route.ts`) chama `lib/lia-comandos/handler.ts` para os números liberados.
- A IA configurada na Central de IA só lê o texto e devolve os campos. Os nomes de conta, categoria, cliente e fornecedor são conferidos no cadastro.
- O lançamento roda em `public.lia_command_execute` (migration `20261125130000_lia_comandos_whatsapp.sql`) como o usuário do CRM ligado ao número. Valem as mesmas funções, permissões e gatilhos das telas: baixa, conta de recebimento, recibo e estorno.
- Cada comando fica registrado em `lia_command_log`. A correção do último lançamento estorna o anterior e lança o novo na mesma transação.
- `/compra` ainda não lê o arquivo da nota. Lança pelo texto.
