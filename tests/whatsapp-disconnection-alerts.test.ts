import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('WhatsApp Disconnection Alerts Migration', () => {
 const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261120110000_whatsapp_disconnection_alerts.sql');

 it('arquivo da migração existe', () => {
 expect(fs.existsSync(migrationPath)).toBe(true);
 });

 it('contém função check_whatsapp_disconnections', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace function public.check_whatsapp_disconnections()');
 });

 it('contém view v_whatsapp_disconnection_alerts', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace view public.v_whatsapp_disconnection_alerts');
 });

 it('concede execute para service_role', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('grant execute on function public.check_whatsapp_disconnections() to service_role');
 });

 it('usa security definer com search_path fixo', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toMatch(/security\s+definer/i);
 expect(content).toMatch(/set\s+search_path\s*=\s*public/i);
 });

 it('threshold de desconexão é 30 minutos', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("v_threshold_minutes int := 30");
 });

 it('evita notificações duplicadas (cooldown de 2 horas)', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("interval '2 hours'");
 });

 it('notifica apenas administradores e gerentes', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("'administrador', 'gerente'");
 });
});

describe('Operations integration', () => {
 it('operations.ts chama check_whatsapp_disconnections', () => {
 const opsPath = path.join(process.cwd(), 'lib/operations.ts');
 const content = fs.readFileSync(opsPath, 'utf-8');
 expect(content).toContain("check_whatsapp_disconnections");
 });
});