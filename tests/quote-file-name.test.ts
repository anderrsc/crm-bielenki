import { describe, expect, it } from "vitest";
import { formatPersonName, quoteContentDisposition, quoteFileName } from "@/lib/quote-file-name";

describe("nome do arquivo do orçamento", () => {
  it("usa Nome Do Cliente - número", () => {
    expect(quoteFileName("ALINE TOMASELLI", "ORC-2026-00044")).toBe("Aline Tomaselli - ORC-2026-00044.pdf");
    expect(quoteFileName("  joão  da silva ", "ORC-2026-00001")).toBe("João da Silva - ORC-2026-00001.pdf");
  });
  it("capitaliza nomes compostos", () => {
    expect(formatPersonName("ANA-PAULA D'AVILA E SOUZA")).toBe("Ana-Paula D'Avila e Souza");
  });
  it("sem cliente usa só o número e remove caracteres inválidos", () => {
    expect(quoteFileName(null, "ORC-2026-00002")).toBe("ORC-2026-00002.pdf");
    expect(quoteFileName("Loja A/B", "ORC-1")).toBe("Loja A B - ORC-1.pdf");
  });
  it("cabeçalho com acento", () => {
    expect(quoteContentDisposition("João - ORC-1.pdf")).toBe(`inline; filename="Joao - ORC-1.pdf"; filename*=UTF-8''Jo%C3%A3o%20-%20ORC-1.pdf`);
  });
});
