// Decide o que a Lia faz com a resposta que a IA gerou: enviar ao cliente,
// deixar como sugestão para a equipe aprovar, ou encaminhar sem responder.
export type LiaMode = "assistente" | "semiautomatica" | "automatica";
export type LiaHours = { inicio: string; fim: string; dias: number[] } | null;
export type LiaAction = "responder" | "sugerir" | "encaminhar";

export const LIA_MODES: Array<{ value: LiaMode; label: string; detail: string }> = [
  { value: "assistente", label: "Assistente", detail: "Só sugere. Toda resposta espera alguém da equipe aprovar." },
  { value: "semiautomatica", label: "Semiautomática", detail: "Responde a triagem comum. Pós-venda e prioridade alta viram sugestão." },
  { value: "automatica", label: "Automática supervisionada", detail: "Responde sozinha dentro do horário e do limite diário. Tudo fica registrado." },
];

export function parseLiaMode(value: unknown): LiaMode {
  return value === "assistente" || value === "semiautomatica" ? value : "automatica";
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function parseLiaHours(value: unknown): LiaHours {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const dias = Array.isArray(v.dias) ? v.dias.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if (typeof v.inicio !== "string" || typeof v.fim !== "string" || !HHMM.test(v.inicio) || !HHMM.test(v.fim) || !dias.length) return null;
  return { inicio: v.inicio, fim: v.fim, dias: [...new Set(dias)].sort() };
}

/** Dia da semana (0 = domingo) e "HH:MM" no horário de Brasília. */
export function brasiliaClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, time: `${get("hour")}:${get("minute")}` };
}

export function withinHours(hours: LiaHours, now: Date) {
  if (!hours) return true;
  const { day, time } = brasiliaClock(now);
  if (!hours.dias.includes(day)) return false;
  return hours.inicio <= hours.fim ? time >= hours.inicio && time < hours.fim : time >= hours.inicio || time < hours.fim;
}

/** Início do dia de hoje em Brasília, em ISO (para contar respostas do dia). */
export function startOfBrasiliaDay(now: Date) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  return new Date(`${ymd}T00:00:00-03:00`).toISOString();
}

export function liaDecision(p: {
  mode: LiaMode; hours: LiaHours; now: Date; repliesToday: number; dailyLimit: number;
  posVenda: boolean; prioridade: string | null;
}): { acao: LiaAction; motivo: string } {
  if (p.repliesToday >= p.dailyLimit) return { acao: "encaminhar", motivo: `Limite diário de ${p.dailyLimit} respostas atingido` };
  if (p.mode === "assistente") return { acao: "sugerir", motivo: "Modo assistente: aguarda aprovação" };
  if (!withinHours(p.hours, p.now)) return { acao: "sugerir", motivo: "Fora do horário de resposta automática" };
  if (p.mode === "semiautomatica" && p.posVenda) return { acao: "sugerir", motivo: "Pós-venda: precisa de aprovação" };
  if (p.mode === "semiautomatica" && /^alta|^urgente/i.test(p.prioridade ?? "")) return { acao: "sugerir", motivo: "Prioridade alta: precisa de aprovação" };
  return { acao: "responder", motivo: p.mode === "semiautomatica" ? "Triagem comum" : "Modo automático" };
}
