// Vigia da conexão do WhatsApp (Evolution). Às vezes a conexão fica "zumbi": o servidor diz que
// está conectado, mas parou de receber mensagens. Reiniciar a conexão resolve e o WhatsApp
// entrega o que ficou parado. Aqui só a decisão (sem rede), para testar.

export const STALE_MINUTES = 20;      // sem nenhum evento de mensagem por 20 min no expediente
export const RESTART_EVERY_MINUTES = 45; // no máximo um reinício a cada 45 min por número

/** Expediente em Brasília: segunda a sábado, 7h às 20h (fora disso o silêncio é normal). */
export function inBusinessHours(now: Date): boolean {
  const br = new Date(now.getTime() - 3 * 3600_000);
  const day = br.getUTCDay(), hour = br.getUTCHours();
  return day >= 1 && day <= 6 && hour >= 7 && hour < 20;
}

// Silêncio não prova que travou: com o teste ativo ok, só reinicia depois de 2 h sem nenhum evento
// (reserva para o caso de a conexão responder ao teste e mesmo assim não receber).
export const QUIET_FALLBACK_MINUTES = 120;
// Número principal (muito movimento no expediente): 30 min sem nenhum evento já indica conexão travada, mesmo que o teste ativo responda.
export const BUSY_QUIET_FALLBACK_MINUTES = 30;

/** "ok" = a conexão respondeu ao teste ativo; "failed" = não respondeu; undefined = sem teste. */
export type ProbeResult = "ok" | "failed";

/** Silêncio suficiente para desconfiar (e fazer o teste ativo). */
export function looksStale(input: { state: string; lastMessageEventAt: string | null; lastRestartAt: string | null; now: Date }): boolean {
  if (input.state !== "open" || !inBusinessHours(input.now)) return false;
  const min = (iso: string | null) => (iso ? (input.now.getTime() - Date.parse(iso)) / 60_000 : Infinity);
  return min(input.lastMessageEventAt) >= STALE_MINUTES && min(input.lastRestartAt) >= RESTART_EVERY_MINUTES;
}

/**
 * Só mensagem prova que o número está recebendo. Recibo de entrega/leitura, contato e conexão
 * continuam chegando com a conexão "surda" (inclusive recibos do que o próprio CRM envia).
 */
export function isMessageEvent(event: unknown): boolean {
  return ["messages.upsert", "MESSAGES_UPSERT"].includes(String(event ?? ""));
}

/** O horário mais recente entre os informados (ignora vazios). */
export function latestIso(...values: Array<string | null | undefined>): string | null {
  return values.filter((v): v is string => !!v).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

// Alerta "não voltou": silêncio no expediente mesmo depois de reiniciar. O número principal tem
// movimento constante; os outros podem passar horas sem mensagem num dia normal.
export const DEAF_ALERT_MINUTES = 75;
export const DEAF_ALERT_MINUTES_QUIET = 240;

/**
 * Conectado, mas sem receber mesmo depois de um reinício: devolve desde quando (para avisar a
 * equipe que é preciso ler o QR de novo), ou null. A madrugada não conta: o silêncio é medido a
 * partir das 7h de Brasília.
 */
export function deafSince(input: { state: string; lastMessageAt: string | null; lastRestartAt: string | null; isDefault: boolean; now: Date }): string | null {
  if (input.state !== "open" || !inBusinessHours(input.now) || !input.lastRestartAt) return null;
  const br = new Date(input.now.getTime() - 3 * 3600_000);
  const opened = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate(), 10); // 7h em Brasília
  const since = Math.max(input.lastMessageAt ? Date.parse(input.lastMessageAt) : 0, opened);
  if (Date.parse(input.lastRestartAt) < since) return null; // ainda não houve reinício neste silêncio
  const limit = input.isDefault ? DEAF_ALERT_MINUTES : DEAF_ALERT_MINUTES_QUIET;
  if ((input.now.getTime() - since) / 60_000 < limit) return null;
  return input.lastMessageAt ?? new Date(opened).toISOString();
}

/** Aviso para a tela: número sem conexão ou conectado sem receber. */
export function channelAlert(input: { state: string | null; lastMessageAt: string | null; lastRestartAt: string | null; isDefault: boolean; now: Date }): string | null {
  // "migrado" e vazio: a rotina ainda não conferiu o número.
  if (input.state && ["close", "connecting", "unreachable", "desconectado"].includes(input.state)) return "sem conexão com o WhatsApp";
  return deafSince({ ...input, state: input.state ?? "" }) ? "sem receber mensagens" : null;
}

export function shouldRestart(input:{ state: string; lastMessageEventAt: string | null; lastRestartAt: string | null; now: Date; probe?: ProbeResult; quietFallbackMinutes?: number }): boolean {
  if (!looksStale(input)) return false;
  if (input.probe !== "ok") return true;
  const min = (iso: string | null) => (iso ? (input.now.getTime() - Date.parse(iso)) / 60_000 : Infinity);
  const quiet = input.quietFallbackMinutes ?? QUIET_FALLBACK_MINUTES;
  return min(input.lastMessageEventAt) >= quiet && min(input.lastRestartAt) >= Math.max(quiet, RESTART_EVERY_MINUTES);
}
