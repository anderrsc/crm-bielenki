import {beforeAll,afterAll,test,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createTestDatabase} from './helpers/database';
let db:PGlite,company:string,other:string,order:string,entry:string;
const user='00000000-0000-4000-8000-000000000151',denied='00000000-0000-4000-8000-000000000152';
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
async function tx(fn:()=>Promise<void>){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
beforeAll(async()=>{
 db=await createTestDatabase();await db.exec(await readFile(new URL('../supabase/migrations/20261113134630_financial_reports.sql',import.meta.url),'utf8'));
 await db.query("insert into auth.users(id,email) values($1,'reports@test.invalid'),($2,'no-reports@test.invalid')",[user,denied]);company=(await row("select bootstrap_company('Reports',null,$1) id",[user])).id;
 other=(await row("insert into companies(name) values('Other reports') returning id")).id;await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Denied')",[denied,company]);
 const client=(await row("insert into clients(company_id,name) values($1,'Client reports') returning id",[company])).id,type=(await row('select id from sale_types where company_id=$1 limit 1',[company])).id;
 const sale=(await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'REPORT-1',$2,$3,1000) returning id",[company,client,type])).id;
 order=(await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'REPORT-1',$2,$3,$4) returning id",[company,sale,client,type])).id;
 entry=(await row("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date,competence_date) values($1,'receber','manual','Extra report',100,current_date-1,current_date) returning id",[company])).id;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await row("select set_financial_entry_allocations($1,$2)",[entry,JSON.stringify([{order_id:order,amount:100}])]);await row("select register_payment($1,25,current_date,'pix')",[entry]);
 await db.exec('grant usage on schema auth to authenticated; grant select on all tables in schema public to authenticated');
});
afterAll(async()=>{await db?.close();});
test('every report query runs with real RLS and does not create payments',()=>tx(async()=>{
 const before=(await row('select count(*)::int n from payments')).n;await db.exec('set local role authenticated');
 for(const kind of ['dre','mensal','caixa','vencidos','fornecedores','clientes','obras','setores','orcado_realizado','materiais','fabricacao','instalacao','veiculos','extraordinarias','executivo']){
  const data=(await row("select financial_report_data($1,current_date-30,current_date+30,null,30) d",[kind])).d;expect(data).toBeDefined();
 }
 expect((await row('select count(*)::int n from payments')).n).toBe(before);
}));
test('work receipts and receivables include allocated extras without changing the sale',async()=>{
 const result=await row('select received_total,receivable_total,margin_partial from v_order_financial_report where order_id=$1',[order]);
 expect(Number(result.received_total)).toBe(25);expect(Number(result.receivable_total)).toBe(1075);expect(result.margin_partial).toBe(true);
});
test('reports aggregate beyond the API page limit and exports record actor and criteria',()=>tx(async()=>{
 await db.query("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date,competence_date) select $1,'pagar','manual','Bulk '||g,1,current_date-1,current_date from generate_series(1,1005) g",[company]);
 await db.exec('set local role authenticated');const data=(await row("select financial_report_data('vencidos',current_date-2,current_date) d")).d;expect(data.length).toBe(1006);
 await row("select record_financial_export('vencidos','csv',$1,$2)",[JSON.stringify({from:'2026-11-01'}),data.length]);
 const audit=await row("select profile_id,new_data from audit_logs where table_name='financial_exports' order by id desc limit 1");expect(audit.profile_id).toBe(user);expect(audit.new_data.rows).toBe(1006);
}));
test('exports deny unauthorized users and never include another company',()=>tx(async()=>{
 await db.query("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date) values($1,'pagar','manual','Other company expense',999,current_date-1)",[other]);
 await db.exec('set local role authenticated');const data=(await row("select financial_report_data('vencidos',current_date-2,current_date) d")).d;expect(data.some((r:any)=>r.description==='Other company expense')).toBe(false);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[denied]);await db.exec('set local role authenticated');
 await db.exec('savepoint denied');await expect(row("select financial_report_data('dre',current_date,current_date)")).rejects.toThrow(/permissao/);await db.exec('rollback to denied');
}));
