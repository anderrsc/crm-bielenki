import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Fase 2: vários números (calha, esquadrias). Cada número vê só as próprias conversas,
// com acesso por autorização; o número principal continua para toda a equipe.
let db: PGlite, company: string, principal: string, esquadrias: string;
const boss = "00000000-0000-4000-8000-0000000004c1", ana = "00000000-0000-4000-8000-0000000004c2", bia = "00000000-0000-4000-8000-0000000004c3";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function rows(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'b@test.invalid'),($2,'a@test.invalid'),($3,'c@test.invalid')", [boss, ana, bia]);
  company = (await row("select bootstrap_company('Canais',null,$1) id", [boss])).id;
  for (const [id, name] of [[ana, "Ana Esquadrias"], [bia, "Bia Calhas"]]) {
    await db.query("insert into profiles(id,company_id,full_name) values($1,$2,$3)", [id, company, name]);
    await db.query("insert into user_roles(company_id,profile_id,role) values($2,$1,'atendente')", [id, company]);
  }
  // Como no Supabase: tabelas liberadas ao papel; quem filtra é o RLS.
  await db.exec("grant usage on schema auth to authenticated; grant select, update on conversations, messages, profiles, user_roles to authenticated");
  principal = (await row("insert into whatsapp_channels(company_id,name,provider,instance,is_default,shared,owner_id) values($1,'Principal','evolution','crm',true,true,null) returning id", [company])).id;
  esquadrias = (await row("insert into whatsapp_channels(company_id,name,provider,instance,owner_id,shared) values($1,'Esquadrias','evolution','crm-esq-abc123',$2,false) returning id", [company, ana])).id;
});
afterAll(async () => { await db?.close(); });

test("conversa sem número cai no número principal", async () => {
  const c = await row("insert into conversations(company_id,channel,external_id,phone) values($1,'whatsapp','5547900000001','5547900000001') returning channel_id", [company]);
  expect(c.channel_id).toBe(principal);
});

test("o mesmo cliente pode ter uma conversa em cada número, sem misturar", async () => {
  await db.query("insert into conversations(company_id,channel,external_id,phone,channel_id) values($1,'whatsapp','5547900000002','5547900000002',$2)", [company, principal]);
  await db.query("insert into conversations(company_id,channel,external_id,phone,channel_id) values($1,'whatsapp','5547900000002','5547900000002',$2)", [company, esquadrias]);
  await expect(db.query("insert into conversations(company_id,channel,external_id,phone,channel_id) values($1,'whatsapp','5547900000002','5547900000002',$2)", [company, esquadrias])).rejects.toThrow(/duplicate|unique/);
  expect((await row("select count(*)::int n from conversations where external_id='5547900000002'")).n).toBe(2);
});

test("conversas do número da Ana: ela e a gerência veem; a Bia só com autorização", async () => {
  const visiveis = async (u: string) => (await as(u, () => rows("select channel_id from conversations where external_id='5547900000002'"))).map((r) => r.channel_id).sort();
  expect(await visiveis(ana)).toEqual([principal, esquadrias].sort());
  expect(await visiveis(boss)).toEqual([principal, esquadrias].sort());
  expect(await visiveis(bia)).toEqual([principal]);
  // Bia não pode se autorizar sozinha.
  await expect(as(bia, () => row("select set_whatsapp_channel_access($1,$2,true)", [esquadrias, bia]))).rejects.toThrow();
  await as(ana, () => row("select set_whatsapp_channel_access($1,$2,true)", [esquadrias, bia]));
  expect(await visiveis(bia)).toEqual([principal, esquadrias].sort());
  await as(boss, () => row("select set_whatsapp_channel_access($1,$2,false)", [esquadrias, bia]));
  expect(await visiveis(bia)).toEqual([principal]);
});

test("equipe nunca lê as credenciais do número", async () => {
  await expect(as(ana, () => rows("select api_key from whatsapp_channels"))).rejects.toThrow(/permission denied/);
  expect((await as(ana, () => rows("select id,name from whatsapp_channels"))).length).toBe(2);
});
