import { afterAll, beforeAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Auditoria do WhatsApp (23/11/2026), etapa C1:
// P1 — mensagem atrasada ou recuperada conta como não lida se ainda não foi vista;
// P4 — notas, mensagens e ações da conversa ficam só para quem atende aquele número.
let db: PGlite, company: string, principal: string, calha: string;
const boss = "00000000-0000-4000-8000-0000000005d1", rose = "00000000-0000-4000-8000-0000000005d2", bia = "00000000-0000-4000-8000-0000000005d3";
const row = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, any>>(sql, args)).rows[0];
const rows = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, any>>(sql, args)).rows;
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
let seq = 0;
async function conversa(channel = principal) {
  seq++;
  return (await row("insert into conversations(company_id,channel,external_id,phone,channel_id) values($1,'whatsapp',$2,$2,$3) returning id", [company, `55479000${String(seq).padStart(5, "0")}`, channel])).id as string;
}
async function chega(conv: string, at: string, historical: boolean) {
  await db.query("insert into messages(company_id,conversation_id,direction,author,body,sent_at) values($1,$2,'inbound','cliente','oi',$3)", [company, conv, at]);
  await db.query("select inbox_receive($1,$2,$3,'oi',gen_random_uuid(),$4)", [conv, company, at, historical]);
}
const naoLidas = async (conv: string) => (await row("select unread_count n from conversations where id=$1", [conv])).n as number;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'b@test.invalid'),($2,'r@test.invalid'),($3,'c@test.invalid')", [boss, rose, bia]);
  company = (await row("select bootstrap_company('Nao lidas',null,$1) id", [boss])).id;
  for (const [id, name] of [[rose, "Rose Calha"], [bia, "Bia Principal"]]) {
    await db.query("insert into profiles(id,company_id,full_name) values($1,$2,$3)", [id, company, name]);
    await db.query("insert into user_roles(company_id,profile_id,role) values($2,$1,'atendente')", [id, company]);
  }
  await db.exec("grant usage on schema auth to authenticated; grant select, insert, update, delete on conversations, messages, conversation_events, whatsapp_connection_history, profiles, user_roles to authenticated");
  principal = (await row("insert into whatsapp_channels(company_id,name,provider,instance,is_default,shared,owner_id) values($1,'Principal','evolution','crm',true,false,$2) returning id", [company, boss])).id;
  calha = (await row("insert into whatsapp_channels(company_id,name,provider,instance,owner_id,shared) values($1,'Calha','evolution','crm-calha',$2,false) returning id", [company, rose])).id;
  await db.query("insert into whatsapp_channel_members(company_id,channel_id,profile_id) values($1,$2,$3)", [company, principal, bia]);
});
afterAll(async () => { await db?.close(); });

test("P1: mensagem ao vivo conta; atrasada (ex.: depois de reiniciar a conexão) também conta", async () => {
  const c = await conversa();
  await chega(c, ago(0), false);
  await chega(c, ago(25), true);
  expect(await naoLidas(c)).toBe(2);
});

test("P1: atrasada já lida no CRM/celular, respondida pela equipe ou antiga (mais de 2 dias) não volta a contar", async () => {
  const lida = await conversa();
  await db.query("update conversations set read_through_at=$2 where id=$1", [lida, ago(10)]);
  await chega(lida, ago(30), true);
  expect(await naoLidas(lida)).toBe(0);

  const respondida = await conversa();
  await db.query("insert into messages(company_id,conversation_id,direction,author,body,sent_at) values($1,$2,'outbound','equipe','já vi',$3)", [company, respondida, ago(5)]);
  await chega(respondida, ago(30), true);
  expect(await naoLidas(respondida)).toBe(0);

  const antiga = await conversa();
  await chega(antiga, ago(3 * 24 * 60), true);
  expect(await naoLidas(antiga)).toBe(0);
});

test("P1: reconciliação soma só as recuperadas ainda não vistas", async () => {
  const c = await conversa();
  await db.query("update conversations set read_through_at=$2 where id=$1", [c, ago(20)]);
  const somou = await row("select inbox_count_recovered($1,$2,$3::timestamptz[]) n", [c, company, [ago(40), ago(15), ago(2)]]);
  expect(somou.n).toBe(2);
  expect(await naoLidas(c)).toBe(2);
  // Empresa errada não mexe em nada.
  expect((await row("select inbox_count_recovered($1,gen_random_uuid(),$2::timestamptz[]) n", [c, [ago(1)]])).n).toBe(0);
});

test("P4: nota interna do número principal não aparece para quem atende só a calha", async () => {
  const c = await conversa(principal);
  await as(bia, () => row("select conversation_add_note($1,'cliente pediu desconto')", [c]));
  expect((await as(bia, () => rows("select body from conversation_events where conversation_id=$1", [c]))).map((r) => r.body)).toEqual(["cliente pediu desconto"]);
  expect(await as(rose, () => rows("select body from conversation_events where conversation_id=$1", [c]))).toEqual([]);
  expect((await as(boss, () => rows("select body from conversation_events where conversation_id=$1", [c]))).length).toBe(1);
});

test("P4: sem acesso ao número, não grava/altera mensagem nem anota, transfere ou muda status", async () => {
  const c = await conversa(principal);
  const m = (await row("insert into messages(company_id,conversation_id,direction,author,body,sent_at) values($1,$2,'inbound','cliente','oi',now()) returning id", [company, c])).id;
  await expect(as(rose, () => db.query("insert into messages(company_id,conversation_id,direction,author,body) values($1,$2,'outbound','equipe','intrusa')", [company, c]))).rejects.toThrow(/row-level security/);
  await as(rose, () => db.query("update messages set body='trocada' where id=$1", [m]));
  expect((await row("select body from messages where id=$1", [m])).body).toBe("oi");
  await expect(as(rose, () => row("select conversation_add_note($1,'x')", [c]))).rejects.toThrow(/Conversa não encontrada/);
  await expect(as(rose, () => row("select conversation_transfer($1,$2,null,null)", [c, rose]))).rejects.toThrow(/Conversa não encontrada/);
  // Quem atende o número continua podendo tudo.
  await as(bia, () => db.query("insert into messages(company_id,conversation_id,direction,author,body) values($1,$2,'outbound','equipe','resposta')", [company, c]));
  await as(bia, () => row("select conversation_transfer($1,$2,'comercial',null)", [c, bia]));
});

test("P4: histórico de conexão só é gravado pelo servidor", async () => {
  await expect(as(bia, () => db.query("insert into whatsapp_connection_history(company_id,channel_id,provider,event_type) values($1,$2,'evolution','open')", [company, principal]))).rejects.toThrow(/row-level security/);
  await db.query("select record_whatsapp_connection_event($1,$2,'evolution','open','open')", [company, principal]);
  expect((await as(bia, () => rows("select event_type from whatsapp_connection_history where channel_id=$1", [principal]))).length).toBeGreaterThan(0);
});
