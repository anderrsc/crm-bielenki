// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/(crm)/actions', () => ({ saveGutterQuote: vi.fn(), updateGutterQuote: vi.fn() }));
vi.mock('@/components/quote-attachments', () => ({ DraftQuoteAttachments: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/orcamentos/calhas' }));

import { GutterQuote } from '@/components/gutter-quote';

afterEach(cleanup);
const valorUnitario = () => screen.getByText('Valor unitário (R$)').parentElement!.querySelector('input') as HTMLInputElement;
const campoProduto = () => [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === '__outro_item__')) as HTMLSelectElement;

const rates = { matrix: [], paints: [] };
const prices = [{ id: 'p1', product: 'Silicone incolor', category: 'Itens Especiais', thickness: null, cut_mm: null, color: null, unit: 'tubo', unit_price: 30, active: true }] as never;


test('Manta asfáltica está nos Itens Especiais, com unidades rolo e m²', () => {
  render(<GutterQuote prices={prices} rates={rates} clients={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Itens Especiais/ }));
  const produto = campoProduto();
  expect([...produto.options].map(o => o.text)).toEqual(expect.arrayContaining(['Manta asfáltica', '+ Outro item (digitar o nome)']));
  fireEvent.change(produto, { target: { value: 'Manta asfáltica' } });
  expect(screen.getByDisplayValue('Manta asfáltica')).toBeTruthy();
  const unidades = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.text === 'rolo'));
  expect(unidades && [...unidades.options].map(o => o.text)).toEqual(expect.arrayContaining(['rolo', 'm²']));
});

test('"Outro item" deixa digitar o nome, não apaga o valor ao renomear e volta para a lista', () => {
  render(<GutterQuote prices={prices} rates={rates} clients={[]} />);
  fireEvent.click(screen.getByRole('button', { name: /Itens Especiais/ }));
  fireEvent.change(campoProduto(), { target: { value: '__outro_item__' } });
  const nome = screen.getByRole('textbox', { name: 'Nome do item' }) as HTMLInputElement;
  expect(nome.value).toBe('');
  fireEvent.change(nome, { target: { value: 'Calafetação' } });
  const valor = valorUnitario();
  fireEvent.change(valor, { target: { value: '45' } });
  fireEvent.change(nome, { target: { value: 'Calafetação com PU' } });
  expect(valorUnitario().value).toBe('45');
  expect(nome.value).toBe('Calafetação com PU');
  // Item da tabela continua trazendo o preço dela.
  fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
  const lista = campoProduto();
  expect(lista.value).toBe('Calafetação com PU'); // o nome digitado continua no item
  fireEvent.change(lista, { target: { value: 'Silicone incolor' } });
  expect(valorUnitario().value).toBe('30');
});
