// Regras comerciais da Lia em CÓDIGO (testável), não só em texto de prompt. A Lia propõe;
// estas funções validam. O que exigir aprovação vira pedido para Administrador ou Gerente:
// nenhuma função aqui aprova nada sozinha.
import { GUTTER_CITIES, LEAD_TIMES, RULES, SERVICE_CITIES, type LeadTimeKind } from "@/lib/ai/lia-knowledge";
import { brasiliaClock } from "@/lib/ai/lia-mode";

const cents = (n: number) => Math.round(n * 100) / 100;
export const normalizeText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export type PaymentMethod = "pix" | "dinheiro" | "credito" | "debito" | "cheque" | "boleto";
export type Approval = "entrada_menor_que_50" | "entrada_no_cartao" | "desconto_acima_de_3";
export type PaymentInput = {
  total: number; hasInstallation: boolean; downMethod: PaymentMethod; balanceMethod: PaymentMethod;
  /** Parcelas do saldo (só no cartão de crédito). */
  installments?: number; isCompany?: boolean;
  /** Percentual de entrada pedido (padrão 50). Menos que 50 = exceção. */
  downPaymentPct?: number; discountPct?: number;
};
export type PaymentPlan = {
  ok: boolean; originalTotal: number; discountPct: number; total: number; down: number; balance: number;
  installments: number; installmentValue: number | null; maxInstallmentsAllowed: number;
  balanceDue: "apos_instalacao" | "entrega_ou_retirada";
  /** Aprovação humana necessária (Administrador ou Gerente). A Lia nunca concede. */
  needsApproval: Approval[]; errors: string[];
};

export function paymentPlan(input: PaymentInput): PaymentPlan {
  const errors: string[] = []; const needsApproval: Approval[] = [];
  const originalTotal = cents(input.total);
  if (!(originalTotal > 0)) errors.push("valor_invalido");
  const discountPct = Math.max(0, input.discountPct ?? 0);
  if (discountPct > RULES.maxDiscountPct) needsApproval.push("desconto_acima_de_3");
  const total = cents(originalTotal * (1 - discountPct / 100));
  const downPct = input.downPaymentPct ?? RULES.downPaymentPct;
  if (downPct < RULES.downPaymentPct) needsApproval.push("entrada_menor_que_50");
  if (input.downMethod === "credito" || input.downMethod === "debito") needsApproval.push("entrada_no_cartao");
  for (const m of [input.downMethod, input.balanceMethod]) if (m === "boleto" && !input.isCompany) errors.push("boleto_somente_empresa");
  const down = cents(total * downPct / 100);
  const balance = cents(total - down);
  const asked = Math.max(1, Math.floor(input.installments ?? 1));
  const maxByMin = Math.max(1, Math.floor(balance / RULES.minInstallmentValue));
  const maxInstallmentsAllowed = input.balanceMethod === "credito" ? Math.min(RULES.maxInstallments, maxByMin) : 1;
  if (asked > 1 && input.balanceMethod !== "credito") errors.push("parcelamento_somente_no_credito");
  if (asked > RULES.maxInstallments) errors.push("parcelas_acima_de_6");
  else if (input.balanceMethod === "credito" && asked > maxByMin) errors.push("parcela_abaixo_de_200");
  const installments = Math.min(asked, maxInstallmentsAllowed);
  return {
    ok: errors.length === 0, originalTotal, discountPct, total, down, balance, installments,
    installmentValue: input.balanceMethod === "credito" && balance > 0 ? cents(balance / installments) : null,
    maxInstallmentsAllowed, balanceDue: input.hasInstallation ? "apos_instalacao" : "entrega_ou_retirada", needsApproval, errors,
  };
}

export function leadTime(kind: LeadTimeKind) { return LEAD_TIMES[kind]; }

export type RegionStatus = "padrao" | "avaliacao_humana" | "desconhecida";
export function regionStatus(city: string | null | undefined, service: "calha" | "esquadria" | "outro" = "outro"): RegionStatus {
  if (!city || !normalizeText(city)) return "desconhecida";
  const list = service === "calha" ? GUTTER_CITIES : SERVICE_CITIES;
  return list.some((c) => normalizeText(c) === normalizeText(city)) ? "padrao" : "avaliacao_humana";
}

/** Equipe humana em horário de atendimento (Brasília). */
export function humanServiceOpen(now: Date): boolean {
  const { day, time } = brasiliaClock(now);
  if (day >= 1 && day <= 4) return (time >= "07:30" && time < "12:00") || (time >= "13:00" && time < "17:30");
  if (day === 5) return time >= "07:00" && time < "12:00";
  return false;
}

/** Cliente pediu para não receber mensagens (ou desistiu): acompanhamento para de vez. */
export function wantsNoMessages(text: string): boolean {
  const t = normalizeText(text);
  return /\b(pare|parar|para de (me )?(mandar|enviar|chamar)|nao (me )?(chame|chama|mande|envie)|nao quero (mais )?(receber|mensagem|contato)|nao tenho (mais )?interesse|sem interesse|ja (fechei|comprei|contratei)|nao preciso mais|desisti|tire(m)? (meu|o) (numero|contato)|me tire)\b/.test(t);
}

/** Intervalos entre as tentativas de acompanhamento (horas): 1ª após 24 h, depois mais espaçado. */
export const FOLLOWUP_GAPS_HOURS = [24, 48, 72] as const;
export const FOLLOWUP_MAX_ATTEMPTS = 3;

export type FollowUpInput = {
  now: Date; attempts: number; lastOutboundAt: Date; lastAttemptAt?: Date | null; lastInboundAt?: Date | null;
  optedOut?: boolean; sentToday: number; dailyLimit: number;
};
export type FollowUpDecision = "enviar" | "aguardar" | "parar";
/** Decide o acompanhamento: nunca mais que 3, nunca depois de resposta/recusa, só no expediente, com limite diário. */
export function followUpDecision(i: FollowUpInput): FollowUpDecision {
  if (i.optedOut || i.attempts >= FOLLOWUP_MAX_ATTEMPTS) return "parar";
  // Cliente respondeu depois da nossa última mensagem: o atendimento segue normal, sem robô de cobrança.
  if (i.lastInboundAt && i.lastInboundAt > i.lastOutboundAt) return "parar";
  const base = i.lastAttemptAt && i.lastAttemptAt > i.lastOutboundAt ? i.lastAttemptAt : i.lastOutboundAt;
  const gap = FOLLOWUP_GAPS_HOURS[Math.min(i.attempts, FOLLOWUP_GAPS_HOURS.length - 1)] * 3600_000;
  if (i.now.getTime() - base.getTime() < gap) return "aguardar";
  if (!humanServiceOpen(i.now)) return "aguardar";
  if (i.sentToday >= i.dailyLimit) return "aguardar";
  return "enviar";
}

export const FOLLOWUP_TEXTS = [
  (nome: string) => `Olá${nome}! Passando para saber se você ainda precisa do orçamento. Se tiver qualquer dúvida, é só me falar por aqui.`,
  (nome: string) => `Olá${nome}, tudo bem? Seguimos à disposição para ajudar com o seu pedido. Se ainda tiver interesse, me avise por aqui.`,
  (nome: string) => `Olá${nome}! Este é meu último contato sobre o orçamento, para não incomodar. Se precisar da Marquinhos Calhas e Esquadrias, é só chamar por aqui.`,
] as const;
