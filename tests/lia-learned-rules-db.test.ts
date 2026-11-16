import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Regras ensinadas à Lia: só gerência grava, versão nova substitui a anterior ao confirmar,
// desfazer devolve a anterior, nada vaza entre empresas e tudo fica na auditoria.
let db: PGlite, company: string, other: string;
const boss = "00000000-0000-4000-8000-000000000171", clerk = "00000000-0000-4000-8000-000000000172", outsider = "00000000-0000-4000-8000-000000000173";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'boss@test.invalid'),($2,'clerk@test.invalid'),($3,'out@test.invalid')", [boss, clerk, outsider]);
  company = (await row("select bootstrap_company('Lia regras',null,$1) id", [boss])).id;
  other = (await row("select bootstrap_company('Outra',null,$1) id", [outsider])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Atendente')", [clerk, company]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($2,$1,'atendente')", [clerk, company]);
  await db.exec("grant usage on schema auth to authenticated");
});
afterAll(async () => { await db?.close(); });

test("gerência propõe, confirma, cria versão e desfaz; a anterior volta a valer", async () => {
  const v1 = await as(boss, async () => (await row("select lia_rule_propose('cliente pede orçamento de calhas','Peça endereço e fotos antes de qualquer coisa.','Lia, quando...') id")).id);
  expect((await row("select status,versao from ai_lia_rules where id=$1", [v1]))).toMatchObject({ status: "proposta", versao: 1 });
  await as(boss, () => row("select lia_rule_activate($1)", [v1]));
  const v2 = await as(boss, async () => (await row("select lia_rule_propose('cliente pede orçamento de calhas','Peça endereço, fotos e se tem medidas.',null,null,$1) id", [v1])).id);
  // A v1 continua valendo enquanto a v2 é só proposta.
  expect((await row("select status from ai_lia_rules where id=$1", [v1])).status).toBe("ativa");
  await as(boss, () => row("select lia_rule_activate($1)", [v2]));
  expect((await row("select status,versao,anterior_id from ai_lia_rules where id=$1", [v2]))).toMatchObject({ status: "ativa", versao: 2, anterior_id: v1 });
  expect((await row("select status from ai_lia_rules where id=$1", [v1])).status).toBe("arquivada");
  await as(boss, () => row("select lia_rule_archive($1)", [v2]));
  expect((await row("select status from ai_lia_rules where id=$1", [v2])).status).toBe("arquivada");
  expect((await row("select status from ai_lia_rules where id=$1", [v1])).status).toBe("ativa");
  expect((await row("select count(*)::int n from audit_logs where table_name='ai_lia_rules'")).n).toBeGreaterThanOrEqual(5);
});

test("atendente lê mas não grava; outra empresa não vê", async () => {
  await expect(as(clerk, () => row("select lia_rule_propose(null,'Responda sempre com emojis.')"))).rejects.toThrow(/gerência/);
  await expect(as(clerk, () => row("insert into ai_lia_rules(company_id,instrucao) values($1,'Direto na tabela')", [company]))).rejects.toThrow(/permission denied/);
  const visiveis = await as(clerk, async () => (await row("select count(*)::int n from ai_lia_rules")).n);
  expect(visiveis).toBeGreaterThan(0);
  const deFora = await as(outsider, async () => (await row("select count(*)::int n from ai_lia_rules")).n);
  expect(deFora).toBe(0);
  const id = (await row("select id from ai_lia_rules where company_id=$1 limit 1", [company])).id;
  await expect(as(outsider, () => row("select lia_rule_archive($1)", [id]))).rejects.toThrow(/não encontrada/);
  expect(other).toBeTruthy();
});

test("instrução inválida é recusada", async () => {
  await expect(as(boss, () => row("select lia_rule_propose(null,'oi')"))).rejects.toThrow(/5 a 1000/);
});
