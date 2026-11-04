-- Remove os preços antigos de exemplo ("Placeholder - ajustar conforme custo"),
-- que não fazem parte da tabela de 28/10/2026 (Condutor, Chaminé por unidade,
-- variações pintadas de calha/rufo/pingadeira). O "PU MS40" (R$ 68) fica.
-- Pode ser rodada mais de uma vez.
delete from public.gutter_prices
 where notes ilike 'Placeholder - ajustar conforme custo%'
   and lower(product) <> 'pu ms40';
