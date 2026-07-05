import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

const CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

// Reaproveita o Chromium headless entre chamadas na mesma instancia da
// lambda ("quente"). Lancar o Chromium do zero (baixar o pack remoto +
// subir o processo) e o maior custo de tempo na geracao do PDF.
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
      // A4 (210mm x 297mm) a 96 CSS DPI = 794 x 1123 px. Um viewport fora
      // dessa proporcao faz o Chromium renderizar o conteudo em outra
      // escala antes de encaixar na folha A4 do PDF, distorcendo qualquer
      // medida em mm (ex.: o ladrilho da marca d'agua).
      defaultViewport: { width: 794, height: 1123 },
      executablePath,
      headless: true,
    });
  })();
  return browserPromise;
}

export function parseCookieHeader(cookieHeader: string, host: string) {
  return cookieHeader
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const idx = c.indexOf("=");
      return { name: c.slice(0, idx), value: c.slice(idx + 1), domain: host, path: "/" };
    });
}

// Gera o PDF do orcamento renderizando a propria pagina do sistema em um
// Chromium headless (mesmo motor do navegador), com emulateMediaType("print").
// Isso garante que o PDF fique sempre identico ao que aparece na tela.
export async function generateQuotePdfBuffer(params: {
  origin: string;
  quoteId: string;
  cookieHeader: string;
  host: string;
}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const cookies = parseCookieHeader(params.cookieHeader, params.host);
    if (cookies.length > 0) await page.setCookie(...cookies);

    // "load" + a espera explicita pelas imagens abaixo e suficiente: os
    // dados do orcamento ja vem prontos no HTML (server component), entao
    // nao ha necessidade de esperar a rede ficar completamente ociosa.
    await page.goto(`${params.origin}/orcamentos/${params.quoteId}`, { waitUntil: "load", timeout: 45000 });

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

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}
