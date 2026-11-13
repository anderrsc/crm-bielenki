import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";
let db: PGlite, company: string, account: string;
const user="00000000-0000-4000-8000-000000000121", denied="00000000-0000-4000-8000-000000000122";
async function row(sql:string,args:unknown[]=[]) { return (await db.query<Record<string,any>>(sql,args)).rows[0]; }
beforeAll(async()=>{
  db=await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'cash-safety@test.invalid'),($2,'no-finance@test.invalid')",[user,denied]);
  company=(await row("select bootstrap_company('Safety',null,$1) id",[user])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Denied')",[denied,company]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  account=(await row("insert into receiving_accounts(company_id,name,opening_balance) values($1,'Banco',1000) returning id",[company])).id;
  await db.exec("grant usage on schema auth to authenticated; grant select on profiles,audit_logs,payments,financial_entries,financial_installments to authenticated");
});
afterAll(async()=>{await db?.close();});
test("future settlements stay out of today's cash and remain in the projection without duplication",async()=>{
  await db.exec('begin');
  try {
    const e=(await row("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date) values($1,'receber','manual','Future',200,current_date+5) returning id",[company])).id;
    const p=(await row("select register_payment($1,200,current_date+3,'pix') id",[e])).id;
    await db.query("update payments set receiving_account_id=$1 where id=$2",[account,p]);
    const o=(await row('select cash_overview(30) o')).o;
    expect(o.accounts[0].balance).toBe(1000);
    expect(o.flows.reduce((n:number,f:any)=>n+f.receivable,0)).toBe(200);
    await db.query("update payments set paid_at=current_date where id=$1",[p]);
    const today=(await row('select cash_overview(30) o')).o;
    expect(today.accounts[0].balance).toBe(1200);
    expect(today.flows).toEqual([]);
  } finally {await db.exec('rollback');}
});
test("balance changes require finance permission at database level, including direct API writes",async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[denied]);
  await db.exec('begin; set local role authenticated');
  try {await expect(row('update receiving_accounts set opening_balance=9000 where id=$1',[account])).rejects.toThrow(/Sem permissao/);}
  finally {await db.exec('rollback');}
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  await db.exec('begin; set local role authenticated');
  try {await expect(row('update receiving_accounts set opening_date=current_date+1 where id=$1',[account])).rejects.toThrow(/data futura/);}
  finally {await db.exec('rollback');}
});
test("authorized opening balance changes record old/new values and actor",async()=>{
  await db.exec('begin; set local role authenticated');
  try {
    await db.query('update receiving_accounts set opening_balance=1500 where id=$1',[account]);
    const a=await row("select profile_id,old_data,new_data from audit_logs where table_name='receiving_accounts' and record_id=$1 order by id desc limit 1",[account]);
    expect(a.profile_id).toBe(user);expect(a.old_data.opening_balance).toBe(1000);expect(a.new_data.opening_balance).toBe(1500);
  } finally {await db.exec('rollback');}
});
test("non-finite opening balances are rejected by the database",async()=>{
  await db.exec('begin');
  try {await expect(row("update receiving_accounts set opening_balance='NaN'::numeric where id=$1",[account])).rejects.toThrow(/cash_opening_finite/);}
  finally {await db.exec('rollback');}
});
