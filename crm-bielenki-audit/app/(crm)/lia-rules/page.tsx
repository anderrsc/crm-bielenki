import { createClient } from '@/lib/supabase/server'
import LiaRulesClient from './LiaRulesClient'

export default async function LiaRulesPage() {
 const supabase = await createClient()

 const { data: rules, error } = await supabase
 .from('lia_rules')
 .select('*')
 .order('created_at', { ascending: false })

 if (error) {
 console.error('Erro ao buscar regras:', error)
 }

 return <LiaRulesClient initialRules={rules || []} />
}