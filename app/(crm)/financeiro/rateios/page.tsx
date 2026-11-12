import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getRequestClient } from "@/lib/supabase/server";
import { money, shortDate } from "@/lib/utils";
import { friendlyError } from "@/lib/friendly-error";
import { FinancialAllocationForm, type AllocationRow } from "@/components/financial-allocation-form";

type Entry = { id: string; description: string; entry_type: "pagar" | "receber"; total_amount: number; due_date: string | null; status: string };
type OrderResult = { order_id: string; order_number: string; client_name: string | null; contracted: number; received: number; receivable: number; extra_revenue: number; cost_total: number; cost_paid: number; margin: number };

export default async function FinancialAllocationsPage({ searchParams }: { searchParams: Promise<{ conta?: string; q?: string; erro?: string; salvo?: string }> }) {
  const search = await searchParams;
  const db = await getRequestClient();
  const { data: allowed, error: permissionError } = await db.rpc("has_table_access", { resource: "financial_entries", action: "update" });
  if (permissionError) return <p role="alert">Não foi possível verificar suas permissões. Atualize a página.</p>;
  const error = search.erro ? friendlyError(search.erro)?.slice(0, 250) : undefined;

  if (search.conta) {
    if (!z.uuid().safeParse(search.conta).success) notFound();
    const [entryResult, allocResult, orderResult, centerResult] = await Promise.all([
      db.from("financial_entries").select("id,description,entry_type,total_amount,due_date,status").eq("id", search.conta).maybeSingle(),
      db.from("financial_entry_allocations").select("order_id,cost_center_id,amount").eq("entry_id", search.conta).order("created_at"),
      db.from("orders").select("id,order_number,client:clients(name)").order("created_at", { ascending: false }).limit(300),
      db.from("financial_cost_centers").select("id,name").eq("active", true).order("name"),
    ]);
    if (entryResult.error || allocResult.error) return <p role="alert">Não foi possível carregar a conta. Atualize a página.</p>;
    if (!entryResult.data) notFound();
    const entry = entryResult.data as Entry;
    const initial: AllocationRow[] = (allocResult.data ?? []).map((r) => ({ order_id: r.order_id ?? "", cost_center_id: r.cost_center_id ?? "", amount: Number(r.amount) }));
    const orders = ((orderResult.data ?? []) as unknown as { id: string; order_number: string; client: { name?: string } | null }[])
      .map((o) => ({ id: o.id, name: `${o.order_number}${o.client?.name ? ` · ${o.client.name}` : ""}` }));
    return <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/financeiro/rateios" className="text-sm font-bold text-forest underline">Voltar aos rateios</Link>
      <h1 className="text-3xl font-black">Ratear conta</h1>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
      {search.salvo === "1" && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">Rateio salvo.</p>}
      <section className="card space-y-4 p-5">
        <h2 className="text-xl font-bold">{entry.description}</h2>
        <p>Conta a {entry.entry_type} · <strong>{money(entry.total_amount)}</strong>{entry.due_date ? ` · vence ${shortDate(entry.due_date)}` : ""}</p>
        <p className="text-sm text-ink/65">Divida a conta entre obras e centros de custos. A soma precisa fechar exatamente o total; no percentual, a última linha recebe a sobra dos centavos.</p>
        {allowed === true && entry.status !== "cancelado"
          ? <FinancialAllocationForm entryId={entry.id} total={Number(entry.total_amount)} orders={orders} centers={centerResult.data ?? []} initial={initial} />
          : <p role="status">{entry.status === "cancelado" ? "Conta cancelada não pode ser rateada." : "Você não tem permissão para ratear contas."}</p>}
      </section>
    </div>;
  }

  const term = (search.q ?? "").trim().slice(0, 80).replace(/[,()*%\\]/g, " ").trim();
  let entryQuery = db.from("v_financial_entries").select("id,description,entry_type,total_amount,due_date,status,client_name,supplier_name").neq("status", "cancelado").order("due_date", { ascending: false }).limit(40);
  if (term) entryQuery = entryQuery.or(`description.ilike.*${term}*,client_name.ilike.*${term}*,supplier_name.ilike.*${term}*`);
  const [entriesResult, allocatedResult, resultsResult] = await Promise.all([
    entryQuery,
    db.from("financial_entry_allocations").select("entry_id"),
    db.from("v_order_financials").select("*").order("order_number", { ascending: false }).limit(100),
  ]);
  if (entriesResult.error || resultsResult.error) return <p role="alert">Não foi possível carregar os rateios. Atualize a página.</p>;
  const allocated = new Set((allocatedResult.data ?? []).map((r) => r.entry_id));
  const entries = (entriesResult.data ?? []) as (Entry & { client_name: string | null; supplier_name: string | null })[];
  const results = (resultsResult.data ?? []) as OrderResult[];
  return <div className="mx-auto max-w-6xl space-y-5">
    <Link href="/financeiro" className="text-sm font-bold text-forest underline">Voltar ao financeiro</Link>
    <h1 className="text-3xl font-black">Rateios por obra</h1>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    <section className="card space-y-3 p-5">
      <h2 className="text-xl font-bold">Contas</h2>
      <form method="get" className="flex flex-wrap gap-2"><input className="field max-w-sm" name="q" defaultValue={search.q ?? ""} placeholder="Buscar por descrição, cliente ou fornecedor" /><button className="button-ghost">Buscar</button></form>
      <div className="overflow-x-auto"><table className="mobile-record-table w-full min-w-[640px] text-sm">
        <thead><tr className="border-b text-left text-xs font-bold uppercase tracking-wider text-ink/40"><th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Parte</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Rateio</th><th className="px-3 py-2" /></tr></thead>
        <tbody className="divide-y">
          {!entries.length && <tr><td colSpan={6} className="p-6 text-center text-ink/45">Nenhuma conta encontrada.</td></tr>}
          {entries.map((e) => <tr key={e.id}>
            <td data-label="Descrição" className="px-3 py-2 font-medium">{e.description}</td>
            <td data-label="Tipo" className="px-3 py-2">{e.entry_type === "pagar" ? "Pagar" : "Receber"}</td>
            <td data-label="Parte" className="px-3 py-2 text-ink/60">{e.client_name || e.supplier_name || "—"}</td>
            <td data-label="Total" className="px-3 py-2 text-right font-semibold">{money(e.total_amount)}</td>
            <td data-label="Rateio" className="px-3 py-2">{allocated.has(e.id) ? "Rateada" : "Sem rateio"}</td>
            <td className="px-3 py-2"><Link className="font-bold text-forest underline" href={`/financeiro/rateios?conta=${e.id}`}>{allocated.has(e.id) ? "Editar rateio" : "Ratear"}</Link></td>
          </tr>)}
        </tbody>
      </table></div>
    </section>
    <section className="card space-y-3 p-5">
      <h2 className="text-xl font-bold">Resultado por obra</h2>
      <p className="text-sm text-ink/65">Custos = contas a pagar rateadas para a obra, mais as contas sem rateio ligadas à venda. Nenhuma conta é contada duas vezes.</p>
      <div className="overflow-x-auto"><table className="mobile-record-table w-full min-w-[720px] text-sm">
        <thead><tr className="border-b text-left text-xs font-bold uppercase tracking-wider text-ink/40"><th className="px-3 py-2">Obra</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2 text-right">Contratado</th><th className="px-3 py-2 text-right">Recebido</th><th className="px-3 py-2 text-right">Custos</th><th className="px-3 py-2 text-right">Custos pagos</th><th className="px-3 py-2 text-right">Margem</th></tr></thead>
        <tbody className="divide-y">
          {!results.length && <tr><td colSpan={7} className="p-6 text-center text-ink/45">Nenhuma obra ainda.</td></tr>}
          {results.map((r) => <tr key={r.order_id}>
            <td data-label="Obra" className="px-3 py-2 font-medium">{r.order_number}</td>
            <td data-label="Cliente" className="px-3 py-2 text-ink/60">{r.client_name ?? "—"}</td>
            <td data-label="Contratado" className="px-3 py-2 text-right">{money(Number(r.contracted) + Number(r.extra_revenue))}</td>
            <td data-label="Recebido" className="px-3 py-2 text-right">{money(r.received)}</td>
            <td data-label="Custos" className="px-3 py-2 text-right">{money(r.cost_total)}</td>
            <td data-label="Custos pagos" className="px-3 py-2 text-right">{money(r.cost_paid)}</td>
            <td data-label="Margem" className={`px-3 py-2 text-right font-bold ${Number(r.margin) < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(r.margin)}</td>
          </tr>)}
        </tbody>
      </table></div>
    </section>
  </div>;
}
