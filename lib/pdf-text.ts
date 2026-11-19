// Texto de um PDF em linhas de células (texto + posição x), na ordem de leitura.
// Só funciona com PDF que tem texto (como os gerados pelo WVetro); foto escaneada volta vazia.
import type { Row } from "@/lib/wvetro-proposal";

type TextItem = { str?: string; transform?: number[]; width?: number };

export async function pdfRows(data: Uint8Array, maxPages = 30): Promise<Row[]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const rows: Row[] = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines: { y: number; cells: (Row[number] & { end: number })[] }[] = [];
      for (const item of content.items as TextItem[]) {
        if (!item.str?.trim() || !item.transform) continue;
        const x = item.transform[4], y = item.transform[5];
        // Mesma linha visual: diferença de até 2,5 pontos na altura.
        let line = lines.find((l) => Math.abs(l.y - y) <= 2.5);
        if (!line) { line = { y, cells: [] }; lines.push(line); }
        line.cells.push({ x: Math.round(x), s: item.str, end: x + (item.width ?? 0) });
      }
      lines.sort((a, b) => b.y - a.y);
      for (const line of lines) {
        // O PDF quebra a palavra nas letras acentuadas ("A" "ç" "o"): pedaços colados viram uma célula só.
        const merged: (Row[number] & { end: number })[] = [];
        for (const cell of line.cells.sort((a, b) => a.x - b.x)) {
          const last = merged[merged.length - 1];
          if (last && cell.x - last.end < 0.8) { last.s += cell.s; last.end = cell.end; }
          else merged.push({ ...cell });
        }
        rows.push(merged.map(({ x, s }) => ({ x, s })));
      }
    }
  } finally {
    await pdf.cleanup?.();
  }
  return rows;
}
