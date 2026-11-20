import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Order Labor & Consumables Migration', () => {
 const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261120140000_order_labor_and_consumables.sql');

 it('arquivo da migração existe', () => {
 expect(fs.existsSync(migrationPath)).toBe(true);
 });

 it('cria tabela order_labor_costs', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create table if not exists public.order_labor_costs');
 });

 it('cria tabela order_consumables', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('create table if not exists public.order_consumables');
 });

 it('total_cost em order_labor_costs é coluna gerada (hours_actual * cost_per_hour)', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('generated always as (round(hours_actual * cost_per_hour, 2)) stored');
 });

 it('total_cost em order_consumables é coluna gerada (quantity * unit_cost)', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('generated always as (round(quantity * unit_cost, 2)) stored');
 });

 it('habilita RLS em ambas as tabelas', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('alter table public.order_labor_costs enable row level security');
 expect(content).toContain('alter table public.order_consumables enable row level security');
 });

 it('políticas de select exigem permissão financial_entries', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("has_table_access('financial_entries', 'select')");
 });

 it('políticas de insert/update/delete exigem permissão financial_entries update', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain("has_table_access('financial_entries', 'update')");
 });

 it('atualiza v_order_result com colunas cost_labor, cost_consumables, cost_aluminum e labor_hours_total', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('cost_labor');
 expect(content).toContain('cost_consumables');
 expect(content).toContain('cost_aluminum');
 expect(content).toContain('labor_hours_total');
 expect(content).toContain('aluminum_kg_total');
 });

 it('margin_current inclui dedução de labor e consumables', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('coalesce(lb.labor_cost,0)');
 expect(content).toContain('coalesce(cn.consumables_cost,0)');
 });

 it('inclui triggers de updated_at em ambas as tabelas', () => {
 const content = fs.readFileSync(migrationPath, 'utf-8');
 expect(content).toContain('order_labor_costs_touch_updated_at');
 expect(content).toContain('order_consumables_touch_updated_at');
 });
});

describe('Order Cost Server Actions', () => {
 const actionsPath = path.join(process.cwd(), 'app/(crm)/order-cost-actions.ts');

 it('arquivo order-cost-actions.ts existe', () => {
 expect(fs.existsSync(actionsPath)).toBe(true);
 });

 it('exporta addOrderLabor', () => {
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('export async function addOrderLabor');
 });

 it('exporta deleteOrderLabor', () => {
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('export async function deleteOrderLabor');
 });

 it('exporta addOrderConsumable', () => {
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('export async function addOrderConsumable');
 });

 it('exporta deleteOrderConsumable', () => {
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('export async function deleteOrderConsumable');
 });

 it('valida cost_per_hour entre 0,01 e 9.999,99', () => {
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('costPerHour <= 0 || costPerHour >= 10000');
 });

 it('valida quantity maior que zero', () => {
 const content = fs.readFileSync(actionsPath, 'utf-8');
 expect(content).toContain('quantity <= 0');
 });
});