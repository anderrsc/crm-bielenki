// Destinos externos configuraveis (ex.: URL da Evolution API) recebem
// telefone, texto e a chave da integracao: so HTTPS publico, nunca enderecos
// internos (localhost, rede privada, metadados da nuvem).
const PRIVADO = [
  /^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i,
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1\]?$/, /^\[?f[cd][0-9a-f]{2}:/i, /^\[?fe80:/i, /^\[?::ffff:/i,
];

export function safeExternalUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname;
  if (!host.includes(".") && !host.includes(":")) return null;
  if (PRIVADO.some((re) => re.test(host))) return null;
  return url.origin + url.pathname.replace(/\/+$/, "");
}
