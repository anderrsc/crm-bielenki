import { beforeEach, describe, expect, test, vi } from 'vitest';
import { updateIncomingRead } from '@/lib/whatsapp/delivery';

type Row = Record<string, any>;
const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, hook: null as null | (() => void), read: vi.fn(), unread: vi.fn() }));
const conversationId = '10000000-0000-4000-8000-000000000001';
const messageId = '10000000-0000-4000-8000-000000000002';
function database() {
  return { auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from: (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let update: Row | null = null;
    let limit = Infinity;
    const run = () => {
      if (update && table === 'conversations' && fixture.hook) { const hook = fixture.hook; fixture.hook = null; hook(); }
      const rows = (fixture.tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(0, limit);
      if (update) rows.forEach(r => Object.assign(r, update));
      return { data: rows, error: null };
    };
    const q: any = {
      select: () => q, order: () => q,
      limit: (n: number) => { limit = n; return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => r[k] == v); return q; },
      in: (k: string, values: unknown[]) => { filters.push(r => values.includes(r[k])); return q; },
      not: (k: string, _op: string, value: unknown) => { filters.push(r => r[k] !== value); return q; },
      // "col.is.null,col.lt.valor": basta uma das condições.
      or: (expr: string) => { const parts = expr.split(',').map(p => { const [k, op, ...v] = p.split('.'); const value = v.join('.'); return (r: Row) => op === 'is' ? r[k] == null : op === 'lt' ? r[k] != null && r[k] < value : op === 'lte' ? r[k] != null && r[k] <= value : false; }); filters.push(r => parts.some(f => f(r))); return q; },
      gt: (k: string, v: any) => { filters.push(r => r[k] > v); return q; },
      gte: (k: string, v: any) => { filters.push(r => r[k] >= v); return q; },
      lte: (k: string, v: any) => { filters.push(r => r[k] <= v); return q; },
      update: (value: Row) => { update = value; return q; },
      single: async () => ({ data: run().data[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(run()).then(ok),
    };
    return q;
  } };
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => database() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/whatsapp/send', () => ({ markWhatsAppRead: fixture.read, markWhatsAppUnread: fixture.unread, whatsappCredentials: () => ({}), sendWhatsAppText: vi.fn() }));
import { markInboxRead, markConversationUnread } from '@/app/(crm)/atendimento-actions';

beforeEach(() => {
  fixture.hook = null;
  fixture.read.mockReset().mockResolvedValue(undefined);
  fixture.unread.mockReset().mockResolvedValue(undefined);
  fixture.tables = {
    profiles: [{ id: 'user', company_id: 'c1', full_name: 'Anderson' }],
    conversations: [{ id: conversationId, company_id: 'c1', unread_count: 1, ai_generation_id: 'generation-1', last_inbound_at: '2026-11-16T13:00:00Z', phone: '123456789@lid', ai_paused: true, assigned_to: 'user' }],
    messages: [{ id: messageId, company_id: 'c1', conversation_id: conversationId, external_id: 'wa-1', direction: 'inbound', sent_at: '2026-11-16T13:00:00Z', delivery_status: null }],
    ai_agent_config: [{ company_id: 'c1' }], companies: [{ id: 'c1' }],
  };
});
const snapshot = { count: 1, lastInbound: '2026-11-16T13:00:00Z', generation: 'generation-1' };
describe('marcação de leitura e retorno', () => {
  test('confirma no WhatsApp usando o identificador lid e limpa a contagem vista', async () => {
    const result = await markInboxRead(conversationId, [messageId], snapshot);
    expect(result).toMatchObject({ ok: true, cleared: true, receiptError: null });
    // Lida até a mensagem vista: atrasada mais antiga não volta a contar como não lida.
    expect(fixture.tables.conversations[0].read_through_at).toBe('2026-11-16T13:00:00.000Z');
    expect(fixture.read).toHaveBeenCalledWith({}, '123456789@lid', ['wa-1']);
    expect(fixture.tables.conversations[0].unread_count).toBe(0);
  });
  test('uma chegada com o mesmo horário, mas geração nova, não é apagada pela leitura anterior', async () => {
    fixture.hook = () => Object.assign(fixture.tables.conversations[0], { unread_count: 2, ai_generation_id: 'generation-2' });
    expect(await markInboxRead(conversationId, [messageId], snapshot)).toMatchObject({ cleared: false });
    expect(fixture.tables.conversations[0].unread_count).toBe(2);
  });
  test('falha no recibo conserva a leitura interna e informa que falta confirmar no celular', async () => {
    fixture.read.mockRejectedValue(new Error('offline'));
    expect(await markInboxRead(conversationId, [messageId], snapshot)).toMatchObject({ ok: true, cleared: true, receiptError: 'offline' });
  });
  test('não lida marca no celular e preserva mensagens novas, responsável e IA', async () => {
    fixture.tables.conversations[0].unread_count = 0;
    await markConversationUnread(conversationId);
    expect(fixture.tables.conversations[0]).toMatchObject({ unread_count: 1, ai_paused: true, assigned_to: 'user' });
    expect(fixture.unread).toHaveBeenCalledWith({}, '123456789@lid', 'wa-1');
    fixture.tables.conversations[0].unread_count = 7;
    await markConversationUnread(conversationId);
    expect(fixture.tables.conversations[0].unread_count).toBe(7);
  });
  test('uma empresa não marca a conversa da outra', async () => {
    fixture.tables.conversations[0].company_id = 'other';
    expect(await markConversationUnread(conversationId)).toHaveProperty('error');
    expect(fixture.unread).not.toHaveBeenCalled();
  });
});
describe('leitura recebida da Evolution', () => {
  test('READ recebido limpa apenas a conversa e mensagem confirmadas', async () => {
    await updateIncomingRead(database() as never, 'c1', 'wa-1', 'READ');
    expect(fixture.tables.messages[0].delivery_status).toBe('lida');
    expect(fixture.tables.conversations[0].unread_count).toBe(0);
    expect(fixture.tables.conversations[0].read_through_at).toBe('2026-11-16T13:00:00.000Z');
    // Recibo atrasado de uma mensagem mais antiga não faz a marca voltar.
    fixture.tables.messages.push({ ...fixture.tables.messages[0], id: 'old', external_id: 'wa-0', sent_at: '2026-11-16T12:00:00Z' });
    await updateIncomingRead(database() as never, 'c1', 'wa-0', 'READ');
    expect(fixture.tables.conversations[0].read_through_at).toBe('2026-11-16T13:00:00.000Z');
  });
  test('recibo velho ou de outra empresa não limpa uma mensagem nova', async () => {
    fixture.tables.messages.push({ ...fixture.tables.messages[0], id: 'new', external_id: 'wa-2', sent_at: '2026-11-16T13:01:00Z' });
    fixture.tables.conversations[0].unread_count = 2;
    await updateIncomingRead(database() as never, 'c1', 'wa-1', 'READ');
    await updateIncomingRead(database() as never, 'other', 'wa-2', 'READ');
    expect(fixture.tables.conversations[0].unread_count).toBe(2);
    expect(fixture.tables.messages[1].delivery_status).toBeNull();
  });
  test('chegada durante a confirmação não perde a contagem', async () => {
    fixture.hook = () => Object.assign(fixture.tables.conversations[0], { unread_count: 2, ai_generation_id: 'generation-2' });
    await updateIncomingRead(database() as never, 'c1', 'wa-1', 'READ');
    expect(fixture.tables.conversations[0].unread_count).toBe(2);
  });
});
