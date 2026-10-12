import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error The standalone production runner is intentionally ESM JS.
import { checkRoute, ROUTES } from '../scripts/smoke-test.mjs';

test.each([301,302,307,308,401,403,404,500])('HTTP %i cannot be reported as healthy',async status=>{
  const result=await checkRoute('','/pendencias','https://test.example',async()=>new Response('',{status,headers:{location:'/dashboard?erro=Sem+permissao'}}));
  expect(result.ok).toBe(false);
});
test('HTTP 200 containing database error is unhealthy',async()=>expect((await checkRoute('','/pendencias','https://test.example',async()=>new Response('Falha ao consultar os dados: missing relation'))).ok).toBe(false));
test('network failure is unhealthy',async()=>expect((await checkRoute('','/agenda','https://test.example',async()=>{throw new Error('offline')})).ok).toBe(false));
test('genuine successful response is healthy',async()=>expect((await checkRoute('','/agenda','https://test.example',async()=>new Response('Agenda de hoje'))).ok).toBe(true));
test('smoke routes cover every navigation destination',()=>{
  const menu=readFileSync('components/app-shell.tsx','utf8');
  const urls=[...menu.matchAll(/\["[^"]+", "(\/[^"?]+)"/g)].map(x=>x[1]);
  expect(urls.length).toBeGreaterThan(20);
  expect(urls.filter(url=>!ROUTES.includes(url))).toEqual([]);
});
