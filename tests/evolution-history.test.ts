import { describe, expect, test } from 'vitest';
import { evolutionJidPhone, evolutionMessageText } from '@/lib/whatsapp/message-text';
import { importHistoryPage } from '@/lib/whatsapp/evolution-history';

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

describe('importa o histórico', () => {
  function fakeDb() {
    const t: Record<string, Record<string, unknown>[]> = { conversations: [], messages: [], clients: [{ id: 'cli', company_id: 'c1', name: 'Carlos', phone: '(47) 99999-0000' }] };
    let n = 0;
    return { t, db: { from: (table: string) => {
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
