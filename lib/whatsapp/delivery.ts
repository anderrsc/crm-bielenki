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
