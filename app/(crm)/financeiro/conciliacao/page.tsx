import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getAuthUser,getRequestClient } from "@/lib/supabase/server";
import { money,shortDate } from "@/lib/utils";
import { SubmitButton } from "@/components/submit-button";
import { importBankStatement,reconcileBankRow } from "@/app/(crm)/bank-reconciliation-actions";

const base='/financeiro/conciliacao';
const statuses:Record<string,string>={pending:'Pendente',matched:'Conciliado',ignored:'Ignorado'};
type Movement={id:string;account_id:string;external_id:string;posted_at:string;amount:number;description:string;status:string;payment_id:string|null;generated_payment_id:string|null};
type Search={conta?:string;movimento?:string;pagina?:string;situacao?:string;q?:string;busca?:string;janela?:string;antes?:string;erro?:string;salvo?:string;novos?:string;existentes?:string;repetidos?:string};
const unsigned=(v?:string)=>/^\d+$/.test(v??'')&&Number.isSafeInteger(Number(v))?Number(v):0;

export default async function BankReconciliationPage({searchParams}:{searchParams:Promise<Search>}) {
  const search=await searchParams,db=await getRequestClient(),user=await getAuthUser(db);
  if(!user)return <p role="alert">Entre novamente para acessar a conciliação.</p>;
  const [{data:profile},{data:canView,error:permissionError}]=await Promise.all([
    db.from('profiles').select('status').eq('id',user.id).maybeSingle(),
    db.rpc('has_table_access',{resource:'bank_reconciliation',action:'select'}),
  ]);
  if(permissionError)return <p role="alert">Não foi possível verificar suas permissões. Atualize a página.</p>;
  if(canView!==true||profile?.status!=='ativo')return <p role="alert">Você não tem permissão para consultar a conciliação bancária.</p>;
  const resources=[['bank_reconciliation','insert'],['bank_reconciliation','update'],['financial_entries','select'],['financial_entries','update'],['financial_entries','insert'],['payments','select'],['payments','insert']] as const;
  const [accountsResult,...rights]=await Promise.all([
    db.from('receiving_accounts').select('id,name,active').order('name').order('id'),
    ...resources.map(([resource,action])=>db.rpc('has_table_access',{resource,action})),
  ]);
  if(accountsResult.error||rights.some(r=>r.error))return <p role="alert">Não foi possível carregar as contas e permissões. Atualize a página.</p>;
  const access=Object.fromEntries(resources.map(([r,a],i)=>[`${r}:${a}`,rights[i].data===true]));
  const accounts=accountsResult.data??[];
  const selected=search.conta&&z.uuid().safeParse(search.conta).success?accounts.find(a=>a.id===search.conta):accounts.find(a=>a.active)??accounts[0];
  if(search.conta&&!selected)notFound();
  const account=selected?.id??'';
  const status=search.situacao&&statuses[search.situacao]?search.situacao:'pending';
  const page=Math.max(1,unsigned(search.pagina)||1),term=(search.q??'').trim().slice(0,80);
  const href=(params:Record<string,string|number>)=>`${base}?${new URLSearchParams(Object.entries({conta:account,situacao:status,q:term,...params}).filter(([,v])=>v!=='').map(([k,v])=>[k,String(v)]))}`;
  const canWrite=access['bank_reconciliation:update']&&access['financial_entries:select']&&access['financial_entries:update']&&access['payments:select'];
  const selectedMovement=search.movimento&&z.uuid().safeParse(search.movimento).success?search.movimento:null;
  if(search.movimento&&!selectedMovement)notFound();
  const query=account?db.from('bank_statement_rows').select('id,account_id,external_id,posted_at,amount,description,status,payment_id,generated_payment_id',{count:'exact'}).eq('account_id',account).eq('status',status).ilike('description',`%${term.replace(/[\\%_]/g,'\\$&')}%`).order('posted_at',{ascending:false}).order('id').range((page-1)*20,page*20-1):null;
  const [list,detail]=await Promise.all([query??{data:[],count:0,error:null},selectedMovement?db.from('bank_statement_rows').select('id,account_id,external_id,posted_at,amount,description,status,payment_id,generated_payment_id').eq('id',selectedMovement).eq('account_id',account).maybeSingle():{data:null,error:null}]);
  if(list.error||detail.error)return <p role="alert">Não foi possível carregar o extrato. Atualize a página.</p>;
  if(selectedMovement&&!detail.data)notFound();
  const movement=detail.data as Movement|null;
  return <div className="mx-auto max-w-6xl space-y-5">
    <Link href="/financeiro" className="text-sm font-bold text-forest underline">Voltar ao financeiro</Link>
    <h1 className="text-3xl font-black">Conciliação bancária</h1>
    <p className="text-sm text-ink/65">Importar um extrato não registra pagamentos. Confira cada movimento e escolha a baixa correspondente ou confirme um novo pagamento.</p>
    {search.erro&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{search.erro.slice(0,400)}</p>}
    {search.salvo==='1'&&<p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">Conferência salva.</p>}
    {search.novos!==undefined&&<p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{unsigned(search.novos)} movimento(s) novo(s), {unsigned(search.existentes)} já importado(s), {unsigned(search.repetidos)} repetido(s) dentro do arquivo. Nenhuma baixa automática.</p>}
    {!accounts.length?<p className="card p-5">Cadastre uma conta de recebimento no Financeiro antes de importar extratos.</p>:<>
      <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
        <label><span className="label">Conta bancária</span><select className="field" name="conta" defaultValue={account}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}{a.active?'':' (inativa)'}</option>)}</select></label>
        <label><span className="label">Situação</span><select className="field" name="situacao" defaultValue={status}>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label><span className="label">Buscar no extrato</span><input className="field" name="q" defaultValue={term} maxLength={80}/></label><button className="button">Filtrar extrato</button>
      </form>
      {access['bank_reconciliation:insert']&&selected?.active&&<details className="card p-5"><summary className="cursor-pointer font-bold">Importar OFX ou CSV</summary>
        <form action={importBankStatement} className="mt-4 space-y-4">
          <input type="hidden" name="account_id" value={account}/>
          <label className="block"><span className="label">Arquivo do extrato (até 5 MB / 2.000 movimentos)</span><input className="field" type="file" name="statement" accept=".ofx,.csv" required/></label>
          <label className="block"><span className="label">Valores do CSV</span><select name="locale" className="field"><option value="pt-BR">Brasil: 1.234,56</option><option value="en-US">Internacional: 1,234.56</option></select></label>
          <p className="text-sm text-ink/65">CSV em reais: colunas <strong>id, data, valor, descricao</strong>. O identificador deve ser estável entre arquivos; saídas têm valor negativo. Datas DD/MM/AAAA ou AAAA-MM-DD. OFX precisa ser BRL e conter uma única conta.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="account_confirmed" required className="mt-1"/>Conferi que este extrato pertence à conta <strong>{selected?.name}</strong>.</label>
          <SubmitButton className="button">Importar movimentos pendentes</SubmitButton>
        </form>
      </details>}
      {movement&&<MovementPanel movement={movement} accountName={selected?.name??''} access={access} canWrite={canWrite} search={search}/>}
      <section className="card overflow-x-auto p-4"><h2 className="mb-3 text-xl font-bold">Movimentos do extrato · {list.count??0}</h2>
        <table className="mobile-record-table w-full min-w-[600px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Data</th><th className="p-2">Descrição</th><th className="p-2 text-right">Valor</th><th className="p-2">Situação</th><th className="p-2"/></tr></thead><tbody>{(list.data as Movement[]??[]).map(r=><tr key={r.id} className="border-b border-sand"><td data-label="Data" className="p-2">{shortDate(r.posted_at)}</td><td data-label="Descrição" className="p-2">{r.description}</td><td data-label="Valor" className="p-2 text-right font-semibold">{money(r.amount)}</td><td data-label="Situação" className="p-2">{statuses[r.status]}</td><td className="p-2"><Link className="font-bold text-forest underline" href={href({movimento:r.id})}>Conferir</Link></td></tr>)}</tbody></table>
        {!list.data?.length&&<p className="py-6 text-center text-ink/60">Nenhum movimento nesta seleção.</p>}
        <nav className="mt-4 flex justify-between text-sm font-bold">{page>1?<Link href={href({pagina:page-1})}>Anterior</Link>:<span/>}{page*20<(list.count??0)&&<Link href={href({pagina:page+1})}>Próxima</Link>}</nav>
      </section>
    </>}
  </div>;
}

async function MovementPanel({movement:r,accountName,access,canWrite,search}:{movement:Movement;accountName:string;access:Record<string,boolean>;canWrite:boolean;search:Search}) {
  const db=await getRequestClient(),query=(search.busca??'').trim().slice(0,80),window=Math.min(90,Math.max(1,unsigned(search.janela)||7));
  const before=unsigned(search.antes)||null;
  const [candidates,entries,duplicates,categories,history]=await Promise.all([
    canWrite&&r.status==='pending'?db.rpc('bank_reconciliation_candidates',{p_row:r.id,p_window:window,p_query:query||null}):{data:[],error:null},
    canWrite&&access['payments:insert']&&r.status==='pending'?db.from('financial_entries').select('id,description,open_amount,due_date').eq('entry_type',Number(r.amount)>0?'receber':'pagar').neq('status','cancelado').gte('open_amount',Math.abs(Number(r.amount))).ilike('description',`%${query.replace(/[\\%_]/g,'\\$&')}%`).order('due_date').order('id').limit(30):{data:[],error:null},
    db.from('bank_statement_rows').select('id,description,status').eq('account_id',r.account_id).eq('posted_at',r.posted_at).eq('amount',r.amount).eq('status','matched').neq('id',r.id).limit(5),
    canWrite&&r.status==='pending'&&Number(r.amount)<0?db.from('financial_categories').select('id,name').eq('entry_type','pagar').eq('active',true).order('name'):{data:[],error:null},
    db.rpc('bank_reconciliation_history',{p_row:r.id,p_before:before}),
  ]);
  if([candidates,entries,duplicates,categories,history].some(x=>x.error))return <p role="alert">Não foi possível carregar a conferência. Atualize a página.</p>;
  const hasDuplicate=Boolean(duplicates.data?.length);
  const hidden=(mode:string)=><><input type="hidden" name="row_id" value={r.id}/><input type="hidden" name="mode" value={mode}/></>;
  const note=<label className="block"><span className="label">Justificativa da conferência</span><input className="field" name="note" minLength={3} maxLength={1000} required placeholder="Ex.: comprovante e extrato conferidos"/></label>;
  const distinct=hasDuplicate&&<label className="flex items-start gap-2 text-sm"><input className="mt-1" name="distinct_confirmed" type="checkbox" required/>Confirmei que é outra movimentação, mesmo com valor e data iguais. Justificarei com pelo menos 10 caracteres.</label>;
  const rows=history.data as {id:number;occurred_at:string;actor:string|null;old_status:string|null;new_status:string;note:string|null}[]??[];
  return <section className="card space-y-4 border-forest p-5" id="conferencia">
    <h2 className="text-xl font-bold">Conferir movimento</h2><p className="font-semibold">{r.description}</p><p>{shortDate(r.posted_at)} · <strong>{money(r.amount)}</strong> · {accountName} · {statuses[r.status]}</p><p className="text-xs text-ink/60">Identificador do extrato: {r.external_id}</p>
    {hasDuplicate&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Já há movimento conciliado com esta conta, data e valor. Confira a possível duplicidade antes de registrar outra baixa.</p>}
    {r.status==='pending'&&canWrite&&<>
      <form method="get" className="flex flex-wrap items-end gap-2"><input type="hidden" name="conta" value={r.account_id}/><input type="hidden" name="movimento" value={r.id}/><label><span className="label">Buscar baixa ou conta pela descrição</span><input className="field" name="busca" defaultValue={query} maxLength={80}/></label><label><span className="label">Dias antes/depois do extrato</span><select className="field" name="janela" defaultValue={window}>{[7,15,30,90].map(d=><option key={d} value={d}>{d} dias</option>)}</select></label><button className="button-ghost">Buscar correspondências</button></form>
      <details open className="rounded-xl border border-sand p-4"><summary className="cursor-pointer font-bold">Associar uma baixa já registrada</summary><p className="my-3 text-sm text-ink/60">Sugestões por valor e tipo, até 20 resultados. Nenhuma é selecionada automaticamente.</p>
        {candidates.data?.length?<form action={reconcileBankRow} className="space-y-3">{hidden('match')}<label><span className="label">Baixa existente</span><select className="field" name="target_id" required defaultValue=""><option value="">Selecione a baixa conferida</option>{candidates.data.map((p:{payment_id:string;description:string;amount:number;paid_at:string})=><option key={p.payment_id} value={p.payment_id}>{shortDate(p.paid_at)} · {p.description} · {money(p.amount)}</option>)}</select></label>{note}<SubmitButton className="button">Associar baixa existente</SubmitButton></form>:<p className="text-sm text-ink/60">Nenhuma baixa sugerida. Refine a descrição ou amplie o período.</p>}
      </details>
      {access['payments:insert']&&<details className="rounded-xl border border-sand p-4"><summary className="cursor-pointer font-bold">Registrar uma nova baixa em conta existente</summary><p className="my-3 text-sm text-ink/60">Use somente quando este valor ainda não tiver sido registrado no financeiro. Até 30 contas; refine a descrição se necessário. Juros, desconto e parcelas existentes serão preservados.</p>
        {entries.data?.length?<form action={reconcileBankRow} className="space-y-3">{hidden('settle')}<label><span className="label">Conta a {Number(r.amount)>0?'receber':'pagar'}</span><select className="field" name="target_id" required defaultValue=""><option value="">Selecione a conta conferida</option>{entries.data.map((e:{id:string;description:string;open_amount:number})=><option key={e.id} value={e.id}>{e.description} · em aberto {money(e.open_amount)}</option>)}</select></label>{note}{distinct}<SubmitButton className="button">Registrar baixa de {money(Math.abs(Number(r.amount)))}</SubmitButton></form>:<p className="text-sm text-ink/60">Nenhuma conta compatível com saldo suficiente.</p>}
      </details>}
      {Number(r.amount)<0&&access['payments:insert']&&access['financial_entries:insert']&&<details className="rounded-xl border border-sand p-4"><summary className="cursor-pointer font-bold">Criar despesa para taxa ainda não lançada</summary><p className="my-3 text-sm text-ink/60">Cria a conta a pagar e registra a baixa no valor do extrato. Transferências entre contas não são despesas.</p><form action={reconcileBankRow} className="space-y-3">{hidden('fee')}<label><span className="label">Categoria da taxa</span><select className="field" name="category_id" required defaultValue=""><option value="">Selecione</option>{categories.data?.map((c:{id:string;name:string})=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{note}{distinct}<SubmitButton className="button">Criar despesa e dar baixa de {money(Math.abs(Number(r.amount)))}</SubmitButton></form></details>}
    </>}
    {r.status==='pending'&&!canWrite&&<p>Você pode consultar os movimentos. A associação e o registro de baixas exigem permissões financeiras.</p>}
    {access['bank_reconciliation:update']&&<details className="rounded-xl border border-sand p-4"><summary className="cursor-pointer font-bold">{r.status==='pending'?'Ignorar movimento com justificativa':'Reabrir conferência'}</summary><p className="my-3 text-sm text-ink/60">Ignorar preserva o extrato. Reabrir/desvincular não estorna pagamentos nem altera a conta já informada na baixa.</p><form action={reconcileBankRow} className="space-y-3">{hidden(r.status==='pending'?'ignore':'undo')}{note}<SubmitButton className="button-ghost">{r.status==='pending'?'Ignorar este movimento':'Reabrir este movimento'}</SubmitButton></form></details>}
    <details className="rounded-xl border border-sand p-4"><summary className="cursor-pointer font-bold">Histórico da conferência</summary><ul className="mt-3 space-y-3 text-sm">{rows.map(h=><li key={h.id} className="border-b border-sand pb-2"><p>{new Date(h.occurred_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {h.actor??'Sistema'} · {statuses[h.old_status??'pending']} → {statuses[h.new_status]}</p><p className="text-ink/65">{h.note}</p></li>)}</ul>{!rows.length&&<p className="mt-3 text-sm text-ink/60">Nenhuma alteração de conferência.</p>}{rows.length===50&&<Link className="mt-3 inline-block text-sm font-bold text-forest underline" href={`${base}?conta=${r.account_id}&movimento=${r.id}&antes=${rows[rows.length-1].id}`}>Mais antigas</Link>}{before&&<Link className="ml-3 text-sm font-bold text-forest underline" href={`${base}?conta=${r.account_id}&movimento=${r.id}`}>Mais recentes</Link>}</details>
  </section>;
}
