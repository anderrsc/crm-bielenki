// Fluxo da Ana de ponta a ponta com banco e WhatsApp simulados.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const aiReply = vi.fn();
// Tabelas em que a próxima gravação falha (simula o banco fora do ar).
const failInsert = new Set<string>();

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let joinCompany = false;
  let pending: { kind: 'insert' | 'update' | 'upsert' | 'delete'; data: Row } | null = null;
  const rows = () => (tables[table] ??= []).filter(r => filters.every(([k, v]) => (r[k]??null) === (v??null)))
    .map(r => joinCompany ? { ...r, company: (tables.companies ?? []).find(c => c.id === r.company_id) } : r);
  const run = () => {
    if (pending?.kind === 'insert' || pending?.kind === 'upsert') {
      if(pending.kind==='upsert' && table==='whatsapp_webhook_events' && (tables[table]??[]).some(r=>r.provider===pending!.data.provider&&r.event_id===pending!.data.event_id))return [];
      const row:Row = { id: `${table}-${(tables[table] ??= []).length + 1}`, ...pending.data };
      if(table==='messages')row.channel_id=(tables.conversations??[]).find(c=>c.id===row.conversation_id)?.channel_id??null;
      tables[table].push(row); return [row];
    }
    if (pending?.kind === 'delete') { const keep = (tables[table] ??= []).filter(r => !filters.every(([k, v]) => (r[k]??null) === (v??null))); const gone = tables[table].length - keep.length; tables[table] = keep; return Array(gone).fill({}); }
    if (pending?.kind === 'update') { const hit = (tables[table] ??= []).filter(r => filters.every(([k, v]) => (r[k]??null) === (v??null))); hit.forEach(r => Object.assign(r, pending!.data)); return hit; }
    return rows();
  };
  const api: Record<string, unknown> = {
    select: (cols?: string) => { if (cols?.includes('company:companies')) joinCompany = true; return api; },
    order: () => api, limit: () => api, or: () => api, gte: () => api, not: () => api, in: () => api, is: (k: string, v: unknown) => { filters.push([k, v]); return api; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return api; },
    insert: (data: Row) => { pending = { kind: 'insert', data }; return api; },
    upsert: (data: Row) => { pending = { kind: 'upsert', data }; return api; },
    update: (data: Row) => { pending = { kind: 'update', data }; return api; },
    delete: () => { pending = { kind: 'delete', data: {} }; return api; },
    single: async () => { if (pending?.kind === 'insert' && failInsert.has(table)) return { data: null, error: { message: 'banco fora do ar' } }; const r = run(); return { data: r[0] ?? null, error: r[0] ? null : { message: 'none' } }; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok),
  };
  return api;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => query(t), rpc: async (name: string, p: Record<string, unknown>) => {
 if (name === 'link_whatsapp_lid') { (tables.whatsapp_lid_map ??= []).push({ company_id: p.p_company, lid: p.p_lid, phone: p.p_phone }); return { error: null }; }
 if (name === 'claim_ai_reply') {
  const cfg = (tables.ai_agent_config ?? []).find((c: any) => c.company_id === p.p_company);
  const c = (tables.conversations ?? []).find((c: any) => c.id === p.p_conversation && c.company_id === p.p_company);
  if (!cfg?.active || !c || !p.p_generation || c.ai_generation_id !== p.p_generation || c.ai_paused || c.client_id) return { data: false, error: null };
  c.ai_generation_id = null; return { data: true, error: null };
 }
 if (name !== 'inbox_receive') return { error: null };
 const c = tables.conversations.find(c => c.id === p.p_id && c.company_id === p.p_company)!;
 Object.assign(c, { unread_count: Number(c.unread_count ?? 0) + (p.p_historical ? 0 : 1), ai_generation_id: p.p_generation, last_message_at: p.p_at, last_inbound_at: p.p_at, last_message_preview: p.p_preview });
 return { error: null };
} }) }));
vi.mock('@/lib/ai/chat', async (orig) => ({ ...(await orig<object>()), aiChat: (...a: unknown[]) => aiReply(...a) }));
// after() do Next: guarda o trabalho para rodar "depois da resposta" quando o teste pedir.
const deferred = vi.hoisted(() => ({ on: false, jobs: [] as Array<() => Promise<unknown>> }));
vi.mock('next/server', async (orig) => {
  const real = await orig<typeof import('next/server')>();
  return { ...real, after: (fn: () => Promise<unknown>) => { if (!deferred.on) return real.after(fn); deferred.jobs.push(fn); } };
});

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
afterEach(() => { vi.unstubAllGlobals(); aiReply.mockReset(); failInsert.clear(); deferred.on = false; deferred.jobs.length = 0; });

describe('webhook WhatsApp (Meta)', () => {
  test('lote com duas mensagens grava as duas', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi!', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PNID' }, messages: [
      { timestamp: Math.floor(Date.now()/1000), id: 'b1', from: '5547999990000', type: 'text', text: { body: 'primeira' } },
      { timestamp: Math.floor(Date.now()/1000), id: 'b2', from: '5547999990001', type: 'text', text: { body: 'segunda' } },
    ] } }] }] });
    const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(new Request('https://crm.test/api/whatsapp/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': sig } }) as never);
    expect((await res.json()).count).toBe(2);
    expect(tables.messages.filter(m => m.direction === 'inbound').map(m => m.body)).toEqual(['primeira', 'segunda']);
  });

  test('falha no meio libera a trava: o reenvio do provedor e processado', async () => {
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    tables.companies = [];
    const original = tables.ai_agent_config;
    tables.ai_agent_config = null as never;
    Object.defineProperty(tables, 'ai_agent_config', { configurable: true, get() { throw new Error('banco fora'); } });
    const res = await POST(metaRequest('Oi', 'retry1') as never);
    expect(res.status).toBe(500);
    expect((tables.whatsapp_webhook_events ?? [])).toHaveLength(0);
    Object.defineProperty(tables, 'ai_agent_config', { configurable: true, writable: true, value: original });
  });

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

  test('P10: mesmo ID nos dois números entra nos dois, citação isolada e reenvio não duplica',async()=>{
    const {encryptSecret}=await import('@/lib/encrypt');
    tables.ai_agent_config[0].active=false;
    tables.whatsapp_channels=['crm','crm-calha'].map((instance,i)=>({id:`canal-${i}`,company_id:'c1',provider:'evolution',instance,is_default:i===0,active:true,deleted_at:null,webhook_secret:encryptSecret(HOOK)}));
    const {POST}=await import('@/app/api/whatsapp/webhook/route');
    const request=(instance:string,text:string)=>new Request('https://crm.test/api/whatsapp/webhook',{method:'POST',headers:{'x-webhook-secret':HOOK},body:JSON.stringify({event:'messages.upsert',instance,data:msg('SAME-ID',text,{message:{extendedTextMessage:{text,contextInfo:{stanzaId:'ORIGINAL',quotedMessage:{conversation:text}}}}})})});
    for(const instance of ['crm','crm-calha'])expect((await POST(request(instance,instance) as never)).status).toBe(200);
    expect((await (await POST(request('crm','crm') as never)).json()).status).toBe('duplicate');
    expect(tables.messages).toHaveLength(2);
    expect(tables.messages.map(m=>[m.channel_id,m.external_id,m.quoted_preview])).toEqual([['canal-0','SAME-ID','crm'],['canal-1','SAME-ID','crm-calha']]);
    expect(tables.whatsapp_webhook_events).toHaveLength(2);
    expect(tables.conversations.map(c=>c.unread_count)).toEqual([1,1]);
    expect(sent).toHaveLength(0);
  });

  test('P10: reação e recibo com ID repetido atualizam só o número de origem',async()=>{
    const {encryptSecret}=await import('@/lib/encrypt');
    tables.whatsapp_channels=['crm','crm-calha'].map((instance,i)=>({id:`canal-${i}`,company_id:'c1',provider:'evolution',instance,is_default:i===0,active:true,deleted_at:null,webhook_secret:encryptSecret(HOOK)}));
    tables.messages=[0,1].map(i=>({id:`m${i}`,company_id:'c1',channel_id:`canal-${i}`,external_id:'TARGET',direction:'outbound',delivery_status:'enviada'}));
    const {POST}=await import('@/app/api/whatsapp/webhook/route');
    const request=(event:string,data:unknown)=>new Request('https://crm.test/api/whatsapp/webhook',{method:'POST',headers:{'x-webhook-secret':HOOK},body:JSON.stringify({event,instance:'crm-calha',data})});
    await POST(request('messages.upsert',msg('REACTION','',{message:{reactionMessage:{key:{id:'TARGET'},text:'👍'}}})) as never);
    await POST(request('messages.update',{key:{id:'TARGET',fromMe:true},status:'READ'}) as never);
    expect(tables.messages[0]).toMatchObject({delivery_status:'enviada'});
    expect(tables.messages[0].reaction_customer).toBeUndefined();
    expect(tables.messages[1]).toMatchObject({delivery_status:'lida',reaction_customer:'👍'});
    expect(sent).toHaveLength(0);
  });

  test('Lia roda depois de responder ao provedor: o webhook devolve antes da IA', async () => {
    deferred.on = true;
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi! Sou a Lia.', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo(msg('q1', 'Quero orçamento')) as never);
    expect((await res.json()).status).toBe('ai_queued');
    expect(tables.messages.find(m => m.external_id === 'q1')).toBeTruthy(); // já está no Atendimento
    expect(aiReply).not.toHaveBeenCalled();
    expect(deferred.jobs).toHaveLength(1);
    await deferred.jobs[0]();
    expect(sent.at(-1)?.body).toMatchObject({ text: 'Oi! Sou a Lia.' });
  });

  test('IA falhando depois da resposta ao provedor fica registrada na Central de IA', async () => {
    deferred.on = true;
    aiReply.mockImplementation(() => { throw new Error('quebrou'); });
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo(msg('q2', 'Quero orçamento')) as never);
    await deferred.jobs[0]();
    expect((tables.ai_decisions ?? []).some(d => d.decisao === 'falhou')).toBe(true);
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
    const messageTimestamp = Math.floor(Date.now() / 1000) - 86400;
    await POST(evo(msg('e4', '*Rose:*\nJá te mando o orçamento', { messageTimestamp }, { fromMe: true })) as never);
    expect(tables.messages.at(-1)).toMatchObject({ direction: 'outbound', author: 'equipe', sender_name: 'Rose', sent_at: new Date(messageTimestamp * 1000).toISOString() });
    expect(tables.conversations[0].ai_paused).toBe(true);
    expect(aiReply).not.toHaveBeenCalled();
  }, 10000);

  test('resposta da Lia sem confirmação (tempo esgotado) fica "desconhecido" e não é reenviada', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi! Sou a Lia.', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo(msg('t1', 'Quero orçamento')) as never);
    expect(calls).toBe(1);
    expect(tables.messages.find(m => m.author === 'ana')).toMatchObject({ delivery_status: 'desconhecido', external_id: null });
    expect(String(tables.messages.find(m => m.author === 'ana')?.error_message)).toMatch(/Confira no celular/);
  });

  test('falha ao gravar mensagem do celular libera a trava (o reenvio grava depois)', async () => {
    failInsert.add('messages');
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo(msg('f1', '*Rose:*\nJá vou', {}, { fromMe: true })) as never);
    expect(res.status).toBe(500);
    expect((tables.whatsapp_webhook_events ?? [])).toHaveLength(0);
    failInsert.clear();
    await POST(evo(msg('f1', '*Rose:*\nJá vou', {}, { fromMe: true })) as never);
    expect(tables.messages.filter(m => m.external_id === 'f1')).toHaveLength(1);
  }, 20000);

  test('reação do cliente marca a mensagem reagida e não vira mensagem nova nem chama a Lia', async () => {
    tables.conversations = [{ id: 'cv1', company_id: 'c1', channel: 'whatsapp', external_id: '5547999990000', ai_paused: false, unread_count: 0, client_id: null }];
    tables.messages = [{ id: 'm1', company_id: 'c1', conversation_id: 'cv1', direction: 'outbound', author: 'equipe', external_id: 'alvo', body: 'Segue o orçamento' }];
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo({ ...msg('rx1', ''), message: { reactionMessage: { key: { id: 'alvo' }, text: '👍' } } }) as never);
    expect((await res.json()).status).toBe('reaction');
    expect(tables.messages).toHaveLength(1);
    expect(tables.messages[0].reaction_customer).toBe('👍');
    expect(tables.conversations[0].unread_count).toBe(0);
    expect(aiReply).not.toHaveBeenCalled();
  });

  test('resposta citando outra mensagem guarda o trecho citado', async () => {
    tables.clients = [{ id: 'cli1', company_id: 'c1', name: 'Carlos', phone: '(47) 99999-0000' }];
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo({ ...msg('cq1', ''), message: { extendedTextMessage: { text: 'Pode ser branca', contextInfo: { stanzaId: 'orig1', quotedMessage: { conversation: 'Qual a cor?' } } } } }) as never);
    expect(tables.messages.find(m => m.external_id === 'cq1')).toMatchObject({ body: 'Pode ser branca', quoted_external_id: 'orig1', quoted_preview: 'Qual a cor?' });
  });

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

  test('contato "@lid" sem numero entra no Atendimento e a resposta vai para o lid', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi!', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    const res = await POST(evo(msg('e6b', 'Bom dia, quero um orçamento', {}, { remoteJid: '987654321012345@lid' })) as never);
    expect(res.status).toBe(200);
    expect(tables.conversations[0].external_id).toBe('987654321012345@lid');
    expect(tables.messages.filter(m => m.direction === 'inbound').map(m => m.body)).toEqual(['Bom dia, quero um orçamento']);
    expect(sent[0].body).toMatchObject({ number: '987654321012345@lid' });
  });

  test('lid ja ligado a um numero usa o numero', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Oi!', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo(msg('e6c', 'Oi', {}, { remoteJid: '111222333@lid', senderPn: '5547911112222@s.whatsapp.net' })) as never);
    await POST(evo(msg('e6d', 'De novo', {}, { remoteJid: '111222333@lid' })) as never);
    expect(tables.whatsapp_lid_map).toEqual([expect.objectContaining({ lid: '111222333@lid', phone: '5547911112222' })]);
    expect(new Set(tables.messages.filter(m => m.direction === 'inbound').map(m => tables.conversations.find(c => c.id === m.conversation_id)?.external_id))).toEqual(new Set(['5547911112222']));
  });

  describe('áudio do cliente', () => {
    const audio = (id: string) => msg(id, '', { message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } } });
    const aiOk = () => aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Claro, me conta o endereço?', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const route = (geminiStatus = 200) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body?: string }) => {
      if (url.includes('/chat/getBase64FromMediaMessage/')) return new Response(JSON.stringify({ base64: 'QUJD', mimetype: 'audio/ogg; codecs=opus' }), { status: 200 });
      if (url.includes('generativelanguage.googleapis.com')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Quero um orçamento de calha para a minha casa' }] } }] }), { status: geminiStatus });
      sent.push({ url, body: JSON.parse(init.body ?? '{}') });
      return new Response('{}', { status: 200 });
    }));
    const lastUserText = () => String((aiReply.mock.calls.at(-1)?.[0] as { messages?: Array<{ role: string; content: string }> } | undefined)?.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? JSON.stringify(aiReply.mock.calls.at(-1)));

    test('com chave do Gemini: transcreve, a Lia responde ao conteúdo e a equipe vê o texto', async () => {
      const { encryptSecret } = await import('@/lib/encrypt');
      tables.ai_agent_config[0].gemini_api_key = encryptSecret('gemini-key');
      route(); aiOk(); aiReply.mockClear(); aiOk();
      const { POST } = await import('@/app/api/whatsapp/webhook/route');
      expect((await (await POST(evo(audio('a1')) as never)).json()).status).toBe('ok');
      expect(lastUserText()).toContain('[áudio] Quero um orçamento de calha para a minha casa');
      expect((tables.messages ?? []).find((m) => m.external_id === 'a1')?.body).toBe('[áudio] Quero um orçamento de calha para a minha casa');
    });

    test('sem chave (ou falha): a IA recebe só "[áudio]", a falha é registrada e nada é inventado', async () => {
      route(); aiReply.mockClear(); aiOk();
      const { POST } = await import('@/app/api/whatsapp/webhook/route');
      await POST(evo(audio('a2')) as never);
      expect(lastUserText()).not.toContain('orçamento de calha');
      expect((tables.messages ?? []).find((m) => m.external_id === 'a2')?.body).toBe('[áudio]');
      expect((tables.ai_decisions ?? []).some((d) => d.decisao === 'falhou' && String(d.motivo).includes('Áudio não transcrito'))).toBe(true);
    });
  });

  test('cliente que pede para parar fica marcado e nenhuma automação escreve para ele', async () => {
    aiReply.mockResolvedValue(JSON.stringify({ mensagem: 'Tudo bem, obrigada.', dados_coletados: {}, triagem_concluida: false, tipo_atendimento: 'comercial' }));
    const { POST } = await import('@/app/api/whatsapp/webhook/route');
    await POST(evo(msg('o1', 'Não tenho interesse, pode parar de mandar mensagem')) as never);
    expect(tables.conversations[0].ai_opt_out).toBe(true);
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
