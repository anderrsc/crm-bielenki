import type { TriageMessage } from "./triage-context";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Identity evidence comes only from the customer's text, never assistant replies or files. */
export function isConfirmedCustomerName(name: unknown, messages: TriageMessage[]): name is string {
  if (typeof name !== "string" || !/^[\p{L}][\p{L}\s'-]{1,79}$/u.test(name.trim())) return false;
  const candidate = escapeRegex(normalize(name));
  const identification = new RegExp(`(?:^|\\b)(?:me chamo|meu nome (?:e|eh)|pode me chamar de|aqui (?:e|eh)|sou (?:o |a )?)\\s*${candidate}(?=$|[\\s,.!;])`, "u");
  const directAnswer = new RegExp(`^${candidate}(?:[.!]|,.*)?$`, "u");
  for (const m of [...messages].reverse()) {
    if (m.role !== "user") continue;
    const text = normalize(m.content.replace(/\[[^\]]*\]/g, ""));
    if (/(?:me chamo|meu nome (?:e|eh)|pode me chamar de|aqui (?:e|eh)|sou (?:o |a )?(?!de\b|da\b|do\b))/u.test(text)) return identification.test(text);
    // "Anderson, tudo bem?" é o cliente chamando o atendente, não dizendo o próprio nome.
    const addressing = /,\s*(tudo bem|td bem|tudo certo|bom dia|boa tarde|boa noite|oi|ola|e ai|como vai|pode|voce|vc|consegue|me|preciso|quero|tem)\b|\?\s*$/u.test(text);
    if (directAnswer.test(text) && !addressing) return true;
  }
  return false;
}

/** Drop an unsupported greeting vocative before it reaches WhatsApp or history. */
export function guardCustomerGreeting(text: string, messages: TriageMessage[]): string {
  const greeted = text.replace(/^(\s*(?:bom dia|boa tarde|boa noite|olá|ola|oi))\s*,\s*([\p{L}][\p{L}\s'-]{1,79})([!.])/iu,
    (match, greeting: string, name: string, punctuation: string) =>
      isConfirmedCustomerName(name, messages) ? match : `${greeting}${punctuation}`);
  // Vocativo no começo de qualquer frase: "Tudo bem sim, Anderson!", "Sem problema, Anderson!".
  // O cliente costuma chamar o atendente pelo nome; a IA não pode devolver esse nome como se fosse do cliente.
  return greeted.replace(/(^|[.!?]\s+)([^.!?,\n]{1,30}),\s*(\p{Lu}[\p{Ll}]{2,})(?=\s*[!.?])/gu,
    (match, start: string, lead: string, name: string) =>
      isConfirmedCustomerName(name, messages) ? match : `${start}${lead}`);
}

/**
 * A Lia agradecia em toda mensagem ("Obrigada! ..."). Depois que ela já agradeceu uma vez na
 * conversa, tira o "Obrigada/Obrigado" do começo — salvo quando o cliente acabou de mandar
 * foto, áudio ou documento, ou na mensagem de encerramento (concluding).
 */
export function guardRepeatedThanks(text: string, messages: TriageMessage[], concluding = false): string {
  if (concluding) return text;
  const thanks = /^\s*(?:muito\s+)?obrigad[ao](?:\s+(?:pel[ao]s?|por)\b[^.!?\n]*)?(?:,\s*[\p{L}]+)?\s*[!.]\s*/iu;
  if (!thanks.test(text)) return text;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (lastUser && /\[(?:foto|imagem|áudio|audio|documento|v[ií]deo)\]/i.test(lastUser.content) && !/^\[(?:áudio|audio)\]\s*\S/i.test(lastUser.content)) return text;
  const alreadyThanked = messages.some((m) => m.role === "assistant" && /\bobrigad[ao]\b/i.test(m.content));
  if (!alreadyThanked) return text;
  const rest = text.replace(thanks, "").trim();
  if (!rest) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export const CUSTOMER_IDENTITY_RULE = `IDENTIDADE DO CLIENTE — regra obrigatória, inclusive sobre regras da empresa e exemplos:
- Só use um nome quando a própria pessoa se identificar explicitamente no texto desta conversa. Sem confirmação, cumprimente sem nome e pergunte como pode chamá-la quando necessário.
- Quando o cliente chama alguém pelo nome ("Anderson, tudo bem?"), ele está falando com a equipe da empresa: esse nome é do atendente, NUNCA do cliente. Não responda usando esse nome para o cliente e não finja ser essa pessoa; responda normalmente, sem nome (ex.: "Tudo bem sim, e com você?").
- Nome do proprietário, vendedor, atendente, assinatura, perfil/agenda do WhatsApp, exemplos, regras aprendidas e nomes de arquivos NÃO identificam a pessoa que está falando.
- Uma resposta anterior da assistente e dados coletados pela IA não são prova de identidade. Não repita um nome só porque você o usou antes.
- Se a pessoa corrigir o nome, respeite a identificação mais recente. Nunca invente nome, gênero ou tratamento.
- Em dados_coletados.nome registre somente o nome que o cliente informou para si; caso contrário, null.`;
