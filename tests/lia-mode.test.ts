import { expect, test } from "vitest";
import { liaDecision, parseLiaHours, parseLiaMode, startOfBrasiliaDay, withinHours } from "@/lib/ai/lia-mode";

// Segunda-feira 16/11/2026 10:00 em Brasília (13:00 UTC).
const seg10h = new Date("2026-11-16T13:00:00Z");
const seg20h = new Date("2026-11-16T23:00:00Z");
const dom10h = new Date("2026-11-15T13:00:00Z");
const comercial = { inicio: "08:00", fim: "18:00", dias: [1, 2, 3, 4, 5, 6] };
const base = { mode: "automatica" as const, hours: null, now: seg10h, repliesToday: 0, dailyLimit: 200, posVenda: false, prioridade: null };

test("automática sem horário responde como hoje", () => {
  expect(liaDecision(base).acao).toBe("responder");
  expect(liaDecision({ ...base, posVenda: true, prioridade: "alta" }).acao).toBe("responder");
});

test("assistente sempre sugere", () => {
  expect(liaDecision({ ...base, mode: "assistente" })).toEqual({ acao: "sugerir", motivo: "Modo assistente: aguarda aprovação" });
});

test("semiautomática sugere pós-venda e prioridade alta, responde o resto", () => {
  const semi = { ...base, mode: "semiautomatica" as const };
  expect(liaDecision(semi).acao).toBe("responder");
  expect(liaDecision({ ...semi, posVenda: true }).acao).toBe("sugerir");
  expect(liaDecision({ ...semi, prioridade: "Alta" }).acao).toBe("sugerir");
  expect(liaDecision({ ...semi, prioridade: "media" }).acao).toBe("responder");
});

test("fora do horário vira sugestão", () => {
  expect(liaDecision({ ...base, hours: comercial, now: seg20h }).acao).toBe("sugerir");
  expect(liaDecision({ ...base, hours: comercial, now: dom10h }).acao).toBe("sugerir");
  expect(liaDecision({ ...base, hours: comercial }).acao).toBe("responder");
});

test("limite diário encaminha para a equipe", () => {
  expect(liaDecision({ ...base, repliesToday: 200 })).toMatchObject({ acao: "encaminhar" });
});

test("horário noturno que vira o dia", () => {
  const noite = { inicio: "18:00", fim: "08:00", dias: [0, 1, 2, 3, 4, 5, 6] };
  expect(withinHours(noite, seg20h)).toBe(true);
  expect(withinHours(noite, seg10h)).toBe(false);
});

test("leitura defensiva da configuração", () => {
  expect(parseLiaMode("turbo")).toBe("automatica");
  expect(parseLiaMode("assistente")).toBe("assistente");
  expect(parseLiaHours({ inicio: "8h", fim: "18:00", dias: [1] })).toBeNull();
  expect(parseLiaHours({ inicio: "08:00", fim: "18:00", dias: [] })).toBeNull();
  expect(parseLiaHours({ inicio: "08:00", fim: "18:00", dias: [5, 1, 1, 9] })).toEqual({ inicio: "08:00", fim: "18:00", dias: [1, 5] });
});

test("início do dia em Brasília", () => {
  expect(startOfBrasiliaDay(new Date("2026-11-17T01:30:00Z"))).toBe("2026-11-16T03:00:00.000Z");
});
