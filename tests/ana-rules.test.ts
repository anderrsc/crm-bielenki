import { describe, expect, test } from 'vitest';
import { ANA_RULES_TEMPLATE, rulesForPrompt, withLearned, rulesWithoutLearned, LEARNED_HEADER } from '@/lib/ai/ana-rules';
import { buildTranscripts } from '@/lib/ai/ana-learn';

describe('regras da Ana', () => {
  test('só perguntas respondidas entram no prompt', () => {
    const p = rulesForPrompt(ANA_RULES_TEMPLATE);
    expect(p).toContain('Peça avulsa');
    expect(p).toContain('espessura e material');
    expect(p).not.toContain('Quais cidades');
  });
  test('aprendizado troca a seção antiga e entra no prompt', () => {
    const a = withLearned(ANA_RULES_TEMPLATE, 'velho');
    const b = withLearned(a, 'novo jeito');
    expect(b.split(LEARNED_HEADER)).toHaveLength(2);
    expect(rulesWithoutLearned(b)).toBe(ANA_RULES_TEMPLATE.trim());
    expect(rulesForPrompt(b)).toContain('novo jeito');
  });
  test('vazio não manda nada', () => expect(rulesForPrompt('')).toBe(''));
});

describe('conversas para aprender', () => {
  test('só conversas com equipe e cliente, sem telefone', () => {
    const m = (c: string, author: string, body: string, t: string) => ({ conversation_id: c, direction: 'x', author, sender_name: null, body, sent_at: t });
    const out = buildTranscripts([
      m('a', 'cliente', 'Oi, meu fone 47999990000', '1'), m('a', 'equipe', '*Rose:*\nBom dia!', '2'),
      m('b', 'cliente', 'sozinho', '1'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('Cliente: Oi, meu fone #\nEquipe: Bom dia!');
  });
});
