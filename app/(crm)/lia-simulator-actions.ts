"use server";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import { evaluatePolicy, classifyMessage } from "@/lib/ai/lia-policy";
import type { PolicyDecision } from "@/lib/ai/lia-policy";

export type SimulatorResult = {
  message: string;
  detectedCategory: string;
  decision: PolicyDecision;
  suggestedResponse: string;
};

export async function simulateMessage(message: string): Promise<{ data?: SimulatorResult; error?: string }> {
  try {
    const db = await getRequestClient();
    const user = await getAuthUser();
    if (!user) return { error: "Não autenticado" };
    const { data: p } = await db.from("profiles").select("company_id").eq("id", user.id).single();
    if (!p?.company_id) return { error: "Empresa não encontrada" };

    const category = classifyMessage(message);
    const decision = await evaluatePolicy(db, p.company_id, category);

    // Resposta sugerida com base na decisão — NUNCA altera dados reais
    const suggestedResponse = buildSuggestedResponse(message, decision);

    return { data: { message, detectedCategory: category, decision, suggestedResponse } };
  } catch (e) { return { error: String(e) }; }
}

function buildSuggestedResponse(msg: string, d: PolicyDecision): string {
  if (!d.rule) {
    return `[SEM REGRA ATIVA] Não encontrei uma regra ativa para esta situação. Vou encaminhar para um de nossos atendentes.`;
  }
  switch (d.level) {
    case "auto":
      return `[AUTOMÁTICO] Posso responder diretamente com base na diretriz "${d.rule.title}". A LIA processaria esta mensagem sem aprovação.`;
    case "approval":
      return `[APROVAÇÃO NECESSÁRIA] Esta ação requer aprovação. A LIA criaria um pedido na fila de aprovações (categoria: ${d.category}) e aguardaria autorização do gerente antes de prosseguir.`;
    case "human_only":
      return `[SÓ HUMANO] Esta operação não pode ser executada pela LIA. Seria encaminhada imediatamente para um atendente humano.`;
    case "forbidden":
      return `[BLOQUEADO] Esta operação é proibida para a LIA. Nenhuma ação seria tomada.`;
  }
}
