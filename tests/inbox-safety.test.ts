import { describe, test, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { inboundTiming } from '@/lib/whatsapp/inbound-safety';
import { deliveryStatus } from '@/lib/whatsapp/delivery';

describe('fresh incoming events', () => {
 test('missing, old and future timestamps never trigger AI', () => {
  const now=Date.now();
  for(const ts of [undefined,0,'invalid',(now-86400000)/1000,(now+60000)/1000]) expect(inboundTiming(ts,now).live).toBe(false);
  expect(inboundTiming(now/1000,now).live).toBe(true);
 });
 test('provider statuses are normalized without inventing delivery', () => {
  expect(deliveryStatus('SERVER_ACK')).toBe('enviada'); expect(deliveryStatus('DELIVERY_ACK')).toBe('entregue');
  expect(deliveryStatus('READ')).toBe('lida'); expect(deliveryStatus('unknown')).toBeNull();
 });
});

test('database: atomic arrivals, historical order, generation and tenant scope', async () => {
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table conversations(id uuid primary key,company_id uuid,last_message_at timestamptz,last_inbound_at timestamptz,last_message_preview text,unread_count int default 0,updated_at timestamptz);
 insert into conversations(id,company_id) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');`);
 await db.exec(readFileSync('supabase/migrations/20261111183213_atendimento_realtime_safety.sql','utf8'));
 const call=(company:string,at:string,historical=false)=>db.query(`select inbox_receive('00000000-0000-0000-0000-000000000001',$1,$2,$3,gen_random_uuid(),$4)`,[company,at,at,historical]);
 const company='00000000-0000-0000-0000-000000000002';
 await Promise.all([call(company,'2026-11-11T10:00:00Z'),call(company,'2026-11-11T10:01:00Z')]);
 await call(company,'2026-11-10T10:00:00Z',true);
 await call('00000000-0000-0000-0000-000000000003','2026-11-12T10:00:00Z');
 const {rows}=await db.query<{unread_count:number,last_message_preview:string,ai_generation_id:string}>('select * from conversations');
 expect(rows[0].unread_count).toBe(2); expect(rows[0].last_message_preview).toBe('2026-11-11T10:01:00Z'); expect(rows[0].ai_generation_id).toBeTruthy();
 // A stale snapshot must not clear a newly arrived message, even with equal count/time.
 const oldGeneration=rows[0].ai_generation_id;
 await call(company,'2026-11-11T10:01:00Z');
 await db.query('update conversations set unread_count=0 where ai_generation_id=$1',[oldGeneration]);
 expect((await db.query<{unread_count:number}>('select unread_count from conversations')).rows[0].unread_count).toBe(3);
 await db.close();
});
