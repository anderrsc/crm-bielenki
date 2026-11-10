import { describe, expect, test } from 'vitest';
import { guardCustomerGreeting, isConfirmedCustomerName } from '@/lib/ai/customer-identity';
const user = (content: string) => ({ role: 'user', content });
describe('identidade do cliente', () => {
  test('remove o nome inventado do cumprimento da captura', () => {
    expect(guardCustomerGreeting('Bom dia, Anderson! Aqui é a Lia.', [user('Bom dia')])).toBe('Bom dia! Aqui é a Lia.');
  });
  test.each(['Me chamo Fabiano', 'Meu nome é Fabiano', 'Sou o Fabiano', 'Fabiano', 'Fabiano, Jaraguá do Sul'])('aceita identificação: %s', content => {
    expect(isConfirmedCustomerName('Fabiano', [user(content)])).toBe(true);
  });
  test.each(['O Anderson me atendeu', 'O orçamento está no nome de Anderson', '[documento: Anderson.pdf]'])('terceiro ou anexo não confirma identidade: %s', content => {
    expect(isConfirmedCustomerName('Anderson', [user(content)])).toBe(false);
  });
  test('respostas anteriores da IA não confirmam identidade', () => {
    expect(isConfirmedCustomerName('Anderson', [{ role: 'assistant', content: 'Bom dia, Anderson!' }, user('Quero calha')])).toBe(false);
  });
  test('mantém nome confirmado e ignora cidade posterior', () => {
    const messages = [user('Sou a Júlia'), user('Sou de Jaraguá')];
    expect(guardCustomerGreeting('Olá, Júlia! Como posso ajudar?', messages)).toBe('Olá, Júlia! Como posso ajudar?');
  });
  test('correção mais recente prevalece', () => {
    const messages = [user('Me chamo Anderson'), user('Meu nome é Maria')];
    expect(isConfirmedCustomerName('Anderson', messages)).toBe(false);
    expect(isConfirmedCustomerName('Maria', messages)).toBe(true);
  });
  test('não altera mensagem sem vocativo', () => {
    expect(guardCustomerGreeting('Olá! Sou a Lia. Qual seu nome?', [])).toBe('Olá! Sou a Lia. Qual seu nome?');
  });
});
