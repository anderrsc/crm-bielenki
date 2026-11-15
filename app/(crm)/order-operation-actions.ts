"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/friendly-error";
import { safeBack, q } from "@/lib/back-url";
import { validIsoDate } from "@/lib/valid-date";

const id = z.uuid();
function target(form: FormData) {
  const back = safeBack(form.get("_back"), "/producao");
  return /^\/(vendas|producao|agenda|pedidos|servicos)(\/|$|\?)/.test(back) ? back : "/producao";
}
function refresh() { for (const p of ["/producao", "/agenda", "/pendencias", "/vendas", "/pedidos"]) revalidatePath(p); }
async function run(form: FormData, fn: string, args: Record<string, unknown>, ok: string) {
  const back = target(form);
  const db = await createClient();
  const { error } = await db.rpc(fn, args);
  if (error) redirect(`${q(back)}erro=${encodeURIComponent(friendlyError(error.message) ?? "Não foi possível concluir.")}`);
  refresh();
  redirect(`${q(back)}ok=${encodeURIComponent(ok)}`);
}
function orderId(form: FormData) {
  const value = String(form.get("order_id") || "");
  if (!id.safeParse(value).success) redirect(`${q(target(form))}erro=Pedido+inválido`);
  return value;
}
const optionalId = (v: FormDataEntryValue | null) => (id.safeParse(String(v || "")).success ? String(v) : null);
const text = (v: FormDataEntryValue | null) => String(v || "").trim().slice(0, 500) || null;

/** Resposta a "precisa de conferência de medidas?". redo=1 pede uma nova conferência. */
export async function answerMeasureDecision(form: FormData) {
  const needs = form.get("needs") === "sim";
  await run(form, "order_measure_decision", { p_order_id: orderId(form), p_needs: needs, p_redo: form.get("redo") === "1" },
    needs ? "Conferência de medidas criada. Agende a visita." : "Medidas confirmadas. Falta confirmar o envio para corte.");
}

export async function scheduleMeasureCheck(form: FormData) {
  const order = orderId(form);
  const date = String(form.get("date") || ""), time = String(form.get("time") || "08:00");
  if (!validIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) redirect(`${q(target(form))}erro=${encodeURIComponent("Informe a data e o horário da conferência.")}`);
  await run(form, "order_schedule_measure_check", { p_order_id: order, p_at: `${date}T${time}:00-03:00`, p_responsible: optionalId(form.get("responsible_id")), p_notes: text(form.get("notes")) },
    "Conferência agendada.");
}

export async function finishMeasureCheck(form: FormData) {
  const result = String(form.get("result") || "");
  if (!["conferidas", "alteradas", "revisar_orcamento", "nova_visita"].includes(result)) redirect(`${q(target(form))}erro=Escolha+o+resultado+da+conferência`);
  await run(form, "order_finish_measure_check", { p_order_id: orderId(form), p_result: result, p_notes: text(form.get("notes")) },
    result === "conferidas" ? "Medidas conferidas. Falta confirmar o envio para corte." : result === "alteradas" ? "Medidas alteradas: aguardando validação da gerência."
      : result === "revisar_orcamento" ? "Pedido marcado para revisão do orçamento." : "Nova visita criada. Agende a data.");
}

export async function validateMeasures(form: FormData) {
  await run(form, "order_validate_measures", { p_order_id: orderId(form), p_notes: text(form.get("notes")) }, "Medidas validadas. Falta confirmar o envio para corte.");
}

export async function releaseCut(form: FormData) {
  const date = String(form.get("date") || "");
  if (date && !validIsoDate(date)) redirect(`${q(target(form))}erro=Data+inválida`);
  await run(form, "order_release_cut", { p_order_id: orderId(form), p_responsible: optionalId(form.get("responsible_id")), p_notes: text(form.get("notes")), p_date: date || null },
    "Pedido liberado para corte.");
}
