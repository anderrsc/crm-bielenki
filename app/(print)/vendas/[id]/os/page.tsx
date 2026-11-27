import { notFound } from "next/navigation";
import { getRequestClient } from "@/lib/supabase/server";
import { loadServiceOrder } from "@/lib/service-order";
import { ServiceOrderSheet } from "@/components/service-order-sheet";

export const metadata = { title: "Ordem de serviço — Marquinhos" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ novo?: string }> }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !process.env.NEXT_PUBLIC_SUPABASE_URL) notFound();
  const data = await loadServiceOrder(await getRequestClient(), id);
  if (!data) notFound();
  return <ServiceOrderSheet data={data} fresh={search.novo === "1"} />;
}
