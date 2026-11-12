// Status do banco ("aguardando_pagamento") como texto de tela ("Aguardando pagamento").
const LABELS: Record<string, string> = {
  aguardando_pagamento: "Aguardando pagamento", parcialmente_pago: "Parcialmente pago", pago: "Pago", vencido: "Vencido",
  vence_hoje: "Vence hoje", cancelado: "Cancelado", rascunho: "Rascunho", enviado: "Enviado", aprovado: "Aprovado",
  recusado: "Recusado", concluido: "Concluído", concluida: "Concluída", em_andamento: "Em andamento", agendada: "Agendada",
  agendado: "Agendado", nao_aplicavel: "Não se aplica", aguardando_material: "Aguardando material", em_producao: "Em produção",
  finalizado: "Finalizado", novo: "Novo", aberto: "Aberto", aberta: "Aberta", ativo: "Ativo", inativo: "Inativo",
  liberado: "Liberado", recebido: "Recebido", recebido_parcial: "Recebido parcial", pendente: "Pendente", em_rota: "Em rota",
  instalado: "Instalado", medicao: "Medição", producao: "Produção", instalacao: "Instalação", em_negociacao: "Em negociação",
};
export function statusLabel(value: string): string {
  const v = String(value ?? "");
  const known = LABELS[v.toLowerCase()];
  if (known) return known;
  const text = v.replaceAll("_", " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
