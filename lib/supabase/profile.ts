import type { SupabaseClient } from '@supabase/supabase-js';

export async function currentProfile(db: SupabaseClient, select: string): Promise<{ data: Record<string, any> | null; error: { message: string } | null }> {
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return { data: null, error: error ?? new Error('Usuário não autenticado') };
  // RLS exposes colleagues too. A bare .single() fails as soon as a second
  // employee is added; identify the signed-in user explicitly.
  const result = await db.from('profiles').select(select).eq('id', user.id).single();
  return { data: result.data, error: result.error };
}
