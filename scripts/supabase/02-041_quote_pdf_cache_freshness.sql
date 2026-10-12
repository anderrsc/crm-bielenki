-- Passo 2 de 10 — 041_quote_pdf_cache_freshness.sql
-- Cole no SQL Editor do Supabase (New query, sem nada selecionado) e clique Run. Pode ser repetido.

-- Migration 041 - Cache do PDF do orcamento nunca era aproveitado
--
-- O trigger quotes_touch (touch_updated_at) grava updated_at = now() em
-- qualquer update. Quando o sistema marcava pdf_generated_at depois de gerar
-- o PDF, o proprio trigger empurrava updated_at para depois de
-- pdf_generated_at, entao o cache sempre parecia desatualizado e todo
-- download gerava o PDF do zero (lento). Agora um update que so mexe em
-- pdf_generated_at nao altera updated_at.
--
-- Pode ser rodada mais de uma vez.

begin;

create or replace function public.touch_quotes_updated_at() returns trigger language plpgsql as $$
begin
  -- "total" e coluna gerada: num trigger BEFORE ela ainda vem nula em NEW,
  -- entao fica fora da comparacao (ela deriva de subtotal/discount/freight).
  if (to_jsonb(new) - 'pdf_generated_at' - 'updated_at' - 'total')
     = (to_jsonb(old) - 'pdf_generated_at' - 'updated_at' - 'total') then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists quotes_touch on public.quotes;
create trigger quotes_touch before update on public.quotes
for each row execute function public.touch_quotes_updated_at();

commit;
