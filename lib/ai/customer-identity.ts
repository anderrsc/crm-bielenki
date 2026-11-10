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
    if (directAnswer.test(text)) return true;
  }
  return false;
}

/** Drop an unsupported greeting vocative before it reaches WhatsApp or history. */
export function guardCustomerGreeting(text: string, messages: TriageMessage[]): string {
  return text.replace(/^(\s*(?:bom dia|boa tarde|boa noite|olá|ola|oi))\s*,\s*([\p{L}][\p{L}\s'-]{1,79})([!.])/iu,
    (match, greeting: string, name: string, punctuation: string) =>
      isConfirmedCustomerName(name, messages) ? match : `${greeting}${punctuation}`);
}

export const CUSTOMER_IDENTITY_RULE = `IDENTIDADE DO CLIENTE — regra obrigatória, inclusive sobre regras da empresa e exemplos:
- Só use um nome quando a própria pessoa se identificar explicitamente no texto desta conversa. Sem confirmação, cumprimente sem nome e pergunte como pode chamá-la quando necessário.
- Nome do proprietário, vendedor, atendente, assinatura, perfil/agenda do WhatsApp, exemplos, regras aprendidas e nomes de arquivos NÃO identificam a pessoa que está falando.
- Uma resposta anterior da assistente e dados coletados pela IA não são prova de identidade. Não repita um nome só porque você o usou antes.
- Se a pessoa corrigir o nome, respeite a identificação mais recente. Nunca invente nome, gênero ou tratamento.
- Em dados_coletados.nome registre somente o nome que o cliente informou para si; caso contrário, null.`;
