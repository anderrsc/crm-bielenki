# Guia visual "Atlas UX/UI" — o que está feito e o que falta (19/11/2026)

O guia é um estudo de referências e 23 diretrizes; não é uma auditoria do código. Estado de cada diretriz:

| # | Diretriz | Estado |
|---|---|---|
| 02 | Design system (tokens, botões, avisos, tema claro/escuro) | ✅ tokens de movimento/foco, avisos, confirmação própria, tema persistente (`docs/DESIGN-SYSTEM.md`) |
| 03 | Navegação (sidebar recolhível, favoritos, recentes, estado ativo) | ✅ recolhível e estado ativo já existiam; **favoritos e recentes novos**. Breadcrumbs: ⬜ |
| 04 | Busca global Ctrl+K com ações | ✅ |
| 05 | Dashboard por papel, "o que fazer agora" | 🟡 fila de prioridades na Visão Geral (por permissão); painéis separados por cargo: ⬜ |
| 06 | Ações rápidas / + Novo | ✅ |
| 07 | Formulários inteligentes (aviso ao sair sem salvar, rascunhos) | 🟡 rascunho de orçamento/compra já existia; aviso de saída: ⬜ |
| 08 | Tabelas (filtros persistentes, colunas, visões salvas, gaveta lateral) | ⬜ |
| 09 | Status e prioridades coerentes | 🟡 `StatusBadge` já padroniza; revisão de todas as telas: ⬜ |
| 10 | Pipeline com cartão completo | ⬜ (já existe Kanban; falta revisar cartões) |
| 11–14 | Orçamentos, pedidos, agenda, produção | ✅ regras preservadas; linha do tempo do pedido; revisão de agenda/produção: ⬜ |
| 15–16 | WhatsApp e IA sob controle | ✅ filas por número, etiquetas, sem resposta, saúde, transferência; IA/humano visível; histórico de decisões da Lia |
| 17 | Financeiro mais legível | ⬜ |
| 18 | Notificações (urgente x informativo, agrupar, silenciar) | 🟡 lembretes novos usam notificação existente; agrupamento/silenciar: ⬜ |
| 19 | Mobile | 🟡 barra inferior e cartões já existiam; medição/instalação por toque: ⬜ |
| 20 | Desempenho percebido (skeleton, "salvo" só com confirmação) | ✅ |
| 21 | Acessibilidade (foco, teclado, reduzir movimento) | ✅ foco visível, reduzir movimento, diálogos com foco preso |
| 22 | Segurança | ✅ nada de autorização depende de esconder menu (provado em `tests/rbac-isolation-db.test.ts`) |

Não há medição antes/depois de cliques e tempo: o guia pede meta de 30% de redução apenas "quando validada", e isso exige observar uso real. Nenhum resultado foi inventado.
