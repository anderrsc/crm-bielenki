import { expect, test } from "vitest";
import { inBusinessHours, shouldRestart } from "@/lib/whatsapp/watchdog";

// 19/11/2026 é quinta-feira. Horários em UTC (Brasília = UTC−3).
const at = (iso: string) => new Date(iso);
const base = { state: "open", lastRestartAt: null as string | null };

test("conexão aberta sem mensagens há 20 min no expediente: reinicia", () => {
  // Caso real: última mensagem 15:40, conferido 16:26 (Brasília).
  expect(shouldRestart({ ...base, lastMessageEventAt: "2026-11-19T18:40:00Z", now: at("2026-11-19T19:26:00Z") })).toBe(true);
  expect(shouldRestart({ ...base, lastMessageEventAt: "2026-11-19T19:10:00Z", now: at("2026-11-19T19:26:00Z") })).toBe(false);
});

test("não reinicia fora do expediente, desconectado, nem duas vezes em 45 min", () => {
  const parado = "2026-11-19T10:00:00Z";
  expect(shouldRestart({ ...base, lastMessageEventAt: parado, now: at("2026-11-19T23:30:00Z") })).toBe(false); // 20:30 BR
  expect(shouldRestart({ ...base, lastMessageEventAt: parado, now: at("2026-11-22T15:00:00Z") })).toBe(false); // domingo
  expect(shouldRestart({ ...base, state: "close", lastMessageEventAt: parado, now: at("2026-11-19T15:00:00Z") })).toBe(false);
  expect(shouldRestart({ ...base, lastRestartAt: "2026-11-19T14:30:00Z", lastMessageEventAt: parado, now: at("2026-11-19T15:00:00Z") })).toBe(false);
  expect(shouldRestart({ ...base, lastRestartAt: "2026-11-19T14:00:00Z", lastMessageEventAt: parado, now: at("2026-11-19T15:00:00Z") })).toBe(true);
  expect(shouldRestart({ ...base, lastMessageEventAt: null, now: at("2026-11-19T15:00:00Z") })).toBe(true);
});

test("expediente: segunda a sábado, 7h às 20h de Brasília", () => {
  expect(inBusinessHours(at("2026-11-19T10:00:00Z"))).toBe(true);  // qui 07:00
  expect(inBusinessHours(at("2026-11-19T09:59:00Z"))).toBe(false); // qui 06:59
  expect(inBusinessHours(at("2026-11-19T22:59:00Z"))).toBe(true);  // qui 19:59
  expect(inBusinessHours(at("2026-11-19T23:00:00Z"))).toBe(false); // qui 20:00
  expect(inBusinessHours(at("2026-11-21T14:00:00Z"))).toBe(true);  // sáb
  expect(inBusinessHours(at("2026-11-22T14:00:00Z"))).toBe(false); // dom
});

test("teste ativo: conexão que responde não é reiniciada só pelo silêncio (reserva de 2 h)", () => {
  // Caso real de 23/11: Número da Calha reiniciado 3 vezes num dia calmo.
  const now = at("2026-11-23T16:00:00Z"); // seg 13:00 BR
  expect(shouldRestart({ ...base, lastMessageEventAt: "2026-11-23T15:30:00Z", now, probe: "ok" })).toBe(false);
  expect(shouldRestart({ ...base, lastMessageEventAt: "2026-11-23T15:30:00Z", now, probe: "failed" })).toBe(true);
  // Mais de 2 h sem nenhum evento, mesmo respondendo ao teste: reinicia (reserva).
  expect(shouldRestart({ ...base, lastMessageEventAt: "2026-11-23T13:50:00Z", now, probe: "ok" })).toBe(true);
  expect(shouldRestart({ ...base, lastMessageEventAt: "2026-11-23T13:50:00Z", lastRestartAt: "2026-11-23T15:00:00Z", now, probe: "ok" })).toBe(false);
});
