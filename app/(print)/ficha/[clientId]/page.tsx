import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { PrintSheet } from "@/components/print-sheet";

export default async function FichaClientePage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const db = await createClient();
  const [clientRes, companyRes] = await Promise.all([
    db.from("clients").select("name,phone,whatsapp,neighborhood,city,state,address").eq("id", clientId).single(),
    db.from("profiles").select("company:companies(trade_name,name,tax_id,phone,whatsapp,email,website,address,neighborhood,city,state,logo_url,primary_color)").single(),
  ]);
  if (!clientRes.data) return notFound();
  const company = (companyRes.data?.company ?? {}) as Parameters<typeof PrintSheet>[0]["company"];
  return <PrintSheet client={clientRes.data} company={company} />;
}
