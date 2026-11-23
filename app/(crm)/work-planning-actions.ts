"use server";
import {z} from 'zod';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {createClient} from '@/lib/supabase/server';
import {safeBack,q} from '@/lib/back-url';
import {friendlyError} from '@/lib/friendly-error';
const uuid=z.uuid(),optionalId=uuid.optional(),text=z.string().trim().min(1).max(80);
const optionalPositive=z.string().refine(v=>v===''||(/^\d+(\.\d+)?$/.test(v)&&Number(v)>0&&Number.isFinite(Number(v))));
const schemas={
 team:z.object({id:optionalId,name:text,leader_id:uuid,active:z.boolean()}),
 member:z.object({team_id:uuid,profile_id:uuid,duty:z.string().max(80),end:z.boolean()}),
 vehicle:z.object({id:optionalId,name:text,plate:z.string().max(15),vehicle_type:text,capacity_kg:optionalPositive,useful_length_m:optionalPositive,status:z.enum(['disponivel','manutencao','inativo'])}),
 day:z.object({team_id:uuid,vehicle_id:uuid,driver_id:uuid,work_date:z.iso.date(),members:z.array(uuid),notes:z.string().max(1000)}),
 crew:z.object({id:uuid,driver_id:uuid,members:z.array(uuid).min(1)}),
 day_status:z.object({id:uuid,status:z.enum(['em_andamento','concluida','cancelada'])}),
 job:z.object({day_id:uuid,source:z.enum(['operational_events','measurements','installations']),source_id:uuid,position:z.coerce.number().int().min(1).max(100)}),
 job_review:z.object({id:uuid,position:z.coerce.number().int().min(1).max(100)}),
 job_remove:z.object({id:uuid}),
 load_order:z.object({job_id:uuid}),
 load_add:z.object({job_id:uuid,description:z.string().trim().min(1).max(300),kind:z.enum(['item','material','ferramenta']),quantity:z.coerce.number().positive().max(1000000),unit:z.string().trim().min(1).max(20),material_id:optionalId}),
 load_state:z.object({id:uuid,state:z.enum(['pendente','separado','carregado','retorno_conferido']),expected_state:z.string().max(30),returned_quantity:z.string().regex(/^$|^\d+(\.\d+)?$/),notes:z.string().max(1000)}),
};
export async function saveWorkPlanning(form:FormData){
 const action=String(form.get('action')??'');
 const raw:Record<string,unknown>=Object.fromEntries(form.entries());
 if(action==='job'){const [source,source_id]=String(form.get('source_choice')??'').split(':');raw.source=source;raw.source_id=source_id;}
 for(const key of ['id','material_id'])if(!raw[key])delete raw[key];
 raw.active=raw.active!=='false';raw.end=raw.end==='true';
 raw.members=form.getAll('members').map(String);raw.notes=raw.notes??'';
 raw.returned_quantity=raw.returned_quantity??'';
 const candidate=safeBack(form.get('_back'),'/equipes');const back=candidate.startsWith('/equipes')?candidate:'/equipes';
 const schema=schemas[action as keyof typeof schemas];const parsed=schema?.safeParse(raw);
 if(!parsed?.success)redirect(`${q(back)}erro=Confira+os+campos+do+planejamento`);
 const db=await createClient();
 const {error}=await db.rpc('work_manage',{p_action:action,p_payload:parsed.data});
 if(error){
  const msg=error.code==='23505'?'Pessoa, equipe, veículo, visita ou posição já reservados. Atualize a lista.':friendlyError(error.message)??'Não foi possível salvar o planejamento.';
  redirect(`${q(back)}erro=${encodeURIComponent(msg)}`);
 }
 revalidatePath('/equipes');revalidatePath('/agenda');revalidatePath('/instalacoes');
 redirect(`${q(back)}salvo=1`);
}
