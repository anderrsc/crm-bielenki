# Matriz de permissões (RBAC) — estado atual do banco

Extraída de `public.permissions` após aplicar todas as migrações (19/11/2026).
Legenda: **V** ver · **C** criar · **E** editar · **X** excluir · **—** sem acesso.
Administrador e gerente têm acesso total à própria empresa; o isolamento entre empresas vale para todos os cargos.

## Como o acesso é decidido (verificado)
1. **Empresa:** `current_company_id()` em toda política de linha (RLS). Provado por teste nas 100 tabelas com `company_id`.
2. **Cargo:** `has_table_access(recurso, ação)` lê esta matriz; funções de gravação chamam `require_table_access` no servidor.
3. **WhatsApp:** além de 1 e 2, a conversa só aparece para o dono do número, usuários autorizados por ele e a gerência (`my_whatsapp_channels()`).
4. Esconder menu **não** é a barreira: endpoints e banco negam sozinhos.

## Matriz atual

| Recurso | administrador | gerente | vendedor | atendente | compras | estoque | producao | instalador | financeiro |
|---|---|---|---|---|---|---|---|---|---|
| `activities` | — | — | VCE | VCE | — | — | — | — | — |
| `bank_reconciliation` | VCE | VCE | — | — | — | — | — | — | VCE |
| `clients` | — | — | VCE | VCE | — | — | — | — | VCE |
| `conversations` | — | — | VCE | VCE | — | — | — | — | — |
| `discount_rules` | — | — | VCE | VCE | VCE | VCE | VCE | VCE | VCE |
| `files` | — | — | — | — | — | — | — | — | — |
| `financial_entries` | — | — | — | — | — | — | — | — | VCE |
| `financial_exports` | VC | VC | — | — | — | — | — | — | VC |
| `financial_payroll` | VCE | VCE | — | — | — | — | — | — | — |
| `financial_recurrences` | VCE | VCE | — | — | — | — | — | — | VCE |
| `followups` | — | — | VCE | VCE | — | — | — | — | — |
| `gutter_prices` | — | — | — | — | — | — | — | — | — |
| `gutter_quote_items` | — | — | VCE | VCE | — | — | — | — | — |
| `gutter_quotes` | — | — | VCE | VCE | — | — | — | — | — |
| `installation_checklists` | — | — | — | — | — | — | — | VE | — |
| `installations` | — | — | — | — | — | — | — | VE | — |
| `lead_sources` | — | — | — | — | — | — | — | — | — |
| `leads` | — | — | VCE | VCE | — | — | — | — | — |
| `materials` | — | — | — | — | VCE | VE | VE | — | — |
| `measurement_checklists` | — | — | VCE | VCE | VCE | VCE | VCE | VCE | VCE |
| `measurement_items` | — | — | VCE | VCE | VCE | VCE | VCE | VCE | VCE |
| `measurements` | — | — | VCE | VCE | VCE | VCE | VCE | VCE | VCE |
| `messages` | — | — | VCE | VCE | — | — | — | — | — |
| `notifications` | — | — | — | — | — | — | — | — | — |
| `operational_events` | — | — | VCE | VCE | VCE | VCE | VCE | VCE | VCE |
| `order_checklist_items` | — | — | — | — | — | VE | VE | — | — |
| `order_checklists` | — | — | VCE | VCE | — | VE | VE | VE | VCE |
| `order_items` | — | — | VCE | VCE | — | VE | VE | VE | VCE |
| `orders` | — | — | VCE | VCE | — | VE | VE | VE | VCE |
| `payments` | — | — | — | — | — | — | — | — | VCE |
| `pipeline_stages` | — | — | — | — | — | — | — | — | — |
| `production_materials` | — | — | — | — | — | VE | VE | — | — |
| `production_order_items` | — | — | — | — | — | VE | VE | — | — |
| `production_orders` | — | — | — | — | — | VE | VE | — | — |
| `purchase_order_items` | — | — | — | — | VCE | — | — | — | — |
| `purchase_orders` | — | — | — | — | VCE | — | — | — | — |
| `purchase_request_items` | — | — | — | — | VCE | — | — | — | — |
| `purchase_requests` | — | — | — | — | VCE | — | — | — | — |
| `quote_items` | — | — | VCE | VCE | — | — | — | — | — |
| `quotes` | — | — | VCE | VCE | — | — | — | — | — |
| `sale_items` | — | — | VCE | VCE | — | — | — | — | VCE |
| `sales` | — | — | VCE | VCE | — | — | — | — | VCE |
| `service_orders` | VCEX | VCEX | VCE | VCE | VCE | VCE | VCE | VCE | VCE |
| `stock_locations` | — | — | — | — | VCE | VE | VE | — | — |
| `stock_movements` | — | — | — | — | VCE | VE | VE | — | — |
| `suppliers` | — | — | — | — | VCE | — | — | — | — |
| `tasks` | — | — | VCE | VCE | — | — | — | VE | VCE |

## Decisões de negócio pendentes (não assumi regra)
| # | Pergunta | Hoje |
|---|---|---|
| 1 | O **vendedor** deve ver só os clientes/orçamentos/vendas **dele** (atribuídos), ou todos da empresa? | Vê todos da empresa |
| 2 | O **atendente** deve ver só as conversas atribuídas a ele, além do número que conectou? | Vê as conversas dos números que pode acessar |
| 3 | Quem pode **exportar** e **imprimir** (relatórios, PDFs com valores)? | Segue o "ver" do recurso |
| 4 | Gerente pode alterar cargos de administrador? | Não (só administrador) |
| 5 | Custos e margem aparecem para o vendedor? | Conforme a coluna do recurso acima |
