import { describe, expect, it } from "vitest";
import { deadlineFrom, spDate } from "@/lib/service-order";

describe("prazo máximo da ordem de serviço", () => {
  it("dias corridos", () => expect(deadlineFrom("2026-11-27", "Até 15 dias")).toBe("2026-12-12"));
  it("dias úteis pula sábado e domingo", () => expect(deadlineFrom("2026-11-27", "10 dias úteis")).toBe("2026-12-11"));
  it("semanas e meses", () => {
    expect(deadlineFrom("2026-11-27", "2 semanas")).toBe("2026-12-11");
    expect(deadlineFrom("2026-11-27", "1 mês")).toBe("2026-12-27");
  });
  it("sem número fica nulo", () => {
    expect(deadlineFrom("2026-11-27", "A combinar")).toBeNull();
    expect(deadlineFrom("2026-11-27", null)).toBeNull();
  });
  it("fechamento no fuso de São Paulo", () => expect(spDate("2026-11-28T01:30:00Z")).toBe("2026-11-27"));
});
