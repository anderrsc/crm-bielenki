/** Only a fresh, explicitly timestamped customer event can start an AI reply.
 * Reconnect/history events still enter the inbox, with their original date. */
export function inboundTiming(timestamp: unknown, now = Date.now()) {
  const seconds = Number(timestamp);
  const ms = seconds * 1000;
  const valid = Number.isFinite(ms) && ms > 0 && ms < 8.64e15;
  return {
    at: valid ? new Date(ms).toISOString() : new Date(now).toISOString(),
    live: valid && now - ms >= -30_000 && now - ms <= 120_000,
  };
}
