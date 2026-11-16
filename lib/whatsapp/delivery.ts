import type { SupabaseClient } from '@supabase/supabase-js';
export function deliveryStatus(value: unknown): 'enviada' | 'entregue' | 'lida' | 'falhou' | null {
  const s = String(value).toUpperCase();
  if (['READ','PLAYED','4','5'].includes(s)) return 'lida';
  if (['DELIVERED','DELIVERY_ACK','3'].includes(s)) return 'entregue';
  if (['SENT','SERVER_ACK','2'].includes(s)) return 'enviada';
  if (['FAILED','ERROR','0'].includes(s)) return 'falhou';
  return null;
}
export async function updateDelivery(db: SupabaseClient, companyId: string, id: string, value: unknown) {
  const status = deliveryStatus(value);
  if (!id || !status) return;
  // Conditional update keeps delayed receipts from moving read messages backwards.
  const previous = status === 'lida' ? ['enviada','entregue','falhou'] : status === 'entregue' ? ['enviada','falhou'] : ['enviada'];
  const { error } = await db.from('messages').update({delivery_status:status}).eq('company_id',companyId).eq('external_id',id).eq('direction','outbound').in('delivery_status',previous);
  if (error) throw new Error(error.message);
}

/** Leitura feita no celular/Web: só limpa até a mensagem confirmada, sem apagar chegadas novas. */
export async function updateIncomingRead(db: SupabaseClient, companyId: string, externalId: string, value: unknown) {
  if (!externalId || deliveryStatus(value) !== 'lida') return;
  const { data: seen, error } = await db.from('messages').select('id,conversation_id,sent_at')
    .eq('company_id', companyId).eq('external_id', externalId).eq('direction', 'inbound').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!seen) return;
  const { error: receiptError } = await db.from('messages').update({ delivery_status: 'lida' }).eq('company_id', companyId).eq('id', seen.id);
  if (receiptError) throw new Error(receiptError.message);
  const { data: snapshot, error: snapshotError } = await db.from('conversations').select('ai_generation_id')
    .eq('company_id', companyId).eq('id', seen.conversation_id).maybeSingle();
  if (snapshotError) throw new Error(snapshotError.message);
  if (!snapshot) return;
  // Horários iguais são ambíguos: não presume que a outra mensagem também foi vista.
  const { data: newer, error: newerError } = await db.from('messages').select('id').eq('company_id', companyId)
    .eq('conversation_id', seen.conversation_id).eq('direction', 'inbound').gte('sent_at', seen.sent_at).neq('id', seen.id).limit(1);
  if (newerError) throw new Error(newerError.message);
  if (newer?.length) return;
  let clear = db.from('conversations').update({ unread_count: 0 }).eq('company_id', companyId).eq('id', seen.conversation_id).lte('last_inbound_at', seen.sent_at);
  clear = snapshot.ai_generation_id ? clear.eq('ai_generation_id', snapshot.ai_generation_id) : clear.is('ai_generation_id', null);
  const { error: clearError } = await clear;
  if (clearError) throw new Error(clearError.message);
}
