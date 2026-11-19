// Adaptador do motor oficial da Calculadora de Tributos (Receita Federal — Regime Regular).
// Só cálculo/simulação: nada aqui emite nota nem lança no financeiro.
// Sem cálculo alternativo: se o motor falhar, o resultado é "indisponível", nunca uma conta própria.
import { z } from "zod";

/** Instalação online oficial (verificada em 19/11/2026). Pode ser trocada por um motor próprio. */
export const DEFAULT_MOTOR_URL = "https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api";
export const motorUrl = () => (process.env.FISCAL_MOTOR_URL || DEFAULT_MOTOR_URL).replace(/\/+$/, "");

// ─── Contrato de entrada (POST /calculadora/observabilidade/regime-geral) ────────────────
const money = z.number().finite().nonnegative().max(1e12);
export const aliquotasNominaisSchema = z.object({
  cbs: z.number().finite().nonnegative().max(100),
  ibsEstadual: z.number().finite().nonnegative().max(100),
  ibsMunicipal: z.number().finite().nonnegative().max(100),
}).passthrough(); // impostoSeletivo (adValorem/adRem) segue como o motor define
export const itemEntradaSchema = z.object({
  numero: z.number().int().positive(),
  ncm: z.string().regex(/^\d{8}$/).optional(),
  nbs: z.string().regex(/^\d{9}$/).optional(),
  cst: z.string().regex(/^\d{3}$/),
  cClassTrib: z.string().regex(/^\d{6}$/),
  // Item com Imposto Seletivo pode vir sem baseCalculo própria: a base de IBS/CBS sai do grupo do IS.
  baseCalculo: money.optional(),
  quantidade: z.number().finite().positive().optional(),
  unidade: z.string().max(6).optional(),
  impostoSeletivo: z.object({}).passthrough().optional(),
  aliquotasNominais: aliquotasNominaisSchema.optional(),
}).passthrough()
  .refine((i) => !!i.ncm !== !!i.nbs, { message: "Informe NCM (mercadoria) ou NBS (serviço), um dos dois." })
  .refine((i) => i.baseCalculo !== undefined || i.impostoSeletivo !== undefined, { message: "Informe a base de cálculo do item." });
export const operacaoSchema = z.object({
  id: z.string().min(1).max(64),
  versao: z.literal("1.0.0"),
  dhFatoGerador: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/),
  municipio: z.number().int().min(1000000).max(9999999),
  uf: z.string().regex(/^[A-Z]{2}$/),
  itens: z.array(itemEntradaSchema).min(1).max(500),
});
export type OperacaoFiscal = z.infer<typeof operacaoSchema>;

// ─── Contrato de saída ───────────────────────────────────────────────────────────────────
export const ESTADOS_ITEM = ["CALCULADO", "CALCULO_SIMULADO", "INCONSISTENCIA_ENTRADA", "NAO_IMPLEMENTADO", "FALHA_TECNICA"] as const;
const dec = z.string().regex(/^-?\d+(\.\d+)?$/);
const grupoTributo = z.object({ memoriaCalculo: z.string().optional() }).passthrough();
const erroItem = z.object({ code: z.string(), title: z.string().optional(), detail: z.string().optional(), pointer: z.string().optional() }).passthrough();
const objetoSchema = z.object({
  nObj: z.number().int(),
  estadoItem: z.enum(ESTADOS_ITEM),
  tribCalc: z.object({
    IBSCBS: z.object({
      CST: z.string(), cClassTrib: z.string(),
      gIBSCBS: z.object({
        vBC: dec,
        gIBSUF: grupoTributo.and(z.object({ vIBSUF: dec })),
        gIBSMun: grupoTributo.and(z.object({ vIBSMun: dec })),
        vIBS: dec,
        gCBS: grupoTributo.and(z.object({ vCBS: dec })),
      }).passthrough().optional(),
    }).passthrough().optional(),
    IS: z.object({ vIS: dec.optional() }).passthrough().optional(),
  }).passthrough().optional(),
  erros: z.array(erroItem).optional(),
}).passthrough();
export const respostaSchema = z.object({
  objetos: z.array(objetoSchema),
  total: z.object({
    tribCalc: z.object({
      ISTot: z.object({ vIS: dec }).passthrough().optional(),
      IBSCBSTot: z.object({
        vBCIBSCBS: dec,
        gIBS: z.object({ vIBS: dec }).passthrough(),
        gCBS: z.object({ vCBS: dec }).passthrough(),
      }).passthrough().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();
export type RespostaMotor = z.infer<typeof respostaSchema>;
export const versaoSchema = z.object({ versaoApp: z.string(), versaoDb: z.string(), dataVersaoDb: z.string().optional(), descricaoVersaoDb: z.string().optional(), ambiente: z.string().optional() }).passthrough();
export type VersaoMotor = z.infer<typeof versaoSchema>;

export type ResultadoMotor<T> =
  | { ok: true; data: T; simulado: boolean; aviso: string | null; ms: number }
  | { ok: false; motivo: "indisponivel" | "entrada_invalida" | "resposta_invalida" | "recusado"; mensagem: string; ms: number };

// ─── Circuit breaker (por instância do servidor) ─────────────────────────────────────────
const FALHAS_PARA_ABRIR = 3;
const ABERTO_MS = 60_000;
const breaker = { falhas: 0, abertoAte: 0 };
export function _resetBreaker() { breaker.falhas = 0; breaker.abertoAte = 0; }
const falhou = () => { breaker.falhas += 1; if (breaker.falhas >= FALHAS_PARA_ABRIR) breaker.abertoAte = Date.now() + ABERTO_MS; };
const deuCerto = () => { breaker.falhas = 0; breaker.abertoAte = 0; };

type Fetch = typeof fetch;
async function chamar(path: string, init: RequestInit, opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}) {
  const f = opts.fetchImpl ?? fetch;
  const url = `${motorUrl()}${path}`;
  // Uma nova tentativa só para falha de rede ou 5xx (nunca para 4xx: entrada errada não melhora repetindo).
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await f(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), cache: "no-store" });
      if (r.status >= 500 && tentativa < 2) continue;
      return r;
    } catch (e) {
      if (tentativa < 2) continue;
      throw e;
    }
  }
}

/** Calcula IBS/CBS/IS de uma operação, com erro por item (o resto continua). */
export async function calcularOperacao(op: unknown, opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<ResultadoMotor<RespostaMotor>> {
  const t0 = Date.now();
  const entrada = operacaoSchema.safeParse(op);
  if (!entrada.success) return { ok: false, motivo: "entrada_invalida", mensagem: entrada.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), ms: 0 };
  if (Date.now() < breaker.abertoAte) return { ok: false, motivo: "indisponivel", mensagem: "Motor oficial indisponível há pouco; nova tentativa em instantes.", ms: 0 };
  let r: Response;
  try {
    r = await chamar("/calculadora/observabilidade/regime-geral", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(entrada.data) }, opts);
  } catch {
    falhou();
    return { ok: false, motivo: "indisponivel", mensagem: "O motor oficial da Receita não respondeu.", ms: Date.now() - t0 };
  }
  if (r.status >= 500) { falhou(); return { ok: false, motivo: "indisponivel", mensagem: `Motor oficial com erro (HTTP ${r.status}).`, ms: Date.now() - t0 }; }
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    deuCerto();
    const detalhe = body && typeof body === "object" ? String((body as { detail?: unknown; title?: unknown }).detail ?? (body as { title?: unknown }).title ?? "") : "";
    return { ok: false, motivo: "recusado", mensagem: `Motor recusou a operação (HTTP ${r.status})${detalhe ? `: ${detalhe}` : ""}`, ms: Date.now() - t0 };
  }
  const saida = respostaSchema.safeParse(body);
  if (!saida.success) { falhou(); return { ok: false, motivo: "resposta_invalida", mensagem: "Resposta do motor fora do formato esperado.", ms: Date.now() - t0 }; }
  deuCerto();
  const aviso = r.headers.get("x-warning-dados-simulados");
  const simulado = !!aviso || saida.data.objetos.some((o) => o.estadoItem === "CALCULO_SIMULADO");
  return { ok: true, data: saida.data, simulado, aviso, ms: Date.now() - t0 };
}

/** Versão do app e da base oficial (registrada em cada cálculo). */
export async function versaoMotor(opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<ResultadoMotor<VersaoMotor>> {
  const t0 = Date.now();
  try {
    const r = await chamar("/calculadora/dados-abertos/versao", { method: "GET", headers: { Accept: "application/json" } }, { timeoutMs: 8000, ...opts });
    const v = versaoSchema.safeParse(await r.json().catch(() => null));
    if (!r.ok || !v.success) return { ok: false, motivo: "resposta_invalida", mensagem: `Versão do motor indisponível (HTTP ${r.status}).`, ms: Date.now() - t0 };
    return { ok: true, data: v.data, simulado: false, aviso: null, ms: Date.now() - t0 };
  } catch {
    return { ok: false, motivo: "indisponivel", mensagem: "O motor oficial da Receita não respondeu.", ms: Date.now() - t0 };
  }
}

/** Alíquota de referência oficial (União = CBS, UF = IBS estadual, município = IBS municipal). Null quando a base oficial não tem. */
export async function aliquotaReferencia(ente: "uniao" | "uf" | "municipio", data: string, codigo?: number, opts: { fetchImpl?: Fetch } = {}): Promise<number | null> {
  const q = ente === "uniao" ? `data=${data}` : ente === "uf" ? `codigoUf=${codigo}&data=${data}` : `codigoMunicipio=${codigo}&data=${data}`;
  try {
    const r = await chamar(`/calculadora/dados-abertos/aliquota-${ente}?${q}`, { method: "GET", headers: { Accept: "application/json" } }, { timeoutMs: 8000, ...opts });
    if (!r.ok) return null;
    const v = z.object({ aliquotaReferencia: z.number() }).safeParse(await r.json().catch(() => null));
    return v.success ? v.data.aliquotaReferencia : null;
  } catch { return null; }
}

/** Valores por item para gravar/mostrar (texto decimal do motor → número com 2 casas). */
export function resumoItens(resp: RespostaMotor) {
  return resp.objetos.map((o) => {
    const g = o.tribCalc?.IBSCBS?.gIBSCBS;
    const memorias = g ? [g.gCBS.memoriaCalculo, g.gIBSUF.memoriaCalculo, g.gIBSMun.memoriaCalculo].filter((m): m is string => !!m) : [];
    return {
      numero: o.nObj,
      estado: o.estadoItem,
      base: g ? Number(g.vBC) : null,
      cbs: g ? Number(g.gCBS.vCBS) : null,
      ibsUf: g ? Number(g.gIBSUF.vIBSUF) : null,
      ibsMun: g ? Number(g.gIBSMun.vIBSMun) : null,
      ibs: g ? Number(g.vIBS) : null,
      is: o.tribCalc?.IS?.vIS != null ? Number(o.tribCalc.IS.vIS) : null,
      memoria: [...new Set(memorias)].join("\n"),
      erros: (o.erros ?? []).map((e) => ({ codigo: e.code, titulo: e.title ?? "", detalhe: e.detail ?? "" })),
    };
  });
}
