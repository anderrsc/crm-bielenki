// Canais de WhatsApp (vários números por empresa). Somente no servidor (service role).
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/encrypt";
import { whatsappCredentials, type WhatsAppCredentials } from "@/lib/whatsapp/send";

export type WhatsappChannel = {
  id: string; company_id: string; name: string; provider: "evolution" | "meta";
  instance: string | null; phone_number_id: string | null; phone_display: string | null;
  api_url: string | null; api_key: string | null; meta_token: string | null; webhook_secret: string | null;
  is_default: boolean; active: boolean;
};

const COLS = "id,company_id,name,provider,instance,phone_number_id,phone_display,api_url,api_key,meta_token,webhook_secret,is_default,active";
const secret = (v?: string | null) => (v ? decryptSecret(v) : "");

/** Canal pela instância da Evolution ou pelo Phone Number ID da Meta. */
export async function channelByProviderId(db: SupabaseClient, provider: "evolution" | "meta", id: string): Promise<WhatsappChannel | null> {
  if (!id) return null;
  const { data } = await db.from("whatsapp_channels").select(COLS).eq("provider", provider)
    .eq(provider === "evolution" ? "instance" : "phone_number_id", id).is("deleted_at", null).maybeSingle();
  return (data as WhatsappChannel | null) ?? null;
}

export async function channelById(db: SupabaseClient, id: string | null | undefined): Promise<WhatsappChannel | null> {
  if (!id) return null;
  const { data } = await db.from("whatsapp_channels").select(COLS).eq("id", id).maybeSingle();
  return (data as WhatsappChannel | null) ?? null;
}

export async function defaultChannel(db: SupabaseClient, companyId: string): Promise<WhatsappChannel | null> {
  const { data } = await db.from("whatsapp_channels").select(COLS).eq("company_id", companyId).eq("is_default", true).is("deleted_at", null).maybeSingle();
  return (data as WhatsappChannel | null) ?? null;
}

/**
 * Credenciais para enviar pelo canal da conversa. Sem canal (dados antigos) usa a
 * conexão da empresa, como antes. O canal define provedor, instância/Phone Number ID
 * e, se tiver, servidor/chave próprios.
 */
export function channelCredentials(cfg: Record<string, unknown> | null | undefined, channel: WhatsappChannel | null, fallback: { companyPhoneNumberId?: string | null } = {}): WhatsAppCredentials {
  if (!channel) return whatsappCredentials(cfg, fallback);
  const base = whatsappCredentials(cfg, { provider: channel.provider, phoneNumberId: channel.phone_number_id ?? fallback.companyPhoneNumberId ?? undefined });
  return {
    ...base,
    provider: channel.provider,
    evolutionInstance: channel.instance ?? base.evolutionInstance,
    evolutionUrl: channel.api_url || base.evolutionUrl,
    evolutionKey: secret(channel.api_key) || base.evolutionKey,
    phoneNumberId: channel.phone_number_id ?? base.phoneNumberId,
    metaToken: secret(channel.meta_token) || base.metaToken,
  };
}
