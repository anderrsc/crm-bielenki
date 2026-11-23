import { beforeAll, afterAll, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './helpers/database';
import { DEFAULT_QUOTE_VALIDITY_DAYS } from '@/lib/utils';
import { RULES } from '@/lib/ai/lia-knowledge';
let db:PGlite, company:string, client:string;
const user='00000000-0000-4000-8000-000000000da1';
const migration=readFileSync('supabase/migrations/20261123181428_validade_padrao_10_dias.sql','utf8');
async function row(sql:string,args:unknown[]=[]){return (await db.query<Record<string,any>>(sql,args)).rows[0];}
beforeAll(async()=>{
  db=await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'validity@test.invalid')",[user]);
  company=(await row("select bootstrap_company('Validade',null,$1) id",[user])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  client=(await row("insert into clients(company_id,name) values($1,'Cliente') returning id",[company])).id;
});
afterAll(async()=>{await db?.close();});
const payload=()=>({client_id:client,discount:0,freight:0,notes:'Teste',items:[{product:'Janela',thickness:'0.50 mm',cut:'200',color:'Branco',measurements:'1200 x 1000',quantity:1,meters:2,unit_price:100}]});
test('banco, tela e conhecimento existente da Lia concordam em 10 dias',async()=>{
  expect((await row('select default_validity_days from companies where id=$1',[company])).default_validity_days).toBe(10);
  expect(DEFAULT_QUOTE_VALIDITY_DAYS).toBe(10);
  expect(RULES.quoteValidityDays).toBe(10);
});
test.each(['create_gutter_quote','create_window_quote'])('%s usa 10 dias quando a data não é informada e respeita data explícita',async fn=>{
  for(const valid_until of ['',undefined,'2027-02-15']){
    const q=(await row(`select ${fn}($1::jsonb) id`,[JSON.stringify({...payload(),valid_until})])).id;
    expect((await row("select valid_until::text v, (current_date+10)::text expected from quotes where id=$1",[q])).v).toBe(valid_until|| (await row('select (current_date+10)::text d')).d);
  }
});
test('reaplicação converte só 7, preserva prazo personalizado e datas existentes',async()=>{
  const q=(await row('select create_window_quote($1::jsonb) id',[JSON.stringify({...payload(),valid_until:'2027-03-01'})])).id;
  await db.query('update companies set default_validity_days=7 where id=$1',[company]);
  await db.exec(migration);
  expect((await row('select default_validity_days d from companies where id=$1',[company])).d).toBe(10);
  await db.query('update companies set default_validity_days=21 where id=$1',[company]);
  await db.exec(migration);
  expect((await row('select default_validity_days d from companies where id=$1',[company])).d).toBe(21);
  expect((await row('select valid_until::text v from quotes where id=$1',[q])).v).toBe('2027-03-01');
  const copy=(await row('select duplicate_quote($1) id',[q])).id;
  expect((await row('select valid_until::text v from quotes where id=$1',[copy])).v).toBe((await row('select (current_date+21)::text d')).d);
  await db.query('update companies set default_validity_days=10 where id=$1',[company]);
});
