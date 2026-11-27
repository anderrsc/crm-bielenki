import { beforeEach, expect, test, vi } from 'vitest';
import { moveAgendaEvent } from '@/app/(crm)/agenda-actions';

type Reply = { data: unknown; error: unknown };
const state = vi.hoisted(() => ({
  replies: {} as Record<string, unknown>,
  updates: [] as { table: string; values: Record<string, unknown> }[],
  rpc: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/own-profile', () => ({ selectOwnProfile: async () => ({ data: { company_id: 'empresa' } }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: state.rpc,
    from: (table: string) => {
      let updating = false;
      const reply = () => (state.replies[updating ? `${table}:update` : table] ?? { data: null, error: null }) as Reply;
      const query: Record<string, unknown> = {
        update: (values: Record<string, unknown>) => { updating = true; state.updates.push({ table, values }); return query; },
        single: async () => reply(),
        maybeSingle: async () => reply(),
        then: (ok: (r: Reply) => unknown) => Promise.resolve(reply()).then(ok),
      };
      for (const name of ['select', 'eq', 'limit']) query[name] = () => query;
      return query;
    },
  }),
}));

const id = '11111111-1111-4111-8111-111111111111';
const ok = (data: unknown) => ({ data, error: null });
const row = (extra: object) => ok({ id, status: 'agendado', responsible_id: null, ...extra });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  state.replies = {}; state.updates = []; state.rpc.mockReset().mockResolvedValue({ error: null });
});

test('recusa data inválida e pedido vazio sem tocar no banco', async () => {
  for (const patch of [{ day: 'Atrasados' }, { day: '2026-02-30' }, {}]) {
    expect((await moveAgendaEvent({ id, source: 'installations', ...patch })).error).toBeTruthy();
  }
  expect(state.updates).toEqual([]);
});

test('reagenda mantendo o horário', async () => {
  state.replies = { installations: row({ scheduled_at: '2026-11-20T17:00:00+00:00' }), 'installations:update': ok({ id }) };
  expect(await moveAgendaEvent({ id, source: 'installations', day: '2026-12-01' })).toEqual({});
  expect(state.updates).toEqual([{ table: 'installations', values: { scheduled_at: '2026-12-01T14:00:00-03:00' } }]);
});

test('compromisso avulso desloca o fim e aceita nome livre como responsável', async () => {
  state.replies = {
    operational_events: row({ starts_at: '2026-11-20T11:00:00+00:00', ends_at: '2026-11-20T13:00:00+00:00' }),
    'operational_events:update': ok({ id }), profiles: ok([]),
  };
  expect(await moveAgendaEvent({ id, source: 'operational_events', day: '2026-11-21', person: 'Charles e Leo' })).toEqual({});
  expect(state.updates[0].values).toEqual({
    starts_at: '2026-11-21T08:00:00-03:00', ends_at: '2026-11-21T13:00:00.000Z',
    responsible_id: null, responsible_name: 'Charles e Leo',
  });
});

test('instalação exige funcionário cadastrado', async () => {
  state.replies = { installations: row({ scheduled_at: '2026-11-20T17:00:00+00:00' }), profiles: ok([]) };
  expect((await moveAgendaEvent({ id, source: 'installations', person: 'Charles e Leo' })).error).toContain('cadastrado');
  expect(state.updates).toEqual([]);
});

test('sem permissão (RLS não devolve a linha) vira erro', async () => {
  state.replies = { tasks: ok({ id, status: 'pendente', due_at: '2026-11-20T11:00:00+00:00', assigned_to: null }), 'tasks:update': { data: null, error: { code: 'PGRST116' } } };
  expect((await moveAgendaEvent({ id, source: 'tasks', day: '2026-12-01' })).error).toContain('Sem permissão');
});

test('concluído não pode ser movido', async () => {
  state.replies = { measurements: row({ status: 'medicao_concluida', scheduled_at: '2026-11-20T11:00:00+00:00' }) };
  expect((await moveAgendaEvent({ id, source: 'measurements', day: '2026-12-01' })).error).toContain('concluído');
  expect(state.updates).toEqual([]);
});

test('visita de um Serviço é reagendada pela função do Serviço', async () => {
  state.replies = {
    operational_events: row({ starts_at: '2026-11-20T11:00:00+00:00', ends_at: null, notes: 'levar escada' }),
    service_orders: ok({ id: 'servico' }),
  };
  expect(await moveAgendaEvent({ id, source: 'operational_events', day: '2026-12-01' })).toEqual({});
  expect(state.rpc).toHaveBeenCalledWith('service_schedule', { p_id: 'servico', p_at: '2026-12-01T08:00:00-03:00', p_responsible: null, p_notes: 'levar escada' });
  expect(state.updates).toEqual([]);
});

test('conferência de medidas é reagendada pelo pedido', async () => {
  state.replies = {
    operational_events: row({ starts_at: '2026-11-20T11:00:00+00:00', ends_at: null, notes: null }),
    order_measure_checks: ok({ order_id: 'pedido' }),
  };
  expect(await moveAgendaEvent({ id, source: 'operational_events', day: '2026-12-01' })).toEqual({});
  expect(state.rpc).toHaveBeenCalledWith('order_schedule_measure_check', { p_order_id: 'pedido', p_at: '2026-12-01T08:00:00-03:00', p_responsible: null, p_notes: null });
});
