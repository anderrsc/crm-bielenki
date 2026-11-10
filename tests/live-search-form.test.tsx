// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LiveSearchForm } from '@/components/live-search-form';
const navigation = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/estoque' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: navigation.replace }), usePathname: () => navigation.pathname }));
beforeEach(() => { vi.useFakeTimers(); navigation.pathname = '/estoque'; navigation.replace.mockClear(); window.history.replaceState({}, '', '/estoque'); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function field(query = '', action?: string) {
  return <LiveSearchForm query={query} action={action}><input name="q" aria-label="Buscar material" defaultValue={query}/><button>Buscar</button></LiveSearchForm>;
}
const tick = (ms = 300) => act(() => vi.advanceTimersByTime(ms));

test('digitar busca sem Enter e agrupa digitação rápida em uma única navegação', () => {
  render(field());
  const input = screen.getByRole('textbox'); input.focus();
  fireEvent.change(input, { target: { value: 'ca' } }); tick(200);
  fireEvent.change(input, { target: { value: 'calha' } }); tick(299);
  expect(navigation.replace).not.toHaveBeenCalled(); tick(1);
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/estoque?q=calha', { scroll: false });
  expect(document.activeElement).toBe(input);
});
test('busca preserva filtros e volta à primeira página', () => {
  window.history.replaceState({}, '', '/estoque?pagina=4&status=ativo&aba=saldo');
  render(field()); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rufo' } }); tick();
  const url = new URL(navigation.replace.mock.calls[0][0], window.location.origin);
  expect(url.searchParams.get('q')).toBe('rufo'); expect(url.searchParams.get('status')).toBe('ativo');
  expect(url.searchParams.get('aba')).toBe('saldo'); expect(url.searchParams.has('pagina')).toBe(false);
});
test('limpar o campo remove a busca e restaura a listagem', () => {
  window.history.replaceState({}, '', '/estoque?q=calha&pagina=3');
  render(field('calha')); fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } }); tick();
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/estoque', { scroll: false });
});
test('Enter permanece disponível e cancela a busca agendada', () => {
  render(field()); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rufo' } });
  fireEvent.submit(screen.getByRole('search')); expect(navigation.replace).toHaveBeenCalledTimes(1); tick();
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});
test('busca global abre seu destino sem transportar filtros de outro módulo', () => {
  window.history.replaceState({}, '', '/estoque?pagina=3&status=ativo');
  render(field('', '/busca')); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'João & Cia' } }); tick();
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/busca?q=Jo%C3%A3o+%26+Cia', { scroll: false });
});
test('não busca durante composição e cancela timer ao sair da tela', () => {
  const { unmount } = render(field()); const input = screen.getByRole('textbox');
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: 'a' } }); tick();
  expect(navigation.replace).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input); tick(); expect(navigation.replace).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: 'alumínio' } }); unmount(); tick();
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});
test('voltar/avançar sincroniza texto e cancela busca pendente', () => {
  render(field()); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'calha' } });
  window.history.replaceState({}, '', '/estoque?q=rufo'); fireEvent.popState(window); tick();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('rufo');
  expect(navigation.replace).not.toHaveBeenCalled();
});
test('troca de aba respeita o parâmetro do formulário', () => {
  navigation.pathname = '/tabela-calhas'; window.history.replaceState({}, '', '/tabela-calhas?aba=pintura&espessura=0.5&pagina=2');
  render(<LiveSearchForm><input name="q" aria-label="Buscar peça"/><input type="hidden" name="aba" value="pecas-especiais"/></LiveSearchForm>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'suporte' } }); tick();
  const url = new URL(navigation.replace.mock.calls[0][0], window.location.origin);
  expect(url.searchParams.get('aba')).toBe('pecas-especiais'); expect(url.searchParams.get('espessura')).toBe('0.5');
});

test('busca global mantém a digitação pendente quando abre sua página de resultados', () => {
  const { rerender } = render(field('', '/busca')); const input = screen.getByRole('textbox'); input.focus();
  fireEvent.change(input, { target: { value: 'Jo' } }); tick();
  fireEvent.change(input, { target: { value: 'João' } });
  navigation.pathname = '/busca'; window.history.replaceState({}, '', '/busca?q=Jo');
  rerender(field('', '/busca')); tick();
  expect(navigation.replace).toHaveBeenLastCalledWith('/busca?q=Jo%C3%A3o', { scroll: false });
  expect((input as HTMLInputElement).value).toBe('João');
});
test('mudar para outro módulo cancela a busca pendente do módulo anterior', () => {
  const { rerender } = render(field()); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'calha' } });
  navigation.pathname = '/clientes'; window.history.replaceState({}, '', '/clientes'); rerender(field()); tick();
  expect(navigation.replace).not.toHaveBeenCalled();
});
