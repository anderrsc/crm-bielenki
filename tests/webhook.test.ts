import { afterEach, expect, test, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/whatsapp/webhook/route';
import { middleware } from '@/middleware';

const updateSession=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/supabase/middleware',()=>({updateSession}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
test('WhatsApp provider callback is not redirected to browser login',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co');await middleware(new NextRequest('https://crm.example/api/whatsapp/webhook'));expect(updateSession).not.toHaveBeenCalled();});
test('CRM routes still require normal session',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.supabase.co');await middleware(new NextRequest('https://crm.example/financeiro'));expect(updateSession).toHaveBeenCalled();});
test('Meta verification requires a configured secret',async()=>{vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN','');expect((await GET(new NextRequest('https://crm.example/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=marquinhos-crm-verify&hub.challenge=123'))).status).toBe(403);});
test('Meta verification echoes challenge for valid token',async()=>{vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN','test-token');const result=await GET(new NextRequest('https://crm.example/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=123'));expect(result.status).toBe(200);expect(await result.text()).toBe('123');});
test('invalid Meta signature is rejected before opening privileged database client',async()=>{vi.stubEnv('WHATSAPP_APP_SECRET','secret');expect((await POST(new NextRequest('https://crm.example/api/whatsapp/webhook',{method:'POST',body:'{}'}))).status).toBe(401);});
test('valid status-only Meta payload needs no database access',async()=>{vi.stubEnv('WHATSAPP_APP_SECRET','secret');const body=JSON.stringify({entry:[{changes:[{value:{statuses:[]}}]}]});const signature='sha256='+createHmac('sha256','secret').update(body).digest('hex');const result=await POST(new NextRequest('https://crm.example/api/whatsapp/webhook',{method:'POST',body,headers:{'x-hub-signature-256':signature}}));expect(result.status).toBe(200);expect(await result.json()).toEqual({status:'no_messages'});});
test('invalid Evolution secret is rejected',async()=>{vi.stubEnv('EVOLUTION_WEBHOOK_SECRET','test-secret');expect((await POST(new NextRequest('https://crm.example/api/whatsapp/webhook',{method:'POST',body:JSON.stringify({event:'messages.upsert',data:{}})}))).status).toBe(401);});
test('Evolution own messages are ignored without generating replies',async()=>{vi.stubEnv('EVOLUTION_WEBHOOK_SECRET','test-secret');const result=await POST(new NextRequest('https://crm.example/api/whatsapp/webhook',{method:'POST',headers:{'x-webhook-secret':'test-secret'},body:JSON.stringify({event:'messages.upsert',data:{key:{fromMe:true}}})}));expect(await result.json()).toEqual({status:'own_message'});});
