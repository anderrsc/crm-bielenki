import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";
import { orderResultStatus } from "@/lib/order-result";

let db: PGlite, company: string, order: string, sale: string;
const user = "00000000-0000-4000-8000-0000000000b1";
const denied = "00000000-0000-4000-8000-0000000000b2";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const result = () => row("select revenue,expected_cost,cost_committed,cost_realized,cost_paid,margin_expected,margin_current from v_order_result where order_id=$1", [order]);

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'obra@test.invalid'),($2,'obra-denied@test.invalid')", [user, denied]);
  company = (await row("select bootstrap_company('Obras',null,$1) id", [user])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Denied')", [denied, company]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  const client = (await row("insert into clients(company_id,name,phone) values($1,'Cliente Obra','47999990111') returning id", [company])).id;
  const type = (await row("select id from sale_types where company_id=$1 limit 1", [company])).id;
  sale = (await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,'VEN-O1',$2,$3,1000) returning id", [company, client, type])).id;
  order = (await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'PED-O1',$2,$3,$4) returning id", [company, sale, client, type])).id;
  const supplier = (await row("insert into suppliers(company_id,name) values($1,'Fornecedor Obra') returning id", [company])).id;
  // Cada compra ja gera sua conta a pagar (gatilho do sistema).
  const po = (n: string, total: number, status: string) => db.query("insert into purchase_orders(company_id,order_number,order_id,supplier_id,status,total) values($1,$2,$3,$4,$5,$6)", [company, n, order, supplier, status, total]);
  await po("OC-1", 120, "pedido_enviado_ao_fornecedor"); // ainda nao chegou: comprometido
  await po("OC-2", 200, "recebido_completo");            // chegou: realizado
  await po("OC-3", 999, "cancelado");
  await db.query("update financial_entries set status='cancelado' where description='Compra OC-3'");
  const entry = async (total: number, extra: Record<string, unknown> = {}) => (await row(
    "insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date,sale_id,status) values($1,'pagar','manual','x',$2,current_date,$3,$4) returning id",
    [company, total, extra.sale ?? null, extra.status ?? "aguardando_pagamento"])).id;
  await entry(50, { sale });                    // ligada a venda
  await entry(77, { sale, status: "cancelado" }); // cancelada: fora
  const shared = await entry(300);
  const center = (await row("insert into financial_cost_centers(company_id,name) values($1,'Adm obra') returning id", [company])).id;
  await row("select set_financial_entry_allocations($1,$2::jsonb) n", [shared, JSON.stringify([{ order_id: order, amount: 100 }, { cost_center_id: center, amount: 200 }])]);
});
afterAll(async () => { await db?.close(); });

test("previsto, comprometido e realizado sem contar nada duas vezes", async () => {
  const before = await result();
  expect(before.expected_cost).toBeNull();
  expect(before.margin_expected).toBeNull();
  expect(Number(before.cost_committed)).toBe(120);
  expect(Number(before.cost_realized)).toBe(350);
  expect(Number(before.margin_current)).toBe(530);
  await row("select set_order_expected_cost($1,400)", [order]);
  const after = await result();
  expect(Number(after.expected_cost)).toBe(400);
  expect(Number(after.margin_expected)).toBe(600);
  expect(orderResultStatus(after as never)).toMatchObject({ over: true, noForecast: false, usedPct: 118, marginPct: 53 });
  expect((await row("select count(*)::int n from audit_logs where table_name='orders' and record_id=$1 and profile_id=$2", [order, user])).n).toBe(1);
  await row("select set_order_expected_cost($1,null)", [order]);
  expect(orderResultStatus((await result()) as never)).toMatchObject({ over: false, noForecast: true, usedPct: null });
});

test("so quem tem permissao financeira altera o custo previsto", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [denied]);
  try { await expect(row("select set_order_expected_cost($1,10)", [order])).rejects.toThrow(/permissao/); }
  finally { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); }
  await expect(row("select set_order_expected_cost($1,-1)", [order])).rejects.toThrow(/invalido/);
});
