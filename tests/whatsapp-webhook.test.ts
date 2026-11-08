// Fluxo da Ana de ponta a ponta com banco e WhatsApp simulados.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const aiReply = vi.fn();

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let pending: { kind: 'insert' | 'update' | 'upsert'; data: Row } | null = null;
  const rows = () => (tables[table] ??= []).filter(r => filters.every(([k, v]) => r[k] === v));
  const run = () => {
    if (pending?.kind === 'insert' || pending?.kind === 'upsert') {
      const row = { id: `${table}-${(tables[table] ??= []).length + 1}`, ...pending.data };
      tables[table].push(row); return [row];
    }
    if (pending?.kind === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, pending!.data)); return hit; }
    return rows();
  };
  const api: Record<string, unknown> = {
    select: () => api, order: () => api, limit: () => api,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return api; },
    insert: (data: Row) => { pending = { kind: 'insert', data }; return api; },
    upsert: (data: Row) => { pending = { kind: 'upsert', data }; return api; },
    update: (data: Row) => { pending = { kind: 'update', data }; return api; },
    single: async () => { const r = run(); return { data: r[0] ?? null, error: r[0] ? null : { message: 'none' } }; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok),
  };
  return api;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => query(t) }) }));
vi.mock('@/lib/ai/chat', async (orig) => ({ ...(await orig<object>()), aiChat: (...a: unknown[]) => aiReply(...a) }));

const SECRET = 'app-secret';
const sent: Array<{ url: string; body: { to: string; text: { body: string } } }> = [];

function metaRequest(text: string, id: string) {
  const body = JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'PNID' },
    messages: [{ id, from: '5547999990000', type: 'text', text: { body: text } }],
  } }] }] });
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
  return new Request('https://crm.test/api/whatsapp/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } });
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.companies = [{ id: 'c1', name: 'Marquinhos', trade_name: 'Marquinhos Calhas e Esquadrias', whatsapp_phone_number_id: 'PNID' }];
  // Config como nasce no banco: modelo gpt-4o e wpp_provider "evolution".
  tables.ai_agent_config = [{ company_id: 'c1', active: true, agent_name: 'Ana', ai_provider: 'groq', groq_api_key: 'k', openai_model: 'gpt-4o', wpp_provider: 'evolution' }];
  tables.pipeline_stages = [{ id: 's1', company_id: 'c1', sort_order: 1 }];
  process.env.WHATSAPP_APP_SECRET = SECRET;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token';
  process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
  sent.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); aiReply.mockReset(); });

describe('webhook WhatsApp (Meta)', () => {
  test('primeira mensagem ja recebe resposta da IA pela Meta', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Olá! Sou a Ana. Qual seu nome?', dados_coletados: { tipo_servico: 'esquadrias' }, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(metaRequest('Quero orçamento de janela', 'm1') as never);
    expect((await res.json()).status).toBe('ok');
    const call = aiReply.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(call.messages.at(-1)!.content).toBe('Quero orçamento de janela');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain('graph.facebook.com/v23.0/PNID/messages');
    expect(sent[0].body.text.body).toBe('Olá! Sou a Ana. Qual seu nome?');
  });

  test('triagem concluida cria lead com o telefone do WhatsApp', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Registrado!', dados_coletados: { nome: 'João' }, triagem_concluida: true, tipo_atendimento: 'comercial', score: 80, prioridade: 'alta' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(metaRequest('Sou o João', 'm2') as never);
    expect(tables.leads[0]).toMatchObject({ name: 'João', phone: '5547999990000', source: 'WhatsApp' });
  });

  test('falha da IA avisa o cliente e guarda a mensagem', async () => {
    aiReply.mockRejectedValue(new Error('429'));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(metaRequest('Oi', 'm3') as never);
    expect((await res.json()).status).toBe('ai_failed_fallback_sent');
    expect(sent[0].body.text.body).toContain('alguém da nossa equipe');
    expect(JSON.stringify(tables.triage_sessions[0].messages)).toContain('Oi');
  });
});
