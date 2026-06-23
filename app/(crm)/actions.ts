"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { encryptSecret } from "@/lib/encrypt";

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

export async function updateClientRecord(formData: FormData) {
  const db=await createClient();
  const id=String(formData.get("id")||"");
  const parsed=z.object({name:text,phone:z.string().optional(),email:z.string().email().or(z.literal("")).optional(),tax_id:z.string().optional(),city:z.string().optional(),state:z.string().max(2).optional(),notes:z.string().optional(),lead_source_id:z.string().uuid().or(z.literal("")).optional()}).safeParse(Object.fromEntries(formData));
  if(!z.string().uuid().safeParse(id).success||!parsed.success)redirect(`/clientes/${id}/editar?erro=Revise os campos`);
  const {error}=await db.from("clients").update({...parsed.data,lead_source_id:parsed.data.lead_source_id||null,updated_at:new Date().toISOString()}).eq("id",id);
  if(error)redirect(`/clientes/${id}/editar?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/clientes");redirect(`/clientes/${id}`);
}

export async function deactivateClient(formData: FormData) {
  const db=await createClient();const id=String(formData.get("id")||"");
  if(!z.string().uuid().safeParse(id).success)redirect("/clientes?erro=Cliente inválido");
  const {error}=await db.from("clients").update({status:"inativo",updated_at:new Date().toISOString()}).eq("id",id);
  if(error)redirect(`/clientes/${id}?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/clientes");redirect("/clientes");
}

export async function registerPayment(formData: FormData) {
  const db = await createClient();
  const requestedBack = String(formData.get("_back") || "/financeiro");
  const back = requestedBack.startsWith("/financeiro") ? requestedBack : "/financeiro";
  const entryId = String(formData.get("entry_id") || formData.get("financial_entry_id") || "");
  const amount = Number(formData.get("amount"));
  const interest = Number(formData.get("interest")||0);
  const discount = Number(formData.get("discount")||0);
  const installments = Number(formData.get("installments")||1);
  const paidAt = String(formData.get("paid_at") || new Date().toISOString().slice(0, 10));
  const firstDueDate = String(formData.get("first_due_date")||paidAt);
  const parsed = z.object({ entryId:z.string().uuid(), amount:z.number().finite().positive(), interest:z.number().finite().nonnegative(),discount:z.number().finite().nonnegative(),installments:z.number().int().min(1).max(60),paidAt:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),firstDueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({entryId,amount,interest,discount,installments,paidAt,firstDueDate});
  if(!parsed.success) redirect(`${back}?erro=Revise+os+dados+do+pagamento`);
  const { error } = await db.rpc("register_payment_with_adjustment", { p_entry_id: entryId, p_amount: amount, p_paid_at: paidAt, p_method: String(formData.get("payment_method") || "pix"), p_notes: String(formData.get("notes") ?? ""),p_interest:interest,p_discount:discount,p_installments:installments,p_first_due_date:firstDueDate });
  if (error) redirect(`${back}?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/financeiro"); redirect(`${back}?recebido=1`);
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

const specialItemSchema = z.object({ product: text, description: z.string().default(""), unit: z.string().default("unidade"), quantity: z.number().positive(), unit_price: z.number().nonnegative() });

export async function saveGutterQuote(formData: FormData) {
  const db = await createClient();
  const payload = JSON.parse(String(formData.get("payload")));
  const validUntil = String(formData.get("valid_until") || "").trim() || null;
  const installationDeadline = String(formData.get("installation_deadline") || "").trim() || null;
  const parsed = z.object({ client_id: z.string().uuid(), discount: z.number().nonnegative(), freight: z.number().nonnegative(), notes: z.string(), items: z.array(z.object({ product: text, thickness: text, cut: text, color: z.string().optional(), quantity: z.number().positive(), meters: z.number().positive(), unit_price: z.number().nonnegative() })).min(1), special_items: z.array(specialItemSchema).optional() }).safeParse(payload);
  if (!parsed.success) redirect("/orcamentos/calhas?erro=Revise os itens do orçamento");
  const { data, error } = await db.rpc("create_gutter_quote", { p_payload: { ...parsed.data, special_items: undefined } });
  if (error) redirect(`/orcamentos/calhas?erro=${encodeURIComponent(error.message)}`);
  if (data) {
    if (validUntil || installationDeadline) await db.from("quotes").update({ valid_until: validUntil, installation_deadline: installationDeadline }).eq("id", data);
    const specials = parsed.data.special_items ?? [];
    if (specials.length) {
      const { data: { user } } = await db.auth.getUser();
      const { data: prof } = await db.from("profiles").select("company_id").eq("id", user!.id).single();
      await db.from("quote_items").insert(specials.map(s => ({ quote_id: data, company_id: prof!.company_id, product: s.product, description: s.description || null, unit: s.unit, quantity: s.quantity, unit_price: s.unit_price, item_type: "especial" })));
    }
  }
  revalidatePath("/orcamentos"); redirect(`/orcamentos/${data}`);
}

export async function reversePayment(formData:FormData){const db=await createClient();const id=String(formData.get("payment_id")||"");const {error}=await db.rpc("reverse_payment",{p_payment_id:id,p_notes:String(formData.get("notes")||"Estorno manual")});if(error)redirect(`/financeiro?erro=${encodeURIComponent(error.message)}`);revalidatePath("/financeiro");redirect("/financeiro?recebido=1");}

export async function updateGutterQuote(formData: FormData) {
  const db=await createClient();const quoteId=String(formData.get("quote_id")||"");let payload:unknown;
  try{payload=JSON.parse(String(formData.get("payload")||"{}"));}catch{redirect(`/orcamentos/${quoteId}/editar?erro=Dados inválidos`);}
  const validUntil=String(formData.get("valid_until")||"");const installationDeadline=String(formData.get("installation_deadline")||"");
  if(typeof payload!=="object"||!payload)redirect(`/orcamentos/${quoteId}/editar?erro=Dados inválidos`);
  const p = payload as Record<string,unknown>;
  const specialItems = z.array(specialItemSchema).safeParse(p.special_items);
  const {data,error}=await db.rpc("update_gutter_quote",{p_quote_id:quoteId,p_payload:{...p,special_items:undefined,valid_until:validUntil,installation_deadline:installationDeadline}});
  if(error)redirect(`/orcamentos/${quoteId}/editar?erro=${encodeURIComponent(error.message)}`);
  if(data && specialItems.success) {
    await db.from("quote_items").delete().eq("quote_id", quoteId).eq("item_type","especial");
    if(specialItems.data.length) {
      const { data: { user } } = await db.auth.getUser();
      const { data: prof } = await db.from("profiles").select("company_id").eq("id", user!.id).single();
      await db.from("quote_items").insert(specialItems.data.map(s => ({ quote_id: quoteId, company_id: prof!.company_id, product: s.product, description: s.description || null, unit: s.unit, quantity: s.quantity, unit_price: s.unit_price, item_type: "especial" })));
    }
  }
  revalidatePath("/orcamentos");redirect(`/orcamentos/${data}`);
}

export async function duplicateQuote(formData:FormData){const db=await createClient();const id=String(formData.get("quote_id")||"");const {data,error}=await db.rpc("duplicate_quote",{p_quote_id:id});if(error)redirect(`/orcamentos/${id}?erro=${encodeURIComponent(error.message)}`);revalidatePath("/orcamentos");redirect(`/orcamentos/${data}/editar`);}
export async function deleteQuote(formData:FormData){const db=await createClient();const id=String(formData.get("quote_id")||"");const {error}=await db.rpc("delete_draft_quote",{p_quote_id:id});if(error)redirect(`/orcamentos/${id}?erro=${encodeURIComponent(error.message)}`);revalidatePath("/orcamentos");redirect("/orcamentos");}

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
  const db=await createClient();const id=String(formData.get("installation_id"));const status=String(formData.get("status"));if(!["agendada","em_andamento","concluida","cancelada"].includes(status))redirect(`/instalacoes/${id}?erro=Status inválido`);
  const {error}=await db.from("installations").update({status}).eq("id",id);if(error)redirect(`/instalacoes/${id}?erro=${encodeURIComponent(error.message)}`);revalidatePath(`/instalacoes/${id}`);redirect(`/instalacoes/${id}`);
}

export async function saveGutterPrice(formData:FormData) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
  const back=String(formData.get("_back")||"/configuracoes/tabela-calhas?aba=materia-prima");
  const {data:profile}=await db.from("profiles").select("company_id").eq("id",user.id).single();if(!profile?.company_id)redirect(`${back}&erro=Empresa+não+encontrada`);
  const id=String(formData.get("id")||"");const product=String(formData.get("product")||"").trim();const thickness=String(formData.get("thickness")||"");const cutMm=Number(formData.get("cut_mm"));const unitPrice=Number(String(formData.get("unit_price")||"0").replace(",","."));
  if(!product||!thickness||!cutMm||!Number.isFinite(unitPrice)||unitPrice<0)redirect(`${back}&erro=Revise+produto,+espessura,+corte+e+preço`);
  const color=String(formData.get("color")||"").trim()||null;
  const values={company_id:profile.company_id,product,thickness,cut_mm:cutMm,color,unit_price:unitPrice,notes:String(formData.get("notes")||"").trim(),active:formData.get("active")==="on",updated_at:new Date().toISOString()};
  const result=id?await db.from("gutter_prices").update(values).eq("id",id):await db.from("gutter_prices").insert(values);if(result.error)redirect(`${back}&erro=${encodeURIComponent(pgErr(result.error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas");revalidatePath("/tabela-calhas");revalidatePath("/orcamentos/calhas");redirect(`${back}&salvo=1`);
}

export async function deleteGutterPrice(formData:FormData) {
  const db=await createClient();const back=String(formData.get("_back")||"/configuracoes/tabela-calhas?aba=materia-prima");
  const {error}=await db.from("gutter_prices").delete().eq("id",String(formData.get("id")));if(error)redirect(`${back}&erro=${encodeURIComponent(pgErr(error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas");revalidatePath("/tabela-calhas");redirect(back);
}

export async function createManualSale(formData:FormData) {
  const db=await createClient();let payload:unknown;try{payload=JSON.parse(String(formData.get("payload")))}catch{redirect("/vendas/nova?erro=Dados da venda inválidos");}
  const {data,error}=await db.rpc("create_manual_sale",{p_payload:payload});if(error)redirect(`/vendas/nova?erro=${encodeURIComponent(error.message)}`);revalidatePath("/vendas");revalidatePath("/financeiro");redirect(`/vendas/${data}`);
}

export async function createManualPurchase(formData:FormData) {
  const db=await createClient();let payload:unknown;try{payload=JSON.parse(String(formData.get("payload")))}catch{redirect("/compras/nova?erro=Dados da compra inválidos");}
  const {data,error}=await db.rpc("create_manual_purchase",{p_payload:payload});if(error)redirect(`/compras/nova?erro=${encodeURIComponent(error.message)}`);revalidatePath("/compras");revalidatePath("/financeiro");redirect(`/compras/${data}`);
}

export async function createWindowQuote(formData:FormData){
  const db=await createClient();let payload:unknown;try{payload=JSON.parse(String(formData.get("payload")||"{}"));}catch{redirect("/orcamentos/esquadrias?erro=Dados inválidos");}
  const parsed=z.object({client_id:z.string().uuid(),discount:z.number().nonnegative(),freight:z.number().nonnegative(),notes:z.string(),valid_until:z.string(),installation_deadline:z.string(),items:z.array(z.object({product:text,line:z.string(),measurements:text,glass:z.string(),accessories:z.string(),color:z.string(),quantity:z.number().positive(),unit_price:z.number().nonnegative()})).min(1)}).safeParse(payload);
  if(!parsed.success)redirect("/orcamentos/esquadrias?erro=Revise os itens do orçamento");
  const {data,error}=await db.rpc("create_window_quote",{p_payload:parsed.data});if(error)redirect(`/orcamentos/esquadrias?erro=${encodeURIComponent(error.message)}`);revalidatePath("/orcamentos");redirect(`/orcamentos/${data}`);
}

export async function saveLeadSource(formData:FormData) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");const {data:profile}=await db.from("profiles").select("company_id").eq("id",user.id).single();if(!profile?.company_id)redirect("/configuracoes/origens-lead?erro=Empresa não encontrada");
  const id=String(formData.get("id")||"");const name=String(formData.get("name")||"").trim();const channel=String(formData.get("channel")||"outros");const sortOrder=Number(formData.get("sort_order")||0);if(!name)redirect("/configuracoes/origens-lead?erro=Informe o nome da origem");
  const values={company_id:profile.company_id,name,channel,sort_order:sortOrder,active:formData.get("active")==="on",updated_at:new Date().toISOString()};const result=id?await db.from("lead_sources").update(values).eq("id",id):await db.from("lead_sources").insert(values);if(result.error)redirect(`/configuracoes/origens-lead?erro=${encodeURIComponent(result.error.message)}`);revalidatePath("/configuracoes/origens-lead");revalidatePath("/clientes/novo");revalidatePath("/pipeline");redirect("/configuracoes/origens-lead?salvo=1");
}


export async function saveSupplier(formData:FormData) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
  const back=String(formData.get("_back")||"/configuracoes/fornecedores");
  const {data:profile}=await db.from("profiles").select("company_id").eq("id",user.id).single();if(!profile?.company_id)redirect(`${back}?erro=Empresa+não+encontrada`);
  const id=String(formData.get("id")||"");const name=String(formData.get("name")||"").trim();if(!name)redirect(`${back}?erro=Informe+o+nome+do+fornecedor`);
  const values={company_id:profile.company_id,name,tax_id:String(formData.get("tax_id")||"").trim()||null,phone:String(formData.get("phone")||"").trim()||null,whatsapp:String(formData.get("whatsapp")||"").trim()||null,email:String(formData.get("email")||"").trim()||null,city:String(formData.get("city")||"").trim()||null,state:String(formData.get("state")||"").trim()||null,payment_terms:String(formData.get("payment_terms")||"").trim()||null,notes:String(formData.get("notes")||"").trim()||null,status:formData.get("status_ativo")==="on"?"ativo":"inativo",updated_at:new Date().toISOString()};
  const result=id?await db.from("suppliers").update(values).eq("id",id):await db.from("suppliers").insert(values);if(result.error)redirect(`${back}?erro=${encodeURIComponent(pgErr(result.error.message))}`);
  revalidatePath("/configuracoes/fornecedores");revalidatePath("/fornecedores");redirect(`${back}?salvo=1`);
}

export async function deleteSupplier(formData:FormData) {
  const db=await createClient();const id=String(formData.get("id")||"");const back=String(formData.get("_back")||"/configuracoes/fornecedores");if(!id)redirect(back);
  const {error}=await db.from("suppliers").update({deleted_at:new Date().toISOString()}).eq("id",id);if(error)redirect(`${back}?erro=${encodeURIComponent(pgErr(error.message))}`);
  revalidatePath("/configuracoes/fornecedores");revalidatePath("/fornecedores");redirect(back);
}

function pgErr(msg:string):string {
  if(msg.includes("duplicate key")||msg.includes("unique_violation"))return "Já existe um registro com esses dados";
  if(msg.includes("violates foreign key"))return "Este registro está vinculado a outros dados e não pode ser removido";
  if(msg.includes("violates not-null"))return "Campo obrigatório não foi preenchido";
  if(msg.includes("permission denied"))return "Sem permissão para realizar esta operação";
  if(msg.includes("JWT"))return "Sessão expirada. Faça login novamente";
  return msg;
}

export async function inviteUser(formData: FormData) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: myProfile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!myProfile?.company_id) redirect("/configuracoes/funcionarios?erro=Empresa não encontrada");
  const { data: myRoles } = await db.from("user_roles").select("role").eq("profile_id", user.id).in("role", ["administrador", "gerente"]);
  if (!myRoles?.length) redirect("/configuracoes/funcionarios?erro=Sem permissão para criar usuários");

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") || "").trim();
  const allowedRoles = ["administrador","gerente","vendedor","compras","producao","estoque","instalador","financeiro","atendente"];
  const roles = formData.getAll("roles").map(String).filter(role => allowedRoles.includes(role));
  if (!email || !fullName) redirect("/configuracoes/funcionarios?erro=Informe nome e e-mail");

  // Verifica se email já existe no sistema
  const { data: existing } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent("Este e-mail já está cadastrado no sistema")}`);

  // Usa Supabase Admin API com service_role para criar o usuário
  const { createClient: createAdmin } = await import("@supabase/supabase-js");
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const { data: newUser, error: createError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: siteUrl ? `${siteUrl}/login` : undefined,
  });

  if (createError) redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent(createError.message)}`);

  const profileId = newUser.user?.id;
  if (profileId) {
    const { error: metadataError } = await admin.auth.admin.updateUserById(profileId, {
      app_metadata: { company_id: myProfile.company_id }, user_metadata: { full_name: fullName },
    });
    if (metadataError) redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent(metadataError.message)}`);
    const { error: profileError } = await admin.from("profiles").upsert(
      { id: profileId, company_id: myProfile.company_id, full_name: fullName, email, status: "ativo" }, { onConflict: "id" },
    );
    if (profileError) redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent(profileError.message)}`);
    const inserts = (roles.length ? roles : ["atendente"]).map(role => ({ company_id: myProfile.company_id, profile_id: profileId, role }));
    const { error: roleError } = await admin.from("user_roles").insert(inserts);
    if (roleError) redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent(roleError.message)}`);
  }

  revalidatePath("/configuracoes/funcionarios");
  redirect(`/configuracoes/funcionarios?salvo=1&novo=${encodeURIComponent(email)}`);
}

export async function saveEmployee(formData:FormData) {
  const db=await createClient();const {data:allowed}=await db.rpc("has_role",{roles:["administrador","gerente"]});if(!allowed)redirect("/configuracoes/funcionarios?erro=Sem permissão");const id=String(formData.get("id")||"");if(!id)redirect("/configuracoes/funcionarios?erro=ID inválido");
  const full_name=String(formData.get("full_name")||"").trim();if(!full_name)redirect("/configuracoes/funcionarios?erro=Informe o nome");
  const values={full_name,phone:String(formData.get("phone")||"").trim()||null,status:formData.get("status_ativo")==="on"?"ativo":"inativo",updated_at:new Date().toISOString()};
  const {error}=await db.from("profiles").update(values).eq("id",id);if(error)redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/configuracoes/funcionarios");redirect("/configuracoes/funcionarios?salvo=1");
}

export async function saveUserRoles(formData:FormData) {
  const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
  const {data:myProfile}=await db.from("profiles").select("company_id").eq("id",user.id).single();if(!myProfile?.company_id)redirect("/configuracoes/funcionarios?erro=Empresa não encontrada");
  const profileId=String(formData.get("profile_id")||"");if(!profileId)redirect("/configuracoes/funcionarios?erro=Funcionário inválido");
  const allowedRoles=["administrador","gerente","vendedor","compras","producao","estoque","instalador","financeiro","atendente"];
  const roles=formData.getAll("roles").map(String).filter(role=>allowedRoles.includes(role));
  const {error}=await db.rpc("replace_user_roles",{p_profile_id:profileId,p_roles:roles});if(error)redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/configuracoes/funcionarios");redirect("/configuracoes/funcionarios?salvo=1");
}

export async function savePermission(formData:FormData) {
  const db=await createClient();const {data:allowed}=await db.rpc("has_role",{roles:["administrador"]});if(!allowed)redirect("/configuracoes/cargos?erro=Sem permissão");const id=String(formData.get("id")||"");if(!id)redirect("/configuracoes/cargos?erro=ID inválido");
  const values={can_view:formData.get("can_view")==="on",can_create:formData.get("can_create")==="on",can_update:formData.get("can_update")==="on",can_delete:formData.get("can_delete")==="on"};
  const {error}=await db.from("permissions").update(values).eq("id",id);if(error)redirect(`/configuracoes/cargos?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/configuracoes/cargos");redirect("/configuracoes/cargos?salvo=1");
}

export async function updateQuoteSeller(formData: FormData) {
  const db = await createClient();
  const quoteId = String(formData.get("quote_id") || "");
  const sellerName = String(formData.get("seller_name") || "").trim();
  if (!quoteId) redirect("/orcamentos?erro=Orçamento inválido");
  const { error } = await db.from("quotes").update({ seller_name: sellerName || null }).eq("id", quoteId);
  if (error) redirect(`/orcamentos/${quoteId}?erro=${encodeURIComponent(error.message)}`);
  revalidatePath(`/orcamentos/${quoteId}`);
}

export async function updateQuotePaymentMethods(formData: FormData) {
  const db = await createClient();
  const quoteId = String(formData.get("quote_id") || "");
  if (!quoteId) redirect("/orcamentos?erro=Orçamento inválido");
  let methods: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("payment_methods") || "[]"));
    if (Array.isArray(parsed)) methods = parsed.filter((m) => typeof m === "string");
  } catch {
    redirect(`/orcamentos/${quoteId}?erro=Formas de pagamento inválidas`);
  }
  const { error } = await db.from("quotes").update({ payment_methods: methods }).eq("id", quoteId);
  if (error) redirect(`/orcamentos/${quoteId}?erro=${encodeURIComponent(error.message)}`);
  revalidatePath(`/orcamentos/${quoteId}`);
}

// ── Workflow Engine ──────────────────────────────────────────────────────────

export async function saveWorkflow(formData: FormData) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) redirect("/automacoes?erro=Empresa não encontrada");

  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const status = String(formData.get("status") || "rascunho");
  if (!name) redirect("/automacoes/novo?erro=Informe o nome do fluxo");

  let steps: unknown[] = [], conditions: unknown[] = [];
  try { steps = JSON.parse(String(formData.get("steps") || "[]")); } catch { steps = []; }
  try { conditions = JSON.parse(String(formData.get("conditions") || "[]")); } catch { conditions = []; }

  const values = {
    company_id: profile.company_id,
    name,
    description: String(formData.get("description") || "").trim() || null,
    status,
    trigger_type: String(formData.get("trigger_type") || "manual"),
    trigger_config: (() => { try { return JSON.parse(String(formData.get("trigger_config") || "{}")); } catch { return {}; } })(),
    conditions,
    steps,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await db.from("workflows").update(values).eq("id", id).eq("company_id", profile.company_id);
    if (error) redirect(`/automacoes/${id}/editar?erro=${encodeURIComponent(error.message)}`);
    revalidatePath("/automacoes");
    redirect(`/automacoes?salvo=1`);
  } else {
    const { data, error } = await db.from("workflows").insert({ ...values, created_by: user.id }).select("id").single();
    if (error) redirect(`/automacoes/novo?erro=${encodeURIComponent(error.message)}`);
    revalidatePath("/automacoes");
    redirect(`/automacoes?salvo=1`);
  }
}

export async function toggleWorkflow(formData: FormData) {
  const db = await createClient();
  const id = String(formData.get("id") || "");
  const currentStatus = String(formData.get("current_status") || "inativo");
  const newStatus = currentStatus === "ativo" ? "inativo" : "ativo";
  const { error } = await db.from("workflows").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) redirect(`/automacoes?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/automacoes");
}

export async function deleteWorkflow(formData: FormData) {
  const db = await createClient();
  const id = String(formData.get("id") || "");
  if (!id) redirect("/automacoes");
  const { error } = await db.from("workflows").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) redirect(`/automacoes?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/automacoes");
  redirect("/automacoes");
}

export async function saveMessageTemplate(formData: FormData) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) redirect("/automacoes/mensagens?erro=Empresa não encontrada");

  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const body = String(formData.get("body") || "").trim();
  if (!name || !body) redirect("/automacoes/mensagens?erro=Nome e corpo são obrigatórios");

  const values = {
    company_id: profile.company_id,
    name,
    body,
    category: String(formData.get("category") || "geral"),
    channel: String(formData.get("channel") || "whatsapp"),
    subject: String(formData.get("subject") || "").trim() || null,
    event: "workflow",
    active: formData.get("active") !== "off",
    updated_at: new Date().toISOString(),
  };

  const result = id
    ? await db.from("message_templates").update(values).eq("id", id)
    : await db.from("message_templates").insert(values);

  if (result.error) redirect(`/automacoes/mensagens?erro=${encodeURIComponent(result.error.message)}`);
  revalidatePath("/automacoes");
  redirect("/automacoes?aba=mensagens&salvo=1");
}

export async function deleteMessageTemplate(formData: FormData) {
  const db = await createClient();
  const id = String(formData.get("id") || "");
  if (!id) redirect("/automacoes");
  const { error } = await db.from("message_templates").delete().eq("id", id);
  if (error) redirect(`/automacoes?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/automacoes");
  redirect("/automacoes?aba=mensagens");
}

export async function saveAiAgentConfig(formData: FormData) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  if (!profile?.company_id) redirect("/agente-ia?erro=Empresa não encontrada");

  const values = {
    company_id: profile.company_id,
    active: formData.get("active") === "on",
    agent_name: String(formData.get("agent_name") || "Ana").trim(),
    openai_model: String(formData.get("openai_model") || "llama-3.3-70b-versatile"),
    temperature: Number(formData.get("temperature") ?? 0.3),
    auto_create_lead: formData.get("auto_create_lead") === "on",
    notify_on_premium: formData.get("notify_on_premium") === "on",
    ai_provider: String(formData.get("ai_provider") || "groq"),
    wpp_provider: String(formData.get("wpp_provider") || "evolution"),
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>;

  const groqKey = String(formData.get("groq_api_key") || "").trim();
  if (groqKey && !groqKey.startsWith("***") && !groqKey.startsWith("enc:")) values.groq_api_key = encryptSecret(groqKey);

  const apiKey = String(formData.get("openai_api_key") || "").trim();
  if (apiKey && !apiKey.startsWith("***") && !apiKey.startsWith("enc:")) values.openai_api_key = encryptSecret(apiKey);

  const numberId = String(formData.get("whatsapp_number_id") || "").trim();
  if (numberId) values.whatsapp_number_id = numberId;

  const token = String(formData.get("whatsapp_token") || "").trim();
  if (token && !token.startsWith("***") && !token.startsWith("enc:")) values.whatsapp_token = encryptSecret(token);

  const evoUrl = String(formData.get("evolution_api_url") || "").trim();
  if (evoUrl) values.evolution_api_url = evoUrl;

  const evoKey = String(formData.get("evolution_api_key") || "").trim();
  if (evoKey && !evoKey.startsWith("***") && !evoKey.startsWith("enc:")) values.evolution_api_key = encryptSecret(evoKey);

  const evoInstance = String(formData.get("evolution_instance") || "").trim();
  if (evoInstance) values.evolution_instance = evoInstance;

  const { error } = await db.from("ai_agent_config").upsert(values, { onConflict: "company_id" });
  if (error) redirect(`/agente-ia?aba=configuracoes&erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/agente-ia");
  redirect("/agente-ia?aba=configuracoes&salvo=1");
}

// ── Central de Preços ─────────────────────────────────────────────────────────

export async function savePaint(formData: FormData) {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) redirect("/login");
  const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=pintura");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single(); if (!profile?.company_id) redirect(back);
  const id = String(formData.get("id") || ""); const color = String(formData.get("color") || "").trim(); if (!color) redirect(`${back}?erro=Informe+a+cor`);
  const values = { company_id: profile.company_id, color, price_per_meter: Number(String(formData.get("price_per_meter") || "0").replace(",", ".")), notes: String(formData.get("notes") || "").trim() || null, active: formData.get("active") === "on", updated_at: new Date().toISOString() };
  const result = id ? await db.from("pricing_paints").update(values).eq("id", id) : await db.from("pricing_paints").insert(values);
  if (result.error) redirect(`${back}?erro=${encodeURIComponent(pgErr(result.error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(`${back}&salvo=1`);
}

export async function deletePaint(formData: FormData) {
  const db = await createClient(); const id = String(formData.get("id") || ""); const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=pintura");
  if (!id) redirect(back);
  const { error } = await db.from("pricing_paints").delete().eq("id", id);
  if (error) redirect(`${back}?erro=${encodeURIComponent(pgErr(error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(back);
}

export async function saveSpecialPart(formData: FormData) {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) redirect("/login");
  const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=pecas-especiais");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single(); if (!profile?.company_id) redirect(back);
  const id = String(formData.get("id") || ""); const item_name = String(formData.get("item_name") || "").trim(); if (!item_name) redirect(`${back}?erro=Informe+o+nome+da+peça`);
  const values = { company_id: profile.company_id, item_name, unit: String(formData.get("unit") || "Unidade"), unit_price: Number(String(formData.get("unit_price") || "0").replace(",", ".")), notes: String(formData.get("notes") || "").trim() || null, active: formData.get("active") === "on", updated_at: new Date().toISOString() };
  const result = id ? await db.from("pricing_special_parts").update(values).eq("id", id) : await db.from("pricing_special_parts").insert(values);
  if (result.error) redirect(`${back}?erro=${encodeURIComponent(pgErr(result.error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(`${back}&salvo=1`);
}

export async function deleteSpecialPart(formData: FormData) {
  const db = await createClient(); const id = String(formData.get("id") || ""); const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=pecas-especiais");
  if (!id) redirect(back);
  const { error } = await db.from("pricing_special_parts").delete().eq("id", id);
  if (error) redirect(`${back}?erro=${encodeURIComponent(pgErr(error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(back);
}

export async function savePricingService(formData: FormData) {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) redirect("/login");
  const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=servicos");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single(); if (!profile?.company_id) redirect(back);
  const id = String(formData.get("id") || ""); const service_name = String(formData.get("service_name") || "").trim(); if (!service_name) redirect(`${back}?erro=Informe+o+nome+do+serviço`);
  const values = { company_id: profile.company_id, service_name, unit: String(formData.get("unit") || "Serviço"), price: Number(String(formData.get("price") || "0").replace(",", ".")), notes: String(formData.get("notes") || "").trim() || null, active: formData.get("active") === "on", updated_at: new Date().toISOString() };
  const result = id ? await db.from("pricing_services").update(values).eq("id", id) : await db.from("pricing_services").insert(values);
  if (result.error) redirect(`${back}?erro=${encodeURIComponent(pgErr(result.error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(`${back}&salvo=1`);
}

export async function deletePricingService(formData: FormData) {
  const db = await createClient(); const id = String(formData.get("id") || ""); const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=servicos");
  if (!id) redirect(back);
  const { error } = await db.from("pricing_services").delete().eq("id", id);
  if (error) redirect(`${back}?erro=${encodeURIComponent(pgErr(error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(back);
}

export async function saveCommercialTable(formData: FormData) {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser(); if (!user) redirect("/login");
  const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=tabelas-comerciais");
  const { data: profile } = await db.from("profiles").select("company_id").eq("id", user.id).single(); if (!profile?.company_id) redirect(back);
  const id = String(formData.get("id") || ""); const name = String(formData.get("name") || "").trim(); if (!name) redirect(`${back}?erro=Informe+o+nome+da+tabela`);
  const adjustmentType = String(formData.get("adjustment_type") || "desconto");
  if (!["desconto","acrescimo","multiplicador"].includes(adjustmentType)) redirect(`${back}?erro=Tipo+de+ajuste+inválido`);
  const values = { company_id: profile.company_id, name, description: String(formData.get("description") || "").trim() || null, adjustment_type: adjustmentType, adjustment_value: Number(String(formData.get("adjustment_value") || "0").replace(",", ".")), active: formData.get("active") === "on", updated_at: new Date().toISOString() };
  const result = id ? await db.from("pricing_commercial_tables").update(values).eq("id", id) : await db.from("pricing_commercial_tables").insert(values);
  if (result.error) redirect(`${back}?erro=${encodeURIComponent(pgErr(result.error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(`${back}&salvo=1`);
}

export async function deleteCommercialTable(formData: FormData) {
  const db = await createClient(); const id = String(formData.get("id") || ""); const back = String(formData.get("_back") || "/configuracoes/tabela-calhas?aba=tabelas-comerciais");
  if (!id) redirect(back);
  const { error } = await db.from("pricing_commercial_tables").delete().eq("id", id);
  if (error) redirect(`${back}?erro=${encodeURIComponent(pgErr(error.message))}`);
  revalidatePath("/configuracoes/tabela-calhas"); revalidatePath("/tabela-calhas"); redirect(back);
}

export async function resetUserPassword(formData: FormData) {
  const profileId = String(formData.get("profile_id") || "");
  if (!profileId) redirect("/configuracoes/funcionarios?erro=ID inválido");
  const { createClient: createAdmin } = await import("@supabase/supabase-js");
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: actorRoles } = await db.from("user_roles").select("role").eq("profile_id", user.id).in("role", ["administrador", "gerente"]);
  if (!actorRoles?.length) redirect("/configuracoes/funcionarios?erro=Sem permissão");
  const { data: actorProfile } = await db.from("profiles").select("company_id").eq("id", user.id).single();
  const { data: targetProfile } = await admin.from("profiles").select("company_id").eq("id", profileId).single();
  if (!actorProfile?.company_id || targetProfile?.company_id !== actorProfile.company_id) redirect("/configuracoes/funcionarios?erro=Usuário inválido");
  const { data: target } = await admin.auth.admin.getUserById(profileId);
  if (!target?.user?.email) redirect("/configuracoes/funcionarios?erro=Usuário sem e-mail");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const { error } = await admin.auth.resetPasswordForEmail(target.user.email, { redirectTo: siteUrl ? `${siteUrl}/login` : undefined });
  if (error) redirect(`/configuracoes/funcionarios?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/configuracoes/funcionarios");
  redirect("/configuracoes/funcionarios?salvo=1");
}

export async function advanceProductionStep(formData: FormData) {
  const db = await createClient();
  const productionOrderId = String(formData.get("production_order_id") || "");
  const responsibleId = String(formData.get("responsible_id") || "") || null;
  const notes = String(formData.get("notes") || "") || null;
  if (!productionOrderId) redirect("/producao");
  const { error } = await db.rpc("advance_production_step", {
    p_production_order_id: productionOrderId, p_responsible_id: responsibleId, p_notes: notes,
  });
  if (error) redirect(`/producao/${productionOrderId}?erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/producao");
  redirect(`/producao/${productionOrderId}`);
}
