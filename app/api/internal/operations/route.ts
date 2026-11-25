import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { operationsDb, runOperations } from '@/lib/operations';
import { processReceiptQueue } from '@/lib/receipts/process';
export const maxDuration = 60;

function safeEqual(a: string, b: string): boolean {
  try {
    if (Buffer.byteLength(a) !== Buffer.byteLength(b)) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch { return false; }
}

async function handle(req: NextRequest) {
  const db = operationsDb();
  const { data: cfg } = await db.from('crm_operations_config').select('*').eq('id', true).single();
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  // Aceita o segredo do Vercel Cron (CRON_SECRET) ou o segredo gravado no banco.
  const cronSecret = process.env.CRON_SECRET ?? '';
  const validVercel = cronSecret.length > 0 && safeEqual(token, cronSecret);
  const validDb = cfg?.cron_secret && safeEqual(token, cfg.cron_secret);
  if (!validVercel && !validDb) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!cfg) return NextResponse.json({ error: 'Config não encontrada' }, { status: 500 });
  try {
    const result = await runOperations(db, cfg);
    // Recibos que ficaram na fila (reserva do envio automático), no mesmo agendador de 1 minuto.
    const recibos = await processReceiptQueue({ limit: 3, startCutoffMs: 10000 }).catch((e) => { console.error('Recibos:', e instanceof Error ? e.message : e); return null; });
    return NextResponse.json({ ...result, recibos });
  }
  catch (e) {
    const detail = e instanceof Error ? e.message : 'Falha nas operações';
    await db.from('crm_operations_config').update({ last_error: detail }).eq('id', true);
    console.error('Operations:', detail);
    return NextResponse.json({ error: 'Falha nas operações' }, { status: 500 });
  }
}

// POST: chamado manualmente ou por agendador externo com o segredo do banco.
export async function POST(req: NextRequest) { return handle(req); }
// GET: chamado pelo Vercel Cron (envia Authorization: Bearer {CRON_SECRET}).
export async function GET(req: NextRequest) { return handle(req); }
