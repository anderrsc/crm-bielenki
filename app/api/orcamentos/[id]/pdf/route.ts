import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateQuotePdfBuffer } from "@/lib/generate-quote-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

// Gera o PDF do orcamento. Se ja existe um PDF em cache no storage e ele
// nao ficou desatualizado (o orcamento nao foi editado depois de gerado),
// serve o arquivo pronto direto do storage — sem abrir Chromium. Isso e o
// caminho comum, ja que o PDF e pre-gerado em segundo plano assim que o
// orcamento e salvo (ver schedulePdfPregeneration em actions.ts). So cai
// para a geracao na hora se o cache nao existir ou estiver desatualizado.
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

  const storagePath = `${quote.company_id}/${id}.pdf`;
  const cacheFresh =
    quote.pdf_generated_at && new Date(quote.pdf_generated_at) >= new Date(quote.updated_at);

  if (cacheFresh) {
    const { data: file } = await db.storage.from("quote-pdfs").download(storagePath);
    if (file) {
      const buf = new Uint8Array(await file.arrayBuffer());
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="orcamento-${quote.quote_number}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const origin = request.nextUrl.origin;
  const host = request.nextUrl.hostname;
  const cookieHeader = request.headers.get("cookie") ?? "";

  try {
    const pdfBuffer = await generateQuotePdfBuffer({ origin, quoteId: id, cookieHeader, host });

    const { error: uploadError } = await db.storage
      .from("quote-pdfs")
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (!uploadError) {
      await db.from("quotes").update({ pdf_generated_at: new Date().toISOString() }).eq("id", id);
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="orcamento-${quote.quote_number}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Erro ao gerar PDF do orcamento:", err);
    return NextResponse.json({ error: "Erro ao gerar PDF" }, { status: 500 });
  }
}
