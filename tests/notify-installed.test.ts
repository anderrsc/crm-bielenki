import { afterEach, beforeEach, expect, test, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = { order: null as Row | null, updates: [] as Row[], sent: [] as string[], recorded: [] as Row[], fail: false };
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => {
  let update: Row | null = null; let wantNull = false;
  const q: any = {
    update: (v: Row) => { update = v; return q; }, eq: () => q, select: () => q,
    is: () => { wantNull = true; return q; },
    maybeSingle: async () => ({ data: table === 'ai_agent_config' ? { wpp_provider: 'evolution', evolution_api_url: 'https://evo.test', evolution_instance: 'crm', evolution_api_key: '' } : null }),
    single: async () => ({ data: { name: 'Marquinhos', trade_name: 'Marquinhos Calhas' } }),
    then: (ok: (v: unknown) => unknown) => {
      if (table === 'orders' && update) {
        state.updates.push(update);
        if (wantNull) { const free = state.order && !state.order.install_notified_at; if (free) state.order!.install_notified_at = update.install_notified_at; return Promise.resolve({ data: free ? [state.order] : [] }).then(ok); }
        if (state.order) state.order.install_notified_at = update.install_notified_at;
      }
      return Promise.resolve({ data: [] }).then(ok);
    },
  };
  return q;
} }) }));
vi.mock('@/lib/whatsapp/send', async (orig) => ({ ...(await orig<object>()), sendWhatsAppText: async (_c: unknown, to: string) => { if (state.fail) throw new Error('fora do ar'); state.sent.push(to); return 'wamid'; } }));
vi.mock('@/lib/whatsapp/inbox-store', () => ({ getOrCreateConversation: async () => ({ id: 'conv' }), recordOutbound: async (_db: unknown, p: Row) => { state.recorded.push(p); } }));

import { installedMessage, notifyInstalled } from '@/lib/whatsapp/notify-installed';
const ID = '00000000-0000-4000-8000-0000000000aa';
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  Object.assign(state, { order: { id: ID, company_id: 'c1', install_notified_at: null, client: { name: 'João da Silva', phone: '(47) 99999-0000' } }, updates: [], sent: [], recorded: [], fail: false });
});
afterEach(() => vi.unstubAllEnvs());

test('avisa uma unica vez, com o primeiro nome e registro no Atendimento', async () => {
  expect(await notifyInstalled(ID)).toBe('sent');
  expect(state.sent).toEqual(['5547999990000']);
  expect(String(state.recorded[0].body)).toContain('Olá, João!');
  expect(state.recorded[0].author).toBe('automacao');
  expect(await notifyInstalled(ID)).toBe('skipped');
  expect(state.sent).toHaveLength(1);
});

test('falha no envio libera para tentar de novo e fica registrada', async () => {
  state.fail = true;
  expect(await notifyInstalled(ID)).toBe('failed');
  expect(state.order!.install_notified_at).toBeNull();
  expect(state.recorded[0].deliveryStatus).toBe('falhou');
});

test('cliente sem telefone nao recebe e nao trava', async () => {
  state.order!.client = { name: 'Sem Fone', phone: null };
  expect(await notifyInstalled(ID)).toBe('skipped');
  expect(state.sent).toHaveLength(0);
  expect(installedMessage(null, 'Marquinhos')).toContain('Olá! Aqui é da Marquinhos');
});
