import {beforeEach,afterEach,test,expect,vi} from 'vitest';
const {make,sync}=vi.hoisted(()=>({make:vi.fn(),sync:vi.fn()}));
vi.mock('@/lib/trackceo',async importOriginal=>({...await importOriginal<object>(),createTrackceoClient:make}));
import {syncTracking} from '@/lib/trackceo-service';
import {encryptSecret,decryptSecret} from '@/lib/encrypt';
import type {SupabaseClient} from '@supabase/supabase-js';
const companyId='00000000-0000-4000-8000-00000000c001',actorId='00000000-0000-4000-8000-00000000c002';
beforeEach(()=>{vi.stubEnv('ENCRYPTION_KEY','0'.repeat(64));make.mockReset();make.mockReturnValue({sync});sync.mockReset();sync.mockResolvedValue({devices:[],token:'token-ficticio',expiresAt:'2027-01-01T00:00:00Z'});});
afterEach(()=>vi.unstubAllEnvs());
test('senha e token são criptografados antes de gravar; sincronização seguinte usa o token compartilhado',async()=>{
 const lease={lease_id:'lease',account:'conta',password_encrypted:encryptSecret('senha'),token_encrypted:encryptSecret('token-anterior'),token_expires_at:'2027-01-01T00:00:00Z'};
 const rpc=vi.fn().mockResolvedValueOnce({data:lease,error:null}).mockResolvedValue({data:{},error:null});
 await syncTracking({companyId,actorId,credentials:{account:'conta',password:'senha'},backend:{rpc} as unknown as SupabaseClient});
 const payload=rpc.mock.calls[1][1].p_payload;expect(payload.password_encrypted).toMatch(/^enc:/);expect(decryptSecret(payload.password_encrypted)).toBe('senha');expect(decryptSecret(payload.token_encrypted)).toBe('token-ficticio');expect(JSON.stringify(payload)).not.toContain('token-ficticio');
 rpc.mockReset();rpc.mockResolvedValueOnce({data:lease,error:null}).mockResolvedValue({data:{},error:null});
 await syncTracking({companyId,actorId,backend:{rpc} as unknown as SupabaseClient});expect(make).toHaveBeenLastCalledWith(expect.objectContaining({password:'senha',token:'token-anterior'}));expect(rpc.mock.calls[1][1].p_payload).not.toHaveProperty('password_encrypted');
});
test('lease ocupado não chama a API e falha inesperada libera a trava sem gravar detalhes sensíveis',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{busy:true},error:null});
 await expect(syncTracking({companyId,actorId,backend:{rpc} as unknown as SupabaseClient})).rejects.toMatchObject({code:'rate_limit'});expect(make).not.toHaveBeenCalled();
 rpc.mockReset();rpc.mockResolvedValueOnce({data:{lease_id:'lease',account:'a',password_encrypted:encryptSecret('p')},error:null}).mockResolvedValue({data:{},error:null});sync.mockRejectedValue(new Error('secret-token-in-url'));
 await expect(syncTracking({companyId,actorId,backend:{rpc} as unknown as SupabaseClient})).rejects.toMatchObject({code:'unavailable',message:expect.not.stringContaining('secret-token')});
 expect(rpc.mock.calls[1][1].p_payload).toEqual({actor_id:actorId,lease_id:'lease',error:'unavailable'});
});
