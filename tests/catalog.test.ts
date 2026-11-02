import { expect, test } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createTestDatabase } from "./helpers/database";
import { MARQUINHOS_CATALOG, catalogImagePath, catalogModelUrl, catalogPieceForProduct } from "@/lib/gutter-catalog";
import { PRODUCTS_BY_CATEGORY } from "@/lib/gutters";
import { quotePieceMedia } from "@/lib/quote-piece-media";

test("all 20 documented profiles have original drawings and distinct model links", async () => {
  expect(MARQUINHOS_CATALOG.pieces).toHaveLength(20);
  const links = new Set<string>();
  for (const piece of MARQUINHOS_CATALOG.pieces) {
    expect(existsSync(`public${catalogImagePath(piece)}`)).toBe(true);
    expect(catalogPieceForProduct(piece.name)?.id).toBe(piece.id);
    links.add(catalogModelUrl(piece));
  }
  expect(links.size).toBe(20);
  expect(catalogPieceForProduct("Calha central (fundo reto)")?.id).not.toBe(catalogPieceForProduct("Calha central (fundo em V)")?.id);
  expect(catalogPieceForProduct("Pingadeira com Rufo")).toBeUndefined();
  expect(PRODUCTS_BY_CATEGORY.Calhas).toContain("Calha Moldura");
  expect(PRODUCTS_BY_CATEGORY.Pingadeiras).toContain("Pingadeira com Rufo");
  const media = await quotePieceMedia("Rufo de Cumeeira", true);
  expect(media?.image.startsWith("data:image/png;base64,")).toBe(true);
  expect(media?.qr.startsWith("data:image/png;base64,")).toBe(true);
  expect(media?.url).toBe("https://marquinhos-calhas.vercel.app/pecas-3d.html#cumeeira");
  expect(await quotePieceMedia("Peça exclusiva", true)).toBeNull();
});

test("catalog import updates reference prices, preserves extras and other tenants, and can be repeated", async () => {
  const db = await createTestDatabase();
  try {
    const user = "00000000-0000-4000-8000-000000000099";
    await db.query("insert into auth.users(id,email) values($1,'catalog@test.invalid')",[user]);
    const company = (await db.query<{id:string}>("select bootstrap_company('Marquinhos','26.887.887/0001-75',$1) id",[user])).rows[0].id;
    const other = (await db.query<{id:string}>("insert into companies(name) values('Outra empresa') returning id")).rows[0].id;
    await db.query("insert into gutter_prices(company_id,product,unit_price) values($1,'Exclusiva',123),($2,'Exclusiva',987)",[company,other]);
    const file=readdirSync('supabase/migrations').find(f=>f.endsWith('_catalogo_marquinhos_20261102.sql'))!;
    const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
    await db.exec(sql);
    const first=(await db.query<{n:number}>("select count(*)::int n from gutter_prices where company_id=$1",[company])).rows[0].n;
    expect(first).toBeGreaterThan(1000);
    await db.exec(sql);
    expect((await db.query("select count(*)::int n from gutter_prices where company_id=$1",[company])).rows[0]).toEqual({n:first});
    expect((await db.query("select unit_price::float price from gutter_prices where company_id=$1 and product='Exclusiva'",[company])).rows[0]).toEqual({price:123});
    expect((await db.query("select unit_price::float price from gutter_prices where company_id=$1 and product='Exclusiva'",[other])).rows[0]).toEqual({price:987});
    expect((await db.query("select unit_price::float price from gutter_prices where company_id=$1 and product='Calha central (fundo em V)' and thickness='1.0mm' and cut_mm=1200",[company])).rows[0]).toEqual({price:392});
    expect((await db.query("select unit,unit_price::float price from gutter_prices where company_id=$1 and product='Cano PVC — barra de 6,00 m'",[company])).rows[0]).toEqual({unit:'metro',price:40});
    expect((await db.query("select unit_price::float price from gutter_prices where company_id=$1 and product='Calha de beiral c/ 300 mm — Dois pisos'",[company])).rows[0]).toEqual({price:75});
    for (const name of ['v_workflow_analytics','v_installation_checklist_alerts']) {
      expect((await db.query<{options:string[]}>("select reloptions as options from pg_class where oid=$1::regclass",[`public.${name}`])).rows[0].options).toContain('security_invoker=true');
      expect((await db.query<{allowed:boolean}>("select has_table_privilege('anon',$1,'select') allowed",[`public.${name}`])).rows[0].allowed).toBe(false);
    }
    expect((await db.query<{allowed:boolean}>("select has_function_privilege('anon','public.approve_quote_unchecked(uuid,date)','execute') allowed")).rows[0].allowed).toBe(false);
  } finally { await db.close(); }
});
