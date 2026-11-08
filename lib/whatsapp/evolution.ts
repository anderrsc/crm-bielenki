// Evolution API (WhatsApp não oficial, via QR code). Somente no servidor.
import { safeExternalUrl } from "@/lib/safe-url";

// 2.4.x exige ativar licença no servidor da Evolution; 2.3.7 é a última estável sem licença.
export const EVOLUTION_IMAGE_TAG = "v2.3.7";
export const EVOLUTION_INSTANCE = "crm";

export class EvolutionError extends Error {}

/** "129.146.10.20" -> "https://129-146-10-20.sslip.io" (HTTPS automático, sem domínio próprio). */
export function evolutionUrlFromIp(ip: string): string | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m || m.slice(1).some((n) => Number(n) > 255)) return null;
  // IP privado viraria um atalho para a rede interna (sslip.io resolve para ele).
  if (!safeExternalUrl(`https://${ip.trim()}`)) return null;
  return `https://${m.slice(1).join("-")}.sslip.io`;
}

async function call<T = unknown>(base: string, apiKey: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = safeExternalUrl(base);
  if (!url) throw new EvolutionError("Endereço da Evolution inválido (precisa ser HTTPS público).");
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method: init.method ?? "GET",
      redirect: "error",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new EvolutionError("O servidor da Evolution não respondeu. Ele pode ainda estar instalando (leva uns 10 minutos) ou as portas 80/443 estão fechadas.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.response?.message ?? data?.message ?? data?.error;
    throw new EvolutionError(`Evolution HTTP ${response.status}${detail ? `: ${Array.isArray(detail) ? detail.join(", ") : String(detail)}` : ""}`);
  }
  return data as T;
}

const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];

export async function evolutionPing(base: string, apiKey: string) {
  return call<{ version?: string }>(base, apiKey, "/");
}

/** Cria a instância (se não existir) e aponta o webhook para o CRM com o segredo no cabeçalho. */
export async function ensureEvolutionInstance(base: string, apiKey: string, instance: string, webhookUrl: string, webhookSecret: string) {
  const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, headers: { "x-webhook-secret": webhookSecret }, events: WEBHOOK_EVENTS };
  const list = await call<Array<{ name?: string; instance?: { instanceName?: string } }>>(base, apiKey, "/instance/fetchInstances").catch(() => []);
  const exists = Array.isArray(list) && list.some((i) => (i.name ?? i.instance?.instanceName) === instance);
  if (!exists) {
    await call(base, apiKey, "/instance/create", {
      method: "POST",
      body: { instanceName: instance, integration: "WHATSAPP-BAILEYS", qrcode: true, groupsIgnore: true, readMessages: false, alwaysOnline: false, syncFullHistory: false, webhook },
    });
  }
  await call(base, apiKey, `/webhook/set/${encodeURIComponent(instance)}`, { method: "POST", body: { webhook } });
}

export async function evolutionState(base: string, apiKey: string, instance: string): Promise<string> {
  const data = await call<{ instance?: { state?: string }; state?: string }>(base, apiKey, `/instance/connectionState/${encodeURIComponent(instance)}`);
  return data?.instance?.state ?? data?.state ?? "unknown";
}

/** QR code (data URL) para ler no celular. */
export async function evolutionQr(base: string, apiKey: string, instance: string): Promise<{ qr: string | null; pairingCode: string | null }> {
  const data = await call<{ base64?: string; pairingCode?: string; qrcode?: { base64?: string } }>(base, apiKey, `/instance/connect/${encodeURIComponent(instance)}`);
  return { qr: data?.base64 ?? data?.qrcode?.base64 ?? null, pairingCode: data?.pairingCode ?? null };
}

export async function evolutionLogout(base: string, apiKey: string, instance: string) {
  await call(base, apiKey, `/instance/logout/${encodeURIComponent(instance)}`, { method: "DELETE" });
}

type EvoChat = { remoteJid?: string; id?: string; lastMessage?: { key?: Record<string, unknown> }; lastMessage_key?: Record<string, unknown> };

/**
 * Telefones já conhecidos: conversas que existem no WhatsApp + contatos salvos na agenda
 * do celular (fornecedores, família, clientes antigos).
 */
export async function evolutionChatPhones(base: string, apiKey: string, instance: string): Promise<string[]> {
  const path = (p: string) => `/chat/${p}/${encodeURIComponent(instance)}`;
  const [chats, contacts] = await Promise.all([
    call<EvoChat[]>(base, apiKey, path("findChats"), { method: "POST", body: {} }).catch(() => []),
    call<EvoChat[]>(base, apiKey, path("findContacts"), { method: "POST", body: { where: {} } }).catch(() => []),
  ]);
  const phones = new Set<string>();
  for (const c of [...(Array.isArray(chats) ? chats : []), ...(Array.isArray(contacts) ? contacts : [])]) {
    const jid = String(c.remoteJid ?? c.id ?? "");
    if (jid.endsWith("@s.whatsapp.net")) phones.add(jid.split("@")[0]);
    else if (jid.endsWith("@lid")) {
      const key = c.lastMessage?.key ?? c.lastMessage_key;
      const alt = key?.remoteJidAlt ?? key?.senderPn;
      if (typeof alt === "string" && alt.endsWith("@s.whatsapp.net")) phones.add(alt.split("@")[0]);
    }
  }
  return [...phones];
}

/**
 * Script colado em "Inicialização (cloud-init)" ao criar a máquina gratuita da Oracle (Ubuntu).
 * Instala Docker, Evolution, Postgres, Redis e Caddy (HTTPS automático em <ip>.sslip.io).
 */
export function evolutionCloudInit(apiKey: string): string {
  if (!/^[A-Za-z0-9]{32,128}$/.test(apiKey)) throw new EvolutionError("Chave inválida.");
  return `#!/bin/bash
# Evolution API para o CRM Marquinhos — instalacao automatica (Oracle Cloud, Ubuntu).
set -e
exec > /var/log/evolution-setup.log 2>&1
export DEBIAN_FRONTEND=noninteractive

# Memoria extra (a maquina gratuita pequena tem 1 GB)
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

# Libera as portas 80 e 443 no firewall da imagem Ubuntu da Oracle
iptables -I INPUT -p tcp --dport 80 -j ACCEPT
iptables -I INPUT -p tcp --dport 443 -j ACCEPT
(apt-get install -y iptables-persistent || true) && (netfilter-persistent save || true)

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

mkdir -p /opt/evolution && cd /opt/evolution
IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
HOST="$(echo "$IP" | tr . -).sslip.io"
cat > .env <<ENV
API_KEY=${apiKey}
PGPASS=$(openssl rand -hex 16)
HOST=$HOST
ENV

cat > Caddyfile <<'CADDY'
{$HOST} {
  reverse_proxy evolution:8080
}
CADDY

cat > docker-compose.yml <<'YML'
services:
  evolution:
    image: evoapicloud/evolution-api:${EVOLUTION_IMAGE_TAG}
    restart: always
    depends_on: [postgres, redis]
    environment:
      SERVER_URL: https://\${HOST}
      AUTHENTICATION_API_KEY: \${API_KEY}
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "false"
      DEL_INSTANCE: "false"
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:\${PGPASS}@postgres:5432/evolution?schema=public
      DATABASE_CONNECTION_CLIENT_NAME: evolution_crm
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      DATABASE_SAVE_MESSAGE_UPDATE: "false"
      DATABASE_SAVE_DATA_CONTACTS: "true"
      DATABASE_SAVE_DATA_CHATS: "true"
      DATABASE_SAVE_DATA_HISTORIC: "true"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://redis:6379/6
      CACHE_REDIS_PREFIX_KEY: evolution_crm
      CACHE_LOCAL_ENABLED: "false"
      CONFIG_SESSION_PHONE_CLIENT: CRM Marquinhos
      CONFIG_SESSION_PHONE_NAME: Chrome
      QRCODE_LIMIT: "30"
      LOG_LEVEL: ERROR,WARN
    volumes:
      - instances:/evolution/instances
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: \${PGPASS}
      POSTGRES_DB: evolution
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data
  caddy:
    image: caddy:2
    restart: always
    ports: ["80:80", "443:443"]
    environment:
      HOST: \${HOST}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
volumes:
  instances:
  pgdata:
  redisdata:
  caddydata:
YML

docker compose pull
docker compose up -d
echo "PRONTO: https://$HOST"
`;
}
