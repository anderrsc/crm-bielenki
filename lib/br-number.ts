// Numero digitado no padrao brasileiro: "1.500", "1.500,00", "R$ 1500", "12,5", "0.5".
// Devolve null quando nao e numero (nunca vira 0 em silencio).
export function parseBRNumber(value: unknown): number | null {
  let raw = String(value ?? "").replace(/R\$|\s/gi, "").trim();
  if (!raw) return null;
  if (raw.includes(",")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) {
    // "1.500" / "12.000.000": ponto de milhar
    raw = raw.replace(/\./g, "");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
