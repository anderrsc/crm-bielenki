# CRM na Railway

O CRM roda na Railway como um servidor Node ligado o tempo todo (Dockerfile na raiz).
O Chromium do sistema gera os PDFs de orçamento e recibo.

## 1. Criar o serviço
Railway > New Project > Deploy from GitHub repo > `anderrsc/crm-bielenki` (branch `main`).
A Railway lê o `railway.json` e builda pelo `Dockerfile`.

## 2. Variáveis (Service > Variables)
Copie da Vercel (Settings > Environment Variables), com os mesmos valores:

| Variável | Obrigatória |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | sim |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | sim |
| SUPABASE_SERVICE_ROLE_KEY | sim |
| NEXT_PUBLIC_SITE_URL | sim: o endereço novo da Railway, sem barra no final |
| ENCRYPTION_KEY | sim (sem ela, as chaves salvas da IA e do WhatsApp não abrem) |
| CRON_SECRET | sim |
| EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE, EVOLUTION_WEBHOOK_SECRET | se estiverem na Vercel |
| WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_API_VERSION | se estiverem na Vercel |
| OLLAMA_API_KEY, FISCAL_MOTOR_URL | se estiverem na Vercel |

Depois de mudar `NEXT_PUBLIC_*`, faça Redeploy (elas entram no build).

## 3. Endereço
Settings > Networking > Generate Domain. Use esse endereço em `NEXT_PUBLIC_SITE_URL` e nos passos abaixo.

## 4. Trocar o endereço nos outros lugares
1. **Supabase > Authentication > URL Configuration:** Site URL = endereço novo; em Redirect URLs, adicione `https://ENDERECO/**`.
2. **Supabase > SQL Editor:** rode a migration `20261125190000_operacoes_url_configuravel.sql` e depois
   `update public.crm_operations_config set site_url = 'https://ENDERECO' where id;`
3. **WhatsApp (Evolution):** webhook = `https://ENDERECO/api/whatsapp/webhook` (mesmos eventos de antes).

## 5. Conferir
- Login abre e o Atendimento carrega.
- Mande `/ajuda` do seu WhatsApp para o número da empresa: a Lia responde.
- Gere o PDF de um orçamento.
