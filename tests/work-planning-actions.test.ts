import {beforeEach,expect,test,vi} from 'vitest';
const {rpc,revalidate}=vi.hoisted(()=>({rpc:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc})}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error(url);}}));
vi.mock('next/cache',()=>({revalidatePath:revalidate}));
import {saveWorkPlanning} from '@/app/(crm)/work-planning-actions';
const id='00000000-0000-4000-8000-00000000b001';
const form=(data:Record<string,string|undefined>)=>{const f=new FormData();for(const [k,v] of Object.entries(data))if(v!==undefined)f.set(k,v);return f;};
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({error:null});revalidate.mockClear();});
test('formulário de visita envia fonte e UUID à RPC autenticada',async()=>{
 await expect(saveWorkPlanning(form({action:'job',day_id:id,source_choice:`measurements:${id}`,position:'2',_back:'/equipes?dia=2026-11-23'}))).rejects.toThrow('salvo=1');
 expect(rpc).toHaveBeenCalledWith('work_manage',{p_action:'job',p_payload:{day_id:id,source:'measurements',source_id:id,position:2}});
 expect(revalidate).toHaveBeenCalledWith('/agenda');
});
test('quantidade zero, capacidade zero e UUID inválido não chegam ao banco',async()=>{
 for(const data of [
 {action:'load_add',job_id:id,description:'Vidro',kind:'item',quantity:'0',unit:'un'},
 {action:'vehicle',name:'Van',plate:'',vehicle_type:'Van',capacity_kg:'0',useful_length_m:'',status:'disponivel'},
 {action:'job',day_id:id,source_choice:'measurements:invalido',position:'1'},
 ])await expect(saveWorkPlanning(form(data))).rejects.toThrow('Confira');
 expect(rpc).not.toHaveBeenCalled();
});
test('conflito de reserva tem mensagem clara e retorno fica no módulo',async()=>{
 rpc.mockResolvedValue({error:{code:'23505'}});
 await expect(saveWorkPlanning(form({action:'day_status',id,status:'cancelada',_back:'https://example.com'}))).rejects.toThrow('/equipes?erro=');
 expect(revalidate).not.toHaveBeenCalled();
});
