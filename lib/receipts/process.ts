// Fila de recibos: gera o PDF, guarda e envia ao cliente pelo WhatsApp. Somente servidor.
// Chamado logo após a baixa (after()) e, de reserva, pelo agendador a cada 5 minutos.
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { getBrowser } from "@/lib/generate-quote-pdf";
import { channelById, channelCredentials } from "@/lib/whatsapp/channels";
import { getOrCreateConversation } from "@/lib/whatsapp/inbox-store";
import { sendOutcomeUnknown, sendWhatsAppMedia } from "@/lib/whatsapp/send";
import { whatsappTarget } from "@/lib/whatsapp/phone";
import { loadReceiptData, type ReceiptBundle } from "./receipt-data";
import { brl, receiptFooterTemplate, receiptStatus, renderReceiptHtml, type ReceiptAssets } from "./receipt-html";

type ReceiptRow = { id: string; company_id: string; payment_id: string; receipt_number: number; created_at: string; message_id: string | null; attempts: number };

const FONT_FILES: Array<[number, string]> = [
  [400, "UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf"],
  [500, "UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf"],
  [600, "UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf"],
  [700, "UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf"],
];

let staticAssets: Promise<{ logo: string; fonts: string }> | null = null;
function loadStaticAssets() {
  staticAssets ??= (async () => {
    const root = process.cwd();
    const logo = await readFile(path.join(root, "public/brand/marquinhos-logo.svg"));
    const faces = await Promise.all(FONT_FILES.map(async ([weight, file]) => {
      const bytes = await readFile(path.join(root, "public/fonts", file)).catch(() => null);
      return bytes ? `@font-face{font-family:'Inter';font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${bytes.toString("base64")}) format('truetype');}` : "";
    }));
    return { logo: `data:image/svg+xml;base64,${logo.toString("base64")}`, fonts: faces.join("\n") };
  })().catch((e) => { staticAssets = null; throw e; });
  return staticAssets;
}

async function receiptAssets(bundle: ReceiptBundle): Promise<ReceiptAssets> {
  const s = await loadStaticAssets();
  const qr = bundle.companyQrUrl ? await QRCode.toDataURL(bundle.companyQrUrl, { errorCorrectionLevel: "M", width: 240, margin: 1 }).catch(() => null) : null;
  return { logoDataUri: s.logo, qrDataUri: qr, fontFaces: s.fonts };
}

export async function renderReceiptPdf(bundle: ReceiptBundle): Promise<Buffer> {
  const html = renderReceiptHtml(bundle.data, await receiptAssets(bundle));
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.emulateMediaType("print");
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: "A4", printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: "<span></span>",
      footerTemplate: receiptFooterTemplate(bundle.data.company.name, bundle.data.receiptNumber),
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export function receiptFileName(bundle: ReceiptBundle) {
  const name = bundle.clientName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "Cliente";
  return `Recibo-${bundle.data.receiptNumber}-${name}.pdf`;
}

export function receiptCaption(bundle: ReceiptBundle) {
  const d = bundle.data;
  const first = d.client.name.trim().split(/\s+/)[0];
  const hello = first && !/^(cliente|contato)$/i.test(first) ? `Olá, ${first}!` : "Olá!";
  const ref = d.orderNumber ? ` referente ao pedido nº ${d.orderNumber}` : d.saleNumber ? ` referente à venda nº ${d.saleNumber}` : "";
  const [y, m, day] = d.paidAt.split("-");
  const status = receiptStatus(d.balance);
  const tail = status.cls === "quitado"
    ? "Pedido quitado. Muito obrigado pela confiança! 🙏"
    : `Saldo restante: *R$ ${brl(d.balance)}*.`;
  return `${hello} Aqui é da ${d.company.name}. ✅\n\nConfirmamos o recebimento de *R$ ${brl(d.amount)}* via ${d.method} em ${day}/${m}/${y}${ref}.\n\nSegue o seu recibo nº ${d.receiptNumber}. ${tail}`;
}

async function fail(db: SupabaseClient, id: string, error: string, status: "falhou" | "enviado" = "falhou") {
  await db.from("payment_receipts").update({ status, last_error: error.slice(0, 500), locked_at: null, updated_at: new Date().toISOString() }).eq("id", id);
}

async function processOne(db: SupabaseClient, r: ReceiptRow): Promise<string> {
  // Envio anterior chegou ao WhatsApp mas o processo caiu antes de registrar: não reenvia.
  if (r.message_id) {
    const { data: m } = await db.from("messages").select("delivery_status").eq("id", r.message_id).maybeSingle();
    if (m?.delivery_status === "enviada") {
      await db.from("payment_receipts").update({ status: "enviado", locked_at: null, updated_at: new Date().toISOString() }).eq("id", r.id);
      return "enviado";
    }
  }
  const { data: pay } = await db.from("payments").select("reversed_at").eq("id", r.payment_id).maybeSingle();
  if (!pay || pay.reversed_at) {
    await db.from("payment_receipts").update({ status: "cancelado", last_error: "Pagamento estornado", locked_at: null }).eq("id", r.id);
    return "cancelado";
  }

  const bundle = await loadReceiptData(db, r);
  const pdf = await renderReceiptPdf(bundle);
  const fileName = receiptFileName(bundle);
  const pdfPath = `${r.company_id}/${bundle.data.receiptNumber}-${r.payment_id}.pdf`;
  const { error: upErr } = await db.storage.from("payment-receipts").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`PDF não salvo: ${upErr.message}`);
  const snapshot = bundle.data;
  await db.from("payment_receipts").update({ pdf_path: pdfPath, snapshot, phone: bundle.phone, updated_at: new Date().toISOString() }).eq("id", r.id);

  if (!bundle.phone) {
    await db.from("payment_receipts").update({ status: "sem_whatsapp", last_error: "Cliente sem WhatsApp/telefone no cadastro.", locked_at: null }).eq("id", r.id);
    return "sem_whatsapp";
  }

  const conversation = await getOrCreateConversation(db, r.company_id, bundle.phone, bundle.clientName);
  const [{ data: cfg }, { data: company }, channel] = await Promise.all([
    db.from("ai_agent_config").select("*").eq("company_id", r.company_id).maybeSingle(),
    db.from("companies").select("whatsapp_phone_number_id").eq("id", r.company_id).maybeSingle(),
    channelById(db, conversation.channel_id),
  ]);
  const credentials = channelCredentials(cfg, channel && channel.company_id === r.company_id ? channel : null, { companyPhoneNumberId: company?.whatsapp_phone_number_id });
  const caption = receiptCaption(bundle);

  // Registra no Atendimento antes de enviar (o PDF abre na conversa).
  const messageId = crypto.randomUUID();
  const mediaPath = `${r.company_id}/${conversation.id}/${messageId}`;
  const { error: mediaErr } = await db.storage.from("atendimento-files").upload(mediaPath, pdf, { contentType: "application/pdf", upsert: true });
  if (mediaErr) throw new Error(`PDF não anexado à conversa: ${mediaErr.message}`);
  const { error: msgErr } = await db.from("messages").insert({
    id: messageId, company_id: r.company_id, conversation_id: conversation.id, channel_id: conversation.channel_id ?? null,
    direction: "outbound", author: "automacao", sender_name: "Recibo automático", body: caption,
    media_url: mediaPath, media_type: "application/pdf", file_name: fileName, delivery_status: "processing",
  });
  if (msgErr) throw new Error(`Mensagem não registrada: ${msgErr.message}`);
  await db.from("payment_receipts").update({ message_id: messageId }).eq("id", r.id);

  try {
    const externalId = await sendWhatsAppMedia(credentials, whatsappTarget(bundle.phone), { bytes: pdf, mime: "application/pdf", name: fileName, caption, kind: "document" });
    const at = new Date().toISOString();
    await db.from("messages").update({ delivery_status: "enviada", external_id: externalId, sent_at: at, error_message: null }).eq("id", messageId);
    await db.from("conversations").update({ last_message_at: at, last_message_preview: `📄 ${fileName}` }).eq("id", conversation.id).eq("company_id", r.company_id);
    await db.from("payment_receipts").update({ status: "enviado", sent_at: at, last_error: null, locked_at: null, updated_at: at }).eq("id", r.id);
    return "enviado";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (sendOutcomeUnknown(error)) {
      // Pode ter saído: não reenvia sozinho (evita recibo duplicado). Confira a conversa.
      await db.from("messages").update({ delivery_status: "desconhecido", error_message: message }).eq("id", messageId);
      await fail(db, r.id, `Sem confirmação do WhatsApp (${message}). Confira a conversa antes de reenviar.`, "enviado");
      return "desconhecido";
    }
    await db.from("messages").update({ delivery_status: "falhou", error_message: message }).eq("id", messageId);
    await db.from("payment_receipts").update({ message_id: null }).eq("id", r.id);
    throw error;
  }
}

/** Processa recibos pendentes. paymentId: só o daquela baixa. */
export async function processReceiptQueue(opts: { paymentId?: string | null; limit?: number; deadlineMs?: number } = {}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Servidor sem configuração.");
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const deadline = Date.now() + (opts.deadlineMs ?? 45000);
  const { data, error } = await db.rpc("claim_payment_receipts", { p_limit: opts.limit ?? 5, p_payment: opts.paymentId ?? null });
  if (error) throw new Error(`Fila de recibos: ${error.message}`);
  const results: Array<{ receipt: number; result: string }> = [];
  for (const r of (data ?? []) as ReceiptRow[]) {
    if (Date.now() > deadline) {
      await db.from("payment_receipts").update({ status: "pendente", attempts: Math.max(0, r.attempts - 1), locked_at: null }).eq("id", r.id);
      continue;
    }
    try { results.push({ receipt: r.receipt_number, result: await processOne(db, r) }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Recibo ${r.receipt_number}:`, message);
      await fail(db, r.id, message);
      results.push({ receipt: r.receipt_number, result: "falhou" });
    }
  }
  return results;
}

/** Depois da baixa: gera e envia em segundo plano, sem atrasar a tela. */
export async function scheduleReceipt(paymentId?: string | null) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const id = paymentId && /^[0-9a-f-]{36}$/i.test(paymentId) ? paymentId : null;
  const { after } = await import("next/server");
  after(() => processReceiptQueue({ paymentId: id, limit: id ? 1 : 3 }).catch((e) => console.error("Recibo automático:", e)));
}
