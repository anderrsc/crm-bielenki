'use client';
import { useRef,useState } from 'react';
import { FileText,Paperclip } from 'lucide-react';
import { prepareInboxAttachment,sendInboxAttachment,cancelInboxAttachment } from '@/app/(crm)/inbox-attachment-actions';
import { createClient } from '@/lib/supabase/client';
import { validateAttachment,attachmentMime,ATTACHMENT_MIMES } from '@/lib/whatsapp/attachments';
export function InboxAttachments({conversationId,quotes,onChanged}:{conversationId:string;quotes:Array<{id:string;numero:string;status:string}>;onChanged:()=>void}){
 const input=useRef<HTMLInputElement>(null);const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function send(file:File,quoteId?:string){
  setBusy(true);setMessage('');let preparedId:string|undefined;
  try{
   const mime=attachmentMime(file.name,file.type);
   validateAttachment(file.name,mime,file.size);
   const p=await prepareInboxAttachment({conversationId,name:file.name,mime,size:file.size,quoteId});
   if(p.error||!p.id||!p.path||!p.token)throw new Error(p.error||'Falha ao preparar arquivo.');
   preparedId=p.id;
   const {error}=await createClient().storage.from('atendimento-files').uploadToSignedUrl(p.path,p.token,file,{contentType:mime});
   if(error)throw new Error('Falha no upload. Verifique a conexão e tente novamente.');
   const r=await sendInboxAttachment(p.id);
   if(r.error)throw new Error(r.error);
   setMessage(r.warning||'Arquivo enviado.');
  }catch(e){if(preparedId)await cancelInboxAttachment(preparedId).catch(()=>{});setMessage(e instanceof Error?e.message:'Falha ao enviar.')}finally{setBusy(false);if(input.current)input.current.value='';onChanged()}
 }
 async function pdf(id:string){
  if(!id)return;setBusy(true);setMessage('Gerando PDF…');
  try{
   const r=await fetch(`/api/orcamentos/${id}/pdf`);
   if(!r.ok)throw new Error('Não foi possível gerar o PDF. Abra o orçamento e tente novamente.');
   const q=quotes.find(q=>q.id===id);const file=new File([await r.blob()],`Orcamento-${q?.numero||id}.pdf`,{type:'application/pdf'});
   await send(file,id);
  }catch(e){setMessage(e instanceof Error?e.message:'Falha ao gerar PDF.');setBusy(false)}
 }
 return <div className="mb-2 space-y-2"><div className="flex flex-wrap gap-2"><input ref={input} type="file" accept={ATTACHMENT_MIMES.join(',')} className="hidden" aria-label="Arquivo para enviar" onChange={e=>{const f=e.target.files?.[0];if(f)send(f)}}/><button type="button" disabled={busy} onClick={()=>input.current?.click()} className="button-ghost flex items-center gap-1 text-xs"><Paperclip size={15}/>{busy?'Enviando…':'PDF, foto ou áudio'}</button>{quotes.length>0&&<label className="flex items-center gap-1 text-xs"><FileText size={15}/><select aria-label="Enviar PDF do orçamento" disabled={busy} value="" onChange={e=>pdf(e.target.value)} className="field max-w-52 text-xs"><option value="">Enviar PDF do orçamento…</option>{quotes.filter(q=>q.status!=='cancelado').map(q=><option key={q.id} value={q.id}>{q.numero} · {q.status}</option>)}</select></label>}</div><p className="text-[10px] text-ink/50">Até 10 MB por arquivo. Fotos pelo WhatsApp oficial: até 5 MB.</p>{message&&<p role="status" className="rounded-lg bg-cream p-2 text-xs">{message}</p>}</div>
}
