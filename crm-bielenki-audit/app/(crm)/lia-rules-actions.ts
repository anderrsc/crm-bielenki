'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface BudgetPayload {
  id?: string
  total_value: number
  down_payment: number
  installment_value: number
  customer_id: string
  salesperson_id: string
}

export interface RuleViolation {
  rule: 'DOWN_PAYMENT_MINIMUM' | 'INSTALLMENT_MINIMUM'
  message: string
  required: number
  actual: number
}

export interface ValidationResult {
  valid: boolean
  violations: RuleViolation[]
}

export interface ApprovalRequest {
  budget_id: string
  violation_type: 'DOWN_PAYMENT_MINIMUM' | 'INSTALLMENT_MINIMUM'
  requested_override_value: number
  requested_by: string
  justification: string
}

// ─── Constantes das regras financeiras ───────────────────────────────────────

const RULES = {
  DOWN_PAYMENT_MINIMUM_PERCENTAGE: 0.5, // 50% do valor total
  INSTALLMENT_MINIMUM_VALUE: 100,       // Valor mínimo da parcela
} as const

// ─── Função de avaliação de regras financeiras ──────────────────────────────

/**
 * Avalia se um payload de orçamento/venda atende às regras financeiras mínimas.
 *
 * Regras:
 * - O valor de entrada (down_payment) deve ser >= 50% do valor total (total_value)
 * - O valor da parcela (installment_value) deve ser >= 100
 *
 * @param payload - Dados do orçamento/venda a serem validados
 * @returns Objeto com status de validade e lista de violações encontradas
 */
export async function evaluateFinancialRules(
  payload: BudgetPayload
): Promise<ValidationResult> {
  const violations: RuleViolation[] = []

  // Regra 1: Entrada mínima de 50% do valor total
  const minimumDownPayment = payload.total_value * RULES.DOWN_PAYMENT_MINIMUM_PERCENTAGE
  if (payload.down_payment < minimumDownPayment) {
    violations.push({
      rule: 'DOWN_PAYMENT_MINIMUM',
      message: `O valor de entrada deve ser de pelo menos ${minimumDownPayment.toFixed(2)} (${(RULES.DOWN_PAYMENT_MINIMUM_PERCENTAGE * 100).toFixed(0)}% do total)`,
      required: minimumDownPayment,
      actual: payload.down_payment,
    })
  }

  // Regra 2: Valor mínimo da parcela
  if (payload.installment_value < RULES.INSTALLMENT_MINIMUM_VALUE) {
    violations.push({
      rule: 'INSTALLMENT_MINIMUM',
      message: `O valor da parcela deve ser de pelo menos ${RULES.INSTALLMENT_MINIMUM_VALUE}`,
      required: RULES.INSTALLMENT_MINIMUM_VALUE,
      actual: payload.installment_value,
    })
  }

  return {
    valid: violations.length === 0,
    violations,
  }
}

// ─── Função de solicitação de aprovação ─────────────────────────────────────

/**
 * Cria uma solicitação de aprovação na tabela lia_approvals quando uma regra
 * financeira é violada, mas pode ser sobrescrita por um gerente.
 *
 * Requer autenticação ativa. Redireciona para /login se o usuário não estiver
 * autenticado.
 *
 * @param request - Dados da solicitação de aprovação
 * @returns A aprovação criada ou lança erro em caso de falha
 */
export async function requestApproval(request: ApprovalRequest) {
  const supabase = await createClient()

  // Verifica se o usuário está autenticado
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Valida dados obrigatórios
  if (!request.budget_id) {
    throw new Error('budget_id é obrigatório para solicitar aprovação')
  }
  if (!request.violation_type) {
    throw new Error('violation_type é obrigatório')
  }
  if (!request.justification?.trim()) {
    throw new Error('justification é obrigatória')
  }

  // Insere a solicitação de aprovação na tabela lia_approvals
  const { data: approval, error } = await supabase
    .from('lia_approvals')
    .insert({
      budget_id: request.budget_id,
      violation_type: request.violation_type,
      requested_override_value: request.requested_override_value,
      requested_by: user.id,
      justification: request.justification.trim(),
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('Erro ao criar solicitação de aprovação:', error)
    throw new Error(`Falha ao criar solicitação de aprovação: ${error.message}`)
  }

  // Revalida o cache do caminho de aprovações para refletir a nova solicitação
  revalidatePath('/approvals')
  revalidatePath(`/budgets/${request.budget_id}`)

  return approval
}

// ─── Server Action combinada: valida e solicita aprovação se necessário ─────

/**
 * Server action que avalia as regras financeiras e, se houver violação,
 * cria automaticamente uma solicitação de aprovação.
 *
 * Use esta função como ponto de entrada único para submissão de orçamentos
 * que podem requerer aprovação gerencial.
 *
 * @param payload - Dados do orçamento/venda
 * @param justification - Justificativa para possível override (obrigatória se houver violação)
 * @returns Resultado da validação e, se aplicável, a aprovação solicitada
 */
export async function submitBudgetWithApproval(
  payload: BudgetPayload,
  justification?: string
) {
  // Avalia as regras financeiras
  const validationResult = await evaluateFinancialRules(payload)

  // Se válido, retorna sucesso sem criar aprovação
  if (validationResult.valid) {
    return {
      success: true,
      requiresApproval: false,
      validation: validationResult,
      approval: null,
    }
  }

  // Se inválido e não há justificativa, retorna erro
  if (!justification?.trim()) {
    return {
      success: false,
      requiresApproval: true,
      validation: validationResult,
      approval: null,
      error: 'Justificativa é obrigatória para solicitar aprovação de regras violadas',
    }
  }

  // Determina qual violação usar para a solicitação (usa a primeira)
  const primaryViolation = validationResult.violations[0]

  try {
    // Solicita aprovação
    const approval = await requestApproval({
      budget_id: payload.id ?? crypto.randomUUID(),
      violation_type: primaryViolation.rule,
      requested_override_value: primaryViolation.actual,
      requested_by: '', // Será preenchido automaticamente pela função requestApproval
      justification,
    })

    return {
      success: true,
      requiresApproval: true,
      validation: validationResult,
      approval,
    }
  } catch (error) {
    console.error('Erro ao solicitar aprovação:', error)
    return {
      success: false,
      requiresApproval: true,
      validation: validationResult,
      approval: null,
      error: error instanceof Error ? error.message : 'Erro desconhecido ao solicitar aprovação',
    }
  }
}

// ─── Server Actions para gestão de regras (lia_rules) ──────────────────────

/**
 * Cria uma nova regra na tabela lia_rules.
 *
 * Verifica o company_id do usuário autenticado para manter o isolamento multiempresa (RLS).
 * Usa revalidatePath após a inserção para atualizar o cache.
 *
 * @param formData - Dados do formulário com os campos da regra
 * @returns A regra criada ou lança erro em caso de falha
 */
export async function createRule(formData: FormData) {
  const supabase = await createClient()

  // Verifica se o usuário está autenticado
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Extrai os dados do formulário
  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const ruleType = formData.get('rule_type') as string
  const condition = formData.get('condition') as string
  const action = formData.get('action') as string
  const isActive = formData.get('is_active') === 'true'

  // Valida dados obrigatórios
  if (!name?.trim()) {
    throw new Error('O nome da regra é obrigatório')
  }
  if (!ruleType?.trim()) {
    throw new Error('O tipo da regra é obrigatório')
  }
  if (!condition?.trim()) {
    throw new Error('A condição da regra é obrigatória')
  }
  if (!action?.trim()) {
    throw new Error('A ação da regra é obrigatória')
  }

  // Busca o company_id do usuário autenticado
  const { data: userProfile, error: profileError } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (profileError || !userProfile?.company_id) {
    throw new Error('Não foi possível identificar a empresa do usuário')
  }

  // Insere a nova regra na tabela lia_rules
  const { data: rule, error } = await supabase
    .from('lia_rules')
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      rule_type: ruleType.trim(),
      condition: condition.trim(),
      action: action.trim(),
      is_active: isActive,
      company_id: userProfile.company_id,
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('Erro ao criar regra:', error)
    throw new Error(`Falha ao criar regra: ${error.message}`)
  }

  // Revalida o cache dos caminhos relacionados às regras
  revalidatePath('/rules')
  revalidatePath('/lia/rules')

  return rule
}

/**
 * Atualiza o status de ativação de uma regra na tabela lia_rules.
 *
 * Verifica o company_id do usuário autenticado para manter o isolamento multiempresa (RLS).
 * Usa revalidatePath após a atualização para atualizar o cache.
 *
 * @param ruleId - ID da regra a ser atualizada
 * @param isActive - Novo valor do campo is_active
 * @returns A regra atualizada ou lança erro em caso de falha
 */
export async function updateRuleStatus(ruleId: string, isActive: boolean) {
  const supabase = await createClient()

  // Verifica se o usuário está autenticado
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Valida o ruleId
  if (!ruleId?.trim()) {
    throw new Error('O ID da regra é obrigatório')
  }

  // Busca o company_id do usuário autenticado
  const { data: userProfile, error: profileError } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (profileError || !userProfile?.company_id) {
    throw new Error('Não foi possível identificar a empresa do usuário')
  }

  // Atualiza o status da regra, garantindo que pertence à empresa do usuário
  const { data: rule, error } = await supabase
    .from('lia_rules')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ruleId)
    .eq('company_id', userProfile.company_id)
    .select()
    .single()

  if (error) {
    console.error('Erro ao atualizar status da regra:', error)
    if (error.code === 'PGRST116') {
      throw new Error('Regra não encontrada ou você não tem permissão para modificá-la')
    }
    throw new Error(`Falha ao atualizar status da regra: ${error.message}`)
  }

  if (!rule) {
    throw new Error('Regra não encontrada ou você não tem permissão para modificá-la')
  }

  // Revalida o cache dos caminhos relacionados às regras
  revalidatePath('/rules')
  revalidatePath('/lia/rules')
  revalidatePath(`/lia/rules/${ruleId}`)

  return rule
}