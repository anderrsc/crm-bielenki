// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {TrackingPortal} from '@/components/tracking-portal';
import {trackingPortalUrl,TRACKCEO_PORTAL_URL} from '@/lib/tracking-portal-url';
let current:{closed:boolean}|undefined;
afterEach(()=>{if(current)current.closed=true;current=undefined;cleanup();vi.restoreAllMocks();vi.unstubAllEnvs();});
test('a janela perde o acesso ao CRM antes de navegar e o segundo clique apenas a localiza',()=>{
 const order:string[]=[];const replace=vi.fn(()=>order.push('navigate')),focus=vi.fn();
 const popup={closed:false,focus,close:vi.fn(),location:{replace},set opener(value:unknown){expect(value).toBeNull();order.push('detach');}};current=popup;
 const open=vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window);
 render(<TrackingPortal/>);fireEvent.click(screen.getByRole('button',{name:'Abrir rastreamento'}));
 expect(order).toEqual(['detach','navigate']);expect(replace).toHaveBeenCalledWith(TRACKCEO_PORTAL_URL);expect(screen.getByRole('status').textContent).not.toMatch(/conectado/i);
 fireEvent.click(screen.getByRole('button',{name:'Abrir rastreamento'}));expect(open).toHaveBeenCalledTimes(1);expect(focus).toHaveBeenCalledTimes(1);
 popup.closed=true;fireEvent.click(screen.getByRole('button',{name:'Abrir rastreamento'}));expect(open).toHaveBeenCalledTimes(2);
});
test('janela bloqueada oferece link normal sem afirmar que abriu ou conectou',()=>{
 vi.spyOn(window,'open').mockReturnValue(null);render(<TrackingPortal/>);fireEvent.click(screen.getByRole('button',{name:'Abrir rastreamento'}));
 expect(screen.getByRole('alert').textContent).toContain('não abriu');const link=screen.getByRole('link',{name:'Abrir TrackCEO em nova guia'});expect(link.getAttribute('href')).toBe(TRACKCEO_PORTAL_URL);expect(link.getAttribute('rel')).toBe('noopener noreferrer');
});
test('falha ao desligar opener fecha a janela vazia sem navegar para o fornecedor',()=>{
 const replace=vi.fn(),close=vi.fn();const popup={closed:false,location:{replace},close,set opener(_value:unknown){throw new Error('blocked');}};current=popup;
 vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window);render(<TrackingPortal/>);fireEvent.click(screen.getByRole('button',{name:'Abrir rastreamento'}));
 expect(close).toHaveBeenCalled();expect(replace).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
});
test('portal de teste exige as três variáveis isoladas e ignora URL arbitrária',()=>{
 vi.stubEnv('CRM_E2E_TEST_MODE','1');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://localhost:54321');vi.stubEnv('TRACKCEO_TEST_API_ORIGIN','https://externo.invalid');expect(trackingPortalUrl()).toBe(TRACKCEO_PORTAL_URL);
 vi.stubEnv('TRACKCEO_TEST_API_ORIGIN','http://127.0.0.1:54323');expect(trackingPortalUrl()).toBe('http://127.0.0.1:54323/portal');
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://producao.invalid');expect(trackingPortalUrl()).toBe(TRACKCEO_PORTAL_URL);
});
