-- Migration 20261126140000 — Campo "obra" no orçamento
-- Referência interna da obra para clientes com múltiplos projetos simultâneos.
alter table public.quotes add column if not exists obra text;
