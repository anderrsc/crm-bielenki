'use client';
import Link from 'next/link';
import { Bell, X } from 'lucide-react';
import { useEffect, useState } from 'react';
type Notice={id:string;title:string;body:string|null;link:string|null;read_at:string|null};
export function NotificationCenter(){
 const [open,setOpen]=useState(false),[notices,setNotices]=useState<Notice[]>([]),[key,setKey]=useState<string|null>(null),[error,setError]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;const load=async()=>{try{const r=await fetch('/api/notifications');if(!r.ok)return;const d=await r.json();if(active){setNotices(d.notices??[]);setKey(d.publicKey);}}catch{}};load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},60000);const onShow=()=>{if(document.visibilityState==='visible')load()};document.addEventListener('visibilitychange',onShow);if('serviceWorker' in navigator)navigator.serviceWorker.register('/crm-sw.js').then(r=>r.pushManager?.getSubscription()).then(s=>{if(active)setEnabled(!!s)}).catch(()=>{});return()=>{active=false;clearInterval(t);document.removeEventListener('visibilitychange',onShow)}},[]);
 async function enable(){
  setError('');setBusy(true);
  try{
   if(!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('No iPhone, abra o CRM pelo Safari, toque em Compartilhar → Adicionar à Tela de Início e ative os alertas pelo ícone instalado.');
   if(!key)throw new Error('Alertas ainda não configurados no servidor.');
   const permission=await Notification.requestPermission();
   if(permission!=='granted')throw new Error('Permita notificações para este CRM nas configurações do navegador.');
   const reg=await navigator.serviceWorker.ready;
   const bytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   const sub=await reg.pushManager.getSubscription()??await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
   const r=await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub.toJSON()})});
   const d=await r.json();if(!r.ok){await sub.unsubscribe();throw new Error(d.error)}setEnabled(true);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível ativar os alertas.')}finally{setBusy(false)}
 }
 async function read(id:string){await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({readId:id})});setNotices(n=>n.map(x=>x.id===id?{...x,read_at:new Date().toISOString()}:x));setOpen(false)}
 const unread=notices.filter(n=>!n.read_at).length;
 return <div className="relative"><button type="button" className="topbar-icon relative" aria-label={`Avisos${unread?`: ${unread} não lidos`:''}`} aria-expanded={open} onClick={()=>setOpen(!open)}><Bell size={18}/>{unread>0&&<span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{unread}</span>}</button>{open&&<section className="absolute right-0 top-12 z-50 max-h-[70vh] w-[min(90vw,380px)] overflow-y-auto rounded-xl border border-sand bg-surface p-4 shadow-xl" aria-label="Avisos da equipe"><div className="mb-3 flex justify-between"><b>Avisos da equipe</b><button aria-label="Fechar avisos" onClick={()=>setOpen(false)}><X size={18}/></button></div><button disabled={busy||enabled} onClick={enable} className="button mb-2 w-full text-xs">{enabled?'Alertas ativos neste dispositivo':busy?'Ativando…':'Ativar alertas no celular'}</button><p className="mb-3 text-xs text-ink/60">No iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Abra pelo ícone e ative os alertas.</p>{error&&<p role="alert" className="mb-3 text-xs text-red-500">{error}</p>}{!notices.length&&<p className="text-sm text-ink/60">Nenhum aviso.</p>}{notices.map(n=><Link key={n.id} href={n.link?.startsWith('/')&&!n.link.startsWith('//')?n.link:'/pendencias'} onClick={()=>read(n.id)} className={`mb-2 block rounded-lg border border-sand p-3 ${n.read_at?'opacity-60':'bg-cream'}`}><b className="text-sm">{n.title}</b><p className="mt-1 text-xs">{n.body}</p></Link>)}</section>}</div>
}
