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
    .order("starts_at", { ascending: true })
    .limit(500);

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
