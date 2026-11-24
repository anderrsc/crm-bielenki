'use client'

import { useState } from 'react'
import { Plus, Pencil, Power, PowerOff, X } from 'lucide-react'

interface Rule {
 id: string
 title: string
 category: string
 description: string | null
 condition_json: Record<string, unknown>
 action_json: Record<string, unknown>
 is_active: boolean
 created_at: string
 updated_at: string
}

interface LiaRulesClientProps {
 initialRules: Rule[]
}

export default function LiaRulesClient({ initialRules }: LiaRulesClientProps) {
 const [rules, setRules] = useState<Rule[]>(initialRules)
 const [isModalOpen, setIsModalOpen] = useState(false)
 const [editingRule, setEditingRule] = useState<Rule | null>(null)
 const [isLoading, setIsLoading] = useState(false)

 const handleOpenModal = (rule?: Rule) => {
 if (rule) {
 setEditingRule(rule)
 } else {
 setEditingRule(null)
 }
 setIsModalOpen(true)
 }

 const handleCloseModal = () => {
 setIsModalOpen(false)
 setEditingRule(null)
 }

 const handleToggleStatus = async (ruleId: string, currentStatus: boolean) => {
 setIsLoading(true)
 try {
 // Aqui seria implementada a chamada ao server action para atualizar o status
 console.log('Toggle status for rule:', ruleId, 'from', currentStatus, 'to', !currentStatus)
 // Simulação de atualização otimista
 setRules((prev) =>
 prev.map((r) =>
 r.id === ruleId ? { ...r, is_active: !currentStatus } : r
 )
 )
 } catch (error) {
 console.error('Erro ao alternar status:', error)
 } finally {
 setIsLoading(false)
 }
 }

 return (
 <div className="min-h-screen bg-slate-50 p-6">
 <div className="max-w-7xl mx-auto">
 {/* Cabeçalho */}
 <div className="mb-6 flex items-center justify-between">
 <div>
 <h1 className="text-2xl font-semibold text-slate-900">Regras da LIA</h1>
 <p className="mt-1 text-sm text-slate-600">
 Gerencie as regras de automação e validação do sistema
 </p>
 </div>
 <button
 onClick={() => handleOpenModal()}
 className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
 >
 <Plus className="h-4 w-4" />
 Nova Regra
 </button>
 </div>

 {/* Tabela de Regras */}
 <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
 <div className="overflow-x-auto">
 <table className="min-w-full divide-y divide-slate-200">
 <thead className="bg-slate-50">
 <tr>
 <th
 scope="col"
 className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider"
 >
 Título
 </th>
 <th
 scope="col"
 className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider"
 >
 Categoria
 </th>
 <th
 scope="col"
 className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider"
 >
 Status
 </th>
 <th
 scope="col"
 className="px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider"
 >
 Ações
 </th>
 </tr>
 </thead>
 <tbody className="divide-y divide-slate-200 bg-white">
 {rules.length === 0 ? (
 <tr>
 <td colSpan={4} className="px-6 py-12 text-center text-sm text-slate-500">
 Nenhuma regra encontrada. Clique em &quot;Nova Regra&quot; para começar.
 </td>
 </tr>
 ) : (
 rules.map((rule) => (
 <tr key={rule.id} className="hover:bg-slate-50 transition-colors">
 <td className="px-6 py-4">
 <div className="text-sm font-medium text-slate-900">{rule.title}</div>
 {rule.description && (
 <div className="mt-1 text-xs text-slate-500 line-clamp-1">
 {rule.description}
 </div>
 )}
 </td>
 <td className="px-6 py-4">
 <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
 {rule.category}
 </span>
 </td>
 <td className="px-6 py-4">
 <span
 className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
 rule.is_active
 ? 'bg-green-100 text-green-800'
 : 'bg-gray-100 text-gray-800'
 }`}
 >
 {rule.is_active ? 'Ativo' : 'Inativo'}
 </span>
 </td>
 <td className="px-6 py-4">
 <div className="flex items-center justify-end gap-2">
 <button
 onClick={() => handleOpenModal(rule)}
 className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
 title="Editar"
 disabled={isLoading}
 >
 <Pencil className="h-4 w-4" />
 </button>
 <button
 onClick={() => handleToggleStatus(rule.id, rule.is_active)}
 className={`rounded p-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400 ${
 rule.is_active
 ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
 : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
 }`}
 title={rule.is_active ? 'Desativar' : 'Ativar'}
 disabled={isLoading}
 >
 {rule.is_active ? (
 <Power className="h-4 w-4" />
 ) : (
 <PowerOff className="h-4 w-4" />
 )}
 </button>
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>

 {/* Modal de Criação/Edição */}
 {isModalOpen && (
 <div className="fixed inset-0 z-50 overflow-y-auto">
 <div className="flex min-h-full items-center justify-center p-4">
 {/* Overlay */}
 <div
 className="fixed inset-0 bg-black/30 transition-opacity"
 onClick={handleCloseModal}
 />

 {/* Modal Content */}
 <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-xl">
 <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
 <h2 className="text-lg font-semibold text-slate-900">
 {editingRule ? 'Editar Regra' : 'Nova Regra'}
 </h2>
 <button
 onClick={handleCloseModal}
 className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
 >
 <X className="h-5 w-5" />
 </button>
 </div>

 <div className="px-6 py-6">
 <RuleForm
 rule={editingRule}
 onClose={handleCloseModal}
 onSave={(newRule) => {
 if (editingRule) {
 setRules((prev) =>
 prev.map((r) => (r.id === editingRule.id ? newRule : r))
 )
 } else {
 setRules((prev) => [newRule, ...prev])
 }
 handleCloseModal()
 }}
 />
 </div>
 </div>
 </div>
 </div>
 )}
 </div>
 </div>
 )
}

interface RuleFormProps {
 rule: Rule | null
 onClose: () => void
 onSave: (rule: Rule) => void
}

function RuleForm({ rule, onClose, onSave }: RuleFormProps) {
 const [formData, setFormData] = useState({
 title: rule?.title || '',
 category: rule?.category || '',
 description: rule?.description || '',
 conditionJson: rule?.condition_json
 ? JSON.stringify(rule.condition_json, null, 2)
 : '',
 actionJson: rule?.action_json
 ? JSON.stringify(rule.action_json, null, 2)
 : '',
 })
 const [errors, setErrors] = useState<Record<string, string>>({})

 const validate = () => {
 const newErrors: Record<string, string> = {}

 if (!formData.title.trim()) {
 newErrors.title = 'Título é obrigatório'
 }
 if (!formData.category.trim()) {
 newErrors.category = 'Categoria é obrigatória'
 }

 // Validação básica de JSON
 if (formData.conditionJson) {
 try {
 JSON.parse(formData.conditionJson)
 } catch {
 newErrors.conditionJson = 'Condição deve ser um JSON válido'
 }
 }

 if (formData.actionJson) {
 try {
 JSON.parse(formData.actionJson)
 } catch {
 newErrors.actionJson = 'Ação deve ser um JSON válido'
 }
 }

 setErrors(newErrors)
 return Object.keys(newErrors).length === 0
 }

 const handleSubmit = (e: React.FormEvent) => {
 e.preventDefault()

 if (!validate()) {
 return
 }

 const newRule: Rule = {
 id: rule?.id || crypto.randomUUID(),
 title: formData.title,
 category: formData.category,
 description: formData.description || null,
 condition_json: formData.conditionJson
 ? JSON.parse(formData.conditionJson)
 : {},
 action_json: formData.actionJson ? JSON.parse(formData.actionJson) : {},
 is_active: rule?.is_active ?? true,
 created_at: rule?.created_at || new Date().toISOString(),
 updated_at: new Date().toISOString(),
 }

 onSave(newRule)
 }

 return (
 <form onSubmit={handleSubmit} className="space-y-5">
 {/* Título */}
 <div>
 <label
 htmlFor="title"
 className="block text-sm font-medium text-slate-700"
 >
 Título
 </label>
 <input
 type="text"
 id="title"
 value={formData.title}
 onChange={(e) => setFormData({ ...formData, title: e.target.value })}
 className={`mt-1 block w-full rounded-lg border ${
 errors.title ? 'border-red-300' : 'border-slate-300'
 } px-3 py-2 text-sm placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400`}
 placeholder="Ex: Validação de entrada mínima"
 />
 {errors.title && (
 <p className="mt-1 text-xs text-red-600">{errors.title}</p>
 )}
 </div>

 {/* Categoria */}
 <div>
 <label
 htmlFor="category"
 className="block text-sm font-medium text-slate-700"
 >
 Categoria
 </label>
 <select
 id="category"
 value={formData.category}
 onChange={(e) => setFormData({ ...formData, category: e.target.value })}
 className={`mt-1 block w-full rounded-lg border ${
 errors.category ? 'border-red-300' : 'border-slate-300'
 } px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400`}
 >
 <option value="">Selecione uma categoria</option>
 <option value="financeira">Financeira</option>
 <option value="validacao">Validação</option>
 <option value="aprovacao">Aprovação</option>
 <option value="notificacao">Notificação</option>
 </select>
 {errors.category && (
 <p className="mt-1 text-xs text-red-600">{errors.category}</p>
 )}
 </div>

 {/* Descrição */}
 <div>
 <label
 htmlFor="description"
 className="block text-sm font-medium text-slate-700"
 >
 Descrição
 </label>
 <textarea
 id="description"
 rows={3}
 value={formData.description}
 onChange={(e) =>
 setFormData({ ...formData, description: e.target.value })
 }
 className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
 placeholder="Descreva o propósito desta regra..."
 />
 </div>

 {/* Condição JSON */}
 <div>
 <label
 htmlFor="conditionJson"
 className="block text-sm font-medium text-slate-700"
 >
 Condição (JSON)
 </label>
 <textarea
 id="conditionJson"
 rows={5}
 value={formData.conditionJson}
 onChange={(e) =>
 setFormData({ ...formData, conditionJson: e.target.value })
 }
 className={`mt-1 block w-full rounded-lg border ${
 errors.conditionJson ? 'border-red-300' : 'border-slate-300'
 } border-slate-300 px-3 py-2 text-sm font-mono placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400`}
 placeholder={'{\n "field": "down_payment",\n "operator": ">=",\n "value": 0.5\n}'}
 />
 {errors.conditionJson && (
 <p className="mt-1 text-xs text-red-600">{errors.conditionJson}</p>
 )}
 </div>

 {/* Ação JSON */}
 <div>
 <label
 htmlFor="actionJson"
 className="block text-sm font-medium text-slate-700"
 >
 Ação (JSON)
 </label>
 <textarea
 id="actionJson"
 rows={5}
 value={formData.actionJson}
 onChange={(e) =>
 setFormData({ ...formData, actionJson: e.target.value })
 }
 className={`mt-1 block w-full rounded-lg border ${
 errors.actionJson ? 'border-red-300' : 'border-slate-300'
 } border-slate-300 px-3 py-2 text-sm font-mono placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400`}
 placeholder={'{\n "type": "require_approval",\n "approver_role": "manager"\n}'}
 />
 {errors.actionJson && (
 <p className="mt-1 text-xs text-red-600">{errors.actionJson}</p>
 )}
 </div>

 {/* Botões */}
 <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
 <button
 type="button"
 onClick={onClose}
 className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
 >
 Cancelar
 </button>
 <button
 type="submit"
 className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
 >
 Salvar
 </button>
 </div>
 </form>
 )
}