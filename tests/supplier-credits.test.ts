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

test("compra manual ligada a um pedido grava o pedido e a previsão de entrega", async () => {
  const client = (await row("insert into clients(company_id,name) values($1,'Cliente Obra') returning id", [company])).id;
  const st = (await row("select id from sale_types where company_id=$1 limit 1", [company]))?.id ?? (await row("insert into sale_types(company_id,name) values($1,'Calhas') returning id", [company])).id;
  const sale = (await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'VEN-T-1',$2,$3,100) returning id", [company, client, st])).id;
  const order = (await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'PED-T-1',$2,$3,$4) returning id", [company, sale, client, st])).id;
  const po = (await row("select create_manual_purchase($1::jsonb) id", [JSON.stringify({ supplier_id: supplier, order_id: order, expected_at: "2026-11-30", items: [{ category: "Cano", description: "", quantity: 2, unit_price: 50 }] })])).id;
  expect(await row("select order_id, expected_at::text exp from purchase_orders where id=$1", [po])).toMatchObject({ order_id: order, exp: "2026-11-30" });
  expect(await row("select order_id, client_id, description from purchase_order_items where purchase_order_id=$1", [po])).toMatchObject({ order_id: order, client_id: client, description: "Cano" });
  await expect(row("select create_manual_purchase($1::jsonb)", [JSON.stringify({ supplier_id: supplier, order_id: "00000000-0000-4000-8000-000000000999", items: [{ category: "Cano", quantity: 1, unit_price: 1 }] })])).rejects.toThrow(/Pedido inválido/);
});

test("crédito lançado errado pode ser corrigido ou excluído; o da baixa não", async () => {
  const id = (await row("select add_supplier_credit($1,3000,'adiantamento','2026-11-17',$2,'cheque') id", [supplier, banco])).id;
  const start = await balance();
  await row("select update_supplier_credit($1,1190,'2026-11-16',$2,'cheque de R$ 1.190')", [id, banco]);
  expect(await balance()).toBe(start - 1810);
  expect(await row("select amount, moved_at::text d from supplier_credits where id=$1", [id])).toMatchObject({ amount: "1190.00", d: "2026-11-16" });
  expect(Number((await row("select count(*) n from audit_logs where record_id=$1 and action='UPDATE'", [id])).n)).toBe(1);
  const fromPayment = (await row("select id from supplier_credits where kind='excedente' limit 1")).id;
  await expect(row("select update_supplier_credit($1,1,null,null,'x y z')", [fromPayment])).rejects.toThrow(/estorne a baixa/);
  await row("select delete_supplier_credit($1,'lançado em duplicidade')", [id]);
  expect(await balance()).toBe(start - 3000);
});

test("conta avulsa pode ser corrigida e cancelada; conta de compra só descrição/vencimento", async () => {
  const id = (await row("insert into financial_entries(company_id,entry_type,origin,description,total_amount,supplier_id) values($1,'pagar','manual','Aluguel',1000,$2) returning id", [company, supplier])).id;
  await row("select update_financial_entry($1,'Aluguel novembro',1200,'2026-11-30','corrigido',$2)", [id, other]);
  expect(await row("select description, total_amount, due_date::text d, supplier_id from financial_entries where id=$1", [id])).toMatchObject({ description: "Aluguel novembro", total_amount: "1200.00", d: "2026-11-30", supplier_id: other });
  const pid = (await row("select register_payment($1,500,'2026-11-10','pix',null) id", [id])).id;
  await expect(row("select update_financial_entry($1,'Aluguel',400,null,null)", [id])).rejects.toThrow(/menor que o já pago/);
  await expect(row("select cancel_financial_entry($1,'duplicada')", [id])).rejects.toThrow(/Estorne/);
  await row("select reverse_payment($1,'errado')", [pid]);
  await row("select cancel_financial_entry($1,'duplicada')", [id]);
  expect((await row("select status from financial_entries where id=$1", [id])).status).toBe("cancelado");
  const po = (await row("select create_manual_purchase($1::jsonb) id", [JSON.stringify({ supplier_id: supplier, items: [{ category: "Cano", quantity: 1, unit_price: 80 }] })])).id;
  const fe = (await row("select id from financial_entries where purchase_order_id=$1", [po])).id;
  await expect(row("select update_financial_entry($1,'Compra',90,null,null)", [fe])).rejects.toThrow(/venda\/compra/);
  await row("select update_financial_entry($1,'Compra de cano',80,'2026-12-05',null)", [fe]);
  expect((await row("select description from financial_entries where id=$1", [fe])).description).toBe("Compra de cano");
});

test("relatório de fornecedores mostra vencido, crédito e saldo", async () => {
  const rep = (await row("select financial_report_data('fornecedores','2026-01-01','2026-12-31') r")).r as any[];
  const v = rep.find((x) => x.fornecedor === "Vidraçaria");
  expect(v).toBeTruthy();
  const credit = await balance();
  expect(Number(v.credito)).toBe(credit);
  expect(Number(v.saldo)).toBeCloseTo(Number(v.aberto) - credit, 2);
  expect(v).toHaveProperty("vencido");
});

test("compra lançada errado pode ser corrigida e cancelada; conta a pagar acompanha", async () => {
  const po = (await row("select create_manual_purchase($1::jsonb) id", [JSON.stringify({ supplier_id: supplier, paid_amount: 0, items: [{ category: "Perfil", description: "Perfil 25", quantity: 10, unit_price: 30 }] })])).id;
  const item = (await row("select id from purchase_order_items where purchase_order_id=$1", [po])).id;
  await row("select update_purchase_order($1,$2::jsonb)", [po, JSON.stringify({ supplier_id: other, expected_at: "2026-12-01", notes: "corrigido", order_id: "", items: [{ id: item, description: "Perfil 30", category: "Perfil", quantity: 12, unit_price: 25 }] })]);
  expect(await row("select total, supplier_id, expected_at::text d from purchase_orders where id=$1", [po])).toMatchObject({ total: "300.00", supplier_id: other, d: "2026-12-01" });
  expect(await row("select total_amount, supplier_id from financial_entries where purchase_order_id=$1", [po])).toMatchObject({ total_amount: "300.00", supplier_id: other });
  const fe = (await row("select id from financial_entries where purchase_order_id=$1", [po])).id;
  const pid = (await row("select register_payment($1,100,'2026-11-10','pix',null) id", [fe])).id;
  await expect(row("select update_purchase_order($1,$2::jsonb)", [po, JSON.stringify({ supplier_id: supplier, items: [] })])).rejects.toThrow(/trocar o fornecedor/);
  await expect(row("select cancel_purchase_order($1,'duplicada')", [po])).rejects.toThrow(/Estorne/);
  await row("select reverse_payment($1,'errado')", [pid]);
  await row("select cancel_purchase_order($1,'duplicada')", [po]);
  expect((await row("select status from financial_entries where id=$1", [fe])).status).toBe("cancelado");
});

test("venda manual pode ser corrigida e cancelada; venda de orçamento não", async () => {
  const client = (await row("insert into clients(company_id,name) values($1,'Cliente Venda') returning id", [company])).id;
  const st = (await row("select id from sale_types where company_id=$1 limit 1", [company])).id;
  const sale = (await row("select create_manual_sale($1::jsonb) id", [JSON.stringify({ client_id: client, sale_type_id: st, paid_amount: 0, items: [{ product: "Calha", description: "Calha 10m", quantity: 10, unit_price: 50 }] })])).id;
  const item = (await row("select id from sale_items where sale_id=$1", [sale])).id;
  await row("select update_manual_sale($1,$2::jsonb)", [sale, JSON.stringify({ client_id: "", due_date: "2026-12-10", notes: "ok", items: [{ id: item, description: "Calha 12m", quantity: 12, unit_price: 50 }] })]);
  expect(Number((await row("select total from sales where id=$1", [sale])).total)).toBe(600);
  expect(await row("select total_amount, due_date::text d from financial_entries where sale_id=$1", [sale])).toMatchObject({ total_amount: "600.00", d: "2026-12-10" });
  await row("select cancel_manual_sale($1,'lançada errada')", [sale]);
  expect((await row("select status from financial_entries where sale_id=$1", [sale])).status).toBe("cancelado");
});
