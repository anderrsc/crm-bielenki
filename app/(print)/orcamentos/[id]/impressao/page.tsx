import type { Metadata } from "next";
import { QuoteDocument } from "@/components/quote-document";
import { getRequestClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = await getRequestClient();
  const { data } = await db.from("quotes").select("quote_number").eq("id", id).maybeSingle();
  // Vira o titulo do arquivo PDF: identifica a proposta como da Marquinhos.
  return {
    title: { absolute: `Orçamento ${data?.quote_number ?? ""} · Proposta Marquinhos Calhas e Esquadrias`.replace("  ", " ") },
    authors: [{ name: "Marquinhos Calhas e Esquadrias" }],
  };
}

// Pagina so com a folha A4 do orcamento, fora do layout do CRM (sem menu,
// cabecalho e consultas do AppShell). E o que o Chromium headless renderiza
// para gerar o PDF (lib/generate-quote-pdf.ts).
export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteDocument id={id} printOnly />;
}
