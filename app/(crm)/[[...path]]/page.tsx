import { ModuleTable } from "@/components/module-table";
import { modules } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ClientForm } from "@/components/client-form";
import { GutterQuote } from "@/components/gutter-quote";
import { DetailPage } from "@/components/detail-page";
import { CompanySettings } from "@/components/company-settings";
import { QuoteDocument } from "@/components/quote-document";
import { VisitSheet } from "@/components/visit-sheet";
import { AutomationSettings } from "@/components/automation-settings";
import { GlobalSearch } from "@/components/global-search";
import { PipelinePage } from "@/components/pipeline-page";
import { ReportsPage } from "@/components/reports-page";
import { OrderMaterialsPage } from "@/components/order-materials-page";
import { InstallationChecklistPage } from "@/components/installation-checklist-page";
import { GutterPricesPage } from "@/components/gutter-prices-page";
import type { GutterPrice, QuoteClient } from "@/lib/gutters";

export default async function CatchAll({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<{ q?: string; erro?: string }> }) {
  const path = (await params).path ?? [];
  const search = await searchParams;
  if (path[0] === "configuracoes" && path[1] === "tabela-calhas") return <GutterPricesPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "configuracoes") return <CompanySettings error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "automacoes") return <AutomationSettings error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} test={(search as { teste?: string }).teste === "1"} />;
  if (path[0] === "busca") return <GlobalSearch query={search.q} />;
  if (path[0] === "pipeline") return <PipelinePage error={search.erro} created={(search as { criado?: string }).criado === "1"} />;
  if (path[0] === "relatorios") return <ReportsPage start={(search as { inicio?: string }).inicio} end={(search as { fim?: string }).fim} />;
  if (path[0] === "producao" && path[1] === "materiais-do-pedido") return <OrderMaterialsPage error={search.erro} received={(search as { recebido?: string }).recebido === "1"} />;
  if (path[0] === "instalacoes" && path[1]) return <InstallationChecklistPage id={path[1]} error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "clientes" && path[1] === "novo") return <ClientForm error={search.erro} />;
  if (path[0] === "clientes" && path[1] && path[2] === "ficha-visita") return <VisitSheet clientId={path[1]} />;
  if (path[0] === "orcamentos" && path[1] === "calhas") {
    let prices:GutterPrice[]=[];let clients:QuoteClient[]=[];
    if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const [priceResult,clientResult]=await Promise.all([db.from("gutter_prices").select("id,product,thickness,cut_mm,unit_price,notes,active").eq("active",true),db.from("clients").select("id,name,phone,city").eq("status","ativo").order("name")]);prices=(priceResult.data as GutterPrice[])??[];clients=(clientResult.data as QuoteClient[])??[];}
    return <GutterQuote prices={prices} clients={clients}/>;
  }
  if (path[0] === "orcamentos" && path[1] && path[1] !== "novo") return <QuoteDocument id={path[1]} error={search.erro} />;
  const key = path[0] === "producao" && path[1] === "materiais-do-pedido" ? "materiais" : path[0] === "financeiro" ? "financeiro" : path[0];
  const config = modules[key];
  if (!config) return <ComingSoon name={path[0] ?? "Página"} />;
  const financialFilter = path[0] === "financeiro" && ["receber", "pagar"].includes(path[1]);
    const isMaterialsList = path[0] === "producao" && path[1] === "materiais-do-pedido";
    if (path[1] && path[1] !== "novo" && !financialFilter && !isMaterialsList) return <DetailPage config={config} id={path[1]} subpage={path[2]} />;
  let rows: Record<string, unknown>[] = []; let error: string | undefined;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    let request = db.from(config.table).select(config.select).limit(100);
    if (financialFilter) request = request.eq("entry_type", path[1]);
    if (search.q && config.search.length) request = request.or(config.search.map(k => `${k}.ilike.%${search.q}%`).join(","));
    const result = await request;
    rows = (result.data as unknown as Record<string, unknown>[]) ?? []; error = result.error?.message;
  }
  return <ModuleTable config={config} rows={rows} base={path[0]} query={search.q} error={error} />;
}

function ComingSoon({ name }: { name: string }) { return <div className="card mx-auto max-w-3xl p-10"><p className="text-xs font-bold uppercase tracking-widest text-forest">CRM Bielenki</p><h1 className="mt-2 text-3xl font-black capitalize">{name.replaceAll("-", " ")}</h1><p className="mt-3 text-ink/55">Este módulo usa a estrutura central de permissões, atividades e auditoria do sistema. Configure o Supabase para começar a operá-lo.</p></div> }
