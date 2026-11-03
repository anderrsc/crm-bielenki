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

test('campos gravados como objeto ou lista viram texto (React nao aceita objeto na tela)', () => {
  const s = normalizeTriageSession({ produto: { tipo: 'calha', metros: 12 }, prazo: ['15 dias'], nome: 42, necessita_visita: 'sim', messages: '[{"role":"user","content":{"texto":"oi"}}]', created_at: 'data ruim', probabilidade: 'x' } as Record<string, unknown>);
  expect(s.produto).toBe('tipo: calha; metros: 12');
  expect(s.prazo).toBe('15 dias');
  expect(s.nome).toBe('42');
  expect(s.necessita_visita).toBe(true);
  expect(s.messages).toEqual([{ role: 'user', content: 'texto: oi', timestamp: '' }]);
  expect(s.created_at).toBe(new Date(0).toISOString());
  expect(s.probabilidade).toBeNull();
});
