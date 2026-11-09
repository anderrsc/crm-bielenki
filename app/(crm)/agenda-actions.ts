"use server";

import { selectOwnProfile } from "@/lib/own-profile";
import { createClient } from "@/lib/supabase/server";
import type { AgendaEvent } from "@/components/agenda-page";

import { agendaTypes, agendaStatus, agendaTimestamp, type AgendaSource } from "@/lib/agenda";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function getAgendaEvents(): Promise<AgendaEvent[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  const db = await createClient();

  // Busca da view unificada
  const { data, error } = await db
    .from("v_operational_agenda")
    .select("id,event_type,title,client_name,starts_at,ends_at,status,responsible_name,notes,source")
    // Janela de 90 dias para tras ate 1 ano a frente: antes vinham os 500 MAIS ANTIGOS e o que era novo sumia.
    .gte("starts_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
    .lte("starts_at", new Date(Date.now() + 365 * 86_400_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(2000);

  if (error) throw new Error("Não foi possível carregar a agenda. Verifique a conexão e as migrações.");
  if (!data) return [];

  return data.map((e: Record<string, unknown>) => ({
    id: String(e.id ?? ""),
    source: e.source as AgendaSource,
    type: (e.event_type as AgendaEvent["type"]) ?? "tarefa",
    title: String(e.title ?? "Evento"),
    subtitle: e.notes ? String(e.notes) : null,
    client_name: e.client_name ? String(e.client_name) : null,
    starts_at: String(e.starts_at ?? ""),
    ends_at: e.ends_at ? String(e.ends_at) : null,
    status: String(e.status ?? "agendado"),
    responsible_name: e.responsible_name ? String(e.responsible_name) : null,
  }));
}

export async function createAgendaEvent(
  formData: FormData
): Promise<{ error?: string } | void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const db = await createClient();

  const title = String(formData.get("title") ?? "").trim();
  const typeRaw = String(formData.get("type") ?? "outro");
  const status = String(formData.get("status") ?? "agendado");
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "08:00");
  const clientName = String(formData.get("client_name") ?? "").trim();
  const responsibleName = String(formData.get("responsible_name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if(address.length>1000||phone.length>40||description.length>10000||title.length>300)return {error:"Os dados do compromisso são muito longos."};

  if (!title || !date) return { error: "Título e data são obrigatórios" };

  const { data: profile } = await selectOwnProfile(db, "company_id,id");
  if (!profile?.company_id) return { error: "Empresa não encontrada" };

  if (!agendaTypes.includes(typeRaw as typeof agendaTypes[number])) return { error: "Tipo de evento inválido" };
  if (!["agendado","confirmado","em_andamento","concluido","reagendado","cancelado"].includes(status)) return { error: "Status inválido" };
  const event_type = typeRaw;
  let startsAt: string;
  try { startsAt = agendaTimestamp(date, time); } catch { return { error: "Data ou horário inválidos" }; }

  // Tenta buscar client_id pelo nome (opcional)
  let clientId: string | null = null;
  if (clientName) {
    const { data: found } = await db
      .from("clients")
      .select("id")
      .eq("company_id", profile.company_id)
      .eq("name", clientName)
      .limit(1)
      .single();
    clientId = found?.id ?? null;
  }

  const { error } = await db.from("operational_events").insert({
    company_id: profile.company_id,
    event_type,
    address: address||null,
    phone: phone||null,
    client_name: clientName || null,
    responsible_name: responsibleName || null,
    title,
    notes: description || clientName
      ? [description, clientName ? `Cliente: ${clientName}` : "", responsibleName ? `Resp: ${responsibleName}` : ""].filter(Boolean).join(" | ")
      : null,
    starts_at: startsAt,
    status,
    client_id: clientId,
    created_by: profile.id,
  });

  if (error) return { error: error.message };
  revalidatePath("/agenda");
}

export async function updateAgendaEventStatus(id: string, status: string, source: AgendaSource): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Supabase não configurado");
  if (!z.string().uuid().safeParse(id).success || !["operational_events","measurements","installations","tasks"].includes(source)) throw new Error("Evento inválido");
  const db = await createClient();
  const values: Record<string, unknown> = { status: agendaStatus(source, status) };
  if (source === "measurements") values.completed_at = status === "concluido" ? new Date().toISOString() : null;
  if (source === "installations") values.completed_at = status === "concluido" ? new Date().toISOString() : null;
  const { data, error } = await db.from(source).update(values).eq("id", id).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Evento não encontrado ou sem permissão");
  revalidatePath("/agenda");
  revalidatePath("/pendencias");
}

/** Details are loaded only when a commitment opens, using the signed-in user's RLS. */
export async function getAgendaEventDetails(id:string,source:AgendaSource):Promise<import('@/lib/agenda-location').AgendaDetails>{
 if(!z.uuid().safeParse(id).success||!['operational_events','measurements','installations','tasks'].includes(source))throw new Error('Compromisso inválido.');
 const db=await createClient();const {data:profile}=await selectOwnProfile(db,'company_id');
 if(!profile?.company_id)throw new Error('Sessão expirada.');
 const companyId=profile.company_id;
 let clientId:string|null=null,address:string|null=null,phone:string|null=null,notes:string|null=null,relatedHref:string|null=null,relatedLabel:string|null=null;
 if(source==='tasks'){
  const {data:r,error}=await db.from('tasks').select('id,description,related_type,related_id').eq('id',id).eq('company_id',companyId).single();
  if(error||!r)throw new Error('Compromisso indisponível ou sem permissão.');notes=r.description;
  if(r.related_type==='clients')clientId=r.related_id;
 }else if(source==='measurements'){
  const {data:r,error}=await db.from('measurements').select('id,client_id,address,phone,notes,sketch_notes').eq('id',id).eq('company_id',companyId).single();
  if(error||!r)throw new Error('Compromisso indisponível ou sem permissão.');
  clientId=r.client_id;address=r.address;phone=r.phone;notes=[r.notes,r.sketch_notes].filter(Boolean).join('\n')||null;
  relatedHref=`/medicoes/${r.id}`;relatedLabel='Abrir medição';
 }else if(source==='installations'){
  const {data:r,error}=await db.from('installations').select('id,order_id,address,notes').eq('id',id).eq('company_id',companyId).single();
  if(error||!r)throw new Error('Compromisso indisponível ou sem permissão.');address=r.address;notes=r.notes;
  const {data:order}=await db.from('orders').select('id,client_id').eq('id',r.order_id).eq('company_id',companyId).maybeSingle();
  clientId=order?.client_id??null;relatedHref=`/instalacoes/${r.id}`;relatedLabel='Abrir instalação';
 }else{
  const {data:r,error}=await db.from('operational_events').select('id,client_id,address,phone,notes,order_id,quote_id').eq('id',id).eq('company_id',companyId).single();
  if(error||!r)throw new Error('Compromisso indisponível ou sem permissão.');
  clientId=r.client_id;address=r.address;phone=r.phone;notes=r.notes;
  if(r.order_id){relatedHref=`/pedidos/${r.order_id}`;relatedLabel='Abrir pedido'}else if(r.quote_id){relatedHref=`/orcamentos/${r.quote_id}`;relatedLabel='Abrir orçamento'}
 }
 let clientName:string|null=null;
 if(clientId){
  const {data:c}=await db.from('clients').select('id,name,address,neighborhood,city,state,postal_code,phone,whatsapp').eq('id',clientId).eq('company_id',companyId).maybeSingle();
  if(c){clientName=c.name;phone=phone||c.whatsapp||c.phone;if(!address||address.trim()===c.address?.trim())address=[c.address,c.neighborhood,c.city,c.state,c.postal_code].filter(Boolean).join(', ')||null}
  else clientId=null;
 }
 return {address,phone,clientId,clientName,notes,relatedHref,relatedLabel};
}
