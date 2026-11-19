import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Compras: receber a nota inteira, desfazer várias entradas, nota duplicada, cancelamento
// que limpa estoque e financeiro, e venda com o mesmo número do orçamento.
let db: PGlite, company: string, supplier: string, loc: string;
const user = "00000000-0000-4000-8000-0000000005c1";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const buy = (items: Array<[string, number, number]>, extra: Record<string, unknown> = {}) => row("select create_manual_purchase($1::jsonb) id", [JSON.stringify({
  supplier_id: supplier, items: items.map(([description, quantity, unit_price]) => ({ description, category: "Perfil", unit: "un", quantity, unit_price })), ...extra })]).then((r) => r.id as string);
const stock = async (name: string) => Number((await row("select coalesce(sum(case when movement_type='entrada' then quantity else -quantity end),0) q from stock_movements sm join materials m on m.id=sm.material_id where m.name=$1", [name])).q);

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'compras@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Compras',null,$1) id", [user])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  supplier = (await row("insert into suppliers(company_id,name) values($1,'Petry') returning id", [company])).id;
  loc = (await row("select id from stock_locations where company_id=$1 limit 1", [company])).id;
});
afterAll(async () => { await db?.close(); });

test("receber a compra inteira cria uma entrada por item e repetir não duplica", async () => {
  const po = await buy([["Perfil L", 2, 100], ["Disco corte", 5, 20]]);
  const r = (await row("select receive_purchase_all($1,$2) r", [po, loc])).r;
  expect(r).toMatchObject({ received: 2 });
  expect(await stock("Perfil L")).toBe(2);
  expect(await stock("Disco corte")).toBe(5);
  expect((await row("select status from purchase_orders where id=$1", [po])).status).toBe("recebido_completo");
  await expect(row("select receive_purchase_all($1,$2)", [po, loc])).rejects.toThrow(/Nada pendente/);
  expect(await stock("Perfil L")).toBe(2);
});

test("receber só os itens escolhidos deixa o resto pendente", async () => {
  const po = await buy([["Rebite", 10, 1], ["Silicone", 3, 30]]);
  const one = (await row("select id from purchase_order_items where purchase_order_id=$1 and description='Rebite'", [po])).id;
  expect((await row("select receive_purchase_all($1,$2,array[$3]::uuid[]) r", [po, loc, one])).r).toMatchObject({ received: 1 });
  expect(await stock("Silicone")).toBe(0);
  expect((await row("select status from purchase_orders where id=$1", [po])).status).toBe("recebido_parcial");
});

test("desfazer várias entradas registra saída ligada a cada uma e repetir só pula", async () => {
  const po = await buy([["Tampa preta", 4, 5], ["Parafuso brocante", 8, 2]]);
  await row("select receive_purchase_all($1,$2)", [po, loc]);
  const ids = (await db.query<{ id: string }>("select sm.id from stock_movements sm join purchase_order_items i on i.id=sm.purchase_order_item_id where i.purchase_order_id=$1 and sm.movement_type='entrada'", [po])).rows.map((r) => r.id);
  expect((await row("select undo_stock_receipts($1::uuid[],'duplicado') r", [ids])).r).toMatchObject({ undone: 2, skipped: 0 });
  expect(await stock("Tampa preta")).toBe(0);
  expect((await row("select undo_stock_receipts($1::uuid[],'duplicado') r", [ids])).r).toMatchObject({ undone: 0, skipped: 2 });
  expect((await row("select count(*)::int n from audit_logs where action='UNDO_RECEIPT' and record_id = any($1::uuid[])", [ids])).n).toBe(2);
});

test("compra parecida (mesmo fornecedor e valor) é barrada, a menos que confirmem", async () => {
  await buy([["Chapa 2m", 1, 500]]);
  await expect(buy([["Chapa 2m", 1, 500]])).rejects.toThrow(/Compra parecida/);
  const outra = await buy([["Chapa 2m", 1, 500]], { allow_duplicate: true });
  expect(outra).toBeTruthy();
});

test("cancelar compra recebida tira do estoque e do financeiro e deixa só como Cancelada", async () => {
  const po = await buy([["Perfil U", 3, 70]]);
  await row("select receive_purchase_all($1,$2)", [po, loc]);
  expect(await stock("Perfil U")).toBe(3);
  await row("select cancel_purchase_order($1,'lançada errada')", [po]);
  expect(await stock("Perfil U")).toBe(0);
  expect((await row("select status from purchase_orders where id=$1", [po])).status).toBe("cancelado");
  expect((await row("select status from financial_entries where purchase_order_id=$1", [po])).status).toBe("cancelado");
  await expect(row("select cancel_purchase_order($1,'de novo')", [po])).rejects.toThrow(/já cancelada/);
  expect(Number((await row("select count(*) n from purchase_orders where id=$1", [po])).n)).toBe(1);
});

test("cancelar não apaga dívida paga nem material já usado", async () => {
  const pago = await buy([["Vidro 8mm", 1, 333]], { paid_amount: 333 });
  await expect(row("select cancel_purchase_order($1,'teste')", [pago])).rejects.toThrow(/pagamento/);
  const usado = await buy([["Cola PU", 2, 40]]);
  await row("select receive_purchase_all($1,$2)", [usado, loc]);
  const mat = (await row("select id from materials where name='Cola PU'")).id;
  await db.query("insert into stock_movements(company_id,material_id,location_id,movement_type,quantity) values($1,$2,$3,'saida',1)", [company, mat, loc]);
  await expect(row("select cancel_purchase_order($1,'teste')", [usado])).rejects.toThrow(/já foi usado/);
  expect((await row("select status from purchase_orders where id=$1", [usado])).status).not.toBe("cancelado");
  expect(await stock("Cola PU")).toBe(1);
});

test("venda criada pela aprovação mantém o número do orçamento", async () => {
  const client = (await row("insert into clients(company_id,name,phone) values($1,'Marcelo','47999990222') returning id", [company])).id;
  const type = (await row("select id from sale_types where company_id=$1 limit 1", [company])).id;
  const q = (await row("insert into quotes(company_id,quote_number,client_id,sale_type_id,subtotal) values($1,'ORC-2026-00128',$2,$3,1000) returning id", [company, client, type])).id;
  await db.query("insert into quote_items(company_id,quote_id,product,unit,quantity,unit_price) values($1,$2,'Esquadria','un',1,1000)", [company, q]);
  const sale = (await row("select approve_quote($1) id", [q])).id;
  expect((await row("select sale_number from sales where id=$1", [sale])).sale_number).toBe("ORC-2026-00128");
  expect((await row("select approve_quote($1) id", [q])).id).toBe(sale);
  expect((await row("select count(*)::int n from sales where sale_number='ORC-2026-00128'")).n).toBe(1);
});
