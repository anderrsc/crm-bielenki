import { ModuleTable } from "@/components/module-table";
import { modules } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { FinancialPage } from "@/components/financial-page";
import { ClientForm } from "@/components/client-form";
import { GutterQuote } from "@/components/gutter-quote";
import { DetailPage } from "@/components/detail-page";
import { CompanySettings } from "@/components/company-settings";
import { QuoteDocument } from "@/components/quote-document";
import { VisitSheet } from "@/components/visit-sheet";
import { AutomationSettings } from "@/components/automation-settings";
import { AutomationsHub } from "@/components/automations-hub";
import { WorkflowBuilder } from "@/components/workflow-builder";
import { GlobalSearch } from "@/components/global-search";
import { PipelinePage } from "@/components/pipeline-page";
import { ReportsPage } from "@/components/reports-page";
import { OrderMaterialsPage } from "@/components/order-materials-page";
import { InstallationChecklistPage } from "@/components/installation-checklist-page";
import { GutterPricesPage } from "@/components/gutter-prices-page";
import { PricingCenter } from "@/components/pricing-center";
import type { GutterPrice, QuoteClient } from "@/lib/gutters";
import { ManualSaleForm } from "@/components/manual-sale-form";
import { ManualPurchaseForm } from "@/components/manual-purchase-form";
import { LeadSourcesPage } from "@/components/lead-sources-page";
import { SuppliersPage } from "@/components/suppliers-page";
import { EmployeesPage } from "@/components/employees-page";
import { RolesPage } from "@/components/roles-page";
import { AiTriagePage } from "@/components/ai-triage-page";
import { AiControlPanel } from "@/components/ai-control-panel";
import { ProductionFlowPage } from "@/components/production-flow-page";

export default async function CatchAll({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<{ q?: string; erro?: string }> }) {
  const path = (await params).path ?? [];
  if (!path.length) { const { redirect } = await import("next/navigation"); redirect("/dashboard"); }
  const search = await searchParams;
  if (path[0] === "dashboard") { const { redirect } = await import("next/navigation"); redirect("/dashboard"); }
  if (path[0] === "tabela-calhas") {
    const s = search as { aba?: string; espessura?: string; salvo?: string; q?: string };
    return <PricingCenter tab={s.aba as never} thickness={s.espessura} q={s.q} error={search.erro} saved={s.salvo === "1"} backHref="/dashboard" selfHref="/tabela-calhas" />;
  }
  if (path[0] === "configuracoes" && path[1] === "origens-lead") return <LeadSourcesPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "configuracoes" && path[1] === "tabela-calhas") {
    const s = search as { aba?: string; espessura?: string; salvo?: string; q?: string };
    return <PricingCenter tab={s.aba as never} thickness={s.espessura} q={s.q} error={search.erro} saved={s.salvo === "1"} backHref="/configuracoes" selfHref="/configuracoes/tabela-calhas" />;
  }
  if ((path[0] === "configuracoes" && path[1] === "fornecedores") || (path[0] === "fornecedores" && !path[1])) { const isCfg = path[0] === "configuracoes"; return <SuppliersPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} backHref={isCfg ? "/configuracoes" : "/dashboard"} selfHref={isCfg ? "/configuracoes/fornecedores" : "/fornecedores"} />; }
  if (path[0] === "configuracoes" && path[1] === "funcionarios") return <EmployeesPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "configuracoes" && path[1] === "usuarios") return <EmployeesPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "configuracoes" && path[1] === "cargos") return <RolesPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "configuracoes") return <CompanySettings error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "central-ia") {
    const tab = (search as { aba?: string }).aba ?? "dashboard";
    return <AiControlPanel tab={tab} />;
  }
  if (path[0] === "agente-ia") {
    const tab = (search as { aba?: string }).aba ?? "triagens";
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const db = await createClient();
      const { data: { user } } = await db.auth.getUser();
      const { data: profile } = user ? await db.from("profiles").select("company_id").eq("id", user.id).single() : { data: null };
      const companyId = profile?.company_id;
      const [configRes, sessionsRes] = await Promise.all([
        companyId ? db.from("ai_agent_config").select("*").eq("company_id", companyId).single() : Promise.resolve({ data: null }),
        companyId ? db.from("triage_sessions").select("id,phone,nome,status,produto,tipo_servico,score,prioridade,probabilidade,prazo,necessita_visita,possui_projeto,possui_fotos,eh_manutencao,resumo_executivo,created_at,completed_at,messages").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
      ]);
      return <AiTriagePage config={configRes.data as Parameters<typeof AiTriagePage>[0]["config"]} sessions={(sessionsRes.data ?? []) as Parameters<typeof AiTriagePage>[0]["sessions"]} tab={tab} saved={(search as { salvo?: string }).salvo === "1"} error={search.erro} />;
    }
    return <AiTriagePage config={null} sessions={[]} tab={tab} />;
  }
  if (path[0] === "automacoes" && path[1] === "novo") {
    let templates: { id: string; name: string; channel: string }[] = [];
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const db = await createClient();
      const { data } = await db.from("message_templates").select("id,name,channel").eq("active", true).order("name");
      templates = data ?? [];
    }
    return <WorkflowBuilder templates={templates} />;
  }
  if (path[0] === "automacoes" && path[1] && path[2] === "editar") {
    let wf = null; let templates: { id: string; name: string; channel: string }[] = [];
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const db = await createClient();
      const [wfRes, tplRes] = await Promise.all([
        db.from("workflows").select("id,name,description,status,trigger_type,trigger_config,conditions,steps").eq("id", path[1]).single(),
        db.from("message_templates").select("id,name,channel").eq("active", true).order("name"),
      ]);
      wf = wfRes.data; templates = tplRes.data ?? [];
    }
    if (!wf) return notFound();
    return <WorkflowBuilder workflow={wf as Parameters<typeof WorkflowBuilder>[0]["workflow"]} templates={templates} />;
  }
  if (path[0] === "automacoes") {
    const tab = (search as { aba?: string }).aba ?? "fluxos";
    return <AutomationsHub tab={tab} saved={(search as { salvo?: string }).salvo === "1"} error={search.erro} />;
  }
  if (path[0] === "busca") return <GlobalSearch query={search.q} />;
  if (path[0] === "pipeline") return <PipelinePage error={search.erro} created={(search as { criado?: string }).criado === "1"} />;
  if (path[0] === "relatorios") return <ReportsPage start={(search as { inicio?: string }).inicio} end={(search as { fim?: string }).fim} />;
  if (path[0] === "producao" && path[1] === "materiais-do-pedido") return <OrderMaterialsPage error={search.erro} received={(search as { recebido?: string }).recebido === "1"} />;
  if (path[0] === "producao" && path[1] && path[1] !== "materiais-do-pedido") return <ProductionFlowPage id={path[1]} error={search.erro} />;
  if (path[0] === "producao") return <ProductionFlowPage filter={(search as { tipo?: string }).tipo} error={search.erro} />;
  if (path[0] === "instalacoes" && path[1]) return <InstallationChecklistPage id={path[1]} error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "clientes" && path[1] === "novo") {let sources:{id:string;name:string}[]=[];if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const result=await db.from("lead_sources").select("id,name").eq("active",true).order("sort_order");sources=result.data??[];}return <ClientForm error={search.erro} sources={sources}/>;}
  if (path[0] === "vendas" && path[1] === "nova") {
    let clients:{id:string;name:string}[]=[];let saleTypes:{id:string;name:string}[]=[];
    if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const [clientResult,typeResult]=await Promise.all([db.from("clients").select("id,name").eq("status","ativo").order("name"),db.from("sale_types").select("id,name").eq("active",true).order("name")]);clients=clientResult.data??[];saleTypes=typeResult.data??[];}
    return <ManualSaleForm clients={clients} saleTypes={saleTypes} error={search.erro}/>;
  }
  if (path[0] === "compras" && path[1] === "nova") {
    let suppliers:{id:string;name:string}[]=[];let materials:{id:string;name:string;unit:string}[]=[];
    if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const [supplierResult,materialResult]=await Promise.all([db.from("suppliers").select("id,name").eq("status","ativo").order("name"),db.from("materials").select("id,name,unit").eq("active",true).order("name")]);suppliers=supplierResult.data??[];materials=materialResult.data??[];}
    return <ManualPurchaseForm suppliers={suppliers} materials={materials} error={search.erro}/>;
  }
  if (path[0] === "clientes" && path[1] && path[2] === "ficha-visita") return <VisitSheet clientId={path[1]} />;
  if (path[0] === "orcamentos" && path[1] === "calhas") {
    let prices:GutterPrice[]=[];let clients:QuoteClient[]=[];
    if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const [priceResult,clientResult]=await Promise.all([db.from("gutter_prices").select("id,product,thickness,cut_mm,color,unit_price,notes,active").eq("active",true),db.from("clients").select("id,name,phone,city").eq("status","ativo").order("name")]);prices=(priceResult.data as GutterPrice[])??[];clients=(clientResult.data as QuoteClient[])??[];}
    return <GutterQuote prices={prices} clients={clients}/>;
  }
  if (path[0] === "orcamentos" && path[1] && path[1] !== "novo") return <QuoteDocument id={path[1]} error={search.erro} />;
  if (path[0] === "financeiro") {
    const filter = ["receber","pagar"].includes(path[1]) ? path[1] : undefined;
    return <FinancialPage filter={filter} error={search.erro} received={(search as {recebido?:string}).recebido === "1"} />;
  }
  const key = path[0] === "producao" && path[1] === "materiais-do-pedido" ? "materiais" : path[0];
  const config = modules[key];
  if (!config) return <ComingSoon name={path[0] ?? "Página"} />;
  const isMaterialsList = path[0] === "producao" && path[1] === "materiais-do-pedido";
    if (path[1] && path[1] !== "novo" && !isMaterialsList) return <DetailPage config={config} id={path[1]} subpage={path[2]} />;
  let rows: Record<string, unknown>[] = []; let error: string | undefined;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    let request = db.from(config.table).select(config.select).limit(100);
    if (search.q && config.search.length) request = request.or(config.search.map(k => `${k}.ilike.%${search.q}%`).join(","));
    const result = await request;
    rows = (result.data as unknown as Record<string, unknown>[]) ?? []; error = result.error?.message;
  }
  return <ModuleTable config={config} rows={rows} base={path[0]} query={search.q} error={error} />;
}

function ComingSoon({ name }: { name: string }) { return <div className="card mx-auto max-w-3xl p-10"><p className="text-xs font-bold uppercase tracking-widest text-forest">CRM Bielenki</p><h1 className="mt-2 text-3xl font-black capitalize">{name.replaceAll("-", " ")}</h1><p className="mt-3 text-ink/55">Este módulo usa a estrutura central de permissões, atividades e auditoria do sistema. Configure o Supabase para começar a operá-lo.</p></div> }
