'use client';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {InstallationDurationInput} from '@/components/installation-duration-input';
import {saveQuoteInstallationDuration} from '@/app/(crm)/installation-planning-actions';
export function QuoteInstallationDuration({quoteId,minutes}:{quoteId:string;minutes:number|null}){
 const [value,setValue]=useState(minutes),[message,setMessage]=useState(''),[pending,start]=useTransition();const router=useRouter();
 return <section className="card no-print mb-6 p-5" aria-label="Tempo de instalação interno"><h2 className="mb-3 font-semibold">Planejamento da instalação · interno</h2><form onSubmit={e=>{e.preventDefault();start(async()=>{const result=await saveQuoteInstallationDuration(quoteId,value);setMessage(result.error??'Duração salva.');if(!result.error)router.refresh();});}} className="grid items-end gap-3 sm:grid-cols-[1fr_auto]"><InstallationDurationInput value={value} onChange={setValue}/><button className="button" disabled={pending}>Salvar duração</button></form>{message&&<p className="mt-3 text-sm" role="status">{message}</p>}</section>;
}
