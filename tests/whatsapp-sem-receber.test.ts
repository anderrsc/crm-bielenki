import { expect, test } from "vitest";
import { channelAlert, deafSince, isMessageEvent, latestIso } from "@/lib/whatsapp/watchdog";

// Incidente de 27/11/2026: o número principal parou de receber às 07:45 (Brasília), seguia
// "Conectado", o reinício não resolveu e ninguém foi avisado de que precisava ler o QR.
const at = (br: string, day = "2026-11-27") => new Date(`${day}T${br}:00-03:00`);
const iso = (br: string, day?: string) => at(br, day).toISOString();
const principal = { state: "open", isDefault: true, lastMessageAt: iso("07:45"), lastRestartAt: iso("08:16") };

test("só mensagem conta como sinal de que o número está recebendo", () => {
  expect(isMessageEvent("messages.upsert")).toBe(true);
  expect(isMessageEvent("MESSAGES_UPSERT")).toBe(true);
  // Recibos do que o CRM envia mantinham o vigia achando que estava tudo bem.
  for (const e of ["messages.update", "contacts.update", "connection.update", "send.message", "", undefined]) expect(isMessageEvent(e)).toBe(false);
});

test("avisa quando o reinício não trouxe as mensagens de volta", () => {
  expect(deafSince({ ...principal, now: at("08:50") })).toBeNull(); // 65 min: ainda cedo
  expect(deafSince({ ...principal, now: at("09:00") })).toBe(iso("07:45"));
  expect(deafSince({ ...principal, now: at("10:29"), lastRestartAt: iso("10:28") })).toBe(iso("07:45"));
});

test("sem alarme falso: sem reinício, desconectado, mensagem recente ou fora do expediente", () => {
  const now = at("10:00");
  expect(deafSince({ ...principal, now, lastRestartAt: null })).toBeNull();
  expect(deafSince({ ...principal, now, lastRestartAt: iso("07:30") })).toBeNull();
  expect(deafSince({ ...principal, now, state: "close" })).toBeNull();
  expect(deafSince({ ...principal, now, lastMessageAt: iso("09:55") })).toBeNull();
  expect(deafSince({ ...principal, now: at("21:00") })).toBeNull();
});

test("a madrugada não conta: o silêncio começa a valer às 7h", () => {
  const night = { ...principal, lastMessageAt: iso("19:50", "2026-11-26"), lastRestartAt: iso("07:00") };
  expect(deafSince({ ...night, now: at("07:01") })).toBeNull();
  expect(deafSince({ ...night, now: at("08:15") })).toBe(night.lastMessageAt);
});

test("número com pouco movimento só avisa depois de 4 h", () => {
  const calha = { ...principal, isDefault: false };
  expect(deafSince({ ...calha, now: at("11:00") })).toBeNull();
  expect(deafSince({ ...calha, now: at("11:45") })).toBe(iso("07:45"));
});

test("aviso da tela e horário mais recente", () => {
  const now = at("10:00");
  expect(channelAlert({ ...principal, now })).toBe("sem receber mensagens");
  expect(channelAlert({ ...principal, now, state: "close" })).toBe("sem conexão com o WhatsApp");
  expect(channelAlert({ ...principal, now, state: "migrado", lastRestartAt: null })).toBeNull();
  expect(channelAlert({ ...principal, now, lastMessageAt: iso("09:59") })).toBeNull();
  expect(latestIso(null, "2026-11-27T10:00:00+00:00", "2026-11-27T10:00:01Z", undefined)).toBe("2026-11-27T10:00:01Z");
  expect(latestIso(null, undefined)).toBeNull();
});
