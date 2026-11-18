// Conversa em que o cliente falou por último: ele está esperando resposta da equipe.
export function waitingSince(lastInbound?: string | null, lastMessage?: string | null): string | null {
  if (!lastInbound) return null;
  if (!lastMessage) return lastInbound;
  return Date.parse(lastInbound) >= Date.parse(lastMessage) - 2000 ? lastInbound : null;
}

/** "12 min", "3 h", "2 dias" — tempo de espera curto para a lista. */
export function waitingLabel(since: string, now = Date.now()): string | null {
  const min = Math.floor((now - Date.parse(since)) / 60_000);
  if (!Number.isFinite(min) || min < 10) return null;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 dia" : `${d} dias`;
}
