import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, other: string;
const user = "00000000-0000-4000-8000-000000000051";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const totals = async (status: string | null = null) => (await row("select financial_control_totals(p_status=>$1) t", [status])).t;
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'finance@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Finance',null,$1) id", [user])).id;
  other = (await row("insert into companies(name) values('Other') returning id")).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("grant usage on schema auth to authenticated; grant select on profiles,financial_entries,financial_installments,clients,suppliers,sales to authenticated");
});
afterAll(async () => { await db?.close(); });

test("totals include every row, separate paid from cancelled and honor filters", async () => {
  await db.exec("begin");
  try {
    await db.query(`insert into financial_entries(company_id,entry_type,origin,description,total_amount,due_date)
      select $1,'receber','manual','Receita',10.11,current_date+7 from generate_series(1,75)`, [company]);
    await db.query(`insert into financial_entries(company_id,entry_type,origin,description,total_amount,paid_amount,status,due_date) values
      ($1,'receber','manual','Cancelado',999,0,'cancelado',current_date),
      ($1,'receber','manual','Pago',20,20,'pago',current_date),
      ($2,'receber','manual','Outra empresa',9999,0,'aguardando_pagamento',current_date)`, [company, other]);
    await db.exec("set local role authenticated");
    const t = await totals();
    expect(t.pending_total).toBe(758.25);
    expect(t.pending_count).toBe(75);
    expect(t.done_count).toBe(1);
    expect(t.projection[0].receivable).toBe(758.25);
    expect((await totals("pago")).pending_count).toBe(0);
    expect((await totals("pago")).done_count).toBe(1);
    expect((await row("select financial_control_totals(p_q=>'inexistente') t")).t.pending_total).toBe(0);
  } finally { await db.exec("rollback"); }
});

test("projection uses remaining amounts, includes boundary dates and excludes overdue/undated/cancelled", async () => {
  await db.exec("begin");
  try {
    await db.query(`insert into financial_entries(company_id,entry_type,origin,description,total_amount,paid_amount,due_date,status) values
      ($1,'receber','manual','Hoje',100,30,current_date,'parcialmente_pago'),
      ($1,'receber','manual','15 dias',40,0,current_date+15,'aguardando_pagamento'),
      ($1,'pagar','manual','7 dias',25,0,current_date+7,'aguardando_pagamento'),
      ($1,'pagar','manual','90 dias',15,0,current_date+90,'aguardando_pagamento'),
      ($1,'pagar','manual','91 dias',80,0,current_date+91,'aguardando_pagamento'),
      ($1,'receber','manual','Vencido',55,0,current_date-1,'aguardando_pagamento'),
      ($1,'receber','manual','Sem data',60,0,null,'aguardando_pagamento'),
      ($1,'receber','manual','Cancelado',999,0,current_date,'cancelado')`, [company]);
    await db.exec("set local role authenticated");
    const t = await totals();
    expect(t.projection).toEqual([
      { days: 7, receivable: 70, payable: 25 }, { days: 15, receivable: 110, payable: 25 },
      { days: 30, receivable: 110, payable: 25 }, { days: 60, receivable: 110, payable: 25 },
      { days: 90, receivable: 110, payable: 40 },
    ]);
    expect(t.undated_count).toBe(1);
    expect(t.overdue_total).toBe(55);
    expect(t.receivable_total).toBe(225);
    expect(t.payable_total).toBe(120);
    expect((await row("select financial_control_totals(p_type=>'pagar', p_from=>current_date+7, p_to=>current_date+7) t")).t.payable_total).toBe(25);
  } finally { await db.exec("rollback"); }
});

test("anonymous callers cannot execute the management RPC", async () => {
  await db.exec("begin; set local role anon");
  try { await expect(totals()).rejects.toThrow(/permission denied/); }
  finally { await db.exec("rollback"); }
});

test("installments use their own dates and payments are allocated once, including after reversal", async () => {
  await db.exec("begin");
  try {
    const entry = (await row(`insert into financial_entries(company_id,entry_type,origin,description,total_amount,paid_amount,due_date,status)
      values($1,'receber','manual','Parcelado',300,120,current_date,'parcialmente_pago') returning id`, [company])).id;
    await db.query(`insert into financial_installments(company_id,financial_entry_id,installment_number,amount,paid_amount,due_date)
      values ($1,$2,1,100,0,current_date),($1,$2,2,100,0,current_date+30),($1,$2,3,100,0,current_date+60)`, [company, entry]);
    await db.exec("set local role authenticated");
    let t = await totals();
    expect(t.projection[0].receivable).toBe(0);
    expect(t.projection[2].receivable).toBe(80);
    expect(t.projection[3].receivable).toBe(180);
    await db.exec("reset role");
    await db.query("update financial_entries set paid_amount=20 where id=$1", [entry]);
    await db.exec("set local role authenticated");
    t = await totals();
    expect(t.projection[0].receivable).toBe(80);
    expect(t.projection[3].receivable).toBe(280);
  } finally { await db.exec("rollback"); }
});
