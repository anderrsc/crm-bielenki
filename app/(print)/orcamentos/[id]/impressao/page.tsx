import type { Metadata } from "next";
import { QuoteDocument } from "@/components/quote-document";
import { quoteFileBaseName } from "@/lib/quote-file-name";
import { getRequestClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = await getRequestClient();
  const { data } = await db.from("quotes").select("quote_number, client:clients(name)").eq("id", id).maybeSingle();
  const client = Array.isArray(data?.client) ? data?.client[0] : data?.client;
  // Vira o titulo do arquivo PDF: "Aline Tomaselli - ORC-2026-00044".
  return {
    title: { absolute: quoteFileBaseName((client as { name?: string } | null)?.name, String(data?.quote_number ?? "")) || "Orçamento" },
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
