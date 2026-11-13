import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, account: string;
const user = "00000000-0000-4000-8000-000000000091";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'cash@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Cash',null,$1) id", [user])).id;
  const other = (await row("insert into companies(name) values('Other cash') returning id")).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  account = (await row("insert into receiving_accounts(company_id,name,opening_balance,opening_date) values($1,'Banco',1000,current_date-10) returning id", [company])).id;
  await db.query("insert into receiving_accounts(company_id,name,opening_balance) values($1,'Alheia',99999)", [other]);
  const entry = async (type: string, total: number, due: string) => (await row(
    `insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date) values($1,$2,'manual','x',$3,current_date+(${due})) returning id`, [company, type, total])).id;
  const pay = (id: string, amount: number, when: string, acc: string | null, reversed = false) => db.query(
    `insert into payments(company_id,financial_entry_id,amount,paid_at,receiving_account_id,reversed_at) values($1,$2,$3,current_date+(${when}),$4,$5)`, [company, id, amount, acc, reversed ? new Date().toISOString() : null]);
  const r1 = await entry("receber", 5000, "5");
  await pay(r1, 300, "-20", account);   // antes da data inicial: fora
  await pay(r1, 400, "-2", account);
  await pay(r1, 50, "-1", account, true); // estornada: fora
  await pay(r1, 70, "-1", null);         // sem conta
  const p1 = await entry("pagar", 900, "3");
  await pay(p1, 150, "-1", account);
  await entry("receber", 250, "-4");     // vencida
  await entry("pagar", 80, "400");       // fora do horizonte
});
afterAll(async () => { await db?.close(); });

test("saldo por conta respeita data inicial, estornos e empresa; projecao traz so o que esta em aberto", async () => {
  const o = (await row("select cash_overview(30) o")).o;
  expect(o.accounts).toHaveLength(1);
  expect(o.accounts[0]).toMatchObject({ name: "Banco", opening_balance: 1000, inflow: 400, outflow: 150, balance: 1250 });
  expect(o.unassigned).toMatchObject({ inflow: 70, outflow: 0 });
  expect(Number(o.overdue_receivable)).toBe(250);
  expect(Number(o.overdue_payable)).toBe(0);
  const flows = o.flows as { receivable: number; payable: number }[];
  expect(flows).toHaveLength(2);
  expect(flows.reduce((s, f) => s + Number(f.payable), 0)).toBe(900 - Number((await row("select paid_amount from financial_entries where entry_type='pagar' and total_amount=900")).paid_amount));
  expect(flows.reduce((s, f) => s + Number(f.receivable), 0)).toBe(5000 - Number((await row("select paid_amount from financial_entries where total_amount=5000")).paid_amount));
});
