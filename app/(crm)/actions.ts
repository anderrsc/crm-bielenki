"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const text = z.string().trim().min(1);

export async function createClientRecord(formData: FormData) {
  const db = await createClient();
  const parsed = z.object({ name: text, phone: z.string().optional(), email: z.string().email().or(z.literal("")).optional(), tax_id: z.string().optional(), city: z.string().optional(), state: z.string().optional(), notes: z.string().optional(), lead_source_id:z.string().uuid().or(z.literal("")).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/clientes/novo?erro=Revise os campos obrigatórios");
  const { data: profile } = await db.from("profiles").select("company_id").single();
  const { data, error } = await db.from("clients").insert({ ...parsed.data, lead_source_id:parsed.data.lead_source_id||null, company_id: profile?.company_id }).select("id").single();
  if (error) redirect(`/clientes/novo?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/clientes"); redirect(`/clientes/${data.id}`);
}

export async function registerPayment(formData: FormData) {
  const db = await createClient();
  const entryId = String(formData.get("financial_entry_id"));
  const amount = Number(formData.get("amount"));
  const { error } = await db.rpc("register_payment", { p_entry_id: entryId, p_amount: amount, p_paid_at: String(formData.get("paid_at")), p_method: String(formData.get("payment_method")), p_notes: String(formData.get("notes") ?? "") });
  if (error) redirect(`/financeiro?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/financeiro");
}

export async function toggleChecklistItem(formData: FormData) {
  const db = await createClient();
  const id = String(formData.get("id"));
  const orderId = String(formData.get("order_id"));
  const status = String(formData.get("status")) === "concluido" ? "pendente" : "concluido";
  const { error } = await db.from("order_checklist_items").update({ status, completed_at: status === "concluido" ? new Date().toISOString() : null }).eq("id", id);
  if (error) redirect(`/pedidos/${orderId}/checklist?erro=${encodeURIComponent(error.message)}`);
  revalidatePath(`/pedidos/${orderId}`);
}

export async function saveGutterQuote(formData: FormData) {
  const db = await createClient();
  const payload = JSON.parse(String(formData.get("payload")));
  const parsed = z.object({ client_id: z.string().uuid(), discount: z.number().nonnegative(), freight: z.number().nonnegative(), notes: z.string(), items: z.array(z.object({ product: text, thickness: text, cut: text, quantity: z.number().positive(), meters: z.number().positive(), unit_price: z.number().nonnegative() })).min(1) }).safeParse(payload);
  if (!parsed.success) redirect("/orcamentos/calhas?erro=Revise os itens do orçamento");
  const { data, error } = await db.rpc("create_gutter_quote", { p_payload: parsed.data });
  if (error) redirect(`/orcamentos/calhas?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/orcamentos"); redirect(`/orcamentos/${data}`);
}

export async function updateCompanyIdentity(formData: FormData) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) redirect("/configuracoes?erro=Empresa não encontrada");

  const values = {
    name: String(formData.get("name") ?? "").trim(),
    trade_name: String(formData.get("trade_name") ?? "").trim(),
    tax_id: String(formData.get("tax_id") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    whatsapp: String(formData.get("whatsapp") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    neighborhood: String(formData.get("neighborhood") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    state: String(formData.get("state") ?? "").trim().slice(0, 2).toUpperCase(),
    website: String(formData.get("website") ?? "").trim(),
    primary_color: String(formData.get("primary_color") ?? "#234d3c"),
    accent_color: String(formData.get("accent_color") ?? "#b9d349"),
    quote_footer: String(formData.get("quote_footer") ?? "").trim(),
    whatsapp_phone_number_id: String(formData.get("whatsapp_phone_number_id") ?? "").trim() || null,
  };
  if (!values.name) redirect("/configuracoes?erro=Informe a razão social");

  let logoUrl: string | undefined;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > 2 * 1024 * 1024) redirect("/configuracoes?erro=A logo deve ter no máximo 2 MB");
    if (!logo.type.startsWith("image/")) redirect("/configuracoes?erro=Envie um arquivo de imagem");
    const extension = logo.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "png";
    const path = `${profile.company_id}/logo-${Date.now()}.${extension}`;
    const { error: uploadError } = await db.storage.from("company-assets").upload(path, logo, { contentType: logo.type, upsert: true });
    if (uploadError) redirect(`/configuracoes?erro=${encodeURIComponent(uploadError.message)}`);
    logoUrl = db.storage.from("company-assets").getPublicUrl(path).data.publicUrl;
  }

  const { error } = await db.from("companies").update({ ...values, ...(logoUrl ? { logo_url: logoUrl } : {}) }).eq("id", profile.company_id);
  if (error) redirect(`/configuracoes?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/configuracoes"); revalidatePath("/orcamentos", "layout"); revalidatePath("/clientes", "layout");
  redirect("/configuracoes?salvo=1");
}

export async function approveQuote(formData: FormData) {
  const db = await createClient();
  const quoteId = String(formData.get("quote_id"));
  const dueDate = String(formData.get("due_date") || "") || null;
  const { data, error } = await db.rpc("approve_quote", { p_quote_id: quoteId, p_due_date: dueDate });
  if (error) redirect(`/orcamentos/${quoteId}?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/orcamentos"); redirect(`/vendas/${data}`);
}

export async function saveAutomationRule(formData: FormData) {
  const db = await createClient();
  const ruleId = String(formData.get("rule_id")); const templateId = String(formData.get("template_id"));
  const daysBefore = Math.max(0, Math.min(30, Number(formData.get("days_before") || 0))); const body = String(formData.get("body") || "").trim();
  if (!body) redirect("/automacoes?erro=O texto da mensagem é obrigatório");
  const { error: templateError } = await db.from("message_templates").update({ body }).eq("id", templateId);
  if (templateError) redirect(`/automacoes?erro=${encodeURIComponent(templateError.message)}`);
  const { error } = await db.from("automation_rules").update({ enabled: formData.get("enabled") === "on", days_before: daysBefore, send_time: String(formData.get("send_time") || "09:00") }).eq("id", ruleId);
  if (error) redirect(`/automacoes?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/automacoes"); redirect("/automacoes?salvo=1");
}

export async function queueTestMessage(formData: FormData) {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  const phone = String(formData.get("phone") || "").replace(/\D/g, ""); const body = String(formData.get("body") || "").trim();
  if (!profile?.company_id || phone.length < 10 || !body) redirect("/automacoes?erro=Informe telefone e mensagem para o teste");
  const { error } = await db.from("outbound_messages").insert({ company_id: profile.company_id, automation_type: "manual_test", phone, body, dedupe_key: `manual-${crypto.randomUUID()}` });
  if (error) redirect(`/automacoes?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/automacoes"); redirect("/automacoes?teste=1");
}

export async function createLead(formData: FormData) {
  const db=await createClient(); const {data:{user}}=await db.auth.getUser(); if(!user) redirect("/login");
  const {data:profile}=await db.from("profiles").select("company_id").eq("id",user.id).single(); if(!profile?.company_id) redirect("/pipeline?erro=Empresa não encontrada");
  let stageId=String(formData.get("stage_id")||""); if(!stageId){const {data:stage}=await db.from("pipeline_stages").select("id").eq("company_id",profile.company_id).order("sort_order").limit(1).single();stageId=stage?.id??"";}
  const name=String(formData.get("name")||"").trim(); if(!name||!stageId) redirect("/pipeline?erro=Informe o nome e configure as etapas do pipeline");
  const estimated=Number(String(formData.get("estimated_value")||"0").replace(",","."));
  const {error}=await db.from("leads").insert({company_id:profile.company_id,name,phone:String(formData.get("phone")||"").trim(),source:"Manual",lead_source_id:String(formData.get("lead_source_id")||"")||null,stage_id:stageId,owner_id:user.id,estimated_value:Number.isFinite(estimated)?estimated:0,next_action:String(formData.get("next_action")||"").trim(),next_action_date:String(formData.get("next_action_date")||"")||null,status:"aberto"});
  if(error) redirect(`/pipeline?erro=${encodeURIComponent(error.message)}`); revalidatePath("/pipeline"); redirect("/pipeline?criado=1");
}

export async function moveLeadStage(leadId:string,stageId:string) {
  const db=await createClient(); const {data:stage,error:stageError}=await db.from("pipeline_stages").select("is_won,is_lost").eq("id",stageId).single(); if(stageError) throw new Error(stageError.message);
  const status=stage.is_won?"ganho":stage.is_lost?"perdido":"aberto"; const {error}=await db.from("leads").update({stage_id:stageId,status}).eq("id",leadId); if(error)throw new Error(error.message); revalidatePath("/pipeline");
}

export async function receivePurchaseItem(formData:FormData) {
  const db=await createClient();const itemId=String(formData.get("item_id"));const locationId=String(formData.get("location_id"));const quantity=Number(String(formData.get("quantity")||"0").replace(",","."));
  if(!itemId||!locationId||!Number.isFinite(quantity)||quantity<=0)redirect("/producao/materiais-do-pedido?erro=Informe quantidade e local de estoque");
  const {error}=await db.rpc("receive_purchase_item",{p_item_id:itemId,p_quantity:quantity,p_location_id:locationId,p_unit_cost:null,p_notes:String(formData.get("notes")||"")});
  if(error)redirect(`/producao/materiais-do-pedido?erro=${encodeURIComponent(error.message)}`);revalidatePath("/producao/materiais-do-pedido");revalidatePath("/compras");revalidatePath("/estoque");redirect("/producao/materiais-do-pedido?recebido=1");
}

export async function updateInstallationChecklist(formData:FormData) {
  const db=await createClient();const id=String(formData.get("item_id"));const installationId=String(formData.get("installation_id"));const completed=formData.get("completed")==="on";const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
  const {error}=await db.from("installation_checklists").update({completed,completed_at:completed?new Date().toISOString():null,completed_by:completed?user.id:null,notes:String(formData.get("notes")||"").trim(),updated_at:new Date().toISOString()}).eq("id",id);
  if(error)redirect(`/instalacoes/${installationId}?erro=${encodeURIComponent(error.message)}`);revalidatePath(`/instalacoes/${installationId}`);revalidatePath("/instalacoes");redirect(`/instalacoes/${installationId}?salvo=1`);
}

export async function updateInstallationStatus(formData:FormData) {
  const db=await createClient();const id=String(formData.get("installation_id"));const status=String(formData.get("status"));if(!["agendada","em_andamento","cancelada"].includes(status))redirect(`/instalacoes/${id}?erro=Status inválido`);
  const {error}=await db.from("installations").update({status}).eq("id",id);if(error)redirect(`/instalacoes/${id}?erro=${encodeURIComponent(error.message)}`);revalidatePath(`/instalacoes/${id}`);redirect(`/instalacoes/${id}`);
}

export async function saveGutterPrice(formData:FormData) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");const {data:profile}=await db.from("profiles").select("company_id").eq("id",user.id).single();if(!profile?.company_id)redirect("/configuracoes/tabela-calhas?erro=Empresa não encontrada");
  const id=String(formData.get("id")||"");const product=String(formData.get("product")||"").trim();const thickness=String(formData.get("thickness")||"");const cutMm=Number(formData.get("cut_mm"));const unitPrice=Number(String(formData.get("unit_price")||"0").replace(",","."));
  if(!product||!thickness||!cutMm||!Number.isFinite(unitPrice)||unitPrice<0)redirect("/configuracoes/tabela-calhas?erro=Revise produto, espessura, corte e preço");
  const values={company_id:profile.company_id,product,thickness,cut_mm:cutMm,unit_price:unitPrice,notes:String(formData.get("notes")||"").trim(),active:formData.get("active")==="on",updated_at:new Date().toISOString()};
  const result=id?await db.from("gutter_prices").update(values).eq("id",id):await db.from("gutter_prices").insert(values);if(result.error)redirect(`/configuracoes/tabela-calhas?erro=${encodeURIComponent(result.error.message)}`);revalidatePath("/configuracoes/tabela-calhas");revalidatePath("/orcamentos/calhas");redirect("/configuracoes/tabela-calhas?salvo=1");
}

export async function deleteGutterPrice(formData:FormData) {
  const db=await createClient();const {error}=await db.from("gutter_prices").delete().eq("id",String(formData.get("id")));if(error)redirect(`/configuracoes/tabela-calhas?erro=${encodeURIComponent(error.message)}`);revalidatePath("/configuracoes/tabela-calhas");redirect("/configuracoes/tabela-calhas");
}

export async function createManualSale(formData:FormData) {
  const db=await createClient();let payload:unknown;try{payload=JSON.parse(String(formData.get("payload")))}catch{redirect("/vendas/nova?erro=Dados da venda inválidos");}
  const {data,error}=await db.rpc("create_manual_sale",{p_payload:payload});if(error)redirect(`/vendas/nova?erro=${encodeURIComponent(error.message)}`);revalidatePath("/vendas");revalidatePath("/financeiro");redirect(`/vendas/${data}`);
}

export async function createManualPurchase(formData:FormData) {
  const db=await createClient();let payload:unknown;try{payload=JSON.parse(String(formData.get("payload")))}catch{redirect("/compras/nova?erro=Dados da compra inválidos");}
  const {data,error}=await db.rpc("create_manual_purchase",{p_payload:payload});if(error)redirect(`/compras/nova?erro=${encodeURIComponent(error.message)}`);revalidatePath("/compras");revalidatePath("/financeiro");redirect(`/compras/${data}`);
}

export async function saveLeadSource(formData:FormData) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");const {data:profile}=await db.from("profiles").select("company_id").eq("id",user.id).single();if(!profile?.company_id)redirect("/configuracoes/origens-lead?erro=Empresa não encontrada");
  const id=String(formData.get("id")||"");const name=String(formData.get("name")||"").trim();const channel=String(formData.get("channel")||"outros");const sortOrder=Number(formData.get("sort_order")||0);if(!name)redirect("/configuracoes/origens-lead?erro=Informe o nome da origem");
  const values={company_id:profile.company_id,name,channel,sort_order:sortOrder,active:formData.get("active")==="on",updated_at:new Date().toISOString()};const result=id?await db.from("lead_sources").update(values).eq("id",id):await db.from("lead_sources").insert(values);if(result.error)redirect(`/configuracoes/origens-lead?erro=${encodeURIComponent(result.error.message)}`);revalidatePath("/configuracoes/origens-lead");revalidatePath("/clientes/novo");revalidatePath("/pipeline");redirect("/configuracoes/origens-lead?salvo=1");
}
