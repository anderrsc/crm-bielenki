// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { SaleWorkspace } from '@/components/sale-detail';
import type { SaleWorkspaceData } from '@/lib/sales/workspace';
vi.mock('@/app/(crm)/actions', () => ({ toggleChecklistItem: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getRequestClient: vi.fn() }));
vi.mock('@/components/payment-dialog', () => ({ PaymentDialog: ({ entryId, label, backHref, interestAmount, discountAmount, installmentCount }: any) => <button data-entry={entryId} data-back={backHref} data-adjustment={[interestAmount, discountAmount, installmentCount].join(',')}>{label}</button> }));
afterEach(cleanup);
const fixture = (): SaleWorkspaceData => ({
  sale: { id: 'sale-1', company_id: 'company-1', sale_number: 'VEN-001', client_id: 'client-1', total: 1000, paid_amount: 200, open_amount: 800, financial_status: 'parcialmente_pago', operational_status: 'novo', client: { name: 'Cliente da venda', phone: null } },
  order: { id: 'order-1', order_number: 'PED-001', operational_status: 'novo', next_action: 'Conferir medidas', blocked_reason: null },
  quote: { id: 'quote-1', quote_number: 'ORC-001' },
  entries: [{ id: 'entry-1', description: 'Venda VEN-001', total_amount: 1000, paid_amount: 200, open_amount: 800, due_date: '2026-11-12', status: 'parcialmente_pago', interest_amount: 20, discount_amount: 5, installment_count: 3, first_installment_due_date: '2026-11-12' }],
  checklist: [{ id: 'check-1', title: 'Medidas conferidas', status: 'pendente', completed_at: null, sort_order: 3 }], measurements: [],
  access: Object.fromEntries(['financial_entries:select','financial_entries:update','payments:insert','orders:select','quotes:select','order_checklist_items:select','order_checklist_items:update','clients:select'].map(key => [key, true])), warnings: [],
});
test('venda oferece pagamento, pedido, orçamento e conferência vinculados aos registros corretos', () => {
  render(<SaleWorkspace data={fixture()} />);
  expect(screen.getByRole('button', { name: 'Registrar pagamento' }).getAttribute('data-entry')).toBe('entry-1');
  expect(screen.getByRole('button', { name: 'Registrar pagamento' }).getAttribute('data-back')).toBe('/vendas/sale-1');
  expect(screen.getByRole('button', { name: 'Registrar pagamento' }).getAttribute('data-adjustment')).toBe('20,5,3');
  expect(screen.getByRole('link', { name: 'Abrir pedido' }).getAttribute('href')).toBe('/pedidos/order-1');
  expect(screen.getByRole('link', { name: 'Conferir medidas' }).getAttribute('href')).toBe('#conferencia-medidas');
  expect(screen.getByRole('link', { name: 'Emitir ficha de conferência' }).getAttribute('href')).toBe('/clientes/client-1/ficha-visita');
  const button = screen.getByRole('button', { name: 'Confirmar medidas conferidas' });
  expect((button.closest('form')?.querySelector('[name=order_id]') as HTMLInputElement).value).toBe('order-1');
});
test.each(['payments:insert','financial_entries:update'])('sem %s não oferece registrar pagamento', right => {
  const data = fixture(); data.access[right] = false; data.access['order_checklist_items:update'] = false;
  render(<SaleWorkspace data={data} />);
  expect(screen.queryByRole('button', { name: 'Registrar pagamento' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Confirmar medidas conferidas' })).toBeNull();
});
test('venda quitada ou conta cancelada não oferece nova baixa', () => {
  const data = fixture(); data.entries[0].status = 'cancelado';
  render(<SaleWorkspace data={data} />); expect(screen.queryByRole('button', { name: 'Registrar pagamento' })).toBeNull();
});
test('venda avulsa sem pedido nem orçamento não inventa vínculos ou etapa de medição', () => {
  const data = fixture(); data.order = null; data.quote = null; data.checklist = [];
  render(<SaleWorkspace data={data} />);
  expect(screen.queryByRole('link', { name: 'Abrir pedido' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Conferir medidas' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeTruthy();
});
test('múltiplas contas permitem escolher o lançamento e preservam o estado de conferência', () => {
  const data = fixture(); data.entries.push({ ...data.entries[0], id: 'entry-2' }); data.checklist[0].status = 'concluido';
  render(<SaleWorkspace data={data} received />);
  expect(screen.getAllByRole('button', { name: 'Registrar pagamento' })).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Registrar pagamento' }).getAttribute('href')).toBe('#contas-da-venda');
  expect(screen.getByRole('button', { name: 'Reabrir conferência' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Pagamento registrado');
});
