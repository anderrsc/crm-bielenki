import Link from "next/link";
import { getRequestClient } from "@/lib/supabase/server";
import { deadlineFrom, spDate } from "@/lib/service-order";
import { OsQueue, type OsRow } from "@/components/os-queue";
import { SERVICE_KINDS } from "@/lib/service-orders";

const FILTERS: Record<string, string> = { fila: "Na fila", impressas: "Impressas", todas: "Todas" };

export const metadata = { title: "Ordens de serviço — Marquinhos" };

export default async function Page({ searchParams }: { searchParams: Promise<{ filtro?: string; q?: string; ok?: string }> }) {
  const search = await searchParams;
  const filtro = search.filtro && FILTERS[search.filtro] ? search.filtro : "fila";
  const term = (search.q ?? "").trim().slice(0, 80).replace(/[,()*%\\]/g, " ").trim();
  const db = await getRequestClient();

  let query = db.from("orders")
    .select("id,order_number,sale_id,created_at,os_queued_at,os_printed_at,os_print_sent_at,installer_name,installer:profiles!orders_installer_id_fkey(full_name),client:clients(name,neighborhood,city),sale_type:sale_types(name),sale:sales!inner(sale_number,operational_status)")
    .neq("sale.operational_status", "cancelado").limit(80);
  if (filtro === "fila") query = query.not("os_queued_at", "is", null).is("os_printed_at", null).order("os_queued_at", { ascending: true });
  else if (filtro === "impressas") query = query.not("os_printed_at", "is", null).order("os_printed_at", { ascending: false });
  else query = query.order("created_at", { ascending: false });
  if (term) {
    const { data: found } = await db.from("clients").select("id").ilike("name", `%${term}%`).limit(200);
    query = query.in("client_id", (found ?? []).map(c => c.id).concat("00000000-0000-0000-0000-000000000000"));
  }
  const { data, error } = await query;
  const missing = error && /os_queued_at|os_printed_at|os_print_sent_at|installer/.test(error.message);

  // Prazo máximo: precisa do orçamento (data de aprovação + prazo escrito).
  const saleIds = (data ?? []).map(r => String(r.sale_id));
  const { data: quotes } = saleIds.length ? await db.from("quotes").select("sale_id,approved_at,installation_deadline").in("sale_id", saleIds) : { data: [] };
  const bySale = new Map((quotes ?? []).map(q => [String(q.sale_id), q]));

  const mapped: OsRow[] = (data ?? []).map(r => {
    const x = r as unknown as { id: string; order_number: string; sale_id: string; created_at: string; os_queued_at: string | null; os_printed_at: string | null; os_print_sent_at: string | null; installer_name: string | null; installer: { full_name: string | null } | null; client: { name: string; neighborhood: string | null; city: string | null } | null; sale_type: { name: string } | null };
    const q = bySale.get(x.sale_id);
    const closed = spDate(String(q?.approved_at ?? x.created_at));
    return {
      orderId: x.id, saleId: x.sale_id, number: x.order_number, client: x.client?.name ?? "Cliente",
      place: [x.client?.neighborhood, x.client?.city].filter(Boolean).join(" · "), service: x.sale_type?.name ?? "Serviço",
      installer: x.installer_name || x.installer?.full_name || null, closedAt: closed,
      deadline: deadlineFrom(closed, q?.installation_deadline as string | null) ?? (q?.installation_deadline as string | null) ?? null,
      printedAt: x.os_printed_at, unconfirmed: Boolean(x.os_print_sent_at) && !x.os_printed_at, queued: Boolean(x.os_queued_at) && !x.os_printed_at,
    };
  });
  // Manutenções e serviços avulsos seguem a mesma fila: em aberto até imprimir e confirmar.
  let serviceQuery = db.from("service_orders")
    .select("id,service_number,kind,description,opened_at,scheduled_at,expected_date,os_printed_at,os_print_sent_at,client:clients(name,neighborhood,city),responsible:profiles!service_orders_responsible_id_fkey(full_name)")
    .limit(80);
  if (filtro === "fila") serviceQuery = serviceQuery.not("status", "in", "(concluido,cancelado)").is("os_printed_at", null).order("created_at", { ascending: true });
  else if (filtro === "impressas") serviceQuery = serviceQuery.neq("status", "cancelado").not("os_printed_at", "is", null).order("os_printed_at", { ascending: false });
  else serviceQuery = serviceQuery.neq("status", "cancelado").order("created_at", { ascending: false });
  if (term) {
    const { data: found } = await db.from("clients").select("id").ilike("name", `%${term}%`).limit(200);
    serviceQuery = serviceQuery.in("client_id", (found ?? []).map(c => c.id).concat("00000000-0000-0000-0000-000000000000"));
  }
  const serviceResult = await serviceQuery;
  const servicesError = serviceResult.error
    ? /os_print/.test(serviceResult.error.message) ? "Falta aplicar a atualização do banco 20261127130000_fila_os_servicos.sql para as manutenções aparecerem." : "Não foi possível carregar as manutenções. Atualize a página."
    : "";
  const services: OsRow[] = (serviceResult.data ?? []).map(r => {
    const x = r as unknown as { id: string; service_number: string; kind: string; description: string; opened_at: string; scheduled_at: string | null; expected_date: string | null; os_printed_at: string | null; os_print_sent_at: string | null; client: { name: string; neighborhood: string | null; city: string | null } | null; responsible: { full_name: string | null } | null };
    return {
      serviceId: x.id, orderId: "", saleId: "", number: x.service_number, client: x.client?.name ?? "Cliente",
      place: [x.client?.neighborhood, x.client?.city].filter(Boolean).join(" · "), service: `${SERVICE_KINDS[x.kind] ?? x.kind} — ${x.description}`,
      installer: x.responsible?.full_name ?? null, closedAt: x.opened_at,
      deadline: x.scheduled_at ? spDate(x.scheduled_at) : x.expected_date, scheduled: Boolean(x.scheduled_at),
      printedAt: x.os_printed_at, unconfirmed: Boolean(x.os_print_sent_at) && !x.os_printed_at, queued: !x.os_printed_at,
    };
  });
  // Impressão não confirmada sempre no topo.
  const all = [...services, ...mapped];
  const rows = [...all.filter(r => r.unconfirmed), ...all.filter(r => !r.unconfirmed)];

  return <div className="mx-auto max-w-5xl space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="detail-kind">Operação</p><h1 className="text-2xl font-semibold">Ordens de serviço</h1>
        <p className="mt-1 text-sm text-ink/60">Todo pedido fechado e toda manutenção aberta entram na fila. Marque até 4 e imprima numa folha A4.</p></div>
    </header>
    <nav className="flex flex-wrap gap-2" aria-label="Filtro">
      {Object.entries(FILTERS).map(([k, label]) => <Link key={k} href={`/ordens-servico?filtro=${k}${term ? `&q=${encodeURIComponent(term)}` : ""}`} className={k === filtro ? "button" : "button-ghost"}>{label}</Link>)}
      <form className="ml-auto flex gap-2" action="/ordens-servico"><input type="hidden" name="filtro" value={filtro} /><input name="q" defaultValue={term} placeholder="Buscar cliente" className="field p-2 text-sm" /><button className="button-ghost">Buscar</button></form>
    </nav>
    {search.ok && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{search.ok.slice(0, 200)}</p>}
    {servicesError && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{servicesError}</p>}
    {missing ?<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Falta aplicar a atualização do banco 20261127120000_fila_ordens_servico.sql para a fila funcionar.</p>
      : error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar as ordens de serviço.</p>
      : <OsQueue rows={rows} filtro={filtro} />}
  </div>;
}
