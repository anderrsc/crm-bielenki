// Monta a operação para o motor oficial a partir dos itens de um orçamento/pedido e junta o resultado.
// Regras: só itens com classificação APROVADA vão para o motor; o resto vira pendência (nunca se inventa
// classificação). Preço comercial não muda: a base de cálculo é o valor do item com o desconto/frete do
// orçamento rateados proporcionalmente (centavos que sobram no último item).
import type { OperacaoFiscal, RespostaMotor } from "./motor";
import { resumoItens } from "./motor";

export type ItemComercial = { produto: string; quantidade: number; valor: number; unidade?: string | null };
export type Classificacao = { produto_chave: string; natureza: "mercadoria" | "servico"; ncm: string | null; nbs: string | null; cst: string | null; cclasstrib: string | null; unidade: string | null; status: "rascunho" | "aprovada" };
export type AliquotasInformadas = { cbs: number; ibsEstadual: number; ibsMunicipal: number; fonte?: string };

export const chaveProduto = (produto: string) => produto.replace(/\s+/g, " ").trim().toLowerCase();

/** Rateia desconto e frete pelos valores dos itens; a soma das bases fecha no centavo. */
export function basesDeCalculo(valores: number[], desconto = 0, frete = 0): number[] {
  const cents = valores.map((v) => Math.round(v * 100));
  const total = cents.reduce((a, b) => a + b, 0);
  const ajuste = Math.round((frete - desconto) * 100);
  if (!total) return valores.map(() => 0);
  const bases = cents.map((c) => c + Math.round((ajuste * c) / total));
  const alvo = total + ajuste;
  bases[bases.length - 1] += alvo - bases.reduce((a, b) => a + b, 0);
  return bases.map((b) => Math.max(0, b) / 100);
}

/** Ano do fato gerador exige alíquotas informadas? (o motor proíbe antes de 2027 e exige a partir de 2027) */
export const exigeAliquotas = (data: string) => Number(data.slice(0, 4)) >= 2027;

export function montarOperacao(input: {
  id: string; data: string; uf: string; municipio: number;
  itens: ItemComercial[]; desconto?: number; frete?: number;
  classificacoes: Classificacao[]; aliquotas?: AliquotasInformadas | null;
}): { operacao: OperacaoFiscal | null; pendentes: { produto: string; motivo: string }[]; produtoPorNumero: Record<number, string>; erro: string | null } {
  const porChave = new Map(input.classificacoes.map((c) => [c.produto_chave, c]));
  const bases = basesDeCalculo(input.itens.map((i) => i.valor), input.desconto ?? 0, input.frete ?? 0);
  const pendentes: { produto: string; motivo: string }[] = [];
  const produtoPorNumero: Record<number, string> = {};
  const precisa = exigeAliquotas(input.data);
  if (precisa && !input.aliquotas) {
    return { operacao: null, pendentes, produtoPorNumero, erro: `A base oficial ainda não tem alíquota de ${input.data.slice(0, 4)}. Informe as alíquotas do ano (com a fonte) na configuração fiscal para simular.` };
  }
  const itens: OperacaoFiscal["itens"] = [];
  input.itens.forEach((item, idx) => {
    const c = porChave.get(chaveProduto(item.produto));
    if (!c) { pendentes.push({ produto: item.produto, motivo: "Sem classificação fiscal" }); return; }
    if (c.status !== "aprovada") { pendentes.push({ produto: item.produto, motivo: "Classificação ainda não aprovada pelo financeiro" }); return; }
    const numero = itens.length + 1;
    produtoPorNumero[numero] = item.produto;
    itens.push({
      numero,
      ...(c.natureza === "servico" ? { nbs: c.nbs! } : { ncm: c.ncm! }),
      cst: c.cst!, cClassTrib: c.cclasstrib!,
      baseCalculo: bases[idx],
      ...(item.quantidade > 0 ? { quantidade: item.quantidade } : {}),
      ...((c.unidade || item.unidade) ? { unidade: String(c.unidade || item.unidade).slice(0, 6).toUpperCase() } : {}),
      ...(precisa && input.aliquotas ? { aliquotasNominais: { cbs: input.aliquotas.cbs, ibsEstadual: input.aliquotas.ibsEstadual, ibsMunicipal: input.aliquotas.ibsMunicipal } } : {}),
    });
  });
  if (!itens.length) return { operacao: null, pendentes, produtoPorNumero, erro: "Nenhum item com classificação fiscal aprovada." };
  const operacao: OperacaoFiscal = {
    id: input.id.slice(0, 64), versao: "1.0.0",
    dhFatoGerador: `${input.data}T12:00:00-03:00`,
    municipio: input.municipio, uf: input.uf, itens,
  };
  return { operacao, pendentes, produtoPorNumero, erro: null };
}

/** Itens e totais para gravar: soma só o que o motor calculou; pendentes entram como SEM_CLASSIFICACAO. */
export function consolidar(resp: RespostaMotor, produtoPorNumero: Record<number, string>, pendentes: { produto: string; motivo: string }[]) {
  const itens = resumoItens(resp).map((i) => ({
    numero: i.numero, produto: produtoPorNumero[i.numero] ?? `Item ${i.numero}`, estado: i.estado,
    base: i.base, cbs: i.cbs, ibs_uf: i.ibsUf, ibs_mun: i.ibsMun, ibs: i.ibs, is_valor: i.is, memoria: i.memoria, erros: i.erros,
  }));
  const extra = pendentes.map((p, k) => ({ numero: itens.length + k + 1, produto: p.produto, estado: "SEM_CLASSIFICACAO" as const, base: null, cbs: null, ibs_uf: null, ibs_mun: null, ibs: null, is_valor: null, memoria: "", erros: [{ codigo: "SEM_CLASSIFICACAO", titulo: p.motivo, detalhe: "" }] }));
  const ok = itens.filter((i) => i.estado === "CALCULADO" || i.estado === "CALCULO_SIMULADO");
  const soma = (k: "base" | "cbs" | "ibs" | "is_valor") => Math.round(ok.reduce((s, i) => s + (i[k] ?? 0), 0) * 100) / 100;
  const status = ok.length === 0 ? "sem_calculo" : ok.length === itens.length + extra.length ? "calculado" : "parcial";
  return { itens: [...itens, ...extra], totais: { total_base: soma("base"), total_cbs: soma("cbs"), total_ibs: soma("ibs"), total_is: soma("is_valor") }, status: status as "calculado" | "parcial" | "sem_calculo" };
}
