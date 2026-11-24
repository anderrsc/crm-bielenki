'use client';
import { useRef,useState } from 'react';
import { FileText,Paperclip } from 'lucide-react';
import { prepareInboxAttachment,sendInboxAttachment,cancelInboxAttachment } from '@/app/(crm)/inbox-attachment-actions';
import { createClient } from '@/lib/supabase/client';
import { validateAttachment,attachmentMime,ATTACHMENT_MIMES } from '@/lib/whatsapp/attachments';
export function InboxAttachments({conversationId,quotes,onChanged,onQuoteSent}:{conversationId:string;quotes:Array<{id:string;numero:string;status:string}>;onChanged:()=>void;onQuoteSent?:()=>void}){
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
   // Orçamento enviado: a mensagem de prazo e pagamento fica pronta no campo para conferir e enviar.
   if(quoteId)onQuoteSent?.();
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
 const [showQuotes,setShowQuotes]=useState(false);
 return <div className="relative flex shrink-0 items-center gap-1"><input ref={input} type="file" accept={ATTACHMENT_MIMES.join(',')} className="hidden" aria-label="Arquivo para enviar" onChange={e=>{const f=e.target.files?.[0];if(f)send(f)}}/>
  <button type="button" disabled={busy} aria-label={busy?'Enviando arquivo':'Anexar arquivo'} onClick={()=>input.current?.click()} title="PDF, Word, Excel, DWG, foto, vídeo (MP4) ou áudio, até 16 MB. Fotos pelo WhatsApp oficial: até 5 MB." className="wa-row wa-muted flex h-11 w-11 items-center justify-center rounded-full"><Paperclip size={22}/></button>
  {quotes.length>0&&<button type="button" disabled={busy} aria-label="Enviar orçamento em PDF" aria-expanded={showQuotes} onClick={()=>setShowQuotes(v=>!v)} className="wa-row wa-muted flex h-11 w-11 items-center justify-center rounded-full"><FileText size={22}/></button>}
  {showQuotes&&quotes.length>0&&<select aria-label="Enviar PDF do orçamento" disabled={busy} value="" onChange={e=>{setShowQuotes(false);pdf(e.target.value)}} className="wa-chip absolute bottom-12 left-0 z-10 max-w-[80vw] rounded-xl border px-3 py-2.5 text-sm font-bold shadow-lg"><option value="">Enviar orçamento (PDF)…</option>{quotes.filter(q=>q.status!=='cancelado').map(q=><option key={q.id} value={q.id}>{q.numero} · {q.status}</option>)}</select>}
  {message&&<p role="status" className="absolute bottom-12 left-0 z-10 w-max max-w-[80vw] rounded-lg border bg-surface p-2 text-xs shadow-lg">{message}</p>}
 </div>
}
