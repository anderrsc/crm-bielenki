import { describe, expect, test } from "vitest";
import { FOLLOWUP_MAX_ATTEMPTS, followUpDecision, humanServiceOpen, leadTime, paymentPlan, regionStatus, wantsNoMessages } from "@/lib/ai/lia-rules";
import { LIA_KNOWLEDGE_VERSION, liaFactsPrompt } from "@/lib/ai/lia-knowledge";

describe("pagamento e desconto (cenários 8–14, 36)", () => {
  const base = { total: 4000, hasInstallation: true, downMethod: "pix" as const, balanceMethod: "pix" as const };
  test("padrão: 50% de entrada, saldo após a instalação", () => {
    const p = paymentPlan(base);
    expect([p.ok, p.down, p.balance, p.balanceDue, p.needsApproval]).toEqual([true, 2000, 2000, "apos_instalacao", []]);
  });
  test("sem instalação o saldo é na entrega ou retirada", () => {
    expect(paymentPlan({ ...base, hasInstallation: false }).balanceDue).toBe("entrega_ou_retirada");
  });
  test("desconto de até 3% é permitido; acima de 3% pede aprovação (e não aplica sozinho)", () => {
    const ok = paymentPlan({ ...base, discountPct: 3 });
    expect([ok.total, ok.needsApproval]).toEqual([3880, []]);
    expect(paymentPlan({ ...base, discountPct: 3.5 }).needsApproval).toContain("desconto_acima_de_3");
    expect(paymentPlan({ ...base, discountPct: 10 }).needsApproval).toContain("desconto_acima_de_3");
  });
  test("parcelamento do saldo: até 6x, parcela mínima R$ 200, só no crédito", () => {
    const p = paymentPlan({ ...base, balanceMethod: "credito", installments: 6 });
    expect([p.ok, p.installmentValue]).toEqual([true, 333.33]);
    const baixo = paymentPlan({ ...base, total: 1000, balanceMethod: "credito", installments: 6 }); // saldo 500
    expect(baixo.ok).toBe(false); expect(baixo.errors).toContain("parcela_abaixo_de_200"); expect(baixo.maxInstallmentsAllowed).toBe(2);
    expect(paymentPlan({ ...base, balanceMethod: "credito", installments: 7 }).errors).toContain("parcelas_acima_de_6");
    expect(paymentPlan({ ...base, installments: 3 }).errors).toContain("parcelamento_somente_no_credito");
  });
  test("pagar tudo só depois da instalação (entrada menor que 50%) exige aprovação humana", () => {
    for (const pct of [0, 30, 49]) expect(paymentPlan({ ...base, downPaymentPct: pct }).needsApproval).toContain("entrada_menor_que_50");
    expect(paymentPlan({ ...base, downPaymentPct: 50 }).needsApproval).toEqual([]);
  });
  test("entrada no cartão exige aprovação; boleto só para empresa", () => {
    expect(paymentPlan({ ...base, downMethod: "credito" }).needsApproval).toContain("entrada_no_cartao");
    expect(paymentPlan({ ...base, downMethod: "debito" }).needsApproval).toContain("entrada_no_cartao");
    expect(paymentPlan({ ...base, balanceMethod: "boleto" }).errors).toContain("boleto_somente_empresa");
    expect(paymentPlan({ ...base, balanceMethod: "boleto", isCompany: true }).ok).toBe(true);
  });
  test("valor inválido não gera plano", () => { expect(paymentPlan({ ...base, total: 0 }).ok).toBe(false); });
});

describe("prazos, região e horário", () => {
  test("prazos oficiais", () => {
    expect(leadTime("calha_retirada").hours).toBe(24);
    expect(leadTime("calha_cobertura").hours).toBe(48);
    expect(leadTime("rufo").days).toBe(20);
    expect(leadTime("pingadeira").days).toBe(20);
    expect(leadTime("esquadria").days).toBe(40);
  });
  test("região: calhas só em 3 cidades; outras vão para avaliação humana", () => {
    expect(regionStatus("Jaraguá do Sul", "calha")).toBe("padrao");
    expect(regionStatus("jaragua do sul", "calha")).toBe("padrao");
    expect(regionStatus("Corupá", "calha")).toBe("avaliacao_humana");
    expect(regionStatus("Corupá", "esquadria")).toBe("padrao");
    expect(regionStatus("Joinville", "esquadria")).toBe("avaliacao_humana");
    expect(regionStatus("", "calha")).toBe("desconhecida");
  });
  test("expediente humano (Brasília)", () => {
    expect(humanServiceOpen(new Date("2026-11-18T17:00:00Z"))).toBe(true);   // qua 14:00
    expect(humanServiceOpen(new Date("2026-11-18T15:30:00Z"))).toBe(false);  // qua 12:30 (almoço)
    expect(humanServiceOpen(new Date("2026-11-20T10:30:00Z"))).toBe(true);   // sex 07:30
    expect(humanServiceOpen(new Date("2026-11-20T16:00:00Z"))).toBe(false);  // sex 13:00
    expect(humanServiceOpen(new Date("2026-11-21T17:00:00Z"))).toBe(false);  // sábado
  });
});

describe("acompanhamento automático (cenários 24 e 25)", () => {
  const out = new Date("2026-11-16T17:00:00Z"); // seg 14:00
  const at = (iso: string) => new Date(iso);
  const base = { attempts: 0, lastOutboundAt: out, sentToday: 0, dailyLimit: 15 };
  test("só depois de 24 h e no expediente", () => {
    expect(followUpDecision({ ...base, now: at("2026-11-17T16:00:00Z") })).toBe("aguardar");  // 23 h
    expect(followUpDecision({ ...base, now: at("2026-11-17T17:30:00Z") })).toBe("enviar");    // ter 14:30
    expect(followUpDecision({ ...base, now: at("2026-11-21T17:00:00Z") })).toBe("aguardar");  // sábado
  });
  test("máximo de 3 tentativas, depois para de vez", () => {
    expect(followUpDecision({ ...base, attempts: FOLLOWUP_MAX_ATTEMPTS, now: at("2026-11-30T17:00:00Z") })).toBe("parar");
    const segunda = followUpDecision({ ...base, attempts: 1, lastAttemptAt: at("2026-11-17T17:30:00Z"), now: at("2026-11-18T17:30:00Z") });
    expect(segunda).toBe("aguardar"); // 2ª tentativa só depois de 48 h
    expect(followUpDecision({ ...base, attempts: 1, lastAttemptAt: at("2026-11-17T17:30:00Z"), now: at("2026-11-19T17:30:00Z") })).toBe("enviar");
  });
  test("para quando o cliente responde, recusa ou o limite do dia acaba", () => {
    expect(followUpDecision({ ...base, lastInboundAt: at("2026-11-17T12:00:00Z"), now: at("2026-11-17T17:30:00Z") })).toBe("parar");
    expect(followUpDecision({ ...base, optedOut: true, now: at("2026-11-17T17:30:00Z") })).toBe("parar");
    expect(followUpDecision({ ...base, sentToday: 15, now: at("2026-11-17T17:30:00Z") })).toBe("aguardar");
  });
  test("recusa do cliente é reconhecida", () => {
    for (const t of ["não tenho interesse", "Pare de me mandar mensagem", "já fechei com outra empresa", "não quero mais receber", "desisti"]) expect(wantsNoMessages(t)).toBe(true);
    for (const t of ["pode me mandar o orçamento", "quero sim", "qual o prazo?"]) expect(wantsNoMessages(t)).toBe(false);
  });
});

describe("base de conhecimento versionada", () => {
  test("o prompt é gerado dos mesmos dados que o código valida", () => {
    const p = liaFactsPrompt();
    expect(p).toContain(LIA_KNOWLEDGE_VERSION);
    for (const s of ["até 20 dias corridos", "40 dias corridos", "parcela mínima de R$ 200", "boleto só para empresas", "(47) 99696-0340", "Nunca informe preço"]) expect(p).toContain(s);
    expect(p).not.toMatch(/\p{Extended_Pictographic}/u); // sem emojis
  });
});
