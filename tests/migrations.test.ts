import { expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createTestDatabase } from './helpers/database';

test('business migrations apply to a clean PostgreSQL database', async () => {
  const db = await createTestDatabase();
  const before = (await db.query('select count(*)::int n from companies')).rows;
  await db.exec(readFileSync('supabase/migrations/046_review_operational_fixes.sql','utf8'));
  expect((await db.query('select count(*)::int n from companies')).rows).toEqual(before);
  await db.close();
});

test('replaying financial migrations preserves the extended view and existing definitions', async () => {
  const db = await createTestDatabase();
  try {
    await db.exec("insert into companies(name) values('Replay'); insert into financial_cost_centers(company_id,name) select id,'Existing' from companies where name='Replay'");
    const columns = () => db.query("select column_name from information_schema.columns where table_schema='public' and table_name='v_financial_entries' order by ordinal_position");
    const before = (await columns()).rows;
    for (let round = 0; round < 2; round++) {
      for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f >= '040').sort()) {
        await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8').replace(/^\s*(begin|commit);\s*$/gim, ''));
      }
      expect((await columns()).rows).toEqual(before);
      expect((await db.query("select name from financial_cost_centers")).rows).toEqual([{ name: 'Existing' }]);
    }
  } finally { await db.close(); }
});
