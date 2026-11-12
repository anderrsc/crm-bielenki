// Pix "copia e cola" (BR Code estático do Banco Central) e a mensagem de cobrança.

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Nome e cidade no BR Code: sem acento, só letras/números/espaço, tamanho limitado.
const plain = (s: string, max: number) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Chave como o Pix espera: telefone +55…, CPF/CNPJ só números, e-mail minúsculo, aleatória como está. */
export function normalizePixKey(raw: string): string {
  const key = raw.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return key.toLowerCase();
  if (key.includes("@")) return key.toLowerCase();
  const digits = key.replace(/\D/g, "");
  if (key.startsWith("+")) return `+${digits}`;
  if (/[.\-/]/.test(key) && (digits.length === 11 || digits.length === 14) && !/\(/.test(key)) return digits; // CPF/CNPJ com pontuação
  if (/\(|\)/.test(key) || (digits.length === 11 && digits[2] === "9" && !/^\d{11}$/.test(key))) return `+55${digits}`; // celular
  // 11 digitos sem mascara: so e CPF se os digitos verificadores baterem; senao, celular.
  if (/^\d{11}$/.test(key) && digits[2] === "9" && !validCpf(digits)) return `+55${digits}`;
  return digits.length ? digits : key;
}

export function validCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
}

export function pixCopiaECola(input: { key: string; name: string; city: string; amount: number; txid?: string }): string {
  const amount = Math.round(input.amount * 100) / 100;
  const account = field("00", "br.gov.bcb.pix") + field("01", normalizePixKey(input.key));
  const txid = (input.txid ?? "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const body =
    field("00", "01") +
    field("26", account) +
    field("52", "0000") +
    field("53", "986") +
    (amount > 0 ? field("54", amount.toFixed(2)) : "") +
    field("58", "BR") +
    field("59", plain(input.name, 25) || "Recebedor") +
    field("60", plain(input.city, 15) || "Jaragua do Sul") +
    field("62", field("05", txid)) +
    "6304";
  return body + crc16(body);
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function pixChargeMessage(input: { firstName?: string | null; amount: number; percent: number | null; what: string; key: string; holder: string }): string {
  const parte = input.percent === 50 ? "da entrada (50%)" : input.percent === 100 ? "do valor total" : "";
  const saud = input.firstName ? `${input.firstName}, segue` : "Segue";
  return [
    `${saud} os dados para o Pix ${parte}${input.what ? ` referente a ${input.what}` : ""}:`.replace(/\s+:/, ":").replace(/Pix\s+referente/, "Pix referente"),
    "",
    `Valor: ${brl(input.amount)}`,
    `Chave Pix: ${input.key}`,
    `Favorecido: ${input.holder}`,
    "",
    "Logo abaixo vai o código Pix copia e cola, já com o valor. Depois é só me enviar o comprovante por aqui.",
  ].join("\n");
}
