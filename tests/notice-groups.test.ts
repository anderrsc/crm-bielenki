import { expect, test } from "vitest";
import { groupNotices, isUrgentNotice } from "@/lib/notice-groups";

const n = (id: string, title: string, read = false) => ({ id, title, body: "x", link: "/a", read_at: read ? "2026-11-19" : null });

test("urgente separa de informativo e sobe para o topo", () => {
  expect(isUrgentNotice("Cliente sem resposta há mais de 2 horas")).toBe(true);
  expect(isUrgentNotice("WhatsApp desconectado")).toBe(true);
  expect(isUrgentNotice("Conversa transferida para você")).toBe(false);
  const g = groupNotices([n("1", "Conversa transferida para você"), n("2", "Cliente sem resposta há mais de 2 horas")]);
  expect(g.map((x) => x.urgent)).toEqual([true, false]);
});

test("avisos repetidos viram um grupo com contagem de não lidos", () => {
  const g = groupNotices([n("1", "Orçamento sem resposta há 3 dias"), n("2", "Orçamento sem resposta há 3 dias", true), n("3", "Orçamento sem resposta há 3 dias")]);
  expect(g).toHaveLength(1);
  expect([g[0].items.length, g[0].unread]).toEqual([3, 2]);
});

test("grupos já lidos ficam depois dos não lidos", () => {
  const g = groupNotices([n("1", "Aviso lido", true), n("2", "Aviso novo")]);
  expect(g.map((x) => x.title)).toEqual(["Aviso novo", "Aviso lido"]);
});
