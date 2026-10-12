import type { Metadata } from "next";
import { QuoteDocument } from "@/components/quote-document";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = await createClient();
  const { data } = await db.from("quotes").select("quote_number").eq("id", id).maybeSingle();
  return { title: data?.quote_number ? `Orçamento ${data.quote_number}` : "Orçamento" };
}

// Pagina so com a folha A4 do orcamento, fora do layout do CRM (sem menu,
// cabecalho e consultas do AppShell). E o que o Chromium headless renderiza
// para gerar o PDF (lib/generate-quote-pdf.ts).
export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteDocument id={id} printOnly />;
}
