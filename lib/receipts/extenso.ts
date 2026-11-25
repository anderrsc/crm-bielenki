// Valor em reais por extenso (ex.: 4900.5 -> "quatro mil e novecentos reais e cinquenta centavos").
const UNITS = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function upTo999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const h = Math.floor(n / 100), rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (rest < 20) { if (rest) parts.push(UNITS[rest]); }
  else { parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? ` e ${UNITS[rest % 10]}` : "")); }
  return parts.join(" e ");
}

const SCALES: Array<[string, string]> = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];

function integerWords(n: number): string {
  if (n === 0) return "zero";
  const groups: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 1000)) groups.push(v % 1000);
  const words: Array<{ text: string; value: number }> = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    const [singular, plural] = SCALES[i];
    const base = i === 1 && g === 1 ? "" : upTo999(g);
    const scale = i === 0 ? "" : g === 1 ? singular : plural;
    words.push({ text: [base, scale].filter(Boolean).join(" "), value: g });
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda (ex.: mil e cem, dois mil e cinco).
  return words.map((w, idx) => {
    if (idx === 0) return w.text;
    const last = idx === words.length - 1;
    return (last && (w.value < 100 || w.value % 100 === 0) ? " e " : ", ").concat(w.text);
  }).join("").replace(/, /g, " ");
}

export function valorPorExtenso(value: number): string {
  const cents = Math.round(Math.abs(value) * 100);
  const reais = Math.floor(cents / 100), centavos = cents % 100;
  const parts: string[] = [];
  if (reais) {
    const millions = reais % 1_000_000 === 0 && reais >= 1_000_000;
    parts.push(`${integerWords(reais)}${millions ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) parts.push(`${integerWords(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return parts.length ? parts.join(" e ") : "zero real";
}
