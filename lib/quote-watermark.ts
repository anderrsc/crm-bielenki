// Marca d'agua do orcamento: texto pequeno e quase transparente repetido na
// diagonal por toda a folha, com o numero do orcamento. Identifica a proposta
// como da Marquinhos mesmo se o PDF for repassado ou recortado.
const xml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function quoteWatermarkUrl(quoteNumber: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="170">`
    + `<g transform="rotate(-24 160 85)" font-family="Arial,Helvetica,sans-serif" fill="#b30b0b" fill-opacity="0.05" text-anchor="middle">`
    + `<text x="160" y="80" font-size="9" font-weight="700" letter-spacing="0.6">PROPOSTA MARQUINHOS CALHAS E ESQUADRIAS</text>`
    + `<text x="160" y="93" font-size="7">${xml(quoteNumber)} · uso exclusivo do cliente</text>`
    + `</g></svg>`;
  return `url("data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}")`;
}
