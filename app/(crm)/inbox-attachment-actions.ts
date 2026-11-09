'use server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { operationsDb } from '@/lib/operations';
import { attachmentKind,attachmentLabel,matchesAttachment,validateAttachment } from '@/lib/whatsapp/attachments';
import { sendWhatsAppMedia,whatsappCredentials } from '@/lib/whatsapp/send';
import { digitsOnly } from '@/lib/whatsapp/phone';
import { firstName } from '@/lib/seller-name';

async function context(){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)throw new Error('Sessão expirada.');
 const [{data:p},{data:allowed},{data:update}]=await Promise.all([
  db.from('profiles').select('company_id,full_name,status').eq('id',user.id).single(),
  db.rpc('has_table_access',{resource:'messages',action:'insert'}),
  db.rpc('has_table_access',{resource:'conversations',action:'update'})
 ]);
 if(!p||p.status!=='ativo'||!allowed||!update)throw new Error('Sem permissão para enviar arquivos.');
 return {db,admin:operationsDb(),user,companyId:p.company_id,name:firstName(p.full_name)||'Equipe'};
}
export async function prepareInboxAttachment(input:{conversationId:string;name:string;mime:string;size:number;quoteId?:string}){
 try{
  if(!z.uuid().safeParse(input.conversationId).success)throw new Error('Conversa inválida.');
  validateAttachment(input.name,input.mime,input.size);
  const c=await context();
  const {data:conv}=await c.db.from('conversations').select('id,client_id').eq('id',input.conversationId).eq('company_id',c.companyId).single();
  if(!conv)throw new Error('Conversa não encontrada.');
  if(input.quoteId){
   if(!z.uuid().safeParse(input.quoteId).success)throw new Error('Orçamento inválido.');
   const {data:q}=await c.db.from('quotes').select('id,client_id,total,triage_session_id').eq('id',input.quoteId).eq('company_id',c.companyId).single();
   if(!q||q.client_id!==conv.client_id)throw new Error('Este orçamento não pertence ao cliente da conversa.');
   if(q.triage_session_id && Number(q.total)<=0)throw new Error('Confira o rascunho da Lia e preencha os preços antes de enviar.');
  }
  const name=input.name.replace(/[^\p{L}\p{N}_. -]/gu,'_');
  const id=randomUUID(),path=`${c.companyId}/${conv.id}/${id}`;
  const {error}=await c.admin.from('messages').insert({id,company_id:c.companyId,conversation_id:conv.id,direction:'outbound',author:'equipe',sender_name:c.name,sent_by:c.user.id,
   body:`*${c.name}:*\n${attachmentLabel(input.mime,name)}`,media_url:path,media_type:input.mime,file_name:name,delivery_status:'uploading',attachment_quote_id:input.quoteId??null});
  if(error)throw error;
  const {data:signed,error:uploadError}=await c.admin.storage.from('atendimento-files').createSignedUploadUrl(path);
  if(uploadError||!signed)throw new Error('Não foi possível preparar o upload.');
  return {id,path,token:signed.token};
 }catch(e){return {error:e instanceof Error?e.message:'Falha ao preparar arquivo.'};}
}
export async function sendInboxAttachment(messageId:string){
 let claimed=false;
 let admin:ReturnType<typeof operationsDb>|null=null;
 try{
  if(!z.uuid().safeParse(messageId).success)throw new Error('Mensagem inválida.');
  const c=await context();admin=c.admin;
  const {data:visible}=await c.db.from('messages').select('id,delivery_status').eq('id',messageId).eq('company_id',c.companyId).eq('sent_by',c.user.id).single();
  if(!visible)throw new Error('Arquivo não encontrado.');
  if(visible.delivery_status==='enviada')return {ok:true};
  const {data:m,error}=await c.admin.from('messages').update({delivery_status:'processing'}).eq('id',messageId).eq('company_id',c.companyId).eq('sent_by',c.user.id).eq('delivery_status','uploading').select('*').maybeSingle();
  if(error||!m)throw new Error('Arquivo já está sendo enviado. Confira a conversa.');
  claimed=true;
  const {data:conv}=await c.db.from('conversations').select('id,phone,external_id,client_id,last_inbound_at').eq('id',m.conversation_id).eq('company_id',c.companyId).single();
  if(!conv||m.media_url!==`${c.companyId}/${conv.id}/${m.id}`)throw new Error('Conversa ou arquivo inválido.');
  const [{data:cfg},{data:company},{data:file,error:fileError}]=await Promise.all([
   c.admin.from('ai_agent_config').select('*').eq('company_id',c.companyId).maybeSingle(),
   c.admin.from('companies').select('whatsapp_phone_number_id').eq('id',c.companyId).maybeSingle(),
   c.admin.storage.from('atendimento-files').download(m.media_url)
  ]);
  if(fileError||!file)throw new Error('Upload não concluído. Selecione o arquivo novamente.');
  validateAttachment(m.file_name,m.media_type,file.size);
  const bytes=Buffer.from(await file.arrayBuffer());
  if(!matchesAttachment(bytes,m.media_type))throw new Error('O conteúdo não corresponde ao tipo do arquivo.');
  const credentials=whatsappCredentials(cfg,{companyPhoneNumberId:company?.whatsapp_phone_number_id});
  if(credentials.provider==='meta'){
   if(!conv.last_inbound_at||Date.now()-new Date(conv.last_inbound_at).getTime()>=24*3600_000)throw new Error('Passaram 24h da última mensagem do cliente. O WhatsApp oficial exige modelo aprovado.');
   if(attachmentKind(m.media_type)==='image'&&file.size>5*1024*1024)throw new Error('No WhatsApp oficial, a foto deve ter até 5 MB.');
  }
  const externalId=await sendWhatsAppMedia(credentials,digitsOnly(conv.phone||conv.external_id),{bytes,mime:m.media_type,name:m.file_name,caption:`*${c.name}:*`,kind:attachmentKind(m.media_type)});
  const at=new Date().toISOString();
  const {error:saveError}=await c.admin.from('messages').update({delivery_status:'enviada',external_id:externalId,sent_at:at,error_message:null}).eq('id',m.id);
  if(saveError)throw new Error('Arquivo enviado, mas falhou o registro no CRM. Confira o WhatsApp antes de repetir.');
  await c.admin.from('conversations').update({ai_paused:true,assigned_to:c.user.id,unread_count:0,last_message_at:at,last_message_preview:attachmentLabel(m.media_type,m.file_name)}).eq('id',conv.id).eq('company_id',c.companyId);
  if(m.attachment_quote_id){
   // Only the user's quote permissions can change quote status.
   const {data:q}=await c.db.from('quotes').select('status').eq('id',m.attachment_quote_id).eq('client_id',conv.client_id).single();
   if(q&&['rascunho','pendente'].includes(q.status)){
    const {error:sentError}=await c.db.rpc('mark_quote_sent',{p_quote_id:m.attachment_quote_id});
    if(sentError)return {ok:true,warning:'PDF enviado. Marque o orçamento como enviado para iniciar o lembrete de 3 dias.'};
   }
  }
  return {ok:true};
 }catch(e){
  const error=e instanceof Error?e.message:'Falha ao enviar arquivo.';
  if(claimed&&admin)await admin.from('messages').update({delivery_status:'falhou',error_message:error}).eq('id',messageId).eq('delivery_status','processing');
  return {error};
 }
}

export async function cancelInboxAttachment(messageId:string){
 if(!z.uuid().safeParse(messageId).success)return;
 const c=await context();
 await c.admin.from('messages').update({delivery_status:'falhou',error_message:'Upload interrompido. Selecione o arquivo novamente.'})
  .eq('id',messageId).eq('company_id',c.companyId).eq('sent_by',c.user.id).eq('delivery_status','uploading');
}
