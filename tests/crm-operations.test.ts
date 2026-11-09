import { beforeAll,afterAll,beforeEach,afterEach,test,expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './helpers/database';
let db:PGlite,company:string,other:string;
const admin='00000000-0000-4000-8000-000000000011',admin2='00000000-0000-4000-8000-000000000012';
async function rows(sql:string,params:unknown[]=[]){return (await db.query<Record<string,any>>(sql,params)).rows}
async function one(sql:string,params:unknown[]=[]){return (await rows(sql,params))[0]}
beforeAll(async()=>{
 db=await createTestDatabase();
 await db.exec("grant usage on schema public,auth to authenticated; grant select,update on public.quotes,public.quote_items to authenticated");
 await db.query("insert into auth.users(id,email) values($1,'ops1@test.invalid'),($2,'ops2@test.invalid')",[admin,admin2]);
 company=(await one("select bootstrap_company('Ops A',null,$1) id",[admin])).id;
 other=(await one("select bootstrap_company('Ops B',null,$1) id",[admin2])).id;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
});
afterAll(async()=>{await db?.close()});
beforeEach(async()=>{await db.exec('begin')});afterEach(async()=>{await db.exec('rollback')});
async function triage(status='concluida',maintenance=false){return await one(`insert into triage_sessions(company_id,phone,status,nome,produto,medidas,eh_manutencao,dados_coletados)
 values($1,'5547998887766',$2,'Cliente da Ana','Calha e rufo','2m',$3,$4) returning id`,[company,status,maintenance,JSON.stringify({nome:'Cliente da Ana',medidas:'2 m',itens:[{produto:'Calha',medidas:'Comprimento 2 m, corte 300 mm',quantidade:2,unidade:'un'},{produto:'Rufo',medidas:'Comprimento 1 m',quantidade:3,unidade:'un'}]})])}
test('completed triage atomically creates client, itemized zero-price draft and scoped notifications, once',async()=>{
 const s=await triage();
 const q=await one('select * from quotes where triage_session_id=$1',[s.id]);expect(q.status).toBe('rascunho');expect(Number(q.total)).toBe(0);
 const items=await rows('select product,quantity,unit_price,description from quote_items where quote_id=$1 order by product',[q.id]);
 expect(items).toHaveLength(2);expect(items[0].product).toBe('Calha');expect(Number(items[0].quantity)).toBe(2);expect(items[0].description).toContain('300 mm');expect(items.every(i=>Number(i.unit_price)===0)).toBe(true);
 expect((await one('select quote_id from triage_sessions where id=$1',[s.id])).quote_id).toBe(q.id);
 await db.query("update triage_sessions set status='concluida' where id=$1",[s.id]);
 expect((await rows('select id from quotes where triage_session_id=$1',[s.id]))).toHaveLength(1);
 expect((await rows("select profile_id from notifications where event_key=$1",['triage:'+s.id])).map(n=>n.profile_id)).toEqual([admin]);
});
test('incomplete, maintenance and after-sales do not create quotes',async()=>{
 await triage('em_andamento');await triage('pos_venda',true);await triage('concluida',true);
 expect(await rows('select id from quotes')).toHaveLength(0);
});
test('existing client is reused and draft prices can be edited through authenticated RLS',async()=>{
 const client=await one("insert into clients(company_id,name,phone) values($1,'Existente','(47) 99888-7766') returning id",[company]);
 const s=await triage();const q=await one('select * from quotes where triage_session_id=$1',[s.id]);expect(q.client_id).toBe(client.id);
 const items=await rows('select id,product,description,quantity from quote_items where quote_id=$1',[q.id]);
 await db.exec('set local role authenticated');
 await db.query('select save_triage_draft($1,$2)',[q.id,JSON.stringify(items.map(i=>({...i,unit_price:10})))]);
 expect(Number((await one('select subtotal from quotes where id=$1',[q.id])).subtotal)).toBe(50);
});
test('health monitor suppresses transient failures, deduplicates outage, alerts restoration and rearms',async()=>{
 await db.query("select record_whatsapp_health($1,'unreachable')",[company]);expect(await rows('select id from notifications')).toHaveLength(0);
 await db.query("select record_whatsapp_health($1,'unreachable')",[company]);await db.query("select record_whatsapp_health($1,'close')",[company]);
 expect(await rows("select id from notifications where event_key like 'wa-down:%'")).toHaveLength(1);
 await db.query("select record_whatsapp_health($1,'open')",[company]);await db.query("select record_whatsapp_health($1,'open')",[company]);
 expect(await rows("select id from notifications where event_key like 'wa-restored:%'")).toHaveLength(1);
 await db.query("select record_whatsapp_health($1,'close')",[company]);await db.query("select record_whatsapp_health($1,'close')",[company]);
 expect(await rows("select id from notifications where event_key like 'wa-down:%'")).toHaveLength(2);
});
test('three-day followup uses send time, runs once and ignores replied or approved quotes',async()=>{
 const s=await triage();const q=await one('select * from quotes where triage_session_id=$1',[s.id]);
 await db.query("update quotes set status='enviado' where id=$1",[q.id]);
 expect((await one('select collect_quote_followups() n')).n).toBe(0);
 await db.query("update quotes set sent_at=now()-interval '3 days 1 minute' where id=$1",[q.id]);
 expect((await one('select collect_quote_followups() n')).n).toBe(1);expect((await one('select collect_quote_followups() n')).n).toBe(0);
 expect(await rows("select id from notifications where event_key like 'quote-followup:%'")).toHaveLength(1);
 await db.query("update quotes set status='rascunho' where id=$1",[q.id]);await db.query("update quotes set status='enviado',sent_at=now()-interval '4 days' where id=$1",[q.id]);
 await db.query("update quotes set sent_at=now()-interval '4 days' where id=$1",[q.id]);
 const c=await one("insert into conversations(company_id,client_id,channel) values($1,$2,'whatsapp') returning id",[company,q.client_id]);
 await db.query("insert into messages(company_id,conversation_id,direction,body) values($1,$2,'inbound','Obrigado')",[company,c.id]);
 expect((await one('select collect_quote_followups() n')).n).toBe(0);
 await db.query("update quotes set status='aprovado',followup_notified_at=null where id=$1",[q.id]);
 expect((await one('select collect_quote_followups() n')).n).toBe(0);
});
test('operational secrets and background jobs cannot be accessed by a user or anonymous role',async()=>{
 for(const role of ['authenticated','anon']){
  await db.exec(`savepoint isolation; set local role ${role}`);
  await expect(rows('select * from crm_operations_config')).rejects.toThrow(/permission denied/);
  await db.exec('rollback to isolation');await db.exec(`set local role ${role}`);
  await expect(rows("select record_whatsapp_health($1,'close')",[other])).rejects.toThrow(/permission denied/);
  await db.exec('rollback to isolation');
 }
 expect((await one("select public from storage.buckets where id='atendimento-files'")).public).toBe(false);
});
