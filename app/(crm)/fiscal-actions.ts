"use server";
// Calculadora fiscal: simular IBS/CBS/IS de um orçamento com o motor oficial, classificar produtos
// (o financeiro aprova) e configurar. Não emite nota e não lança nada no financeiro.
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { selectOwnProfile } from "@/lib/own-profile";
import { calcularOperacao, motorUrl, versaoMotor } from "@/lib/fiscal/motor";
import { chaveProduto, consolidar, exigeAliquotas, montarOperacao, type AliquotasInformadas, type Classificacao } from "@/lib/fiscal/calculadora";

type Erro = { ok: false; error: string };
const uuid = z.string().uuid();
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const refresh = () => { revalidatePath("/fiscal"); };

export type Simulacao = {
  ok: true; id: string; simulado: boolean; aviso: string | null; status: "calculado" | "parcial" | "sem_calculo";
  versao: string; totais: { total_base: number; total_cbs: number; total_ibs: number; total_is: number };
  itens: { numero: number; produto: string; estado: string; base: number | null; cbs: number | null; ibs: number | null; is_valor: number | null; memoria: string; erros: { codigo: string; titulo: string; detalhe: string }[] }[];
};

async function configuracao(db: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await db.from("fiscal_settings").select("enabled,regime,uf,municipio_ibge,aliquotas_informadas").maybeSingle();
  return data as { enabled: boolean; regime: string; uf: string | null; municipio_ibge: number | null; aliquotas_informadas: Record<string, AliquotasInformadas> } | null;
}

/** Simula os tributos de um orçamento (ou de itens avulsos) e grava no histórico. */
export async function simularTributos(input: { quoteId?: string; data: string; itens?: { produto: string; quantidade: number; valor: number }[] }): Promise<Simulacao | Erro> {
  const p = z.object({ quoteId: uuid.optional(), data: iso, itens: z.array(z.object({ produto: z.string().trim().min(1).max(200), quantidade: z.number().positive(), valor: z.number().nonnegative() })).max(200).optional() }).safeParse(input);
  if (!p.success || (!p.data.quoteId && !p.data.itens?.length)) return { ok: false, error: "Escolha um orçamento ou informe os itens." };
  const db = await createClient();
  const { data: pode } = await db.rpc("has_table_access", { resource: "fiscal", action: "insert" });
  if (pode !== true) return { ok: false, error: "Sem permissão para a calculadora fiscal." };
  const cfg = await configuracao(db);
  if (!cfg?.enabled) return { ok: false, error: "A calculadora fiscal está desligada. Ligue em Tributos → Configuração." };
  if (!cfg.uf || !cfg.municipio_ibge) return { ok: false, error: "Informe a UF e o município (código IBGE) na configuração fiscal." };

  let itens = p.data.itens ?? [];
  let desconto = 0, frete = 0, quoteNumber: string | null = null;
  if (p.data.quoteId) {
    const { data: q } = await db.from("quotes").select("id,quote_number,discount,freight,quote_items(product,quantity,unit_price,unit)").eq("id", p.data.quoteId).maybeSingle();
    if (!q) return { ok: false, error: "Orçamento não encontrado." };
    const qi = (q.quote_items ?? []) as { product: string; quantity: number; unit_price: number; unit: string | null }[];
    itens = qi.map((i) => ({ produto: i.product, quantidade: Number(i.quantity), valor: Math.round(Number(i.quantity) * Number(i.unit_price) * 100) / 100 }));
    desconto = Number(q.discount ?? 0); frete = Number(q.freight ?? 0); quoteNumber = q.quote_number as string;
  }
  if (!itens.length) return { ok: false, error: "O orçamento não tem itens." };
  const { data: cls } = await db.from("fiscal_classifications").select("produto_chave,natureza,ncm,nbs,cst,cclasstrib,unidade,status").in("produto_chave", itens.map((i) => chaveProduto(i.produto)));
  const aliquotas = exigeAliquotas(p.data.data) ? cfg.aliquotas_informadas?.[p.data.data.slice(0, 4)] ?? null : null;
  const m = montarOperacao({ id: quoteNumber ?? "avulso", data: p.data.data, uf: cfg.uf, municipio: cfg.municipio_ibge, itens, desconto, frete, classificacoes: (cls ?? []) as Classificacao[], aliquotas });
  if (!m.operacao) return { ok: false, error: m.erro ?? "Nada para calcular." };

  const [r, v] = await Promise.all([calcularOperacao(m.operacao), versaoMotor()]);
  if (!r.ok) return { ok: false, error: r.motivo === "indisponivel" ? `${r.mensagem} A simulação não foi feita (o sistema não calcula por conta própria).` : r.mensagem };
  const c = consolidar(r.data, m.produtoPorNumero, m.pendentes);
  const versao = v.ok ? `${v.data.versaoApp} · base ${v.data.versaoDb}` : "versão não informada";
  const chave = createHash("sha256").update(JSON.stringify([p.data.quoteId ?? null, m.operacao, aliquotas, v.ok ? v.data.versaoDb : null])).digest("hex").slice(0, 40);
  const { data: id, error } = await db.rpc("save_fiscal_calculation", { p: {
    origem: p.data.quoteId ? "orcamento" : "avulso", quote_id: p.data.quoteId ?? null, data_fato_gerador: p.data.data,
    motor: motorUrl(), versao_app: v.ok ? v.data.versaoApp : null, versao_db: v.ok ? v.data.versaoDb : null,
    simulado: r.simulado || !!aliquotas, aviso: r.aviso, aliquotas, status: c.status, ...c.totais,
    entrada: m.operacao, resposta: r.data, idempotency_key: chave, itens: c.itens,
  } });
  if (error || !id) return { ok: false, error: error?.message ?? "Não foi possível gravar a simulação." };
  refresh();
  return { ok: true, id: String(id), simulado: r.simulado || !!aliquotas, aviso: r.aviso, status: c.status, versao, totais: c.totais, itens: c.itens };
}

const classificacaoSchema = z.object({
  produto: z.string().trim().min(1).max(200),
  natureza: z.enum(["mercadoria", "servico"]),
  ncm: z.string().regex(/^\d{8}$/).nullable(),
  nbs: z.string().regex(/^\d{9}$/).nullable(),
  cst: z.string().regex(/^\d{3}$/).nullable(),
  cclasstrib: z.string().regex(/^\d{6}$/).nullable(),
  unidade: z.string().trim().max(6).nullable(),
  observacao: z.string().trim().max(500).nullable(),
});
const limpo = (v: unknown) => { const s = typeof v === "string" ? v.replace(/[.\s-]/g, "").trim() : ""; return s ? s : null; };

/** Salva (como rascunho) a classificação de um produto. Mudar códigos tira a aprovação. */
export async function salvarClassificacao(input: Record<string, unknown>): Promise<{ ok: true } | Erro> {
  const natureza = input.natureza === "servico" ? "servico" : "mercadoria";
  const p = classificacaoSchema.safeParse({
    produto: input.produto, natureza,
    ncm: natureza === "mercadoria" ? limpo(input.ncm) : null, nbs: natureza === "servico" ? limpo(input.nbs) : null,
    cst: limpo(input.cst), cclasstrib: limpo(input.cclasstrib),
    unidade: typeof input.unidade === "string" && input.unidade.trim() ? input.unidade.trim().toUpperCase() : null,
    observacao: typeof input.observacao === "string" && input.observacao.trim() ? input.observacao.trim() : null,
  });
  if (!p.success) return { ok: false, error: "Revise os códigos: NCM 8 dígitos (mercadoria), NBS 9 dígitos (serviço), CST 3 e cClassTrib 6." };
  const db = await createClient();
  const chave = chaveProduto(p.data.produto);
  const { data: atual } = await db.from("fiscal_classifications").select("id").eq("produto_chave", chave).maybeSingle();
  const { error } = atual
    ? await db.from("fiscal_classifications").update(p.data).eq("id", atual.id)
    : await db.from("fiscal_classifications").insert({ ...p.data, produto_chave: chave });
  if (error) return { ok: false, error: /row-level|permission/i.test(error.message) ? "Sem permissão para classificar." : error.message };
  refresh();
  return { ok: true };
}

/** Aprova a classificação (só financeiro, gerência ou administrador — conferido no banco). */
export async function aprovarClassificacao(id: string, aprovar = true): Promise<{ ok: true } | Erro> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Classificação inválida." };
  const db = await createClient();
  const { data, error } = await db.from("fiscal_classifications").update({ status: aprovar ? "aprovada" : "rascunho" }).eq("id", id).select("id");
  if (error) return { ok: false, error: /check/i.test(error.message) ? "Para aprovar, preencha NCM (ou NBS), CST e cClassTrib." : error.message };
  if (!data?.length) return { ok: false, error: "Sem permissão para aprovar." };
  refresh();
  return { ok: true };
}

const configSchema = z.object({
  enabled: z.boolean(), regime: z.enum(["simples", "hibrido", "regular"]),
  uf: z.string().regex(/^[A-Z]{2}$/), municipio_ibge: z.number().int().min(1000000).max(9999999),
  aliquotas_informadas: z.record(z.string().regex(/^20\d{2}$/), z.object({ cbs: z.number().min(0).max(100), ibsEstadual: z.number().min(0).max(100), ibsMunicipal: z.number().min(0).max(100), fonte: z.string().trim().min(3).max(200) })),
});

export async function salvarConfiguracaoFiscal(input: unknown): Promise<{ ok: true } | Erro> {
  const p = configSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Revise: UF (2 letras), município (código IBGE de 7 dígitos) e, nas alíquotas informadas, a fonte de cada ano." };
  const db = await createClient();
  const { data: me } = await selectOwnProfile<{ company_id: string | null }>(db, "company_id");
  if (!me?.company_id) return { ok: false, error: "Sessão expirada." };
  const { error } = await db.from("fiscal_settings").upsert({ company_id: me.company_id, ...p.data, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return { ok: false, error: /row-level|permission/i.test(error.message) ? "Sem permissão para mudar a configuração fiscal." : error.message };
  refresh();
  return { ok: true };
}

/** Situação do motor oficial (versão do app e da base). */
export async function statusMotor(): Promise<{ ok: true; versao: string; base: string; data: string | null; url: string } | Erro> {
  const v = await versaoMotor();
  if (!v.ok) return { ok: false, error: v.mensagem };
  return { ok: true, versao: v.data.versaoApp, base: v.data.versaoDb, data: v.data.dataVersaoDb ?? null, url: motorUrl() };
}
