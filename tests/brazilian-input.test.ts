import { expect, test } from 'vitest';
import { brazilianFieldKind, formatBrazilianPhone, formatBrazilianTaxId, formatRegistrationName, normalizeRegistrationForm } from '@/lib/brazilian-input';
test('telefones mantêm dígitos, formatam celular/fixo e preservam ramal e estrangeiro', () => {
  expect(formatBrazilianPhone('4720332112')).toBe('(47) 2033-2112');
  expect(formatBrazilianPhone('47999990000')).toBe('(47) 99999-0000');
  expect(formatBrazilianPhone('5547999990000')).toBe('+55 (47) 99999-0000');
  expect(formatBrazilianPhone('+1 212 555 0100')).toBe('+1 212 555 0100');
  expect(formatBrazilianPhone('47 2033-2112 ramal 2')).toBe('47 2033-2112 ramal 2');
  expect(formatBrazilianPhone('(47) 99999-0000')).toBe('(47) 99999-0000');
  expect(brazilianFieldKind('whatsapp_phone_number_id')).toBeNull();
});
test('CPF/CNPJ recebem pontuação sem truncar dados e aceitam identificadores alfanuméricos', () => {
  expect(formatBrazilianTaxId('15104113000104')).toBe('15.104.113/0001-04');
  expect(formatBrazilianTaxId('12345678901')).toBe('123.456.789-01');
  expect(formatBrazilianTaxId('12ABC34501DE35', 'cnpj')).toBe('12.ABC.345/01DE-35');
  expect(formatBrazilianTaxId('ISENTO')).toBe('ISENTO');
  expect(formatBrazilianTaxId('123456789012', 'cpf')).toBe('123456789012');
  expect(formatBrazilianTaxId('151041130001040')).toBe('151041130001040');
});
test('nomes seguem padrão com acentos, partículas e siglas', () => {
  expect(formatRegistrationName('  JOÃO  DA SILVA ')).toBe('João da Silva');
  expect(formatRegistrationName('AMARAL ALUMÍNIOS LTDA')).toBe('Amaral Alumínios Ltda');
  expect(formatRegistrationName('BALNEÁRIO CAMBORIÚ')).toBe('Balneário Camboriú');
  expect(formatRegistrationName('ESQUADRIAS PVC E ACM')).toBe('Esquadrias PVC e ACM');
});
test('normalização no servidor protege códigos, senhas e observações e é idempotente', () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: 'AMARAL ALUMÍNIOS LTDA', phone: '4720332112', whatsapp: '47999990000', tax_id: '15104113000104', email: 'CONTATO@EXEMPLO.COM', notes: 'ATENÇÃO: ABC-123', password: 'AbC-123', sku: 'ABC-123', state: 'SC' })) form.set(key, value);
  normalizeRegistrationForm(form);
  expect(Object.fromEntries(form)).toMatchObject({ name: 'Amaral Alumínios Ltda', phone: '(47) 2033-2112', tax_id: '15.104.113/0001-04', email: 'contato@exemplo.com', notes: 'ATENÇÃO: ABC-123', password: 'AbC-123', sku: 'ABC-123', state: 'SC' });
  const first = Object.fromEntries(form);
  normalizeRegistrationForm(form);
  expect(Object.fromEntries(form)).toEqual(first);
});
