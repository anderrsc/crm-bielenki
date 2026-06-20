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

## Identidade e documentos

- Em **Configurações → Identidade da empresa**, cadastre a logo, dados da Marquinhos Calhas e Esquadrias, cores e rodapé comercial.
- Os orçamentos usam automaticamente essa identidade e podem ser impressos ou salvos em PDF pelo navegador.
- Na página do cliente, **Emitir ficha de visita** gera uma folha A4 compacta, com cliente e bairro em destaque e ampla área livre para medições e croquis.
- Execute também a migração `004_company_branding.sql` para habilitar esses recursos e o bucket de logos.

Todas as tabelas operacionais usam `company_id` e RLS. A matriz em `permissions` restringe visualização e escrita por função; administrador e gerente possuem acesso integral.

## Validação

```bash
npm run typecheck
npm run build
```

O sistema não inclui dados fictícios permanentes. Sem conexão Supabase, as telas mostram estados vazios e orientação de configuração.

## Automações

### Operação do CRM

As automações de orçamento aprovado, contas a pagar e receber, pagamentos parciais, recebimento de materiais, estoque, liberação de produção, checklist, instalação e pós-venda são executadas de forma transacional pelas funções e gatilhos das migrações Supabase.

### GitHub

- O workflow **Validar CRM Bielenki** executa TypeScript, auditoria de segurança e build em todo push ou pull request para `main`.
- O Dependabot verifica semanalmente as dependências npm e mensalmente as GitHub Actions.
- O workflow também pode ser iniciado manualmente pela aba **Actions** do repositório.
