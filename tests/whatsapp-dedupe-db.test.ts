import {beforeAll,afterAll,test,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
import {webhookEventKey} from '@/lib/whatsapp/message-scope';
let db:PGlite,company:string,ch1:string,ch2:string,c1:string,c2:string;
const user='00000000-0000-4000-8000-000000000db1';
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
beforeAll(async()=>{
  db=await createTestDatabase();await db.query("insert into auth.users(id,email) values($1,'dedupe@test.invalid')",[user]);
  company=(await row("select bootstrap_company('Dedupe',null,$1) id",[user])).id;
  ch1=(await row("insert into whatsapp_channels(company_id,name,provider,instance,is_default) values($1,'Principal','evolution','dedupe-1',true) returning id",[company])).id;
  ch2=(await row("insert into whatsapp_channels(company_id,name,provider,instance) values($1,'Calha','evolution','dedupe-2') returning id",[company])).id;
  c1=(await row("insert into conversations(company_id,channel,channel_id,external_id) values($1,'whatsapp',$2,'5547999990000') returning id",[company,ch1])).id;
  c2=(await row("insert into conversations(company_id,channel,channel_id,external_id) values($1,'whatsapp',$2,'5547999990000') returning id",[company,ch2])).id;
});
afterAll(async()=>{await db?.close();});
test('o mesmo external_id entra em dois canais, permanece bruto e repetições no mesmo canal são recusadas',async()=>{
  for(const conv of [c1,c2])await db.query("insert into messages(company_id,conversation_id,direction,body,external_id) values($1,$2,'inbound','Teste','SAME-ID')",[company,conv]);
  expect((await row("select count(*)::int n from messages where external_id='SAME-ID'")).n).toBe(2);
  await expect(db.query("insert into messages(company_id,conversation_id,direction,body,external_id) values($1,$2,'inbound','Repetida','SAME-ID')",[company,c1])).rejects.toThrow(/unique|duplicate/);
  expect((await row('select channel_id from messages where conversation_id=$1',[c1])).channel_id).toBe(ch1);
});
test('o canal da mensagem é derivado da conversa, sem confiar no valor enviado',async()=>{
  const m=await row("insert into messages(company_id,conversation_id,channel_id,direction,body,external_id) values($1,$2,$3,'inbound','Canal','FORGED') returning channel_id",[company,c1,ch2]);
  expect(m.channel_id).toBe(ch1);
});
test('travas de webhook incluem canal e preservam eventos antigos; soltar uma não afeta a outra',async()=>{
  await db.query("insert into whatsapp_webhook_events(provider,event_id) values('evolution','SAME-ID')");
  const k1=webhookEventKey(ch1,'SAME-ID'),k2=webhookEventKey(ch2,'SAME-ID');
  for(const [key,ch] of [[k1,ch1],[k2,ch2]])await db.query("insert into whatsapp_webhook_events(provider,event_id,channel_id) values('evolution',$1,$2)",[key,ch]);
  await expect(db.query("insert into whatsapp_webhook_events(provider,event_id) values('evolution',$1)",[k1])).rejects.toThrow(/unique|duplicate/);
  await db.query("delete from whatsapp_webhook_events where provider='evolution' and event_id=$1",[k1]);
  expect((await row('select count(*)::int n from whatsapp_webhook_events')).n).toBe(2);
  expect(webhookEventKey('a:b','c')).not.toBe(webhookEventKey('a','b:c'));
});
