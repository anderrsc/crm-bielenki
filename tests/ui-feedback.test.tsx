// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const params = new URLSearchParams('salvo=1');
vi.mock('next/navigation', () => ({ useSearchParams: () => params, usePathname: () => '/x' }));
import { ConfirmHost, confirmAction } from '@/components/ui-feedback/confirm';
import { Toaster, toast } from '@/components/ui-feedback/toast';

afterEach(cleanup);

test('confirmação própria: confirmar resolve true, voltar resolve false', async () => {
  render(<ConfirmHost />);
  let p!: Promise<boolean>;
  act(() => { p = confirmAction({ message: 'Excluir esta linha?', confirmLabel: 'Excluir' }); });
  expect(await screen.findByText('Excluir esta linha?')).toBeTruthy();
  fireEvent.click(screen.getByText('Excluir'));
  await expect(p).resolves.toBe(true);
  act(() => { p = confirmAction('Apagar resposta?'); });
  fireEvent.click(await screen.findByText('Voltar'));
  await expect(p).resolves.toBe(false);
});

test('aviso aparece depois da ação e confirma ?salvo=1', async () => {
  render(<Toaster />);
  expect(await screen.findByText('Salvo.')).toBeTruthy();
  act(() => toast.error('Não foi possível salvar.'));
  expect(await screen.findByText('Não foi possível salvar.')).toBeTruthy();
});
