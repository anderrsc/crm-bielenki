'use client';
import {useMemo,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {applyInstallationSuggestions} from '@/app/(crm)/installation-planning-actions';
import {suggestDailyInstallations,durationLabel,type TimeDay,type TimeJob,type TimeOption} from '@/lib/installation-time';
export function DailyInstallationSuggestions({date,days,jobs,options}:{date:string;days:TimeDay[];jobs:TimeJob[];options:TimeOption[]}){
 const preview=useMemo(()=>suggestDailyInstallations(days,jobs,options),[days,jobs,options]);
 const [excluded,setExcluded]=useState<string[]>([]),[message,setMessage]=useState(''),[pending,start]=useTransition();const router=useRouter();
 const selected=preview.assignments.filter(a=>!excluded.includes(`${a.source}:${a.source_id}`));
 const time=(value:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
 return <section className="card space-y-4 p-5" aria-label="Sugestão de ordens do dia">
  <div><h2 className="text-xl font-semibold">Sugestão de instalações por equipe</h2><p className="mt-2 text-sm text-ink/65">Usa as instalações da agenda deste dia e as saídas planejadas. Mantém os horários marcados, evita sobreposições e distribui pelo tempo livre. Revise antes de incluir.</p><p className="mt-2 text-xs text-ink/60">Deslocamentos não são calculados: ajuste a reserva de tempo em cada equipe. Serviços longos que não cabem no dia precisam ser planejados por etapas.</p></div>
  {preview.assignments.length?<form onSubmit={e=>{e.preventDefault();start(async()=>{const result=await applyInstallationSuggestions(date,selected);setMessage(result.error??`${result.count} serviço(s) incluído(s) nas saídas.`);if(!result.error)router.refresh();});}} className="space-y-3">
   {preview.assignments.map(a=>{const key=`${a.source}:${a.source_id}`;return <label key={key} className="flex min-h-11 items-start gap-3 rounded-xl border p-4"><input type="checkbox" className="mt-1" checked={!excluded.includes(key)} onChange={e=>setExcluded(current=>e.target.checked?current.filter(x=>x!==key):[...current,key])}/><span className="min-w-0"><span className="block break-words font-semibold">{a.title}</span><span className="mt-1 block text-sm">{time(a.starts_at)} · {durationLabel(a.duration_minutes)} · {days.find(d=>d.id===a.day_id)?.team_name}</span></span></label>;})}
   <button type="submit" className="button" disabled={pending||!selected.length}>Incluir {selected.length} serviço(s) nas saídas</button>
  </form>:<p className="rounded-xl bg-cream p-4 text-sm">Nenhuma sugestão disponível. Confira saídas planejadas, horários e durações dos orçamentos.</p>}
  {!!preview.skipped.length&&<details><summary className="cursor-pointer text-sm font-semibold">{preview.skipped.length} serviço(s) para revisar manualmente</summary><ul className="mt-3 space-y-2">{preview.skipped.map((s,i)=><li key={i} className="rounded-xl bg-cream p-3 text-sm"><p className="font-semibold">{s.title}</p><p>{s.reason}</p></li>)}</ul></details>}
  {message&&<p role="status" className="rounded-xl bg-cream p-4 text-sm">{message}</p>}
 </section>;
}
