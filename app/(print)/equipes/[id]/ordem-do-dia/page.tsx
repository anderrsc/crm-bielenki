import {notFound} from 'next/navigation';
import {getRequestClient,getAuthUser} from '@/lib/supabase/server';
import {loadWorkPlanning} from '@/lib/work-planning';
import {DailyWorkOrder} from '@/components/daily-work-order';
export const metadata={title:'Ordem de serviços do dia — Marquinhos'};
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id)||!process.env.NEXT_PUBLIC_SUPABASE_URL)notFound();
 const db=await getRequestClient();const {data:day,error}=await db.from('work_days').select('id,work_date').eq('id',id).maybeSingle();
 if(error||!day)notFound();
 const data=await loadWorkPlanning(db,day.work_date,(await getAuthUser(db))?.id??'');
 const selected=data.days.find(d=>d.id===id);if(!selected)notFound();
 return <DailyWorkOrder day={selected} jobs={data.jobs.filter(j=>j.day_id===id)} members={data.members.filter(m=>m.day_id===id&&!m.released_at)} items={data.items}/>;
}
