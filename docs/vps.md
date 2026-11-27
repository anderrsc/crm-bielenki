# CRM na VPS (São Paulo)

Produção: **https://crm.bielenki.com.br** (VPS HospedeAqui, mesma máquina da Evolution).
Endereço antigo, que continua funcionando: `https://crm.178-92-204-54.sslip.io`.
Reserva: Railway (`crm-bielenki-production.up.railway.app`), sem receber WhatsApp nem agendador.

- Pasta: `/opt/crm-bielenki` (`docker-compose.yml`, `.env` com as chaves, `app/` = código do GitHub).
- Atualização automática: `crm-atualizar.timer` confere a `main` a cada 2 min e publica (`atualizar.sh`). Registro: `journalctl -u crm-atualizar -n 50`.
- Forçar publicação: `/opt/crm-bielenki/atualizar.sh --forcar`.
- Voltar uma versão: `cd /opt/crm-bielenki && git -C app reset --hard <commit> && DEPLOY_ID=<commit> docker compose build crm && docker compose up -d crm` (e pausar o timer enquanto isso: `systemctl stop crm-atualizar.timer`).
- Logs do CRM: `docker logs --tail 100 crm-bielenki`.
- HTTPS: Caddy da Evolution (`/opt/evolution/Caddyfile`, blocos `crm.bielenki.com.br` e `crm.{$HOST}`).
- DNS: registro.br, zona do bielenki.com.br — `crm` (A → 178.92.204.54) e `3d` (CNAME → anderrsc.github.io).
- Acesso SSH: chave do computador do Anderson em `/root/.ssh/authorized_keys`; fail2ban bloqueia tentativas de senha.
- Código no GitHub: chave de leitura `/root/.ssh/crm_deploy` (deploy key "VPS HospedeAqui (somente leitura)").

Trocar de servidor de novo: atualizar `NEXT_PUBLIC_SITE_URL` no `.env`, `crm_operations_config.site_url` no banco,
Site URL do login no Supabase e o webhook das instâncias na Evolution.
