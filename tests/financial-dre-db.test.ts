import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, calhas: string, esquadrias: string;
const user = "00000000-0000-4000-8000-000000000081";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const lines = async (type: string | null = null) => (await db.query<{ month: string; grp: string; category: string; amount: string }>(
  "select to_char(month,'YYYY-MM') as month,grp,category,amount from financial_dre_lines('2026-01-01','2026-12-31',$1) order by month,grp,category", [type])).rows
  .map((r) => `${r.month} ${r.grp} ${r.category} ${Number(r.amount)}`);

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'dre@test.invalid')", [user]);
  company = (await row("select bootstrap_company('DRE',null,$1) id", [user])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  const types = (await db.query<{ id: string; name: string }>("select id,name from sale_types where company_id=$1", [company])).rows;
  calhas = types.find((t) => /calha/i.test(t.name))!.id; esquadrias = types.find((t) => /esquadria/i.test(t.name))!.id;
  const cat = async (name: string, type: string, grp: string) => (await row("insert into financial_categories(company_id,name,entry_type,dre_group) values($1,$2,$3,$4) returning id", [company, name, type, grp])).id;
  const venda = await cat("Venda", "receber", "receita"), bobina = await cat("Bobina", "pagar", "custo"), banco = await cat("Tarifa", "pagar", "financeiro");
  const client = (await row("insert into clients(company_id,name,phone) values($1,'Cliente DRE','47999990081') returning id", [company])).id;
  const sale = async (n: string, type: string) => (await row("insert into sales(company_id,sale_number,client_id,sale_type_id,total) values($1,$2,$3,$4,1000) returning id", [company, n, client, type])).id;
  const sCalha = await sale("V-C", calhas), sEsq = await sale("V-E", esquadrias);
  const oCalha = (await row("insert into orders(company_id,order_number,sale_id,client_id,sale_type_id) values($1,'P-C',$2,$3,$4) returning id", [company, sCalha, client, calhas])).id;
  const entry = async (type: string, total: number, comp: string, extra: Record<string, unknown> = {}) => (await row(
    "insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date,competence_date,category_id,sale_id,interest_amount,discount_amount,status) values($1,$2,'manual','x',$3,'2026-12-31',$4,$5,$6,$7,$8,$9) returning id",
    [company, type, total, comp, extra.category ?? null, extra.sale ?? null, extra.interest ?? 0, extra.discount ?? 0, extra.status ?? "aguardando_pagamento"])).id;
  await entry("receber", 1010, "2026-01-15", { category: venda, sale: sCalha, interest: 12, discount: 2 });
  await entry("receber", 500, "2026-02-10", { category: venda, sale: sEsq });
  const shared = await entry("pagar", 300, "2026-01-20", { category: bobina });
  await row("select set_financial_entry_allocations($1,$2::jsonb) n", [shared, JSON.stringify([{ order_id: oCalha, amount: 100 }, { cost_center_id: (await row("insert into financial_cost_centers(company_id,name) values($1,'Adm') returning id", [company])).id, amount: 200 }])]);
  await entry("pagar", 40, "2026-01-25", { category: banco });
  await entry("pagar", 70, "2026-02-05");
  await entry("pagar", 999, "2026-01-05", { category: bobina, status: "cancelado" });
});
afterAll(async () => { await db?.close(); });

test("competencia, juros/descontos separados e cancelados fora", async () => {
  expect(await lines()).toEqual([
    "2026-01 custo Bobina 300",
    "2026-01 deducao Descontos concedidos 2",
    "2026-01 financeiro Juros recebidos 12",
    "2026-01 financeiro Tarifa -40",
    "2026-01 receita Venda 1000",
    "2026-02 outras Despesas sem categoria 70",
    "2026-02 receita Venda 500",
  ]);
});

test("por tipo de venda entra so a parte rateada para obras daquele tipo", async () => {
  expect(await lines(calhas)).toEqual([
    "2026-01 custo Bobina 100",
    "2026-01 deducao Descontos concedidos 2",
    "2026-01 financeiro Juros recebidos 12",
    "2026-01 receita Venda 1000",
  ]);
  expect(await lines(esquadrias)).toEqual(["2026-02 receita Venda 500"]);
});
