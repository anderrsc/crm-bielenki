import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";
import { changedFields, formatValue } from "@/components/audit-log-page";

// Histórico completo (26/11/2026): toda criação, alteração e remoção fica registrada com quem fez,
// quando e o que mudou; segredos não vão para o histórico e nada vaza entre empresas.
let db: PGlite, company: string;
const boss = "00000000-0000-4000-8000-000000000191", outsider = "00000000-0000-4000-8000-000000000192";
async function rows(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'boss@test.invalid'),($2,'out@test.invalid')", [boss, outsider]);
  company = (await rows("select bootstrap_company('Histórico',null,$1) id", [boss]))[0].id;
  await rows("select bootstrap_company('Outra',null,$1) id", [outsider]);
  await db.exec("grant usage on schema auth to authenticated");
  await db.exec("grant select, insert, update, delete on public.clients, public.audit_logs to authenticated");
});
afterAll(async () => { await db?.close(); });

test("criar, alterar e remover cliente ficam no histórico com o usuário; só mudança de updated_at não registra", async () => {
  const id = (await as(boss, () => rows("insert into clients(company_id,name,phone) values($1,'Rute Clara','47992518396') returning id", [company])))[0].id;
  await as(boss, () => rows("update clients set city='Jaraguá do Sul', updated_at=now() where id=$1", [id]));
  await as(boss, () => rows("update clients set updated_at=now() + interval '1 minute' where id=$1", [id]));
  await as(boss, () => rows("delete from clients where id=$1", [id]));
  const log = await rows("select action, profile_id, summary, old_data, new_data from audit_logs where table_name='clients' and record_id=$1 order by id", [id]);
  expect(log.map((l) => l.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
  expect(log.every((l) => l.profile_id === boss)).toBe(true);
  expect(log[0].summary).toBe("Rute Clara");
  expect(log[1].old_data).toMatchObject({ city: null });
  expect(log[1].old_data).not.toHaveProperty("updated_at");
  expect(log[1].new_data).toMatchObject({ city: "Jaraguá do Sul" });
  expect(log[2].old_data.name).toBe("Rute Clara");
});

test("outra empresa não vê o histórico desta", async () => {
  const seen = await as(outsider, () => rows("select count(*)::int n from audit_logs where company_id=$1", [company]));
  expect(seen[0].n).toBe(0);
});

test("tela: mostra campo, antes e depois em português", () => {
  expect(changedFields({ action: "UPDATE", old_data: { phone: "(47) 9", updated_at: "x" }, new_data: { phone: "(47) 8", updated_at: "y" } }))
    .toEqual([{ field: "Telefone", before: "(47) 9", after: "(47) 8" }]);
  expect(formatValue(null)).toBe("vazio");
  expect(formatValue(true)).toBe("Sim");
  expect(formatValue("2026-11-26")).toBe("26/11/2026");
  expect(formatValue("00000000-0000-4000-8000-000000000191")).toBe("(vínculo alterado)");
});
