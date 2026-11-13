import Link from 'next/link';
import {notFound} from 'next/navigation';
import {z} from 'zod';
import {getAuthUser,getRequestClient} from '@/lib/supabase/server';
import {money,shortDate,todayISO} from '@/lib/utils';
import {SubmitButton} from '@/components/submit-button';
import {saveRecurrence,materializeRecurrence} from '@/app/(crm)/recurrence-actions';
type Plan={id:string;description:string;entry_type:'pagar'|'receber';kind:'normal'|'payroll';amount:number;starts_on:string;ends_on:string;day_of_month:number;interval_months:number;category_id:string|null;cost_center_id:string|null;active:boolean};
const base='/financeiro/recorrencias';
export default async function RecurrencesPage({searchParams}:{searchParams:Promise<{editar?:string;mes?:string;pagina?:string;q?:string;erro?:string;salvo?:string}>}){
 const s=await searchParams,db=await getRequestClient(),user=await getAuthUser(db);if(!user)return <p role="alert">Entre novamente.</p>;
 const actions=['select','insert','update'] as const;
 const [profile,...rights]=await Promise.all([db.from('profiles').select('status').eq('id',user.id).maybeSingle(),...actions.map(action=>db.rpc('has_table_access',{resource:'financial_recurrences',action})),...actions.map(action=>db.rpc('has_table_access',{resource:'financial_payroll',action}))]);
 if(profile.error||rights.some(x=>x.error))return <p role="alert">Não foi possível verificar permissões.</p>;
 if(profile.data?.status!=='ativo'||rights[0].data!==true)return <p role="alert">Sem permissão para recorrências.</p>;
 const create=rights[1].data===true,update=rights[2].data===true,payrollCreate=rights[4].data===true,payrollUpdate=rights[5].data===true;
 const today=todayISO(),month=/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(s.mes??'')?s.mes!:today.slice(0,7);
 const end=new Date(`${month}-01T12:00:00Z`);end.setUTCMonth(end.getUTCMonth()+1,0);const last=end.toISOString().slice(0,10);
 const page=Math.max(1,Math.min(100000,Number.parseInt(s.pagina??'1',10)||1)),term=(s.q??'').trim().slice(0,80);
 if(s.editar&&!z.uuid().safeParse(s.editar).success)notFound();
 const [list,edit,categories,centers,entryPermission]=await Promise.all([
 db.from('financial_recurrences').select('*',{count:'exact'}).ilike('description',`%${term.replace(/[\\%_]/g,'\\$&')}%`).order('active',{ascending:false}).order('description').order('id').range((page-1)*20,page*20-1),
 s.editar?db.from('financial_recurrences').select('*').eq('id',s.editar).maybeSingle():{data:null,error:null},
 db.from('financial_categories').select('id,name,entry_type').eq('active',true).order('name'),db.from('financial_cost_centers').select('id,name').eq('active',true).order('name'),db.rpc('has_table_access',{resource:'financial_entries',action:'insert'})]);
 if([list,edit,categories,centers,entryPermission].some(x=>x.error))return <p role="alert">Não foi possível carregar as recorrências.</p>;
 if(s.editar&&!edit.data)notFound();
 const plans=list.data as Plan[]??[],current=edit.data as Plan|null;
 const ids=plans.map(r=>r.id);
 const [forecast,posted]=ids.length?await Promise.all([db.rpc('financial_recurrence_forecast',{p_end:last}).in('recurrence_id',ids).eq('month',`${month}-01`),db.from('financial_recurrence_occurrences').select('recurrence_id,entry_id').in('recurrence_id',ids).eq('month',`${month}-01`)]):[{data:[],error:null},{data:[],error:null}];
 if(forecast.error||posted.error)return <p role="alert">Não foi possível carregar as competências.</p>;
 const due=new Map<string,{due_date:string;amount:number}>((forecast.data??[]).map((r:{recurrence_id:string;due_date:string;amount:number})=>[r.recurrence_id,r]));
 const materialized=new Set((posted.data??[]).map((r:{recurrence_id:string})=>r.recurrence_id));
 const canEdit=current?update&&(current.kind!=='payroll'||payrollUpdate):create;
 const nextYear=Number(today.slice(0,4))+1,lastNextYear=new Date(Date.UTC(nextYear,Number(today.slice(5,7)),0)).getUTCDate();
 const defaultEnd=`${nextYear}-${today.slice(5,7)}-${String(Math.min(Number(today.slice(-2)),lastNextYear)).padStart(2,'0')}`;
 const href=(p:Record<string,string|number>)=>`${base}?${new URLSearchParams(Object.entries({mes:month,q:term,...p}).map(([k,v])=>[k,String(v)]))}`;
 return <div className="mx-auto max-w-6xl space-y-5"><Link className="text-sm font-bold text-forest underline" href="/financeiro">Voltar ao financeiro</Link><h1 className="text-3xl font-black">Contas recorrentes e previsões</h1>
 <p className="text-sm text-ink/65">A programação entra na projeção de caixa. Criar a conta de uma competência exige confirmação e não registra pagamento. Alterar ou pausar a programação preserva as contas já criadas.</p>
 {s.erro&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{s.erro.slice(0,400)}</p>}{s.salvo==='1'&&<p role="status" className="rounded-xl bg-emerald-50 p-4">Alteração salva.</p>}
 {canEdit&&<details className="card p-5" open={Boolean(current)}><summary className="font-bold cursor-pointer">{current?'Editar programação':'Nova programação'}</summary><form action={saveRecurrence} className="mt-4 grid gap-3 sm:grid-cols-2">
 <input type="hidden" name="id" value={current?.id??''}/><label><span className="label">Descrição (sem dados individuais da folha)</span><input className="field" name="description" required minLength={3} maxLength={180} defaultValue={current?.description}/></label>
 {current?<><input type="hidden" name="entry_type" value={current.entry_type}/><input type="hidden" name="kind" value={current.kind}/></>:<><label><span className="label">Tipo</span><select className="field" name="entry_type"><option value="pagar">A pagar</option><option value="receber">A receber</option></select></label><label><span className="label">Natureza</span><select className="field" name="kind"><option value="normal">Despesa ou receita recorrente</option>{payrollCreate&&<option value="payroll">Folha e encargos: previsão agregada restrita</option>}</select></label></>}
 <label><span className="label">Valor por competência</span><input className="field" name="amount" inputMode="decimal" required defaultValue={current?Number(current.amount).toLocaleString('pt-BR',{minimumFractionDigits:2}):''}/></label>
 <label><span className="label">Início</span><input className="field" name="starts_on" type="date" required defaultValue={current?.starts_on??today}/></label><label><span className="label">Fim (até 10 anos)</span><input className="field" name="ends_on" type="date" required defaultValue={current?.ends_on??defaultEnd}/></label>
 <label><span className="label">Dia do vencimento</span><input className="field" name="day_of_month" type="number" min={1} max={31} required defaultValue={current?.day_of_month??Number(today.slice(-2))}/><span className="text-xs text-ink/60">Dias 29–31 usam o último dia nos meses mais curtos.</span></label>
 <label><span className="label">Repetir a cada</span><select className="field" name="interval_months" defaultValue={current?.interval_months??1}>{[1,3,6,12].map(n=><option key={n} value={n}>{n} mês(es)</option>)}</select></label>
 <label><span className="label">Categoria (do mesmo tipo da conta)</span><select className="field" name="category_id" defaultValue={current?.category_id??''}><option value="">Sem categoria</option>{categories.data?.map(c=><option key={c.id} value={c.id}>{c.name} · {c.entry_type==='pagar'?'Despesa':'Receita'}</option>)}</select></label><label><span className="label">Centro de custos</span><select className="field" name="cost_center_id" defaultValue={current?.cost_center_id??''}><option value="">Sem centro</option>{centers.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label><span className="label">Justificativa</span><input className="field" name="reason" required minLength={3} maxLength={1000}/></label><label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={current?.active??true}/>Programação ativa</label><SubmitButton className="button">Salvar programação</SubmitButton>{current&&<Link className="button-ghost" href={base}>Cancelar edição</Link>}
 </form></details>}
 <form className="card flex flex-wrap items-end gap-3 p-4"><label><span className="label">Competência</span><input className="field" type="month" name="mes" defaultValue={month}/></label><label><span className="label">Buscar programação</span><input className="field" name="q" defaultValue={term} maxLength={80}/></label><button className="button">Consultar</button></form>
 <div className="space-y-3">{plans.map(r=>{const f=due.get(r.id),writable=update&&(r.kind!=='payroll'||payrollUpdate);return <article key={r.id} className="card space-y-3 p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-bold">{r.description}</h2><strong>{money(r.amount)} · {r.entry_type==='pagar'?'a pagar':'a receber'}</strong></div><p className="text-sm text-ink/65">{r.active?'Ativa':'Pausada'} · {shortDate(r.starts_on)} a {shortDate(r.ends_on)} · a cada {r.interval_months} mês(es){r.kind==='payroll'?' · Folha agregada restrita':''}</p>
 {writable&&<Link href={href({editar:r.id})} className="text-sm font-bold text-forest underline">Editar ou pausar programação</Link>}
 {materialized.has(r.id)?<p className="text-sm text-emerald-800">Conta desta competência já criada. Confira no financeiro; inclusive cancelamentos e pagamentos devem ser tratados lá.</p>:f?<><p className="text-sm">Previsão desta competência: {money(f.amount)} em {shortDate(f.due_date)}.</p>{writable&&entryPermission.data===true&&<details><summary className="cursor-pointer font-bold text-forest">Criar conta desta competência</summary><form action={materializeRecurrence} className="mt-3 space-y-3"><input type="hidden" name="id" value={r.id}/><input type="hidden" name="month" value={`${month}-01`}/><label className="block"><span className="label">Justificativa da criação</span><input name="reason" className="field" required minLength={3} maxLength={1000}/></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" required/>Conferi competência, valor e vencimento. Criar a conta não significa pagá-la.</label><SubmitButton className="button">Confirmar criação da conta</SubmitButton></form></details>}</>:<p className="text-sm text-ink/60">Sem previsão pendente nesta competência.</p>}</article>})}</div>
 {!plans.length&&<p className="card p-5">Nenhuma programação nesta seleção.</p>}<nav className="flex justify-between font-bold">{page>1?<Link href={href({pagina:page-1})}>Anterior</Link>:<span/>}{page*20<(list.count??0)&&<Link href={href({pagina:page+1})}>Próxima</Link>}</nav>
 <p className="text-xs text-ink/60">Folha nesta tela é somente previsão agregada; não registre salários ou dados de funcionários. Programações de folha só aparecem para perfis autorizados. Contas geradas aparecem no financeiro comum.</p>
 </div>;
}
