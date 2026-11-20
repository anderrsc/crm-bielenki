import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Production Step Photos Migration', () => {
 const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261120120000_production_step_photos.sql');

 it('arquivo da migração existe', () => {
 expect(fs.existsSync(migrationPath)).toBe(true);
 });

 it('cria tabela production_step_photos', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create table if not exists public.production_step_photos');
 });

 it('contém função add_production_step_photo', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace function public.add_production_step_photo');
 });

 it('contém view v_production_step_photos', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create or replace view public.v_production_step_photos');
 });

 it('usa security definer com search_path fixo', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toMatch(/security\s+definer/i);
 expect(content).toMatch(/set\s+search_path\s*=\s*public/i);
 });

 it('habilita RLS na tabela', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('alter table public.production_step_photos enable row level security');
 });

 it('revoga acesso público da função', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('revoke all on function public.add_production_step_photo');
 });

 it('concede execute apenas para authenticated', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('grant execute on function public.add_production_step_photo(uuid, integer, text, text) to authenticated');
 });

 it('valida existência da etapa antes de inserir foto', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('production_step_logs psl');
 expect(content).toContain('Etapa % não encontrada');
 });

 it('registra auditoria ao adicionar foto', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("insert into audit_logs");
 expect(content).toContain("'production_step_photos'");
 });
});

describe('Production Photo Server Actions', () => {
 it('arquivo production-photo-actions.ts existe', () => {
 const actionsPath = path.join(process.cwd(), 'app/(crm)/production-photo-actions.ts');
 expect(fs.existsSync(actionsPath)).toBe(true);
 });

 it('exporta uploadProductionStepPhoto', () => {
 const actionsPath = path.join(process.cwd(), 'app/(crm)/production-photo-actions.ts');
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('export async function uploadProductionStepPhoto');
 });

 it('exporta deleteProductionStepPhoto', () => {
 const actionsPath = path.join(process.cwd(), 'app/(crm)/production-photo-actions.ts');
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('export async function deleteProductionStepPhoto');
 });

 it('valida tamanho máximo de 5MB', () => {
 const actionsPath = path.join(process.cwd(), 'app/(crm)/production-photo-actions.ts');
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('5 * 1024 * 1024');
 });

 it('valida tipos de imagem permitidos', () => {
 const actionsPath = path.join(process.cwd(), 'app/(crm)/production-photo-actions.ts');
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('image/jpeg');
 expect(content).toContain('image/png');
 expect(content).toContain('image/webp');
 });
});

describe('Production Step Photos Component', () => {
 it('arquivo production-step-photos.tsx existe', () => {
 const componentPath = path.join(process.cwd(), 'components/production-step-photos.tsx');
 expect(fs.existsSync(componentPath)).toBe(true);
 });

 it('exporta componente ProductionStepPhotos', () => {
 const componentPath = path.join(process.cwd(), 'components/production-step-photos.tsx');
 const content = fs.readFileSync(componentPath, 'utf-8');
 expect(content).toContain('export function ProductionStepPhotos');
 });

 it('importa actions de upload e delete', () => {
 const componentPath = path.join(process.cwd(), 'components/production-step-photos.tsx');
 const content = fs.readFileSync(componentPath, 'utf-8');
 expect(content).toContain('uploadProductionStepPhoto');
 expect(content).toContain('deleteProductionStepPhoto');
 });
});