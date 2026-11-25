import { beforeEach, expect, test, vi } from 'vitest';
const { from, rpc, user, queries, writes } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), user: vi.fn(), queries: [] as Array<{ table: string; columns?: string; filters: unknown[][] }>, writes: [] as Array<{ table: string; value: unknown }> }));
vi.mock('@/lib/supabase/server', () => ({ getAuthUser: user, getRequestClient: async () => ({ from, rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { toggleLiaRule } from '@/app/(crm)/lia-central-actions';
import { savePromptDraft } from '@/app/(crm)/lia-prompt-actions';
const actions = [() => toggleLiaRule('rule-id', false), () => savePromptDraft('Rascunho apenas no banco falso')];
beforeEach(() => {
  queries.length = 0; writes.length = 0;
  user.mockResolvedValue({ id: 'owner', user_metadata: { role: 'administrador' } });
  rpc.mockReset(); rpc.mockResolvedValue({ data: ['vendedor'], error: null });
  from.mockImplementation((table: string) => {
    const query = { table, columns: undefined as string | undefined, filters: [] as unknown[][] }; queries.push(query);
    const result = () => ({ data: table === 'profiles' ? { company_id: 'company' } : { version: 0 }, error: null });
    const q = { select: (columns: string) => { query.columns = columns; return q; }, eq: (...filter: unknown[]) => { query.filters.push(filter); return q; }, order: () => q, limit: () => q,
      single: async () => result(), maybeSingle: async () => result(), update: (value: unknown) => { writes.push({ table, value }); return q; }, insert: (value: unknown) => { writes.push({ table, value }); return q; }, then: (ok: (value: unknown) => unknown) => Promise.resolve(result()).then(ok) };
    return q;
  });
});
test.each([0, 1])('ação %i consulta perfil ativo e recusa vendedor mesmo com metadados de administrador', async i => {
  expect(await actions[i]()).toHaveProperty('error'); expect(writes).toEqual([]);
  expect(queries[0]).toEqual({ table: 'profiles', columns: 'company_id', filters: [['id', 'owner'], ['active', true]] });
  expect(rpc).toHaveBeenCalledWith('current_user_roles');
});
test.each([[0, 'gerente'], [0, 'administrador'], [1, 'gerente'], [1, 'administrador']] as const)('ação %i permite %s pelo papel verificado no banco', async (i, role) => {
  rpc.mockResolvedValue({ data: ['vendedor', role], error: null });
  expect(await actions[i]()).toEqual({}); expect(writes.length).toBeGreaterThan(0);
  if (i === 0) expect(queries.find(q => q.table === 'lia_rules')?.filters).toContainEqual(['company_id', 'company']);
  else expect(writes[0].value).toMatchObject({ company_id: 'company', status: 'draft' });
});
test.each([0, 1])('ação %i não grava se a consulta de permissões falhar', async i => {
  rpc.mockResolvedValue({ data: ['administrador'], error: { message: 'indisponível' } });
  expect(await actions[i]()).toHaveProperty('error'); expect(writes).toEqual([]);
});
