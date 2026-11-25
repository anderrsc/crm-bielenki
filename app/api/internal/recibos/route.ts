// Reserva do recibo automático: processa recibos pendentes/que falharam (agendador a cada 5 min).
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { operationsDb } from "@/lib/operations";
import { processReceiptQueue } from "@/lib/receipts/process";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeEqual(a: string, b: string): boolean {
  try { return Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
  catch { return false; }
}

async function handle(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  let ok = cronSecret.length > 0 && safeEqual(token, cronSecret);
  if (!ok) {
    const { data: cfg } = await operationsDb().from("crm_operations_config").select("cron_secret").eq("id", true).maybeSingle();
    ok = Boolean(cfg?.cron_secret && safeEqual(token, cfg.cron_secret));
  }
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, recibos: await processReceiptQueue({ limit: 5, deadlineMs: 45000 }) }); }
  catch (e) {
    console.error("Recibos:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Falha ao processar recibos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }
