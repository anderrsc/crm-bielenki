import { notFound } from "next/navigation";
import { getRequestClient } from "@/lib/supabase/server";
import { loadServiceOrder, type ServiceOrderSheet } from "@/lib/service-order";
import { ServiceOrderBatch } from "@/components/service-order-sheet";

export const metadata = { title: "Ordens de serviço — impressão" };

/** ?vendas=id1,id2,... — imprime as OS das vendas, 4 por folha A4, na ordem recebida. */
export default async function Page({ searchParams }: { searchParams: Promise<{ vendas?: string }> }) {
  const { vendas = "" } = await searchParams;
  const ids = [...new Set(vendas.split(",").map(s => s.trim()).filter(s => /^[0-9a-f-]{36}$/i.test(s)))].slice(0, 40);
  if (!ids.length || !process.env.NEXT_PUBLIC_SUPABASE_URL) notFound();
  const db = await getRequestClient();
  const list = (await Promise.all(ids.map(id => loadServiceOrder(db, id).catch(() => null)))).filter(Boolean) as ServiceOrderSheet[];
  if (!list.length) notFound();
  return <ServiceOrderBatch list={list} />;
}
