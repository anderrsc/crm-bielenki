import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { basesDeCalculo, consolidar, exigeAliquotas, montarOperacao, type Classificacao } from "@/lib/fiscal/calculadora";
import { operacaoSchema, respostaSchema } from "@/lib/fiscal/motor";

const calha: Classificacao = { produto_chave: "calha de beiral", natureza: "mercadoria", ncm: "76109000", nbs: null, cst: "000", cclasstrib: "000001", unidade: "M", status: "aprovada" };
const instalacao: Classificacao = { produto_chave: "mão de obra para instalação de calhas", natureza: "servico", ncm: null, nbs: "107021000", cst: "000", cclasstrib: "000001", unidade: null, status: "aprovada" };
const base = { id: "orc-1", data: "2026-11-19", uf: "SC", municipio: 4208906 };

test("rateio de desconto e frete fecha no centavo e não mexe no preço do item", () => {
  expect(basesDeCalculo([100, 200, 300], 60, 0)).toEqual([90, 180, 270]);
  expect(basesDeCalculo([33.33, 33.33, 33.34], 10, 0).reduce((a, b) => a + b, 0)).toBeCloseTo(90, 10);
  expect(basesDeCalculo([1000, 500], 0, 30)).toEqual([1020, 510]);
  expect(basesDeCalculo([0, 0], 10, 0)).toEqual([0, 0]);
});

test("só itens com classificação aprovada vão ao motor; o resto vira pendência (não inventa)", () => {
  const r = montarOperacao({ ...base, itens: [
    { produto: "Calha de Beiral", quantidade: 10, valor: 1000 },
    { produto: "Rufo Chapéu", quantidade: 2, valor: 100 },
    { produto: "Mão de obra para instalação de calhas", quantidade: 1, valor: 300 },
  ], classificacoes: [calha, instalacao, { ...calha, produto_chave: "rufo chapéu", status: "rascunho" }] });
  expect(r.erro).toBeNull();
  expect(operacaoSchema.safeParse(r.operacao).success).toBe(true);
  expect(r.operacao!.itens).toEqual([
    { numero: 1, ncm: "76109000", cst: "000", cClassTrib: "000001", baseCalculo: 1000, quantidade: 10, unidade: "M" },
    { numero: 2, nbs: "107021000", cst: "000", cClassTrib: "000001", baseCalculo: 300, quantidade: 1 },
  ]);
  expect(r.operacao!.dhFatoGerador).toBe("2026-11-19T12:00:00-03:00");
  expect(r.produtoPorNumero).toEqual({ 1: "Calha de Beiral", 2: "Mão de obra para instalação de calhas" });
  expect(r.pendentes).toEqual([{ produto: "Rufo Chapéu", motivo: "Classificação ainda não aprovada pelo financeiro" }]);
  expect(montarOperacao({ ...base, itens: [{ produto: "Peça nova", quantidade: 1, valor: 10 }], classificacoes: [] }))
    .toMatchObject({ operacao: null, erro: "Nenhum item com classificação fiscal aprovada.", pendentes: [{ motivo: "Sem classificação fiscal" }] });
});

test("2027: sem alíquota informada não calcula; com ela, manda aliquotasNominais (resultado simulado)", () => {
  expect(exigeAliquotas("2026-12-31")).toBe(false);
  expect(exigeAliquotas("2027-01-01")).toBe(true);
  const sem = montarOperacao({ ...base, data: "2027-03-10", itens: [{ produto: "Calha de beiral", quantidade: 1, valor: 100 }], classificacoes: [calha] });
  expect(sem.operacao).toBeNull();
  expect(sem.erro).toMatch(/ainda não tem alíquota de 2027/);
  const com = montarOperacao({ ...base, data: "2027-03-10", itens: [{ produto: "Calha de beiral", quantidade: 1, valor: 100 }], classificacoes: [calha], aliquotas: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05, fonte: "teste" } });
  expect(com.operacao!.itens[0].aliquotasNominais).toEqual({ cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 });
  // 2026: o motor proíbe alíquotas informadas, então não manda.
  const r26 = montarOperacao({ ...base, itens: [{ produto: "Calha de beiral", quantidade: 1, valor: 100 }], classificacoes: [calha], aliquotas: { cbs: 1, ibsEstadual: 1, ibsMunicipal: 1 } });
  expect(r26.operacao!.itens[0].aliquotasNominais).toBeUndefined();
});

test("consolida a resposta oficial: totais só do que foi calculado, erros e pendências por item", () => {
  const resp = respostaSchema.parse(JSON.parse(readFileSync("tests/fixtures/fiscal/resposta-oficial-2026-1.6.1.json", "utf8")));
  const c = consolidar(resp, { 1: "Calha de beiral", 2: "Peça X" }, [{ produto: "Rufo", motivo: "Sem classificação fiscal" }]);
  expect(c.totais).toEqual({ total_base: 1000, total_cbs: 9, total_ibs: 1, total_is: 0 });
  expect(c.status).toBe("parcial");
  expect(c.itens.map((i) => [i.numero, i.produto, i.estado])).toEqual([[1, "Calha de beiral", "CALCULADO"], [2, "Peça X", "INCONSISTENCIA_ENTRADA"], [3, "Rufo", "SEM_CLASSIFICACAO"]]);
  expect(c.itens[1].erros[0].codigo).toBe("REG-005");
});

test("CSV para o contador: ';', vírgula decimal, aspas quando preciso e marca de simulado", async () => {
  const { fiscalCsv } = await import("@/lib/fiscal/export");
  const csv = fiscalCsv([{ numero: 1, produto: 'Calha "beiral"; 15cm', estado: "CALCULADO", base: 1000, cbs: 9, ibs_uf: 1, ibs_mun: 0, ibs: 1, is_valor: null,
    calc: { created_at: "2026-11-19T15:00:00Z", data_fato_gerador: "2026-11-19", origem: "orcamento", simulado: false, versao_app: "1.7.2", versao_db: "V0073", quote: { quote_number: "ORC-2026-00010" } } }]);
  const [head, linha] = csv.replace("﻿", "").trim().split("\r\n");
  expect(head.split(";")).toHaveLength(15);
  expect(linha).toBe('2026-11-19 15:00:00;ORC-2026-00010;2026-11-19;1;"Calha ""beiral""; 15cm";CALCULADO;1000,00;9,00;1,00;0,00;1,00;;não;1.7.2;V0073');
});
