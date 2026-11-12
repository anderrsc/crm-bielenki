import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, other: string, c1: string, c2: string, foreign: string, order: string, sale: string;
const user = "00000000-0000-4000-8000-000000000071";
const denied = "00000000-0000-4000-8000-000000000072";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const entry = async (total: number, type = "pagar", saleId: string | null = null) =>
  (await row("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date,sale_id) values($1,$2,'manual','Rateio',$3,current_date+5,$4) returning id", [company, type, total, saleId])).id as string;
const allocate = (id: string, rows: unknown[]) => row("select set_financial_entry_allocations($1,$2::jsonb) n", [id, JSON.stringify(rows)]);
const amounts = async (id: string) => (await db.query<{ amount: string }>("select amount from financial_entry_allocations where entry_id=$1 order by created_at,amount", [id])).rows.map((r) => Number(r.amount));

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'alloc@test.invalid'),($2,'alloc-denied@test.invalid')", [user, denied]);
  company = (await row("select bootstrap_company('Allocations',null,$1) id", [user])).id;
  other = (await row("insert into companies(name) values('Other allocations') returning id")).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Denied')", [denied, company]);
  c1 = (await row("insert into financial_cost_centers(company_id,name) values($1,'Obras') returning id", [company])).id;
  c2 = (await row("insert into financial_cost_centers(company_id,name) values($1,'Administrativo') returning id", [company])).id;
  foreign = (await row("insert into financial_cost_centers(company_id,name) values($1,'Alheio') returning id", [other])).id;
  const client = (await row("insert into clients(company_id,name,phone) values($1,'Cliente Rateio','47999990071') returning id", [company])).id;
  const type = (await row("select id from sale_types where company_id=$1 limit 1", [company])).id;
  sale = (await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'VEN-R1',$2,$3,1000) returning id", [company, client, type])).id;
  order = (await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'PED-R1',$2,$3,$4) returning id", [company, sale, client, type])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
});
afterAll(async () => { await db?.close(); });

test("percentuais fecham exatamente o total, com a sobra dos centavos na ultima linha", async () => {
  const id = await entry(100.01);
  await allocate(id, [{ cost_center_id: c1, percent: 33.33 }, { order_id: order, percent: 33.33 }, { cost_center_id: c2, percent: 33.34 }]);
  const saved = await amounts(id);
  expect(saved.reduce((s, n) => s + Math.round(n * 100), 0)).toBe(10001);
  expect(saved).toContain(33.35);
  await expect(allocate(id, [{ cost_center_id: c1, percent: 60 }, { cost_center_id: c2, percent: 30 }])).rejects.toThrow(/somar 100/);
  expect((await amounts(id)).length).toBe(3);
});

test("valores precisam somar o total; repetidos, cadastro de outra empresa e conta cancelada sao recusados", async () => {
  const id = await entry(250);
  await expect(allocate(id, [{ cost_center_id: c1, amount: 100 }, { cost_center_id: c2, amount: 100 }])).rejects.toThrow(/precisa ser igual ao total/);
  await expect(allocate(id, [{ cost_center_id: c1, amount: 125 }, { cost_center_id: c1, amount: 125 }])).rejects.toThrow(/repetidos/);
  await expect(allocate(id, [{ cost_center_id: foreign, amount: 250 }])).rejects.toThrow(/indisponivel/);
  await expect(allocate(id, [{ amount: 250 }])).rejects.toThrow(/obra ou o centro/);
  expect(await amounts(id)).toEqual([]);
  await allocate(id, [{ cost_center_id: c1, amount: 100 }, { order_id: order, cost_center_id: c2, amount: 150 }]);
  expect(await amounts(id)).toEqual([100, 150]);
  expect((await row("select count(*)::int n from audit_logs where table_name='financial_entry_allocations' and record_id=$1 and profile_id=$2", [id, user])).n).toBe(1);
  await allocate(id, []);
  expect(await amounts(id)).toEqual([]);
  const cancelled = await entry(50);
  await db.query("update financial_entries set status='cancelado' where id=$1", [cancelled]);
  await expect(allocate(cancelled, [{ cost_center_id: c1, amount: 50 }])).rejects.toThrow(/cancelada/);
});

test("usuario sem permissao financeira nao rateia", async () => {
  const id = await entry(80);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [denied]);
  try { await expect(allocate(id, [{ cost_center_id: c1, amount: 80 }])).rejects.toThrow(/permissao/); }
  finally { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); }
});

test("resultado por obra nao conta a mesma conta duas vezes", async () => {
  await db.query("delete from financial_entry_allocations");
  const direct = await entry(200, "pagar", sale);
  const shared = await entry(300, "pagar", sale);
  await allocate(shared, [{ order_id: order, amount: 120 }, { cost_center_id: c2, amount: 180 }]);
  const result = await row("select contracted,cost_total,margin from v_order_financials where order_id=$1", [order]);
  expect(Number(result.contracted)).toBe(1000);
  expect(Number(result.cost_total)).toBe(320);
  expect(Number(result.margin)).toBe(680);
  await allocate(direct, [{ order_id: order, amount: 200 }]);
  expect(Number((await row("select cost_total from v_order_financials where order_id=$1", [order])).cost_total)).toBe(320);
});
