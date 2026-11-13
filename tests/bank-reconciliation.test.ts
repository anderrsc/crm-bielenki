import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";
import { readFile } from "node:fs/promises";
let db:PGlite, company:string, account:string, otherAccount:string, category:string, today:string;
const user="00000000-0000-4000-8000-000000000131",denied="00000000-0000-4000-8000-000000000132";
async function row(sql:string,args:unknown[]=[]) {return (await db.query<Record<string,any>>(sql,args)).rows[0];}
const fact=(id="bank-1",amount="50.00")=>({external_id:id,posted_at:today,amount,description:"Extrato de teste"});
async function imported(rows=[fact()],hash="a".repeat(64),acc=account,source:string|null=null){return (await row("select import_bank_statement($1,'teste.ofx',$2,'OFX',$3,$4,'Final 1234') result",[acc,hash,JSON.stringify(rows),source])).result;}
async function reconcile(id:string,mode:string,target:string|null=null,cat:string|null=null,distinct=false){return (await row("select reconcile_bank_row($1,$2,$3,'Conferido com o extrato',$4,$5) id",[id,mode,target,cat,distinct])).id;}
async function transaction(fn:()=>Promise<void>){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function auth(){await db.exec('set local role authenticated');}
beforeAll(async()=>{
  db=await createTestDatabase();
  // Production workflows may retry; replay must preserve the existing schema.
  await db.exec(await readFile(new URL('../supabase/migrations/20261113124117_bank_reconciliation.sql',import.meta.url),'utf8'));
  await db.query("insert into auth.users(id,email) values($1,'bank@test.invalid'),($2,'denied-bank@test.invalid')",[user,denied]);
  company=(await row("select bootstrap_company('Bank',null,$1) id",[user])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Denied')",[denied,company]);
  const other=(await row("insert into companies(name) values('Other bank') returning id")).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  account=(await row("insert into receiving_accounts(company_id,name) values($1,'Bank A') returning id",[company])).id;
  otherAccount=(await row("insert into receiving_accounts(company_id,name) values($1,'Bank B') returning id",[other])).id;
  category=(await row("insert into financial_categories(company_id,name,entry_type,dre_group) values($1,'Taxas','pagar','financeiro') returning id",[company])).id;
  today=(await row("select (now() at time zone 'America/Sao_Paulo')::date::text d")).d;
  await db.exec("grant usage on schema auth to authenticated; grant select on profiles,financial_entries,payments,audit_logs,financial_installments to authenticated");
});
afterAll(async()=>{await db?.close();});

test("imports are idempotent across files and never create financial entries or payments",()=>transaction(async()=>{
  const before=(await row('select count(*)::int n from financial_entries')).n;
  await auth();
  expect(await imported()).toMatchObject({new_rows:1,existing_rows:0});
  expect(await imported()).toMatchObject({new_rows:0,existing_rows:1});
  expect(await imported([fact(),fact('bank-2')],'b'.repeat(64))).toMatchObject({new_rows:1,existing_rows:1});
  expect((await row('select count(*)::int n from bank_statement_rows')).n).toBe(2);
  expect((await row('select count(*)::int n from financial_entries')).n).toBe(before);
  expect((await row('select count(*)::int n from payments')).n).toBe(0);
  await db.exec('savepoint conflicting');
  await expect(imported([fact('bank-1','51.00')],'c'.repeat(64))).rejects.toThrow(/data ou valor diferente/);
  await db.exec('rollback to conflicting');
  expect((await row('select count(*)::int n from bank_statement_imports')).n).toBe(2);
}));

test("matching an existing payment is explicit, amount-safe and repeatable without new payments",()=>transaction(async()=>{
  const e=(await row("insert into financial_entries(company_id,entry_type,origin,description,total_amount) values($1,'receber','manual','Receipt',50) returning id",[company])).id;
  const pid=(await row("select register_payment($1,50,current_date,'pix') id",[e])).id;
  await auth(); await imported();
  const id=(await row('select id from bank_statement_rows')).id;
  expect((await db.query('select * from bank_reconciliation_candidates($1)',[id])).rows).toHaveLength(1);
  expect(await reconcile(id,'match',pid)).toBe(pid);
  expect(await reconcile(id,'match',pid)).toBe(pid);
  expect((await row('select count(*)::int n from payments')).n).toBe(1);
  expect((await row('select receiving_account_id from payments where id=$1',[pid])).receiving_account_id).toBe(account);
  expect((await row('select status from bank_statement_rows where id=$1',[id])).status).toBe('matched');
  await reconcile(id,'undo');
  expect((await row('select reversed_at from payments where id=$1',[pid])).reversed_at).toBeNull();
  expect((await row('select paid_amount::text amount from financial_entries where id=$1',[e])).amount).toBe('50.00');
}));

test("settlement preserves existing installments and adjustments and is atomic",()=>transaction(async()=>{
  const e=(await row("insert into financial_entries(company_id,entry_type,origin,description,total_amount) values($1,'receber','manual','Parcelado',100) returning id",[company])).id;
  await row("select register_payment_with_adjustment($1,10,current_date,'pix',null,12,2,3,current_date)",[e]);
  await auth(); await imported();const id=(await row('select id from bank_statement_rows')).id;
  const pid=await reconcile(id,'settle',e);
  expect(await reconcile(id,'settle',e)).toBe(pid);
  const saved=await row('select total_amount::text total,paid_amount::text paid,installment_count from financial_entries where id=$1',[e]);
  expect(saved).toEqual({total:'110.00',paid:'60.00',installment_count:3});
  await reconcile(id,'undo');await db.exec('savepoint duplicate');
  await expect(reconcile(id,'settle',e)).rejects.toThrow(/Ja existe uma baixa gerada/);
  await db.exec('rollback to duplicate');
  expect((await row('select count(*)::int n from payments')).n).toBe(2);
}));

test("fee creation is explicit, audited and cannot be repeated after unlinking",()=>transaction(async()=>{
  await auth();await imported([fact('fee','-12.34')]);const id=(await row('select id from bank_statement_rows')).id;
  const pid=await reconcile(id,'fee',null,category);
  expect(await reconcile(id,'fee',null,category)).toBe(pid);
  const fee=await row('select e.total_amount::text total,e.paid_amount::text paid,e.category_id from financial_entries e join payments p on p.financial_entry_id=e.id where p.id=$1',[pid]);
  expect(fee).toEqual({total:'12.34',paid:'12.34',category_id:category});
  const audit=await row("select profile_id,new_data from audit_logs where table_name='bank_statement_rows' and record_id=$1 order by id desc limit 1",[id]);
  expect(audit.profile_id).toBe(user);expect(audit.new_data.payment_id).toBe(pid);
  await reconcile(id,'undo');await db.exec('savepoint repeated');
  await expect(reconcile(id,'fee',null,category)).rejects.toThrow(/Ja existe uma baixa gerada/);
  await db.exec('rollback to repeated');
  expect((await row('select count(*)::int n from payments')).n).toBe(1);
  await reconcile(id,'match',pid);await row("select reverse_payment($1,'Estorno de teste')",[pid]);
  expect((await row('select status,payment_id from bank_statement_rows where id=$1',[id]))).toEqual({status:'pending',payment_id:null});
  const next=await reconcile(id,'fee',null,category);
  expect(next).not.toBe(pid);
  expect((await row('select count(*)::int n from financial_entries')).n).toBe(1);
  expect((await row('select sum(paid_amount)::text paid from financial_entries')).paid).toBe('12.34');
}));

test("source binding, row ownership and permissions prevent cross-account/company writes",()=>transaction(async()=>{
  await auth();
  await db.exec('savepoint tenant');
  await expect(imported([fact()],'a'.repeat(64),otherAccount)).rejects.toThrow(/Conta indisponivel/);
  await db.exec('rollback to tenant');
  await imported([fact()],'a'.repeat(64),account,'1'.repeat(64));
  await db.exec('savepoint source');
  await expect(imported([fact('other')],'b'.repeat(64),account,'2'.repeat(64))).rejects.toThrow(/outra conta/);
  await db.exec('rollback to source');
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[denied]);await auth();
  expect((await db.query('select * from bank_statement_rows')).rows).toEqual([]);
  await db.exec('savepoint denied');
  await expect(imported()).rejects.toThrow(/Sem permissao/);
  await db.exec('rollback to denied');
  await expect(db.exec('insert into bank_statement_imports default values')).rejects.toThrow(/permission denied/);
}));

test("anonymous calls and inactive users cannot access the reconciliation service",()=>transaction(async()=>{
  await db.exec('set local role anon; savepoint anonymous');
  await expect(imported()).rejects.toThrow(/permission denied/);await db.exec('rollback to anonymous; reset role');
  await db.query("select set_config('request.jwt.claim.sub','',true)");
  await db.query("update profiles set status='inativo' where id=$1",[user]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await auth();
  await expect(imported()).rejects.toThrow(/Sem permissao/);
}));
