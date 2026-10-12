import { headers } from "next/headers";
import { after } from "next/server";
import { generateQuotePdfBuffer } from "@/lib/generate-quote-pdf";

type Db = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type PdfRequestContext = { origin: string; host: string; cookieHeader: string };

export function quotePdfPath(companyId: string, quoteId: string) {
  return `${companyId}/${quoteId}.pdf`;
}

export function isQuotePdfFresh(quote: { pdf_generated_at: string | null; updated_at: string }) {
  return Boolean(quote.pdf_generated_at && new Date(quote.pdf_generated_at) >= new Date(quote.updated_at));
}

// Geracoes em andamento nesta instancia, para nao abrir duas vezes o mesmo
// orcamento no Chromium (ex.: pre-geracao + clique em "Baixar PDF").
const inFlight = new Map<string, Promise<Buffer>>();

// Gera o PDF, grava no bucket quote-pdfs e marca quotes.pdf_generated_at.
export function generateAndCacheQuotePdf(db: Db, quoteId: string, companyId: string, ctx: PdfRequestContext): Promise<Buffer> {
  const running = inFlight.get(quoteId);
  if (running) return running;
  const job = (async () => {
    const startedAt = new Date().toISOString();
    const pdf = await generateQuotePdfBuffer({ ...ctx, quoteId });
    const path = quotePdfPath(companyId, quoteId);
    const { error: uploadError } = await db.storage
      .from("quote-pdfs")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) {
      console.error("Erro ao cachear PDF do orcamento no storage:", path, uploadError);
      return pdf;
    }
    // Marca com o horario de inicio: se o orcamento for editado durante a
    // geracao, updated_at fica maior e o cache e refeito no proximo download.
    const { error: updateError } = await db.from("quotes").update({ pdf_generated_at: startedAt }).eq("id", quoteId);
    if (updateError) console.error("Erro ao marcar pdf_generated_at:", updateError);
    return pdf;
  })().finally(() => inFlight.delete(quoteId));
  inFlight.set(quoteId, job);
  return job;
}

// Garante que o PDF em cache esta atualizado (usado em segundo plano).
export async function ensureQuotePdfCached(db: Db, quoteId: string, ctx: PdfRequestContext) {
  const { data: quote, error } = await db
    .from("quotes")
    .select("id, company_id, updated_at, pdf_generated_at")
    .eq("id", quoteId)
    .single();
  if (error || !quote) {
    console.error("Pre-geracao de PDF: orcamento nao encontrado", quoteId, error);
    return;
  }
  if (isQuotePdfFresh(quote)) return;
  await generateAndCacheQuotePdf(db, quoteId, quote.company_id, ctx);
}

export async function requestContextFromHeaders(): Promise<PdfRequestContext> {
  const hdrs = await headers();
  const host = hdrs.get("host") || "";
  return {
    host: host.split(":")[0],
    origin: `${hdrs.get("x-forwarded-proto") || "https"}://${host}`,
    cookieHeader: hdrs.get("cookie") || "",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ao abrir um orcamento, deixa o PDF pronto em segundo plano: quando o
// usuario clicar em "Baixar PDF" ele ja sai direto do storage.
export async function scheduleQuotePdfPrewarm(quoteId: string) {
  if (!UUID_RE.test(quoteId) || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const ctx = await requestContextFromHeaders();
  const { createClient } = await import("@/lib/supabase/server");
  const db = await createClient();
  after(() => ensureQuotePdfCached(db, quoteId, ctx).catch((e) => console.error("Erro ao pre-gerar PDF do orcamento:", e)));
}
