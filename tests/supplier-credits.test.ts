import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Crédito com fornecedor: pagar a mais vira crédito, o crédito abate contas futuras sem
// sair dinheiro do caixa e estornos devolvem/retiram o crédito.
let db: PGlite, company: string, banco: string, supplier: string, other: string;
const user = "00000000-0000-4000-8000-0000000002c1";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const balance = async () => Number((await row("select coalesce(sum(amount),0) b from supplier_credits where supplier_id=$1", [supplier])).b);
const entry = async (type: string, total: number, sup: string | null = supplier) => (await row(
  "insert into financial_entries(company_id,entry_type,origin,description,total_amount,supplier_id,due_date) values($1,$2,'manual','Compra de chapa',$3,$4,'2026-11-10') returning id", [company, type, total, sup])).id;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'cred@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Credito',null,$1) id", [user])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  banco = (await row("insert into receiving_accounts(company_id,name,opening_balance,opening_date) values($1,'Banco',5000,'2026-11-01') returning id", [company])).id;
  supplier = (await row("insert into suppliers(company_id,name) values($1,'Vidraçaria') returning id", [company])).id;
  other = (await row("insert into suppliers(company_id,name) values($1,'Outro') returning id", [company])).id;
});
afterAll(async () => { await db?.close(); });

test("pagar a mais quita a conta e gera crédito que sai do caixa", async () => {
  const id = await entry("pagar", 1000);
  await row("select register_payment_with_supplier_credit($1,1250,'2026-11-05','pix',null,0,0,1,null,$2)", [id, banco]);
  const pid = (await row("select id from payments where financial_entry_id=$1", [id])).id;
  await row("select set_payment_account($1,$2)", [pid, banco]);
  const e = await row("select open_amount, paid_amount from financial_entries where id=$1", [id]);
  expect([Number(e.open_amount), Number(e.paid_amount)]).toEqual([0, 1000]);
  expect(await balance()).toBe(250);
  const s = (await row("select account_statement($1,'2026-11-01','2026-11-30') s", [banco])).s;
  expect(Number(s.saidas)).toBe(1250);
  expect(Number(s.saldo_final)).toBe(3750);
});

test("crédito abate outra conta sem mexer no caixa; estorno devolve o crédito", async () => {
  const id = await entry("pagar", 400);
  await expect(row("select use_supplier_credit($1,300,'2026-11-06')", [id])).rejects.toThrow(/Credito insuficiente/);
  const pid = (await row("select use_supplier_credit($1,250,'2026-11-06') id", [id])).id;
  expect(Number((await row("select open_amount from financial_entries where id=$1", [id])).open_amount)).toBe(150);
  expect(await balance()).toBe(0);
  const s = (await row("select account_statement($1,'2026-11-01','2026-11-30') s", [banco])).s;
  expect(Number(s.saldo_final)).toBe(3750);
  await row("select reverse_payment($1,'lançado errado')", [pid]);
  expect(await balance()).toBe(250);
  expect(Number((await row("select open_amount from financial_entries where id=$1", [id])).open_amount)).toBe(400);
});

test("conta a receber ou sem fornecedor não aceita valor a mais", async () => {
  const rec = await entry("receber", 100, null);
  await expect(row("select register_payment_with_supplier_credit($1,150,'2026-11-05','pix')", [rec])).rejects.toThrow(/so vira credito/);
  const semFornecedor = await entry("pagar", 100, null);
  await expect(row("select use_supplier_credit($1,10)", [semFornecedor])).rejects.toThrow(/fornecedor/);
  const doOutro = await entry("pagar", 100, other);
  await expect(row("select use_supplier_credit($1,10)", [doOutro])).rejects.toThrow(/Credito insuficiente/);
});

test("adiantamento exige conta, ajuste não deixa saldo negativo", async () => {
  await expect(row("select add_supplier_credit($1,100,'adiantamento','2026-11-07',null,'sinal')", [supplier])).rejects.toThrow(/conta/);
  await row("select add_supplier_credit($1,100,'adiantamento','2026-11-07',$2,'sinal')", [supplier, banco]);
  await row("select add_supplier_credit($1,50,'abatimento','2026-11-07',$2,'devolução de peça')", [supplier, banco]);
  expect(await balance()).toBe(400);
  const s = (await row("select account_statement($1,'2026-11-01','2026-11-30') s", [banco])).s;
  expect(Number(s.saldo_final)).toBe(3650); // só o adiantamento sai do caixa
  await expect(row("select add_supplier_credit($1,-500,'ajuste',null,null,'corrigir')", [supplier])).rejects.toThrow(/negativo/);
  await row("select add_supplier_credit($1,-400,'ajuste',null,null,'zerar')", [supplier]);
  expect(await balance()).toBe(0);
});

test("compra manual: pagou a mais vira crédito, pagou menos fica devendo com vencimento", async () => {
  const buy = async (payload: object) => (await row("select create_manual_purchase($1::jsonb) id", [JSON.stringify({ supplier_id: supplier, items: [{ category: "Perfil", description: "Perfil", quantity: 1, unit_price: 500 }], ...payload })])).id;
  const entryOf = async (po: string) => row("select open_amount, due_date::text due from financial_entries where purchase_order_id=$1", [po]);
  const before = await balance();
  const a = await buy({ paid_amount: 600, paid_at: "2026-11-08", payment_method: "Pix", receiving_account_id: banco });
  expect(Number((await entryOf(a)).open_amount)).toBe(0);
  expect(await balance()).toBe(before + 100);
  expect((await row("select receiving_account_id from payments p join financial_entries e on e.id=p.financial_entry_id where e.purchase_order_id=$1", [a])).receiving_account_id).toBe(banco);
  const b = await buy({ paid_amount: 200, due_date: "2026-12-10" });
  expect(await entryOf(b)).toMatchObject({ open_amount: "300.00", due: "2026-12-10" });
  const c = await buy({ paid_amount: 0, use_credit: 100 });
  expect(Number((await entryOf(c)).open_amount)).toBe(400);
  expect(await balance()).toBe(before);
});
