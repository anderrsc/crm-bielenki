// Extrato por conta: filtros e formato do resultado da RPC account_statement.
import { validIsoDate } from "@/lib/valid-date";

export type StatementMove = { data: string; tipo: "saldo_inicial" | "entrada" | "saida"; descricao: string; pessoa: string | null; forma: string | null; valor: number; saldo: number };
export type Statement = {
  conta: { id: string; nome: string; detalhes: string | null; ativa: boolean; saldo_inicial_data: string | null };
  de: string; ate: string; saldo_anterior: number; entradas: number; saidas: number; saldo_final: number; movimentos: StatementMove[];
};

/** Período padrão: do primeiro dia do mês até hoje. Datas inválidas voltam ao padrão. */
export function statementPeriod(de: string | undefined, ate: string | undefined, today: string) {
  const to = ate && validIsoDate(ate) ? ate : today;
  const from = de && validIsoDate(de) ? de : `${to.slice(0, 8)}01`;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function parseStatement(raw: unknown): Statement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const conta = r.conta as Statement["conta"] | undefined;
  if (!conta?.id) return null;
  return {
    conta, de: String(r.de), ate: String(r.ate),
    saldo_anterior: n(r.saldo_anterior), entradas: n(r.entradas), saidas: n(r.saidas), saldo_final: n(r.saldo_final),
    movimentos: (Array.isArray(r.movimentos) ? r.movimentos : []).map((m: Record<string, unknown>) => ({
      data: String(m.data), tipo: m.tipo as StatementMove["tipo"], descricao: String(m.descricao ?? ""), pessoa: (m.pessoa as string | null) ?? null,
      forma: (m.forma as string | null) ?? null, valor: n(m.valor), saldo: n(m.saldo),
    })),
  };
}

const FORMAS: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", transferencia: "Transferência", boleto: "Boleto", cartao: "Cartão", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito", cheque: "Cheque" };
export const formaLabel = (v: string | null) => (v ? FORMAS[v.toLowerCase()] ?? v : "");
