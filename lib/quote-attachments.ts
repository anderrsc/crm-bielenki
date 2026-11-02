import { randomUUID } from "node:crypto";
import { createClient } from "./supabase/server";
export type InternalAttachment={id:string;original_name:string;size_bytes:number;created_at:string};
export const ATTACHMENT_EXTENSIONS=['jpg','jpeg','png','webp','heic','pdf','txt','csv','doc','docx','xls','xlsx','dwg','dxf','zip'];
export function validateQuoteAttachment(file:Pick<File,'name'|'size'>){
 if(!file.size||file.size>10*1024*1024)return 'O arquivo deve ter até 10 MB.';
 const ext=file.name.split('.').pop()?.toLowerCase();
 if(!ext||!ATTACHMENT_EXTENSIONS.includes(ext))return 'Formato não permitido. Use imagem, PDF, documento, planilha, DWG, DXF ou ZIP.';
 return null;
}
export async function storeQuoteAttachment(quoteId:string,file:File):Promise<{error?:string;success?:boolean}>{
 const invalid=validateQuoteAttachment(file);if(invalid)return {error:invalid};
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return {error:'Entre novamente no sistema.'};
 const {data:quote}=await db.from('quotes').select('company_id').eq('id',quoteId).single();
 if(!quote)return {error:'Orçamento não encontrado ou sem acesso.'};
 const {data:allowed}=await db.rpc('has_table_access',{resource:'quotes',action:'update'});
 if(!allowed)return {error:'Sem permissão para anexar arquivos neste orçamento.'};
 const name=file.name.replace(/[\x00-\x1f\\/]/g,'_').slice(0,180);
 const ext=file.name.split('.').pop()!.toLowerCase();
 const filePath=quote.company_id+'/'+quoteId+'/'+randomUUID()+'.'+ext;
 const {error:uploadError}=await db.storage.from('quote-internal-attachments').upload(filePath,Buffer.from(await file.arrayBuffer()),{contentType:'application/octet-stream',upsert:false});
 if(uploadError)return {error:'Falha ao enviar anexo: '+uploadError.message};
 const {error}=await db.from('quote_internal_attachments').insert({company_id:quote.company_id,quote_id:quoteId,original_name:name,file_path:filePath,content_type:'application/octet-stream',size_bytes:file.size,uploaded_by:user.id});
 if(error){await db.storage.from('quote-internal-attachments').remove([filePath]);return {error:'Falha ao vincular anexo: '+error.message};}
 return {success:true};
}
export async function saveDraftQuoteAttachments(quoteId:string,formData:FormData):Promise<{error?:string;success?:boolean}>{
 const files=formData.getAll('quote_attachments').filter((file):file is File=>file instanceof File&&file.size>0);
 if(files.reduce((n,file)=>n+file.size,0)>10*1024*1024)return {error:'Os anexos enviados juntos devem totalizar até 10 MB.'};
 for(const file of files){const invalid=validateQuoteAttachment(file);if(invalid)return {error:invalid};}
 for(const file of files){const result=await storeQuoteAttachment(quoteId,file);if(result.error)return result;}
 return {success:true};
}
