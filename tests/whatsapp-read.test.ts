import { afterEach, describe, expect, test, vi } from 'vitest';
import { markWhatsAppRead, markWhatsAppUnread, type WhatsAppCredentials } from '@/lib/whatsapp/send';
import { inboxDayLabel, inboxListTime, inboxClock } from '@/lib/whatsapp/inbox-display';

const credentials: WhatsAppCredentials = { provider: 'evolution', evolutionUrl: 'https://evo.example.com', evolutionKey: 'test-only', evolutionInstance: 'crm', metaToken: '', phoneNumberId: '' };
afterEach(() => vi.unstubAllGlobals());
describe('leitura no WhatsApp', () => {
  test.each(['123456789@lid', '5547999990000'])('preserva o identificador válido para %s', async phone => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await markWhatsAppRead(credentials, phone, ['m1']);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const jid = phone.endsWith('@lid') ? phone : `${phone}@s.whatsapp.net`;
    expect(JSON.parse(init.body as string).readMessages).toEqual([{ id: 'm1', fromMe: false, remoteJid: jid }]);
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ messages: { records: [{ key: { id: 'm1', remoteJid: '123456789@lid', fromMe: false }, messageTimestamp: 1700000000 }] } }), { status: 200 }));
    await markWhatsAppUnread(credentials, phone, 'm1');
    const [url, unread] = fetcher.mock.calls[2] as unknown as [string, RequestInit];
    expect(url).toBe('https://evo.example.com/chat/markChatUnread/crm');
    expect(JSON.parse(unread.body as string)).toEqual({ lastMessage: { key: { id: 'm1', remoteJid: '123456789@lid', fromMe: false }, messageTimestamp: 1700000000 } });
  });
  test('falha na confirmação não é tratada como sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(markWhatsAppRead(credentials, '123456789@lid', ['m1'])).rejects.toThrow('HTTP 500');
    await expect(markWhatsAppUnread(credentials, '123456789@lid', 'm1')).rejects.toThrow('HTTP 500');
  });
});
test('horários e separadores usam Brasília mesmo no servidor UTC e na virada do dia', () => {
  const now = new Date('2026-11-16T02:30:00Z');
  expect(inboxClock('2026-11-16T02:20:00Z')).toBe('23:20');
  expect(inboxDayLabel('2026-11-16T02:20:00Z', now)).toBe('Hoje');
  expect(inboxDayLabel('2026-11-15T02:20:00Z', now)).toBe('Ontem');
  expect(inboxListTime('2026-11-16T02:20:00Z', now)).toBe('23:20');
});
test('sem informar o "agora", usa a data real: hoje mostra a hora, como no WhatsApp', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-23T11:34:00Z')); // 08:34 em Brasília
    expect(inboxListTime('2026-11-23T11:15:00Z')).toBe('08:15');
    expect(inboxDayLabel('2026-11-23T11:15:00Z')).toBe('Hoje');
    expect(inboxListTime('2026-11-22T20:00:00Z')).toBe('Ontem');
    expect(inboxListTime('2026-11-20T20:00:00Z')).toBe('20/11');
  } finally {
    vi.useRealTimers();
  }
});
