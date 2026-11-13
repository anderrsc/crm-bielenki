// Aviso automatico ao cliente quando a instalacao e marcada como concluida.
// Enviado uma unica vez por pedido (orders.install_notified_at) e registrado no Atendimento.
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getOrCreateConversation, recordOutbound } from "@/lib/whatsapp/inbox-store";
import { sendWhatsAppText, whatsappCredentials } from "@/lib/whatsapp/send";
import { digitsOnly } from "@/lib/whatsapp/phone";

export function installedMessage(firstName: string | null, company: string) {
  const hello = firstName ? `Olá, ${firstName}!` : "Olá!";
  return `${hello} Aqui é da ${company}. Passando para avisar que a instalação do seu pedido foi concluída. ✅\n\nQualquer dúvida ou ajuste, é só responder esta mensagem. Obrigado pela confiança!`;
}

/** Devolve "sent", "skipped" (ja avisado, sem telefone ou sem WhatsApp configurado) ou "failed". */
export async function notifyInstalled(orderId: string): Promise<"sent" | "skipped" | "failed"> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return "skipped";
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  // Reserva atomica: dois cliques ou dois caminhos (producao e instalacao) nao enviam em dobro.
  const { data: claimed } = await db.from("orders").update({ install_notified_at: new Date().toISOString() })
    .eq("id", orderId).is("install_notified_at", null).select("id,company_id,client:clients(name,phone,whatsapp)");
  const order = claimed?.[0] as unknown as { id: string; company_id: string; client: { name?: string; phone?: string | null; whatsapp?: string | null } | null } | undefined;
  if (!order) return "skipped";
  const release = () => db.from("orders").update({ install_notified_at: null }).eq("id", orderId);
  try {
    let phone = digitsOnly(order.client?.whatsapp || order.client?.phone || "");
    if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
    if (phone.length < 12) { await release(); return "skipped"; }
    const [{ data: cfg }, { data: company }] = await Promise.all([
      db.from("ai_agent_config").select("*").eq("company_id", order.company_id).maybeSingle(),
      db.from("companies").select("name,trade_name,whatsapp_phone_number_id").eq("id", order.company_id).single(),
    ]);
    const credentials = whatsappCredentials(cfg, { companyPhoneNumberId: company?.whatsapp_phone_number_id });
    const first = (order.client?.name ?? "").trim().split(/\s+/)[0] || null;
    const body = installedMessage(first && !/^contato$/i.test(first) ? first : null, company?.trade_name || company?.name || "nossa equipe");
    let externalId: string | null = null; let failure: string | null = null;
    try { externalId = await sendWhatsAppText(credentials, phone, body); }
    catch (error) { failure = error instanceof Error ? error.message : String(error); }
    try {
      const conversation = await getOrCreateConversation(db, order.company_id, phone, order.client?.name ?? null, { aiPaused: true });
      await recordOutbound(db, { companyId: order.company_id, conversationId: conversation.id, body, author: "automacao", senderName: "Aviso automático", externalId, deliveryStatus: failure ? "falhou" : "enviada", error: failure });
    } catch (error) { console.error("Aviso de instalação: falha ao registrar no Atendimento:", error instanceof Error ? error.message : error); }
    if (failure) { await release(); return "failed"; }
    return "sent";
  } catch (error) {
    console.error("Aviso de instalação:", error instanceof Error ? error.message : error);
    await release();
    return "failed";
  }
}
