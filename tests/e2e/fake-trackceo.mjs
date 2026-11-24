import http from 'node:http';
import {createHash} from 'node:crypto';
// Provedor fictício local. Nenhum teste chama a API real ou envia comandos.
export async function startFakeTrackceo(){
 const calls=[];const token='trackceo-token-ficticio';const md5=s=>createHash('md5').update(s).digest('hex');
 const devices=[{imei:'860000000000001',devicename:'Van GPS teste',devicetype:'TEST',platenumber:'GPS1A23'},{imei:'860000000000002',devicename:'Utilitário GPS teste',devicetype:'TEST',platenumber:'GPS2B34'}];
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1:54323');const send=(record,code=0)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({code,record}));};
  if(u.pathname==='/health')return send({fake:true,calls});
  if(u.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(u.pathname==='/portal'){
   if(req.method==='POST'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413);return res.end();}}
    const form=new URLSearchParams(body);if(form.get('account')!=='frota-teste'||form.get('password')!=='senha-gps-teste'){res.writeHead(403);return res.end('Credenciais fictícias inválidas');}
    res.writeHead(303,{'Set-Cookie':'fake_portal=ok; HttpOnly; SameSite=Lax; Path=/portal','Location':'/portal'});return res.end();
   }
   const connected=/(?:^|;\s*)fake_portal=ok(?:;|$)/.test(req.headers.cookie??'');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
   return res.end(connected?'<!doctype html><meta charset="utf-8"><h1 data-testid="fake-portal-connected">Veículos fictícios</h1>':'<!doctype html><meta charset="utf-8"><form method="post" action="/portal"><label>Conta <input name="account" required></label><label>Senha <input name="password" type="password" required></label><button>Entrar</button></form>');
  }
  calls.push(u.pathname);
  if(req.method!=='GET')return send(null,10001);
  if(u.pathname==='/api/authorization'){
   const signature=md5(md5('senha-gps-teste')+u.searchParams.get('time'));
   return u.searchParams.get('account')==='frota-teste'&&u.searchParams.get('signature')===signature?send({access_token:token,expires_in:7200}):send(null,20001);
  }
  if(u.searchParams.get('access_token')!==token)return send(null,10012);
  if(u.pathname==='/api/device/list')return send(devices);
  if(u.pathname==='/api/track'){
   const wanted=new Set((u.searchParams.get('imeis')??'').split(','));return send(devices.filter(d=>wanted.has(d.imei)).map((d,i)=>({imei:d.imei,latitude:-26.47+i*0.002,longitude:-49.08+i*0.002,gpstime:Math.floor(Date.now()/1000),hearttime:Math.floor(Date.now()/1000),speed:0,accstatus:i?1:0,datastatus:2})));
  }
  return send(null,10001);
 });
 await new Promise(resolve=>server.listen(54323,'127.0.0.1',resolve));return server;
}
