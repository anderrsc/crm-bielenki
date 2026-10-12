// Gera supabase/migrations/048_sync_functions_and_triggers.sql a partir do
// banco de testes (todas as migrations aplicadas): regrava cada funcao e
// trigger do schema public exatamente como ficam depois de todas as
// migrations. Serve para bancos em que alguma migration antiga nao foi
// aplicada (no de producao faltavam 009, 033 e 035).
// Uso: DATABASE_URL=... node tests/db/generate-sync-migration.mjs
import fs from "node:fs";
import pg from "pg";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5499/crm_test" });
await db.connect();
const fns = (await db.query(`select p.oid::regprocedure::text sig, pg_get_functiondef(p.oid) def from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  order by p.proname, 1`)).rows;
const trg = (await db.query(`select t.tgname, c.oid::regclass::text tbl, pg_get_triggerdef(t.oid) def from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal order by 2, 1`)).rows;
await db.end();

// 033 adaptada: a tabela e os precos iniciais so sao criados se a tabela nao
// existir, para que rodar de novo nao traga de volta linhas apagadas.
const aluminum = `do $$
begin
  if to_regclass('public.aluminum_price_matrix') is null then
    create table public.aluminum_price_matrix (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete cascade,
      thickness text not null,
      cut_mm integer not null,
      price_per_meter numeric not null default 0,
      updated_at timestamptz default now(),
      unique (company_id, thickness, cut_mm)
    );
    insert into public.aluminum_price_matrix(company_id, thickness, cut_mm, price_per_meter)
    select c.id, esp, corte, 0
    from public.companies c
    cross join (values ('0.5mm'),('0.6mm'),('0.7mm'),('1.0mm')) as t(esp)
    cross join (values (100),(150),(200),(250),(300),(333),(350),(400),(450),(500),(600),(700),(800),(1000)) as r(corte);
  end if;
end $$;

alter table public.aluminum_price_matrix enable row level security;
drop policy if exists "tenant_aluminum_matrix" on public.aluminum_price_matrix;
create policy "tenant_aluminum_matrix" on public.aluminum_price_matrix
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());
grant all on public.aluminum_price_matrix to authenticated;
create index if not exists idx_aluminum_matrix_company on public.aluminum_price_matrix(company_id, thickness, cut_mm);`;

const sql = `-- Migration 048 — Sincroniza funcoes e triggers com o estado final das migrations.
-- No banco de producao faltavam objetos das migrations 009 (vendas/compras
-- manuais), 033 (matriz de aluminio) e 035 (itens especiais de calhas).
-- Esta migration recria a matriz de aluminio e regrava todas as funcoes e
-- triggers do schema public. Pode ser rodada mais de uma vez.
-- Gerada por tests/db/generate-sync-migration.mjs.

begin;
set local check_function_bodies = off;

-- ─── 033: matriz de precos de aluminio ───────────────────────────────────────
${aluminum}

-- ─── funcoes ─────────────────────────────────────────────────────────────────
${fns.map((f) => `-- ${f.sig}\n${f.def.trim()};`).join("\n\n")}

-- Permissoes das funcoes que podiam nao existir (009/023/035).
revoke all on function public.create_manual_sale_unchecked(jsonb) from public, anon, authenticated;
revoke all on function public.create_manual_purchase_unchecked(jsonb) from public, anon, authenticated;
revoke all on function public.create_manual_sale(jsonb) from public, anon;
revoke all on function public.create_manual_purchase(jsonb) from public, anon;
grant execute on function public.create_manual_sale(jsonb) to authenticated;
grant execute on function public.create_manual_purchase(jsonb) to authenticated;
revoke all on function public.gutter_quote_item_unit(text, text) from public, anon;
grant execute on function public.gutter_quote_item_unit(text, text) to authenticated;

-- ─── triggers ────────────────────────────────────────────────────────────────
${trg.map((t) => `drop trigger if exists ${t.tgname} on ${t.tbl};\n${t.def};`).join("\n")}

commit;
`;
fs.writeFileSync(new URL("../../supabase/migrations/048_sync_functions_and_triggers.sql", import.meta.url), sql);
console.log(`${fns.length} funcoes, ${trg.length} triggers`);
