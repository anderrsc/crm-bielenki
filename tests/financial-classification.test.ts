import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, other: string;
const user = "00000000-0000-4000-8000-000000000061";
const deniedUser = "00000000-0000-4000-8000-000000000062";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'classify@test.invalid'),($2,'denied@test.invalid')", [user, deniedUser]);
  company = (await row("select bootstrap_company('Classifications',null,$1) id", [user])).id;
  other = (await row("insert into companies(name) values('Other') returning id")).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Denied')", [deniedUser, company]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("grant usage on schema auth to authenticated; grant select on profiles,financial_entries,audit_logs,clients,suppliers,sales to authenticated; grant insert,update on financial_entries to authenticated");
});
afterAll(async () => { await db?.close(); });

test("suggestions are idempotent and tenant-scoped; changes have an attributed audit trail", async () => {
  await db.exec("begin; set local role authenticated");
  try {
    await row("select seed_financial_classifications()");
    await row("select seed_financial_classifications()");
    expect((await row("select count(*)::int n from financial_categories")).n).toBe(27);
    expect((await row("select count(*)::int n from financial_cost_centers")).n).toBe(10);
    expect((await row("select count(*)::int n from financial_categories where company_id<>$1", [company])).n).toBe(0);
    expect((await row("select count(*)::int n from audit_logs where table_name='financial_categories' and profile_id=$1", [user])).n).toBe(27);
    const category = await row("select id from financial_categories where name='Combustível'");
    const center = await row("select id from financial_cost_centers where name='Veículos e transporte'");
    const entry = await row("insert into financial_entries(company_id,entry_type,origin,description,total_amount,paid_amount,status) values($1,'pagar','manual','Combustível da obra',100,20,'parcialmente_pago') returning id", [company]);
    await db.query("update financial_entries set category_id=$1,cost_center_id=$2 where id=$3", [category.id, center.id, entry.id]);
    expect(await row("select total_amount::text,paid_amount::text,status::text from financial_entries where id=$1", [entry.id])).toEqual({ total_amount: "100.00", paid_amount: "20.00", status: "parcialmente_pago" });
    const audit = await row("select profile_id,old_data,new_data from audit_logs where table_name='financial_entries' and record_id=$1 order by id desc limit 1", [entry.id]);
    expect(audit.profile_id).toBe(user);
    expect(audit.old_data).toEqual({ category_id: null, cost_center_id: null });
    expect(audit.new_data).toEqual({ category_id: category.id, cost_center_id: center.id });
    await db.query("update financial_categories set active=false,name='Combustível e lubrificantes' where id=$1", [category.id]);
    await db.query("update financial_cost_centers set active=false where id=$1", [center.id]);
    await db.query("update financial_entries set category_id=$1,cost_center_id=$2 where id=$3", [category.id, center.id, entry.id]);
    expect((await row("select category_name from v_financial_entries where id=$1", [entry.id])).category_name).toBe("Combustível e lubrificantes");
  } finally { await db.exec("rollback"); }
});

test("cross-tenant IDs, wrong category types and new assignments to inactive definitions are rejected", async () => {
  const foreign = await row("insert into financial_categories(company_id,name,entry_type) values($1,'Foreign','pagar') returning id", [other]);
  const category = await row("insert into financial_categories(company_id,name,entry_type,active) values($1,'Inactive','pagar',false) returning id", [company]);
  const revenue = await row("insert into financial_categories(company_id,name,entry_type) values($1,'Receita','receber') returning id", [company]);
  const center = await row("insert into financial_cost_centers(company_id,name,active) values($1,'Inactive',false) returning id", [company]);
  for (const id of [foreign.id, category.id, revenue.id]) {
    await db.exec("begin; set local role authenticated");
    try {
      await expect(row("insert into financial_entries(company_id,entry_type,origin,description,total_amount,category_id) values($1,'pagar','manual','Rejected',10,$2)", [company, id])).rejects.toThrow(/Categoria indisponivel/);
    } finally { await db.exec("rollback"); }
  }
  await db.exec("begin; set local role authenticated");
  try { await expect(row("insert into financial_entries(company_id,entry_type,origin,description,total_amount,cost_center_id) values($1,'pagar','manual','Rejected',10,$2)", [company, center.id])).rejects.toThrow(/Centro de custos indisponivel/); }
  finally { await db.exec("rollback"); }
});

test("linked category type cannot change; definitions cannot be deleted via the API", async () => {
  const c = await row("insert into financial_categories(company_id,name,entry_type) values($1,'Linked','pagar') returning id", [company]);
  await db.query("insert into financial_entries(company_id,entry_type,origin,description,total_amount,category_id) values($1,'pagar','manual','Linked',10,$2)", [company, c.id]);
  await db.exec("begin; set local role authenticated");
  try { await expect(row("update financial_categories set entry_type='receber' where id=$1", [c.id])).rejects.toThrow(/foreign key/); }
  finally { await db.exec("rollback"); }
  await db.exec("begin; set local role authenticated");
  try { await expect(row("delete from financial_categories where id=$1", [c.id])).rejects.toThrow(/permission denied/); }
  finally { await db.exec("rollback"); }
});

test("finance permission is required and anonymous callers have no grants", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [deniedUser]);
  await db.exec("begin; set local role authenticated");
  try {
    expect((await row("select count(*)::int n from financial_categories")).n).toBe(0);
    await expect(row("select seed_financial_classifications()")).rejects.toThrow();
  } finally { await db.exec("rollback"); }
  await db.exec("begin; set local role authenticated");
  try { await expect(row("insert into financial_cost_centers(company_id,name) values($1,'Denied')", [company])).rejects.toThrow(/row-level security/); }
  finally { await db.exec("rollback"); }
  await db.exec("begin; set local role anon");
  try { await expect(row("select * from financial_categories")).rejects.toThrow(/permission denied/); }
  finally { await db.exec("rollback"); }
  expect((await row("select has_function_privilege('authenticated','crm_private.audit_financial_classification()','execute') allowed")).allowed).toBe(false);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
});
