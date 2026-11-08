"use server";
// Conexão do WhatsApp pela Evolution, feita pela Central de IA (só administrador/gerente:
// a tabela ai_agent_config só abre para esses papéis).
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret, encryptSecret } from "@/lib/encrypt";
import {
  EVOLUTION_INSTANCE, ensureEvolutionInstance, evolutionChatPhones, evolutionCloudInit, evolutionLogout,
  evolutionPing, evolutionQr, evolutionState, evolutionUrlFromIp,
} from "@/lib/whatsapp/evolution";
import { digitsOnly } from "@/lib/whatsapp/phone";

export type WhatsappSetup = {
  hasKey: boolean;
  url: string | null;
  instance: string;
  cloudInit: string | null;
  state: string | null;
  stateError: string | null;
  syncedAt: string | null;
};
type Result<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

const fail = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) });

async function context() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) throw new Error("Empresa não encontrada.");
  const { data: cfg, error } = await db.from("ai_agent_config").select("*").eq("company_id", profile.company_id).maybeSingle();
  if (error) throw new Error(/column/i.test(error.message) ? "Falta aplicar a atualização do banco 20261108010000_evolution_conexao.sql." : error.message);
  return { db, companyId: profile.company_id as string, cfg: (cfg ?? null) as Record<string, unknown> | null };
}

const secret = (v: unknown) => (typeof v === "string" && v ? decryptSecret(v) : "");
/** Chave gerada pelo CRM (hex). Uma chave antiga digitada à mão na tela do Agente IA é ignorada. */
const crmKey = (v: unknown) => { const k = secret(v); return /^[A-Za-z0-9]{32,128}$/.test(k) ? k : ""; };
const text = (v: unknown) => (typeof v === "string" ? v : "");

async function webhookUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/api/whatsapp/webhook`;
}

async function save(db: Awaited<ReturnType<typeof createClient>>, companyId: string, values: Record<string, unknown>) {
  const { error } = await db.from("ai_agent_config").upsert({ company_id: companyId, ...values, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
}

export async function getWhatsappSetup(): Promise<Result<{ setup: WhatsappSetup }>> {
  try {
    const { cfg } = await context();
    const key = crmKey(cfg?.evolution_api_key);
    const url = key ? text(cfg?.evolution_api_url) || null : null;
    const instance = text(cfg?.evolution_instance) || EVOLUTION_INSTANCE;
    let state: string | null = null;
    let stateError: string | null = null;
    if (key && url) {
      try { state = await evolutionState(url, key, instance); } catch (e) { stateError = e instanceof Error ? e.message : String(e); }
    }
    return {
      ok: true,
      setup: {
        hasKey: !!key, url, instance, state, stateError,
        cloudInit: key ? evolutionCloudInit(key) : null,
        syncedAt: text(cfg?.evolution_known_synced_at) || null,
      },
    };
  } catch (e) { return fail(e); }
}

/** Passo 1: gera a chave da Evolution e o segredo do webhook (uma vez). */
export async function generateEvolutionKey(): Promise<Result> {
  try {
    const { db, companyId, cfg } = await context();
    if (crmKey(cfg?.evolution_api_key) && secret(cfg?.evolution_webhook_secret)) return { ok: true };
    await save(db, companyId, {
      evolution_api_key: encryptSecret(randomBytes(32).toString("hex")),
      evolution_webhook_secret: encryptSecret(randomBytes(24).toString("hex")),
      evolution_instance: EVOLUTION_INSTANCE,
      evolution_api_url: null, // servidor antigo não vale para a chave nova
    });
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Passo 2: IP público da máquina criada na Oracle. Testa e liga o webhook. */
export async function saveEvolutionServer(ip: string): Promise<Result> {
  try {
    const { db, companyId, cfg } = await context();
    const url = evolutionUrlFromIp(ip);
    if (!url) return { error: "IP inválido. Copie o \"Endereço IP público\" da máquina na Oracle (ex.: 129.146.10.20)." };
    const key = crmKey(cfg?.evolution_api_key);
    const hook = secret(cfg?.evolution_webhook_secret);
    if (!key || !hook) return { error: "Gere a instalação primeiro (passo 1)." };
    await evolutionPing(url, key);
    const instance = text(cfg?.evolution_instance) || EVOLUTION_INSTANCE;
    await ensureEvolutionInstance(url, key, instance, await webhookUrl(), hook);
    await save(db, companyId, { evolution_api_url: url, evolution_instance: instance, wpp_provider: "evolution" });
    revalidatePath("/central-ia");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Passo 3: QR code (ou "open" quando já conectou). */
export async function getEvolutionQr(): Promise<Result<{ state: string; qr: string | null; pairingCode: string | null }>> {
  try {
    const { cfg } = await context();
    const key = crmKey(cfg?.evolution_api_key);
    const url = text(cfg?.evolution_api_url);
    const instance = text(cfg?.evolution_instance) || EVOLUTION_INSTANCE;
    if (!key || !url) return { error: "Servidor da Evolution não configurado." };
    const state = await evolutionState(url, key, instance);
    if (state === "open") return { ok: true, state, qr: null, pairingCode: null };
    const { qr, pairingCode } = await evolutionQr(url, key, instance);
    return { ok: true, state, qr, pairingCode };
  } catch (e) { return fail(e); }
}

/**
 * Marca todas as conversas que já existem no WhatsApp como "contato conhecido":
 * a Ana não responde fornecedor, família nem cliente antigo, só número novo.
 */
export async function syncKnownContacts(): Promise<Result<{ added: number; total: number }>> {
  try {
    const { db, companyId, cfg } = await context();
    const key = crmKey(cfg?.evolution_api_key);
    const url = text(cfg?.evolution_api_url);
    const instance = text(cfg?.evolution_instance) || EVOLUTION_INSTANCE;
    if (!key || !url) return { error: "Servidor da Evolution não configurado." };
    const phones = (await evolutionChatPhones(url, key, instance)).map(digitsOnly).filter((p) => p.length >= 10);
    const existing = new Set<string>();
    for (let i = 0; i < phones.length; i += 300) {
      const { data } = await db.from("conversations").select("external_id")
        .eq("company_id", companyId).eq("channel", "whatsapp").in("external_id", phones.slice(i, i + 300));
      for (const r of data ?? []) existing.add(r.external_id as string);
    }
    const missing = phones.filter((p) => !existing.has(p));
    for (let i = 0; i < missing.length; i += 300) {
      const { error } = await db.from("conversations").insert(missing.slice(i, i + 300).map((p) => ({
        company_id: companyId, channel: "whatsapp", external_id: p, phone: p, status: "aberta", ai_paused: true,
      })));
      if (error) return { error: error.message };
    }
    // Conversas que já existiam também passam a ser da equipe.
    for (let i = 0; i < phones.length; i += 300) {
      await db.from("conversations").update({ ai_paused: true })
        .eq("company_id", companyId).eq("channel", "whatsapp").in("external_id", phones.slice(i, i + 300));
    }
    await save(db, companyId, { evolution_known_synced_at: new Date().toISOString() });
    revalidatePath("/central-ia");
    return { ok: true, added: missing.length, total: phones.length };
  } catch (e) { return fail(e); }
}

export async function disconnectEvolution(): Promise<Result> {
  try {
    const { cfg } = await context();
    const key = crmKey(cfg?.evolution_api_key);
    const url = text(cfg?.evolution_api_url);
    if (!key || !url) return { ok: true };
    await evolutionLogout(url, key, text(cfg?.evolution_instance) || EVOLUTION_INSTANCE);
    revalidatePath("/central-ia");
    return { ok: true };
  } catch (e) { return fail(e); }
}
