import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";
import { createClient } from "@/lib/supabase/server";


const CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";
export const runtime = "nodejs";
export const maxDuration = 60;

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

  let browser: import("puppeteer-core").Browser | undefined;
    try {
          browser = await puppeteer.launch({
                  args: chromium.args,
                  defaultViewport: { width: 1000, height: 1400 },
                        executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
                  headless: true
          });

      const page = await browser.newPage();
          if (cookies.length > 0) {
                  await page.setCookie(...cookies);
          }

      await page.goto(`${origin}/orcamentos/${id}`, { waitUntil: "networkidle0", timeout: 45000 });

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
          await browser?.close();
    }
}
