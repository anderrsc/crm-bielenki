// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { breadcrumbTrail } from '@/components/breadcrumbs';

const push = vi.fn();
let search = 'q=joao&status=aberta';
vi.mock('next/navigation', () => ({ usePathname: () => '/clientes', useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams(search) }));
import { SavedViews } from '@/components/saved-views';
import { UnsavedGuard } from '@/components/unsaved-guard';

afterEach(() => { cleanup(); localStorage.clear(); push.mockReset(); search = 'q=joao&status=aberta'; });

test('migalhas: seção, detalhe e ações com nomes legíveis', () => {
  const section = (h: string) => ({ '/compras': 'Compras', '/financeiro': 'Financeiro' } as Record<string, string>)[h];
  expect(breadcrumbTrail('/dashboard', section)).toEqual([]);
  expect(breadcrumbTrail('/compras/nova', section).map((t) => t.label)).toEqual(['Início', 'Compras', 'Nova']);
  expect(breadcrumbTrail('/compras/ad6d2c4f-145a-446b-be5e-a914da5a7e82', section).map((t) => t.label)).toEqual(['Início', 'Compras', 'Detalhe']);
  const t = breadcrumbTrail('/financeiro/receber', section);
  expect(t.map((x) => x.label)).toEqual(['Início', 'Financeiro', 'A receber']);
  expect(t.at(-1)?.href).toBeNull();
});

test('visões salvas: salva os filtros com nome, reaplica e apaga', () => {
  const { rerender } = render(<SavedViews />);
  fireEvent.click(screen.getByText('Salvar estes filtros'));
  fireEvent.change(screen.getByLabelText('Nome da visão'), { target: { value: 'Abertos do João' } });
  fireEvent.click(screen.getByText('Salvar'));
  expect(JSON.parse(localStorage.getItem('marquinhos-views:/clientes')!)).toEqual([{ name: 'Abertos do João', qs: 'q=joao&status=aberta' }]);
  search = '';
  rerender(<SavedViews />);
  fireEvent.click(screen.getByText('Abertos do João'));
  expect(push).toHaveBeenCalledWith('/clientes?q=joao&status=aberta');
  fireEvent.click(screen.getByLabelText('Apagar visão Abertos do João'));
  expect(localStorage.getItem('marquinhos-views:/clientes')).toBe('[]');
});

test('aviso de saída: só quando o formulário marcado foi alterado e some ao enviar', () => {
  render(<><UnsavedGuard /><form data-warn-unsaved><input aria-label="campo" /></form><form><input aria-label="outro" /></form></>);
  const unload = () => { const e = new Event('beforeunload', { cancelable: true }); act(() => { window.dispatchEvent(e); }); return e.defaultPrevented; };
  expect(unload()).toBe(false);
  fireEvent.input(screen.getByLabelText('outro'), { target: { value: 'x' } });
  expect(unload()).toBe(false);                      // formulário comum não avisa
  fireEvent.input(screen.getByLabelText('campo'), { target: { value: 'x' } });
  expect(unload()).toBe(true);
  fireEvent.submit(screen.getByLabelText('campo').closest('form')!);
  expect(unload()).toBe(false);                      // enviou: pode sair
});
