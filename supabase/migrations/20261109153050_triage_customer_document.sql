-- Keep the raw triage and internal summary out of the customer PDF.
create or replace function crm_private.triage_draft() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; qid uuid; sale_type uuid; person uuid; data jsonb; product_text text; details text;
        phone_key text; qty numeric:=1; entry jsonb; entries jsonb; linked_lead uuid;
begin
 if new.status <> 'concluida' or new.eh_manutencao or new.quote_id is not null then return new; end if;
 -- Locking the session serializes retries and competing webhooks.
 select id into qid from public.quotes where triage_session_id=new.id;
 if qid is not null then return new; end if;
 data:=coalesce(new.dados_coletados,'{}'::jsonb);
 phone_key:=public.client_phone_key(new.phone);
 if length(phone_key)<10 then raise exception 'Telefone da triagem inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||phone_key,0));
 select id into cid from public.clients where company_id=new.company_id and
   (public.client_phone_key(phone)=phone_key or public.client_phone_key(whatsapp)=phone_key) limit 1;
 if cid is null then
   insert into public.clients(company_id,name,phone,whatsapp,city,neighborhood,address,lead_source)
   values(new.company_id,coalesce(nullif(new.nome,''),nullif(data->>'nome',''),'Contato WhatsApp '||new.phone),new.phone,new.phone,
          coalesce(new.cidade,data->>'cidade'),coalesce(new.bairro,data->>'bairro'),coalesce(new.rua,data->>'rua'),'WhatsApp') returning id into cid;
 end if;
 select assigned_to into person from public.conversations where company_id=new.company_id and
   (id=new.conversation_id or external_id=new.phone) order by (id=new.conversation_id) desc nulls last limit 1;
 if not exists(select 1 from public.profiles where id=person and company_id=new.company_id and status='ativo') then person:=null; end if;
 product_text:=coalesce(nullif(new.produto,''),nullif(data->>'produto',''),nullif(new.tipo_servico,''),'Peça a conferir');
 select id into sale_type from public.sale_types where company_id=new.company_id and active order by
  case when product_text ilike any(array['%calha%','%rufo%','%pingadeira%','%chapa%','%condutor%']) then
    case when name ilike 'Calhas%' then 0 else 1 end
  else case when name ilike 'Esquadrias%' then 0 else 1 end end, name limit 1;
 if sale_type is null then raise exception 'Nenhum tipo de venda ativo para o rascunho'; end if;
 details:=concat_ws(E'\n',new.resumo_executivo,'Dados informados pelo cliente (conferir medidas e unidades):',jsonb_pretty(data));
 if coalesce(data->>'quantidade','') ~ '^\d+([.,]\d+)?$' then
   qty:=greatest(0.001,least(999999,replace(data->>'quantidade',',','.')::numeric));
 end if;
 insert into public.quotes(company_id,quote_number,client_id,sale_type_id,seller_id,attendant_id,status,notes,triage_session_id,valid_until)
 values(new.company_id,public.next_number('ORC','public.quotes',new.company_id),cid,sale_type,person,person,'rascunho',null,new.id,
 current_date+coalesce((select default_validity_days from public.companies where id=new.company_id),7)) returning id into qid;
 entries:=data->'itens';
 if jsonb_typeof(entries) is distinct from 'array' or entries='[]'::jsonb then
  entries:=jsonb_build_array(jsonb_build_object('produto',product_text,'medidas',coalesce(data->'medidas',to_jsonb(new.medidas)),'quantidade',qty));
 end if;
 for entry in select value from jsonb_array_elements(entries) limit 100 loop
  qty:=1;
  if coalesce(entry->>'quantidade','') ~ '^\d+([.,]\d+)?$' then qty:=greatest(0.001,least(999999,replace(entry->>'quantidade',',','.')::numeric)); end if;
  insert into public.quote_items(company_id,quote_id,product,description,unit,quantity,unit_price,metadata,item_type)
  values(new.company_id,qid,coalesce(nullif(entry->>'produto',''),product_text),
   concat_ws(E'\n',entry->>'medidas',
    case when data->>'comprimento' is not null then 'Comprimento: '||(data->>'comprimento') end,
    case when data->>'largura' is not null then 'Largura/corte: '||(data->>'largura') end,
    case when data->>'espessura_material' is not null then 'Material/espessura: '||(data->>'espessura_material') end,
    coalesce(entry->>'cor',new.cor,data->>'cor'),coalesce(entry->>'linha',new.linha,data->>'linha')),coalesce(nullif(entry->>'unidade',''),'un'),qty,0,
   jsonb_build_object('triage_data',data,'triage_item',entry,'needs_review',true),'triagem');
 end loop;
 select id into linked_lead from public.leads where company_id=new.company_id and client_id=cid and status='aberto' order by created_at desc limit 1;
 update public.triage_sessions set quote_id=qid,lead_id=coalesce(lead_id,linked_lead) where id=new.id;
 update public.conversations set client_id=cid,ai_paused=true where company_id=new.company_id and (id=new.conversation_id or external_id=new.phone);
 perform crm_private.notify_team(new.company_id,'triage:'||new.id,'Triagem concluída: orçamento rascunho',
  coalesce(new.nome,new.phone)||' · '||product_text||'. Confira medidas e preencha os preços.','/orcamentos/'||qid||'/editar',person);
 return new;
end; $$;
revoke all on function crm_private.triage_draft() from public,anon,authenticated;
