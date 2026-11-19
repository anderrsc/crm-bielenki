// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QuickCreateMenu } from '@/components/quick-create-menu';

afterEach(cleanup);

test('sem itens permitidos o botão Novo nem aparece (quem não tem acesso não vê atalho)', () => {
  const { container } = render(<QuickCreateMenu items={[]} />);
  expect(container.innerHTML).toBe('');
});

test('com itens mostra o botão Novo', () => {
  render(<QuickCreateMenu items={[{ label: 'Novo cliente', href: '/clientes/novo' }]} />);
  expect(screen.getByLabelText('Criar novo')).toBeTruthy();
});
