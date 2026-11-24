import {afterEach,expect,test,vi} from 'vitest';
import {createTrackceoClient,trackceoSignature,normalizeDevices,addPositions,TrackingError} from '@/lib/trackceo';
const now=Date.parse('2026-11-24T15:00:00Z'),imei='860000000000001';
const device={imei,devicename:'Van de teste',devicetype:'TEST',platenumber:'ABC1D23',simcard:'não deve ser guardado'};
const response=(record:unknown,code=0)=>new Response(JSON.stringify({record,code}),{headers:{'Content-Type':'application/json'}});
afterEach(()=>vi.unstubAllEnvs());
test('assinatura segue o exemplo oficial, sem enviar a senha na URL',async()=>{
 expect(trackceoSignature('Abc@34590',1556243443)).toBe('3844afd2c3bf68f0f3f4aa0a9ee8ee6c');
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({access_token:'token-de-teste',expires_in:7200})).mockResolvedValueOnce(response([device])).mockResolvedValueOnce(response([{imei,latitude:-26.4,longitude:-49.1,gpstime:Math.floor(now/1000),speed:30,accstatus:1,datastatus:2}]));
 const result=await createTrackceoClient({account:'frota-teste',password:'Abc@34590',fetchImpl:fetcher,now:()=>now}).sync();
 const urls=fetcher.mock.calls.map(c=>String(c[0]));expect(urls.every(u=>u.startsWith('https://api.trackceo.com/api/'))).toBe(true);expect(urls.join('')).not.toContain('Abc@34590');
 expect(result.devices[0]).toMatchObject({name:'Van de teste',latitude:-26.4,speed:30,ignition:1});expect(result.devices[0]).not.toHaveProperty('simcard');
 expect(fetcher.mock.calls.every(c=>c[1]?.redirect==='error'&&c[1]?.cache==='no-store')).toBe(true);
});
test('token válido é reaproveitado; token vencido no provedor é renovado uma única vez',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response(null,10012)).mockResolvedValueOnce(response({access_token:'novo-token',expires_in:7200})).mockResolvedValueOnce(response([device])).mockResolvedValueOnce(response([]));
 await createTrackceoClient({account:'a',password:'segredo',token:'token-antigo',expiresAt:new Date(now+7200000).toISOString(),fetchImpl:fetcher,now:()=>now}).sync();
 expect(fetcher.mock.calls.map(c=>new URL(String(c[0])).pathname)).toEqual(['/api/device/list','/api/authorization','/api/device/list','/api/track']);
});
test('10013 e mensagem do fornecedor são substituídos por erro seguro, sem ecoar segredo',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({code:10013,message:'secret_token=nao-exibir'})));
 await expect(createTrackceoClient({account:'a',password:'pw',token:'t',expiresAt:new Date(now+7200000).toISOString(),fetchImpl:fetcher,now:()=>now}).sync()).rejects.toMatchObject({code:'permission'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
test('limita consultas a 100 IMEIs por lote e nunca chama comandos',async()=>{
 const devices=Array.from({length:201},(_,i)=>({...device,imei:String(860000000000000+i)}));
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>new URL(String(url)).pathname==='/api/device/list'?response(devices):response([]));
 await createTrackceoClient({account:'a',password:'p',token:'t',expiresAt:new Date(now+7200000).toISOString(),fetchImpl:fetcher,now:()=>now}).sync();
 const calls=fetcher.mock.calls.map(c=>new URL(String(c[0])));expect(calls.slice(1).map(u=>u.searchParams.get('imeis')!.split(',').length)).toEqual([100,100,1]);expect(calls.some(u=>/command|message|geofence/.test(u.pathname))).toBe(false);
});
test('dados inválidos, repetidos, posição sem data e IMEI estranho são barrados',()=>{
 expect(()=>normalizeDevices([{...device,imei:'errado'}])).toThrow(TrackingError);expect(()=>normalizeDevices([device,device])).toThrow(TrackingError);
 const devices=normalizeDevices([device]);
 expect(addPositions(devices,[{imei,latitude:100,longitude:-49,gpstime:now/1000}],now)[0].gps_at).toBeNull();
 expect(addPositions(devices,[{imei,latitude:-26,longitude:-49,gpstime:0}],now)[0].latitude).toBeNull();
 expect(()=>addPositions(devices,[{imei:'860000000000999'}],now)).toThrow(TrackingError);
});
test('falha de rede não expõe URL; resposta enorme é recusada',async()=>{
 const broken=vi.fn<typeof fetch>().mockRejectedValue(new Error('https://api.trackceo.com?access_token=SEGREDO'));
 await expect(createTrackceoClient({account:'a',password:'p',fetchImpl:broken,now:()=>now}).sync()).rejects.toMatchObject({code:'unavailable',message:expect.not.stringContaining('SEGREDO')});
 const huge=vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1024*1024+1)));
 await expect(createTrackceoClient({account:'a',password:'p',fetchImpl:huge,now:()=>now}).sync()).rejects.toMatchObject({code:'invalid_response'});
});
test('desvio para o backend E2E exige as três configurações isoladas',async()=>{
 vi.stubEnv('CRM_E2E_TEST_MODE','1');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://localhost:54321');vi.stubEnv('TRACKCEO_TEST_API_ORIGIN','https://externo.invalid');
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response([]));
 await createTrackceoClient({account:'a',password:'p',token:'t',expiresAt:new Date(now+7200000).toISOString(),fetchImpl:fetcher,now:()=>now}).sync();
 expect(String(fetcher.mock.calls[0][0])).toMatch(/^https:\/\/api\.trackceo\.com\//);
 vi.stubEnv('TRACKCEO_TEST_API_ORIGIN','http://127.0.0.1:54323');fetcher.mockClear();
 await createTrackceoClient({account:'a',password:'p',token:'t',expiresAt:new Date(now+7200000).toISOString(),fetchImpl:fetcher,now:()=>now}).sync();
 expect(String(fetcher.mock.calls[0][0])).toMatch(/^http:\/\/127\.0\.0\.1:54323\//);
});
