"use server";
import {z} from 'zod';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {createClient} from '@/lib/supabase/server';
import {parseBRNumber} from '@/lib/br-number';
import {validIsoDate} from '@/lib/valid-date';
const base='/financeiro/recorrencias';
const date=z.string().refine(validIsoDate);
function message(e:{code?:string;message?:string}){return e.code==='P0001'?e.message??'Confira os dados.':e.code==='42501'?'Sem permissão para esta operação.':'Não foi possível salvar. Confira valores, datas e classificações.';}
export async function saveRecurrence(form:FormData){
 const raw=Object.fromEntries(form),amount=parseBRNumber(String(raw.amount??''));
 const p=z.object({id:z.uuid().or(z.literal('')).default(''),description:z.string().trim().min(3).max(180),entry_type:z.enum(['pagar','receber']),kind:z.enum(['normal','payroll']),starts_on:date,ends_on:date,day_of_month:z.coerce.number().int().min(1).max(31),interval_months:z.coerce.number().refine(n=>[1,3,6,12].includes(n)),category_id:z.uuid().or(z.literal('')).default(''),cost_center_id:z.uuid().or(z.literal('')).default(''),reason:z.string().trim().min(3).max(1000)}).safeParse(raw);
 if(!p.success||amount===null||!Number.isFinite(amount)||amount<=0||amount>999999999999.99)redirect(`${base}?erro=Revise+os+campos+da+recorrência`);
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {id,reason,...data}=p.data;
 const {error}=await db.rpc('save_financial_recurrence',{p_id:id||null,p_data:{...data,amount:amount.toFixed(2),active:form.get('active')==='on'},p_reason:reason});
 if(error)redirect(`${base}?${new URLSearchParams({erro:message(error),...(id?{editar:id}:{})})}`);
 for(const route of [base,'/financeiro/caixa'])revalidatePath(route);redirect(`${base}?salvo=1`);
}
export async function materializeRecurrence(form:FormData){
 const p=z.object({id:z.uuid(),month:date.refine(d=>d.endsWith('-01')),reason:z.string().trim().min(3).max(1000),confirmed:z.literal('on')}).safeParse(Object.fromEntries(form));
 if(!p.success)redirect(`${base}?erro=Confirme+a+competência+e+a+justificativa`);
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const {error}=await db.rpc('materialize_financial_recurrence',{p_id:p.data.id,p_month:p.data.month,p_reason:p.data.reason});
 if(error)redirect(`${base}?${new URLSearchParams({erro:message(error),mes:p.data.month.slice(0,7)})}`);
 for(const route of [base,'/financeiro','/financeiro/caixa','/financeiro/pagar','/financeiro/receber','/financeiro/dre'])revalidatePath(route);
 redirect(`${base}?mes=${p.data.month.slice(0,7)}&salvo=1`);
}
