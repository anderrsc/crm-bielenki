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

export function shouldRestart(input: { state: string; lastMessageEventAt: string | null; lastRestartAt: string | null; now: Date }): boolean {
  if (input.state !== "open" || !inBusinessHours(input.now)) return false;
  const min = (iso: string | null) => (iso ? (input.now.getTime() - Date.parse(iso)) / 60_000 : Infinity);
  return min(input.lastMessageEventAt) >= STALE_MINUTES && min(input.lastRestartAt) >= RESTART_EVERY_MINUTES;
}
