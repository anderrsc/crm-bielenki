import type { SupabaseClient } from "@supabase/supabase-js";
import { SERVICE_KINDS, SERVICE_PRIORITY } from "@/lib/service-orders";
import { money } from "@/lib/utils";

/** Ordem de serviço: cópia resumida do pedido para a equipe (1/4 de A4). */
export type ServiceOrderSheet = {
  saleId: string;
  orderId: string | null;
  number: string;
  saleNumber: string;
  companyName: string;
  client: { name: string; phone: string | null; address: string | null; neighborhood: string | null; city: string | null; state: string | null; postal_code: string | null };
  serviceType: string;
  items: { product: string; description: string | null; quantity: number; unit: string }[];
  measurer: string | null;
  installerId: string | null;
  installerName: string | null;
  installer: string | null;
  closedAt: string;
  deadlineText: string | null;
  deadlineDate: string | null;
  notes: string | null;
  people: { id: string; full_name: string | null }[];
  canEdit: boolean;
  installerColumn: boolean;
  queuedAt: string | null;
  printedAt: string | null;
  printSentAt: string | null;
};

/** OS de manutenção, reparo, garantia ou visita (módulo Serviços): mesmo 1/4 de A4. */
export type ServiceCallSheet = {
  serviceId: string;
  number: string;
  companyName: string;
  client: ServiceOrderSheet["client"];
  serviceType: string;
  description: string;
  responsible: string | null;
  openedAt: string;
  scheduledAt: string | null;
  expectedDate: string | null;
  priority: string;
  billing: string;
  printedAt: string | null;
  printSentAt: string | null;
};

export async function loadServiceCalls(db: SupabaseClient, ids: string[]): Promise<ServiceCallSheet[]> {
  if (!ids.length) return [];
  const { data, error } = await db.from("service_orders")
    .select("id,company_id,service_number,kind,priority,description,opened_at,scheduled_at,expected_date,team,phone,address,neighborhood,city,billing,expected_amount,final_amount,client:clients(name,phone,whatsapp,address,neighborhood,city,state,postal_code),responsible:profiles!service_orders_responsible_id_fkey(full_name)")
    .in("id", ids);
  if (error || !data?.length) return [];
  const rows = data as unknown as Row[];
  // Consulta à parte: sem a atualização do banco a OS continua imprimindo, só não controla a fila.
  const print = await db.from("service_orders").select("id,os_printed_at,os_print_sent_at").in("id", ids);
  const state = new Map(((print.data ?? []) as Row[]).map(p => [String(p.id), p]));
  const { data: company } = await db.from("companies").select("name,trade_name").eq("id", String(rows[0].company_id)).maybeSingle();
  const companyName = String((company as Row | null)?.trade_name || (company as Row | null)?.name || "Marquinhos Calhas e Esquadrias");
  const text = (v: unknown) => (v ? String(v) : null);
  const sheets = rows.map((s): ServiceCallSheet => {
    const c = (s.client ?? {}) as Row;
    // Endereço próprio do serviço (obra diferente do cadastro): não mistura bairro, cidade e CEP do cliente.
    const own = text(s.address);
    const from = own && own !== text(c.address) ? s : c;
    const amount = Number(s.final_amount ?? s.expected_amount ?? 0);
    return {
      serviceId: String(s.id), number: String(s.service_number), companyName,
      client: {
        name: String(c.name ?? "Cliente"), phone: text(s.phone) ?? text(c.whatsapp) ?? text(c.phone),
        address: own ?? text(c.address), neighborhood: text(s.neighborhood) ?? text(from.neighborhood),
        city: text(s.city) ?? text(from.city), state: text(from.state), postal_code: text(from.postal_code),
      },
      serviceType: SERVICE_KINDS[String(s.kind)] ?? String(s.kind),
      description: String(s.description ?? ""),
      responsible: [(s.responsible as Row | null)?.full_name, s.team].filter(Boolean).join(" · ") || null,
      openedAt: String(s.opened_at), scheduledAt: text(s.scheduled_at), expectedDate: text(s.expected_date),
      priority: SERVICE_PRIORITY[String(s.priority)] ?? "Normal",
      billing: s.billing === "gratuito" ? "Gratuito" : amount > 0 ? `A cobrar ${money(amount)}` : "A cobrar",
      printedAt: text(state.get(String(s.id))?.os_printed_at), printSentAt: text(state.get(String(s.id))?.os_print_sent_at),
    };
  });
  // Mantém a ordem pedida na tela (a consulta não garante).
  return sheets.sort((a, b) => ids.indexOf(a.serviceId) - ids.indexOf(b.serviceId));
}

const ISO = (d: Date) => d.toISOString().slice(0, 10);

/** Data de fechamento no fuso de SP (yyyy-mm-dd). */
export function spDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/**
 * Converte o prazo escrito no orçamento ("Até 15 dias", "30 dias úteis", "2 semanas", "1 mês")
 * na data máxima a partir do fechamento. Sem número ("A combinar") devolve null.
 */
export function deadlineFrom(closedIso: string, text: string | null | undefined): string | null {
  const t = String(text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const m = t.match(/(\d{1,3})\s*(dias?|semanas?|mes(?:es)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  const d = new Date(`${closedIso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || !n) return null;
  if (m[2].startsWith("semana")) d.setUTCDate(d.getUTCDate() + n * 7);
  else if (m[2].startsWith("mes")) d.setUTCMonth(d.getUTCMonth() + n);
  else if (/uteis/.test(t)) {
    let left = n;
    while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) left--; }
  } else d.setUTCDate(d.getUTCDate() + n);
  return ISO(d);
}

type Row = Record<string, unknown>;

export async function loadServiceOrder(db: SupabaseClient, saleId: string): Promise<ServiceOrderSheet | null> {
  const { data: sale } = await db.from("sales")
    .select("id,company_id,sale_number,created_at,notes,client:clients(name,phone,whatsapp,address,neighborhood,city,state,postal_code),sale_type:sale_types(name)")
    .eq("id", saleId).maybeSingle();
  if (!sale) return null;
  const s = sale as unknown as Row & { client: Row | null; sale_type: { name: string } | null };
  const company = String(s.company_id);

  let installerColumn = true;
  let orderRes = await db.from("orders").select("id,order_number,installer_id,installer_name,os_queued_at,os_printed_at,os_print_sent_at").eq("sale_id", saleId).eq("company_id", company).maybeSingle();
  if (orderRes.error && /os_|installer/.test(orderRes.error.message)) {
    orderRes = await db.from("orders").select("id,order_number,installer_id,installer_name").eq("sale_id", saleId).eq("company_id", company).maybeSingle() as typeof orderRes;
  }
  if (orderRes.error && /installer/.test(orderRes.error.message)) {
    installerColumn = false; // migration 20261127100000 ainda não aplicada
    orderRes = await db.from("orders").select("id,order_number").eq("sale_id", saleId).eq("company_id", company).maybeSingle() as typeof orderRes;
  }
  const order = (orderRes.data ?? null) as Row | null;

  const [quoteRes, itemsRes, peopleRes, companyRes, canEditRes] = await Promise.all([
    db.from("quotes").select("quote_number,approved_at,installation_deadline,measurer_name,notes,measurer:profiles!quotes_measurer_id_fkey(full_name)").eq("sale_id", saleId).eq("company_id", company).maybeSingle(),
    order ? db.from("order_items").select("product,description,quantity,unit").eq("order_id", String(order.id)).order("id") : db.from("sale_items").select("product,description,quantity,unit").eq("sale_id", saleId).order("id"),
    db.from("profiles").select("id,full_name").eq("status", "ativo").order("full_name"),
    db.from("companies").select("name,trade_name").eq("id", company).maybeSingle(),
    db.rpc("has_table_access", { resource: "orders", action: "update" }),
  ]);
  // Se o nome da FK for outro, tenta sem o medidor do perfil.
  let quote = (quoteRes.data ?? null) as (Row & { measurer?: { full_name: string | null } | null }) | null;
  if (quoteRes.error) {
    const retry = await db.from("quotes").select("quote_number,approved_at,installation_deadline,measurer_id,measurer_name,notes").eq("sale_id", saleId).eq("company_id", company).maybeSingle();
    quote = (retry.data ?? null) as typeof quote;
    if (quote?.measurer_id) {
      const p = await db.from("profiles").select("full_name").eq("id", String(quote.measurer_id)).maybeSingle();
      quote = { ...quote, measurer: p.data as { full_name: string | null } | null };
    }
  }

  const people = (peopleRes.data ?? []) as ServiceOrderSheet["people"];
  const installerId = (order?.installer_id as string | null) ?? null;
  const installerName = (order?.installer_name as string | null) ?? null;
  let installer = installerName;
  if (!installer && installerId) {
    installer = people.find(p => p.id === installerId)?.full_name ?? null;
    if (!installer) installer = ((await db.from("profiles").select("full_name").eq("id", installerId).maybeSingle()).data?.full_name as string | null) ?? null;
  }

  const closedAt = spDate(String(quote?.approved_at ?? s.created_at));
  const deadlineText = (quote?.installation_deadline as string | null) ?? null;
  const c = s.client ?? {};
  const co = (companyRes.data ?? {}) as Row;
  return {
    saleId, orderId: (order?.id as string) ?? null,
    number: String(order?.order_number ?? s.sale_number), saleNumber: String(s.sale_number),
    companyName: String(co.trade_name || co.name || "Marquinhos Calhas e Esquadrias"),
    client: {
      name: String(c.name ?? "Cliente"), phone: (c.whatsapp || c.phone || null) as string | null,
      address: (c.address ?? null) as string | null, neighborhood: (c.neighborhood ?? null) as string | null,
      city: (c.city ?? null) as string | null, state: (c.state ?? null) as string | null, postal_code: (c.postal_code ?? null) as string | null,
    },
    serviceType: s.sale_type?.name ?? "Serviço",
    items: ((itemsRes.data ?? []) as Row[]).map(i => ({ product: String(i.product ?? ""), description: (i.description ?? null) as string | null, quantity: Number(i.quantity ?? 0), unit: String(i.unit ?? "un") })),
    measurer: (quote?.measurer_name as string | null) || quote?.measurer?.full_name || null,
    installerId, installerName, installer,
    closedAt, deadlineText, deadlineDate: deadlineFrom(closedAt, deadlineText),
    notes: ((quote?.notes ?? s.notes) as string | null) || null,
    people, canEdit: canEditRes.data === true && Boolean(order), installerColumn,
    queuedAt: (order?.os_queued_at as string | null) ?? null, printedAt: (order?.os_printed_at as string | null) ?? null, printSentAt: (order?.os_print_sent_at as string | null) ?? null,
  };
}
