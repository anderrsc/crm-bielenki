import { afterAll, beforeAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string;
const user = "00000000-0000-4000-8000-0000000008d1";
const row = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, any>>(sql, args)).rows[0];

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'vigia@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Vigia',null,$1) id", [user])).id;
});
afterAll(async () => { await db?.close(); });

test("ponto de partida do vigia vem da última mensagem gravada do número", async () => {
  const ch = (await row("insert into whatsapp_channels(company_id,name,provider,instance,owner_id,created_by) values($1,'Calha','evolution','calha',$2,$2) returning id", [company, user])).id;
  const conv = (await row("insert into conversations(company_id,channel,channel_id,phone) values($1,'whatsapp',$2,'5547999990555') returning id", [company, ch])).id;
  await db.query("insert into messages(company_id,conversation_id,direction,body,sent_at) values($1,$2,'inbound','oi','2026-11-19T18:40:00Z'),($1,$2,'outbound','ola','2026-11-19T18:30:00Z')", [company, conv]);
  const { readFileSync, readdirSync } = await import("node:fs");
  await db.exec(readFileSync(`supabase/migrations/${readdirSync("supabase/migrations").find((f) => f.endsWith("_whatsapp_vigia.sql"))!}`, "utf8"));
  expect((await row("select (last_message_event_at = $2::timestamptz) ok from whatsapp_channels where id=$1", [ch, "2026-11-19T18:40:00Z"])).ok).toBe(true);
});

test("colunas do vigia existem e o aviso chega à gerência uma vez por evento", async () => {
  const ch = (await row("insert into whatsapp_channels(company_id,name,provider,instance,owner_id,created_by) values($1,'Principal','evolution','crm',$2,$2) returning id,restart_count,last_message_event_at,last_restart_at", [company, user]));
  expect(ch).toMatchObject({ restart_count: 0, last_message_event_at: null, last_restart_at: null });
  for (let i = 0; i < 2; i++) await db.query("select notify_team_service($1,'wa-restart:x','WhatsApp reiniciado','corpo','/atendimento/canais')", [company]);
  expect((await row("select count(*)::int n from notifications where company_id=$1 and event_key='wa-restart:x'", [company])).n).toBe(1);
  expect((await row("select has_function_privilege('authenticated','public.notify_team_service(uuid,text,text,text,text)','execute') ok")).ok).toBe(false);
});
