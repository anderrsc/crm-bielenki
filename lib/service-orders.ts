// Rotulos do modulo Servicos.
export const SERVICE_KINDS: Record<string, string> = {
  instalacao_calhas: "Instalação de calhas e rufos", instalacao_esquadrias: "Instalação de esquadrias", manutencao_calhas: "Manutenção de calhas",
  manutencao_esquadrias: "Manutenção de esquadrias", reparo: "Reparo ou correção", substituicao: "Substituição de peças", ajuste: "Ajuste ou regulagem",
  garantia: "Atendimento de garantia", visita_tecnica: "Visita técnica", outro: "Outro serviço",
};
export const SERVICE_CLASSIFICATIONS: Record<string, string> = {
  garantia: "Garantia", preventiva: "Manutenção preventiva", corretiva: "Manutenção corretiva", ajuste: "Ajuste ou regulagem",
  problema_instalacao: "Problema de instalação", dano_terceiros: "Dano causado por terceiros", adicional: "Serviço adicional solicitado pelo cliente",
};
export const SERVICE_STATUS: Record<string, string> = {
  solicitacao_recebida: "Solicitação recebida", aguardando_avaliacao: "Aguardando avaliação", aguardando_agendamento: "Aguardando agendamento",
  visita_agendada: "Visita agendada", em_atendimento: "Em atendimento", aguardando_material: "Aguardando material", necessita_retorno: "Necessita retorno",
  concluido: "Serviço concluído", cancelado: "Cancelado",
};
export const SERVICE_PRIORITY: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };
/** Situacoes que o usuario pode escolher direto (agendar e concluir tem formulario proprio). */
export const SERVICE_MANUAL_STATUS = ["aguardando_avaliacao", "aguardando_agendamento", "em_atendimento", "aguardando_material", "necessita_retorno", "cancelado"] as const;
export const isMaintenance = (kind: string) => !kind.startsWith("instalacao") && kind !== "visita_tecnica";
export const serviceOpen = (status: string) => status !== "concluido" && status !== "cancelado";

export function mapsLink(parts: (string | null | undefined)[], url?: string | null) {
  if (url && /^https?:\/\//i.test(url)) return url;
  const text = parts.filter(Boolean).join(", ");
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}
