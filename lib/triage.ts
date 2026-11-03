/**
 * Conversas gravadas por versoes antigas (ou fora do CRM) podem vir sem
 * mensagens, pontuacao ou status; a tela nao pode quebrar por isso.
 */
export function normalizeTriageSession<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    messages: Array.isArray(row.messages) ? row.messages.filter((m) => m && typeof m === "object") : [],
    score: Number(row.score) || 0,
    status: typeof row.status === "string" ? row.status : "em_andamento",
    phone: row.phone ?? "",
    created_at: row.created_at ?? new Date(0).toISOString(),
  };
}
