-- Triagem: liga a conversa a um cliente ja cadastrado em vez de criar outro,
-- e nunca deixa a Lia travar se o rascunho falhar.
-- Regras: mesmo telefone; mesmo nome e sobrenome; mesmo endereco quando o cadastro
-- nao tem telefone ou nome real; so o primeiro nome igual exige outro ponto em
-- comum (endereco, bairro+cidade ou CPF/CNPJ).
create or replace function crm_private.triage_match_client(p_company uuid,p_name text,p_street text,p_district text,p_city text,p_doc text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare nk text:=public.client_name_key(p_name); ak text:=public.client_name_key(p_street);
        dk text:=public.client_name_key(p_district); ck text:=public.client_name_key(p_city);
        doc text:=public.client_doc_key(p_doc); first text; cid uuid;
begin
 if nk like 'contato whatsapp%' then nk:=null; end if;
 if doc is not null then
   select id into cid from public.clients where company_id=p_company and public.client_doc_key(tax_id)=doc limit 1;
   if cid is not null then return cid; end if;
 end if;
 if nk is not null and position(' ' in nk)>0 then
   -- Nome e sobrenome iguais: prefere o cadastro sem telefone.
   select id into cid from public.clients where company_id=p_company and public.client_name_key(name)=nk
    order by (public.client_phone_key(coalesce(nullif(phone,''),whatsapp)) is null) desc, created_at limit 1;
   if cid is not null then return cid; end if;
 end if;
 if ak is not null and length(ak)>=5 then
   -- Mesmo endereco, cadastro sem telefone ou sem nome real.
   select id into cid from public.clients where company_id=p_company and public.client_name_key(address)=ak
    and (ck is null or public.client_name_key(city) is null or public.client_name_key(city)=ck)
    and (public.client_phone_key(coalesce(nullif(phone,''),whatsapp)) is null or public.client_name_key(name) like 'contato whatsapp%')
    order by created_at limit 1;
   if cid is not null then return cid; end if;
 end if;
 if nk is not null then
   -- So o primeiro nome igual: precisa de outro ponto em comum.
   first:=split_part(nk,' ',1);
   select id into cid from public.clients where company_id=p_company
    and split_part(public.client_name_key(name),' ',1)=first
    and ((ak is not null and public.client_name_key(address)=ak)
      or (dk is not null and ck is not null and public.client_name_key(neighborhood)=dk and public.client_name_key(city)=ck))
    and public.client_phone_key(coalesce(nullif(phone,''),whatsapp)) is null
    order by created_at limit 1;
 end if;
 return cid;
end $$;
revoke all on function crm_private.triage_match_client(uuid,text,text,text,text,text) from public,anon,authenticated;

create or replace function crm_private.triage_draft() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; qid uuid; sale_type uuid; person uuid; data jsonb; product_text text; details text;
        phone_key text; qty numeric:=1; entry jsonb; entries jsonb; linked_lead uuid;
begin
 if new.status <> 'concluida' or new.eh_manutencao or new.quote_id is not null then return new; end if;
 begin
 -- Locking the session serializes retries and competing webhooks.
 select id into qid from public.quotes where triage_session_id=new.id;
 if qid is not null then return new; end if;
 data:=coalesce(new.dados_coletados,'{}'::jsonb);
 phone_key:=public.client_phone_key(new.phone);
 if length(phone_key)<10 then raise exception 'Telefone da triagem inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||phone_key,0));
 -- 1) Mesmo telefone = mesmo cliente.
 select id into cid from public.clients where company_id=new.company_id and
   (public.client_phone_key(phone)=phone_key or public.client_phone_key(whatsapp)=phone_key) limit 1;
 if cid is null then
   cid:=crm_private.triage_match_client(new.company_id,
     coalesce(nullif(new.nome,''),data->>'nome'),coalesce(new.rua,data->>'rua'),coalesce(new.bairro,data->>'bairro'),
     coalesce(new.cidade,data->>'cidade'),coalesce(data->>'cpf',data->>'cpf_cnpj',data->>'documento'));
   if cid is not null then
     -- Completa o telefone que faltava no cadastro encontrado.
     update public.clients set phone=coalesce(nullif(phone,''),new.phone),whatsapp=coalesce(nullif(whatsapp,''),new.phone)
      where id=cid and (nullif(phone,'') is null or nullif(whatsapp,'') is null);
   end if;
 end if;
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
 exception when others then
  -- A Lia nunca pode travar por causa do rascunho: avisa a equipe e segue.
  raise warning 'triage_draft %: %', new.id, sqlerrm;
  begin
   perform crm_private.notify_team(new.company_id,'triage-fail:'||new.id,'Triagem concluída sem rascunho',
    coalesce(new.nome,new.phone)||': não foi possível criar o orçamento automaticamente ('||left(sqlerrm,120)||'). Crie manualmente.',
    '/atendimento',null);
  exception when others then null;
  end;
  return new;
 end;
end; $$;
revoke all on function crm_private.triage_draft() from public,anon,authenticated;

-- Uma conversa por numero: mensagens simultaneas de um contato novo criavam 2 ou 3
-- conversas. So cria a trava se nao houver duplicadas antigas (essas ficam como estao).
do $$ begin
 if not exists(select 1 from public.conversations where external_id is not null
   group by company_id,channel,external_id having count(*)>1) then
   create unique index if not exists conversations_one_per_contact
     on public.conversations(company_id,channel,external_id) where external_id is not null;
 else
   raise notice 'conversations duplicadas: indice unico nao criado';
 end if;
end $$;

-- Sincronizacao da agenda/ligacao de clientes do Atendimento: no maximo a cada
-- 10 min por empresa, valendo para todos os servidores (antes rodava a cada lista).
alter table public.ai_agent_config add column if not exists inbox_synced_at timestamptz;

-- Datas do banco no fuso de Brasilia: das 21h as 24h o que vence hoje nao
-- aparece mais como vencido (current_date usava UTC).
do $$ begin
 execute format('alter database %I set timezone to %L', current_database(), 'America/Sao_Paulo');
end $$;

-- Respostas prontas: duas pessoas abrindo pela primeira vez duplicavam a lista.
delete from public.quick_replies a using public.quick_replies b
 where a.company_id=b.company_id and a.shortcut=b.shortcut and a.body=b.body
   and (a.created_at,a.id::text) > (b.created_at,b.id::text);
do $$ begin
 if not exists(select 1 from public.quick_replies group by company_id,shortcut having count(*)>1) then
   create unique index if not exists quick_replies_company_shortcut on public.quick_replies(company_id,shortcut);
 end if;
end $$;
