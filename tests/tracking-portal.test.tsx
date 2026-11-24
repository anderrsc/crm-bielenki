import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
const {rpc,loadTracking}=vi.hoisted(()=>({rpc:vi.fn(),loadTracking:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({getRequestClient:async()=>({rpc})}));
vi.mock('@/lib/tracking-view',()=>({loadTracking}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw new Error(`REDIRECT ${url}`);}}));
import Page from '@/app/(crm)/equipes/rastreamento/page';
import {TrackingPortal} from '@/components/tracking-portal';
beforeEach(()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://localhost:54321');rpc.mockReset();loadTracking.mockReset();});
afterEach(()=>vi.unstubAllEnvs());

test('painel abre o portal normal sem quadro ou credenciais e mantém alternativa segura',()=>{
 const html=renderToStaticMarkup(<TrackingPortal/>);
 expect(html).toContain('href="https://gps.trackceo.com/V2/index.jsp"');expect(html).not.toContain('<iframe');expect(html).toContain('noopener noreferrer');
 expect(html).not.toMatch(/token=|account=|password=|postMessage/);expect(html).toContain('não são sincronizados');
});

test('painel exige a mesma autorização de gerência antes de renderizar o site externo',async()=>{
 for(const result of [{error:{code:'42501'},data:null},{error:null,data:null}]){
  rpc.mockResolvedValue(result);
  await expect(Page({searchParams:Promise.resolve({painel:'1'})})).rejects.toThrow('REDIRECT /equipes');
 }
 expect(rpc).toHaveBeenCalledWith('trackceo_status');expect(loadTracking).not.toHaveBeenCalled();
});

test('gerência abre o portal sem consultar GPS, obter segredos ou depender da API TrackCEO',async()=>{
 rpc.mockResolvedValue({error:null,data:{company_id:'company',active:false}});
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({painel:'1'})}));
 expect(html).toContain('Rastreamento em janela própria');expect(loadTracking).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);
});
