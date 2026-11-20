import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Role Dashboards Migration', () => {
 const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261120150000_role_dashboards.sql');

 it('arquivo da migração existe', () => {
 expect(fs.existsSync(migrationPath)).toBe(true);
 });

 it('cria função dashboard_vendedor', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace function public.dashboard_vendedor()');
 });

 it('cria função dashboard_producao', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace function public.dashboard_producao()');
 });

 it('cria função dashboard_instalacao', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace function public.dashboard_instalacao()');
 });

 it('todas as funções usam security definer com search_path fixo', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 const matches = content.match(/security\s+definer\s+set\s+search_path\s*=\s*public/g);
 expect(matches).not.toBeNull();
 expect(matches!.length).toBeGreaterThanOrEqual(3);
 });

 it('revoga acesso público de todas as funções', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('revoke all on function public.dashboard_vendedor() from public, anon');
 expect(content).toContain('revoke all on function public.dashboard_producao() from public, anon');
 expect(content).toContain('revoke all on function public.dashboard_instalacao() from public, anon');
 });

 it('concede execute apenas para authenticated', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('grant execute on function public.dashboard_vendedor() to authenticated');
 expect(content).toContain('grant execute on function public.dashboard_producao() to authenticated');
 expect(content).toContain('grant execute on function public.dashboard_instalacao() to authenticated');
 });

 it('dashboard_vendedor retorna métricas comerciais relevantes', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("'orcamentos_mes'");
 expect(content).toContain("'vendas_mes'");
 expect(content).toContain("'leads_abertos'");
 expect(content).toContain("'followups_hoje'");
 });

 it('dashboard_producao retorna métricas operacionais relevantes', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("'em_producao'");
 expect(content).toContain("'aguardando_material'");
 expect(content).toContain("'liberados_corte'");
 expect(content).toContain("'compras_pendentes'");
 });

 it('dashboard_instalacao retorna métricas de instalação e pós-venda', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("'instalacoes_hoje'");
 expect(content).toContain("'instalacoes_atrasadas'");
 expect(content).toContain("'checklists_incompletos'");
 expect(content).toContain("'pos_venda_aberto'");
 expect(content).toContain("'problemas_abertos'");
 });

 it('funções retornam jsonb vazio quando company_id é null', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 const nullChecks = content.match(/if v_company_id is null then return '\{\}'::jsonb/g);
 expect(nullChecks).not.toBeNull();
 expect(nullChecks!.length).toBeGreaterThanOrEqual(3);
 });
});