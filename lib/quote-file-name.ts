// Nome do arquivo do orcamento: "Aline Tomaselli - ORC-2026-00044".
// O nome do cliente sai com a capitalizacao correta mesmo se estiver
// cadastrado todo em maiusculas/minusculas (preposicoes ficam minusculas).
const LOWER = new Set(["da", "das", "de", "do", "dos", "e", "di", "du", "del", "van", "von"]);

export function formatPersonName(raw: string | null | undefined): string {
  const words = String(raw ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR").split(" ").filter(Boolean);
  return words
    .map((word, i) => {
      if (i > 0 && LOWER.has(word)) return word;
      // Capitaliza cada parte de nomes compostos (Ana-Paula, D'Avila).
      return word.replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}

export function quoteFileBaseName(clientName: string | null | undefined, quoteNumber: string): string {
  const name = formatPersonName(String(clientName ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")).slice(0, 80).trim();
  const number = String(quoteNumber ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
  return name ? `${name} - ${number}` : number;
}

export function quoteFileName(clientName: string | null | undefined, quoteNumber: string): string {
  return `${quoteFileBaseName(clientName, quoteNumber)}.pdf`;
}

// Content-Disposition com nome acentuado (RFC 6266/5987) e fallback ASCII.
export function quoteContentDisposition(fileName: string, type: "inline" | "attachment" = "inline"): string {
  const ascii = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
