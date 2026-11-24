// Tipos compartilhados do motor LIA V2.
export type AutonomyLevel = "auto" | "approval" | "human_only" | "forbidden";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ValidationStatus = "pending" | "validated" | "needs_review" | "archived";

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
  auto: "Automático",
  approval: "Aprovação",
  human_only: "Só humano",
  forbidden: "Proibido",
};
export const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  critical: "Crítico",
};
export const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  pending: "Pendente",
  validated: "Validado",
  needs_review: "Revisar",
  archived: "Arquivado",
};

export type LiaRuleRow = {
  id: string;
  rule_number: number | null;
  block_id: number | null;
  category: string;
  title: string;
  name: string;
  is_active: boolean;
  autonomy_level: AutonomyLevel | null;
  risk_level: RiskLevel | null;
  validation_status: ValidationStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type LiaKnowledgeBlockRow = {
  id: string;
  block_number: number;
  category: string;
  rule_range_start: number;
  rule_range_end: number;
  content: string;
  is_active: boolean;
  version: number;
  updated_at: string;
};

export type LiaActionRequestRow = {
  id: string;
  request_type: string;
  title: string;
  description: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  approver_role: string | null;
  payload_json: Record<string, unknown>;
  expires_at: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  requester_name?: string | null;
};

export type LiaAuditRow = {
  id: string;
  event_type: string;
  actor_role: string | null;
  target_type: string | null;
  outcome: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor_name?: string | null;
};

export const BLOCKS: { n: number; cat: string; s: number; e: number }[] = [
  { n: 1,  cat: "Identidade",      s: 1,   e: 20  },
  { n: 2,  cat: "Empresa",         s: 21,  e: 45  },
  { n: 3,  cat: "Calhas",          s: 46,  e: 80  },
  { n: 4,  cat: "Esquadrias",      s: 81,  e: 130 },
  { n: 5,  cat: "Triagem",         s: 131, e: 165 },
  { n: 6,  cat: "Multimídia",      s: 166, e: 200 },
  { n: 7,  cat: "Orçamentos",      s: 201, e: 250 },
  { n: 8,  cat: "Negociação",      s: 251, e: 295 },
  { n: 9,  cat: "Agenda",          s: 296, e: 340 },
  { n: 10, cat: "Pagamentos",      s: 341, e: 395 },
  { n: 11, cat: "Contratos",       s: 396, e: 445 },
  { n: 12, cat: "Produção",        s: 446, e: 505 },
  { n: 13, cat: "Pós-venda",       s: 506, e: 555 },
  { n: 14, cat: "Follow-up",       s: 556, e: 605 },
  { n: 15, cat: "WhatsApp",        s: 606, e: 673 },
  { n: 16, cat: "Integração CRM",  s: 674, e: 740 },
  { n: 17, cat: "Segurança",       s: 741, e: 811 },
  { n: 18, cat: "Autonomia",       s: 812, e: 884 },
  { n: 19, cat: "Painel",          s: 885, e: 973 },
];
