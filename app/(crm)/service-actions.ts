"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { selectOwnProfile } from "@/lib/own-profile";
import { parseBRNumber } from "@/lib/br-number";
import { friendlyError } from "@/lib/friendly-error";
import { validIsoDate } from "@/lib/valid-date";
import { SERVICE_CLASSIFICATIONS, SERVICE_KINDS, SERVICE_MANUAL_STATUS, SERVICE_PRIORITY } from "@/lib/service-orders";

const id = z.uuid();
const text = (v: FormDataEntryValue | null, max = 500) => String(v || "").trim().slice(0, max) || null;
const optionalId = (v: FormDataEntryValue | null) => (id.safeParse(String(v || "")).success ? String(v) : null);
const money = (v: FormDataEntryValue | null) => { const raw = String(v || "").trim(); if (!raw) return null; const n = parseBRNumber(raw); return n === null || !Number.isFinite(n) || n < 0 ? NaN : n; };
function refresh(serviceId?: string) { for (const p of ["/servicos", "/agenda", "/financeiro", "/financeiro/receber"]) revalidatePath(p); if (serviceId) revalidatePath(`/servicos/${serviceId}`); }
const fail = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}erro=${encodeURIComponent(message)}`);

function fields(form: FormData, path: string) {
  const kind = String(form.get("kind") || ""), priority = String(form.get("priority") || "normal"), classification = String(form.get("classification") || "");
  const description = text(form.get("description"), 2000);
  const expected = money(form.get("expected_amount")), expenses = money(form.get("extra_expenses"));
  const expectedDate = String(form.get("expected_date") || "");
  const locationUrl = text(form.get("location_url"), 500);
  if (!SERVICE_KINDS[kind]) fail(path, "Escolha o tipo de serviço.");
  if (!description) fail(path, "Descreva o problema ou a atividade.");
  if (!SERVICE_PRIORITY[priority]) fail(path, "Prioridade inválida.");
  if (classification && !SERVICE_CLASSIFICATIONS[classification]) fail(path, "Classificação inválida.");
  if (Number.isNaN(expected) || Number.isNaN(expenses)) fail(path, "Valor inválido. Use por exemplo 150,00.");
  if (expectedDate && !validIsoDate(expectedDate)) fail(path, "Data prevista inválida.");
  if (locationUrl && !/^https?:\/\//i.test(locationUrl)) fail(path, "O link de localização precisa começar com http:// ou https://.");
  return {
    kind, priority, classification: classification || null, description, expected_date: expectedDate || null,
    responsible_id: optionalId(form.get("responsible_id")), team: text(form.get("team"), 120), phone: text(form.get("phone"), 40),
    address: text(form.get("address"), 200), neighborhood: text(form.get("neighborhood"), 120), city: text(form.get("city"), 120), location_url: locationUrl,
    internal_notes: text(form.get("internal_notes"), 2000), billing: form.get("billing") === "gratuito" ? "gratuito" : "cobrado",
    expected_amount: expected, materials_used: text(form.get("materials_used"), 2000), extra_expenses: expenses ?? 0,
  };
}

/** Cria um servico direto, sem orcamento. Com pedido informado, o cliente vem do pedido. */
export async function createService(form: FormData) {
  const path = "/servicos/novo";
  const values = fields(form, path);
  const db = await createClient();
  const { data: profile } = await selectOwnProfile<{ company_id: string }>(db, "company_id");
  if (!profile?.company_id) fail(path, "Empresa não encontrada.");
  const related = form.get("related") === "sim";
  const orderId = related ? optionalId(form.get("order_id")) : null;
  let clientId = optionalId(form.get("client_id"));
  let quoteId: string | null = null;
  if (related && !orderId && !clientId) fail(path, "Escolha o pedido ou o cliente da instalação anterior.");
  if (orderId) {
    const { data: order } = await db.from("orders").select("client_id,sale_id").eq("id", orderId).maybeSingle();
    if (!order) fail(path, "Pedido não encontrado.");
    clientId = order!.client_id;
    const { data: quote } = await db.from("quotes").select("id").eq("sale_id", order!.sale_id).maybeSingle();
    quoteId = quote?.id ?? null;
  }
  if (!clientId) fail(path, "Escolha o cliente.");
  const { data, error } = await db.from("service_orders").insert({ ...values, company_id: profile!.company_id, client_id: clientId, order_id: orderId, quote_id: quoteId, related_to_previous: related, service_number: "novo" }).select("id").single();
  if (error || !data) fail(path, friendlyError(error?.message) ?? "Não foi possível criar o serviço.");
  refresh();
  redirect(`/servicos/${data!.id}?ok=${encodeURIComponent("Serviço criado.")}`);
}

export async function updateService(form: FormData) {
  const serviceId = String(form.get("service_id") || "");
  if (!id.safeParse(serviceId).success) fail("/servicos", "Serviço inválido.");
  const path = `/servicos/${serviceId}`;
  const values = fields(form, path);
  const db = await createClient();
  const { data, error } = await db.from("service_orders").update(values).eq("id", serviceId).select("id");
  if (error || !data?.length) fail(path, friendlyError(error?.message) ?? "Não foi possível salvar. Verifique suas permissões.");
  refresh(serviceId);
  redirect(`${path}?ok=${encodeURIComponent("Dados do serviço salvos.")}`);
}

async function call(form: FormData, fn: string, args: (serviceId: string, path: string) => Record<string, unknown>, ok: string) {
  const serviceId = String(form.get("service_id") || "");
  if (!id.safeParse(serviceId).success) fail("/servicos", "Serviço inválido.");
  const path = form.get("_list") === "1" ? "/servicos" : `/servicos/${serviceId}`;
  const db = await createClient();
  const { error } = await db.rpc(fn, args(serviceId, path));
  if (error) fail(path, friendlyError(error.message) ?? "Não foi possível concluir.");
  refresh(serviceId);
  redirect(`${path}?ok=${encodeURIComponent(ok)}`);
}

export async function setServiceStatus(form: FormData) {
  const status = String(form.get("status") || "");
  await call(form, "service_set_status", (serviceId, path) => {
    if (!(SERVICE_MANUAL_STATUS as readonly string[]).includes(status)) fail(path, "Escolha a nova situação.");
    return { p_id: serviceId, p_status: status, p_notes: text(form.get("notes")) };
  }, "Situação atualizada.");
}

export async function scheduleService(form: FormData) {
  await call(form, "service_schedule", (serviceId, path) => {
    const date = String(form.get("date") || ""), time = String(form.get("time") || "08:00");
    if (!validIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) fail(path, "Informe a data e o horário da visita.");
    return { p_id: serviceId, p_at: `${date}T${time}:00-03:00`, p_responsible: optionalId(form.get("responsible_id")), p_team: text(form.get("team"), 120), p_notes: text(form.get("notes")) };
  }, "Visita agendada. Ela já aparece na Agenda.");
}

export async function completeService(form: FormData) {
  await call(form, "service_complete", (serviceId, path) => {
    const final = money(form.get("final_amount")), expenses = money(form.get("extra_expenses"));
    const due = String(form.get("due_date") || "");
    if (!text(form.get("done"), 2000)) fail(path, "Descreva o que foi executado.");
    if (Number.isNaN(final) || Number.isNaN(expenses)) fail(path, "Valor inválido. Use por exemplo 150,00.");
    if (due && !validIsoDate(due)) fail(path, "Data de vencimento inválida.");
    return { p_id: serviceId, p_done: text(form.get("done"), 2000), p_final: final, p_materials: text(form.get("materials_used"), 2000), p_expenses: expenses, p_due: due || null };
  }, "Serviço concluído.");
}

const PHOTO_TYPES = ["jpg", "jpeg", "png", "webp", "heic"];
export async function addServicePhotos(form: FormData) {
  const serviceId = String(form.get("service_id") || "");
  if (!id.safeParse(serviceId).success) fail("/servicos", "Serviço inválido.");
  const path = `/servicos/${serviceId}`;
  const moment = ["antes", "depois", "geral"].includes(String(form.get("moment"))) ? String(form.get("moment")) : "geral";
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) fail(path, "Escolha pelo menos uma foto.");
  if (files.length > 6) fail(path, "Envie até 6 fotos por vez.");
  const db = await createClient();
  const { data: service } = await db.from("service_orders").select("company_id").eq("id", serviceId).maybeSingle();
  if (!service) fail(path, "Serviço não encontrado.");
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!PHOTO_TYPES.includes(ext)) fail(path, "Envie fotos em JPG, PNG, WEBP ou HEIC.");
    if (file.size > 8 * 1024 * 1024) fail(path, "Cada foto deve ter até 8 MB.");
    const filePath = `${service!.company_id}/${serviceId}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await db.storage.from("service-photos").upload(filePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) fail(path, "Falha ao enviar a foto: " + uploadError.message);
    const { error } = await db.from("service_photos").insert({ company_id: service!.company_id, service_id: serviceId, moment, file_path: filePath, original_name: file.name.replace(/[\x00-\x1f\\/]/g, "_").slice(0, 180), size_bytes: file.size });
    if (error) { await db.storage.from("service-photos").remove([filePath]); fail(path, friendlyError(error.message) ?? "Falha ao registrar a foto."); }
  }
  refresh(serviceId);
  redirect(`${path}?ok=${encodeURIComponent(files.length === 1 ? "Foto enviada." : `${files.length} fotos enviadas.`)}#fotos`);
}

export async function removeServicePhoto(form: FormData) {
  const serviceId = String(form.get("service_id") || ""), photoId = String(form.get("photo_id") || "");
  if (!id.safeParse(serviceId).success || !id.safeParse(photoId).success) fail("/servicos", "Foto inválida.");
  const path = `/servicos/${serviceId}`;
  const db = await createClient();
  const { data: photo } = await db.from("service_photos").select("file_path").eq("id", photoId).eq("service_id", serviceId).maybeSingle();
  if (!photo) fail(path, "Foto não encontrada.");
  const { data, error } = await db.from("service_photos").delete().eq("id", photoId).select("id");
  if (error || !data?.length) fail(path, "Não foi possível remover a foto.");
  await db.storage.from("service-photos").remove([photo!.file_path]);
  refresh(serviceId);
  redirect(`${path}?ok=${encodeURIComponent("Foto removida.")}#fotos`);
}
