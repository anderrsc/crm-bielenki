import { describe, expect, test } from 'vitest';
import { guardCustomerGreeting, guardRepeatedThanks, isConfirmedCustomerName } from '@/lib/ai/customer-identity';
import type { TriageMessage } from '@/lib/ai/triage-context';
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

describe('vocativo com nome do atendente no meio da resposta', () => {

  test('não chama o cliente pelo nome do atendente', () => {
    const msgs = [user('Anderson, tudo bem?')];
    expect(guardCustomerGreeting('Tudo bem sim, Anderson! Você já tem ideia de quantos metros?', msgs)).toBe('Tudo bem sim! Você já tem ideia de quantos metros?');
    expect(guardCustomerGreeting('Sem problema, Anderson! Se puder mandar uma foto.', msgs)).toBe('Sem problema! Se puder mandar uma foto.');
  });
  test('mantém o nome que o próprio cliente informou', () => {
    const msgs = [user('Meu nome é Junior')];
    expect(guardCustomerGreeting('Perfeito, Junior! Qual a cidade?', msgs)).toBe('Perfeito, Junior! Qual a cidade?');
  });
  test('não mexe em frases sem vocativo', () => {
    expect(guardCustomerGreeting('Atendemos São Bento do Sul, sim. Qual o bairro?', [])).toBe('Atendemos São Bento do Sul, sim. Qual o bairro?');
  });
});


test.each(['Anderson, tudo bem?', 'Anderson, bom dia', 'Anderson, pode me ajudar?', 'Anderson?'])('chamar o atendente pelo nome não é se identificar: %s', content => {
  expect(isConfirmedCustomerName('Anderson', [user(content)])).toBe(false);
});


test("Lia não agradece em toda mensagem", () => {
  const msgs = [
    { role: "assistant", content: "Olá! Aqui é a Lia... qual seu nome completo?" },
    { role: "user", content: "Rute Clara Valentim de Miranda" },
    { role: "assistant", content: "Obrigada! Você é de qual cidade e bairro?" },
    { role: "user", content: "Santa Luzia, Jaraguá do Sul" },
  ] as TriageMessage[];
  expect(guardRepeatedThanks("Obrigada! Pra equipe montar o orçamento, qual a largura?", msgs)).toBe("Pra equipe montar o orçamento, qual a largura?");
  expect(guardRepeatedThanks("Obrigada pelas medidas, Rute! Seria de correr?", msgs)).toBe("Seria de correr?");
  expect(guardRepeatedThanks("Obrigada! A equipe vai montar o orçamento.", msgs, true)).toBe("Obrigada! A equipe vai montar o orçamento.");
  // primeira vez pode agradecer
  expect(guardRepeatedThanks("Obrigada! Você é de qual cidade?", msgs.slice(0, 2))).toBe("Obrigada! Você é de qual cidade?");
  // depois de foto pode agradecer
  const foto = [...msgs, { role: "user", content: "[foto]" }] as TriageMessage[];
  expect(guardRepeatedThanks("Obrigada pela foto! É de correr?", foto)).toBe("Obrigada pela foto! É de correr?");
});
