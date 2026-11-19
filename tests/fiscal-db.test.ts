import { afterAll, beforeAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Calculadora fiscal: quem aprova classificação, histórico imutável e idempotente, isolamento.
let db: PGlite, A: string, B: string;
const boss = "00000000-0000-4000-8000-00000000f1a1", bossB = "00000000-0000-4000-8000-00000000f1b1";
const fin = "00000000-0000-4000-8000-00000000f1a2", seller = "00000000-0000-4000-8000-00000000f1a3", clerk = "00000000-0000-4000-8000-00000000f1a4";
const row = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, any>>(sql, args)).rows[0];
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const calc = (key: string | null, extra: Record<string, unknown> = {}) => JSON.stringify({
  origem: "avulso", data_fato_gerador: "2026-11-19", motor: "https://piloto/api", versao_app: "1.7.2", versao_db: "V0073", simulado: false, status: "calculado",
  total_base: 1000, total_cbs: 9, total_ibs: 1, total_is: 0, entrada: { id: "x" }, resposta: { objetos: [] }, idempotency_key: key,
  itens: [{ numero: 1, produto: "Calha de beiral", estado: "CALCULADO", base: 1000, cbs: 9, ibs_uf: 1, ibs_mun: 0, ibs: 1, memoria: "LC 214/2025", erros: [] }], ...extra,
});

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'a@f.invalid'),($2,'b@f.invalid'),($3,'f@f.invalid'),($4,'s@f.invalid'),($5,'c@f.invalid')", [boss, bossB, fin, seller, clerk]);
  A = (await row("select bootstrap_company('Marquinhos',null,$1) id", [boss])).id;
  B = (await row("select bootstrap_company('Outra',null,$1) id", [bossB])).id;
  for (const [id, role] of [[fin, "financeiro"], [seller, "vendedor"], [clerk, "atendente"]]) {
    await db.query("insert into profiles(id,company_id,full_name) values($1,$2,$3)", [id, A, role]);
    await db.query("insert into user_roles(company_id,profile_id,role) values($1,$2,$3)", [A, id, role]);
  }
  await db.exec("grant usage on schema auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated");
});
afterAll(async () => { await db?.close(); });

test("financeiro classifica e aprova; vendedor e atendente não alteram; aprovar exige códigos completos", async () => {
  const id = await as(fin, async () => (await row("insert into fiscal_classifications(produto,natureza,ncm,cst,cclasstrib) values('  Calha   de Beiral ','mercadoria','76109000','000','000001') returning id,produto,produto_chave,status")));
  expect(id).toMatchObject({ produto: "Calha de Beiral", produto_chave: "calha de beiral", status: "rascunho" });
  await expect(as(fin, () => db.query("insert into fiscal_classifications(produto,natureza,cst,cclasstrib,status) values('Instalação','servico','000','000001','aprovada')"))).rejects.toThrow(/check/i);
  const ok = await as(fin, () => row("update fiscal_classifications set status='aprovada' where id=$1 returning status,aprovado_por", [id.id]));
  expect(ok).toEqual({ status: "aprovada", aprovado_por: fin });
  // Vendedor e atendente: a política não deixa nem atualizar (0 linhas).
  for (const u of [seller, clerk]) expect((await as(u, () => db.query("update fiscal_classifications set observacao='x' where id=$1", [id.id]))).affectedRows).toBe(0);
  // Mudou um código sem reaprovar: volta para rascunho.
  expect(await as(fin, () => row("update fiscal_classifications set cclasstrib='000002' where id=$1 returning status,aprovado_por", [id.id]))).toEqual({ status: "rascunho", aprovado_por: null });
  const logs = (await row("select count(*)::int n from audit_logs where table_name='fiscal_classifications' and record_id=$1 and profile_id=$2", [id.id, fin])).n;
  expect(logs).toBe(3);
  // Mesmo produto (outra caixa/espaços) não duplica.
  await expect(as(fin, () => db.query("insert into fiscal_classifications(produto) values('calha de beiral')"))).rejects.toThrow(/duplicate|unique/);
});

test("histórico: vendedor simula, atendente não vê; a mesma chave não duplica", async () => {
  const a = await as(seller, async () => (await row("select save_fiscal_calculation($1::jsonb) id", [calc("orc-1")])).id);
  const b = await as(seller, async () => (await row("select save_fiscal_calculation($1::jsonb) id", [calc("orc-1")])).id);
  expect(b).toBe(a);
  expect(await as(fin, () => row("select count(*)::int n, sum(total_cbs)::float cbs from fiscal_calculations"))).toEqual({ n: 1, cbs: 9 });
  expect(await as(fin, () => row("select produto, estado, cbs::float from fiscal_calculation_items where calculation_id=$1", [a]))).toEqual({ produto: "Calha de beiral", estado: "CALCULADO", cbs: 9 });
  expect((await as(clerk, () => db.query("select * from fiscal_calculations"))).rows).toHaveLength(0);
  await expect(as(clerk, () => db.query("select save_fiscal_calculation($1::jsonb)", [calc("orc-2")]))).rejects.toThrow(/Sem permissão/);
  // Histórico é imutável para o app (sem update/delete).
  expect((await as(fin, () => db.query("update fiscal_calculations set total_cbs=0 where id=$1", [a]))).affectedRows).toBe(0);
});

test("outra empresa não vê configuração, classificações nem cálculos", async () => {
  await as(boss, () => db.query("insert into fiscal_settings(company_id,enabled,regime,uf,municipio_ibge) values($1,true,'simples','SC',4208906)", [A]));
  await as(bossB, async () => {
    for (const t of ["fiscal_settings", "fiscal_classifications", "fiscal_calculations", "fiscal_calculation_items"])
      expect((await db.query(`select * from ${t}`)).rows).toHaveLength(0);
  });
  await expect(as(bossB, () => db.query("insert into fiscal_settings(company_id) values($1)", [A]))).rejects.toThrow(/row-level security/);
  expect(B).not.toBe(A);
});
