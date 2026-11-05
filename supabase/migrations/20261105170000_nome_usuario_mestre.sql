-- Usuário mestre aparecia com o prefixo do e-mail ("andersonbielenkii") nas
-- listas de funcionários e como vendedor. Ajusta para o nome. Pode ser rodada
-- mais de uma vez.
update public.profiles p
   set full_name = 'Anderson Bielenki'
  from auth.users u
 where u.id = p.id
   and lower(u.email) = 'andersonbielenkii@gmail.com'
   and p.full_name is distinct from 'Anderson Bielenki';

-- Vendedor preenchido automaticamente com o prefixo do e-mail.
update public.quotes
   set seller_name = 'Anderson'
 where seller_name = 'andersonbielenkii';
