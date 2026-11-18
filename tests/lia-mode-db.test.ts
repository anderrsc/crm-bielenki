import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Modos da Lia: padrão mantém o comportamento atual, só gerência muda, a troca vai
// para a auditoria e o registro de decisões é só leitura para a equipe.
let db: PGlite, company: string, other: string;
const boss = "00000000-0000-4000-8000-000000000181", clerk = "00000000-0000-4000-8000-000000000182", outsider = "00000000-0000-4000-8000-000000000183";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'boss@test.invalid'),($2,'clerk@test.invalid'),($3,'out@test.invalid')", [boss, clerk, outsider]);
  company = (await row("select bootstrap_company('Lia modos',null,$1) id", [boss])).id;
  other = (await row("select bootstrap_company('Outra',null,$1) id", [outsider])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Atendente')", [clerk, company]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($2,$1,'atendente')", [clerk, company]);
  await db.exec("grant usage on schema auth to authenticated");
  // No Supabase o papel authenticated recebe esses privilégios por padrão; a RLS decide quem.
  await db.exec("grant select, update on public.ai_agent_config to authenticated");
  await db.query("insert into ai_agent_config(company_id) values($1) on conflict (company_id) do nothing", [company]);
});
afterAll(async () => { await db?.close(); });

test("padrão é automática sem horário e limite alto", async () => {
  expect(await row("select lia_mode,lia_hours,lia_daily_limit from ai_agent_config where company_id=$1", [company]))
    .toEqual({ lia_mode: "automatica", lia_hours: null, lia_daily_limit: 200 });
});

test("gerência muda o modo e a troca fica na auditoria; atendente não muda", async () => {
  const changed = await as(boss, async () => (await db.query("update ai_agent_config set lia_mode='assistente', lia_hours='{\"inicio\":\"08:00\",\"fim\":\"18:00\",\"dias\":[1,2,3,4,5]}' where company_id=$1 returning id", [company])).rows.length);
  expect(changed).toBe(1);
  const log = await row("select action,profile_id,old_data->>'modo' antes,new_data->>'modo' depois from audit_logs where table_name='ai_agent_config' order by id desc limit 1");
  expect(log).toMatchObject({ action: "lia_modo", profile_id: boss, antes: "automatica", depois: "assistente" });
  const byClerk = await as(clerk, async () => (await db.query("update ai_agent_config set lia_mode='automatica' where company_id=$1 returning id", [company])).rows.length);
  expect(byClerk).toBe(0);
  await expect(db.query("update ai_agent_config set lia_mode='turbo' where company_id=$1", [company])).rejects.toThrow(/lia_mode_check/);
});

test("decisões: equipe da empresa lê, ninguém grava pelo app, outra empresa não vê", async () => {
  await db.query("insert into ai_decisions(company_id,phone,decisao,motivo,modo) values($1,'5511999990000','sugeriu','Modo assistente','assistente')", [company]);
  expect(await as(clerk, async () => (await row("select count(*)::int n from ai_decisions")).n)).toBe(1);
  expect(await as(outsider, async () => (await row("select count(*)::int n from ai_decisions")).n)).toBe(0);
  await expect(as(boss, () => row("insert into ai_decisions(company_id,decisao,motivo) values($1,'respondeu','forjado')", [company]))).rejects.toThrow(/permission denied/);
  await expect(db.query("insert into ai_decisions(company_id,decisao,motivo) values($1,'qualquer','x')", [company])).rejects.toThrow(/check/);
  expect(other).toBeTruthy();
});
