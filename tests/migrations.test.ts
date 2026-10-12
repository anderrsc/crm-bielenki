import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDatabase } from './helpers/database';

test('business migrations apply to a clean PostgreSQL database', async () => {
  const db = await createTestDatabase();
  const before = (await db.query('select count(*)::int n from companies')).rows;
  await db.exec(readFileSync('supabase/migrations/046_review_operational_fixes.sql','utf8'));
  expect((await db.query('select count(*)::int n from companies')).rows).toEqual(before);
  await db.close();
});
