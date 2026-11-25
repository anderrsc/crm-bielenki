import { describe, expect, it } from "vitest";
import { pageIsNewestFirst } from "@/lib/whatsapp/evolution-history";

describe("ordem das páginas da Evolution", () => {
  it("detecta página com as mais novas primeiro (Evolution 2.3)", () => {
    expect(pageIsNewestFirst([{ messageTimestamp: 300 }, { messageTimestamp: 200 }, { messageTimestamp: 100 }])).toBe(true);
  });
  it("detecta página em ordem crescente (versões antigas)", () => {
    expect(pageIsNewestFirst([{ messageTimestamp: 100 }, { messageTimestamp: 300 }])).toBe(false);
  });
  it("página vazia ou com 1 mensagem segue o padrão antigo", () => {
    expect(pageIsNewestFirst([])).toBe(false);
    expect(pageIsNewestFirst([{ messageTimestamp: "5" }])).toBe(false);
  });
});
