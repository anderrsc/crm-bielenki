import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAndCacheQuotePdf, isQuotePdfFresh, quotePdfPath } from "@/lib/quote-pdf-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

function pdfResponse(body: Uint8Array, quoteNumber: string) {
  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="orcamento-${quoteNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// Serve o PDF do orcamento. Caminho comum: o PDF ja foi pre-gerado em
// segundo plano (ao salvar ou ao abrir o orcamento) e vem pronto do storage,
// sem abrir Chromium. So gera na hora se o cache nao existir ou estiver
// desatualizado (orcamento editado depois da ultima geracao).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await createClient();
  const { data: quote, error } = await db
    .from("quotes")
    .select("id, quote_number, company_id, updated_at, pdf_generated_at")
    .eq("id", id)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Orcamento nao encontrado" }, { status: 404 });
  }

  if (isQuotePdfFresh(quote)) {
    const { data: file } = await db.storage.from("quote-pdfs").download(quotePdfPath(quote.company_id, id));
    if (file) return pdfResponse(new Uint8Array(await file.arrayBuffer()), quote.quote_number);
  }

  try {
    const pdf = await generateAndCacheQuotePdf(db, id, quote.company_id, {
      origin: request.nextUrl.origin,
      host: request.nextUrl.hostname,
      cookieHeader: request.headers.get("cookie") ?? "",
    });
    return pdfResponse(new Uint8Array(pdf), quote.quote_number);
  } catch (err) {
    console.error("Erro ao gerar PDF do orcamento:", err);
    return NextResponse.json({ error: "Erro ao gerar PDF" }, { status: 500 });
  }
}
