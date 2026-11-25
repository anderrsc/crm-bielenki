import { describe, expect, test, vi } from 'vitest';
import { evolutionJidPhone, evolutionMessageText, evolutionQuote, evolutionReaction } from '@/lib/whatsapp/message-text';
import { importHistoryPage, syncRecentEvolutionMessages } from '@/lib/whatsapp/evolution-history';

describe('texto das mensagens', () => {
  test('tipos comuns', () => {
    expect(evolutionMessageText({ conversation: 'Oi' }).text).toBe('Oi');
    expect(evolutionMessageText({ extendedTextMessage: { text: 'link' } }).text).toBe('link');
    expect(evolutionMessageText({ imageMessage: { caption: 'janela' } })).toEqual({ text: '[foto] janela', media: 'image' });
    expect(evolutionMessageText({ audioMessage: {} }).text).toBe('[áudio]');
    expect(evolutionMessageText({ documentMessage: { fileName: 'projeto.pdf' } }).text).toBe('[documento: projeto.pdf]');
    expect(evolutionMessageText({ ephemeralMessage: { message: { conversation: 'some' } } }).text).toBe('some');
    expect(evolutionMessageText({ protocolMessage: {} }).text).toBe('');
  });
  test('telefone do contato', () => {
    expect(evolutionJidPhone({ remoteJid: '5547999990000@s.whatsapp.net' })).toBe('5547999990000');
    expect(evolutionJidPhone({ remoteJid: '1@lid', remoteJidAlt: '5547988887777@s.whatsapp.net' })).toBe('5547988887777');
    expect(evolutionJidPhone({ remoteJid: '1203@g.us' })).toBeNull();
  });
});

test('mensagens de empresas (modelo, interativa, botões, lista) mostram o texto', () => {
  expect(evolutionMessageText({ templateMessage: { hydratedTemplate: { hydratedContentText: 'Seu código é 123' } } }).text).toBe('Seu código é 123');
  expect(evolutionMessageText({ interactiveMessage: { body: { text: 'Pedido confirmado' } } }).text).toBe('Pedido confirmado');
  expect(evolutionMessageText({ buttonsMessage: { contentText: 'Escolha uma opção' } }).text).toBe('Escolha uma opção');
  expect(evolutionMessageText({ listMessage: { description: 'Veja a lista' } }).text).toBe('Veja a lista');
  expect(evolutionMessageText({ templateButtonReplyMessage: { selectedDisplayText: 'Sim' } }).text).toBe('Sim');
  expect(evolutionMessageText({ interactiveMessage: {} }).text).toBe('');
});

describe('reações e citações', () => {
  test('reação aponta a mensagem reagida; vazia = removida', () => {
    expect(evolutionReaction({ reactionMessage: { key: { id: 'ALVO1' }, text: '👍' } })).toEqual({ targetId: 'ALVO1', emoji: '👍' });
    expect(evolutionReaction({ reactionMessage: { key: { id: 'ALVO1' }, text: '' } })).toEqual({ targetId: 'ALVO1', emoji: '' });
    expect(evolutionReaction({ conversation: 'oi' })).toBeNull();
  });
  test('citação: id e trecho, no texto ou no nível do registro (Evolution v2), sem a assinatura', () => {
    expect(evolutionQuote({ extendedTextMessage: { text: 'Pode ser', contextInfo: { stanzaId: 'Q1', quotedMessage: { conversation: '*Rose:*\nQual a cor?' } } } })).toEqual({ id: 'Q1', preview: 'Qual a cor?' });
    expect(evolutionQuote({ conversation: 'Sim' }, { stanzaId: 'Q2', quotedMessage: { imageMessage: { caption: 'janela' } } })).toEqual({ id: 'Q2', preview: '[foto] janela' });
    expect(evolutionQuote({ conversation: 'Sim' })).toBeNull();
  });
});

describe('importa o histórico', () => {
  function fakeDb() {
    const t: Record<string, Record<string, unknown>[]> = { conversations: [], messages: [], clients: [{ id: 'cli', company_id: 'c1', name: 'Carlos', phone: '(47) 99999-0000' }] };
    let n = 0;
    const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
    return { t, rpcs, db: { rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return { data: null, error: null }; }, from: (table: string) => {
      const f: Array<(r: Record<string, unknown>) => boolean> = []; let ins: unknown = null; let upd: Record<string, unknown> | null = null; let order: string | null = null; let asc = true; let lim = Infinity;
      const rows = () => { let r = (t[table] ??= []).filter(x => f.every(fn => fn(x))); if (order) r = [...r].sort((a, b) => String(a[order!]).localeCompare(String(b[order!])) * (asc ? 1 : -1)); return r.slice(0, lim); };
      const exec = () => {
        if (ins) { const list = (Array.isArray(ins) ? ins : [ins]).map(x => ({ id: `${table}-${++n}`, ...(x as object) })); t[table].push(...list); return { data: list, error: null }; }
        if (upd) { rows().forEach(r => Object.assign(r, upd)); return { data: null, error: null }; }
        return { data: rows(), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q, or: () => q,
        eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
        in: (k: string, v: unknown[]) => { f.push(r => v.includes(r[k])); return q; },
        is: (k: string, v: unknown) => { f.push(r => (r[k] ?? null) === v); return q; },
        order: (k: string, o?: { ascending?: boolean }) => { order = k; asc = o?.ascending !== false; return q; },
        limit: (x: number) => { lim = x; return q; },
        insert: (d: unknown) => { ins = d; return q; }, update: (d: Record<string, unknown>) => { upd = d; return q; },
        single: async () => { const r = exec().data as unknown[]; return { data: r?.[0] ?? null, error: r?.[0] ? null : { message: 'x' } }; },
        maybeSingle: async () => ({ data: (exec().data as unknown[])?.[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve(exec()).then(ok),
      }; return q; } } };
  }
  const rec = (id: string, ts: number, text: string, fromMe = false, jid = '5547999990000@s.whatsapp.net') =>
    ({ key: { id, fromMe, remoteJid: jid }, pushName: fromMe ? 'Marquinhos' : 'Carlos', message: { conversation: text }, messageTimestamp: ts });

  test('cria conversa ligada ao cliente, com autor certo, e não duplica', async () => {
    const { t, db } = fakeDb();
    const page = [rec('m3', 1700000300, '*Rose:*\nJá envio', true), rec('m2', 1700000200, 'Quero orçamento'), rec('g1', 1700000100, 'grupo', false, '123@g.us')];
    expect(await importHistoryPage(db as never, 'c1', page)).toEqual({ inserted: 2, conversations: 1 });
    expect(t.conversations[0]).toMatchObject({ external_id: '5547999990000', client_id: 'cli', ai_paused: true, last_message_preview: 'Já envio' });
    expect(t.messages.map(m => [m.author, m.sender_name])).toEqual([['equipe', 'Rose'], ['cliente', 'Carlos']]);
    expect(await importHistoryPage(db as never, 'c1', page)).toEqual({ inserted: 0, conversations: 0 });
    expect(t.messages).toHaveLength(2);
  });
  test('reconciliação aplica reação perdida e guarda a citação, sem regravar o que não mudou', async () => {
    const { t, db } = fakeDb();
    await importHistoryPage(db as never, 'c1', [rec('alvo', 1700000000, 'Orçamento enviado', true)]);
    const reacao = { key: { id: 'r1', fromMe: false, remoteJid: '5547999990000@s.whatsapp.net' }, message: { reactionMessage: { key: { id: 'alvo' }, text: '❤️' } }, messageTimestamp: 1700000100 };
    const citada = { ...rec('q1', 1700000200, 'Pode ser na terça'), contextInfo: { stanzaId: 'alvo', quotedMessage: { conversation: 'Orçamento enviado' } } };
    await importHistoryPage(db as never, 'c1', [reacao, citada] as never);
    expect(t.messages.find(m => m.external_id === 'alvo')).toMatchObject({ reaction_customer: '❤️' });
    expect(t.messages.find(m => m.external_id === 'q1')).toMatchObject({ quoted_external_id: 'alvo', quoted_preview: 'Orçamento enviado' });
    expect(t.messages.some(m => m.external_id === 'r1')).toBe(false);
  });

  test('mesmo ID em dois canais é recuperado nos dois; reação não atravessa o canal',async()=>{
    const {t,db}=fakeDb();
    const page=[rec('same-id',1700000100,'Mensagem')];
    expect((await importHistoryPage(db as never,'c1',page,'canal-1')).inserted).toBe(1);
    expect((await importHistoryPage(db as never,'c1',page,'canal-2')).inserted).toBe(1);
    expect((await importHistoryPage(db as never,'c1',page,'canal-1')).inserted).toBe(0);
    const reaction={key:{id:'reaction',fromMe:false,remoteJid:'5547999990000@s.whatsapp.net'},message:{reactionMessage:{key:{id:'same-id'},text:'👍'}},messageTimestamp:1700000200};
    await importHistoryPage(db as never,'c1',[reaction],'canal-2');
    expect(t.messages.find(m=>m.channel_id==='canal-1')?.reaction_customer).toBeUndefined();
    expect(t.messages.find(m=>m.channel_id==='canal-2')?.reaction_customer).toBe('👍');
  });

  test.each(['*Rose:*\nJá envio', 'Já envio\n*Rose:*'])('eco de envio sem confirmação reconcilia %j sem duplicar', async (signedBody) => {
    const { t, db } = fakeDb();
    await importHistoryPage(db as never, 'c1', [rec('in1', 1700000000, 'Bom dia')]);
    const conv = t.conversations[0].id;
    t.messages.push({ id: 'pend', company_id: 'c1', conversation_id: conv, direction: 'outbound', author: 'equipe', body: signedBody, external_id: null, delivery_status: 'desconhecido', sent_at: new Date(1700000290000).toISOString() });
    expect(await importHistoryPage(db as never, 'c1', [rec('echo1', 1700000300, signedBody, true)])).toMatchObject({ inserted: 0 });
    expect(t.messages.filter(m => m.direction === 'outbound')).toHaveLength(1);
    expect(t.messages.find(m => m.id === 'pend')).toMatchObject({ external_id: 'echo1', delivery_status: 'enviada', error_message: null });
    // Texto diferente não é confundido com o envio pendente.
    expect(await importHistoryPage(db as never, 'c1', [rec('echo2', 1700000400, '*Rose:*\nOutra coisa', true)])).toMatchObject({ inserted: 1 });
  });
  test('recuperadas: só as recebidas que entraram agora vão para a contagem de não lidas', async () => {
    const { t, rpcs, db } = fakeDb();
    const page = [rec('r3', 1700000300, '*Rose:*\nJá vi', true), rec('r2', 1700000200, 'Chegou atrasada'), rec('r1', 1700000100, 'Primeira')];
    await importHistoryPage(db as never, 'c1', page);
    const unread = rpcs.filter(r => r.fn === 'inbox_count_recovered');
    expect(unread).toEqual([{ fn: 'inbox_count_recovered', args: { p_conversation: t.conversations[0].id, p_company: 'c1', p_ats: [new Date(1700000200000).toISOString(), new Date(1700000100000).toISOString()] } }]);
    // Repetir a mesma página não conta de novo.
    await importHistoryPage(db as never, 'c1', page);
    expect(rpcs.filter(r => r.fn === 'inbox_count_recovered')).toHaveLength(1);
  });
  test('sincronização recente recupera mensagens ausentes sem duplicar nem mudar o atendimento existente', async () => {
    const { t, db } = fakeDb();
    const existing = rec('old', 1700000100, 'anterior');
    await importHistoryPage(db as never, 'c1', [existing]);
    Object.assign(t.conversations[0], { ai_paused: false, assigned_to: 'vendedor', unread_count: 3 });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ messages: { records: [rec('new', 1700000200, 'nova'), existing], pages: 99 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      expect(await syncRecentEvolutionMessages(db as never, 'c1', 'https://evolution.example.com', 'test-key', 'crm')).toMatchObject({ inserted: 1 });
      expect(await syncRecentEvolutionMessages(db as never, 'c1', 'https://evolution.example.com', 'test-key', 'crm')).toMatchObject({ inserted: 0 });
      expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ where: {}, page: 1, offset: 400 });
      expect(t.messages).toHaveLength(2);
      expect(t.conversations[0]).toMatchObject({ ai_paused: false, assigned_to: 'vendedor', unread_count: 3, last_message_preview: 'nova' });
    } finally { vi.unstubAllGlobals(); }
  });
  test('recupera do fim para o início, respeita o limite e não para numa página já conhecida', async () => {
    const { t, db } = fakeDb();
    const page1 = Array.from({ length: 400 }, (_, i) => rec(`p1-${i}`, 1700100000 - i, `m${i}`));
    const page2 = [rec('p2-0', 1700000000, 'mais antiga')];
    const fetcher = vi.fn(async (_u: string, init: RequestInit) => {
      const n = JSON.parse(init.body as string).page;
      return new Response(JSON.stringify({ messages: { records: n === 1 ? page1 : n === 2 ? page2 : [], pages: 3 } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      await importHistoryPage(db as never, 'c1', page1);
      // Lê a âncora e a última página, mesmo vazia; não importa além do limite.
      expect(await syncRecentEvolutionMessages(db as never, 'c1', 'https://evolution.example.com', 'k', 'crm', null, { maxPages: 1 })).toMatchObject({ inserted: 0, pages: 1 });
      expect(fetcher.mock.calls.map(([,init]) => JSON.parse(init.body as string).page)).toEqual([1,3]);
      expect(t.messages).toHaveLength(400);
      fetcher.mockClear();
      expect(await syncRecentEvolutionMessages(db as never, 'c1', 'https://evolution.example.com', 'k', 'crm', null, { maxPages: 5 })).toMatchObject({ inserted: 1, pages: 3 });
      expect(fetcher.mock.calls.map(([,init]) => JSON.parse(init.body as string).page)).toEqual([1,3,2]);
      expect(t.messages).toHaveLength(401);
      // Repetir percorre a mesma janela sem duplicar mensagens.
      expect(await syncRecentEvolutionMessages(db as never, 'c1', 'https://evolution.example.com', 'k', 'crm', null, { maxPages: 5 })).toMatchObject({ inserted: 0, pages: 3 });
      expect(t.messages).toHaveLength(401);
    } finally { vi.unstubAllGlobals(); }
  });
  test('reimportar corrige data de mensagem enviada sem duplicar nem alterar conteúdo ou atribuição', async () => {
    const { t, db } = fakeDb();
    const page = [rec('sent', 1700000100, 'enviada', true), rec('received', 1700000200, 'resposta')];
    await importHistoryPage(db as never, 'c1', page);
    Object.assign(t.messages[0], { sent_at: '2026-11-16T10:00:00Z', body: 'conteúdo preservado', delivery_status: 'lida' });
    Object.assign(t.conversations[0], { ai_paused: true, assigned_to: 'vendedor', unread_count: 2 });
    expect(await importHistoryPage(db as never, 'c1', page)).toMatchObject({ inserted: 0, conversations: 1 });
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0]).toMatchObject({ sent_at: new Date(1700000100000).toISOString(), body: 'conteúdo preservado', delivery_status: 'lida' });
    expect(t.conversations[0]).toMatchObject({ last_message_preview: 'resposta', ai_paused: true, assigned_to: 'vendedor', unread_count: 2 });
  });
});

import { agendaNameMap } from '@/lib/whatsapp/evolution-history';
import { cleanContactName } from '@/lib/whatsapp/phone';
describe('nomes da agenda', () => {
  test('número não é nome', () => {
    expect(cleanContactName('554791924675')).toBeNull();
    expect(cleanContactName('+55 47 9192-4675')).toBeNull();
    expect(cleanContactName('  Rose  Vidros ')).toBe('Rose Vidros');
  });
  test('mapa por telefone, ignora número e lid', () => {
    const m = agendaNameMap([
      { remoteJid: '554791924675@s.whatsapp.net', pushName: 'Carlos Obra' },
      { remoteJid: '5547988887777@s.whatsapp.net', pushName: '5547988887777' },
      { remoteJid: '123@lid', pushName: 'X' },
    ]);
    expect([...m.values()]).toEqual(['Carlos Obra']);
  });
});

import { autoLinkClients } from '@/lib/whatsapp/inbox-store';
describe('liga conversas ao cadastro', () => {
  test('acha cliente pelo telefone formatado', async () => {
    const t: Record<string, Record<string, unknown>[]> = {
      conversations: [{ id: 'v1', company_id: 'c1', channel: 'whatsapp', phone: '554791924675', external_id: '554791924675', client_id: null },
                      { id: 'v2', company_id: 'c1', channel: 'whatsapp', phone: '5547900000000', external_id: '5547900000000', client_id: null }],
      clients: [{ id: 'cli', company_id: 'c1', phone: '(47) 99192-4675', whatsapp: null }],
    };
    const db = { from: (table: string) => {
      const f: Array<(r: Record<string, unknown>) => boolean> = []; let upd: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {
        select: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
        is: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
        update: (d: Record<string, unknown>) => { upd = d; return q; },
        then: (ok: (v: unknown) => unknown) => { const rows = t[table].filter(r => f.every(fn => fn(r))); if (upd) rows.forEach(r => Object.assign(r, upd)); return Promise.resolve({ data: rows, error: null }).then(ok); },
      }; return q; } };
    expect(await autoLinkClients(db as never, 'c1')).toBe(1);
    expect(t.conversations.map(c => c.client_id)).toEqual(['cli', null]);
  });
});

test("erros do servidor do WhatsApp viram instrução clara", async () => {
  const { evolutionErrorMessage } = await import("@/lib/whatsapp/evolution-history");
  expect(evolutionErrorMessage(new Error("Evolution HTTP 401 ao ler o histórico."))).toMatch(/chave da Evolution/);
  expect(evolutionErrorMessage(new Error("fetch failed"))).toMatch(/não respondeu/);
});

test('foto de álbum (associatedChildMessage) e visualização única viram [foto] com legenda', () => {
  const foto = { imageMessage: { caption: 'Cor da porta', mimetype: 'image/jpeg' }, messageContextInfo: {} };
  expect(evolutionMessageText({ associatedChildMessage: { message: foto }, messageContextInfo: {} })).toEqual({ text: '[foto] Cor da porta', media: 'image' });
  expect(evolutionMessageText({ viewOnceMessage: { message: { imageMessage: {} } } })).toEqual({ text: '[foto]', media: 'image' });
  // O cabeçalho do álbum não é uma mensagem própria (as fotos chegam uma a uma).
  expect(evolutionMessageText({ albumMessage: { expectedImageCount: 3 } })).toEqual({ text: '', media: null });
});
