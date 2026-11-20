import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Post-Sale Module Migration', () => {
 const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261120130000_post_sale_module.sql');

 it('arquivo da migração existe', () => {
 expect(fs.existsSync(migrationPath)).toBe(true);
 });

 it('cria tabela post_sales', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create table if not exists public.post_sales');
 });

 it('cria tabela post_sale_photos', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create table if not exists public.post_sale_photos');
 });

 it('cria tabela post_sale_history', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create table if not exists public.post_sale_history');
 });

 it('contém função create_post_sale_from_installation', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace function public.create_post_sale_from_installation');
 });

 it('contém função resolve_post_sale', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace function public.resolve_post_sale');
 });

 it('contém view v_post_sales_dashboard', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace view public.v_post_sales_dashboard');
 });

 it('usa security definer com search_path fixo nas funções', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toMatch(/security\s+definer/g);
 expect(content).toMatch(/set\s+search_path\s*=\s*public/g);
 });

 it('habilita RLS em todas as tabelas', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('alter table public.post_sales enable row level security');
 expect(content).toContain('alter table public.post_sale_photos enable row level security');
 expect(content).toContain('alter table public.post_sale_history enable row level security');
 });

 it('revoga acesso público das funções', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('revoke all on function public.create_post_sale_from_installation');
 expect(content).toContain('revoke all on function public.resolve_post_sale');
 });

 it('tipos de pós-venda incluem avaliação, problema, retorno e follow-up', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("'avaliacao'");
 expect(content).toContain("'problema'");
 expect(content).toContain("'retorno_garantia'");
 expect(content).toContain("'retorno_fora_garantia'");
 expect(content).toContain("'follow_up'");
 });

 it('evita duplicação de pós-venda aberto para mesmo pedido', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("status in ('aberto', 'em_andamento')");
 expect(content).toContain('return null');
 });
});

describe('Post-Sale Server Actions', () => {
 it('arquivo post-sale-actions.ts existe', () => {
 const actionsPath = path.join(process.cwd(), 'app/(crm)/post-sale-actions.ts');
 expect(fs.existsSync(actionsPath)).toBe(true);
 });

 it('exporta createPostSale', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'app/(crm)/post-sale-actions.ts'), 'utf-8');
 expect(content).toContain('export async function createPostSale');
 });

 it('exporta resolvePostSale', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'app/(crm)/post-sale-actions.ts'), 'utf-8');
 expect(content).toContain('export async function resolvePostSale');
 });

 it('exporta updatePostSaleStatus', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'app/(crm)/post-sale-actions.ts'), 'utf-8');
 expect(content).toContain('export async function updatePostSaleStatus');
 });

 it('valida tipos de pós-venda permitidos', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'app/(crm)/post-sale-actions.ts'), 'utf-8');
 expect(content).toContain('avaliacao');
 expect(content).toContain('problema');
 expect(content).toContain('follow_up');
 });

 it('valida rating entre 1 e 5', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'app/(crm)/post-sale-actions.ts'), 'utf-8');
 expect(content).toContain('rating < 1 || rating > 5');
 });
});

describe('Post-Sale Dashboard Component', () => {
 it('arquivo post-sale-dashboard.tsx existe', () => {
 const componentPath = path.join(process.cwd(), 'components/post-sale-dashboard.tsx');
 expect(fs.existsSync(componentPath)).toBe(true);
 });

 it('exporta PostSaleDashboard', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'components/post-sale-dashboard.tsx'), 'utf-8');
 expect(content).toContain('export function PostSaleDashboard');
 });

 it('exporta PostSaleCard', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'components/post-sale-dashboard.tsx'), 'utf-8');
 expect(content).toContain('export function PostSaleCard');
 });

 it('importa actions de criação, resolução e atualização', () => {
 const content = fs.readFileSync(path.join(process.cwd(), 'components/post-sale-dashboard.tsx'), 'utf-8');
 expect(content).toContain('createPostSale');
 expect(content).toContain('resolvePostSale');
 expect(content).toContain('updatePostSaleStatus');
 });
});