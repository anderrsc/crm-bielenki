-- Atualização autorizada pelo catálogo e tabela pública da Marquinhos.
-- Não remove itens extras nem altera itens/preços de orçamentos existentes.
-- A empresa é identificada pelo CNPJ, nunca por UUID de outro ambiente.
do $catalog$
declare company uuid; r record; existing uuid;
begin
 for company in select id from public.companies where regexp_replace(coalesce(tax_id,''),'[^0-9]','','g')='26887887000175' loop
  for r in select * from (values
    ('0.5mm',150,31),
    ('0.6mm',150,34),
    ('0.7mm',150,39),
    ('1.0mm',150,49),
    ('0.5mm',200,36),
    ('0.6mm',200,39),
    ('0.7mm',200,43),
    ('1.0mm',200,66),
    ('0.5mm',250,41),
    ('0.6mm',250,44),
    ('0.7mm',250,55),
    ('1.0mm',250,82),
    ('0.5mm',300,46),
    ('0.6mm',300,50),
    ('0.7mm',300,60),
    ('1.0mm',300,98),
    ('0.5mm',350,51),
    ('0.6mm',350,59),
    ('0.7mm',350,68),
    ('1.0mm',350,123),
    ('0.5mm',400,56),
    ('0.6mm',400,62),
    ('0.7mm',400,76),
    ('1.0mm',400,131),
    ('0.5mm',500,67),
    ('0.6mm',500,75),
    ('0.7mm',500,88),
    ('1.0mm',500,164),
    ('0.5mm',600,79),
    ('0.6mm',600,87),
    ('0.7mm',600,102),
    ('1.0mm',600,196),
    ('0.5mm',700,87),
    ('0.6mm',700,94),
    ('0.7mm',700,111),
    ('1.0mm',700,278),
    ('0.5mm',800,96),
    ('0.6mm',800,99),
    ('0.7mm',800,116),
    ('1.0mm',800,294),
    ('0.5mm',900,104),
    ('0.6mm',900,128),
    ('0.7mm',900,152),
    ('1.0mm',900,310),
    ('0.5mm',1000,117),
    ('0.6mm',1000,137),
    ('0.7mm',1000,162),
    ('1.0mm',1000,327),
    ('0.5mm',1200,138),
    ('0.6mm',1200,162),
    ('0.7mm',1200,192),
    ('1.0mm',1200,392)
  ) m(thickness,cut_mm,price) loop
    -- Atualiza também formatos antigos (0.50 mm / 0.5mm), sem duplicar a matriz.
    update public.aluminum_price_matrix set price_per_meter=r.price
    where company_id=company and cut_mm=r.cut_mm
      and regexp_replace(thickness,'[^0-9.]','','g')::numeric=regexp_replace(r.thickness,'[^0-9.]','','g')::numeric;
    if not found then
      insert into public.aluminum_price_matrix(company_id,thickness,cut_mm,price_per_meter) values(company,r.thickness,r.cut_mm,r.price);
    end if;
    -- Só atualiza os produtos/aliases e cortes documentados; cores sem preço na fonte são preservadas.
    update public.gutter_prices g set unit_price=r.price,notes='Tabela Marquinhos 28/10/2026 · https://marquinhos-calhas.vercel.app/',updated_at=now()
    where g.company_id=company and g.cut_mm=r.cut_mm
      and regexp_replace(coalesce(g.thickness,''),'[^0-9.]','','g') ~ '^[0-9]+([.][0-9]+)?$'
      and case when regexp_replace(coalesce(g.thickness,''),'[^0-9.]','','g') ~ '^[0-9]+([.][0-9]+)?$' then regexp_replace(g.thickness,'[^0-9.]','','g')::numeric end=regexp_replace(r.thickness,'[^0-9.]','','g')::numeric
      and lower(coalesce(g.color,'Aluminio Natural')) in ('aluminio natural','alumínio natural','natural')
      and lower(g.product) in (select lower(name) from (values ('Calha platibanda','Calhas'),
    ('Calha Platibanda','Calhas'),
    ('Calha coletora / condutora','Calhas'),
    ('Calha Coletora','Calhas'),
    ('Calha Condutora','Calhas'),
    ('Calha central (fundo reto)','Calhas'),
    ('Calha central (fundo em V)','Calhas'),
    ('Calha de beiral','Calhas'),
    ('Calha com pingadeira','Calhas'),
    ('Água furtada','Calhas'),
    ('Calha Água Furtada','Calhas'),
    ('Rufo Água Furtada','Calhas'),
    ('Rufo condutor','Rufos'),
    ('Rufo convencional','Rufos'),
    ('Rufo','Rufos'),
    ('Rufo acabamento de telha','Rufos'),
    ('Rufo de Acabamento','Rufos'),
    ('Rufo testeira','Rufos'),
    ('Rufo de cumeeira','Rufos'),
    ('Rufo chapéu (galpão)','Rufos'),
    ('Rufo Chapéu','Rufos'),
    ('Rufo com pingadeira','Rufos'),
    ('Rufo com pingadeira duplo','Rufos'),
    ('Pingadeira','Pingadeiras'),
    ('Pingadeira marquise','Pingadeiras'),
    ('Pingadeira de Marquise','Pingadeiras'),
    ('Pingadeira com rufo (degrau)','Pingadeiras'),
    ('Pingadeira com rufo (aba reta)','Pingadeiras'),
    ('Pingadeira com rufo (inclinado)','Pingadeiras')) n(name,category));
    insert into public.gutter_prices(company_id,product,category,item_type,thickness,cut_mm,color,unit,unit_price,notes,active)
    select company,p.name,p.category,'fabricacao',r.thickness,r.cut_mm,'Aluminio Natural','metro',r.price,'Tabela Marquinhos 28/10/2026 · https://marquinhos-calhas.vercel.app/',true
    from (values ('Calha platibanda','Calhas'),
    ('Calha coletora / condutora','Calhas'),
    ('Calha central (fundo reto)','Calhas'),
    ('Calha central (fundo em V)','Calhas'),
    ('Calha de beiral','Calhas'),
    ('Calha com pingadeira','Calhas'),
    ('Água furtada','Calhas'),
    ('Rufo condutor','Rufos'),
    ('Rufo convencional','Rufos'),
    ('Rufo acabamento de telha','Rufos'),
    ('Rufo testeira','Rufos'),
    ('Rufo de cumeeira','Rufos'),
    ('Rufo chapéu (galpão)','Rufos'),
    ('Rufo com pingadeira','Rufos'),
    ('Rufo com pingadeira duplo','Rufos'),
    ('Pingadeira','Pingadeiras'),
    ('Pingadeira marquise','Pingadeiras'),
    ('Pingadeira com rufo (degrau)','Pingadeiras'),
    ('Pingadeira com rufo (aba reta)','Pingadeiras'),
    ('Pingadeira com rufo (inclinado)','Pingadeiras')) p(name,category)
    where not exists(select 1 from public.gutter_prices g where g.company_id=company and lower(g.product)=lower(p.name) and g.cut_mm=r.cut_mm
      and case when regexp_replace(coalesce(g.thickness,''),'[^0-9.]','','g') ~ '^[0-9]+([.][0-9]+)?$' then regexp_replace(g.thickness,'[^0-9.]','','g')::numeric end=regexp_replace(r.thickness,'[^0-9.]','','g')::numeric
      and lower(coalesce(g.color,'Aluminio Natural')) in ('aluminio natural','alumínio natural','natural'));
  end loop;
  for r in select * from (values
    ('Calha de beiral c/ 300 mm — Simples','Itens Especiais','metro',70),
    ('Calha de beiral c/ 300 mm — Dois pisos','Itens Especiais','metro',75),
    ('Calha de beiral c/ 400 mm — Simples','Itens Especiais','metro',85),
    ('Calha de beiral c/ 400 mm — Dois pisos','Itens Especiais','metro',90),
    ('Cano de alumínio com conexão — barra de 3,00 m','Condutores','metro',70),
    ('Cano PVC — barra de 6,00 m','Condutores','metro',40),
    ('Conexões PVC','Condutores','unidade',15),
    ('Corrente em alumínio','Condutores','metro',15),
    ('Cotonete Ø 300 mm — Cor alumínio','Itens Especiais','metro',300),
    ('Cotonete Ø 300 mm — Com pintura','Itens Especiais','metro',350),
    ('Cano simples sem cotonete Ø 300 mm — Cor alumínio','Itens Especiais','metro',250),
    ('Cano simples sem cotonete Ø 300 mm — Com pintura','Itens Especiais','metro',300),
    ('Chaminé Ø 200 mm — Cor alumínio','Itens Especiais','metro',200),
    ('Chaminé Ø 200 mm — Com pintura','Itens Especiais','metro',300),
    ('Coifa — Cor alumínio','Itens Especiais','metro',330),
    ('Coifa — Com pintura','Itens Especiais','metro',450),
    ('Saída de 75','Acessórios','unidade',6),
    ('Saída de 100','Acessórios','unidade',7),
    ('Saída de 150','Acessórios','unidade',12),
    ('Saída de corrente','Acessórios','unidade',7),
    ('Caneco corrente','Acessórios','unidade',5),
    ('Braçadeira 100 e 75','Acessórios','unidade',4.5),
    ('Corrente alumínio','Acessórios','metro',15),
    ('Gancho torcido médio','Acessórios','unidade',8),
    ('Gancho grande','Acessórios','unidade',10),
    ('Redução de alumínio para PVC 100 e 75 mm','Acessórios','unidade',16),
    ('Calha de beiral c/ 300 mm (sem acessórios)','Acessórios','metro',35),
    ('Calha de beiral c/ 400 mm (sem acessórios)','Acessórios','metro',44),
    ('Cabeceira calha beiral','Acessórios','unidade',5),
    ('Proteção de canto','Acessórios','unidade',7),
    ('Tubo vedante PU sachê 600','Acessórios','unidade',50),
    ('Silicone incolor','Acessórios','unidade',30),
    ('Silicone incolor neutro','Acessórios','unidade',33)
  ) p(product,category,unit,price) loop
    update public.gutter_prices set unit_price=r.price,unit=r.unit,notes='Tabela Marquinhos 28/10/2026 · https://marquinhos-calhas.vercel.app/',updated_at=now()
    where company_id=company and product=r.product and nullif(thickness,'') is null and cut_mm is null;
    if not found then
      insert into public.gutter_prices(company_id,product,category,item_type,unit,unit_price,notes,active)
      values(company,r.product,r.category,case when r.category='Condutores' then 'condutor' else 'item_especial' end,r.unit,r.price,'Tabela Marquinhos 28/10/2026 · https://marquinhos-calhas.vercel.app/',true);
    end if;
  end loop;
  -- O conteúdo visual mudou: PDFs anteriores precisam ser gerados novamente.
  update public.quotes set pdf_generated_at=null where company_id=company;
 end loop;
end $catalog$;
