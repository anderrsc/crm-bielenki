import {beforeAll,afterAll,test,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
import {readFile} from 'node:fs/promises';
let db:PGlite,company:string,today:string;
const admin='00000000-0000-4000-8000-000000000141',finance='00000000-0000-4000-8000-000000000142';
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
async function tx(fn:()=>Promise<void>){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
const data=(extra:Record<string,unknown>={})=>({description:'Aluguel recorrente',entry_type:'pagar',kind:'normal',amount:'123.45',starts_on:'2026-01-01',ends_on:'2027-12-31',day_of_month:31,interval_months:1,active:true,...extra});
async function save(p=data(),id:string|null=null){return (await row("select save_financial_recurrence($1,$2,'Contrato conferido') id",[id,JSON.stringify(p)])).id;}
beforeAll(async()=>{db=await createTestDatabase();await db.exec(await readFile(new URL("../supabase/migrations/20261113132712_financial_recurrences.sql",import.meta.url),"utf8"));await db.exec("grant usage on schema auth to authenticated; grant select on profiles,financial_entries,payments,receiving_accounts,financial_installments,purchase_orders,audit_logs to authenticated");await db.query("insert into auth.users(id,email) values($1,'recurrence@test.invalid'),($2,'recurrence-finance@test.invalid')",[admin,finance]);company=(await row("select bootstrap_company('Recurrences',null,$1) id",[admin])).id;await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Finance')",[finance,company]);await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'financeiro')",[company,finance]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);today=(await row("select (now() at time zone 'America/Sao_Paulo')::date::text d")).d;});
afterAll(async()=>{await db?.close();});
test('monthly dates clamp to February and no payment or financial entry is created by planning',()=>tx(async()=>{
 await db.exec('set local role authenticated');await save();
 const forecast=(await db.query("select due_date::text d from financial_recurrence_forecast('2026-03-31')")).rows;
 expect(forecast).toEqual([{d:'2026-01-31'},{d:'2026-02-28'},{d:'2026-03-31'}]);
 expect((await row('select count(*)::int n from financial_entries')).n).toBe(0);expect((await row('select count(*)::int n from payments')).n).toBe(0);
}));
test('materialization is repeatable, preserves existing entries after edits and removes exactly one forecast',()=>tx(async()=>{
 await db.exec('set local role authenticated');const id=await save();
 const e=(await row("select materialize_financial_recurrence($1,'2026-02-01','Contrato conferido') id",[id])).id;
 expect((await row("select materialize_financial_recurrence($1,'2026-02-01','Repeticao conferida') id",[id])).id).toBe(e);
 await save(data({amount:'200.00'}),id);
 expect((await row('select total_amount::text n from financial_entries where id=$1',[e])).n).toBe('123.45');
 expect((await row("select count(*)::int n from financial_recurrence_forecast('2026-03-31')")).n).toBe(2);
 expect((await row('select count(*)::int n from payments')).n).toBe(0);
 expect((await row("select count(*)::int n from audit_logs where table_name='financial_recurrences'")).n).toBe(3);
}));
test('payroll forecasts are restricted and cannot be read or materialized by ordinary finance',()=>tx(async()=>{
 const id=await save(data({kind:'payroll',description:'Folha agregada'}));
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[finance]);await db.exec('set local role authenticated');
 expect((await row('select count(*)::int n from financial_recurrences')).n).toBe(0);
 expect((await row("select count(*)::int n from financial_recurrence_forecast('2026-12-31')")).n).toBe(0);
 await db.exec('savepoint denied');await expect(row("select materialize_financial_recurrence($1,'2026-02-01','Teste de acesso')",[id])).rejects.toThrow(/permissao/);await db.exec('rollback to denied');
}));
test('cash includes forecasts once, then replaces them by open entries without changing current balance',()=>tx(async()=>{
 await db.exec('set local role authenticated');const id=await save(data({starts_on:today,ends_on:today,day_of_month:Number(today.slice(-2))}));
 const before=(await row('select cash_overview(30) d')).d;
 expect(before.flows.find((x:any)=>x.date===today).payable).toBe(123.45);
 await row("select materialize_financial_recurrence($1,date_trunc('month',$2::date)::date,'Conferido para lancar')",[id,today]);
 const after=(await row('select cash_overview(30) d')).d;
 expect(after.flows).toEqual(before.flows);expect(after.accounts).toEqual(before.accounts);expect(after.forecast_sources.pending_occurrences).toBe(0);
}));
test('paused plans do not forecast, and direct writes and out-of-schedule creation are denied',()=>tx(async()=>{
 const id=await save(data({active:false}));await db.exec('set local role authenticated');
 expect((await row("select count(*)::int n from financial_recurrence_forecast('2026-12-31')")).n).toBe(0);
 await db.exec('savepoint denied');await expect(row("select materialize_financial_recurrence($1,'2026-02-01','Teste de agenda')",[id])).rejects.toThrow(/programacao/);await db.exec('rollback to denied');
 await db.exec('savepoint direct');await expect(db.query('update financial_recurrences set amount=1 where id=$1',[id])).rejects.toThrow(/permission denied/);await db.exec('rollback to direct');
}));
test('confirmed purchases are forecast only without a financial entry; cancellations are never recreated',()=>tx(async()=>{
 const supplier=(await row("insert into suppliers(company_id,name) values($1,'Supplier forecast') returning id",[company])).id;
 const po=(await row("insert into purchase_orders(company_id,order_number,supplier_id,status,total,expected_at) values($1,'FORECAST-1',$2,'pedido_enviado_ao_fornecedor',321,$3) returning id",[company,supplier,today])).id;
 const e=(await row('select id from financial_entries where purchase_order_id=$1',[po])).id;
 await db.exec('set local role authenticated');let cash=(await row('select cash_overview(30) d')).d;
 expect(cash.forecast_sources.unposted_purchases).toBe(0);expect(cash.flows.find((x:any)=>x.date===today).payable).toBe(321);
 await db.exec('reset role');await db.query("update financial_entries set status='cancelado' where id=$1",[e]);
 await db.exec('set local role authenticated');cash=(await row('select cash_overview(30) d')).d;
 expect(cash.forecast_sources.unposted_purchases).toBe(0);expect(cash.flows).toHaveLength(0);
 // Isolated fixture simulates an older purchase whose ledger entry was never created.
 await db.exec('reset role');await db.query('delete from financial_entries where id=$1',[e]);
 await db.exec('set local role authenticated');cash=(await row('select cash_overview(30) d')).d;
 expect(cash.forecast_sources.unposted_purchases).toBe(1);expect(cash.flows.find((x:any)=>x.date===today).payable).toBe(321);
}));
test('cross-company plans are invisible and inactive profiles cannot change or materialize plans',()=>tx(async()=>{
 const other=(await row("insert into companies(name) values('Other recurrence') returning id")).id;
 const foreign=(await row("insert into financial_recurrences(company_id,description,entry_type,amount,starts_on,ends_on,day_of_month) values($1,'Other company','pagar',1,'2026-01-01','2026-12-31',1) returning id",[other])).id;
 const local=await save();await db.exec('set local role authenticated');
 expect((await db.query('select id from financial_recurrences where id=$1',[foreign])).rows).toHaveLength(0);
 await db.exec('savepoint foreign_plan');await expect(save(data(),foreign)).rejects.toThrow(/indisponivel/);await db.exec('rollback to foreign_plan');
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',true)");await db.query("update profiles set status='inativo' where id=$1",[admin]);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);await db.exec('set local role authenticated');
 await db.exec('savepoint inactive');await expect(row("select materialize_financial_recurrence($1,'2026-02-01','Teste de acesso')",[local])).rejects.toThrow(/permissao/);await db.exec('rollback to inactive');
}));
