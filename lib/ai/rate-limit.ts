// Limite de uso da IA por usuário (proteção contra abuso e custo). Em memória, por instância do servidor:
// não é contabilidade exata, só um freio. A Lia no WhatsApp tem o próprio limite diário no banco.
const JANELA_MS = 10 * 60 * 1000;
export const AI_MAX_POR_JANELA = 40;
const usos = new Map<string, number[]>();

export class AiRateLimitError extends Error {
  constructor() { super("Muitos pedidos à IA em pouco tempo. Aguarde alguns minutos e tente de novo."); }
}

/** Conta um uso; lança AiRateLimitError se a pessoa passou do limite na janela. */
export function consumeAiQuota(key: string, now = Date.now(), max = AI_MAX_POR_JANELA): void {
  const desde = now - JANELA_MS;
  const lista = (usos.get(key) ?? []).filter((t) => t > desde);
  if (lista.length >= max) { usos.set(key, lista); throw new AiRateLimitError(); }
  lista.push(now);
  usos.set(key, lista);
  if (usos.size > 5000) for (const [k, v] of usos) if (!v.some((t) => t > desde)) usos.delete(k);
}

export function resetAiQuota() { usos.clear(); }
