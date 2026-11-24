import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
vi.mock('@/components/tracking-map',()=>({TrackingMap:({points}:{points:unknown[]})=><div data-count={points.length}>Mapa</div>}));
import {TrackingPage} from '@/components/tracking-page';
import {positionAge,type TrackingData} from '@/lib/tracking-view';
const empty:TrackingData={status:{company_id:'company',account:null,active:false,configured:false,last_sync_at:null,last_error:null,busy:false},devices:[],vehicles:[],days:[]};
test('conexão desligada pede senha protegida sem preeenchimento nem posição no mapa',()=>{
 const html=renderToStaticMarkup(<TrackingPage data={empty}/>);expect(html).toContain('type="password"');expect(html).not.toMatch(/name="password"[^>]*value=/);expect(html).toContain('method="post"');expect(html).toContain('criptografada');expect(html).not.toContain('data-count');
});
test('posição antiga continua identificada; mapa só recebe veículos vinculados e válidos',()=>{
 const device={id:'d',imei:'860000000000001',name:'<script>alert(1)</script>',model:'T',plate:null,vehicle_id:'v',available:true,latitude:-26.4,longitude:-49.1,gps_at:'2020-01-01T00:00:00Z',heartbeat_at:null,speed:0,ignition:0,provider_status:4,synced_at:'2026-11-24T15:00:00Z'};
 const data:TrackingData={...empty,status:{...empty.status,active:true,configured:true,account:'conta'},vehicles:[{id:'v',name:'Van',plate:'ABC1D23',status:'disponivel'}],devices:[device,{...device,id:'d2',imei:'860000000000002',vehicle_id:null}]};
 const html=renderToStaticMarkup(<TrackingPage data={data}/>);expect(html).toContain('data-count="1"');expect(html).toContain('Posição antiga');expect(html).toContain('Offline');expect(html).not.toContain('<script>alert');expect(html).toContain('Desconectar do CRM');
 expect(positionAge(null)).toBe('unknown');expect(positionAge('invalido')).toBe('unknown');
});
