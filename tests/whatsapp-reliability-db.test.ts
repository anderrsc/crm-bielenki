import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Fase 1: reserva atômica da resposta da Lia e chave de idempotência dos envios.
let db: PGlite, company: string, conv: string;
const user = "00000000-0000-4000-8000-0000000003c1";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'wa@test.invalid')", [user]);
  company = (await row("select bootstrap_company('WA',null,$1) id", [user])).id;
  await db.query("insert into ai_agent_config(company_id,active) values($1,true) on conflict (company_id) do update set active=true", [company]);
  conv = (await row("insert into conversations(company_id,channel,external_id,phone) values($1,'whatsapp','5547999990000','5547999990000') returning id", [company])).id;
});
afterAll(async () => { await db?.close(); });

test("só um processo reserva a resposta de cada mensagem; pausa/geração nova cancelam", async () => {
  const gen = "00000000-0000-4000-8000-00000000a001";
  await db.query("update conversations set ai_generation_id=$2, ai_paused=false where id=$1", [conv, gen]);
  expect((await row("select claim_ai_reply($1,$2,$3) ok", [conv, company, gen])).ok).toBe(true);
  expect((await row("select claim_ai_reply($1,$2,$3) ok", [conv, company, gen])).ok).toBe(false);
  await db.query("update conversations set ai_generation_id=$2, ai_paused=true where id=$1", [conv, gen]);
  expect((await row("select claim_ai_reply($1,$2,$3) ok", [conv, company, gen])).ok).toBe(false);
  await db.query("update conversations set ai_generation_id='00000000-0000-4000-8000-00000000a002', ai_paused=false where id=$1", [conv]);
  expect((await row("select claim_ai_reply($1,$2,$3) ok", [conv, company, gen])).ok).toBe(false);
  await db.query("update ai_agent_config set active=false where company_id=$1", [company]);
  expect((await row("select claim_ai_reply($1,$2,'00000000-0000-4000-8000-00000000a002') ok", [conv, company])).ok).toBe(false);
});

test("mesma chave de envio não grava duas mensagens", async () => {
  const ref = "00000000-0000-4000-8000-00000000b001";
  await db.query("insert into messages(company_id,conversation_id,direction,body,delivery_status,client_ref) values($1,$2,'outbound','oi','enviando',$3)", [company, conv, ref]);
  await expect(db.query("insert into messages(company_id,conversation_id,direction,body,delivery_status,client_ref) values($1,$2,'outbound','oi','enviando',$3)", [company, conv, ref])).rejects.toThrow(/duplicate|unique/);
});
