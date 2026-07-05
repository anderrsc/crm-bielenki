import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";
import { createClient } from "@/lib/supabase/server";


const CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";
export const runtime = "nodejs";
export const maxDuration = 60;

// Reaproveita o Chromium headless e o caminho do executavel entre chamadas
// na mesma instancia (lambda "quente"). Lancar o Chromium do zero (baixar o
// pack remoto + subir o processo) e o maior custo de tempo na geracao do
// PDF; nas invocacoes subsequentes da mesma instancia isso cai a zero.
let browserPromise: Promise<import("puppeteer-core").Browser> | null = null;

async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.connected) return existing;
    browserPromise = null;
  }
  browserPromise = (async () => {
    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL);
    return puppeteer.launch({
      args: chromium.args,
      // A4 (210mm x 297mm) a 96 CSS DPI = 794 x 1123 px. Um viewport
      // fora dessa proporcao faz o Chromium renderizar o conteudo em
      // outra escala antes de encaixar na folha A4 do PDF, distorcendo
      // qualquer medida em mm (ex.: o ladrilho da marca d'agua).
      defaultViewport: { width: 794, height: 1123 },
      executablePath,
      headless: true,
    });
  })();
  return browserPromise;
}

// Gera o PDF do orcamento renderizando a propria pagina do sistema em um
// Chromium headless no servidor (mesmo motor do navegador), com
// emulateMediaType("print"). Isso garante que o PDF fique sempre identico
// ao que aparece na tela, sem depender do driver de impressao/PDF do
// computador do usuario (que pode alterar cores, margens e paginacao).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

  const db = await createClient();
    const { data: quote, error } = await db
      .from("quotes")
      .select("id, quote_number")
      .eq("id", id)
      .single();

  if (error || !quote) {
        return NextResponse.json({ error: "Orcamento nao encontrado" }, { status: 404 });
  }

  const origin = request.nextUrl.origin;
    const host = request.nextUrl.hostname;
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookies = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
              const idx = c.indexOf("=");
              return { name: c.slice(0, idx), value: c.slice(idx + 1), domain: host, path: "/" };
      });

  let page: import("puppeteer-core").Page | undefined;
    try {
          const browser = await getBrowser();
      page = await browser.newPage();
          if (cookies.length > 0) {
                  await page.setCookie(...cookies);
          }

      // "load" (em vez de "networkidle0") + a espera explicita pelas imagens
      // abaixo e suficiente: os dados do orcamento ja vem prontos no HTML
      // (server component), entao nao ha necessidade de esperar a rede
      // ficar completamente ociosa para telemetria/analytics em segundo
      // plano, o que so atrasava a geracao do PDF sem necessidade.
      await page.goto(`${origin}/orcamentos/${id}`, { waitUntil: "load", timeout: 45000 });

      await page.evaluate(() =>
              Promise.all(
                        Array.from(document.images)
                          .filter((img) => !img.complete)
                          .map(
                                        (img) =>
                                                        new Promise<void>((resolve) => {
                                                                          img.onload = () => resolve();
                                                                          img.onerror = () => resolve();
                                                        })
                                      )
                      )
                              );

      await page.emulateMediaType("print");

      const pdfBuffer = await page.pdf({
              format: "A4",
              printBackground: true,
              preferCSSPageSize: true,
              margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
      });

      return new NextResponse(Buffer.from(pdfBuffer), {
              headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `inline; filename="orcamento-${quote.quote_number}.pdf"`,
                        "Cache-Control": "no-store",
              },
      });
    } catch (err) {
          console.error("Erro ao gerar PDF do orcamento:", err);
          return NextResponse.json({ error: "Erro ao gerar PDF" }, { status: 500 });
    } finally {
          await page?.close();
    }
}
