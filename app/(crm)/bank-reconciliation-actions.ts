"use server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { decodeBankStatement, parseBankStatement, MAX_STATEMENT_BYTES } from "@/lib/bank-statement";

const base="/financeiro/conciliacao";
async function context(action:"insert"|"update") {
  const db=await createClient();
  const {data:{user}}=await db.auth.getUser();
  if(!user)redirect('/login');
  const [{data:read},{data:write}]=await Promise.all([
    db.rpc('has_table_access',{resource:'bank_reconciliation',action:'select'}),
    db.rpc('has_table_access',{resource:'bank_reconciliation',action}),
  ]);
  if(read!==true||write!==true)redirect(`${base}?erro=Sem+permissão+para+esta+operação`);
  return db;
}
function dbMessage(error:{code?:string;message?:string}) {
  if(error.code==='42501')return 'Você não tem permissão para esta operação.';
  return error.code==='P0001'?error.message??'Revise os dados.':'Não foi possível concluir. Atualize a página e tente novamente.';
}
export async function importBankStatement(form:FormData) {
  const account=z.uuid().safeParse(form.get('account_id'));
  if(!account.success||form.get('account_confirmed')!=='on')redirect(`${base}?erro=Selecione+e+confirme+a+conta+do+extrato`);
  const db=await context('insert');
  const file=form.get('statement');
  if(!(file instanceof File)||file.size===0||file.size>MAX_STATEMENT_BYTES)redirect(`${base}?conta=${account.data}&erro=Envie+um+arquivo+OFX+ou+CSV+de+até+5+MB`);
  const bytes=new Uint8Array(await file.arrayBuffer());
  let parsed;
  try { parsed=parseBankStatement(decodeBankStatement(bytes),form.get('locale')==='en-US'?'en-US':'pt-BR'); }
  catch(e){redirect(`${base}?conta=${account.data}&erro=${encodeURIComponent(e instanceof Error?e.message:'Extrato inválido.')}`);}
  const {data,error}=await db.rpc('import_bank_statement',{
    p_account:account.data,p_filename:file.name.replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180)||'extrato',
    p_hash:createHash('sha256').update(bytes).digest('hex'),p_format:parsed.format,p_rows:parsed.rows,p_source_key:parsed.source_key,p_hint:parsed.account_hint,
  });
  if(error)redirect(`${base}?conta=${account.data}&erro=${encodeURIComponent(dbMessage(error))}`);
  revalidatePath(base);
  redirect(`${base}?${new URLSearchParams({conta:account.data,novos:String(data.new_rows),existentes:String(data.existing_rows),repetidos:String(parsed.repeated)})}`);
}
export async function reconcileBankRow(form:FormData) {
  const parsed=z.object({row_id:z.uuid(),mode:z.enum(['match','settle','fee','undo','ignore']),target_id:z.uuid().or(z.literal('')).default(''),category_id:z.uuid().or(z.literal('')).default(''),note:z.string().trim().min(3).max(1000)}).safeParse(Object.fromEntries(form));
  if(!parsed.success)redirect(`${base}?erro=Confira+a+operação,+a+seleção+e+a+justificativa`);
  const db=await context('update'),p=parsed.data;
  const {data:movement,error:readError}=await db.from('bank_statement_rows').select('account_id').eq('id',p.row_id).maybeSingle();
  if(readError||!movement)redirect(`${base}?erro=Movimentação+indisponível`);
  const back=`${base}?conta=${movement.account_id}&movimento=${p.row_id}`;
  const {error}=await db.rpc('reconcile_bank_row',{p_row:p.row_id,p_mode:p.mode,p_target:p.target_id||null,p_note:p.note,p_category:p.category_id||null,p_distinct:form.get('distinct_confirmed')==='on'});
  if(error)redirect(`${back}&erro=${encodeURIComponent(dbMessage(error))}`);
  for(const path of [base,'/financeiro','/financeiro/pagar','/financeiro/receber','/financeiro/caixa','/financeiro/dre','/financeiro/rateios'])revalidatePath(path);
  revalidatePath('/vendas','layout');revalidatePath('/pedidos','layout');
  redirect(`${back}&salvo=1`);
}
