# CRM Bielenki

Sistema operacional multiempresa para vendas, pedidos, compras, produção, estoque, financeiro, instalação e pós-venda.

## Tecnologias

- Next.js 15, React 19, TypeScript e TailwindCSS
- Supabase Auth, PostgreSQL, RLS e Server Actions
- Componentes acessíveis Radix/Shadcn e Framer Motion
- Deploy compatível com Vercel

## Configuração local

1. Crie um projeto no Supabase.
2. Execute, na ordem, os arquivos de `supabase/migrations` no SQL Editor ou com a Supabase CLI.
3. Copie `.env.example` para `.env.local` e preencha URL e chave pública do projeto.
4. Rode `npm install` e `npm run dev`.
5. Crie o primeiro usuário no Supabase Auth, copie seu UUID e execute no SQL Editor: `select bootstrap_company('Bielenki', 'CNPJ', 'UUID-DO-USUARIO');`.
6. Para novos usuários, defina `company_id` e `role` no `app_metadata` ao enviar o convite. O gatilho de autenticação cria perfil e função automaticamente.

## Fluxos protegidos no banco

- `approve_quote`: transforma orçamento em venda, pedido, conta a receber, checklist, solicitação de compra e ordem de produção.
- `register_payment`: registra pagamento parcial e sincroniza financeiro, venda ou compra.
- `receive_purchase_item`: recebe material, movimenta estoque e libera produção quando todos os itens obrigatórios chegam.
- Compras com valor geram conta a pagar automaticamente.
- Checklist obrigatório completo finaliza o pedido.
- Instalação concluída agenda pós-venda e atualiza a cobrança do saldo.

Todas as tabelas operacionais usam `company_id` e RLS. A matriz em `permissions` restringe visualização e escrita por função; administrador e gerente possuem acesso integral.

## Validação

```bash
npm run typecheck
npm run build
```

O sistema não inclui dados fictícios permanentes. Sem conexão Supabase, as telas mostram estados vazios e orientação de configuração.
