import { expect, test } from 'vitest';
import { normalizeTriageSession } from '@/lib/triage';

test('conversa de triagem sem mensagens, pontuacao ou status nao quebra a tela', () => {
  const s = normalizeTriageSession({ id: '1', phone: null, messages: null, score: null, status: null, created_at: null } as Record<string, unknown>);
  expect(s.messages).toEqual([]);
  expect(s.score).toBe(0);
  expect(s.status).toBe('em_andamento');
  expect(s.phone).toBe('');
  expect(typeof s.created_at).toBe('string');
});

test('mensagens validas sao mantidas e itens invalidos descartados', () => {
  const msg = { role: 'user', content: 'Oi', timestamp: '2026-11-03T00:00:00Z' };
  expect(normalizeTriageSession({ messages: [msg, null, 'x'], score: '72' } as Record<string, unknown>)).toMatchObject({ messages: [msg], score: 72 });
});
