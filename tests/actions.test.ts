import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { agendaTypes } from '@/lib/agenda';

const state=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),insert:vi.fn(),update:vi.fn(),result:{data:{id:'00000000-0000-4000-8000-000000000010',company_id:'company'},error:null} as {data:any;error:any},revalidate:vi.fn()}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(`REDIRECT:${path}`)}}));
vi.mock('next/cache',()=>({revalidatePath:state.revalidate}));
vi.mock('next/server',()=>({after:vi.fn()}));
vi.mock('next/headers',()=>({headers:async()=>({get:()=>null})}));
vi.mock('@/lib/generate-quote-pdf',()=>({generateQuotePdfBuffer:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>{const createClient=async()=>({rpc:state.rpc,from:state.from,auth:{getUser:async()=>({data:{user:{id:'00000000-0000-4000-8000-000000000001'}},error:null})}});return {createClient,getRequestClient:createClient,getAuthUser:async(db?:any)=>{const c=db??await createClient();return c.auth?(await c.auth.getUser()).data.user:null;}};});
import { registerPayment, rescheduleEntry, saveGutterQuote, createManualSale, createManualPurchase, createWindowQuote, createClientRecord, toggleChecklistItem } from '@/app/(crm)/actions';
import { createAgendaEvent, updateAgendaEventStatus } from '@/app/(crm)/agenda-actions';

function form(values:Record<string,string>){const data=new FormData();for(const [k,v]of Object.entries(values)) data.set(k,v);return data;}
beforeEach(()=>{
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co');
  state.result={data:{id:'00000000-0000-4000-8000-000000000010',company_id:'company'},error:null};
  state.rpc.mockResolvedValue({data:'00000000-0000-4000-8000-000000000020',error:null});
  state.from.mockImplementation(()=>{
    const q:any={then:(resolve:any)=>Promise.resolve(state.result).then(resolve),single:async()=>state.result};
    for(const method of ['select','eq','neq','order','limit'])q[method]=()=>q;
    q.insert=(values:any)=>{state.insert(values);return q};q.update=(values:any)=>{state.update(values);return q};return q;
  });
});
afterEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();});

test.each(['0','-1','NaN','Infinity','bad'])('invalid payment %s never reaches RPC',async amount=>{await expect(registerPayment(form({entry_id:'00000000-0000-4000-8000-000000000010',amount}))).rejects.toThrow('Revise+os+dados');expect(state.rpc).not.toHaveBeenCalled();});
test('malformed payment identifier is rejected',async()=>{await expect(registerPayment(form({entry_id:'bad',amount:'10'}))).rejects.toThrow('Revise+os+dados');expect(state.rpc).not.toHaveBeenCalled();});
test('payment RPC failures are displayed',async()=>{state.rpc.mockResolvedValue({data:null,error:{message:'Saldo insuficiente'}});await expect(registerPayment(form({entry_id:'00000000-0000-4000-8000-000000000010',amount:'10',paid_at:'2026-10-12'}))).rejects.toThrow('Saldo%20insuficiente');});
test('valid payment uses correct RPC arguments',async()=>{await expect(registerPayment(form({entry_id:'00000000-0000-4000-8000-000000000010',amount:'10',paid_at:'2026-10-12'}))).rejects.toThrow('/financeiro?recebido=1');expect(state.rpc).toHaveBeenCalledWith('register_payment_with_adjustment',expect.objectContaining({p_amount:10,p_paid_at:'2026-10-12'}));});
test('payment cannot redirect outside financial module',async()=>{await expect(registerPayment(form({entry_id:'00000000-0000-4000-8000-000000000010',amount:'10',_back:'https://evil.example'}))).rejects.toThrow('REDIRECT:/financeiro?recebido=1');});
test('invalid due-date renegotiation never reaches RPC',async()=>{await expect(rescheduleEntry(form({entry_id:'bad',new_due_date:'tomorrow'}))).rejects.toThrow('Data+de+vencimento');expect(state.rpc).not.toHaveBeenCalled();});
test.each([saveGutterQuote,createManualSale,createManualPurchase,createWindowQuote])('malformed JSON is a user-facing validation error',async action=>{await expect(action(form({payload:'{bad json'}))).rejects.toThrow('Dados');expect(state.rpc).not.toHaveBeenCalled();});
test('invalid customer email never inserts record',async()=>{await expect(createClientRecord(form({name:'Cliente',email:'invalid'}))).rejects.toThrow('Revise os campos');expect(state.insert).not.toHaveBeenCalled();});
test('blank quote cannot be saved',async()=>{await expect(saveGutterQuote(form({payload:JSON.stringify({client_id:'00000000-0000-4000-8000-000000000010',discount:0,freight:0,notes:'',items:[]})}))).rejects.toThrow('Revise os itens');expect(state.rpc).not.toHaveBeenCalled();});

test.each([...agendaTypes])('agenda preserves selected type %s',async type=>{
  expect(await createAgendaEvent(form({title:'Evento',date:'2026-10-12',time:'08:00',type,client_name:'Cliente avulso',responsible_name:'Instalador'}))).toBeUndefined();
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({event_type:type,starts_at:'2026-10-12T08:00:00-03:00',client_name:'Cliente avulso',responsible_name:'Instalador'}));
});
test('agenda rejects impossible date',async()=>{expect(await createAgendaEvent(form({title:'Evento',date:'2026-02-30',time:'08:00'}))).toEqual({error:'Data ou horário inválidos'});expect(state.insert).not.toHaveBeenCalled();});
test('agenda update changes only the originating table',async()=>{await updateAgendaEventStatus('00000000-0000-4000-8000-000000000010','concluido','measurements');expect(state.from).toHaveBeenCalledTimes(1);expect(state.from).toHaveBeenCalledWith('measurements');expect(state.update).toHaveBeenCalledWith(expect.objectContaining({status:'medicao_concluida'}));});
test('agenda denied update surfaces error',async()=>{state.result={data:null,error:{message:'Sem permissão'}};await expect(updateAgendaEventStatus('00000000-0000-4000-8000-000000000010','concluido','tasks')).rejects.toThrow('Sem permissão');expect(state.revalidate).not.toHaveBeenCalled();});
test('agenda invalid origin never issues update',async()=>{await expect(updateAgendaEventStatus('00000000-0000-4000-8000-000000000010','concluido','companies' as any)).rejects.toThrow('Evento inválido');expect(state.from).not.toHaveBeenCalled();});

test('client address saves optional neighborhood and an unformatted CEP', async () => {
  await expect(createClientRecord(form({ name: 'Cliente', address: ' Rua A, 20 ', neighborhood: ' Centro ', postal_code: '89251-000', state: 'sc' })))
    .rejects.toThrow('REDIRECT:/clientes/');
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({
    address: 'Rua A, 20', neighborhood: 'Centro', postal_code: '89251000', state: 'SC',
  }));
});

test('client can be saved with no address, but a partial CEP is rejected', async () => {
  await expect(createClientRecord(form({ name: 'Cliente', postal_code: '892' }))).rejects.toThrow('Revise os campos');
  expect(state.insert).not.toHaveBeenCalled();
  await expect(createClientRecord(form({ name: 'Cliente', postal_code: '' }))).rejects.toThrow('REDIRECT:/clientes/');
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ postal_code: null }));
});

const saleReturn = '/vendas/00000000-0000-4000-8000-000000000055';
test('pagamento pode voltar à venda e atualiza também os saldos das telas de venda e pedido', async () => {
  await expect(registerPayment(form({ entry_id:'00000000-0000-4000-8000-000000000010', amount:'10', _back:saleReturn }))).rejects.toThrow(`REDIRECT:${saleReturn}?recebido=1`);
  expect(state.revalidate).toHaveBeenCalledWith('/vendas','layout');
  expect(state.revalidate).toHaveBeenCalledWith('/pedidos','layout');
});
test('retorno inválido de venda é rejeitado', async () => {
  await expect(registerPayment(form({ entry_id:'00000000-0000-4000-8000-000000000010', amount:'10', _back:'/vendas/https://evil.example' }))).rejects.toThrow('REDIRECT:/financeiro?recebido=1');
});
test('conferência salva no checklist e volta à seção da venda', async () => {
  await expect(toggleChecklistItem(form({ id:'00000000-0000-4000-8000-000000000010', order_id:'00000000-0000-4000-8000-000000000020', status:'pendente', _back:saleReturn }))).rejects.toThrow(`REDIRECT:${saleReturn}#conferencia-medidas`);
  expect(state.update).toHaveBeenCalledWith(expect.objectContaining({status:'concluido'}));
});
