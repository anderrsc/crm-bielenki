import {NextResponse,type NextRequest} from 'next/server';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {createClient,getAuthUser} from '@/lib/supabase/server';
import {syncTracking} from '@/lib/trackceo-service';
import {TrackingError} from '@/lib/trackceo';

export const maxDuration=60;
const actions={
 connect:z.object({account:z.string().trim().min(1).max(120),password:z.string().min(1).max(256)}),
 sync:z.object({}),disconnect:z.object({}),
 link:z.object({device:z.uuid(),vehicle:z.union([z.uuid(),z.literal('')]),create:z.enum(['true','false']).default('false')}),
};
export async function POST(request:NextRequest){
 if(request.headers.get('origin')!==request.nextUrl.origin)return NextResponse.json({error:'Origem não autorizada'},{status:403});
 const db=await createClient(),user=await getAuthUser(db);
 if(!user)return NextResponse.json({error:'Entre novamente'},{status:401});
 const status=await db.rpc('trackceo_status');
 if(status.error||!status.data?.company_id)return NextResponse.json({error:'Sem permissão para o rastreamento'},{status:403});
 const back='/equipes/rastreamento';
 const bounce=(key:string,value:string)=>NextResponse.redirect(new URL(`${back}?${key}=${encodeURIComponent(value)}`,request.url),303);
 const form=await request.formData(),raw=Object.fromEntries(form.entries());const action=String(raw.action??'');
 const parsed=Object.hasOwn(actions,action)?actions[action as keyof typeof actions].safeParse(raw):undefined;
 if(!parsed?.success)return bounce('erro','Confira os campos da conexão.');
 try{
  if(action==='connect'){
   const data=parsed.data as z.infer<typeof actions.connect>;
   await syncTracking({companyId:status.data.company_id,actorId:user.id,credentials:data});
  }else if(action==='sync')await syncTracking({companyId:status.data.company_id,actorId:user.id});
  else if(action==='disconnect'){
   const r=await db.rpc('trackceo_disconnect');if(r.error)return bounce('erro','Não foi possível desconectar. Atualize a tela.');
  }else{
   const d=parsed.data as z.infer<typeof actions.link>;
   const r=await db.rpc('trackceo_link',{p_device:d.device,p_vehicle:d.vehicle||null,p_create:d.create==='true'});
   if(r.error)return bounce('erro',r.error.code==='23505'?'Veículo já vinculado a outro rastreador.':'Não foi possível vincular. Confira se o veículo está disponível nesta empresa.');
  }
  revalidatePath(back);revalidatePath('/equipes');return bounce('salvo','1');
 }catch(error){return bounce('erro',error instanceof TrackingError?error.message:'Não foi possível concluir. As últimas posições foram preservadas.');}
}
