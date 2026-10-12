import { QuoteDocument } from "@/components/quote-document";

// Pagina so com a folha A4 do orcamento, fora do layout do CRM (sem menu,
// cabecalho e consultas do AppShell). E o que o Chromium headless renderiza
// para gerar o PDF (lib/generate-quote-pdf.ts).
export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteDocument id={id} printOnly />;
}
