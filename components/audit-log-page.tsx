import { getRequestClient } from "@/lib/supabase/server";

// Histórico do sistema: quem criou, alterou ou removeu cada registro, com dia, hora e o que mudou.
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  INSERT: { label: "Criou", color: "bg-emerald-50 text-emerald-700" },
  CREATE: { label: "Criou", color: "bg-emerald-50 text-emerald-700" },
  UPDATE: { label: "Alterou", color: "bg-blue-50 text-blue-700" },
  EDIT: { label: "Alterou", color: "bg-blue-50 text-blue-700" },
  DELETE: { label: "Removeu", color: "bg-red-50 text-red-700" },
};

export const TABLE_LABELS: Record<string, string> = {
  activities: "Atividades", ai_lia_rules: "Regras da Lia", lia_rules: "Regras da Lia", lia_knowledge_blocks: "Conhecimento da Lia",
  lia_prompt_versions: "Prompt da Lia", lia_command_phones: "Telefones de comando da Lia", ai_agent_config: "Configuração da Lia",
  aluminum_cost_settings: "Custo do alumínio", aluminum_price_matrix: "Matriz de preço do alumínio", automation_rules: "Automações",
  bank_statement_imports: "Extratos importados", bank_statement_rows: "Linhas do extrato", checklist_templates: "Modelos de checklist",
  checklist_template_items: "Itens de checklist", client_types: "Tipos de cliente", clients: "Clientes", commissions: "Comissões",
  conversation_labels: "Etiquetas do Atendimento", discount_rules: "Regras de desconto", document_templates: "Modelos de documento",
  files: "Arquivos", financial_categories: "Categorias financeiras", financial_cost_centers: "Centros de custos",
  financial_entries: "Financeiro", financial_entry_allocations: "Rateios financeiros", financial_installments: "Parcelas",
  financial_recurrences: "Contas recorrentes", financial_exports: "Exportações financeiras", followups: "Follow-ups",
  gutter_prices: "Tabela de calhas", gutter_quotes: "Orçamentos de calha", gutter_quote_items: "Itens do orçamento de calha",
  installation_checklists: "Checklists de instalação", installations: "Instalações", lead_sources: "Origens", leads: "Funil",
  material_categories: "Categorias de material", materials: "Estoque (materiais)", measurement_checklists: "Checklists de medição",
  measurement_items: "Itens da medição", measurements: "Medições", message_templates: "Modelos de mensagem",
  order_aluminum_costs: "Custo do alumínio por pedido", order_checklist_items: "Itens do checklist do pedido",
  order_checklists: "Checklists do pedido", order_consumables: "Consumíveis do pedido", order_items: "Itens do pedido",
  order_labor_costs: "Mão de obra do pedido", order_measure_checks: "Conferência de medidas", order_operations: "Etapas do pedido",
  orders: "Pedidos", payment_receipts: "Comprovantes", payments: "Pagamentos", pipeline_stages: "Etapas do funil",
  pix_charges: "Cobranças Pix", post_sales: "Pós-venda", post_sale_photos: "Fotos do pós-venda",
  pricing_commercial_tables: "Tabelas comerciais", pricing_paints: "Preços de pintura", pricing_services: "Preços de serviços",
  pricing_special_parts: "Peças especiais", production_materials: "Materiais da produção", production_order_items: "Itens da produção",
  production_orders: "Produção", production_step_photos: "Fotos da produção", profiles: "Funcionários",
  purchase_order_items: "Itens da compra", purchase_orders: "Compras", purchase_request_items: "Itens da solicitação de compra",
  purchase_requests: "Solicitações de compra", purchase_returns: "Devoluções de compra", quick_replies: "Respostas rápidas",
  quote_internal_attachments: "Anexos do orçamento", quote_items: "Itens do orçamento", quotes: "Orçamentos",
  receiving_accounts: "Contas de recebimento", sale_items: "Itens da venda", sale_types: "Tipos de venda", sales: "Vendas",
  service_orders: "Serviços", service_photos: "Fotos do serviço", stock_locations: "Locais de estoque",
  stock_movements: "Movimentações de estoque", supplier_categories: "Categorias de fornecedor", supplier_credits: "Créditos de fornecedor",
  suppliers: "Fornecedores", tasks: "Tarefas", user_roles: "Cargos dos usuários", whatsapp_channels: "Canais do WhatsApp",
  whatsapp_channel_members: "Acesso aos canais do WhatsApp", work_days: "Agenda das equipes", work_day_jobs: "Serviços do dia",
  work_day_members: "Equipe do dia", work_planning: "Equipes e veículos", work_team_members: "Membros da equipe",
  work_teams: "Equipes", work_vehicles: "Veículos", workflows: "Fluxos de automação", companies: "Empresa",
  fiscal_classifications: "Classificação fiscal", fiscal_settings: "Configuração fiscal", trackceo_devices: "Rastreadores",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Nome", full_name: "Nome", phone: "Telefone", whatsapp: "WhatsApp", email: "E-mail", city: "Cidade", state: "Estado",
  address: "Endereço", neighborhood: "Bairro", postal_code: "CEP", tax_id: "CPF/CNPJ", notes: "Observações", status: "Status",
  description: "Descrição", amount: "Valor", total: "Total", total_amount: "Total", subtotal: "Subtotal", discount: "Desconto",
  quantity: "Quantidade", unit_price: "Preço unitário", price: "Preço", due_date: "Vencimento", paid_at: "Pago em",
  payment_method: "Forma de pagamento", scheduled_at: "Agendado para", code: "Código", sku: "Código", title: "Título",
  client_id: "Cliente", supplier_id: "Fornecedor", order_id: "Pedido", quote_id: "Orçamento", responsible_id: "Responsável",
  category_id: "Categoria", cost_center_id: "Centro de custo", valid_until: "Validade", type: "Tipo", kind: "Tipo",
  lead_source: "Origem", lead_source_id: "Origem", role: "Cargo", active: "Ativo", deleted_at: "Removido em",
};

const LINKS: Record<string, string> = {
  clients: "/clientes/", quotes: "/orcamentos/", sales: "/vendas/", purchase_orders: "/compras/", suppliers: "/fornecedores/",
  service_orders: "/servicos/", installations: "/instalacoes/", production_orders: "/producao/",
};

type LogEntry = {
  id: number; table_name: string; record_id: string | null; action: string; summary: string | null;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; created_at: string;
  profile: { full_name: string } | null;
};

export type HistoryFilters = { tabela?: string; usuario?: string; acao?: string; de?: string; ate?: string; busca?: string; pagina?: string };

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+([+-]\d{2}:?\d{2}|Z)?)?$/;
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "string") {
    if (UUID.test(v)) return "(vínculo alterado)";
    if (DATE.test(v)) return v.length === 10 ? v.split("-").reverse().join("/") : when(v);
    return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  if (typeof v === "number") return v.toLocaleString("pt-BR");
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

export function changedFields(log: Pick<LogEntry, "action" | "old_data" | "new_data">) {
  const o = log.old_data ?? {}, n = log.new_data ?? {};
  if (log.action !== "UPDATE" && log.action !== "EDIT") return [];
  return [...new Set([...Object.keys(o), ...Object.keys(n)])]
    .filter((k) => k !== "updated_at" && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => ({ field: FIELD_LABELS[k] ?? k.replace(/_/g, " "), before: formatValue(o[k]), after: formatValue(n[k]) }));
}

function recordLabel(log: LogEntry) {
  if (log.summary) return log.summary;
  const d = (log.new_data ?? log.old_data ?? {}) as Record<string, unknown>;
  for (const k of ["quote_number", "order_number", "number", "full_name", "name", "title", "description", "code"]) {
    if (typeof d[k] === "string" && d[k]) return String(d[k]);
  }
  return null;
}

const ACTION_FILTERS: Record<string, string[]> = { criou: ["INSERT", "CREATE"], alterou: ["UPDATE", "EDIT"], removeu: ["DELETE"] };

export async function AuditLogPage(props: HistoryFilters & { tableFilter?: string }) {
  const f: HistoryFilters = { ...props, tabela: props.tabela ?? props.tableFilter };
  const page = Math.max(1, Number(f.pagina) || 1);
  const db = await getRequestClient();

  let q = db.from("audit_logs")
    .select("id,table_name,record_id,action,summary,old_data,new_data,created_at,profile:profiles!audit_logs_profile_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE);
  if (f.tabela) q = q.eq("table_name", f.tabela);
  if (f.usuario === "sistema") q = q.is("profile_id", null);
  else if (f.usuario) q = q.eq("profile_id", f.usuario);
  if (f.acao && ACTION_FILTERS[f.acao]) q = q.in("action", ACTION_FILTERS[f.acao]);
  if (f.de && /^\d{4}-\d{2}-\d{2}$/.test(f.de)) q = q.gte("created_at", `${f.de}T00:00:00-03:00`);
  if (f.ate && /^\d{4}-\d{2}-\d{2}$/.test(f.ate)) q = q.lte("created_at", `${f.ate}T23:59:59.999-03:00`);
  const busca = f.busca?.trim().replace(/[%,()]/g, " ");
  if (busca) q = q.ilike("summary", `%${busca}%`);

  const [{ data, error }, { data: people }] = await Promise.all([
    q,
    db.from("profiles").select("id,full_name").order("full_name"),
  ]);
  const rows = (data ?? []) as unknown as LogEntry[];
  const hasMore = rows.length > PAGE;
  const logs = rows.slice(0, PAGE);
  const modules = Object.entries(TABLE_LABELS).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
    .filter(([k, v], i, all) => all.findIndex(([, w]) => w === v) === i || k === f.tabela);
  const link = (p: number) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, pagina: String(p) })) if (v) s.set(k, v);
    return `/auditoria?${s}`;
  };
  const input = "h-10 rounded-xl border border-sand bg-white px-3 text-sm";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <p className="text-xs font-semibold text-forest">Sistema</p>
        <h1 className="mt-2 text-3xl font-semibold">Histórico</h1>
        <p className="mt-1 text-sm text-ink/50">Quem criou, alterou ou removeu cada registro do sistema, com dia, hora e o que mudou.</p>
      </div>

      <form method="get" action="/auditoria" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filtros do histórico">
        <input name="busca" defaultValue={f.busca ?? ""} placeholder="Buscar (cliente, nº, descrição…)" aria-label="Buscar" className={`${input} lg:col-span-2`} />
        <select name="tabela" defaultValue={f.tabela ?? ""} aria-label="Módulo" className={input}>
          <option value="">Todos os módulos</option>
          {modules.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="usuario" defaultValue={f.usuario ?? ""} aria-label="Usuário" className={input}>
          <option value="">Todos os usuários</option>
          {(people ?? []).map((p: { id: string; full_name: string | null }) => <option key={p.id} value={p.id}>{p.full_name ?? "Sem nome"}</option>)}
          <option value="sistema">Sistema (automático)</option>
        </select>
        <select name="acao" defaultValue={f.acao ?? ""} aria-label="Ação" className={input}>
          <option value="">Todas as ações</option>
          <option value="criou">Criou</option>
          <option value="alterou">Alterou</option>
          <option value="removeu">Removeu</option>
        </select>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <label className="flex items-center gap-2 text-xs text-ink/60">De <input type="date" name="de" defaultValue={f.de ?? ""} className={input} /></label>
          <label className="flex items-center gap-2 text-xs text-ink/60">Até <input type="date" name="ate" defaultValue={f.ate ?? ""} className={input} /></label>
          <button className="ml-auto h-10 rounded-xl bg-brand-strong px-4 text-sm font-semibold text-white">Filtrar</button>
          <a href="/auditoria" className="flex h-10 items-center rounded-xl border border-sand px-4 text-sm font-semibold">Limpar</a>
        </div>
      </form>

      {error && <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar o histórico: {error.message}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-cream/50 text-left text-xs font-semibold text-ink/40">
              <th className="px-4 py-3">Data/Hora</th><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Módulo</th><th className="px-4 py-3">Registro</th><th className="px-4 py-3">O que mudou</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {logs.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-ink/40">Nenhum registro encontrado.</td></tr>}
            {logs.map((log) => {
              const act = ACTION_LABELS[log.action] ?? { label: log.action.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), color: "bg-sand text-ink/60" };
              const changes = changedFields(log);
              const label = recordLabel(log);
              const href = log.record_id && log.action !== "DELETE" && LINKS[log.table_name] ? LINKS[log.table_name] + log.record_id : null;
              return (
                <tr key={log.id} className="align-top hover:bg-cream/30">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink/60">{when(log.created_at)}</td>
                  <td className="px-4 py-3 font-medium">{log.profile?.full_name ?? "Sistema"}</td>
                  <td className="px-4 py-3"><span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-semibold ${act.color}`}>{act.label}</span></td>
                  <td className="px-4 py-3 text-ink/60">{TABLE_LABELS[log.table_name] ?? log.table_name}</td>
                  <td className="max-w-[14rem] px-4 py-3 [overflow-wrap:anywhere]">{href ? <a href={href} className="font-medium text-forest underline-offset-2 hover:underline">{label ?? "Abrir"}</a> : (label ?? "—")}</td>
                  <td className="px-4 py-3 text-xs text-ink/70">
                    {changes.length === 0 ? "—" : (
                      <ul className="space-y-0.5">
                        {changes.slice(0, 6).map((c) => <li key={c.field}><span className="font-semibold">{c.field}:</span> <span className="text-ink/45 line-through">{c.before}</span> → {c.after}</li>)}
                        {changes.length > 6 && <li className="text-ink/45">+ {changes.length - 6} campos</li>}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        {page > 1 ? <a href={link(page - 1)} className="rounded-xl border border-sand px-4 py-2 font-semibold">← Mais recentes</a> : <span />}
        <span className="text-ink/50">Página {page}</span>
        {hasMore ? <a href={link(page + 1)} className="rounded-xl border border-sand px-4 py-2 font-semibold">Mais antigos →</a> : <span />}
      </div>
    </div>
  );
}
