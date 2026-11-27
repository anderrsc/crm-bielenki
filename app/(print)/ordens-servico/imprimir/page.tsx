import { notFound } from "next/navigation";
import { getRequestClient } from "@/lib/supabase/server";
import { loadServiceCalls, loadServiceOrder, type ServiceOrderSheet } from "@/lib/service-order";
import { ServiceOrderBatch } from "@/components/service-order-sheet";

export const metadata = { title: "Ordens de serviço — impressão" };

const idList = (value: string) => [...new Set(value.split(",").map(s => s.trim()).filter(s => /^[0-9a-f-]{36}$/i.test(s)))].slice(0, 40);

/** ?vendas=id1,id2&servicos=id3 — imprime as OS de pedidos e de serviços, 4 por folha A4. */
export default async function Page({ searchParams }: { searchParams: Promise<{ vendas?: string; servicos?: string }> }) {
  const { vendas = "", servicos = "" } = await searchParams;
  const ids = idList(vendas), serviceIds = idList(servicos);
  if ((!ids.length && !serviceIds.length) || !process.env.NEXT_PUBLIC_SUPABASE_URL) notFound();
  const db = await getRequestClient();
  const [orders, services] = await Promise.all([
    Promise.all(ids.map(id => loadServiceOrder(db, id).catch(() => null))),
    loadServiceCalls(db, serviceIds),
  ]);
  const list = orders.filter(Boolean) as ServiceOrderSheet[];
  if (!list.length && !services.length) notFound();
  return <ServiceOrderBatch list={list} services={services} />;
}
