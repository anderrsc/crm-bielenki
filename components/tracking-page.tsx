import Link from 'next/link';
import {ConfirmButton} from '@/components/confirm-button';
import {SubmitButton} from '@/components/submit-button';
import {TrackingMap,type TrackingPoint} from '@/components/tracking-map';
import {TRACKING_ERRORS} from '@/lib/trackceo';
import {positionAge,type TrackingData} from '@/lib/tracking-view';
const endpoint='/api/equipes/rastreamento';
const date=(v:string|null)=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'Ainda não recebida';
const statuses:Record<number,string>={1:'Nunca conectado',2:'Online',3:'Expirado',4:'Offline',5:'Bloqueado'};
export function TrackingPage({data,error,saved,focus}:{data:TrackingData;error?:string;saved?:boolean;focus?:string}){
 const {status,devices,vehicles,days}=data;
 const available=devices.filter(d=>d.available);
 const points:TrackingPoint[]=available.flatMap(d=>{
  const vehicle=vehicles.find(v=>v.id===d.vehicle_id);
  return vehicle&&d.latitude!==null&&d.longitude!==null&&d.gps_at?[{id:vehicle.id,name:`${vehicle.name}${vehicle.plate?' · '+vehicle.plate:''}`,latitude:d.latitude,longitude:d.longitude,label:`Posição: ${date(d.gps_at)} · ${statuses[d.provider_status??0]??'Estado indisponível'}`}]:[];
 });
 return <div className="mx-auto max-w-6xl space-y-5">
  <header><Link href="/equipes" className="text-sm font-medium text-forest underline">← Equipes e veículos</Link><h1 className="mt-3 text-3xl font-semibold">Localização dos veículos</h1><p className="mt-2 text-sm text-ink/65">Últimas posições do TrackCEO, vinculadas à frota do CRM. Acesso restrito à gerência.</p></header>
  <section className="card flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="font-semibold">Portal do rastreamento</h2><p className="mt-1 text-sm text-ink/65">Abra o TrackCEO em uma janela própria e mantenha o rastreamento ao lado do CRM.</p></div><Link href="/equipes/rastreamento?painel=1" className="button">Abrir painel TrackCEO</Link></section>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
  {saved&&<p role="status" className="rounded-xl bg-green-50 p-4 text-sm">Rastreamento atualizado.</p>}
  {!error&&status.last_error&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">{TRACKING_ERRORS[status.last_error]} Última consulta concluída: {date(status.last_sync_at)}.</p>}
  <section className="card p-5"><div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">Conexão TrackCEO</h2><p className="mt-1 break-words text-sm">{status.active?`Conectado · ${status.account}`:'Desconectado'}{status.busy?' · Consulta em andamento':''}</p><p className="mt-1 text-xs text-ink/60">Última consulta: {date(status.last_sync_at)}</p></div>
   {status.active&&<div className="flex flex-wrap gap-2"><form action={endpoint} method="post"><input type="hidden" name="action" value="sync"/><SubmitButton className="button" disabled={status.busy}>Atualizar localização</SubmitButton></form><form action={endpoint} method="post"><input type="hidden" name="action" value="disconnect"/><ConfirmButton className="button-ghost" message="Desconectar o TrackCEO do CRM? Os veículos e o histórico de vínculos serão preservados.">Desconectar do CRM</ConfirmButton></form></div>}
  </div>
  <details className="mt-4" open={!status.configured}><summary className="cursor-pointer text-sm font-semibold">{status.configured?'Alterar conta ou senha':'Conectar minha conta'}</summary>
   <form action={endpoint} method="post" className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="tracking-connect"><input type="hidden" name="action" value="connect"/>
    <label><span className="label">Conta do TrackCEO</span><input className="field" name="account" defaultValue={status.account??''} required maxLength={120} autoComplete="off"/></label>
    <label><span className="label">Senha do TrackCEO</span><input className="field" name="password" type="password" required maxLength={256} autoComplete="new-password"/></label>
    <p className="text-xs text-ink/60 sm:col-span-2">Ao conectar, você autoriza o CRM a consultar seus rastreadores e suas posições no TrackCEO. A senha fica criptografada e não é exibida de volta. As posições serão atualizadas quando você clicar em “Atualizar localização”.</p>
    <SubmitButton className="button sm:col-span-2" disabled={status.busy}>Conectar e consultar veículos</SubmitButton>
   </form>
  </details></section>
  {status.active&&<><section className="card p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">Última localização</h2><span className="text-xs text-ink/60">{points.length} veículo(s) no mapa · {available.length} rastreador(es) disponíveis</span></div><TrackingMap points={points} focus={focus}/></section>
  <section className="space-y-3"><h2 className="font-semibold">Rastreadores e vínculos</h2>{!devices.length&&<p className="card p-5 text-sm">Nenhum rastreador retornado para esta conta.</p>}
  {devices.map(d=>{const vehicle=vehicles.find(v=>v.id===d.vehicle_id);const day=days.find(x=>x.vehicle_id===d.vehicle_id);const age=positionAge(d.gps_at);return <article key={d.id} className="card p-5" data-testid="tracking-device">
   <div className="flex flex-wrap justify-between gap-2"><h3 className="min-w-0 break-words font-semibold">{vehicle?.name??d.name}</h3><span className="text-xs font-medium">{!d.available?'Fora da lista atual':statuses[d.provider_status??0]??'Estado indisponível'}</span></div>
   <p className="mt-1 break-words text-xs text-ink/65">{d.name} · IMEI {d.imei}{vehicle?.plate?' · '+vehicle.plate:''}</p>
   {day&&<p className="mt-2 text-sm">Hoje: {day.team_name} · Motorista: {day.driver_name}</p>}
   <p className="mt-3 text-sm">Posição GPS: {date(d.gps_at)}{age==='old'?' · Posição antiga':''}{age==='unknown'?' · Sem posição válida':''}</p>
   {d.latitude!==null&&d.longitude!==null&&<a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.latitude},${d.longitude}`)}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium underline">Abrir localização no Google Maps</a>}
   <p className="mt-1 text-xs text-ink/65">Velocidade na última posição: {d.speed===null?'não informada':`${d.speed} km/h`} · Ignição: {d.ignition===1?'ligada':d.ignition===0?'desligada':'não informada'}</p>
   {d.available&&<form action={endpoint} method="post" className="mt-4 grid items-end gap-3 sm:grid-cols-[1fr_auto]" data-testid="tracking-link"><input type="hidden" name="action" value="link"/><input type="hidden" name="device" value={d.id}/>
    <label><span className="label">Veículo do CRM</span><select name="vehicle" className="field" defaultValue={d.vehicle_id??''}><option value="">Sem vínculo</option>{vehicles.map(v=><option key={v.id} value={v.id} disabled={devices.some(other=>other.id!==d.id&&other.available&&other.vehicle_id===v.id)}>{v.name}{v.plate?' · '+v.plate:''}{v.status==='inativo'?' · Inativo':''}</option>)}</select></label><SubmitButton className="button-ghost">Salvar vínculo</SubmitButton>
   </form>}
   {d.available&&!d.vehicle_id&&<form action={endpoint} method="post" className="mt-3"><input type="hidden" name="action" value="link"/><input type="hidden" name="device" value={d.id}/><input type="hidden" name="vehicle" value=""/><input type="hidden" name="create" value="true"/><SubmitButton className="button-ghost">Cadastrar como veículo e vincular</SubmitButton></form>}
  </article>;})}</section></>}
 </div>;
}
