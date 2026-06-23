"use server";

import { createClient } from "@/lib/supabase/server";
import type { AgendaEvent } from "@/components/agenda-page";

const ALLOWED_TYPES = ["medicao","instalacao","producao","compra","reuniao","venda","pos_venda","tarefa","lembrete","orcamento","manutencao","outro"] as const;

export async function getAgendaEvents(): Promise<AgendaEvent[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  const db = await createClient();

  // Busca da view unificada
  const { data, error } = await db
    .from("v_operational_agenda")
    .select("id,event_type,title,client_name,starts_at,ends_at,status,responsible_name,notes")
    .order("starts_at", { ascending: true })
    .limit(500);

  if (error || !data) return [];

  return data.map((e: Record<string, unknown>) => ({
    id: String(e.id ?? ""),
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

  const { data: profile } = await db.from("profiles").select("company_id,id").single();
  if (!profile?.company_id) return { error: "Empresa não encontrada" };

  // Mapeia tipos não suportados pelo check constraint original para "outro"
  const ORIGINAL_TYPES = ["medicao","instalacao","orcamento","pos_venda","manutencao","compra","outro"];
  const TYPE_MAP: Record<string, string> = {
    producao: "outro", reuniao: "outro", venda: "orcamento",
    tarefa: "outro", lembrete: "outro",
  };
  const event_type = ORIGINAL_TYPES.includes(typeRaw) ? typeRaw : (TYPE_MAP[typeRaw] ?? "outro");

  const startsAt = `${date}T${time}:00`;

  // Tenta buscar client_id pelo nome (opcional)
  let clientId: string | null = null;
  if (clientName) {
    const { data: found } = await db
      .from("clients")
      .select("id")
      .eq("company_id", profile.company_id)
      .ilike("name", `%${clientName}%`)
      .limit(1)
      .single();
    clientId = found?.id ?? null;
  }

  const { error } = await db.from("operational_events").insert({
    company_id: profile.company_id,
    event_type,
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
}

export async function updateAgendaEventStatus(id: string, status: string): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const db = await createClient();
  // Tenta atualizar em operational_events, measurements e installations
  await db.from("operational_events").update({ status }).eq("id", id);
  await db.from("measurements").update({ status }).eq("id", id);
  await db.from("installations").update({ status }).eq("id", id);
}
