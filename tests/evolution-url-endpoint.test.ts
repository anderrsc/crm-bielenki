import { beforeEach, describe, expect, test, vi } from 'vitest';

const rows: Record<string, unknown>[] = [];
const ensure = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => {
  const f: Array<[string, unknown]> = []; let upd: Record<string, unknown> | null = null;
  const q: Record<string, unknown> = {
    select: () => q, eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
    update: (d: Record<string, unknown>) => { upd = d; return q; },
    maybeSingle: async () => ({ data: rows.find(r => f.every(([k, v]) => r[k] === v)) ?? null }),
    then: (ok: (v: unknown) => unknown) => { if (upd) rows.filter(r => f.every(([k, v]) => r[k] === v)).forEach(r => Object.assign(r, upd)); return Promise.resolve({ error: null }).then(ok); },
  }; return q; } }) }));
vi.mock('@/lib/whatsapp/evolution', async (o) => ({ ...(await o<object>()), ensureEvolutionInstance: (...a: unknown[]) => ensure(...a) }));

async function call(body: unknown, secret: string) {
  const { POST } = await import('@/app/api/whatsapp/evolution-url/route');
  const { NextRequest } = await import('next/server');
  return POST(new NextRequest('https://crm.test/api/whatsapp/evolution-url', { method: 'POST', body: JSON.stringify(body), headers: { 'x-webhook-secret': secret } }));
}

describe('PC avisa o endereço do túnel', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
    const { encryptSecret } = await import('@/lib/encrypt');
    rows.length = 0; ensure.mockReset();
    rows.push({ company_id: 'c1', evolution_instance: 'crm', evolution_api_key: encryptSecret('a'.repeat(64)), evolution_webhook_secret: encryptSecret('segredo'), evolution_api_url: null });
  });
  test('grava o endereço e liga a instância', async () => {
    const r = await call({ instance: 'crm', url: 'https://abc-def.trycloudflare.com' }, 'segredo');
    expect(await r.json()).toEqual({ status: 'updated', linked: true });
    expect(rows[0]).toMatchObject({ evolution_api_url: 'https://abc-def.trycloudflare.com', wpp_provider: 'evolution' });
    expect(ensure.mock.calls[0][3]).toBe('https://crm.test/api/whatsapp/webhook');
  });
  test('segredo errado ou endereço de fora são recusados', async () => {
    expect((await call({ instance: 'crm', url: 'https://abc.trycloudflare.com' }, 'errado')).status).toBe(401);
    expect((await call({ instance: 'crm', url: 'https://evil.com' }, 'segredo')).status).toBe(400);
    expect(rows[0].evolution_api_url).toBeNull();
  });
  test('mesmo endereço tenta reconectar quando a tentativa anterior falhou', async () => {
    rows[0].evolution_api_url = 'https://abc.trycloudflare.com';
    expect(await (await call({ instance: 'crm', url: 'https://abc.trycloudflare.com' }, 'segredo')).json()).toEqual({ status: 'unchanged' });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.calls[0][0]).toBe('https://abc.trycloudflare.com');
  });

  test('nova URL salva, mas falha de ligação pode ser recuperada com repetição', async () => {
    ensure.mockRejectedValueOnce(new Error('servidor inicializando'));
    const first = await call({ instance: 'crm', url: 'https://abc.trycloudflare.com' }, 'segredo');
    expect(await first.json()).toEqual({ status: 'updated', linked: false });
    const retry = await call({ instance: 'crm', url: 'https://abc.trycloudflare.com' }, 'segredo');
    expect(await retry.json()).toEqual({ status: 'unchanged', linked: true });
    expect(ensure).toHaveBeenCalledTimes(2);
  });
});
