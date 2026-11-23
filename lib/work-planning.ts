import type {SupabaseClient} from '@supabase/supabase-js';
import {todayISO} from '@/lib/utils';
export type Team={id:string;name:string;leader_id:string;active:boolean};
export type Vehicle={id:string;name:string;plate:string|null;vehicle_type:string;capacity_kg:number|null;useful_length_m:number|null;status:string};
export type Person={id:string;full_name:string};
export type Member={id:string;team_id:string;profile_id:string;duty:string;ended_at:string|null};
export type Day={id:string;work_date:string;team_id:string;vehicle_id:string;driver_id:string;team_name:string;vehicle_name:string;driver_name:string;notes:string|null;status:string;crew_review_required:boolean};
export type DayMember={id:string;day_id:string;profile_id:string;profile_name:string;duty:string;released_at:string|null};
export type Job={id:string;day_id:string;event_id:string|null;measurement_id:string|null;installation_id:string|null;order_id:string|null;title:string;address:string|null;scheduled_at:string;position:number;active:boolean;needs_review:boolean};
export type LoadItem={id:string;job_id:string;description:string;kind:string;quantity:number;unit:string;state:string;returned_quantity:number|null;active:boolean};
export type LoadEvent={id:string;item_id:string;from_state:string|null;to_state:string;returned_quantity:number|null;notes:string|null;profile_id:string;created_at:string};
export type JobOption={source:string;id:string;title:string;starts_at:string;address:string|null};
export function planningDate(value?:string){if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return todayISO();const d=new Date(`${value}T12:00:00Z`);return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value?todayISO():value;}
export async function loadWorkPlanning(db:SupabaseClient,date:string,viewerId:string){
 const [roles,daysResult,teamsResult,vehiclesResult]=await Promise.all([
  db.rpc('current_user_roles'),db.from('work_days').select('id,work_date,team_id,vehicle_id,driver_id,team_name,vehicle_name,driver_name,notes,status,crew_review_required').eq('work_date',date).order('created_at'),
  db.from('work_teams').select('id,name,leader_id,active').order('name'),
  db.from('work_vehicles').select('id,name,plate,vehicle_type,capacity_kg,useful_length_m,status').order('name'),
 ]);
 for(const r of [roles,daysResult,teamsResult,vehiclesResult])if(r.error)throw new Error('Não foi possível carregar o planejamento. Confira a conexão e as migrações.');
 const roleList=(roles.data??[]) as string[];const manager=roleList.some(r=>['administrador','gerente'].includes(r));
 const addLoad=manager||roleList.some(r=>['estoque','producao'].includes(r));
 const days=(daysResult.data??[]) as Day[],dayIds=days.map(d=>d.id);
 const empty={data:[],error:null};
 const [jobsResult,membersResult,peopleResult,rosterResult,optionsResult]=await Promise.all([
  dayIds.length?db.from('work_day_jobs').select('id,day_id,event_id,measurement_id,installation_id,order_id,title,address,scheduled_at,position,active,needs_review').in('day_id',dayIds).order('position'):empty,
  dayIds.length?db.from('work_day_members').select('id,day_id,profile_id,profile_name,duty,released_at').in('day_id',dayIds).order('added_at'):empty,
  db.from('profiles').select('id,full_name').eq('status','ativo').order('full_name'),
  manager?db.from('work_team_members').select('id,team_id,profile_id,duty,ended_at').order('started_at',{ascending:false}).limit(2000):empty,
  manager?db.rpc('work_job_options',{p_date:date}):empty,
 ]);
 for(const r of [jobsResult,membersResult,peopleResult,rosterResult,optionsResult])if(r.error)throw new Error('Não foi possível carregar as visitas e os membros.');
 const jobs=(jobsResult.data??[]) as Job[];
 const itemsResult=jobs.length?await db.from('work_load_items').select('id,job_id,description,kind,quantity,unit,state,returned_quantity,active').in('job_id',jobs.map(j=>j.id)).order('created_at'):empty;
 if(itemsResult.error)throw new Error('Não foi possível carregar o carregamento.');
 const items=(itemsResult.data??[]) as LoadItem[];
 const logs=items.length?await db.from('work_load_events').select('id,item_id,from_state,to_state,returned_quantity,notes,profile_id,created_at').in('item_id',items.map(i=>i.id)).order('created_at',{ascending:false}).limit(1000):empty;
 if(logs.error)throw new Error('Não foi possível carregar as conferências.');
 return {date,viewerId,manager,addLoad,days,teams:(teamsResult.data??[]) as Team[],vehicles:(vehiclesResult.data??[]) as Vehicle[],jobs,members:(membersResult.data??[]) as DayMember[],people:(peopleResult.data??[]) as Person[],roster:(rosterResult.data??[]) as Member[],options:(optionsResult.data??[]) as JobOption[],items,logs:(logs.data??[]) as LoadEvent[]};
}
