import { expect, test } from 'vitest';
import { createTestDatabase } from './helpers/database';
test('políticas usam identidade em subconsulta e preservam isolamento das sessões por dono', async () => {
  const db = await createTestDatabase();
  const owner = '00000000-0000-4000-8000-00000000aa01', other = '00000000-0000-4000-8000-00000000aa02';
  try {
    const policies = await db.query<{ qual: string; check_expr: string }>(`select pg_get_expr(polqual,polrelid) qual, pg_get_expr(polwithcheck,polrelid) check_expr from pg_policy where polname in ('lia_requests_update','lia_sessions_own')`);
    expect(policies.rows).toHaveLength(2);
    for (const p of policies.rows) expect(p.qual + p.check_expr).not.toMatch(/(?<!SELECT )auth\.uid\(/);
    const { rows: [company] } = await db.query<{ id: string }>("insert into companies(name) values('RLS teste') returning id");
    await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
    await db.query("insert into profiles(id,company_id,full_name) values($1,$3,'Dono'),($2,$3,'Outro')", [owner, other, company.id]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.query('insert into lia_chat_sessions(company_id,user_id,title) values($1,$2,$3)', [company.id, owner, 'Sessão privada']);
    expect((await db.query('select id from lia_chat_sessions')).rows).toHaveLength(1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    expect((await db.query('select id from lia_chat_sessions')).rows).toHaveLength(0);
    await expect(db.query('insert into lia_chat_sessions(company_id,user_id) values($1,$2)', [company.id, owner])).rejects.toThrow(/row-level security/i);
  } finally { await db.close(); }
});
