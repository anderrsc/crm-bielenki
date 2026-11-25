-- Compras: código do produto em cada item (como vem na nota/orçamento do fornecedor) e o arquivo
-- (PDF/foto da nota ou do orçamento) guardado na própria compra. Aditiva e pode ser rodada de novo.
alter table public.purchase_order_items add column if not exists code text;
alter table public.purchase_orders add column if not exists attachment_path text;
alter table public.purchase_orders add column if not exists attachment_name text;
alter table public.purchase_orders add column if not exists attachment_type text;

-- Arquivos privados: só o servidor lê e grava (a tela abre por uma rota que confere a permissão).
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('compras', 'compras', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
