'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
export async function saveTriageDraft(quoteId:string,items:unknown){
 const parsed=z.array(z.object({id:z.uuid(),product:z.string().trim().min(1).max(500),description:z.string().max(12000),quantity:z.number().finite().positive().max(999999),unit_price:z.number().finite().nonnegative().max(999999999)})).min(1).max(100).safeParse(items);
 if(!z.uuid().safeParse(quoteId).success||!parsed.success)return {error:'Revise peças, quantidades e preços.'};
 const db=await createClient();const {error}=await db.rpc('save_triage_draft',{p_quote_id:quoteId,p_items:parsed.data});
 if(error)return {error:error.message};
 revalidatePath(`/orcamentos/${quoteId}`);revalidatePath('/orcamentos');return {ok:true};
}
