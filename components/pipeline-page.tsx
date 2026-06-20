import { Plus, TrendingUp } from "lucide-react";
import { createLead } from "@/app/(crm)/actions";
import { PipelineBoard, type Lead, type Stage } from "@/components/pipeline-board";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/utils";

export async function PipelinePage({error,created}:{error?:string;created?:boolean}){
  let stages:Stage[]=[];let leads:Lead[]=[];let loadError="";
  if(process.env.NEXT_PUBLIC_SUPABASE_URL){const db=await createClient();const stageResult=await db.from("pipeline_stages").select("id,name,color,sort_order,is_won,is_lost").order("sort_order");stages=(stageResult.data as Stage[])??[];loadError=stageResult.error?.message??"";const leadResult=await db.from("leads").select("id,name,phone,source,stage_id,estimated_value,next_action,next_action_date,status,owner:profiles(full_name)").order("created_at",{ascending:false});leads=(leadResult.data as unknown as Lead[])??[];loadError||=leadResult.error?.message??"";}
  const open=leads.filter(x=>x.status==="aberto");const total=open.reduce((sum,x)=>sum+Number(x.estimated_value||0),0);
  return <div className="mx-auto max-w-[1600px]"><div className="mb-7 flex flex-col justify-between gap-4 xl:flex-row xl:items-end"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-forest">Funil comercial</p><h1 className="mt-2 text-3xl font-black">Pipeline</h1><p className="mt-1 text-sm text-ink/50">{open.length} oportunidades abertas · {money(total)} em negociação</p></div><details className="group"><summary className="button cursor-pointer list-none"><Plus className="h-4 w-4"/>Nova oportunidade</summary><form action={createLead} className="card absolute right-8 z-10 mt-2 grid w-[min(92vw,620px)] gap-4 p-5 sm:grid-cols-2"><Field name="name" label="Nome / oportunidade" required/><Field name="phone" label="Telefone"/><Field name="estimated_value" label="Valor estimado" type="number"/><div><label className="label">Etapa inicial</label><select className="field" name="stage_id">{stages.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></div><Field name="next_action" label="Próxima ação"/><Field name="next_action_date" label="Data da próxima ação" type="date"/><Field name="source" label="Origem"/><button className="button self-end"><TrendingUp className="h-4 w-4"/>Criar oportunidade</button></form></details></div>
    {(error||loadError)&&<p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error||loadError}</p>}{created&&<p className="mb-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Oportunidade criada.</p>}
    {stages.length?<PipelineBoard initialStages={stages} initialLeads={leads}/>:<div className="card p-10 text-center"><h2 className="font-black">Pipeline ainda não configurado</h2><p className="mt-1 text-sm text-ink/45">Execute a inicialização da empresa para criar as etapas padrão.</p></div>}
  </div>;
}
function Field({name,label,type="text",required}:{name:string;label:string;type?:string;required?:boolean}){return <div><label className="label">{label}</label><input className="field" name={name} type={type} required={required} step={type==="number"?"0.01":undefined}/></div>}
