'use client';
import Link from 'next/link';
import {useState} from 'react';
import {TRACKCEO_PORTAL_URL} from '@/lib/tracking-portal-url';
let portalWindow:Window|null=null;
export function TrackingPortal({portalUrl=TRACKCEO_PORTAL_URL}:{portalUrl?:string}){
 const [message,setMessage]=useState(''),[blocked,setBlocked]=useState(false);
 function openPortal(){
  try{
   if(portalWindow&&!portalWindow.closed){portalWindow.focus();setBlocked(false);setMessage('A janela de rastreamento já está aberta. Continue nela.');return;}
   // Desliga o acesso ao CRM antes de navegar para o fornecedor. Nenhuma credencial é lida.
   const next=window.open('about:blank','_blank','popup,width=1280,height=820,resizable=yes,scrollbars=yes');
   if(!next){setBlocked(true);setMessage('O navegador não abriu a janela. Use o link abaixo para abrir o TrackCEO em uma nova guia.');return;}
   try{next.opener=null;next.location.replace(portalUrl);}catch{next.close();throw new Error('Janela indisponível');}
   portalWindow=next;setBlocked(false);setMessage('Janela de rastreamento aberta. Faça login no TrackCEO nessa janela.');
  }catch{portalWindow=null;setBlocked(true);setMessage('Use o link abaixo para abrir o TrackCEO em uma nova guia.');}
 }
 return <div className="mx-auto max-w-4xl space-y-5">
  <header><Link href="/equipes/rastreamento" className="text-sm font-medium text-forest underline">← Localização dos veículos</Link><h1 className="mt-3 text-3xl font-semibold">Painel TrackCEO</h1></header>
  <section className="card space-y-4 p-5 sm:p-6">
   <h2 className="text-lg font-semibold">Rastreamento em janela própria</h2>
   <p className="text-sm text-ink/65">Abra o TrackCEO e entre com sua conta nessa janela. Ela continua aberta enquanto você trabalha nos outros módulos do CRM.</p>
   <p className="text-sm text-ink/65">O login dentro da página do CRM não manteve a sessão. A janela própria usa o acesso normal do portal.</p>
   <button type="button" onClick={openPortal} data-testid="tracking-open-window" className="button">Abrir rastreamento</button>
   {message&&<p role={blocked?'alert':'status'} className="rounded-xl bg-cream p-4 text-sm">{message}</p>}
   <p><a href={portalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-forest underline">Abrir TrackCEO em nova guia</a></p>
  </section>
  <p className="text-sm text-ink/65">A senha e a sessão ficam no TrackCEO. Este painel não consulta sua localização nem indica se você está conectado ao fornecedor. Os dados não são sincronizados com os cadastros do CRM.</p>
 </div>;
}
