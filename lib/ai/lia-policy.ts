// Motor de políticas LIA V2 — avalia se uma ação é permitida com base nas regras ativas.
// Usado pelo simulador e, futuramente, pelo orquestrador de triagem.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutonomyLevel, LiaRuleRow } from "@/lib/ai/lia-types";

export type PolicyDecision = {
  allowed: boolean;
  level: AutonomyLevel;
  requiresApproval: boolean;
  rule: Pick<LiaRuleRow, "id" | "title" | "description" | "autonomy_level" | "risk_level"> | null;
  message: string;
  category: string;
};

const DECISION_MSG: Record<AutonomyLevel, string> = {
  auto:       "LIA pode executar automaticamente.",
  approval:   "LIA deve criar um pedido de aprovação antes de prosseguir.",
  human_only: "Somente um funcionário humano pode executar esta ação.",
  forbidden:  "Esta operação é proibida para a LIA.",
};

/** Avalia a política para uma categoria/ação. Busca a regra ativa mais específica. */
export async function evaluatePolicy(
  db: SupabaseClient,
  companyId: string,
  category: string,
): Promise<PolicyDecision> {
  const { data } = await db
    .from("lia_rules")
    .select("id,title,description,autonomy_level,risk_level,category")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .ilike("category", category)
    .order("rule_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return {
      allowed: false,
      level: "human_only",
      requiresApproval: false,
      rule: null,
      message: "Nenhuma regra ativa encontrada para esta categoria. LIA deve consultar um responsável.",
      category,
    };
  }

  const level: AutonomyLevel = (data.autonomy_level as AutonomyLevel) ?? "approval";
  return {
    allowed: level === "auto",
    level,
    requiresApproval: level === "approval",
    rule: data as PolicyDecision["rule"],
    message: DECISION_MSG[level],
    category,
  };
}

/** Mapa de palavras-chave → categoria para classificar mensagens do simulador. */
const KEYWORD_MAP: [RegExp, string][] = [
  [/calha|rufo|pingadeira|chamin|cano|condutor/i, "Calhas"],
  [/esquadria|janela|porta|vidro|box|persiana|grade|portão|sacada|fachada/i, "Esquadrias"],
  [/orçamento|preço|valor|custo|quanto custa|cotação/i, "Orçamentos"],
  [/desconto|negoci|proposta|concorrente|parcel/i, "Negociação"],
  [/agenda|visita|horário|agendar|marcar|data/i, "Agenda"],
  [/pagamento|pix|cartão|boleto|entrada|saldo|parcela/i, "Pagamentos"],
  [/contrato|assinar|documento|termo/i, "Contratos"],
  [/produção|fabricar|prazo|entrega|status/i, "Produção"],
  [/garantia|defeito|reclamação|problema|conserto/i, "Pós-venda"],
  [/follow.?up|retorno|lembrete|acompanhamento/i, "Follow-up"],
  [/whatsapp|mensagem|atendimento|chamar|ligar/i, "WhatsApp"],
  [/integração|crm|sistema|cadastro|registro/i, "Integração CRM"],
  [/segurança|senha|acesso|permissão|bloqueio/i, "Segurança"],
  [/foto|imagem|vídeo|áudio|arquivo|pdf|planta/i, "Multimídia"],
];

export function classifyMessage(text: string): string {
  for (const [re, cat] of KEYWORD_MAP) {
    if (re.test(text)) return cat;
  }
  return "Triagem";
}
