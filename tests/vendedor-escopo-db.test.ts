import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Vendedor vê só as próprias vendas; gerente, e quem tem também outro cargo operacional, veem todas.
let db: PGlite, A: string;
const boss = "00000000-0000-4000-8000-0000000007a1", v1 = "00000000-0000-4000-8000-0000000007a2", v2 = "00000000-0000-4000-8000-0000000007a3", vp = "00000000-0000-4000-8000-0000000007a4";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const count = (user: string, table: string) => as(user, async () => Number((await row(`select count(*) n from ${table}`)).n));

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'a@t.invalid'),($2,'b@t.invalid'),($3,'c@t.invalid'),($4,'d@t.invalid')", [boss, v1, v2, vp]);
  A = (await row("select bootstrap_company('Vendas',null,$1) id", [boss])).id;
  for (const [id, name, roles] of [[v1, "Vendedor 1", ["vendedor"]], [v2, "Vendedor 2", ["vendedor"]], [vp, "Vendedor e Produção", ["vendedor", "producao"]]] as const) {
    await db.query("insert into profiles(id,company_id,full_name) values($1,$2,$3)", [id, A, name]);
    for (const r of roles) await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,$3)", [A, id, r]);
  }
  const client = (await row("insert into clients(company_id,name,phone) values($1,'Cliente','47999990000') returning id", [A])).id;
  const type = (await row("select id from sale_types where company_id=$1 limit 1", [A])).id;
  for (const seller of [v1, v2]) {
    const s = (await row("insert into sales(company_id,sale_number,client_id,sale_type_id,seller_id,total) values($1,$2,$3,$4,$5,100) returning id", [A, `VEN-${seller.slice(-2)}`, client, type, seller])).id;
    await db.query("insert into sale_items(company_id,sale_id,product,unit,quantity,unit_price) values($1,$2,'Item','un',1,100)", [A, s]);
    await db.query("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,$2,$3,$4,$5)", [A, `PED-${seller.slice(-2)}`, s, client, type]);
  }
  await db.exec("grant usage on schema auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated");
});
afterAll(async () => { await db?.close(); });

test("vendedor vê só as próprias vendas, itens e pedidos", async () => {
  for (const t of ["sales", "sale_items", "orders"]) expect(await count(v1, t)).toBe(1);
  const mine = await as(v1, async () => (await row("select seller_id from sales")).seller_id);
  expect(mine).toBe(v1);
});

test("vendedor não altera venda de outro vendedor", async () => {
  await as(v1, async () => {
    const r = await db.query("update sales set notes='x' where seller_id=$1", [v2]);
    expect(r.affectedRows ?? 0).toBe(0);
  });
});

test("gerente e vendedor que também é da produção veem todas", async () => {
  expect(await count(boss, "sales")).toBe(2);
  expect(await count(vp, "sales")).toBe(2);
  expect(await count(vp, "orders")).toBe(2);
});
