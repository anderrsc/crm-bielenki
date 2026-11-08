// Comparação de telefones vindos do WhatsApp (5547999990000) com os do cadastro
// ("(47) 99999-0000"). Chave = DDD + 8 últimos dígitos, ignorando o 9 extra.

export const digitsOnly = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

export function phoneKey(value: string | null | undefined): string {
  let d = digitsOnly(value);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10) return d;
  return d.slice(0, 2) + d.slice(-8);
}

export const samePhone = (a: string | null | undefined, b: string | null | undefined) => {
  const ka = phoneKey(a);
  return ka.length >= 10 && ka === phoneKey(b);
};

/** Formata 5547999990000 como (47) 99999-0000 para o cadastro. */
export function formatBrPhone(value: string): string {
  let d = digitsOnly(value);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return value;
}
