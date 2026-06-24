-- Migration 036 — Opção para ocultar valores unitários no orçamento impresso
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS hide_unit_prices boolean NOT NULL DEFAULT false;
