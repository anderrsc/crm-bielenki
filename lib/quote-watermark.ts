import { readFileSync } from "node:fs";
import path from "node:path";

// Marca d'agua do orcamento: o logo original da Marquinhos, bem pequeno e
// quase invisivel, repetido na diagonal por toda a folha (tela, impressao e
// todas as paginas do PDF). Identifica a proposta mesmo se o PDF for
// repassado ou recortado.
let logo: string | null = null;

export function quoteWatermarkUrl() {
  logo ??= readFileSync(path.join(process.cwd(), "public", "brand", "original", "marquinhos-logo.svg")).toString("base64");
  // Ladrilho 70 x 42 mm: um logo de 22mm, girado, com opacidade de 4%.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="420" viewBox="0 0 700 420">`
    + `<g transform="rotate(-18 350 210)" opacity="0.04">`
    + `<image href="data:image/svg+xml;base64,${logo}" x="240" y="172" width="220" height="75"/>`
    + `</g></svg>`;
  return `url("data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}")`;
}
