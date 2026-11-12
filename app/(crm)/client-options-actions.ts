"use server";

import { getAuthUser, getRequestClient } from "@/lib/supabase/server";
import { searchFilter } from "@/lib/query";
import { z } from "zod";

export async function searchClientOptions(query: string, selectedId?: string): Promise<{ items: { id: string; name: string }[]; error?: string }> {
  const db = await getRequestClient();
  if (!await getAuthUser(db)) return { items: [], error: "Entre novamente para consultar os clientes." };
  if (selectedId) {
    if (!z.string().uuid().safeParse(selectedId).success) return { items: [] };
    const result = await db.from("clients").select("id,name").eq("id", selectedId).limit(1);
    return { items: result.data ?? [], error: result.error ? "Não foi possível consultar o cliente." : undefined };
  }
  let request = db.from("clients").select("id,name").eq("status", "ativo").order("name").order("id").limit(30);
  const term = String(query).trim().slice(0, 100);
  if (term) request = request.or(searchFilter(["name", "phone"], term));
  const result = await request;
  return { items: result.data ?? [], error: result.error ? "Não foi possível buscar os clientes. Tente novamente." : undefined };
}
