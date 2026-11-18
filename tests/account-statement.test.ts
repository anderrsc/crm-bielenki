import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";
import { statementPeriod } from "@/lib/account-statement";

// Extrato por conta: saldo anterior, entradas e saídas do período com saldo linha a linha,
// sem estornos, sem outras contas e sem outra empresa.
let db: PGlite, company: string, banco: string, caixa: string, alheia: string;
const user = "00000000-0000-4000-8000-0000000001a1", clerk = "00000000-0000-4000-8000-0000000001a2";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'ext@test.invalid'),($2,'clerk@test.invalid')", [user, clerk]);
  company = (await row("select bootstrap_company('Extrato',null,$1) id", [user])).id;
  const other = (await row("insert into companies(name) values('Outra') returning id")).id;
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Atendente')", [clerk, company]);
  await db.query("insert into user_roles(company_id,profile_id,role) values($2,$1,'atendente')", [clerk, company]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  banco = (await row("insert into receiving_accounts(company_id,name,opening_balance,opening_date) values($1,'Banco',1000,'2026-10-01') returning id", [company])).id;
  caixa = (await row("insert into receiving_accounts(company_id,name) values($1,'Caixa') returning id", [company])).id;
  alheia = (await row("insert into receiving_accounts(company_id,name) values($1,'Alheia') returning id", [other])).id;
  const client = (await row("insert into clients(company_id,name) values($1,'João Silva') returning id", [company])).id;
  const entry = async (type: string, desc: string, cli: string | null = null) => (await row(
    "insert into financial_entries(company_id,entry_type,origin,description,total_amount,client_id) values($1,$2,'manual',$3,10000,$4) returning id", [company, type, desc, cli])).id;
  const pay = (id: string, amount: number, when: string, acc: string, method = "pix", reversed = false) => db.query(
    "insert into payments(company_id,financial_entry_id,amount,paid_at,receiving_account_id,payment_method,reversed_at) values($1,$2,$3,$4,$5,$6,$7)",
    [company, id, amount, when, acc, method, reversed ? new Date().toISOString() : null]);
  const venda = await entry("receber", "Calhas obra Centro", client);
  const compra = await entry("pagar", "Chapa galvanizada");
  await pay(venda, 999, "2026-09-20", banco);           // antes do saldo inicial: fora
  await pay(venda, 500, "2026-10-15", banco);           // antes do período: vai para o saldo anterior
  await pay(venda, 300, "2026-11-03", banco);
  await pay(compra, 120, "2026-11-05", banco, "boleto");
  await pay(venda, 50, "2026-11-06", banco, "pix", true); // estornado: fora
  await pay(venda, 70, "2026-11-07", caixa, "dinheiro");  // outra conta: fora
  await pay(compra, 40, "2026-12-02", banco);           // depois do período: fora
});
afterAll(async () => { await db?.close(); });

test("extrato do período com saldo anterior, linhas e totais", async () => {
  const s = (await row("select account_statement($1,'2026-11-01','2026-11-30') s", [banco])).s;
  expect(s.conta.nome).toBe("Banco");
  expect(Number(s.saldo_anterior)).toBe(1500);
  expect(Number(s.entradas)).toBe(300);
  expect(Number(s.saidas)).toBe(120);
  expect(Number(s.saldo_final)).toBe(1680);
  expect(s.movimentos.map((m: any) => [m.data, m.tipo, Number(m.valor), Number(m.saldo)])).toEqual([
    ["2026-11-03", "entrada", 300, 1800],
    ["2026-11-05", "saida", -120, 1680],
  ]);
  expect(s.movimentos[0]).toMatchObject({ descricao: "Calhas obra Centro", pessoa: "João Silva", forma: "pix" });
});

test("saldo inicial dentro do período aparece como linha", async () => {
  const s = (await row("select account_statement($1,'2026-09-01','2026-10-31') s", [banco])).s;
  expect(Number(s.saldo_anterior)).toBe(0);
  expect(s.movimentos.map((m: any) => [m.tipo, Number(m.saldo)])).toEqual([["saldo_inicial", 1000], ["entrada", 1500]]);
  expect(Number(s.saldo_final)).toBe(1500);
});

test("período inválido, conta de outra empresa e sem permissão", async () => {
  await expect(row("select account_statement($1,'2026-11-30','2026-11-01')", [banco])).rejects.toThrow(/Período inválido/);
  await expect(row("select account_statement($1,'2026-11-01','2026-11-30')", [alheia])).rejects.toThrow(/Conta não encontrada/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [clerk]);
  try {
    await expect(row("select account_statement($1,'2026-11-01','2026-11-30')", [banco])).rejects.toThrow(/Sem permissão/);
  } finally {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  }
});

test("período padrão: do dia 1 do mês até hoje", () => {
  expect(statementPeriod(undefined, undefined, "2026-11-16")).toEqual({ from: "2026-11-01", to: "2026-11-16" });
  expect(statementPeriod("2026-11-20", "2026-11-10", "2026-11-16")).toEqual({ from: "2026-11-10", to: "2026-11-20" });
  expect(statementPeriod("lixo", "2026-10-31", "2026-11-16")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
});
