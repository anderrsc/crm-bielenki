import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Notas internas, transferências e status: só pela função, só na própria empresa,
// com histórico e aviso para quem recebe.
let db: PGlite, company: string, conv: string, otherConv: string;
const boss = "00000000-0000-4000-8000-000000000191", clerk = "00000000-0000-4000-8000-000000000192", outsider = "00000000-0000-4000-8000-000000000193";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'boss@test.invalid'),($2,'clerk@test.invalid'),($3,'out@test.invalid')", [boss, clerk, outsider]);
  company = (await row("select bootstrap_company('Notas',null,$1) id", [boss])).id;
  const other = (await row("select bootstrap_company('Outra',null,$1) id", [outsider])).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Carlos Atendente')", [clerk, company]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($2,$1,'atendente')", [clerk, company]);
  // Como no Supabase: as tabelas do schema public já dão leitura ao papel; quem filtra é o RLS.
  await db.exec("grant usage on schema auth to authenticated; grant select on conversations to authenticated");
  conv = (await row("insert into conversations(company_id,channel,phone,contact_name) values($1,'whatsapp','5547999990000','João') returning id", [company])).id;
  otherConv = (await row("insert into conversations(company_id,channel,phone) values($1,'whatsapp','5547988880000') returning id", [other])).id;
});
afterAll(async () => { await db?.close(); });

test("nota interna fica no histórico e não vira mensagem", async () => {
  await as(clerk, () => row("select conversation_add_note($1,'Cliente prefere ligação à tarde')", [conv]));
  expect(await row("select kind,body,created_by from conversation_events where conversation_id=$1", [conv])).toEqual({ kind: "nota", body: "Cliente prefere ligação à tarde", created_by: clerk });
  expect((await row("select count(*)::int n from messages where conversation_id=$1", [conv])).n).toBe(0);
  await expect(as(clerk, () => row("select conversation_add_note($1,'   ')", [conv]))).rejects.toThrow(/1 a 2000/);
  await expect(as(clerk, () => row("insert into conversation_events(company_id,conversation_id,kind,body) values($1,$2,'nota','direto')", [company, conv]))).rejects.toThrow(/permission denied/);
});

test("transferir para pessoa pausa a Lia, muda o setor e avisa quem recebe", async () => {
  await as(boss, () => row("select conversation_transfer($1,$2,'pos_venda','Calha vazando')", [conv, clerk]));
  expect(await row("select assigned_to,department,ai_paused from conversations where id=$1", [conv])).toEqual({ assigned_to: clerk, department: "pos_venda", ai_paused: true });
  const aviso = await row("select title,body,link from notifications where profile_id=$1 order by created_at desc limit 1", [clerk]);
  expect(aviso.title).toBe("Conversa transferida para você");
  expect(aviso.body).toContain("João — Calha vazando");
  expect(aviso.link).toBe(`/atendimento?c=${conv}`);
  await expect(as(boss, () => row("select conversation_transfer($1,null,'marketing')", [conv]))).rejects.toThrow(/Setor inválido/);
  await expect(as(boss, () => row("select conversation_transfer($1,$2,null)", [conv, outsider]))).rejects.toThrow(/Atendente não encontrado/);
});

test("status muda com histórico e volta a aberta quando o cliente escreve", async () => {
  await as(clerk, () => row("select conversation_set_status($1,'resolvida')", [conv]));
  expect((await row("select status from conversations where id=$1", [conv])).status).toBe("resolvida");
  await expect(as(clerk, () => row("select conversation_set_status($1,'sumiu')", [conv]))).rejects.toThrow(/Status inválido/);
  await db.query("insert into messages(company_id,conversation_id,direction,body,sent_at) values($1,$2,'inbound','Voltou a vazar',now()+interval '1 minute')", [company, conv]);
  expect((await row("select status from conversations where id=$1", [conv])).status).toBe("aberta");
  expect((await row("select count(*)::int n from conversation_events where conversation_id=$1 and kind='status'", [conv])).n).toBe(1);
});

test("outra empresa não vê nem mexe", async () => {
  expect(await as(outsider, async () => (await row("select count(*)::int n from conversation_events")).n)).toBe(0);
  await expect(as(outsider, () => row("select conversation_add_note($1,'invasão')", [conv]))).rejects.toThrow(/não encontrada/);
  await expect(as(clerk, () => row("select conversation_set_status($1,'resolvida')", [otherConv]))).rejects.toThrow(/não encontrada/);
});

test("resumo da Lia para o JARVIS: só da própria empresa e sem segredos", async () => {
  await db.query("insert into ai_agent_config(company_id,active,lia_mode,openai_api_key) values($1,true,'semiautomatica','segredo') on conflict (company_id) do update set active=true,lia_mode='semiautomatica',openai_api_key='segredo'", [company]);
  await db.query("update conversations set ai_suggestion='Pode mandar fotos?', ai_suggestion_at=now() where id=$1", [conv]);
  await db.query("insert into ai_decisions(company_id,conversation_id,decisao,motivo) values($1,$2,'sugeriu','Pós-venda'),($1,$2,'falhou','Groq 429')", [company, conv]);
  const r = await as(clerk, async () => (await row("select lia_status_center() r")).r);
  expect(r).toMatchObject({ ativa: true, modo: "semiautomatica", hoje: { sugeriu: 1, falhou: 1 } });
  expect(r.sugestoes).toEqual([expect.objectContaining({ conversa: conv, contato: "João", texto: "Pode mandar fotos?" })]);
  expect(r.falhas_24h[0].motivo).toBe("Groq 429");
  expect(JSON.stringify(r)).not.toContain("segredo");
  const fora = await as(outsider, async () => (await row("select lia_status_center() r")).r);
  expect(fora.sugestoes).toEqual([]);
  expect(fora.hoje).toEqual({});
});
