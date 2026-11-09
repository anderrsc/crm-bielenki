import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { operationsDb, runOperations } from '@/lib/operations';
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const db = operationsDb();
  const { data: cfg } = await db.from('crm_operations_config').select('*').eq('id', true).single();
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!cfg?.cron_secret || Buffer.byteLength(token) !== Buffer.byteLength(cfg.cron_secret) || !timingSafeEqual(Buffer.from(token), Buffer.from(cfg.cron_secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { return NextResponse.json(await runOperations(db, cfg)); }
  catch (e) {
    const detail = e instanceof Error ? e.message : 'Falha nas operações';
    await db.from('crm_operations_config').update({ last_error: detail }).eq('id', true);
    console.error('Operations:', detail);
    return NextResponse.json({ error: 'Falha nas operações' }, { status: 500 });
  }
}
