// Traduz mensagens tecnicas do banco/servidor para portugues claro.
const RULES: Array<[RegExp, string]> = [
  [/duplicate key|unique_violation|23505/i, "Já existe um registro com esses dados."],
  [/violates foreign key|23503/i, "Este registro está ligado a outros dados e não pode ser alterado ou removido."],
  [/violates not-null|null value in column/i, "Preencha os campos obrigatórios."],
  [/row-level security|permission denied|42501/i, "Você não tem permissão para fazer isso."],
  [/JWT|session.*expired|refresh token/i, "Sessão expirada. Entre novamente."],
  [/invalid input syntax for type (date|timestamp)|date\/time field value out of range|22008|22007/i, "Data inválida. Confira dia, mês e ano."],
  [/invalid input syntax for type uuid/i, "Registro inválido. Atualize a página e tente de novo."],
  [/invalid input syntax for type (numeric|integer|bigint|double)|22P02/i, "Número inválido. Use apenas números e vírgula."],
  [/violates check constraint/i, "Algum valor está fora do permitido. Confira os campos."],
  [/value too long/i, "Algum texto está longo demais."],
  [/fetch failed|ECONNRESET|ETIMEDOUT|network/i, "Falha de conexão. Tente novamente."],
];

// Mensagem técnica sem tradução (estrutura do banco, SQL, PostgREST): não mostra ao usuário.
const TECNICA = /relation "|column "|function [\w.]+\(|syntax error|schema cache|PGRST\d|\bSQLSTATE\b|operator does not exist|could not find|stack|at [\w.]+ \(|TypeError|ReferenceError|Unexpected token|ECONNREFUSED/i;
export const GENERIC_ERROR = "Não foi possível concluir. Tente novamente ou avise o suporte.";

export function friendlyError(msg?: string | null): string | undefined {
  if (!msg) return msg ?? undefined;
  for (const [re, text] of RULES) if (re.test(msg)) return text;
  if (TECNICA.test(msg)) {
    console.error("Erro técnico ocultado do usuário:", msg.slice(0, 500));
    return GENERIC_ERROR;
  }
  return msg;
}
