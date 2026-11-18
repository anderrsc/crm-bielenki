import { beforeEach, describe, expect, test } from 'vitest';
import { AiRateLimitError, consumeAiQuota, resetAiQuota } from '@/lib/ai/rate-limit';
import { friendlyError, GENERIC_ERROR } from '@/lib/friendly-error';
import nextConfig from '../next.config';

describe('limite de uso da IA', () => {
  beforeEach(() => resetAiQuota());
  test('bloqueia ao passar do limite e libera depois da janela', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) consumeAiQuota('u1', t + i, 3);
    expect(() => consumeAiQuota('u1', t + 5, 3)).toThrow(AiRateLimitError);
    expect(() => consumeAiQuota('u2', t + 5, 3)).not.toThrow();
    expect(() => consumeAiQuota('u1', t + 10 * 60 * 1000 + 10, 3)).not.toThrow();
  });
});

describe('mensagens de erro', () => {
  test('esconde detalhes técnicos do banco', () => {
    expect(friendlyError('relation "public.x" does not exist')).toBe(GENERIC_ERROR);
    expect(friendlyError('Could not find the function public.foo(p_a) in the schema cache')).toBe(GENERIC_ERROR);
    expect(friendlyError('duplicate key value violates unique constraint "a"')).toBe('Já existe um registro com esses dados.');
  });
  test('mantém mensagens de negócio em português', () => {
    expect(friendlyError('Orçamento já foi aprovado.')).toBe('Orçamento já foi aprovado.');
  });
});

describe('cabeçalhos de segurança', () => {
  test('não expõe o Next e manda os cabeçalhos', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const [rule] = await nextConfig.headers!();
    const keys = rule.headers.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Content-Security-Policy']));
  });
});
