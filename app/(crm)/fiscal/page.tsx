import { getRequestClient } from "@/lib/supabase/server";
import { FiscalPage, type FiscalData } from "@/components/fiscal-page";
import { chaveProduto } from "@/lib/fiscal/calculadora";

// Tributos (calculadora): simulação de IBS/CBS/IS com o motor oficial da Receita. Não emite nota.
export default async function TributosPage({ searchParams }: { searchParams: Promise<{ aba?: string; orcamento?: string }> }) {
  const search = await searchParams;
  const db = await getRequestClient();
  const aba = (["calculadora", "classificacoes", "historico", "configuracao"] as const).find((a) => a === search.aba) ?? "calculadora";
  const desde = new Date(Date.now() - 365 * 86400_000).toISOString();
  const [settings, podeEditar, podeAprovar, quotes, cls, precos, itensOrc, calcs] = await Promise.all([
    db.from("fiscal_settings").select("enabled,regime,uf,municipio_ibge,aliquotas_informadas,updated_at").maybeSingle(),
    db.rpc("has_table_access", { resource: "fiscal", action: "update" }),
    db.rpc("has_role", { roles: ["administrador", "gerente", "financeiro"] }),
    db.from("quotes").select("id,quote_number,total,created_at,status,client:clients(name)").order("created_at", { ascending: false }).limit(60),
    db.from("fiscal_classifications").select("id,produto,produto_chave,natureza,ncm,nbs,cst,cclasstrib,unidade,observacao,status,aprovado_em,aprovador:profiles!fiscal_classifications_aprovado_por_fkey(full_name)").order("produto"),
    db.from("gutter_prices").select("product").eq("active", true).limit(2000),
    db.from("quote_items").select("product").order("id", { ascending: false }).limit(1500),
    db.from("fiscal_calculations").select("id,origem,data_fato_gerador,versao_app,versao_db,simulado,status,total_base,total_cbs,total_ibs,total_is,created_at,quote:quotes(quote_number),autor:profiles!fiscal_calculations_created_by_fkey(full_name)").gte("created_at", desde).order("created_at", { ascending: false }).limit(300),
  ]);
  // Produtos já vendidos ou na tabela de preços, para classificar (o que já tem classificação aparece com ela).
  const conhecidos = new Map<string, string>();
  for (const r of [...(precos.data ?? []), ...(itensOrc.data ?? [])] as { product: string }[]) {
    const nome = String(r.product ?? "").replace(/\s+/g, " ").trim();
    if (nome && !conhecidos.has(chaveProduto(nome))) conhecidos.set(chaveProduto(nome), nome);
  }
  const data: FiscalData = {
    aba,
    orcamentoInicial: search.orcamento ?? null,
    settings: (settings.data as FiscalData["settings"]) ?? null,
    podeEditar: podeEditar.data === true,
    podeAprovar: podeAprovar.data === true,
    quotes: ((quotes.data ?? []) as unknown as { id: string; quote_number: string; total: number; created_at: string; status: string; client: { name: string } | null }[])
      .map((q) => ({ id: q.id, numero: q.quote_number, cliente: q.client?.name ?? "", total: Number(q.total), data: q.created_at, status: q.status })),
    classificacoes: ((cls.data ?? []) as unknown as FiscalData["classificacoes"]),
    produtosSemClassificacao: [...conhecidos].filter(([k]) => !(cls.data ?? []).some((c) => (c as { produto_chave: string }).produto_chave === k)).map(([, nome]) => nome).sort((a, b) => a.localeCompare(b, "pt-BR")),
    calculos: ((calcs.data ?? []) as unknown as FiscalData["calculos"]),
  };
  return <FiscalPage data={data} />;
}
