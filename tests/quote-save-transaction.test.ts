import { beforeAll, afterAll, test, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./helpers/database";

let db: PGlite, company: string, client: string;
const user = "00000000-0000-4000-8000-000000000001";
const payload = () => ({ client_id: client, discount: 0, freight: 0, notes: "Teste", hide_unit_prices: true, hide_travel_price: false, valid_until: "2026-12-01", items: [{ product: "Calha de Beiral", thickness: "0.5mm", cut: "200 mm", quantity: 2, meters: 5, unit_price: 10 }], special_items: [{ item_type: "Condutores", product: "Condutor", description: "Cor: Branco", unit: "unidade", quantity: 3, unit_price: 20 }] });
async function row(sql: string, params: unknown[] = []) { return (await db.query<Record<string, any>>(sql, params)).rows[0]; }
beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users(id,email) values($1,'save@test.invalid')", [user]);
  company = (await row("select bootstrap_company('Save test',null,$1) id", [user])).id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  client = (await row("insert into clients(company_id,name) values($1,'Cliente') returning id", [company])).id;
  await db.exec("grant usage on schema auth to authenticated; grant select on profiles,clients,quotes,quote_items,triage_sessions to authenticated; grant insert on quote_items to authenticated; grant update on quotes to authenticated;");
});
afterAll(async () => { await db?.close(); });

test("uma transação salva os itens, total, vendedor e preferências; editar não duplica complementos", async () => {
  await db.exec("begin; set local role authenticated");
  try {
    const q = (await row("select save_gutter_quote_complete($1) id", [JSON.stringify(payload())])).id;
    expect(Number((await row("select subtotal from quotes where id=$1", [q])).subtotal)).toBe(160);
    expect((await row("select count(*)::int n from quote_items where quote_id=$1", [q])).n).toBe(2);
    expect((await row("select hide_travel_price from quotes where id=$1", [q])).hide_travel_price).toBe(false);
    await row("select save_gutter_quote_complete($1,$2)", [JSON.stringify({ ...payload(), valid_until: "" }), q]);
    expect((await row("select count(*)::int n from quote_items where quote_id=$1", [q])).n).toBe(2);
    expect(String((await row("select valid_until::text v from quotes where id=$1", [q])).v)).toBe("2026-12-01");
  } finally { await db.exec("rollback"); }
});

test("falha ao inserir complemento reverte criação e alteração integralmente", async () => {
  const q = (await row("select save_gutter_quote_complete($1) id", [JSON.stringify(payload())])).id;
  await db.exec(`create function reject_test_item() returns trigger language plpgsql as $$ begin if new.product='REJECT' then raise exception 'complemento rejeitado'; end if; return new; end $$;
    create trigger reject_test_item before insert on quote_items for each row execute function reject_test_item();`);
  try {
    const broken = { ...payload(), special_items: [{ ...payload().special_items[0], product: "REJECT" }] };
    const before = (await row("select count(*)::int n from quotes")).n;
    await expect(row("select save_gutter_quote_complete($1)", [JSON.stringify(broken)])).rejects.toThrow("complemento rejeitado");
    expect((await row("select count(*)::int n from quotes")).n).toBe(before);
    await expect(row("select save_gutter_quote_complete($1,$2)", [JSON.stringify(broken), q])).rejects.toThrow("complemento rejeitado");
    expect((await row("select count(*)::int n from quote_items where quote_id=$1", [q])).n).toBe(2);
    expect(Number((await row("select subtotal from quotes where id=$1", [q])).subtotal)).toBe(160);
  } finally { await db.exec("drop trigger reject_test_item on quote_items; drop function reject_test_item();"); }
});

test("central devolve histórico reduzido, respeita empresa e impede acesso anônimo", async () => {
  const messages = [...Array.from({ length: 500 }, () => ({ role: "user", content: "Mensagem longa" })), { role: "assistant", content: "Olá" }, { role: "system", content: "[IA falhou] sem crédito" }];
  await db.query("insert into triage_sessions(company_id,phone,status,messages) values($1,'5547999999999','em_andamento',$2)", [company, JSON.stringify(messages)]);
  await db.exec("begin; set local role authenticated");
  try {
    const activity = (await db.query<{ messages: unknown[] }>("select * from central_triage_activity($1,now()-interval '1 day')", [company])).rows;
    expect(activity[0].messages).toEqual(messages.slice(-2));
    expect((await db.query("select * from central_triage_activity($1,now()-interval '1 day')", ["00000000-0000-4000-8000-000000000099"])).rows).toEqual([]);
  } finally { await db.exec("rollback"); }
  await db.exec("begin; set local role anon");
  try { await expect(row("select save_gutter_quote_complete($1)", [JSON.stringify(payload())])).rejects.toThrow(/permission denied/); }
  finally { await db.exec("rollback"); }
});
