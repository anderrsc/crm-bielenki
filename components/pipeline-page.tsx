import { FormMemory } from "@/components/form-memory";
import { SubmitButton } from "@/components/submit-button";
import { Plus, TrendingUp } from "lucide-react";
import { createLead } from "@/app/(crm)/actions";
import { PipelineBoard, type Lead, type Stage } from "@/components/pipeline-board";
import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/utils";

type Source={id:string;name:string};
export type PipelineFilters={dono?:string;origem?:string;de?:string;ate?:string;antigas?:string};
const DAYS_CLOSED=60;
export async function PipelinePage({error,created,filters={}}:{error?:string;created?:boolean;filters?:PipelineFilters}){
  let stages:Stage[]=[];let leads:Lead[]=[];let sources:Source[]=[];let owners:{id:string;full_name:string}[]=[];let loadError="";let userId:string|null=null;let hiddenClosed=false;
  const uuid=/^[0-9a-f-]{36}$/i;const isDate=/^\d{4}-\d{2}-\d{2}$/;const showOld=filters.antigas==="1";
  if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await getRequestClient();
    const [user,stageResult,sourceResult,ownerResult]=await Promise.all([getAuthUser(db),db.from("pipeline_stages").select("id,name,color,sort_order,is_won,is_lost").order("sort_order"),db.from("lead_sources").select("id,name").eq("active",true).order("sort_order"),db.from("profiles").select("id,full_name").eq("status","ativo").order("full_name")]);
    userId=user?.id??null;stages=(stageResult.data as Stage[])??[];sources=sourceResult.data??[];owners=(ownerResult.data as {id:string;full_name:string}[])??[];
    let query=db.from("leads").select("id,name,phone,source,stage_id,estimated_value,next_action,next_action_date,status,client_id,owner_id,stage_changed_at,created_at,lost_reason,quote:quotes(id,quote_number),owner:profiles(full_name),client:clients(whatsapp,phone,neighborhood,city)").is("deleted_at",null);
    // Ganhas e perdidas: so as dos ultimos 60 dias (as antigas pelo filtro).
    const closed=stages.filter(x=>x.is_won||x.is_lost).map(x=>x.id);
    if(!showOld&&closed.length){const since=new Date(Date.now()-DAYS_CLOSED*86400000).toISOString().slice(0,19)+"Z";query=query.or(`stage_id.not.in.(${closed.join(",")}),stage_changed_at.gte.${since},and(stage_changed_at.is.null,created_at.gte.${since})`);hiddenClosed=true;}
    if(filters.dono&&uuid.test(filters.dono))query=query.eq("owner_id",filters.dono);
    if(filters.origem&&uuid.test(filters.origem))query=query.eq("lead_source_id",filters.origem);
    if(filters.de&&isDate.test(filters.de))query=query.gte("created_at",`${filters.de}T00:00:00-03:00`);
    if(filters.ate&&isDate.test(filters.ate))query=query.lte("created_at",`${filters.ate}T23:59:59-03:00`);
    const leadResult=await query.order("created_at",{ascending:false});
    leads=(leadResult.data as unknown as Lead[])??[];loadError=stageResult.error?.message||leadResult.error?.message||sourceResult.error?.message||"";}
  const active=Boolean(filters.dono||filters.origem||filters.de||filters.ate||showOld);
  const filterBar=<form method="get" className="mb-4 flex flex-wrap items-end gap-2 text-sm"><Pick name="dono" label="Responsável" value={filters.dono} options={owners.map(o=>({id:o.id,name:o.full_name}))}/><Pick name="origem" label="Origem" value={filters.origem} options={sources}/><div><label className="label">Criada de</label><input className="field" type="date" name="de" defaultValue={filters.de}/></div><div><label className="label">até</label><input className="field" type="date" name="ate" defaultValue={filters.ate}/></div><label className="flex items-center gap-2 pb-2 font-bold text-ink/70"><input type="checkbox" name="antigas" value="1" defaultChecked={showOld}/>Ganhas/perdidas antigas</label><button className="button-ghost">Filtrar</button>{active&&<a href="/pipeline" className="pb-2 font-bold text-ink/55 underline">Limpar</a>}{hiddenClosed&&<span className="pb-2 text-xs text-ink/45">Ganhas e perdidas dos últimos {DAYS_CLOSED} dias.</span>}</form>;
  return <div className="pipeline-page"><div className="mb-5 flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Funil comercial</p><h1 className="mt-2 text-3xl font-black">Pipeline</h1><p className="mt-1 text-sm text-ink/50">Clientes entram sozinhos ao cadastrar, medir, orçar e enviar o orçamento.</p></div><details className="group relative"><summary className="button cursor-pointer list-none"><Plus className="h-4 w-4"/>Nova oportunidade</summary><form action={createLead} className="card absolute right-0 z-10 mt-2 grid w-[min(92vw,620px)] gap-4 p-5 sm:grid-cols-2"><FormMemory id="nova-oportunidade"/><Field name="name" label="Nome / oportunidade" required/><Field name="phone" label="Telefone"/><Field name="estimated_value" label="Valor estimado" type="number"/><div><label className="label">Etapa inicial</label><select className="field" name="stage_id">{stages.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></div><Field name="next_action" label="Próxima ação"/><Field name="next_action_date" label="Data da próxima ação" type="date"/><div><label className="label">Origem do lead</label><select className="field" name="lead_source_id"><option value="">Não informado</option>{sources.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></div><SubmitButton className="button self-end"><TrendingUp className="h-4 w-4"/>Criar oportunidade</SubmitButton></form></details></div>{filterBar}
    {(error||loadError)&&<p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error||loadError}</p>}{created&&<p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Oportunidade criada.</p>}
    {stages.length?<PipelineBoard initialStages={stages} initialLeads={leads} currentUserId={userId} nowIso={new Date().toISOString()} today={todayISO()}/>:<div className="card p-10 text-center"><h2 className="font-black">Pipeline ainda não configurado</h2><p className="mt-1 text-sm text-ink/45">Execute a inicialização da empresa para criar as etapas padrão.</p></div>}
  </div>;
}
function Field({name,label,type="text",required}:{name:string;label:string;type?:string;required?:boolean}){return <div><label className="label">{label}</label><input className="field" name={name} type={type} required={required} step={type==="number"?"0.01":undefined}/></div>}

function Pick({name,label,value,options}:{name:string;label:string;value?:string;options:{id:string;name:string}[]}){return <div><label className="label">{label}</label><select className="field" name={name} defaultValue={value??""}><option value="">Todos</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
