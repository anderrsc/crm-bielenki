#!/usr/bin/env bash
# Publica a versão nova do CRM quando a main do GitHub muda (rodado a cada 2 min pelo systemd).
# Constrói a imagem nova com o site no ar; a troca leva poucos segundos.
set -euo pipefail
cd /opt/crm-bielenki
exec 9>/tmp/crm-atualizar.lock; flock -n 9 || exit 0
export GIT_SSH_COMMAND="ssh -i /root/.ssh/crm_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
git -C app fetch -q origin main
LOCAL=$(git -C app rev-parse HEAD); REMOTE=$(git -C app rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ] && [ "${1:-}" != "--forcar" ]; then exit 0; fi
git -C app reset -q --hard origin/main
export DEPLOY_ID=$(git -C app rev-parse --short=12 HEAD)
echo "$(date -Is) publicando $DEPLOY_ID"
docker compose build -q crm
docker compose up -d crm
docker image prune -f >/dev/null 2>&1 || true
echo "$(date -Is) publicado $DEPLOY_ID"
