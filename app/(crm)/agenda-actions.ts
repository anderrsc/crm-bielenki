"use server";

import { selectOwnProfile } from "@/lib/own-profile";
import { createClient } from "@/lib/supabase/server";
import type { AgendaEvent } from "@/components/agenda-page";

import { agendaTypes, agendaStatus, agendaTimestamp, type AgendaSource } from "@/lib/agenda";
import { canMoveEvent, movedStart } from "@/lib/service-board";
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
  const crews = await agendaCrews(db);

  return data.map((e: Record<string, unknown>) => ({
    ...crews.get(`${e.source}:${e.id}`),
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

/** Equipe, veículo e pessoas escaladas (módulo Equipes) para cada compromisso. */
async function agendaCrews(db: Awaited<ReturnType<typeof createClient>>) {
  type Row = {
    event_id: string | null; measurement_id: string | null; installation_id: string | null;
    day: { team_name: string; vehicle_name: string; members: { profile_name: string; released_at: string | null }[] } | null;
  };
  const crews = new Map<string, Pick<AgendaEvent, "team_name" | "vehicle_name" | "crew">>();
  const { data, error } = await db
    .from("work_day_jobs")
    .select("event_id,measurement_id,installation_id,day:work_days(team_name,vehicle_name,members:work_day_members(profile_name,released_at))")
    .eq("active", true)
    .gte("scheduled_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
    .order("scheduled_at", { ascending: false })
    .limit(1000);
  // Sem a escala (falha ou perfil sem acesso), a agenda continua com o responsável.
  if (error) { console.error("agenda: escala indisponível", error.message); return crews; }
  for (const job of (data ?? []) as unknown as Row[]) {
    if (!job.day) continue;
    const key = job.installation_id ? `installations:${job.installation_id}`
      : job.measurement_id ? `measurements:${job.measurement_id}` : `operational_events:${job.event_id}`;
    crews.set(key, {
      team_name: job.day.team_name,
      vehicle_name: job.day.vehicle_name,
      crew: (job.day.members ?? []).filter((m) => !m.released_at).map((m) => m.profile_name),
    });
  }
  return crews;
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

const MOVE_COLUMNS = {
  operational_events: { date: "starts_at", person: "responsible_id" },
  measurements: { date: "scheduled_at", person: "responsible_id" },
  installations: { date: "scheduled_at", person: "responsible_id" },
  tasks: { date: "due_at", person: "assigned_to" },
} as const;

const moveSchema = z.object({
  id: z.uuid(),
  source: z.enum(["operational_events", "measurements", "installations", "tasks"]),
  day: z.iso.date().optional(),
  person: z.string().trim().min(1).max(200).nullable().optional(),
}).refine((m) => m.day !== undefined || m.person !== undefined);

const NO_MOVE_PERMISSION = "Sem permissão para alterar este serviço, ou ele não existe mais.";

/**
 * Reagenda (mantendo o horário) e/ou troca o responsável de um compromisso.
 * Usa o RLS de quem está logado e devolve o erro como texto: mensagens lançadas
 * por Server Actions são escondidas em produção.
 */
export async function moveAgendaEvent(input: {
  id: string; source: AgendaSource; day?: string; person?: string | null;
}): Promise<{ error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { error: "Supabase não configurado" };
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: "Mudança inválida." };
  const { id, source, day, person } = parsed.data;
  const db = await createClient();
  const { data: profile } = await selectOwnProfile(db, "company_id");
  if (!profile?.company_id) return { error: "Sessão expirada. Entre novamente." };
  const companyId = String(profile.company_id);
  const columns = MOVE_COLUMNS[source];
  const isEvent = source === "operational_events";

  const fields: string = `id,status,${columns.date},${columns.person}${isEvent ? ",ends_at,notes" : ""}`;
  const { data: found, error: readError } = await db.from(source).select(fields).eq("id", id).eq("company_id", companyId).single();
  if (readError || !found) return { error: NO_MOVE_PERMISSION };
  const row = found as unknown as Record<string, string | null>;
  if (!canMoveEvent({ status: String(row.status) })) return { error: "Serviço concluído ou cancelado não pode ser movido. Atualize a agenda." };
  const current = row[columns.date];
  if (!current) return { error: "Serviço sem data. Abra o cadastro para agendar." };

  let personId: string | null = row[columns.person];
  if (person !== undefined) {
    personId = null;
    if (person !== null) {
      const { data: matches, error } = await db.from("profiles").select("id")
        .eq("company_id", companyId).eq("status", "ativo").eq("full_name", person).limit(2);
      if (error) return { error: "Não foi possível conferir o funcionário. Tente de novo." };
      if ((matches?.length ?? 0) > 1) return { error: `Há mais de um funcionário chamado "${person}".` };
      personId = matches?.[0]?.id ?? null;
      // Compromissos avulsos aceitam nome livre (ex.: dupla); os demais exigem cadastro.
      if (!personId && !isEvent) return { error: `"${person}" não é um funcionário ativo cadastrado; este serviço exige um.` };
    }
  }

  const startsAt = day ? movedStart(current, day) : current;

  if (isEvent) {
    // Visitas criadas por Serviços ou pela conferência de medidas têm a data
    // guardada também lá: usa a mesma função dessas telas para não divergir.
    const [service, check] = await Promise.all([
      db.from("service_orders").select("id").eq("agenda_event_id", id).eq("company_id", companyId).maybeSingle(),
      db.from("order_measure_checks").select("order_id").eq("agenda_event_id", id).eq("company_id", companyId).eq("status", "agendada").maybeSingle(),
    ]);
    if (service.error || check.error) return { error: "Não foi possível conferir os vínculos deste serviço. Tente de novo." };
    if (service.data || check.data) {
      if (person && !personId) return { error: `"${person}" não é um funcionário ativo cadastrado; este serviço exige um.` };
      // O cadastro do serviço preserva o responsável quando recebe vazio.
      if (service.data && person === null) return { error: "Para deixar este serviço sem responsável, altere em Serviços." };
      const args = { p_at: startsAt, p_responsible: personId, p_notes: row.notes };
      const { error } = service.data
        ? await db.rpc("service_schedule", { p_id: service.data.id, ...args })
        : await db.rpc("order_schedule_measure_check", { p_order_id: check.data!.order_id, ...args });
      if (error) return { error: error.code === "42501" ? NO_MOVE_PERMISSION : error.message };
      return revalidateMove();
    }
  }

  const values: Record<string, unknown> = {};
  if (day) {
    values[columns.date] = startsAt;
    if (isEvent && row.ends_at) values.ends_at = new Date(Date.parse(row.ends_at) + Date.parse(startsAt) - Date.parse(current)).toISOString();
  }
  if (person !== undefined) {
    values[columns.person] = personId;
    if (isEvent) values.responsible_name = person;
  }
  const { data, error } = await db.from(source).update(values).eq("id", id).eq("company_id", companyId).select("id").single();
  if (error || !data) return { error: NO_MOVE_PERMISSION };
  return revalidateMove();
}

function revalidateMove() {
  revalidatePath("/agenda");
  revalidatePath("/pendencias");
  return {};
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
