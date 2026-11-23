// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(crm)/whatsapp-channel-actions", () => ({}));
import { HealthDashboard } from "@/components/whatsapp-channels";

// Auditoria do WhatsApp (23/11/2026): o painel mostra, por número, o teste ativo do vigia, a
// configuração do webhook na Evolution e os envios com falha/sem confirmação.
test("painel de saúde por número", () => {
  const html = renderToStaticMarkup(<HealthDashboard summary={[
    { channel_id: "a", channel_name: "WhatsApp principal", current_status: "open", last_connection_event: "open", last_connection_event_at: "2026-11-23T16:00:00Z", events_last_24h: 10, errors_last_24h: 0,
      probe: { ok: true, at: "2026-11-23T15:40:00Z" }, webhook: { ok: true, problems: null, at: "2026-11-23T16:00:00Z" }, failed_24h: 0, unknown_24h: 0 },
    { channel_id: "b", channel_name: "Número da Calha", current_status: "open", last_connection_event: "open", last_connection_event_at: "2026-11-23T16:00:00Z", events_last_24h: 4, errors_last_24h: 1,
      probe: { ok: false, at: "2026-11-23T15:58:00Z" }, webhook: { ok: false, problems: "webhook desligado", at: "2026-11-23T16:00:00Z" }, failed_24h: 1, unknown_24h: 2 },
  ]} />);
  expect(html).toContain("Teste de conexão: <span class=\"text-green-600\">respondeu (23/11, 12:40)");
  expect(html).toContain("não respondeu (23/11, 12:58)");
  expect(html).toContain("com problema (webhook desligado)");
  expect(html).toContain("1 com falha · 2 sem confirmação do WhatsApp");
  // Número sem problema não mostra a linha de envios.
  expect(html.match(/Envios nas últimas 24 h/g)).toHaveLength(1);
});
