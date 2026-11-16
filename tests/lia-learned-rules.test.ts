import { describe, expect, test } from "vitest";
import { draftFromCorrection, liaRulesForPrompt, parseDraft, similarRules, type LiaRule } from "@/lib/ai/lia-learned-rules";

const rule = (id: string, quando: string | null, instrucao: string, status: LiaRule["status"] = "ativa"): LiaRule => ({ id, quando, instrucao, status, versao: 1, anterior_id: null });

describe("regras ensinadas à Lia", () => {
  test("lê a correção sem IA", () => {
    expect(draftFromCorrection("Lia, não responda dessa forma. Quando o cliente pedir orçamento de calhas, primeiro solicite endereço e fotos."))
      .toEqual({ quando: "O cliente pedir orçamento de calhas", instrucao: "Primeiro solicite endereço e fotos." });
    expect(draftFromCorrection("Lia: nunca informe prazo de entrega")).toEqual({ quando: null, instrucao: "Nunca informe prazo de entrega." });
  });

  test("aceita só JSON válido da IA", () => {
    expect(parseDraft('{"quando":"cliente pede calha","instrucao":"Peça fotos."}')).toEqual({ quando: "cliente pede calha", instrucao: "Peça fotos." });
    expect(parseDraft('```json\n{"quando":null,"instrucao":"Peça o bairro."}\n```')).toEqual({ quando: null, instrucao: "Peça o bairro." });
    expect(parseDraft('{"instrucao":"oi"}')).toBeNull();
    expect(parseDraft("não é json")).toBeNull();
  });

  test("aponta regra parecida antes de confirmar", () => {
    const ativas = [rule("a", "cliente pede orçamento de calhas", "Peça endereço e fotos."), rule("b", null, "Não informe preços."), rule("c", "cliente pede calhas", "Peça fotos do telhado", "arquivada")];
    expect(similarRules({ quando: "cliente pedir orçamento de calhas", instrucao: "Solicite endereço e fotos primeiro." }, ativas).map((r) => r.id)).toEqual(["a"]);
    expect(similarRules({ quando: null, instrucao: "Agende visita técnica em Joinville." }, ativas)).toEqual([]);
  });

  test("prompt: obrigatório, na ordem e com limite", () => {
    const p = liaRulesForPrompt([{ quando: "cliente pede calha", instrucao: "Peça fotos." }, { quando: null, instrucao: "Não informe preços." }]);
    expect(p).toMatch(/^REGRAS CONFIRMADAS PELA GERÊNCIA/);
    expect(p).toContain("- Quando cliente pede calha: Peça fotos.\n- Não informe preços.");
    expect(liaRulesForPrompt([])).toBe("");
    expect(liaRulesForPrompt(Array.from({ length: 200 }, (_, i) => ({ quando: null, instrucao: `Regra ${i} `.repeat(20) }))).length).toBeLessThan(4300);
  });
});
