import { createClient } from "@/lib/supabase/server";
import { PrintSheet } from "@/components/print-sheet";

export default async function FichaEmBrancoPage() {
  const db = await createClient();
  const res = await db.from("profiles").select("company:companies(trade_name,name,tax_id,phone,whatsapp,email,website,address,neighborhood,city,state,logo_url,primary_color)").single();
  const company = (res.data?.company ?? {}) as Parameters<typeof PrintSheet>[0]["company"];
  return <PrintSheet company={company} />;
}
