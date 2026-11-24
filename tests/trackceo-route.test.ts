import {beforeEach,test,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const {rpc,user,sync,revalidate}=vi.hoisted(()=>({rpc:vi.fn(),user:vi.fn(),sync:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc}),getAuthUser:user}));
vi.mock('@/lib/trackceo-service',()=>({syncTracking:sync}));
vi.mock('next/cache',()=>({revalidatePath:revalidate}));
import {POST} from '@/app/api/equipes/rastreamento/route';
import {TrackingError} from '@/lib/trackceo';
const company='00000000-0000-4000-8000-00000000c001',actor='00000000-0000-4000-8000-00000000c002';
function request(values:Record<string,string>,origin='http://localhost:3000'){return new NextRequest('http://localhost:3000/api/equipes/rastreamento',{method:'POST',headers:{origin},body:new URLSearchParams(values)});}
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:{company_id:company},error:null});user.mockReset();user.mockResolvedValue({id:actor});sync.mockReset();sync.mockResolvedValue({devices:2});revalidate.mockClear();});
test('conexão autenticada envia credenciais apenas ao serviço; retorno 303 não contém senha',async()=>{
 const response=await POST(request({action:'connect',account:'frota-teste',password:'senha-ficticia'}));
 expect(sync).toHaveBeenCalledWith({companyId:company,actorId:actor,credentials:{account:'frota-teste',password:'senha-ficticia'}});
 expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('http://localhost:3000/equipes/rastreamento?salvo=1');
 expect(revalidate).toHaveBeenCalledWith('/equipes/rastreamento');
});
test('origem externa, sessão ausente e usuário sem gerência não chegam ao fornecedor',async()=>{
 expect((await POST(request({action:'sync'},'https://externo.invalid'))).status).toBe(403);expect(rpc).not.toHaveBeenCalled();
 user.mockResolvedValue(null);expect((await POST(request({action:'sync'}))).status).toBe(401);
 user.mockResolvedValue({id:actor});rpc.mockResolvedValue({error:{code:'42501'},data:null});expect((await POST(request({action:'sync'}))).status).toBe(403);expect(sync).not.toHaveBeenCalled();
});
test('validação rejeita comando, URL de servidor arbitrária e vínculo UUID inválido',async()=>{
 const cases:Record<string,string>[]=[{action:'command',command:'RELAY,1'},{action:'connect',account:'a',password:''},{action:'link',device:'bad',vehicle:''}];
 for(const values of cases){
  const r=await POST(request(values));expect(r.status).toBe(303);expect(r.headers.get('location')).toContain('erro=');
 }
 expect(sync).not.toHaveBeenCalled();
});
test('erro do provedor volta com mensagem segura e desconectar usa a sessão do usuário',async()=>{
 sync.mockRejectedValue(new TrackingError('credentials'));
 const r=await POST(request({action:'sync'}));expect(decodeURIComponent(r.headers.get('location')!)).toContain('Conta ou senha');
 await POST(request({action:'disconnect'}));expect(rpc).toHaveBeenCalledWith('trackceo_disconnect');
});
