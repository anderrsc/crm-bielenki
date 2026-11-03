import { readFileSync } from "node:fs";
import path from "node:path";

// Marca d'agua do orcamento: o logo oficial da Marquinhos (vetor original,
// versao monocromatica), pequeno e bem claro, reto e em linhas alternadas
// (padrao "tijolo") por toda a folha: tela, impressao e todas as paginas do
// PDF. Identifica a proposta mesmo se o PDF for repassado ou recortado.
let logo: string | null = null;

// Ladrilho 3:2 com 1/3 da largura da folha (quote-paper.css), sem logo cortado:
// um logo no centro da 1a linha e outro deslocado meia coluna na 2a linha.
const W = 840, H = 560, LOGO_W = 230, LOGO_H = 79;

export function quoteWatermarkUrl() {
  // Sem transparencia: logo em cinza bem claro e opaco, atras do conteudo.
  // Transparencia (opacity) faz o Windows/"Microsoft Print to PDF" e muitas
  // impressoras rasterizarem a pagina inteira em baixa resolucao (texto borrado).
  logo ??= Buffer.from(readFileSync(path.join(process.cwd(), "public", "brand", "original", "marquinhos-logo-preto-monocromatico.svg"), "utf8")
    .replace(/fill="#000000"/g, 'fill="#efefef"').replace(/fill="#fefefe"/g, 'fill="none"')).toString("base64");
  const img = (x: number, y: number) => `<image href="data:image/svg+xml;base64,${logo}" x="${x - LOGO_W / 2}" y="${y - LOGO_H / 2}" width="${LOGO_W}" height="${LOGO_H}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><g>`
    + img(W * 0.25, H * 0.25) + img(W * 0.75, H * 0.75)
    + `</g></svg>`;
  return `url("data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}")`;
}
