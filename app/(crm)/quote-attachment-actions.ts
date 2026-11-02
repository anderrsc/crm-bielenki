"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { saveDraftQuoteAttachments } from "@/lib/quote-attachments";
export async function uploadQuoteAttachments(formData:FormData){
 const quoteId=String(formData.get('quote_id')||'');
 const result=await saveDraftQuoteAttachments(quoteId,formData);
 revalidatePath('/orcamentos/'+quoteId);return result;
}
export async function downloadQuoteAttachment(quoteId:string,id:string){
 const db=await createClient();
 const {data:attachment}=await db.from('quote_internal_attachments').select('file_path,original_name').eq('id',id).eq('quote_id',quoteId).single();
 if(!attachment)return {error:'Anexo não encontrado ou sem acesso.'};
 const {data,error}=await db.storage.from('quote-internal-attachments').createSignedUrl(attachment.file_path,60,{download:attachment.original_name});
 return error?{error:'Não foi possível abrir o anexo.'}:{url:data?.signedUrl};
}
export async function removeQuoteAttachment(quoteId:string,id:string){
 const db=await createClient();
 const {data,error}=await db.from('quote_internal_attachments').delete().eq('id',id).eq('quote_id',quoteId).select('file_path');
 if(error||!data?.length)return {error:'Não foi possível remover o anexo.'};
 const {error:cleanup}=await db.storage.from('quote-internal-attachments').remove(data.map(row=>row.file_path));
 if(cleanup)console.error('Limpeza de anexo interno pendente:',cleanup.message);
 revalidatePath('/orcamentos/'+quoteId);return {success:true};
}
