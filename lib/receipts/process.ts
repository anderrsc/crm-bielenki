// Fila de recibos: gera o PDF, guarda e envia ao cliente pelo WhatsApp. Somente servidor.
// Chamado logo após a baixa (after()) e, de reserva, pelo agendador a cada 5 minutos.
import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { after } from "next/server";
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
  const ref = d.orderNumber ? ` referente ao pedido nº ${d.orderNumber}` : d.saleNumber ? ` referente à venda nº ${d.saleNumber}` : d.reference ? ` referente a: ${d.reference}` : "";
  const [y, m, day] = d.paidAt.split("-");
  const status = receiptStatus(d.balance, d.hasOrder);
  const tail = status.cls === "quitado"
    ? `${status.label}. Muito obrigado pela confiança! 🙏`
    : `Saldo restante: *R$ ${brl(d.balance)}*.`;
  return `${hello} Aqui é da ${d.company.name}. ✅\n\nConfirmamos o recebimento de *R$ ${brl(d.amount)}* via ${d.method} em ${day}/${m}/${y}${ref}.\n\nSegue o seu recibo nº ${d.receiptNumber}. ${tail}`;
}

/** Envio pode ter saído (sem resposta, resposta incompleta, erro do servidor do WhatsApp): não reenvia sozinho. */
export function sendMaybeDelivered(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return sendOutcomeUnknown(error) || /não confirmou|HTTP 5\d\d/i.test(message);
}

/** Erro do WhatsApp em português claro para a tela. */
export function friendlySendError(error: unknown) {
  const m = error instanceof Error ? error.message : String(error);
  if (/não configurado|URL da Evolution/i.test(m)) return "WhatsApp do CRM desconectado ou não configurado. Confira em Configurações > WhatsApp e toque em Enviar ao cliente.";
  if (/24h/i.test(m)) return "WhatsApp oficial: passaram 24h da última mensagem do cliente. Peça para ele mandar uma mensagem e toque em Enviar ao cliente.";
  if (/HTTP 4\d\d/i.test(m)) return "O WhatsApp recusou o envio (número sem WhatsApp ou inválido). Confira o celular do cliente e toque em Enviar ao cliente.";
  return `Recibo não enviado: ${m.slice(0, 200)}`;
}

type Db = SupabaseClient;
const now = () => new Date().toISOString();

/** Atualiza o recibo só se ainda for deste processamento (estorno ou outro processo não são sobrescritos). */
async function finish(db: Db, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("payment_receipts").update({ ...patch, locked_at: null, updated_at: now() }).eq("id", id).eq("status", "processando");
  if (error) console.error("Recibo: status não gravado", id, error.message);
}

async function processOne(db: Db, r: ReceiptRow): Promise<string> {
  // Já houve tentativa de envio (processo caiu no meio ou WhatsApp não respondeu): não manda de novo sozinho.
  if (r.message_id) {
    const { data: m } = await db.from("messages").select("delivery_status,sent_at").eq("id", r.message_id).maybeSingle();
    const delivered = m && ["enviada", "entregue", "lida"].includes(String(m.delivery_status));
    await finish(db, r.id, delivered
      ? { status: "enviado", sent_at: m?.sent_at ?? now(), last_error: null }
      : { status: "sem_confirmacao", last_error: "O envio anterior não foi confirmado pelo WhatsApp. Confira a conversa do cliente; se o recibo não chegou, toque em Reenviar." });
    return delivered ? "enviado" : "sem_confirmacao";
  }

  const bundle = await loadReceiptData(db, r);
  if (bundle.reversed) { await finish(db, r.id, { status: "cancelado", last_error: "Pagamento estornado" }); return "cancelado"; }
  const pdf = await renderReceiptPdf(bundle);
  const fileName = receiptFileName(bundle);
  const pdfPath = `${r.company_id}/${bundle.data.receiptNumber}-${r.payment_id}.pdf`;
  const { error: upErr } = await db.storage.from("payment-receipts").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`PDF não salvo: ${upErr.message}`);
  const { error: snapErr } = await db.from("payment_receipts").update({ pdf_path: pdfPath, snapshot: bundle.data, phone: bundle.phone, updated_at: now() }).eq("id", r.id);
  if (snapErr) throw new Error(`Recibo não gravado: ${snapErr.message}`);

  // Conversa: a do celular do cadastro; sem celular, a da cobrança Pix (contato sem cadastro).
  let conversation: { id: string; channel_id: string | null; target: string } | null = null;
  if (bundle.phone) {
    const c = await getOrCreateConversation(db, r.company_id, bundle.phone, bundle.clientName);
    conversation = { id: c.id, channel_id: c.channel_id ?? null, target: bundle.phone };
  } else if (bundle.conversationId) {
    const { data: c } = await db.from("conversations").select("id,channel_id,phone,external_id").eq("id", bundle.conversationId).eq("company_id", r.company_id).maybeSingle();
    const target = c ? whatsappTarget(c.phone || c.external_id) : "";
    if (c && target) conversation = { id: c.id, channel_id: c.channel_id ?? null, target };
  }
  if (!conversation) { await finish(db, r.id, { status: "sem_whatsapp", last_error: bundle.noPhoneReason }); return "sem_whatsapp"; }

  const [{ data: cfg }, channel] = await Promise.all([
    db.from("ai_agent_config").select("*").eq("company_id", r.company_id).maybeSingle(),
    channelById(db, conversation.channel_id),
  ]);
  const credentials = channelCredentials(cfg, channel && channel.company_id === r.company_id ? channel : null, { companyPhoneNumberId: bundle.whatsappPhoneNumberId });
  const caption = receiptCaption(bundle);

  // Registra no Atendimento antes de enviar (o PDF abre na conversa) e marca a tentativa no recibo.
  const messageId = crypto.randomUUID();
  const mediaPath = `${r.company_id}/${conversation.id}/${messageId}`;
  const { error: mediaErr } = await db.storage.from("atendimento-files").upload(mediaPath, pdf, { contentType: "application/pdf", upsert: true });
  if (mediaErr) throw new Error(`PDF não anexado à conversa: ${mediaErr.message}`);
  const { error: msgErr } = await db.from("messages").insert({
    id: messageId, company_id: r.company_id, conversation_id: conversation.id, channel_id: conversation.channel_id,
    direction: "outbound", author: "automacao", sender_name: "Recibo automático", body: caption,
    media_url: mediaPath, media_type: "application/pdf", file_name: fileName, delivery_status: "processing",
  });
  if (msgErr) throw new Error(`Mensagem não registrada: ${msgErr.message}`);
  // Sem esta marca não há proteção contra recibo em dobro: se não gravar, não envia.
  const { data: marked, error: markErr } = await db.from("payment_receipts").update({ message_id: messageId }).eq("id", r.id).eq("status", "processando").select("id");
  if (markErr || !marked?.length) {
    await db.from("messages").delete().eq("id", messageId);
    if (markErr) throw new Error(`Recibo não gravado: ${markErr.message}`);
    return "cancelado"; // estornado (ou reenviado) durante a geração do PDF
  }

  try {
    const externalId = await sendWhatsAppMedia(credentials, conversation.target, { bytes: pdf, mime: "application/pdf", name: fileName, caption, kind: "document" });
    const at = now();
    const { error: sentErr } = await db.from("messages").update({ delivery_status: "enviada", external_id: externalId, sent_at: at, error_message: null }).eq("id", messageId);
    if (sentErr) console.error("Recibo: mensagem enviada mas não marcada", messageId, sentErr.message);
    await db.from("conversations").update({ last_message_at: at, last_message_preview: `📄 ${fileName}` }).eq("id", conversation.id).eq("company_id", r.company_id);
    await finish(db, r.id, { status: "enviado", sent_at: at, last_error: null });
    return "enviado";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (sendMaybeDelivered(error)) {
      await db.from("messages").update({ delivery_status: "desconhecido", error_message: message }).eq("id", messageId);
      await finish(db, r.id, { status: "sem_confirmacao", sent_at: now(), last_error: "O WhatsApp não confirmou o envio. Confira a conversa do cliente; se o recibo não chegou, toque em Reenviar." });
      return "sem_confirmacao";
    }
    // Recusado com certeza: pode tentar de novo.
    await db.from("messages").update({ delivery_status: "falhou", error_message: message }).eq("id", messageId);
    await db.from("payment_receipts").update({ message_id: null }).eq("id", r.id).eq("message_id", messageId);
    throw new Error(friendlySendError(error));
  }
}

/**
 * Processa recibos pendentes. paymentId: só o daquela baixa.
 * startCutoffMs: não começa recibo novo depois disso (cada um leva até ~40 s; a função tem 60 s).
 */
export async function processReceiptQueue(opts: { paymentId?: string | null; limit?: number; startCutoffMs?: number } = {}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Servidor sem configuração.");
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const started = Date.now();
  const cutoff = started + (opts.startCutoffMs ?? 15000);
  const results: Array<{ receipt: number; result: string }> = [];
  for (let i = 0; i < (opts.limit ?? 1); i++) {
    if (Date.now() > cutoff) break;
    // Um por vez: reserva só o que vai processar agora (os outros ficam livres para o próximo ciclo).
    const { data, error } = await db.rpc("claim_payment_receipts", { p_limit: 1, p_payment: opts.paymentId ?? null });
    if (error) throw new Error(`Fila de recibos: ${error.message}`);
    const r = ((data ?? []) as ReceiptRow[])[0];
    if (!r) break;
    try { results.push({ receipt: r.receipt_number, result: await processOne(db, r) }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Recibo ${r.receipt_number}:`, message);
      await finish(db, r.id, { status: "falhou", last_error: message.slice(0, 500) });
      results.push({ receipt: r.receipt_number, result: "falhou" });
    }
    if (opts.paymentId) break;
  }
  return results;
}

/** Depois da baixa: gera e envia em segundo plano, sem atrasar a tela. */
export async function scheduleReceipt(paymentId?: string | null) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const id = paymentId && /^[0-9a-f-]{36}$/i.test(paymentId) ? paymentId : null;
  after(() => processReceiptQueue({ paymentId: id, limit: 1 }).catch((e) => console.error("Recibo automático:", e)));
}
