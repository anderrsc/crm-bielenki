import {beforeEach,expect,test,vi} from 'vitest';
import {NextRequest} from 'next/server';
const {save,user}=vi.hoisted(()=>({save:vi.fn(),user:vi.fn()}));
vi.mock('@/app/(crm)/work-planning-actions',()=>({saveWorkPlanning:save}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({}),getAuthUser:user}));
import {POST} from '@/app/api/equipes/route';
beforeEach(()=>{save.mockReset();save.mockResolvedValue('/equipes?dia=2026-11-23&salvo=1');user.mockReset();user.mockResolvedValue({id:'user'});});
const request=(origin='http://localhost:3000')=>new NextRequest('http://localhost:3000/api/equipes',{method:'POST',headers:{origin},body:new URLSearchParams({action:'day'})});
test('salvar retorna 303 para GET da lista, sem navegação parcial do App Router',async()=>{
 const response=await POST(request());expect(response.status).toBe(303);expect(response.headers.get('location')).toBe('http://localhost:3000/equipes?dia=2026-11-23&salvo=1');expect(save).toHaveBeenCalledOnce();
});
test('origem externa e sessão ausente não executam a gravação',async()=>{
 expect((await POST(request('https://outro.invalid'))).status).toBe(403);expect(save).not.toHaveBeenCalled();
 user.mockResolvedValue(null);expect((await POST(request())).status).toBe(401);expect(save).not.toHaveBeenCalled();
});
