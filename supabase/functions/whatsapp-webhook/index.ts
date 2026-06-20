import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const response = (body: string, status = 200) => new Response(body, { status });
const normalize = (value: string) => value.replace(/\D/g, "");
async function validSignature(raw:string,signature:string|null){const secret=Deno.env.get("WHATSAPP_APP_SECRET");if(!secret)return false;const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const signed=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw));const expected="sha256="+[...new Uint8Array(signed)].map(x=>x.toString(16).padStart(2,"0")).join("");return signature===expected;}

async function sendWhatsApp(phoneNumberId: string, to: string, body: string) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN"); const version = Deno.env.get("WHATSAPP_API_VERSION") || "v23.0";
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN ausente");
  const result = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }) });
  if (!result.ok) throw new Error((await result.json())?.error?.message || `HTTP ${result.status}`);
}

Deno.serve(async (request) => {
  const requestUrl = new URL(request.url);
  if (request.method === "GET") {
    const valid = requestUrl.searchParams.get("hub.mode") === "subscribe" && requestUrl.searchParams.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return valid ? response(requestUrl.searchParams.get("hub.challenge") || "") : response("forbidden", 403);
  }
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return response("missing environment", 500);
  const raw=await request.text(); if(!(await validSignature(raw,request.headers.get("x-hub-signature-256"))))return response("invalid signature",401);
  const payload = JSON.parse(raw); const change = payload?.entry?.[0]?.changes?.[0]?.value; const incoming = change?.messages?.[0];
  if (!incoming?.from || !incoming?.text?.body) return response("ok");
  const phoneNumberId = change?.metadata?.phone_number_id; const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: company } = await db.from("companies").select("id,name,trade_name").eq("whatsapp_phone_number_id", phoneNumberId).maybeSingle();
  const companyId = company?.id || Deno.env.get("DEFAULT_COMPANY_ID"); if (!companyId) return response("company not found", 404);
  const phone = normalize(incoming.from); const contactName = change?.contacts?.[0]?.profile?.name || `WhatsApp ${phone}`;
  let { data: client } = await db.from("clients").select("id,name").eq("company_id",companyId).or(`whatsapp.eq.${phone},phone.eq.${phone}`).limit(1).maybeSingle();
  if (!client) { const created = await db.from("clients").insert({ company_id:companyId,name:contactName,whatsapp:phone,lead_source:"WhatsApp",status:"ativo" }).select("id,name").single(); client=created.data; }
  let { data: conversation } = await db.from("conversations").select("id").eq("company_id",companyId).eq("channel","whatsapp").eq("external_id",phone).eq("status","aberta").maybeSingle();
  if (!conversation) { const created = await db.from("conversations").insert({ company_id:companyId,client_id:client?.id,channel:"whatsapp",external_id:phone,status:"aberta" }).select("id").single(); conversation=created.data; }
  if (!conversation) return response("conversation error",500);
  await db.from("messages").insert({ company_id:companyId,conversation_id:conversation.id,direction:"inbound",body:incoming.text.body,sent_at:new Date(Number(incoming.timestamp)*1000).toISOString() });
  let { data: session } = await db.from("chatbot_sessions").select("*").eq("conversation_id",conversation.id).maybeSingle();
  if (!session) { const created = await db.from("chatbot_sessions").insert({ company_id:companyId,conversation_id:conversation.id,phone,current_step:"menu" }).select("*").single(); session=created.data; }
  const text = incoming.text.body.trim().toLowerCase(); const companyName = company?.trade_name || company?.name || "Marquinhos Calhas e Esquadrias"; let reply = "";
  if (session?.current_step === "awaiting_schedule") {
    await db.from("tasks").insert({ company_id:companyId,title:`Agendamento solicitado por ${client?.name || contactName}`,description:`Preferência informada no WhatsApp: ${incoming.text.body}`,due_at:new Date(Date.now()+24*60*60_000).toISOString(),status:"pendente",priority:"alta",related_type:"client",related_id:client?.id });
    await db.from("chatbot_sessions").update({current_step:"menu",data:{preferred_schedule:incoming.text.body},expires_at:new Date(Date.now()+24*60*60_000).toISOString()}).eq("id",session.id);
    reply="Recebemos sua preferência. Nossa equipe confirmará o melhor horário em breve.";
  } else if (text === "1" || text.includes("financeir")) {
    await db.from("tasks").insert({company_id:companyId,title:`Retorno financeiro: ${client?.name || contactName}`,assigned_to:null,due_at:new Date(Date.now()+4*60*60_000).toISOString(),status:"pendente",priority:"alta",related_type:"client",related_id:client?.id}); reply="Certo! Encaminhei sua solicitação ao financeiro. Uma pessoa da equipe dará continuidade.";
  } else if (text === "2" || text.includes("agend")) {
    await db.from("chatbot_sessions").update({current_step:"awaiting_schedule",expires_at:new Date(Date.now()+24*60*60_000).toISOString()}).eq("id",session?.id); reply="Qual dia e período você prefere? Exemplo: terça-feira pela manhã.";
  } else if (text === "3" || text.includes("atendente") || text.includes("reagendar")) {
    await db.from("tasks").insert({company_id:companyId,title:`Atender WhatsApp: ${client?.name || contactName}`,due_at:new Date(Date.now()+2*60*60_000).toISOString(),status:"pendente",priority:"alta",related_type:"client",related_id:client?.id}); reply="Tudo certo! Vou transferir sua solicitação para uma pessoa da nossa equipe.";
  } else if (text.includes("confirmar")) { reply="Agendamento confirmado. Obrigado!"; }
  else { reply=`Olá! Sou o atendimento virtual da ${companyName}. Digite:\n1 - Financeiro\n2 - Agendamento\n3 - Falar com atendente`; }
  await sendWhatsApp(phoneNumberId,phone,reply);
  await db.from("messages").insert({company_id:companyId,conversation_id:conversation.id,direction:"outbound",body:reply,sent_at:new Date().toISOString()});
  return response("ok");
});
