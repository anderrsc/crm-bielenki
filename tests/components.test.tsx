// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PendingCenter } from '@/components/pending-center';
import { ManualSaleForm } from '@/components/manual-sale-form';
import { ManualPurchaseForm } from '@/components/manual-purchase-form';
import { ModuleTable } from '@/components/module-table';
import { modules } from '@/lib/modules';
import { AgendaPage } from '@/components/agenda-page';

const mocks=vi.hoisted(()=>({rpc:vi.fn(),getAgenda:vi.fn().mockResolvedValue([]),updateAgenda:vi.fn(),createAgenda:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('@/app/(crm)/actions',()=>({createManualSale:vi.fn(),createManualPurchase:vi.fn()}));
vi.mock('@/app/(crm)/agenda-actions',()=>({getAgendaEvents:mocks.getAgenda,updateAgendaEventStatus:mocks.updateAgenda,createAgendaEvent:mocks.createAgenda}));
afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.clearAllMocks();});
const options=[{id:'one',name:'Cliente teste'}];

test('pending financial tab is visible with receivable and payable count',async()=>{
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co');
  mocks.rpc.mockResolvedValue({data:[{record_id:'one',category:'financeiro_receber',title:'Receber',priority:'high',link:'/financeiro'},{record_id:'two',category:'financeiro_pagar',title:'Pagar',priority:'low',link:'/financeiro'}],error:null});
  render(await PendingCenter({category:'financeiro'}));
  expect(screen.getByRole('link',{name:/Financeiro\s*2/})).toBeTruthy();expect(screen.getByText('Receber')).toBeTruthy();
});
test('RPC errors do not falsely show everything up to date',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co');mocks.rpc.mockResolvedValue({data:null,error:{message:'column pu.total_amount does not exist'}});render(await PendingCenter({}));expect(screen.queryByText('Tudo em dia!')).toBeNull();expect(screen.getByText(/Não foi possível carregar/)).toBeTruthy();});
test('unconfigured database does not falsely show everything up to date',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','');render(await PendingCenter({}));expect(screen.queryByText('Tudo em dia!')).toBeNull();expect(screen.getByText(/Configure a conexão/)).toBeTruthy();});
test('genuine empty response shows everything up to date',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co');mocks.rpc.mockResolvedValue({data:[],error:null});render(await PendingCenter({}));expect(screen.getByText('Tudo em dia!')).toBeTruthy();});

test.each(Object.keys(modules))('module %s handles empty, data and query error',key=>{
  const cfg=modules[key];const {rerender}=render(<ModuleTable config={cfg} rows={[]} base={key}/>);
  expect(screen.getByText('Nenhum registro encontrado')).toBeTruthy();
  rerender(<ModuleTable config={cfg} rows={[{id:'test',name:'Cliente',order_number:'PED-1',quote_number:'ORC-1',client:{name:'Cliente'},total:100}]} base={key}/>);
  expect(screen.getByRole('link',{name:'Abrir'}).getAttribute('href')).toBe(`/${key}/test`);
  rerender(<ModuleTable config={cfg} rows={[]} base={key} error="connection failed"/>);
  expect(screen.getByText(/Falha ao consultar os dados/)).toBeTruthy();expect(screen.queryByText('Nenhum registro encontrado')).toBeNull();
});
test('pagination preserves query text',()=>{render(<ModuleTable config={modules.clientes} rows={[]} base="clientes" query="João & Maria" page={2} hasMore/>);expect(screen.getByRole('link',{name:'Próxima'}).getAttribute('href')).toBe('/clientes?pagina=3&q=Jo%C3%A3o%20%26%20Maria');});

function fillSale() {
  render(<ManualSaleForm clients={options} saleTypes={[{id:'type',name:'Calhas'}]}/>);
  fireEvent.change(screen.getByLabelText('Cliente'),{target:{value:'one'}});
  fireEvent.change(screen.getByLabelText('Tipo de venda'),{target:{value:'type'}});
  fireEvent.change(screen.getByLabelText('Produto / serviço'),{target:{value:'Calha'}});
  fireEvent.change(screen.getByLabelText('Valor unitário'),{target:{value:'100'}});
}
test('sale can be submitted without optional description',()=>{fillSale();expect((screen.getByRole('button',{name:'Cadastrar venda'}) as HTMLButtonElement).disabled).toBe(false);expect((document.querySelector('form') as HTMLFormElement).checkValidity()).toBe(true);});
test('sale payload tracks quantities and payments',()=>{fillSale();fireEvent.change(screen.getByLabelText('Quantidade'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Valor já recebido'),{target:{value:'50'}});const payload=JSON.parse((document.querySelector('[name=payload]') as HTMLInputElement).value);expect(payload.items[0].quantity).toBe(2);expect(payload.paid_amount).toBe(50);});
test.each([0,-1])('sale with quantity %i cannot be submitted',quantity=>{fillSale();fireEvent.change(screen.getByLabelText('Quantidade'),{target:{value:String(quantity)}});expect((screen.getByRole('button',{name:'Cadastrar venda'}) as HTMLButtonElement).disabled).toBe(true);});
test('sale blocks payment greater than total',()=>{fillSale();fireEvent.change(screen.getByLabelText('Valor já recebido'),{target:{value:'101'}});expect((screen.getByRole('button',{name:'Cadastrar venda'}) as HTMLButtonElement).disabled).toBe(true);});
test('sale adds and removes items',()=>{fillSale();fireEvent.click(screen.getByRole('button',{name:'Adicionar item'}));expect(screen.getAllByLabelText('Produto / serviço')).toHaveLength(2);const remove=document.querySelectorAll('button.text-red-600');fireEvent.click(remove[1]);expect(screen.getAllByLabelText('Produto / serviço')).toHaveLength(1);});

function fillPurchase() {
  render(<ManualPurchaseForm suppliers={options} materials={[{id:'material',name:'Chapa',unit:'m'}]}/>);
  fireEvent.change(screen.getByLabelText('Fornecedor'),{target:{value:'one'}});
  fireEvent.change(screen.getByLabelText('Material existente'),{target:{value:'material'}});
  fireEvent.change(screen.getByLabelText('Valor unitário'),{target:{value:'10'}});
}
test('material selection fills description and unit',()=>{fillPurchase();expect((screen.getByLabelText('Descrição do material') as HTMLInputElement).value).toBe('Chapa');expect((screen.getByLabelText('Unidade') as HTMLInputElement).value).toBe('m');});
test('purchase can submit with optional observations blank',()=>{fillPurchase();expect((screen.getByRole('button',{name:'Cadastrar compra'}) as HTMLButtonElement).disabled).toBe(false);expect((document.querySelector('form') as HTMLFormElement).checkValidity()).toBe(true);});
test('purchase cannot submit negative payment',()=>{fillPurchase();fireEvent.change(screen.getByLabelText('Valor já pago'),{target:{value:'-1'}});expect((screen.getByRole('button',{name:'Cadastrar compra'}) as HTMLButtonElement).disabled).toBe(true);});
test('purchase cannot submit an empty row',()=>{fillPurchase();fireEvent.click(screen.getByRole('button',{name:'Adicionar item'}));expect((screen.getByRole('button',{name:'Cadastrar compra'}) as HTMLButtonElement).disabled).toBe(true);});

test('agenda month navigation does not skip February from January 31',()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,0,31,12));render(<AgendaPage initialEvents={[]}/>);fireEvent.click(screen.getByRole('button',{name:'Próximo período'}));expect(screen.getByText('Fevereiro 2026')).toBeTruthy();vi.useRealTimers();});
test('agenda switches month, week and day views',()=>{render(<AgendaPage initialEvents={[]}/>);fireEvent.click(screen.getByRole('button',{name:'Dia'}));expect(screen.getByText('0 eventos')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Semana'}));expect(screen.queryByText('0 eventos')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Mês'}));expect(screen.getByRole('button',{name:'Hoje'})).toBeTruthy();});

test('agenda day includes evening events',()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,12,12));const starts=new Date(2026,9,12,22).toISOString();render(<AgendaPage initialEvents={[{id:'evening',source:'operational_events',title:'Reunião noturna',type:'reuniao',starts_at:starts,status:'agendado'}]}/>);fireEvent.click(screen.getByRole('button',{name:'Dia'}));expect(screen.getByText(/Reunião noturna/)).toBeTruthy();vi.useRealTimers();});
