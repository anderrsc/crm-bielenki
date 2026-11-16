// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { InputHelpers } from '@/components/input-helpers';
afterEach(cleanup);
test('desliga sugestões pessoais também em formulários e modais adicionados depois', async () => {
  const ui = render(<><InputHelpers /><form aria-label="Cadastro"><input aria-label="Telefone" type="tel" autoComplete="tel" defaultValue="47999990000" /><input aria-label="Senha" type="password" autoComplete="new-password" /></form></>);
  expect(screen.getByLabelText('Telefone').getAttribute('autocomplete')).toBe('off');
  expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe('(47) 99999-0000');
  expect(screen.getByLabelText('Senha').getAttribute('autocomplete')).toBe('new-password');
  ui.rerender(<><InputHelpers /><form aria-label="Novo modal"><input aria-label="Contato do modal" type="email" autoComplete="email" /><textarea aria-label="Observações" /></form></>);
  await waitFor(() => expect(screen.getByLabelText('Contato do modal').getAttribute('autocomplete')).toBe('off'));
  expect(screen.getByLabelText('Observações').getAttribute('autocomplete')).toBe('off');
  expect(screen.getByRole('form', { name: 'Novo modal' }).getAttribute('autocomplete')).toBe('off');
});
test('máscaras chegam ao estado de campos controlados e nomes são padronizados ao sair', async () => {
  function Form() {
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    return <><InputHelpers /><input aria-label="Contato" name="phone" value={phone} onChange={e => setPhone(e.target.value)} /><input aria-label="Pessoa" name="full_name" value={name} onChange={e => setName(e.target.value)} /><output>{phone}|{name}</output></>;
  }
  render(<Form />);
  fireEvent.input(screen.getByLabelText('Contato'), { target: { value: '47999990000' }, inputType: 'insertFromPaste' });
  expect(screen.getByText('(47) 99999-0000|')).toBeTruthy();
  fireEvent.input(screen.getByLabelText('Pessoa'), { target: { value: 'JOÃO DA SILVA' } });
  fireEvent.focusOut(screen.getByLabelText('Pessoa'));
  expect(screen.getByText('(47) 99999-0000|João da Silva')).toBeTruthy();
});
