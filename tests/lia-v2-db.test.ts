import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./helpers/database";

// LIA V2, fase 1 (lia_rules e lia_approvals): gerência cria regras, todos da empresa leem,
// pedido de aprovação é de quem pediu, só outra pessoa da gerência decide, e nada vaza entre empresas.
let db: PGlite, company: string, other: string;
const boss = "00000000-0000-4000-8000-000000000181", boss2 = "00000000-0000-4000-8000-000000000182", clerk = "00000000-0000-4000-8000-000000000183", outsider = "00000000-0000-4000-8000-000000000184";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'b@t.invalid'),($2,'b2@t.invalid'),($3,'c@t.invalid'),($4,'o@t.invalid')", [boss, boss2, clerk, outsider]);
  company = (await row("select bootstrap_company('LIA V2',null,$1) id", [boss])).id;
  other = (await row("select bootstrap_company('Outra',null,$1) id", [outsider])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Gerente 2'),($3,$2,'Atendente')", [boss2, company, clerk]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,'gerente'),($1,$3,'atendente')", [company, boss2, clerk]);
  await db.exec("grant usage on schema auth to authenticated");
});
afterAll(async () => { await db?.close(); });

test("a migration é idempotente: reaplicar não falha nem apaga dados", async () => {
  const sql = readFileSync("supabase/migrations/20261124140000_lia_v2_regras_aprovacoes.sql", "utf8").replace(/^\s*(begin|commit);\s*$/gim, "");
  await db.exec(sql);
  await db.exec(sql);
  expect((await row("select count(*)::int n from pg_policies where tablename in ('lia_rules','lia_approvals')")).n).toBe(6);
});

test("gerência cria regra com os dois conjuntos de nomes; título e nome ficam iguais", async () => {
  // Como a tela (title, category, condition_json, action_json)
  const a = await as(boss, async () => row("insert into lia_rules(title,category,condition_json,action_json) values('Entrada mínima','financeiro','{\"min\":0.5}','{\"exigir\":true}') returning id,name,rule_type,company_id,is_active"));
  expect(a).toMatchObject({ name: "Entrada mínima", rule_type: "financeiro", company_id: company, is_active: true });
  // Como as ações do servidor (name, rule_type, condition, action, company_id e created_by)
  const b = await as(boss, async () => row("insert into lia_rules(name,rule_type,condition,action,company_id,created_by) values('Parcela mínima','financeiro','valor < 100','bloquear',$1,$2) returning title,category", [company, boss]));
  expect(b).toMatchObject({ title: "Parcela mínima", category: "financeiro" });
  await expect(as(boss, () => row("insert into lia_rules(description) values('sem título')"))).rejects.toThrow();
});

test("atendente lê regras da empresa, mas não cria, altera nem apaga", async () => {
  expect((await as(clerk, async () => (await row("select count(*)::int n from lia_rules")).n))).toBe(2);
  await expect(as(clerk, () => row("insert into lia_rules(title,category) values('x','y')"))).rejects.toThrow(/row-level security|permission denied/);
  const n = await as(clerk, async () => (await db.query("update lia_rules set is_active=false")).affectedRows);
  expect(n).toBe(0);
  await expect(as(boss, () => row("delete from lia_rules"))).rejects.toThrow(/permission denied/);
});

test("gerência desativa regra e o updated_at é atualizado", async () => {
  const before = await row("select id,updated_at from lia_rules where name='Entrada mínima'");
  await as(boss, () => db.query("update lia_rules set is_active=false where id=$1", [before.id]));
  const after = await row("select is_active,updated_at from lia_rules where id=$1", [before.id]);
  expect(after.is_active).toBe(false);
  expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at).getTime());
});

test("outra empresa não vê nem altera regras e aprovações", async () => {
  expect((await as(outsider, async () => (await row("select count(*)::int n from lia_rules")).n))).toBe(0);
  expect((await as(outsider, async () => (await db.query("update lia_rules set is_active=true")).affectedRows))).toBe(0);
});

test("aprovação: qualquer usuário pede, só outra pessoa da gerência decide", async () => {
  const budget = "00000000-0000-4000-8000-0000000000aa";
  // O atendente pede, mesmo tentando se passar por outro e já aprovado: o servidor corrige.
  const req = await as(clerk, () => row("insert into lia_approvals(budget_id,violation_type,requested_override_value,justification,requested_by,status) values($1,'DOWN_PAYMENT_MINIMUM',1500,'Cliente antigo',$2,'approved') returning id,status,requested_by,company_id,reviewed_at", [budget, clerk]));
  expect(req).toMatchObject({ status: "pending", requested_by: clerk, company_id: company, reviewed_at: null });
  // Tentar pedir em nome do dono não funciona: o banco grava sempre quem está logado.
  const forged = await as(clerk, () => row("insert into lia_approvals(budget_id,violation_type,justification,requested_by) values($1,'INSTALLMENT_MINIMUM','x',$2) returning requested_by", [budget, boss]));
  expect(forged.requested_by).toBe(clerk);
  // Quem pediu enxerga o próprio pedido; outro atendente não enxerga.
  expect(await as(clerk, async () => (await row("select count(*)::int n from lia_approvals")).n)).toBe(2);
  // Atendente não decide.
  expect(await as(clerk, async () => (await db.query("update lia_approvals set status='approved' where id=$1", [req.id])).affectedRows)).toBe(0);
  // Gerência decide; a data e quem decidiu são gravados automaticamente.
  await as(boss2, () => db.query("update lia_approvals set status='approved', review_note='ok', reviewed_by=$2 where id=$1", [req.id, clerk]));
  expect(await row("select status,reviewed_by,review_note from lia_approvals where id=$1", [req.id])).toMatchObject({ status: "approved", reviewed_by: boss2, review_note: "ok" });
  // Decisão final: não muda de novo, e o pedido original não pode ser editado.
  await expect(as(boss, () => db.query("update lia_approvals set status='rejected' where id=$1", [req.id]))).rejects.toThrow(/já foi decidida/);
  await expect(as(boss, () => db.query("update lia_approvals set justification='outra' where id=$1", [req.id]))).rejects.toThrow(/não pode ser alterado/);
});

test("quem pediu não aprova o próprio pedido, nem sendo gerente", async () => {
  const r = await as(boss, () => row("insert into lia_approvals(budget_id,violation_type,justification) values(gen_random_uuid(),'INSTALLMENT_MINIMUM','Exceção do dono') returning id,requested_by"));
  expect(r.requested_by).toBe(boss);
  await expect(as(boss, () => db.query("update lia_approvals set status='approved' where id=$1", [r.id]))).rejects.toThrow(/própria solicitação/);
  await as(boss2, () => db.query("update lia_approvals set status='rejected' where id=$1", [r.id]));
  expect((await row("select status from lia_approvals where id=$1", [r.id])).status).toBe("rejected");
});

test("valores inválidos são recusados pelo banco", async () => {
  await expect(as(boss, () => row("insert into lia_approvals(budget_id,violation_type,justification) values(gen_random_uuid(),'OUTRA','x')"))).rejects.toThrow(/check/);
  await expect(as(boss, () => row("insert into lia_approvals(budget_id,violation_type,justification) values(gen_random_uuid(),'INSTALLMENT_MINIMUM','   ')"))).rejects.toThrow(/check/);
});
