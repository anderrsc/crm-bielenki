import type { SupabaseClient } from "@supabase/supabase-js";

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
