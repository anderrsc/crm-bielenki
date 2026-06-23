import { ModuleTable } from "@/components/module-table";
import { modules } from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { FinancialPage } from "@/components/financial-page";
import { ClientForm } from "@/components/client-form";
import { GutterQuote, type GutterQuoteInitial } from "@/components/gutter-quote";
import { DetailPage } from "@/components/detail-page";
import { CompanySettings } from "@/components/company-settings";
import { QuoteDocument } from "@/components/quote-document";
import { VisitSheet, type VisitSheetData } from "@/components/visit-sheet";
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
import { AuditLogPage } from "@/components/audit-log-page";
import { PendingCenter } from "@/components/pending-center";
import { WindowQuote } from "@/components/window-quote";
import { maskSecret } from "@/lib/encrypt";
import { AgendaPage } from "@/components/agenda-page";
import { getAgendaEvents } from "@/app/(crm)/agenda-actions";
import { CompanyIdentityEditor, type LogoConfig } from "@/components/company-identity";
import { TemplatesPage, type DocumentTemplate } from "@/components/templates-page";

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
  if (path[0] === "configuracoes" && path[1] === "identidade") {
    let company: LogoConfig = {};
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const db = await createClient();
      const { data: p } = await db.from("profiles").select("company_id").single();
      if (p?.company_id) {
        const { data } = await db.from("companies").select("trade_name,name,tax_id,phone,whatsapp,email,website,address,neighborhood,city,state,logo_url,primary_color,logo_width,logo_max_height,logo_align,logo_margin_top,logo_margin_bottom,quote_footer").eq("id", p.company_id).single();
        company = (data as LogoConfig) ?? {};
      }
    }
    return <CompanyIdentityEditor company={company} />;
  }
  if (path[0] === "configuracoes" && path[1] === "templates") {
    let templates: DocumentTemplate[] = [];
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const db = await createClient();
      const { data: p } = await db.from("profiles").select("company_id").single();
      if (p?.company_id) {
        const { data } = await db.from("document_templates").select("id,name,type,status,is_default,config,updated_at").eq("company_id", p.company_id).order("type").order("updated_at", { ascending: false });
        templates = (data as DocumentTemplate[]) ?? [];
      }
    }
    return <TemplatesPage templates={templates} />;
  }
  if (path[0] === "configuracoes" && path[1] === "tabela-calhas") {
    const s = search as { aba?: string; espessura?: string; salvo?: string; q?: string };
    return <PricingCenter tab={s.aba as never} thickness={s.espessura} q={s.q} error={search.erro} saved={s.salvo === "1"} backHref="/configuracoes" selfHref="/configuracoes/tabela-calhas" />;
  }
  if ((path[0] === "configuracoes" && path[1] === "fornecedores") || (path[0] === "fornecedores" && !path[1])) { const isCfg = path[0] === "configuracoes"; return <SuppliersPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} backHref={isCfg ? "/configuracoes" : "/dashboard"} selfHref={isCfg ? "/configuracoes/fornecedores" : "/fornecedores"} />; }
  if ((path[0] === "configuracoes" && path[1] === "funcionarios") || path[0] === "funcionarios") return <EmployeesPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if ((path[0] === "configuracoes" && path[1] === "usuarios") || path[0] === "usuarios") return <EmployeesPage error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
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
      const safeConfig = configRes.data ? {
        ...configRes.data,
        groq_api_key: maskSecret(configRes.data.groq_api_key ?? ""),
        openai_api_key: maskSecret(configRes.data.openai_api_key ?? ""),
        evolution_api_key: maskSecret(configRes.data.evolution_api_key ?? ""),
        whatsapp_token: maskSecret(configRes.data.whatsapp_token ?? ""),
      } : null;
      return <AiTriagePage config={safeConfig as Parameters<typeof AiTriagePage>[0]["config"]} sessions={(sessionsRes.data ?? []) as Parameters<typeof AiTriagePage>[0]["sessions"]} tab={tab} saved={(search as { salvo?: string }).salvo === "1"} error={search.erro} />;
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
  if (path[0] === "auditoria") return <AuditLogPage tableFilter={(search as { tabela?: string }).tabela} />;
  if (path[0] === "pendencias") return <PendingCenter category={(search as { categoria?: string }).categoria} />;
  if (path[0] === "agenda") {
    const events = await getAgendaEvents();
    return <AgendaPage initialEvents={events} />;
  }
  if (path[0] === "busca") return <GlobalSearch query={search.q} />;
  if (path[0] === "pipeline") return <PipelinePage error={search.erro} created={(search as { criado?: string }).criado === "1"} />;
  if (path[0] === "relatorios") return <ReportsPage start={(search as { inicio?: string }).inicio} end={(search as { fim?: string }).fim} />;
  if (path[0] === "producao" && path[1] === "materiais-do-pedido") return <OrderMaterialsPage error={search.erro} received={(search as { recebido?: string }).recebido === "1"} />;
  if (path[0] === "producao" && path[1] && path[1] !== "materiais-do-pedido") return <ProductionFlowPage id={path[1]} error={search.erro} />;
  if (path[0] === "producao") return <ProductionFlowPage filter={(search as { tipo?: string }).tipo} error={search.erro} />;
  if (path[0] === "instalacoes" && path[1]) return <InstallationChecklistPage id={path[1]} error={search.erro} saved={(search as { salvo?: string }).salvo === "1"} />;
  if (path[0] === "clientes" && path[1] === "novo") {let sources:{id:string;name:string}[]=[];if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const result=await db.from("lead_sources").select("id,name").eq("active",true).order("sort_order");sources=result.data??[];}return <ClientForm error={search.erro} sources={sources}/>;}
  if (path[0] === "clientes" && path[1] && path[2] === "editar") {if(!process.env.NEXT_PUBLIC_SUPABASE_URL)return notFound();const db=await createClient();const [clientResult,sourceResult]=await Promise.all([db.from("clients").select("id,name,tax_id,phone,email,city,state,notes,lead_source_id").eq("id",path[1]).single(),db.from("lead_sources").select("id,name").eq("active",true).order("sort_order")]);if(!clientResult.data)return notFound();return <ClientForm error={search.erro} sources={sourceResult.data??[]} client={clientResult.data}/>;}
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
  if (path[0] === "clientes" && path[1] && path[2] === "ficha-visita") {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notFound();
    const db = await createClient();
    const [clientRes, companyRes] = await Promise.all([
      db.from("clients").select("name,phone,whatsapp,neighborhood,city,state,address").eq("id", path[1]).single(),
      db.from("profiles").select("company_id,company:companies(trade_name,name,tax_id,phone,whatsapp,email,website,address,neighborhood,city,state,logo_url,primary_color)").single(),
    ]);
    if (!clientRes.data) return notFound();
    const company = (companyRes.data?.company ?? {}) as VisitSheetData["company"];
    return <VisitSheet clientId={path[1]} client={clientRes.data} company={company} backHref={`/clientes/${path[1]}`} />;
  }
  if (path[0] === "medicoes" && path[1] === "ficha-em-branco") {
    let company: VisitSheetData["company"] = {};
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const db = await createClient();
      const res = await db.from("profiles").select("company:companies(trade_name,name,tax_id,phone,whatsapp,email,website,address,neighborhood,city,state,logo_url,primary_color)").single();
      company = (res.data?.company ?? {}) as VisitSheetData["company"];
    }
    return <VisitSheet company={company} backHref="/medicoes" />;
  }
  if (path[0] === "orcamentos" && path[1] === "calhas") {
    let prices:GutterPrice[]=[];let clients:QuoteClient[]=[];
    if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const [priceResult,clientResult]=await Promise.all([db.from("gutter_prices").select("id,product,thickness,cut_mm,color,unit_price,notes,active").eq("active",true),db.from("clients").select("id,name,phone,city").eq("status","ativo").order("name")]);prices=(priceResult.data as GutterPrice[])??[];clients=(clientResult.data as QuoteClient[])??[];}
    return <GutterQuote prices={prices} clients={clients}/>;
  }
  if(path[0]==="orcamentos"&&path[1]==="esquadrias"){let clients:{id:string;name:string}[]=[];if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const result=await db.from("clients").select("id,name").eq("status","ativo").order("name");clients=result.data??[];}return <WindowQuote clients={clients} error={search.erro}/>;}
  if(path[0]==="orcamentos"&&path[1]&&path[2]==="editar"){
    const db=await createClient();const [quoteResult,gutterResult,priceResult,clientResult,specialResult]=await Promise.all([db.from("quotes").select("id,client_id,discount,freight,notes,valid_until,installation_deadline,status").eq("id",path[1]).single(),db.from("gutter_quotes").select("items:gutter_quote_items(product,thickness,cut,color,quantity,meters,unit_price)").eq("quote_id",path[1]).single(),db.from("gutter_prices").select("id,product,thickness,cut_mm,color,unit_price,notes,active").eq("active",true),db.from("clients").select("id,name,phone,city").eq("status","ativo").order("name"),db.from("quote_items").select("product,description,unit,quantity,unit_price").eq("quote_id",path[1]).eq("item_type","especial")]);
    if(!quoteResult.data||!gutterResult.data||quoteResult.data.status==="aprovado")return notFound();
    const initial={...quoteResult.data,notes:quoteResult.data.notes??"",valid_until:quoteResult.data.valid_until??"",installation_deadline:quoteResult.data.installation_deadline??"",items:(gutterResult.data as unknown as {items:GutterQuoteInitial["items"]}).items,special_items:(specialResult.data??[]) as GutterQuoteInitial["special_items"]} as GutterQuoteInitial;
    return <GutterQuote prices={(priceResult.data as GutterPrice[])??[]} clients={(clientResult.data as QuoteClient[])??[]} initial={initial}/>;
  }
  if (path[0] === "orcamentos" && path[1] && path[1] !== "novo") return <QuoteDocument id={path[1]} error={search.erro} />;
  if (path[0] === "financeiro") {
    const filter = ["receber","pagar"].includes(path[1]) ? path[1] : undefined;
    const financialPage=Math.max(1,Number((search as {pagina?:string}).pagina??1)||1);
    return <FinancialPage filter={filter} error={search.erro} received={(search as {recebido?:string}).recebido === "1"} page={financialPage}/>;
  }
  const key = path[0] === "producao" && path[1] === "materiais-do-pedido" ? "materiais" : path[0];
  const config = modules[key];
  if (!config) return <ComingSoon name={path[0] ?? "Página"} />;
  const isMaterialsList = path[0] === "producao" && path[1] === "materiais-do-pedido";
    if (path[1] && path[1] !== "novo" && !isMaterialsList) return <DetailPage config={config} id={path[1]} subpage={path[2]} />;
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number((search as { pagina?: string }).pagina ?? 1));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE; // fetch one extra to detect hasMore
  let rows: Record<string, unknown>[] = []; let error: string | undefined; let hasMore = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const db = await createClient();
    let request = db.from(config.table).select(config.select).range(from, to);
    if (search.q && config.search.length) request = request.or(config.search.map(k => `${k}.ilike.%${search.q}%`).join(","));
    const result = await request;
    const all = (result.data as unknown as Record<string, unknown>[]) ?? [];
    hasMore = all.length > PAGE_SIZE;
    rows = hasMore ? all.slice(0, PAGE_SIZE) : all;
    error = result.error?.message;
  }
  return <ModuleTable config={config} rows={rows} base={path[0]} query={search.q} error={error} page={page} hasMore={hasMore} />;
}

function ComingSoon({ name }: { name: string }) { return <div className="card mx-auto max-w-3xl p-10"><p className="text-xs font-bold uppercase tracking-widest text-forest">CRM Bielenki</p><h1 className="mt-2 text-3xl font-black capitalize">{name.replaceAll("-", " ")}</h1><p className="mt-3 text-ink/55">Este módulo usa a estrutura central de permissões, atividades e auditoria do sistema. Configure o Supabase para começar a operá-lo.</p></div> }
