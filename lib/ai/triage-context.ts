export type TriageMessage = { role: string; content: string; timestamp?: string };

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");

/** Só texto escrito pelo cliente identifica negociação; nome de PDF não é identidade. */
export function isExistingQuoteConversation(messages: TriageMessage[]): boolean {
  return messages.some(m => {
    if (m.role !== "user") return false;
    const text = normalize(m.content).replace(/\[documento[^\]]*\]/g, "");
    return /(?:orcamento|proposta).{0,100}(?:que (?:voce|vc|voces).{0,15}(?:fez|fizeram|enviou|enviaram|mandou|mandaram)|recebi|recebemos|aprovad|enviad)/.test(text)
      || /(?:nesse|neste|desse|deste|este|esse|seu|seus|sua)\s+(?:orcamento|proposta)/.test(text)
      || /(?:comparar|revisar|alterar|ajustar|negociar|duvidas? sobre)\s+(?:(?:o|a|um|uma)\s+)?(?:orcamento|proposta)/.test(text);
  });
}

export function quoteHandoff(messages: TriageMessage[]) {
  const request = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  return {
    mensagem: "Entendi. Vou passar suas dúvidas sobre o orçamento para o responsável conferir e responder por aqui.",
    analise: { o_que_o_cliente_quer: "Esclarecer ou revisar orçamento existente", falta: "Conferência do orçamento e das dúvidas pela equipe" },
    dados_coletados: {}, triagem_concluida: true, tipo_atendimento: "comercial",
    resumo_executivo: `Retorno sobre orçamento existente. Conferir as solicitações abaixo antes de responder; não há confirmação técnica automática.\n${request}`,
    prioridade: "alta", score: null,
    proxima_acao: "Conferir orçamento/projeto e responder às dúvidas registradas; continuar a negociação sem reiniciar a triagem.",
  };
}
