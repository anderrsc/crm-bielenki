// Respostas prontas do Atendimento.
// Começo sugerido: a equipe troca o que estiver entre [colchetes].
export const QUICK_REPLY_DEFAULTS: Array<{ shortcut: string; body: string }> = [
  { shortcut: "endereco", body: "Nosso endereço: [rua, número, bairro], Jaraguá do Sul. Localização: [link do Google Maps]" },
  { shortcut: "horario", body: "Atendemos de segunda a sexta, das [8h] às [18h], e sábado das [8h] às [12h]." },
  { shortcut: "pix", body: "Segue nossa chave Pix: [chave]. Em nome de Marquinhos Calhas e Esquadrias. Depois é só me mandar o comprovante por aqui 🙏" },
  { shortcut: "foto", body: "{nome}, se puder me manda uma foto do local (de longe e de perto) que ajuda bastante a montar o orçamento certinho." },
  { shortcut: "medidas", body: "{nome}, você já tem as medidas? Se não tiver, a gente agenda uma visita técnica para medir." },
  { shortcut: "orcamento", body: "{nome}, segue o seu orçamento. Qualquer dúvida estou à disposição!" },
];


/** Troca {nome} pelo primeiro nome do contato (ou tira, se não tiver nome). */
export function fillQuickReply(body: string, contactName?: string | null): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0];
  const name = first && !/^[\d(+]/.test(first) ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "";
  const out = name ? body.replace(/\{nome\}/gi, name) : body.replace(/\s*\{nome\}\s*,?\s*/gi, " ").replace(/\s+([!?.,])/g, "$1");
  return out.trim().replace(/^./, (c) => c.toUpperCase());
}

/** "/pi" no começo da mensagem → filtra os atalhos que começam com "pi". */
export function quickReplyQuery(text: string): string | null {
  const m = text.match(/^\/(\S*)$/);
  return m ? m[1].toLowerCase() : null;
}
