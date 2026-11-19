import { beforeAll, afterAll, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

// Cobrança Pix do Atendimento: fica registrada na conta escolhida e, ao confirmar, vira entrada
// no extrato daquela conta (e não em outra).
let db: PGlite, company: string, valdir: string, outra: string, client: string, conversation: string;
const user = "00000000-0000-4000-8000-0000000007c1";
async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(sql, args)).rows[0]; }
const today = () => row("select current_date::text d").then((r) => r.d as string);
const statement = async (account: string) => (await row("select account_statement($1, current_date - 30, current_date) s", [account])).s;
const charge = (account: string, amount: number, extra: { entry?: string; quote?: string } = {}) =>
  row("select record_pix_charge($1,$2,$3,$4,$5,$6,$7) id", [account, amount, "Pedido Pellens", conversation, client, extra.entry ?? null, extra.quote ?? null]).then((r) => r.id as string);

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'pix@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Pix',null,$1) id", [user])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  valdir = (await row("insert into receiving_accounts(company_id,name,pix_key) values($1,'Pix Valdir','valdir@exemplo.com') returning id", [company])).id;
  outra = (await row("insert into receiving_accounts(company_id,name,pix_key) values($1,'Pix Empresa','00000000000100') returning id", [company])).id;
  client = (await row("insert into clients(company_id,name,phone) values($1,'Marco Teste','47999990333') returning id", [company])).id;
  conversation = (await row("insert into conversations(company_id,client_id,channel) values($1,$2,'whatsapp') returning id", [company, client])).id;
});
afterAll(async () => { await db?.close(); });

test("cobrança de uma conta em aberto: aguarda, e ao confirmar entra no extrato da conta do Valdir", async () => {
  const entry = (await row("insert into financial_entries(company_id,entry_type,origin,client_id,description,total_amount,due_date) values($1,'receber','manual',$2,'Pedido 1000',1000,current_date) returning id", [company, client])).id;
  const id = await charge(valdir, 1000, { entry });
  expect(await row("select status,account_name,amount::float amount,client_id from pix_charges where id=$1", [id])).toEqual({ status: "aguardando", account_name: "Pix Valdir", amount: 1000, client_id: client });
  // Enviada ainda não é dinheiro: o extrato não muda.
  expect((await statement(valdir)).entradas).toBe(0);

  const payment = (await row("select confirm_pix_charge($1) id", [id])).id;
  expect(await row("select receiving_account_id,receiving_account_name,amount::float amount,payment_method from payments where id=$1", [payment]))
    .toEqual({ receiving_account_id: valdir, receiving_account_name: "Pix Valdir", amount: 1000, payment_method: "pix" });
  const st = await statement(valdir);
  expect(st.entradas).toBe(1000);
  expect(st.movimentos[0]).toMatchObject({ tipo: "entrada", descricao: "Pedido 1000", pessoa: "Marco Teste", forma: "pix", valor: 1000 });
  expect((await statement(outra)).entradas).toBe(0);
  expect(await row("select status,payment_id,paid_at::text from pix_charges where id=$1", [id])).toEqual({ status: "recebida", payment_id: payment, paid_at: await today() });
  expect((await row("select open_amount::float v from financial_entries where id=$1", [entry])).v).toBe(0);
  await expect(row("select confirm_pix_charge($1)", [id])).rejects.toThrow(/já foi recebida/);
});

test("cobrança de 50% do orçamento: pede a aprovação antes e depois baixa na venda", async () => {
  const type = (await row("select id from sale_types where company_id=$1 limit 1", [company])).id;
  const q = (await row("insert into quotes(company_id,quote_number,client_id,sale_type_id,subtotal) values($1,'ORC-2026-00900',$2,$3,2000) returning id", [company, client, type])).id;
  await db.query("insert into quote_items(company_id,quote_id,product,unit,quantity,unit_price) values($1,$2,'Esquadria','un',1,2000)", [company, q]);
  const id = await charge(outra, 1000, { quote: q });
  await expect(row("select confirm_pix_charge($1)", [id])).rejects.toThrow(/Aprove o orçamento/);
  expect((await row("select status from pix_charges where id=$1", [id])).status).toBe("aguardando");
  const sale = (await row("select approve_quote($1) id", [q])).id;
  await row("select confirm_pix_charge($1)", [id]);
  expect((await row("select paid_amount::float v from financial_entries where sale_id=$1 and entry_type='receber'", [sale])).v).toBe(1000);
  expect((await statement(outra)).entradas).toBe(1000);
});

test("cobrança avulsa (outro valor) cria a conta a receber e já baixa; valor maior que o saldo é barrado", async () => {
  const avulsa = await charge(valdir, 250);
  await row("select confirm_pix_charge($1)", [avulsa]);
  expect(await row("select e.description,e.total_amount::float total,e.open_amount::float aberto,e.client_id from pix_charges c join financial_entries e on e.id=c.financial_entry_id where c.id=$1", [avulsa]))
    .toEqual({ description: "Pedido Pellens", total: 250, aberto: 0, client_id: client });
  expect((await statement(valdir)).entradas).toBe(1250);

  const entry = (await row("insert into financial_entries(company_id,entry_type,origin,client_id,description,total_amount,due_date) values($1,'receber','manual',$2,'Pequena',100,current_date) returning id", [company, client])).id;
  const demais = await charge(valdir, 150, { entry });
  await expect(row("select confirm_pix_charge($1)", [demais])).rejects.toThrow(/maior que o saldo em aberto/);
});

test("cancelar não mexe no financeiro; não aceita conta de outra empresa nem valor zero", async () => {
  const id = await charge(valdir, 80);
  await row("select cancel_pix_charge($1)", [id]);
  expect((await row("select status,financial_entry_id,payment_id from pix_charges where id=$1", [id]))).toEqual({ status: "cancelada", financial_entry_id: null, payment_id: null });
  await expect(row("select confirm_pix_charge($1)", [id])).rejects.toThrow(/já foi cancelada/);
  const other = (await row("insert into companies(name) values('Outra') returning id")).id;
  const alheia = (await row("insert into receiving_accounts(company_id,name) values($1,'Conta de fora') returning id", [other])).id;
  await expect(charge(alheia, 10)).rejects.toThrow(/Conta de recebimento não encontrada/);
  await expect(charge(valdir, 0)).rejects.toThrow(/Valor da cobrança inválido/);
});
