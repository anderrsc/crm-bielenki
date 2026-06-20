import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const normalizePhone = (value: string) => { const digits = value.replace(/\D/g, ""); return digits.length <= 11 ? `55${digits}` : digits; };

Deno.serve(async (request) => {
  const secret = Deno.env.get("AUTOMATION_SECRET");
  if (!secret || request.headers.get("x-automation-secret") !== secret) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!url || !serviceKey || !token) return json({ error: "missing_environment" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: queued, error: queueError } = await db.rpc("enqueue_due_automations");
  if (queueError) return json({ error: queueError.message }, 500);
  const { data: messages, error } = await db.from("outbound_messages").select("id,company_id,phone,body,attempts,companies!inner(whatsapp_phone_number_id)").eq("status", "pending").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(50);
  if (error) return json({ error: error.message }, 500);
  const apiVersion = Deno.env.get("WHATSAPP_API_VERSION") || "v23.0"; let sent = 0; let failed = 0;
  for (const message of messages ?? []) {
    await db.from("outbound_messages").update({ status: "processing", attempts: message.attempts + 1 }).eq("id", message.id).eq("status", "pending");
    const company = message.companies as unknown as { whatsapp_phone_number_id?: string }; const phoneNumberId = company?.whatsapp_phone_number_id || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    if (!phoneNumberId) { await db.from("outbound_messages").update({ status: "failed", error_message: "WhatsApp Phone Number ID não configurado" }).eq("id", message.id); failed++; continue; }
    try {
      const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: normalizePhone(message.phone), type: "text", text: { preview_url: false, body: message.body } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message || `HTTP ${response.status}`);
      await db.from("outbound_messages").update({ status: "sent", sent_at: new Date().toISOString(), external_id: result?.messages?.[0]?.id ?? null, error_message: null }).eq("id", message.id); sent++;
    } catch (cause) { await db.from("outbound_messages").update({ status: message.attempts >= 2 ? "failed" : "pending", error_message: cause instanceof Error ? cause.message : String(cause), scheduled_at: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", message.id); failed++; }
  }
  return json({ queued, processed: messages?.length ?? 0, sent, failed });
});
