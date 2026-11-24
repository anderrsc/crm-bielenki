'use server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {createClient} from '@/lib/supabase/server';
import {friendlyError} from '@/lib/friendly-error';
import {type Suggestion} from '@/lib/installation-time';
const minutes=z.number().int().min(1).max(14400).nullable();
export async function saveQuoteInstallationDuration(quoteId:string,value:number|null){
 if(!z.uuid().safeParse(quoteId).success||!minutes.safeParse(value).success)return {error:'Informe uma duração válida.'};
 const db=await createClient();const {error}=await db.rpc('set_quote_installation_duration',{p_quote:quoteId,p_minutes:value});
 if(error)return {error:friendlyError(error.message)??'Não foi possível salvar a duração.'};
 revalidatePath('/equipes');revalidatePath(`/orcamentos/${quoteId}`);return {ok:true};
}
export async function applyInstallationSuggestions(date:string,assignments:Suggestion[]){
 const parsed=z.object({date:z.iso.date(),assignments:z.array(z.object({day_id:z.uuid(),source:z.enum(['installations','operational_events']),source_id:z.uuid(),duration_minutes:z.number().int().min(1).max(14400),starts_at:z.iso.datetime({offset:true})})).min(1).max(100)}).safeParse({date,assignments});
 if(!parsed.success)return {error:'Confira os serviços selecionados.'};
 const db=await createClient();const {error,data}=await db.rpc('work_apply_suggestions',{p_date:date,p_assignments:parsed.data.assignments});
 if(error)return {error:friendlyError(error.message)??'O planejamento mudou. Atualize a página e revise a sugestão.'};
 revalidatePath('/equipes');return {ok:true,count:data as number};
}
