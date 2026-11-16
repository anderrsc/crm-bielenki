/** Máscaras de apresentação; não validam nem trocam os dígitos informados. */
export function formatBrazilianPhone(value: string): string {
  if (!value || /[a-z;#]/i.test(value)) return value;
  let digits = value.replace(/\D/g, "");
  let country = "";
  if (/^\s*\+/.test(value)) {
    if (!/^\s*\+55\D/.test(value) && !/^\s*\+55\d{10,11}$/.test(value)) return value;
    country = "+55 "; digits = digits.slice(2);
  } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    country = "+55 "; digits = digits.slice(2);
  }
  if (!digits || digits.length > 11) return value;
  if (digits.length < 2) return `${country}(${digits}`;
  const area = `(${digits.slice(0, 2)})`;
  const local = digits.slice(2);
  if (!local) return country + area;
  const first = digits.length > 10 ? 5 : 4;
  return `${country}${area} ${local.slice(0, first)}${local.length > first ? `-${local.slice(first)}` : ""}`;
}

export function formatBrazilianTaxId(value: string, kind: "cpf" | "cnpj" | "both" = "both"): string {
  if (!value || /^(isento|isenta)$/i.test(value.trim())) return value;
  const raw = value.replace(/[.\/\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]*$/.test(raw) || raw.length > 14) return value;
  const cnpj = kind === "cnpj" || (kind !== "cpf" && (raw.length > 11 || /[A-Z]/.test(raw)));
  if (!cnpj && raw.length > 11) return value;
  if (!cnpj && /[A-Z]/.test(raw)) return value;
  const groups = cnpj ? [2, 3, 3, 4, 2] : [3, 3, 3, 2];
  const separators = cnpj ? [".", ".", "/", "-"] : [".", ".", "-"];
  let result = "", offset = 0;
  for (let i = 0; i < groups.length && offset < raw.length; i++) {
    if (i) result += separators[i - 1];
    result += raw.slice(offset, offset + groups[i]);
    offset += groups[i];
  }
  return result;
}

const lowerWords = new Set(["da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "para", "por"]);
const acronyms = new Set(["PVC", "MDF", "MDP", "ACM", "LED", "ME", "MEI", "EPP", "EIRELI", "S.A", "SC", "PR", "RS", "SP", "RJ", "II", "III", "IV", "VI", "VII", "VIII", "IX", "BMW", "LG", "HP"]);
export function formatRegistrationName(value: string): string {
  let index = 0;
  return value.trim().replace(/\s+/g, " ").replace(/[\p{L}\p{M}\d]+/gu, word => {
    const upper = word.toLocaleUpperCase("pt-BR");
    const lower = word.toLocaleLowerCase("pt-BR");
    const first = index++ === 0;
    if (/\d/.test(word)) return word;
    if (acronyms.has(upper)) return upper;
    if (!first && lowerWords.has(lower)) return lower;
    // Mantém marcas que já usam maiúsculas internas, como iPhone.
    if (word !== upper && word !== lower && /[a-zá-úç][A-ZÁ-ÚÇ]/.test(word)) return word;
    return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
  });
}

export function registrationTextKind(name: string, label = ""): "name" | "email" | null {
  if (/^(email|contact_email)$/.test(name)) return "email";
  if (/^(name|full_name|trade_name|legal_name|company_name|client_name|supplier_name|city|neighborhood|address|street)$/.test(name)
    || /^(nome|nome do cliente|razão social|cidade|bairro)$/i.test(label)) return "name";
  return null;
}

/** Normaliza somente campos de cadastro; preserva senha, códigos, observações e arquivos. */
export function normalizeRegistrationForm(form: FormData): FormData {
  for (const [name, value] of form.entries()) {
    if (typeof value !== "string") continue;
    const kind = brazilianFieldKind(name);
    const text = registrationTextKind(name);
    if (kind) form.set(name, kind === "phone" ? formatBrazilianPhone(value) : formatBrazilianTaxId(value, kind));
    else if (text) form.set(name, text === "email" ? value.trim().toLocaleLowerCase("pt-BR") : formatRegistrationName(value));
  }
  return form;
}

export function brazilianFieldKind(name: string, type = "", label = ""): "phone" | "cpf" | "cnpj" | "both" | null {
  const key = name.toLowerCase();
  if (type === "tel" || /(?:^|_)(phone|telefone|whatsapp|celular|mobile)$/.test(key) || /^(telefone|whatsapp|celular)(\s|$)/i.test(label)) return "phone";
  if (key === "cpf") return "cpf";
  if (key === "cnpj") return "cnpj";
  if (/(?:^|_)(tax_id|cpf_cnpj|cnpj_cpf)$/.test(key) || /^(cpf\s*\/\s*cnpj|cnpj\s*\/\s*cpf)$/i.test(label)) return "both";
  return null;
}
