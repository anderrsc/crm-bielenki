import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pdfRows } from "@/lib/pdf-text";
import { distributeTotal, parseWvetroRows, productName, proposalNotes, toWindowItems, type Row } from "@/lib/wvetro-proposal";
import { confirmKind } from "@/components/confirm-button";

// Estrutura real de uma proposta do WVetro (nº 1768), com cliente e contatos trocados por dados de exemplo.
const rows = JSON.parse(readFileSync("tests/fixtures/wvetro-proposta.json", "utf8")) as Row[];
const proposal = parseWvetroRows(rows);

describe("proposta do WVetro", () => {
  test("cabeçalho, cliente, total e validade", () => {
    expect(proposal).toMatchObject({ numero: "1768", emissao: "2026-08-19", validade: "2026-08-26", vendedor: "ANDERSON", total: 51154.78 });
    expect(proposal.cliente).toMatchObject({ nome: "JOÃO DA SILVA TESTE", cidade: "CIDADE EXEMPLO", uf: "SC", bairro: "CENTRO", telefone: null, documento: null });
  });

  test("lê os 10 itens com medidas, vidro, cores e observações", () => {
    expect(proposal.itens).toHaveLength(10);
    expect(proposal.itens.map((i) => [i.quantidade, i.largura, i.altura])).toEqual([
      [3, 1200, 1000], [3, 1350, 1000], [3, 1500, 1000], [4, 1800, 2100], [2, 1600, 2100],
      [4, 800, 600], [3, 2850, 1100], [1, 2750, 1100], [1, 7000, 1100], [4, 1300, 2700],
    ]);
    expect(proposal.itens[1]).toMatchObject({ produto: "JANELA DE CORRER 02 FOLHAS MÓVEIS | SUPREMA", linha: "L. SUPREMA", vidro: "LAMINADO INCOLOR 3+3 - LAPIDADO", corEsquadria: "BRANCO", corAcessorio: "BRANCO", metragem: 4.05 });
    expect(proposal.itens[4].observacoes).toBe("COM ARREMATE INTERNO - COM FECHADURA C/ CHAVE E FECHO CONCHA | TRILHO A DEFINIR (ROLDANAS EM AÇO INOX)");
    expect(proposal.itens[6].ambiente).toBe("SACADA");
    expect(proposal.itens[8]).toMatchObject({ ambiente: "CURVA", observacoes: "CONFERIR MODELO CURVA" });
    expect(proposal.itens[9].variaveis).toEqual(["POSIÇÃO DA PORTA: A DEFINIR", "LARGURA DOS VIDROS: MEDIDA PADRÃO", "ALTURA DO FIXO ACIMA DO BOX: 800.00"]);
    // A soma da metragem confere com o PDF: nada se perdeu entre páginas.
    expect(proposal.itens.reduce((s, i) => s + (i.metragem ?? 0), 0)).toBeCloseTo(70.08, 3);
  });

  test("vira itens do orçamento de esquadrias no formato da tela", () => {
    const items = toWindowItems(proposal);
    expect(items[0]).toEqual({ product: "JANELA DE CORRER 02 FOLHAS MÓVEIS", line: "Suprema", measurements: "1200 × 1000", glass: "Incolor 6 mm - temperado", accessories: "Branco · com arremate interno - com fecho concha slide | trilho convencional (roldanas em aço inox)", color: "Branco", quantity: 3, unit_price: 0 });
    expect(items[3].product).toBe("PORTA DE CORRER 02 FOLHAS MÓVEIS (COM PUXADOR INTERNO 198MM)");
    expect(items[6].product).toBe("GUARDA-CORPO | CORRIMÃO PANORÂMICO CG-083 | VÃO INFERIOR LIVRE | VIDRO 8MM — Sacada");
    expect(items[9]).toMatchObject({ line: "Vidro temperado", glass: "Incolor 8 mm - temperado" });
    expect(items.every((i) => i.measurements && i.quantity > 0)).toBe(true);
    const notes = proposalNotes(proposal);
    expect(notes.startsWith("Referente à proposta nº 1768 de 19/08/2026.\nDETALHES DO SEU PEDIDO:")).toBe(true);
    expect(notes).toContain("- Todas Roldanas em Aço Inox (portas e janelas);");
    expect(notes).not.toMatch(/wvetro/i);
  });

  test("nome: só tira a linha repetida, nunca a primeira parte", () => {
    const base = { n: 1, ambiente: "", linha: "L. SUPREMA", corEsquadria: "", corAcessorio: "", vidro: "", quantidade: 1, largura: 1, altura: 1, metragem: null, observacoes: "", variaveis: [] };
    expect(productName({ ...base, produto: "MAXIM-AR COM 01 MÓDULO | SUPREMA" })).toBe("MAXIM-AR COM 01 MÓDULO");
    expect(productName({ ...base, produto: "SUPREMA | JANELA" })).toBe("SUPREMA | JANELA");
  });
});

describe("repartir o total do WVetro", () => {
  test("fecha exatamente no total da proposta (centavos num item de quantidade 1)", () => {
    const items = toWindowItems(proposal);
    const { unitPrices, discount } = distributeTotal(items, 51154.78, proposal.itens.map((i) => i.metragem));
    const sum = items.reduce((s, item, i) => s + Math.round(item.quantity * unitPrices[i] * 100), 0);
    expect((sum - Math.round(discount * 100)) / 100).toBe(51154.78);
    expect(discount).toBe(0);
    expect(unitPrices.every((u) => u > 0 && Math.round(u * 100) === u * 100)).toBe(true);
    // Mais metragem por peça, mais valor por peça.
    expect(unitPrices[3]).toBeGreaterThan(unitPrices[0]);
  });

  test("sem item de quantidade 1, a sobra vira desconto de centavos e o total bate", () => {
    const items = [{ quantity: 3, measurements: "1000 × 1000" }, { quantity: 7, measurements: "1000 × 1000" }];
    for (const total of [1000, 1000.01, 999.99, 123.45]) {
      const { unitPrices, discount } = distributeTotal(items, total);
      const sum = items.reduce((s, item, i) => s + Math.round(item.quantity * unitPrices[i] * 100), 0);
      expect(sum - Math.round(discount * 100)).toBe(Math.round(total * 100));
      expect(discount).toBeGreaterThanOrEqual(0);
      expect(discount).toBeLessThan(0.1);
    }
  });

  test("sem medidas, reparte em partes iguais; total zero não inventa valor", () => {
    expect(distributeTotal([{ quantity: 1, measurements: "" }, { quantity: 1, measurements: "" }], 100).unitPrices).toEqual([50, 50]);
    expect(distributeTotal([{ quantity: 2, measurements: "1 × 1" }], 0)).toEqual({ unitPrices: [0], discount: 0 });
  });
});

test("texto do PDF: junta pedaços de palavra com acento e mantém a ordem das linhas", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let x = 14;
  for (const part of ["- Todas Roldanas em A", "ç", "o Inox"]) { page.drawText(part, { x, y: 700, size: 9, font }); x += font.widthOfTextAtSize(part, 9); }
  page.drawText("TOTAL:", { x: 152, y: 600, size: 10, font });
  page.drawText("51.154,78", { x: 305, y: 600, size: 10, font });
  const out = await pdfRows(new Uint8Array(await doc.save()));
  expect(out.map((r) => r.map((c) => c.s))).toEqual([["- Todas Roldanas em Aço Inox"], ["TOTAL:", "51.154,78"]]);
});

test("confirmação: só exclusão diz exclusão", () => {
  expect(confirmKind("Aprovar gera venda, pedido, produção e conta a receber. Confirmar aprovação?")).toEqual({ title: "Confirmar aprovação", danger: false });
  expect(confirmKind("Excluir o orçamento ORC-1? Esta ação não pode ser desfeita.")).toEqual({ title: "Confirmar exclusão", danger: true });
  expect(confirmKind("Estornar a baixa de R$ 10,00?").title).toBe("Confirmar estorno");
  expect(confirmKind("Cancelar esta compra?").title).toBe("Confirmar cancelamento");
  expect(confirmKind("Confirmar a conclusão deste serviço?")).toEqual({ title: "Confirmar", danger: false });
});
