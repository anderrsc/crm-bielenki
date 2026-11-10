import { describe, expect, test } from 'vitest';
import { isExistingQuoteConversation } from '@/lib/ai/triage-context';

const check = (content: string) => isExistingQuoteConversation([{ role: 'user', content }]);
describe('intenção de retorno sobre orçamento', () => {
  test.each(['este orçamento que vc fez para nós', 'Quero comparar o orçamento', 'Pode incluir contrarufo no seu orçamento?', 'Tenho dúvidas sobre a proposta', 'o orçamento que vocês enviaram'])('%s', text => expect(check(text)).toBe(true));
  test.each(['Quero orçamento de calha', 'Preciso de um orçamento para galpão', '[documento: JULIANA - ORÇAMENTO.pdf]', 'Vocês fazem contrarufo?'])('pedido novo ou anexo isolado: %s', text => expect(check(text)).toBe(false));
  test('texto anterior da própria IA não identifica pedido do cliente', () => {
    expect(isExistingQuoteConversation([{ role: 'assistant', content: 'Nesse orçamento' }, { role: 'user', content: 'Oi' }])).toBe(false);
  });
});
