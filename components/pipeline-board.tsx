"use client";

import { moveLeadStage } from "@/app/(crm)/actions";
import { money, shortDate } from "@/lib/utils";
import { AlarmClock, CalendarClock, FileText, Flame, MessageCircle, Phone, Search, Target, Trophy, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

export type Stage={id:string;name:string;color:string|null;sort_order:number;is_won:boolean;is_lost:boolean};
export type Lead={id:string;name:string;phone:string|null;source:string|null;stage_id:string;estimated_value:number|null;next_action:string|null;next_action_date:string|null;status:string;client_id?:string|null;owner_id?:string|null;stage_changed_at?:string|null;created_at?:string|null;lost_reason?:string|null;quote?:{id:string;quote_number:string}|null;owner?:{full_name?:string}|null;client?:{whatsapp?:string|null;phone?:string|null;neighborhood?:string|null;city?:string|null}|null};
type Filter="todos"|"meus"|"atrasados"|"parados";

const DAY=86_400_000;
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"?";
const digits=(v?:string|null)=>(v??"").replace(/\D/g,"");
export function whatsappLink(phone?:string|null){const d=digits(phone);if(d.length<10)return null;return `https://wa.me/${d.length<=11?"55"+d:d}`;}
export function daysBetween(fromIso:string|null|undefined,nowMs:number){if(!fromIso)return 0;const t=new Date(fromIso).getTime();return Number.isNaN(t)?0:Math.max(0,Math.floor((nowMs-t)/DAY));}

export function PipelineBoard({initialStages,initialLeads,currentUserId,nowIso,today}:{initialStages:Stage[];initialLeads:Lead[];currentUserId?:string|null;nowIso:string;today:string}){
  const [leads,setLeads]=useState(initialLeads);const [pending,startTransition]=useTransition();
  const [query,setQuery]=useState("");const [filter,setFilter]=useState<Filter>("todos");const [showLost,setShowLost]=useState(true);const [over,setOver]=useState<string|null>(null);
  const nowMs=new Date(nowIso).getTime();const monthStart=today.slice(0,7);
  const stageById=useMemo(()=>new Map(initialStages.map(s=>[s.id,s])),[initialStages]);
  const isOpen=(l:Lead)=>{const s=stageById.get(l.stage_id);return !s?.is_won&&!s?.is_lost;};
  const overdue=(l:Lead)=>isOpen(l)&&!!l.next_action_date&&l.next_action_date.slice(0,10)<today;
  const stale=(l:Lead)=>isOpen(l)&&daysBetween(l.stage_changed_at??l.created_at,nowMs)>=7;

  const move=(leadId:string,stageId:string)=>{
    const lead=leads.find(x=>x.id===leadId);const target=stageById.get(stageId);if(!lead||!target||lead.stage_id===stageId)return;
    let reason:string|undefined;
    if(target.is_lost){const r=window.prompt("Motivo da perda (opcional): preço, prazo, fechou com outro...","");if(r===null)return;reason=r.trim()||undefined;}
    const old=lead;
    setLeads(items=>items.map(x=>x.id===leadId?{...x,stage_id:stageId,stage_changed_at:new Date().toISOString(),status:target.is_won?"ganho":target.is_lost?"perdido":"aberto",lost_reason:target.is_lost?reason??null:null}:x));
    startTransition(async()=>{try{await moveLeadStage(leadId,stageId,reason)}catch{setLeads(items=>items.map(x=>x.id===leadId?old:x));window.alert(`Não foi possível mover "${old.name}". Verifique a internet e tente de novo.`)}});
  };

  const visible=leads.filter(l=>{
    const q=query.trim().toLowerCase();
    if(q&&!(`${l.name} ${l.phone??""} ${l.quote?.quote_number??""} ${l.client?.neighborhood??""} ${l.client?.city??""}`.toLowerCase().includes(q)))return false;
    if(filter==="meus")return l.owner_id===currentUserId;
    if(filter==="atrasados")return overdue(l);
    if(filter==="parados")return stale(l);
    return true;
  });
  const stages=initialStages.filter(s=>showLost||!s.is_lost);

  const open=leads.filter(isOpen);const openValue=open.reduce((n,x)=>n+Number(x.estimated_value||0),0);
  const wonMonth=leads.filter(l=>stageById.get(l.stage_id)?.is_won&&(l.stage_changed_at??"").slice(0,7)===monthStart);
  const won=leads.filter(l=>stageById.get(l.stage_id)?.is_won).length;const lost=leads.filter(l=>stageById.get(l.stage_id)?.is_lost).length;
  const conversion=won+lost?Math.round(won/(won+lost)*100):0;
  const lateCount=leads.filter(overdue).length;const staleCount=leads.filter(stale).length;
  const attentionCount=leads.filter(lead=>overdue(lead)||stale(lead)).length;

  const filters:[Filter,string,number|null][]=[["todos","Todas",null],["meus","Minhas",currentUserId?leads.filter(l=>l.owner_id===currentUserId).length:null],["atrasados","Follow-up atrasado",lateCount],["parados","Paradas há 7+ dias",staleCount]];

  return <div className={pending?"opacity-90":""}>
    <section className="mobile-kpis pipeline-kpis mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi icon={Wallet} label="Em negociação" value={money(openValue)} hint={`${open.length} oportunidades abertas`} highlight/>
      <Kpi icon={Trophy} label="Ganhos no mês" value={money(wonMonth.reduce((n,x)=>n+Number(x.estimated_value||0),0))} hint={`${wonMonth.length} fechadas este mês`}/>
      <Kpi icon={Target} label="Taxa de conversão" value={`${conversion}%`} hint={`${won} ganhas · ${lost} perdidas`}/>
      <Kpi icon={AlarmClock} label="Precisam de atenção" value={String(attentionCount)} hint={`${lateCount} atrasadas · ${staleCount} paradas`} danger={attentionCount>0}/>
    </section>

    <div className="pipeline-filters mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1 sm:max-w-sm"><Search className="absolute left-3 top-3 h-4 w-4 text-ink/40"/><input className="field pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, telefone, orçamento, bairro..." aria-label="Buscar oportunidade"/></div>
      <nav className="flex flex-wrap gap-2" aria-label="Filtros do pipeline">{filters.map(([value,label,count])=><button type="button" key={value} onClick={()=>setFilter(value)} aria-pressed={filter===value} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${filter===value?"border-forest bg-forest text-white":"bg-surface hover:border-forest/40"}`}>{label}{count!==null&&<span className={`ml-1.5 rounded-full px-1.5 ${filter===value?"bg-white/20":"bg-cream"}`}>{count}</span>}</button>)}</nav>
      <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-bold text-ink/60"><input type="checkbox" checked={showLost} onChange={e=>setShowLost(e.target.checked)}/>Mostrar perdidas</label>
    </div>

    <p className="mb-3 text-xs text-ink/50">{visible.length} oportunidades · {stages.length} etapas visíveis</p>
    <div className="mobile-pipeline-scroll pipeline-board-scroll"><div className="pipeline-stage-grid" style={{"--pipeline-columns":stages.length} as React.CSSProperties}>{stages.map(stage=>{
      const items=visible.filter(x=>x.stage_id===stage.id);const total=items.reduce((sum,x)=>sum+Number(x.estimated_value||0),0);const color=stage.color||"#94a3b8";
      return <section key={stage.id} aria-label={stage.name} className={`pipeline-stage flex min-w-0 flex-col rounded-2xl border bg-cream/40 transition ${over===stage.id?"border-forest ring-2 ring-forest/20":"border-transparent"}`}
        onDragOver={e=>{e.preventDefault();setOver(stage.id)}} onDragLeave={()=>setOver(o=>o===stage.id?null:o)} onDrop={e=>{setOver(null);move(e.dataTransfer.getData("lead-id"),stage.id)}}>
        <header className="pipeline-stage-heading rounded-t-2xl border-t-4 px-3 pb-3 pt-3" style={{borderTopColor:color}}>
          <div className="flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-black">{stage.is_won?<Trophy className="h-4 w-4" style={{color}}/>:<span className="h-2.5 w-2.5 rounded-full" style={{backgroundColor:color}}/>}{stage.name}</h2><span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold">{items.length}</span></div>
          <p className="mt-1 text-xs font-bold text-ink/50">{money(total)}</p>
        </header>
        <div className="pipeline-stage-cards min-h-28 flex-1 space-y-3 px-2 pb-3">{items.map(lead=><LeadCard key={lead.id} lead={lead} stage={stage} stages={initialStages} nowMs={nowMs} today={today} onMove={move}/>)}{!items.length&&<div className="rounded-xl border border-dashed p-6 text-center text-xs text-ink/35">{query||filter!=="todos"?"Nada com esse filtro":"Arraste uma oportunidade para cá"}</div>}</div>
      </section>})}</div></div>
  </div>;
}

function Kpi({icon:Icon,label,value,hint,highlight,danger}:{icon:typeof Wallet;label:string;value:string;hint:string;highlight?:boolean;danger?:boolean}){
  return <div className={`card p-4 ${highlight?"kpi-highlight":""}`}><div className="flex items-center justify-between"><p className="text-xs font-bold text-ink/55">{label}</p><Icon className={`h-4 w-4 ${danger?"text-red-600":"text-forest"}`}/></div><p className={`display-font mt-2 text-2xl font-extrabold num ${danger?"text-red-600":""}`}>{value}</p><p className="mt-1 text-[11px] text-ink/50">{hint}</p></div>;
}

function LeadCard({lead,stage,stages,nowMs,today,onMove}:{lead:Lead;stage:Stage;stages:Stage[];nowMs:number;today:string;onMove:(id:string,stage:string)=>void}){
  const color=stage.color||"#94a3b8";const closed=stage.is_won||stage.is_lost;
  const days=daysBetween(lead.stage_changed_at??lead.created_at,nowMs);
  const due=lead.next_action_date?.slice(0,10);const late=!closed&&!!due&&due<today;const isToday=!closed&&due===today;
  const phone=lead.client?.whatsapp||lead.phone||lead.client?.phone;const wa=whatsappLink(phone);
  const place=[lead.client?.neighborhood,lead.client?.city].filter(Boolean).join(" · ");
  return <article draggable onDragStart={e=>e.dataTransfer.setData("lead-id",lead.id)} className="pipeline-lead-card card min-w-0 cursor-grab border-l-4 p-3 active:cursor-grabbing" style={{borderLeftColor:color}}>
    <div className="flex min-w-0 items-start gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{backgroundColor:color}}>{initials(lead.name)}</span>
      <div className="min-w-0 flex-1">
        {lead.client_id?<Link href={`/clientes/${lead.client_id}`} className="pipeline-lead-name font-black hover:underline" title={lead.name}>{lead.name}</Link>:<h3 className="pipeline-lead-name font-black">{lead.name}</h3>}
        {place&&<p className="mt-1 break-words text-[11px] text-ink/45">{place}</p>}
      </div>

    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-base font-black text-forest num">{money(lead.estimated_value)}</p>{!closed&&days>=7&&<span title={`Nesta etapa há ${days} dias`} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${days>=14?"bg-red-500/10 text-red-600":"bg-amber-500/15 text-amber-600"}`}><Flame className="h-3 w-3"/>{days}d</span>}</div>
    <div className="mt-2 min-w-0 space-y-2 break-words text-xs text-ink/55">
      {lead.quote&&<Link href={`/orcamentos/${lead.quote.id}`} className="flex min-w-0 items-start gap-1.5 font-bold text-forest hover:underline"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span className="break-words">Orçamento {lead.quote.quote_number}</span></Link>}
      {lead.next_action&&<p className={`flex items-start gap-2 ${late?"font-bold text-red-600":isToday?"font-bold text-amber-600":""}`}><CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span>{lead.next_action}{due&&<> · {late?"atrasado desde ":isToday?"hoje · ":""}{shortDate(due)}</>}</span></p>}
      {stage.is_lost&&lead.lost_reason&&<p className="rounded-lg bg-red-50 px-2 py-1 text-red-700">Motivo: {lead.lost_reason}</p>}
      <div className="flex flex-wrap items-start gap-2"><p className="flex min-w-0 flex-1 items-start gap-1.5"><UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span className="break-words">{lead.owner?.full_name||"Sem responsável"}</span></p>{lead.source&&<span className="max-w-full rounded-lg bg-cream px-2 py-0.5 text-[10px] font-bold">{lead.source}</span>}</div>
    </div>
    <div className="pipeline-card-actions mt-3 flex flex-wrap items-center gap-2">
      {wa&&<a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${lead.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"><MessageCircle className="h-4 w-4"/></a>}
      {phone&&<a href={`tel:${digits(phone)}`} aria-label={`Ligar para ${lead.name}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border hover:bg-cream"><Phone className="h-4 w-4"/></a>}
      <select aria-label="Mover etapa" className="pipeline-stage-select field py-1.5 text-xs" value={lead.stage_id} onChange={e=>onMove(lead.id,e.target.value)}>{stages.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select>
    </div>
  </article>;
}
