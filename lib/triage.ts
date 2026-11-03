type Message = { role: string; content: string; timestamp: string };

/** Texto para exibir: objetos/listas gravados pela IA viram texto legivel. */
function asText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ") || null;
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}: ${asText(v) ?? "-"}`).join("; ") || null;
  return String(value);
}

function asBoolean(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  return ["true", "sim", "s", "1", "yes"].includes(String(value).trim().toLowerCase());
}

function asMessages(value: unknown): Message[] {
  const list = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && typeof m === "object")
    .map((m) => ({ role: String(m.role ?? "assistant"), content: asText(m.content) ?? "", timestamp: asText(m.timestamp) ?? "" }));
}

/**
 * Conversas gravadas por versoes antigas, pela IA ou fora do CRM podem vir
 * com campos vazios ou em outro formato (objeto no lugar de texto, mensagens
 * como texto); a tela nao pode quebrar por isso.
 */
export function normalizeTriageSession<T extends Record<string, unknown>>(row: T): T {
  const created = asText(row.created_at);
  return {
    ...row,
    phone: asText(row.phone) ?? "",
    nome: asText(row.nome),
    produto: asText(row.produto),
    tipo_servico: asText(row.tipo_servico),
    prazo: asText(row.prazo),
    prioridade: asText(row.prioridade),
    resumo_executivo: asText(row.resumo_executivo),
    necessita_visita: asBoolean(row.necessita_visita),
    possui_projeto: asBoolean(row.possui_projeto),
    possui_fotos: asBoolean(row.possui_fotos),
    eh_manutencao: asBoolean(row.eh_manutencao) ?? false,
    probabilidade: row.probabilidade == null || Number.isNaN(Number(row.probabilidade)) ? null : Number(row.probabilidade),
    messages: asMessages(row.messages),
    score: Math.max(0, Math.min(100, Number(row.score) || 0)),
    status: asText(row.status) ?? "em_andamento",
    created_at: created && !Number.isNaN(new Date(created).getTime()) ? created : new Date(0).toISOString(),
    completed_at: asText(row.completed_at),
  };
}
