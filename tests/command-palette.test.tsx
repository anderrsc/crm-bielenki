// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileText, Users } from 'lucide-react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
import { CommandPalette } from '@/components/command-palette';

afterEach(() => { cleanup(); push.mockReset(); });
const items = [
  { label: 'Nova compra', href: '/compras/nova', icon: FileText, group: 'Criar', keywords: 'fornecedor nota' },
  { label: 'Clientes', href: '/clientes', icon: Users, group: 'Ir para' },
];

test('Ctrl+K abre, filtra sem acento e Enter abre a tela', async () => {
  render(<CommandPalette items={items} />);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const input = await screen.findByLabelText('Comando ou busca');
  fireEvent.change(input, { target: { value: 'fornecedor' } });
  expect(screen.getByText('Nova compra')).toBeTruthy();
  expect(screen.queryByText('Clientes')).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(push).toHaveBeenCalledWith('/compras/nova');
});

test('texto livre vira busca no sistema', async () => {
  render(<CommandPalette items={items} />);
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  const input = await screen.findByLabelText('Comando ou busca');
  fireEvent.change(input, { target: { value: 'João Silva' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(push).toHaveBeenCalledWith('/busca?q=Jo%C3%A3o%20Silva');
});
