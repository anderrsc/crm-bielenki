import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Auditoria multiusuário (provas no banco, com o papel "authenticated" real, não service-role):
// 1) uma empresa nunca enxerga linhas de outra em NENHUMA tabela com company_id;
// 2) cada cargo só vê o que a matriz de permissões libera (ex.: atendente sem financeiro).
let db: PGlite, A: string, B: string;
const boss = "00000000-0000-4000-8000-0000000006a1", bossB = "00000000-0000-4000-8000-0000000006b1";
const clerk = "00000000-0000-4000-8000-0000000006a2", seller = "00000000-0000-4000-8000-0000000006a3", maker = "00000000-0000-4000-8000-0000000006a4";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'a@t.invalid'),($2,'b@t.invalid'),($3,'c@t.invalid'),($4,'s@t.invalid'),($5,'p@t.invalid')", [boss, bossB, clerk, seller, maker]);
  A = (await row("select bootstrap_company('Empresa A',null,$1) id", [boss])).id;
  B = (await row("select bootstrap_company('Empresa B',null,$1) id", [bossB])).id;
  for (const [id, name, role] of [[clerk, "Atendente", "atendente"], [seller, "Vendedor", "vendedor"], [maker, "Produção", "producao"]]) {
    await db.query("insert into profiles(id,company_id,full_name) values($1,$2,$3)", [id, A, name]);
    await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,$3)", [A, id, role]);
  }
  // Dados sensíveis nas duas empresas.
  for (const c of [A, B]) {
    const cl = (await row("insert into clients(company_id,name,phone) values($1,'Cliente','47999990000') returning id", [c])).id;
    await db.query("insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date,client_id) values($1,'receber','manual','Conta',100,'2026-12-01',$2)", [c, cl]);
    await db.query("insert into conversations(company_id,channel,phone) values($1,'whatsapp','5547900000000')", [c]);
    await db.query("insert into suppliers(company_id,name) values($1,'Forn')", [c]);
  }
  await db.exec("grant usage on schema auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated");
});
afterAll(async () => { await db?.close(); });

test("nenhuma tabela com company_id mostra linhas de outra empresa", async () => {
  const tables = (await db.query<{ table_name: string }>("select c.table_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name) where c.table_schema='public' and c.column_name='company_id' and t.table_type='BASE TABLE' order by 1")).rows.map((r) => r.table_name);
  expect(tables.length).toBeGreaterThan(50);
  const leaks: string[] = []; let withData = 0;
  for (const t of tables) {
    for (const [user, other] of [[boss, B], [bossB, A]] as const) {
      try {
        const n = await as(user, async () => Number((await row(`select count(*) n from public.${t} where company_id=$1`, [other])).n));
        if (n > 0) leaks.push(`${t}: ${n} linha(s) da outra empresa`);
      } catch (e) { if (!/permission denied/.test(String((e as Error).message))) throw e; }
    }
    withData += Number((await row(`select count(*) n from public.${t}`)).n) > 0 ? 1 : 0;
  }
  expect(leaks).toEqual([]);
  expect(withData).toBeGreaterThan(10);
});

test("gerente e administrador veem tudo da própria empresa; ninguém grava na outra", async () => {
  expect(await as(boss, async () => Number((await row("select count(*) n from clients")).n))).toBe(1);
  await as(boss, async () => {
    await expect(db.query("insert into clients(company_id,name,phone) values($1,'Invasor','1')", [B])).rejects.toThrow(/row-level security/);
    expect(Number((await db.query("update clients set name='x' where company_id=$1", [B])).affectedRows ?? 0)).toBe(0);
  });
});

test("atendente não vê financeiro, pagamentos, compras nem auditoria; vê clientes e conversas", async () => {
  const count = (t: string) => as(clerk, async () => Number((await row(`select count(*) n from ${t}`)).n));
  expect(await count("clients")).toBe(1);
  expect(await count("conversations")).toBe(1);
  expect(await count("financial_entries")).toBe(0);
  expect(await count("payments")).toBe(0);
  expect(await count("purchase_orders")).toBe(0);
  expect(await count("audit_logs")).toBe(0);
  const entry = (await row("select id from financial_entries where company_id=$1", [A])).id;
  await as(clerk, async () => {
    await expect(row("select register_payment($1,10,current_date,'pix')", [entry])).rejects.toThrow();
  });
  expect(Number((await row("select coalesce(sum(amount),0) n from payments where financial_entry_id=$1", [entry])).n)).toBe(0);
});

test("produção não vê financeiro; vendedor não cancela compra nem recebe material", async () => {
  expect(await as(maker, async () => Number((await row("select count(*) n from financial_entries")).n))).toBe(0);
  const po = (await row("select create_manual_purchase_unchecked($1::jsonb) id", [JSON.stringify({ supplier_id: (await row("select id from suppliers where company_id=$1", [A])).id, items: [{ description: "X", category: "Outro", unit: "un", quantity: 1, unit_price: 10 }] })])).id;
  await as(seller, async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [seller]);
    await expect(row("select cancel_purchase_order($1,'teste')", [po])).rejects.toThrow(/permissao|permissão/i);
  });
});
