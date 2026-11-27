/** Cores e nomes dos tipos e situações, compartilhados entre o quadro e o calendário. */
export const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; bar: string }> = {
  medicao:    { label: "Medição",     color: "text-blue-700",    bg: "bg-blue-100 border-blue-300",       bar: "bg-blue-600" },
  instalacao: { label: "Instalação",  color: "text-green-700",   bg: "bg-green-100 border-green-300",     bar: "bg-green-600" },
  producao:   { label: "Produção",    color: "text-orange-700",  bg: "bg-orange-100 border-orange-300",   bar: "bg-orange-600" },
  compra:     { label: "Compra",      color: "text-amber-700",   bg: "bg-amber-100 border-amber-300",     bar: "bg-amber-600" },
  reuniao:    { label: "Reunião",     color: "text-purple-700",  bg: "bg-purple-100 border-purple-300",   bar: "bg-purple-600" },
  venda:      { label: "Venda",       color: "text-emerald-700", bg: "bg-emerald-100 border-emerald-300", bar: "bg-emerald-600" },
  pos_venda:  { label: "Pós-venda",   color: "text-teal-700",    bg: "bg-teal-100 border-teal-300",       bar: "bg-teal-600" },
  tarefa:     { label: "Tarefa",      color: "text-gray-700",    bg: "bg-gray-100 border-gray-300",       bar: "bg-gray-600" },
  lembrete:   { label: "Lembrete",    color: "text-pink-700",    bg: "bg-pink-100 border-pink-300",       bar: "bg-pink-600" },
  manutencao: { label: "Manutenção",  color: "text-orange-700",  bg: "bg-orange-100 border-orange-300",   bar: "bg-orange-600" },
  orcamento:  { label: "Orçamento",   color: "text-blue-700",    bg: "bg-blue-100 border-blue-300",       bar: "bg-sky-600" },
};

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  agendado:     { label: "Agendado",     color: "bg-blue-50 text-blue-700" },
  confirmado:   { label: "Confirmado",   color: "bg-green-50 text-green-700" },
  em_andamento: { label: "Em andamento", color: "bg-amber-50 text-amber-700" },
  concluido:    { label: "Concluído",    color: "bg-emerald-50 text-emerald-700" },
  reagendado:   { label: "Reagendado",   color: "bg-orange-50 text-orange-700" },
  cancelado:    { label: "Cancelado",    color: "bg-red-50 text-red-700" },
};

// Medições e instalações gravam nomes próprios de situação.
const STATUS_ALIAS: Record<string, string> = {
  agendada: "agendado", concluida: "concluido", medicao_concluida: "concluido",
  em_medicao: "em_andamento", em_deslocamento: "em_andamento", cancelada: "cancelado",
};

export function statusConfig(status: string) {
  return STATUS_CONFIG[STATUS_ALIAS[status] ?? status]
    ?? { label: status.replaceAll("_", " "), color: "bg-gray-100 text-gray-700" };
}
