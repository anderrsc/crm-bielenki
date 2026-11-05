import { afterAll, beforeAll, expect, test } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './helpers/database';

let db: PGlite;
let company: string, saleType: string;
const admin = '00000000-0000-4000-8000-000000000001';
async function first(sql: string, params: unknown[] = []) { return (await db.query<Record<string, any>>(sql, params)).rows[0]; }
async function addClient(name: string, phone: string | null, extra: Record<string, string> = {}) {
  return (await first('insert into clients(company_id,name,phone,email,notes) values($1,$2,$3,$4,$5) returning id', [company, name, phone, extra.email ?? null, extra.notes ?? null])).id as string;
}
async function blocked(sql: string, params: unknown[]) {
  try { await db.query(sql, params); return null; } catch (e) { return String(e); }
}

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'admin@test.invalid')", [admin]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
  company = (await first("select bootstrap_company('Test',null,$1) id", [admin])).id;
  saleType = (await first('select id from sale_types where company_id=$1 limit 1', [company])).id;
});
afterAll(async () => { await db.close(); });

test('chave do telefone iguala formatos diferentes do mesmo número', async () => {
  const keys = await first("select client_phone_key('(47)9 8495-3693') a, client_phone_key('4798495-3693') b, client_phone_key('+55 47 8495-3693') c, client_phone_key('8495-3693') d");
  expect(keys).toEqual({ a: '47984953693', b: '47984953693', c: '47984953693', d: null });
});

test('não deixa cadastrar o mesmo cliente duas vezes', async () => {
  await addClient('Almir Teste', '(47)9 8495-3693');
  expect(await blocked('insert into clients(company_id,name,phone) values($1,$2,$3)', [company, 'ALMIR TESTE', '4798495-3693'])).toContain('já cadastrado com este telefone');
  expect(await blocked('insert into clients(company_id,name) values($1,$2)', [company, 'almir  teste'])).toContain('já cadastrado com este nome');
  await addClient('Almir Teste', '(47) 99999-1111'); // homônimo com outro telefone é permitido
  await addClient('Outro', '(11) 3333-4444', {});
  expect(await blocked("insert into clients(company_id,name,tax_id) values($1,'X','123.456.789-09'),($1,'Y','12345678909')", [company])).toContain('CPF/CNPJ');
});

test('junta os repetidos levando orçamentos e leads para o cadastro que fica', async () => {
  await db.exec('alter table clients disable trigger clients_block_duplicate');
  const keep = await addClient('Fabio Nicolas Schmidt', '4798410-0000');
  const drop = await addClient('FABIO NICOLAS SCHMIDT', '(47)9 8410-0000', { email: 'fabio@x.invalid', notes: 'cliente antigo' });
  const noPhone = await addClient('Fábio Nicolas Schmidt', null);
  await db.exec('alter table clients enable trigger clients_block_duplicate');
  await db.query("insert into quotes(company_id,quote_number,client_id,sale_type_id) values($1,'ORC-T1',$2,$3),($1,'ORC-T2',$2,$3)", [company, drop, saleType]);
  await db.query("insert into leads(company_id,client_id,name) values($1,$2,'Lead')", [company, noPhone]);

  const n = (await first('select crm_admin.merge_duplicate_clients() n')).n;
  expect(n).toBeGreaterThanOrEqual(2);
  const left = (await db.query<{ id: string }>("select id from clients where client_name_key(name)='fabio nicolas schmidt'")).rows;
  expect(left.map((r) => r.id)).toEqual([drop]); // fica o que tem orçamentos
  expect((await first('select count(*)::int n from quotes where client_id=$1', [drop])).n).toBe(2);
  expect((await first('select count(*)::int n from leads where client_id=$1', [drop])).n).toBe(1);
  expect((await first('select email, notes from clients where id=$1', [drop]))).toEqual({ email: 'fabio@x.invalid', notes: 'cliente antigo' });
  expect((await first('select count(*)::int n from crm_admin.client_merges where keep_id=$1', [drop])).n).toBe(2);
  expect(keep).not.toBe(drop);
  // Rodar de novo não junta nada.
  expect((await first('select crm_admin.merge_duplicate_clients() n')).n).toBe(0);
});
