import { createClient } from "@/lib/supabase/server";
import { selectOwnProfile } from "@/lib/own-profile";
import { PrintSheet } from "@/components/print-sheet";

export default async function FichaEmBrancoPage({
  searchParams,
}: {
  searchParams: Promise<{ qty?: string }>;
}) {
  const { qty: qtyStr } = await searchParams;
  const qty = Math.min(100, Math.max(1, Number(qtyStr ?? 1) || 1));

  const db = await createClient();
  const res = await selectOwnProfile<{ company: unknown }>(db, "company:companies(trade_name,name,tax_id,phone,whatsapp,email,website,address,neighborhood,city,state,logo_url,primary_color)");
  const company = (res.data?.company ?? {}) as Parameters<typeof PrintSheet>[0]["company"];

  return <PrintSheet company={company} qty={qty} />;
}
