// CSV das simulações fiscais (separador ";" e vírgula decimal, como o Excel em português abre).
export type LinhaFiscal = {
  numero: number; produto: string; estado: string; base: number | null; cbs: number | null; ibs_uf: number | null; ibs_mun: number | null; ibs: number | null; is_valor: number | null;
  calc: { created_at: string; data_fato_gerador: string; origem: string; simulado: boolean; versao_app: string | null; versao_db: string | null; quote: { quote_number: string } | null };
};
const n = (v: number | null) => (v == null ? "" : Number(v).toFixed(2).replace(".", ","));
const t = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function fiscalCsv(linhas: LinhaFiscal[]): string {
  const head = ["Simulado em", "Documento", "Data da operação", "Item", "Produto", "Situação", "Base", "CBS", "IBS UF", "IBS município", "IBS", "Imposto Seletivo", "Simulado", "Versão do motor", "Versão da base"];
  const rows = [...linhas].sort((a, b) => a.calc.created_at.localeCompare(b.calc.created_at) || a.numero - b.numero).map((l) => [
    l.calc.created_at.slice(0, 19).replace("T", " "), l.calc.quote?.quote_number ?? l.calc.origem, l.calc.data_fato_gerador, String(l.numero), t(l.produto), l.estado,
    n(l.base), n(l.cbs), n(l.ibs_uf), n(l.ibs_mun), n(l.ibs), n(l.is_valor), l.calc.simulado ? "sim" : "não", l.calc.versao_app ?? "", l.calc.versao_db ?? "",
  ].join(";"));
  return "﻿" + [head.join(";"), ...rows].join("\r\n") + "\r\n";
}
