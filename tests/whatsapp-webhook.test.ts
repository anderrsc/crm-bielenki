// Fluxo da Ana de ponta a ponta com banco e WhatsApp simulados.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const aiReply = vi.fn();

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let joinCompany = false;
  let pending: { kind: 'insert' | 'update' | 'upsert'; data: Row } | null = null;
  const rows = () => (tables[table] ??= []).filter(r => filters.every(([k, v]) => r[k] === v))
    .map(r => joinCompany ? { ...r, company: (tables.companies ?? []).find(c => c.id === r.company_id) } : r);
  const run = () => {
    if (pending?.kind === 'insert' || pending?.kind === 'upsert') {
      const row = { id: `${table}-${(tables[table] ??= []).length + 1}`, ...pending.data };
      tables[table].push(row); return [row];
    }
    if (pending?.kind === 'update') { const hit = (tables[table] ??= []).filter(r => filters.every(([k, v]) => r[k] === v)); hit.forEach(r => Object.assign(r, pending!.data)); return hit; }
    return rows();
  };
  const api: Record<string, unknown> = {
    select: (cols?: string) => { if (cols?.includes('company:companies')) joinCompany = true; return api; },
    order: () => api, limit: () => api, or: () => api, gte: () => api, not: () => api, in: () => api,
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

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => query(t), rpc: async (_name: string, p: Record<string, unknown>) => {
 const c = tables.conversations.find(c => c.id === p.p_id && c.company_id === p.p_company)!;
 Object.assign(c, { unread_count: Number(c.unread_count ?? 0) + (p.p_historical ? 0 : 1), ai_generation_id: p.p_generation, last_message_at: p.p_at, last_inbound_at: p.p_at, last_message_preview: p.p_preview });
 return { error: null };
} }) }));
vi.mock('@/lib/ai/chat', async (orig) => ({ ...(await orig<object>()), aiChat: (...a: unknown[]) => aiReply(...a) }));

const SECRET = 'app-secret';
const sent: Array<{ url: string; body: { to: string; text: { body: string } } }> = [];

function metaRequest(text: string, id: string) {
  const body = JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'PNID' },
    messages: [{ timestamp: Math.floor(Date.now()/1000), id, from: '5547999990000', type: 'text', text: { body: text } }],
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

  test('nome inventado não é enviado nem salvo e não contamina a próxima resposta', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Bom dia, Anderson! Aqui é a Lia.', dados_coletados: { nome: 'Anderson' }, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(metaRequest('Bom dia', 'identity1') as never);
    expect(sent[0].body.text.body).toBe('Bom dia! Aqui é a Lia.');
    expect(tables.triage_sessions[0].nome).toBeNull();
    expect(tables.triage_sessions[0].dados_coletados).not.toHaveProperty('nome');
    expect(JSON.stringify(tables.triage_sessions[0].messages)).not.toContain('Anderson');
    // Simula também um nome incorreto já armazenado antes da correção.
    tables.triage_sessions[0].dados_coletados = { nome: 'Anderson' };
    tables.triage_sessions[0].nome = 'Anderson';
    await POST(metaRequest('Quero uma calha', 'identity2') as never);
    expect(tables.triage_sessions[0].nome).toBeNull();
    const call = aiReply.mock.calls.at(-1)![0];
    expect(call.messages[0].content).toContain('IDENTIDADE DO CLIENTE');
    expect(call.messages[0].content).not.toContain('"nome":"Anderson"');
  });

  test('orçamento existente encaminha todas as dúvidas sem reiniciar identificação', async () => {
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const text = 'Jean, Jaraguá do Sul. Referente a este orçamento que vc fez para nós: todo material é alumínio? Inclui o galpão todo? Fixações com bucha e parafuso? Quantas saídas e qual diâmetro? Pode incluir contrarufo?';
    const res = await POST(metaRequest(text, 'quote1') as never);
    expect((await res.json()).triagem_concluida).toBe(true);
    expect(aiReply).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.text.body).not.toMatch(/qual.*(?:nome|cidade|serviço)/i);
    expect(tables.triage_sessions[0].resumo_executivo).toContain(text);
    expect(tables.conversations[0].ai_paused).toBe(true);
  });

  test('nova sessão recupera a dúvida do Atendimento quando cliente aponta mensagens acima', async () => {
    tables.conversations = [{ id: 'cv1', company_id: 'c1', channel: 'whatsapp', external_id: '5547999990000', ai_paused: false }];
    tables.messages = [{ id: 'old1', company_id: 'c1', conversation_id: 'cv1', direction: 'inbound', body: 'Quero confirmar os itens desse orçamento, inclusive as saídas de água.', external_id: 'old-event', sent_at: '2026-11-10T10:00:00Z' }];
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(metaRequest('Está descrito nas mensagens acima', 'quote2') as never);
    expect(aiReply).not.toHaveBeenCalled();
    expect(tables.triage_sessions[0].resumo_executivo).toContain('saídas de água');
    expect(tables.triage_sessions[0].resumo_executivo).toContain('mensagens acima');
    expect(tables.conversations[0].ai_paused).toBe(true);
  });

  test('triagem concluida cria lead com o telefone do WhatsApp', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Registrado!', dados_coletados: { nome: 'João' }, triagem_concluida: true, tipo_atendimento: 'comercial', score: 80, prioridade: 'alta' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(metaRequest('Sou o João', 'm2') as never);
    expect(tables.leads[0]).toMatchObject({ name: 'João', phone: '5547999990000', source: 'WhatsApp' });
  });

  test('falha da IA não manda mensagem pronta e guarda o motivo', async () => {
    aiReply.mockRejectedValue(new Error('429'));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(metaRequest('Oi', 'm3') as never);
    expect((await res.json()).status).toBe('ai_failed_team_notified');
    expect(sent).toHaveLength(0);
    expect(aiReply).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tables.triage_sessions[0].messages)).toContain('Oi');
    expect(JSON.stringify(tables.triage_sessions[0].messages)).toContain('[IA falhou]');
  });

  test('grava a conversa no Atendimento com o nome de quem escreveu', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi! Sou a Ana.', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(metaRequest('Oi', 'm4') as never);
    expect(tables.conversations[0]).toMatchObject({ external_id: '5547999990000', unread_count: 1, last_message_preview: 'Oi! Sou a Ana.' });
    expect(tables.messages.map(m => [m.author, m.sender_name, m.body])).toEqual([['cliente', null, 'Oi'], ['ana', 'Lia', 'Oi! Sou a Ana.']]);
  });

  test('conversa assumida pela equipe: Ana não responde', async () => {
    tables.conversations = [{ id: 'cv1', company_id: 'c1', channel: 'whatsapp', external_id: '5547999990000', ai_paused: true, unread_count: 2, client_id: 'x' }];
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(metaRequest('Alguém aí?', 'm5') as never);
    expect((await res.json()).status).toBe('human_handling');
    expect(aiReply).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(tables.conversations[0].unread_count).toBe(3);
  });

  test('triagem concluída passa a conversa para a equipe', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Registrado!', dados_coletados: { nome: 'João' }, triagem_concluida: true, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(metaRequest('Sou o João', 'm6') as never);
    expect(tables.conversations[0].ai_paused).toBe(true);
  });
});

describe('webhook WhatsApp (Evolution, número atual da empresa)', () => {
  const HOOK = 'segredo-do-webhook';
  function evo(data: Record<string, unknown>, secret = HOOK) {
    const body = JSON.stringify({ event: 'messages.upsert', instance: 'crm', data });
    return new Request('https://crm.test/api/whatsapp/webhook', { method: 'POST', body, headers: { 'x-webhook-secret': secret } });
  }
  const msg = (id: string, text: string, extra: Record<string, unknown> = {}, key: Record<string, unknown> = {}) =>
    ({ messageTimestamp: Math.floor(Date.now()/1000), key: { id, remoteJid: '5547999990000@s.whatsapp.net', fromMe: false, ...key }, pushName: 'Carlos', message: { conversation: text }, ...extra });

  beforeEach(async () => {
    const { encryptSecret } = await import('@/lib/encrypt');
    Object.assign(tables.ai_agent_config[0], {
      wpp_provider: 'evolution', evolution_instance: 'crm', evolution_api_url: 'https://1-2-3-4.sslip.io',
      evolution_api_key: encryptSecret('chave'), evolution_webhook_secret: encryptSecret(HOOK),
    });
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
  });

  test('contato novo: Ana responde pela Evolution', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi! Sou a Ana.', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo(msg('e1', 'Quero orçamento')) as never);
    expect((await res.json()).status).toBe('ok');
    expect(sent[0].url).toBe('https://1-2-3-4.sslip.io/message/sendText/crm');
    expect(sent[0].body).toMatchObject({ number: '5547999990000', text: 'Oi! Sou a Ana.' });
  });

  test('segredo errado é recusado', async () => {
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo(msg('e2', 'Oi'), 'outro-segredo-qualquer') as never);
    expect(res.status).toBe(401);
  });

  test('cliente já cadastrado: Ana não responde', async () => {
    tables.clients = [{ id: 'cli1', company_id: 'c1', name: 'Carlos', phone: '(47) 99999-0000' }];
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo(msg('e3', 'Bom dia')) as never);
    expect((await res.json()).status).toBe('known_client');
    expect(aiReply).not.toHaveBeenCalled();
    expect(tables.messages[0]).toMatchObject({ author: 'cliente', body: 'Bom dia' });
  });

  test('resposta da Rose pelo celular entra no Atendimento e pausa a Ana', async () => {
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo(msg('e4', '*Rose:*\nJá te mando o orçamento', {}, { fromMe: true })) as never);
    expect(tables.messages.at(-1)).toMatchObject({ direction: 'outbound', author: 'equipe', sender_name: 'Rose' });
    expect(tables.conversations[0].ai_paused).toBe(true);
    expect(aiReply).not.toHaveBeenCalled();
  }, 10000);

  test('eco da mensagem que a Ana mandou é ignorado', async () => {
    tables.conversations = [{ id: 'cv1', company_id: 'c1', channel: 'whatsapp', external_id: '5547999990000', ai_paused: false, unread_count: 0, client_id: null }];
    tables.messages = [{ id: 'm1', company_id: 'c1', conversation_id: 'cv1', direction: 'outbound', author: 'ana', external_id: 'e5', body: 'Oi!' }];
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo(msg('e5', 'Oi!', {}, { fromMe: true })) as never);
    expect(tables.messages).toHaveLength(1);
    expect(tables.conversations[0].ai_paused).toBe(false);
  });

  test('contato "@lid" usa o número real', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi!', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo(msg('e6', 'Oi', {}, { remoteJid: '123456789@lid', senderPn: '5547988887777@s.whatsapp.net' })) as never);
    expect(tables.conversations[0].external_id).toBe('5547988887777');
    expect(sent[0].body).toMatchObject({ number: '5547988887777' });
  });

  test('grupo é ignorado', async () => {
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo(msg('e7', 'Oi', {}, { remoteJid: '1203@g.us' })) as never);
    expect((await res.json()).status).toBe('ignored_group');
  });
});

describe('proteções durante geração', () => {
 test('pausa global durante a geração cancela o envio', async () => {
   aiReply.mockImplementation(async () => { tables.ai_agent_config[0].active = false; return JSON.stringify({ mensagem: 'Não deve sair', dados_coletados: {} }); });
   const { POST } = await import('@/app/api/whatsapp/webhook/route');
   const r = await POST(metaRequest('Oi', 'pause-global') as never);
   expect((await r.json()).status).toBe('reply_cancelled');
   expect(sent).toHaveLength(0);
 });
 test('humano assume durante geração: não envia', async () => {
   aiReply.mockImplementation(async () => { tables.conversations[0].ai_paused = true; return JSON.stringify({ mensagem: 'Não deve sair', dados_coletados: {} }); });
   const { POST } = await import('@/app/api/whatsapp/webhook/route');
   await POST(metaRequest('Oi', 'pause-local') as never);
   expect(sent).toHaveLength(0);
 });
 test('nova mensagem invalida resposta ainda sendo gerada', async () => {
   aiReply.mockImplementation(async () => { tables.conversations[0].ai_generation_id = 'new-generation'; return JSON.stringify({ mensagem: 'Obsoleta', dados_coletados: {} }); });
   const { POST } = await import('@/app/api/whatsapp/webhook/route');
   await POST(metaRequest('Oi', 'obsolete') as never);
   expect(sent).toHaveLength(0);
 });
 test('mensagem antiga entra no histórico sem acionar IA', async () => {
   const original = metaRequest('Mensagem de ontem', 'old');
   const payload = JSON.parse(await original.text());
   payload.entry[0].changes[0].value.messages[0].timestamp = Math.floor(Date.now()/1000)-86400;
   const body = JSON.stringify(payload);
   const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
   const { POST } = await import('@/app/api/whatsapp/webhook/route');
   const r = await POST(new Request('https://crm.test/api/whatsapp/webhook', {method:'POST',body,headers:{'x-hub-signature-256':sig}}) as never);
   expect((await r.json()).status).toBe('history_only');
   expect(aiReply).not.toHaveBeenCalled(); expect(sent).toHaveLength(0);
   expect(tables.conversations[0].unread_count).toBe(0);
   expect(tables.messages[0].sent_at).toBe(new Date(payload.entry[0].changes[0].value.messages[0].timestamp*1000).toISOString());
 });
});
