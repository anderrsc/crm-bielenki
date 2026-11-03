-- Calha de beiral: preço por metro da tabela de referência (28/10/2026),
-- versão simples, igual para todas as espessuras: 300 mm = R$ 70, 400 mm = R$ 85.
-- O catálogo de 02/11 tinha gravado o preço genérico de corte/espessura (ex.: R$ 46).
-- Só altera a Calha de beiral em alumínio natural; pode ser rodada mais de uma vez.
update public.gutter_prices g
   set unit_price = case g.cut_mm when 300 then 70 when 400 then 85 end
 where lower(g.product) = 'calha de beiral'
   and g.cut_mm in (300, 400)
   and lower(coalesce(g.color, 'Aluminio Natural')) in ('aluminio natural', 'alumínio natural', 'natural');
