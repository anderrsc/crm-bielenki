import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { _resetBreaker, aliquotaReferencia, calcularOperacao, motorUrl, resumoItens, versaoMotor, DEFAULT_MOTOR_URL } from "@/lib/fiscal/motor";

// Respostas gravadas do motor oficial 1.6.1 (rodado localmente em 19/11/2026), não inventadas.
const json = (f: string) => JSON.parse(readFileSync(`tests/fixtures/fiscal/${f}`, "utf8"));
const exemplo = json("operacao-exemplo-oficial.json");
const respExemplo = json("resposta-oficial-exemplo-1.6.1.json");
const op2026 = json("operacao-2026.json");
const resp2026 = json("resposta-oficial-2026-1.6.1.json");
const res = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => { _resetBreaker(); delete process.env.FISCAL_MOTOR_URL; });

describe("motor oficial: chamada e contrato", () => {
  test("usa a instalação online oficial por padrão e manda a operação validada", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => res(200, resp2026));
    const r = await calcularOperacao(op2026, { fetchImpl: f as unknown as typeof fetch });
    expect(motorUrl()).toBe(DEFAULT_MOTOR_URL);
    expect(String(f.mock.calls[0][0])).toBe(`${DEFAULT_MOTOR_URL}/calculadora/observabilidade/regime-geral`);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual(op2026);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.simulado).toBe(false);
    // 2026, base 1.000: CBS 0,9% = 9,00; IBS UF 0,1% = 1,00 (valores da resposta oficial).
    expect(resumoItens(r.data)[0]).toMatchObject({ numero: 1, estado: "CALCULADO", base: 1000, cbs: 9, ibsUf: 1, ibsMun: 0, ibs: 1 });
    expect(resumoItens(r.data)[0].memoria).toMatch(/LC 214\/2025/);
    expect(resumoItens(r.data)[1]).toMatchObject({ estado: "INCONSISTENCIA_ENTRADA", cbs: null, erros: [{ codigo: "REG-005" }] });
  });

  test("exemplo oficial: totais e estados iguais aos publicados; aviso de simulação vira 'simulado'", async () => {
    const r = await calcularOperacao(exemplo, { fetchImpl: (async () => res(200, respExemplo, { "x-warning-dados-simulados": "aliquotas informadas" })) as unknown as typeof fetch });
    expect(r.ok && r.simulado).toBe(true);
    if (!r.ok) return;
    expect(r.aviso).toBe("aliquotas informadas");
    const t = r.data.total.tribCalc;
    expect([t.ISTot?.vIS, t.IBSCBSTot?.vBCIBSCBS, t.IBSCBSTot?.gIBS.vIBS, t.IBSCBSTot?.gCBS.vCBS]).toEqual(["15.00", "1465.00", "0.64", "56.76"]);
    expect(resumoItens(r.data).map((i) => i.estado)).toEqual(["CALCULO_SIMULADO", "CALCULO_SIMULADO", "CALCULO_SIMULADO", "INCONSISTENCIA_ENTRADA"]);
    expect(resumoItens(r.data)[2]).toMatchObject({ cbs: 42.24, ibs: 0.48 });
  });

  test("URL configurável (motor próprio) sem barra no fim", async () => {
    process.env.FISCAL_MOTOR_URL = "https://motor.exemplo.com/api/";
    const f = vi.fn(async () => res(200, resp2026));
    await calcularOperacao(op2026, { fetchImpl: f as unknown as typeof fetch });
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe("https://motor.exemplo.com/api/calculadora/observabilidade/regime-geral");
  });
});

describe("validação e falhas: nunca inventa resultado", () => {
  test("entrada sem NCM/NBS, cClassTrib errado ou município inválido nem chega ao motor", async () => {
    const f = vi.fn();
    for (const ruim of [
      { ...op2026, itens: [{ ...op2026.itens[0], ncm: undefined }] },
      { ...op2026, itens: [{ ...op2026.itens[0], cClassTrib: "1" }] },
      { ...op2026, municipio: 12 },
    ]) expect(await calcularOperacao(ruim, { fetchImpl: f as unknown as typeof fetch })).toMatchObject({ ok: false, motivo: "entrada_invalida" });
    expect(f).not.toHaveBeenCalled();
  });

  test("422 do motor = recusado com o detalhe (sem nova tentativa)", async () => {
    const f = vi.fn(async () => res(422, { title: "Erro", detail: "NCM não vinculada" }));
    const r = await calcularOperacao(op2026, { fetchImpl: f as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: false, motivo: "recusado" });
    if (!r.ok) expect(r.mensagem).toMatch(/NCM não vinculada/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("falha de rede ou 5xx: uma nova tentativa e depois 'indisponível'", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(res(200, resp2026));
    expect((await calcularOperacao(op2026, { fetchImpl: f as unknown as typeof fetch })).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    const g = vi.fn(async () => res(503, {}));
    expect(await calcularOperacao(op2026, { fetchImpl: g as unknown as typeof fetch })).toMatchObject({ ok: false, motivo: "indisponivel" });
    expect(g).toHaveBeenCalledTimes(2);
  });

  test("tempo esgotado vira 'indisponível'", async () => {
    const lento = (async (_u: unknown, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("timeout"))))) as unknown as typeof fetch;
    expect(await calcularOperacao(op2026, { fetchImpl: lento, timeoutMs: 20 })).toMatchObject({ ok: false, motivo: "indisponivel" });
  });

  test("resposta fora do contrato é rejeitada (não mostra número duvidoso)", async () => {
    const r = await calcularOperacao(op2026, { fetchImpl: (async () => res(200, { objetos: [{ nObj: 1, estadoItem: "QUALQUER" }] })) as unknown as typeof fetch });
    expect(r).toMatchObject({ ok: false, motivo: "resposta_invalida" });
  });

  test("circuit breaker: depois de 3 falhas seguidas para de chamar por 1 minuto", async () => {
    const f = vi.fn(async () => { throw new Error("down"); });
    for (let i = 0; i < 3; i++) await calcularOperacao(op2026, { fetchImpl: f as unknown as typeof fetch });
    const chamadas = f.mock.calls.length;
    expect(await calcularOperacao(op2026, { fetchImpl: f as unknown as typeof fetch })).toMatchObject({ ok: false, motivo: "indisponivel" });
    expect(f.mock.calls.length).toBe(chamadas);
  });
});

test("versão e alíquota de referência: lê o que o motor tem; sem alíquota oficial devolve null", async () => {
  const v = await versaoMotor({ fetchImpl: (async () => res(200, { versaoApp: "1.7.2-0d9b30c1", versaoDb: "V0073", dataVersaoDb: "2026-11-09", ambiente: "apr" })) as unknown as typeof fetch });
  expect(v).toMatchObject({ ok: true, data: { versaoApp: "1.7.2-0d9b30c1", versaoDb: "V0073" } });
  expect(await aliquotaReferencia("uniao", "2026-11-19", undefined, { fetchImpl: (async () => res(200, { aliquotaReferencia: 0.9 })) as unknown as typeof fetch })).toBe(0.9);
  // Base oficial sem alíquota de 2027: 404 "Alíquota não encontrada" -> null (a calculadora não inventa).
  expect(await aliquotaReferencia("uf", "2027-03-10", 42, { fetchImpl: (async () => res(404, { title: "Alíquota não encontrada" })) as unknown as typeof fetch })).toBeNull();
});
