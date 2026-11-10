import { beforeEach, expect, test } from 'vitest';
import { loadSaleWorkspace } from '@/lib/sales/workspace';
import type { SupabaseClient } from '@supabase/supabase-js';
const calls: Array<{ table: string; filters: Array<[string, unknown]>; or?: string }> = [];
const denied = new Set<string>();
const errors = new Set<string>();
let tables: Record<string, any[]>;
function db() {
  return {
    rpc: async (_: string, p: any) => ({ data: !denied.has(`${p.resource}:${p.action}`), error: null }),
    from: (table: string) => {
      const call = { table, filters: [] as Array<[string, unknown]>, or: undefined as string | undefined }; calls.push(call);
      const result = () => ({ data: errors.has(table) ? null : (tables[table] ?? []).filter(row => call.filters.every(([key, value]) => row[key] === value)), error: errors.has(table) ? { message: 'offline' } : null });
      const q: any = { select: () => q, eq: (key: string, value: unknown) => { call.filters.push([key, value]); return q; }, order: () => q, or: (value: string) => { call.or = value; return q; },
        single: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; }, maybeSingle: async () => q.single(), then: (resolve: any) => Promise.resolve(result()).then(resolve) };
      return q;
    },
  } as unknown as SupabaseClient;
}
beforeEach(() => {
  calls.length = 0; denied.clear(); errors.clear();
  tables = { sales: [{ id: 's1', company_id: 'c1' }], orders: [{ id: 'o1', company_id: 'c1', sale_id: 's1' }, { id: 'foreign-order', company_id: 'c2', sale_id: 's1' }], quotes: [{ id: 'q1', company_id: 'c1', sale_id: 's1' }],
    financial_entries: [{ id: 'e1', company_id: 'c1', sale_id: 's1', entry_type: 'receber' }, { id: 'other-sale', company_id: 'c1', sale_id: 's2', entry_type: 'receber' }, { id: 'expense', company_id: 'c1', sale_id: 's1', entry_type: 'pagar' }],
    order_checklist_items: [{ id: 'check1', order_id: 'o1', company_id: 'c1' }, { id: 'check2', order_id: 'o2', company_id: 'c1' }], measurements: [] };
});
test('contas e checklist são filtrados pela venda, pedido e empresa, sem misturar outros registros', async () => {
  const data = await loadSaleWorkspace(db(), 's1');
  expect(data?.entries.map(e => e.id)).toEqual(['e1']); expect(data?.checklist.map(e => e.id)).toEqual(['check1']);
  expect(calls.find(c => c.table === 'measurements')?.or).toBe('order_id.eq.o1,quote_id.eq.q1');
  for (const c of calls.filter(c => c.table !== 'sales')) expect(c.filters).toContainEqual(['company_id', 'c1']);
});
test('não consulta módulos sem permissão nem inventa vínculos', async () => {
  for (const key of ['financial_entries:select','orders:select','quotes:select','measurements:select']) denied.add(key);
  const data = await loadSaleWorkspace(db(), 's1');
  expect(data?.order).toBeNull(); expect(data?.quote).toBeNull(); expect(data?.entries).toEqual([]);
  expect(calls.map(c => c.table)).toEqual(['sales']);
});
test('falha na conta a receber aparece como aviso, em vez de parecer venda sem conta', async () => {
  errors.add('financial_entries'); const data = await loadSaleWorkspace(db(), 's1');
  expect(data?.warnings).toContain('Não foi possível carregar as contas a receber.');
});
test('venda não acessível interrompe as consultas relacionadas', async () => {
  expect(await loadSaleWorkspace(db(), 's2')).toBeNull(); expect(calls).toHaveLength(1);
});
