export const DEFAULT_WORK_MINUTES=480;
export function durationLabel(minutes:number|null|undefined){
 if(minutes==null)return 'A informar';
 const h=Math.floor(minutes/60),m=minutes%60;
 return [h?`${h} h`:'',m?`${m} min`:''].filter(Boolean).join(' ')||'0 min';
}
export type TimeDay={id:string;team_name:string;status:string;crew_review_required:boolean;work_minutes?:number;reserved_minutes?:number};
export type TimeJob={day_id:string;active:boolean;needs_review:boolean;scheduled_at:string;duration_minutes?:number|null};
export type TimeOption={source:string;id:string;title:string;starts_at:string;event_type?:string;duration_minutes?:number|null;allocated?:boolean};
export type Suggestion={day_id:string;source:string;source_id:string;title:string;duration_minutes:number;starts_at:string};
const overlap=(a:number,am:number,b:number,bm:number)=>a<b+bm*60000&&b<a+am*60000;
export function suggestDailyInstallations(days:TimeDay[],jobs:TimeJob[],options:TimeOption[]){
 const slots=days.filter(d=>d.status==='planejada'&&!d.crew_review_required).map(day=>{
  const visits=jobs.filter(j=>j.day_id===day.id&&j.active);
  return {day,visits:visits.map(j=>({start:Date.parse(j.scheduled_at),minutes:j.duration_minutes??0})),used:visits.reduce((n,j)=>n+(j.duration_minutes??0),0),blocked:visits.some(j=>j.needs_review||!j.duration_minutes||!Number.isFinite(Date.parse(j.scheduled_at)))};
 });
 const assignments:Suggestion[]=[],skipped:{title:string;reason:string}[]=[];const seen=new Set<string>();
 for(const job of [...options].sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id))){
  const key=`${job.source}:${job.id}`;if(seen.has(key)||job.allocated)continue;seen.add(key);
  if(job.event_type!=='instalacao')continue;
  const minutes=job.duration_minutes,start=Date.parse(job.starts_at);
  if(!minutes||!Number.isInteger(minutes)||minutes<1||minutes>14400){skipped.push({title:job.title,reason:'Informe a duração no orçamento.'});continue;}
  if(!Number.isFinite(start)||new Date(start).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})!==new Date(start+minutes*60000).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})){skipped.push({title:job.title,reason:'Serviço ultrapassa o dia; planeje as etapas em dias separados.'});continue;}
  const fit=slots.filter(s=>!s.blocked&&s.used+minutes+(s.day.reserved_minutes??0)<=(s.day.work_minutes??DEFAULT_WORK_MINUTES)&&!s.visits.some(v=>overlap(start,minutes,v.start,v.minutes))).sort((a,b)=>a.used-b.used||a.day.id.localeCompare(b.day.id))[0];
  if(!fit){skipped.push({title:job.title,reason:'Sem equipe livre neste horário e com tempo suficiente. Confira jornadas, reservas e durações pendentes.'});continue;}
  assignments.push({day_id:fit.day.id,source:job.source,source_id:job.id,title:job.title,duration_minutes:minutes,starts_at:job.starts_at});fit.used+=minutes;fit.visits.push({start,minutes});
 }
 return {assignments,skipped};
}
