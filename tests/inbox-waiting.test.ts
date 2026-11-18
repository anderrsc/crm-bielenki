import { expect, test } from "vitest";
import { waitingLabel, waitingSince } from "@/lib/inbox-waiting";

test("cliente falou por último = esperando resposta", () => {
  expect(waitingSince("2026-11-18T10:00:00Z", "2026-11-18T10:00:00Z")).toBe("2026-11-18T10:00:00Z");
  expect(waitingSince("2026-11-18T10:00:00Z", "2026-11-18T10:05:00Z")).toBeNull();
  expect(waitingSince(null, "2026-11-18T10:05:00Z")).toBeNull();
  expect(waitingSince("2026-11-18T10:00:00Z", null)).toBe("2026-11-18T10:00:00Z");
});

test("tempo de espera curto para a lista", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  expect(waitingLabel("2026-11-18T11:55:00Z", now)).toBeNull();
  expect(waitingLabel("2026-11-18T11:30:00Z", now)).toBe("30 min");
  expect(waitingLabel("2026-11-18T09:00:00Z", now)).toBe("3 h");
  expect(waitingLabel("2026-11-17T11:00:00Z", now)).toBe("1 dia");
  expect(waitingLabel("2026-11-15T11:00:00Z", now)).toBe("3 dias");
});
