// Envio de texto pelo WhatsApp (Meta oficial ou Evolution). Somente no servidor.
import { decryptSecret } from "@/lib/encrypt";
import { safeExternalUrl } from "@/lib/safe-url";

export type WhatsAppProvider = "meta" | "evolution";
export type WhatsAppCredentials = {
  provider: WhatsAppProvider;
  phoneNumberId: string;
  metaToken: string;
  evolutionUrl: string;
  evolutionKey: string;
  evolutionInstance: string;
};

const GRAPH_VERSION = () => process.env.WHATSAPP_API_VERSION || "v23.0";
const secret = (value?: unknown) => (typeof value === "string" && value ? decryptSecret(value) : "");
const text = (value?: unknown) => (typeof value === "string" ? value : "");

/** Credenciais a partir da config do agente + variáveis do servidor. */
export function whatsappCredentials(
  agentConfig: Record<string, unknown> | null | undefined,
  opts: { provider?: WhatsAppProvider; phoneNumberId?: string; companyPhoneNumberId?: string | null } = {},
): WhatsAppCredentials {
  const cfg = agentConfig ?? {};
  const evolutionUrl = text(cfg.evolution_api_url) || process.env.EVOLUTION_API_URL || "";
  const evolutionInstance = text(cfg.evolution_instance) || process.env.EVOLUTION_INSTANCE || "";
  const phoneNumberId = opts.phoneNumberId || opts.companyPhoneNumberId || text(cfg.whatsapp_number_id) || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const metaToken = secret(cfg.whatsapp_token) || process.env.WHATSAPP_ACCESS_TOKEN || "";
  // Sem canal informado: usa o que estiver configurado (Meta tem preferência).
  const provider: WhatsAppProvider = opts.provider
    ?? (phoneNumberId && metaToken ? "meta" : evolutionUrl && evolutionInstance ? "evolution" : cfg.wpp_provider === "evolution" ? "evolution" : "meta");
  return {
    provider,
    phoneNumberId,
    metaToken,
    evolutionUrl,
    evolutionKey: secret(cfg.evolution_api_key) || process.env.EVOLUTION_API_KEY || "",
    evolutionInstance,
  };
}

export class WhatsAppSendError extends Error {}

/** Envia texto. Devolve o id da mensagem no WhatsApp (quando o provedor informa). */
export async function sendWhatsAppText(c: WhatsAppCredentials, to: string, body: string): Promise<string | null> {
  if (c.provider === "evolution") {
    if (!c.evolutionUrl || !c.evolutionInstance) throw new WhatsAppSendError("WhatsApp (Evolution) não configurado.");
    const base = safeExternalUrl(c.evolutionUrl);
    if (!base) throw new WhatsAppSendError("URL da Evolution API inválida: use um endereço HTTPS público.");
    const response = await fetch(`${base}/message/sendText/${encodeURIComponent(c.evolutionInstance)}`, {
      redirect: "error",
      method: "POST",
      headers: { apikey: c.evolutionKey, "Content-Type": "application/json" },
      body: JSON.stringify({ number: to, text: body }),
    });
    if (!response.ok) throw new WhatsAppSendError(`Evolution API HTTP ${response.status}`);
    const data = await response.json().catch(() => null);
    return data?.key?.id ?? null;
  }

  if (!c.metaToken || !c.phoneNumberId) throw new WhatsAppSendError("WhatsApp (Meta) não configurado: falta o token ou o Phone Number ID.");
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION()}/${c.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.metaToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code;
    // 131047: passou de 24h desde a última mensagem do cliente (exige modelo aprovado).
    if (code === 131047) throw new WhatsAppSendError("Passaram 24h desde a última mensagem do cliente: o WhatsApp só deixa enviar modelo aprovado. Peça para o cliente mandar uma mensagem ou use um modelo.");
    throw new WhatsAppSendError(`WhatsApp (Meta): ${data?.error?.message ?? `HTTP ${response.status}`}`);
  }
  return data?.messages?.[0]?.id ?? null;
}
