#!/usr/bin/env bash
# Instalação do CRM na VPS (uma vez). Não mexe na Evolution: só acrescenta o site do CRM no Caddy.
set -euo pipefail
BASE=/opt/crm-bielenki
cd "$BASE"
cp app/deploy/vps/docker-compose.yml "$BASE/docker-compose.yml"
cp app/deploy/vps/atualizar.sh "$BASE/atualizar.sh"; chmod +x "$BASE/atualizar.sh"
# Rede da Evolution (onde está o Caddy)
NET=$(docker inspect evolution-caddy-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
grep -q '^EVOLUTION_NETWORK=' .env 2>/dev/null || echo "EVOLUTION_NETWORK=$NET" >> .env
# Site do CRM no Caddy (HTTPS automático): crm.<host da Evolution>
CADDY=/opt/evolution/Caddyfile
if ! grep -q 'crm-bielenki:3000' "$CADDY"; then
  cp "$CADDY" "$CADDY.antes-crm.$(date +%Y%m%d%H%M%S)"
  printf '\ncrm.{$HOST} {\n  encode gzip\n  reverse_proxy crm-bielenki:3000\n}\n' >> "$CADDY"
fi
# Recarrega o Caddy (confere a configuração antes; se houver erro, a anterior continua valendo)
docker exec evolution-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
# Atualização automática a cada 2 minutos
cat > /etc/systemd/system/crm-atualizar.service <<UNIT
[Unit]
Description=Publica a versão nova do CRM Bielenki
[Service]
Type=oneshot
ExecStart=$BASE/atualizar.sh
UNIT
cat > /etc/systemd/system/crm-atualizar.timer <<UNIT
[Unit]
Description=Confere a main do CRM a cada 2 minutos
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
echo "Instalado. Próximo: preencher $BASE/.env e rodar $BASE/atualizar.sh --forcar"
