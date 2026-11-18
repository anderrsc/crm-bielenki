// /compras/nova precisa de rota própria: /compras/[id] capturaria "nova".
import dynamic from "next/dynamic";
import { getRequestClient } from "@/lib/supabase/server";

const ManualPurchaseForm = dynamic(() => import("@/components/manual-purchase-form").then((m) => m.ManualPurchaseForm));

export default async function NewPurchasePage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const search = await searchParams;
  let suppliers: { id: string; name: string; credit?: number }[] = [];
  let orders: { id: string; label: string }[] = [];
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await getRequestClient();
    const [supplierResult, creditResult, orderResult] = await Promise.all([
      db.from("suppliers").select("id,name").eq("status", "ativo").order("name"),
      db.from("v_supplier_credit_balance").select("supplier_id,balance").gt("balance", 0),
      db.from("orders").select("id,order_number,client:clients(name)").not("operational_status", "in", "(finalizado,cancelado)").order("created_at", { ascending: false }).limit(300),
    ]);
    const credit = new Map(((creditResult.data ?? []) as { supplier_id: string; balance: number }[]).map((c) => [c.supplier_id, Number(c.balance)]));
    suppliers = ((supplierResult.data ?? []) as { id: string; name: string }[]).map((s) => ({ ...s, credit: credit.get(s.id) ?? 0 }));
    orders = ((orderResult.data ?? []) as unknown as { id: string; order_number: string; client: { name: string } | null }[]).map((o) => ({ id: o.id, label: `${o.order_number}${o.client?.name ? ` · ${o.client.name}` : ""}` }));
  }
  return <ManualPurchaseForm suppliers={suppliers} orders={orders} error={search.erro} />;
}
