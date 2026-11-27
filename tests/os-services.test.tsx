// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OsQueue, type OsRow } from '@/components/os-queue';
import { ServiceOrderBatch } from '@/components/service-order-sheet';
import { loadServiceCalls } from '@/lib/service-order';
import { setOsPrint } from '@/app/(crm)/service-order-actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(crm)/service-order-actions', () => ({ setOsPrint: vi.fn(), setOrderInstaller: vi.fn() }));
afterEach(cleanup);

const base = { place: '', installer: null, closedAt: '2026-11-20', deadline: null, printedAt: null, unconfirmed: false, queued: false };
const order: OsRow = { ...base, orderId: 'o1', saleId: 'v1', number: 'PED-1', client: 'Maria', service: 'Calhas', queued: true };
const service: OsRow = { ...base, orderId: '', saleId: '', serviceId: 's1', number: 'SRV-1', client: 'Francisco', service: 'Manutenção — Calha retornando água' };

test('fila lista manutenções e imprime junto com os pedidos', () => {
  render(<OsQueue rows={[service, order]} filtro="fila" />);
  expect(screen.getByText('Manutenção / serviço')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Imprimir selecionadas/ }).getAttribute('href')).toBe('/ordens-servico/imprimir?vendas=v1');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar SRV-1' }));
  expect(screen.getByRole('link', { name: /Imprimir selecionadas/ }).getAttribute('href')).toBe('/ordens-servico/imprimir?vendas=v1&servicos=s1');
});

const row = {
  id: 's1', company_id: 'c', service_number: 'SRV-1', kind: 'manutencao_calhas', priority: 'urgente', description: 'Calha retornando água',
  opened_at: '2026-11-20', scheduled_at: null, expected_date: null, team: null, phone: null, address: 'Rua da Obra, 9', neighborhood: null, city: null,
  billing: 'gratuito', expected_amount: null, final_amount: null, responsible: { full_name: 'Rosa' },
  client: { name: 'Francisco', phone: '47 9999', whatsapp: null, address: 'Rua de Casa, 1', neighborhood: 'Centro', city: 'Jaraguá', state: 'SC', postal_code: '89251000' },
};
const db = {
  from: (table: string) => {
    const query: Record<string, unknown> = {
      maybeSingle: async () => ({ data: { name: 'Empresa' } }),
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: table === 'service_orders' ? [row] : null, error: null }).then(ok),
    };
    for (const name of ['select', 'in', 'eq']) query[name] = () => query;
    return query;
  },
} as never;

test('OS de manutenção usa o endereço da obra e sai na folha', async () => {
  const [sheet] = await loadServiceCalls(db, ['s1']);
  expect(sheet.client).toMatchObject({ address: 'Rua da Obra, 9', neighborhood: null, postal_code: null, phone: '47 9999' });
  expect(sheet).toMatchObject({ billing: 'Gratuito', priority: 'Urgente', responsible: 'Rosa' });
  render(<ServiceOrderBatch list={[]} services={[sheet]} />);
  expect(screen.getByText('Calha retornando água')).toBeTruthy();
  expect(screen.getByText(/1 ordem de serviço · 1 folha A4/)).toBeTruthy();
});

test('confirmar a impressão envia pedidos e manutenções separados', async () => {
  vi.mocked(setOsPrint).mockResolvedValue({ error: null, count: 2 });
  render(<OsQueue rows={[{ ...service, unconfirmed: true }, { ...order, unconfirmed: true }]} filtro="fila" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saíram impressas/ })); });
  expect(setOsPrint).toHaveBeenCalledWith(['o1'], 'impressa', ['s1']);
});

test('imprimir manutenção marca como enviada e pede confirmação', async () => {
  vi.mocked(setOsPrint).mockResolvedValue({ error: null, count: 1 });
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  const [sheet] = await loadServiceCalls(db, ['s1']);
  render(<ServiceOrderBatch list={[]} services={[sheet]} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Imprimir \/ salvar PDF/ })); });
  expect(setOsPrint).toHaveBeenCalledWith([], 'enviada', ['s1']);
  expect(print).toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: /A impressão saiu/ })).toBeTruthy();
});