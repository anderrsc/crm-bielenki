// Rotas de API que nao dependem de navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE } from "./helpers.mjs";

const VERIFY = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "token-verificacao-teste";

test("webhook do WhatsApp nao exige login (nao redireciona para /login)", async () => {
  const res = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123`, { redirect: "manual" });
  assert.equal(res.status, 403, `esperado 403 do proprio webhook, veio ${res.status} ${res.headers.get("location") ?? ""}`);
});

test("webhook responde o challenge com o token configurado", async () => {
  const res = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY)}&hub.challenge=abc123`, { redirect: "manual" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "abc123");
});

test("token padrao antigo do codigo nao e mais aceito", async () => {
  const res = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=marquinhos-crm-verify&hub.challenge=x`, { redirect: "manual" });
  assert.equal(res.status, 403);
});

test("POST do webhook sem assinatura e recusado", async () => {
  const res = await fetch(`${BASE}/api/whatsapp/webhook`, {
    method: "POST", redirect: "manual", headers: { "content-type": "application/json" },
    body: JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "5547999990000", text: { body: "oi" } }] } }] }] }),
  });
  assert.ok([401, 403].includes(res.status), `esperado 401/403, veio ${res.status}`);
});

test("PDF de orcamento exige login", async () => {
  const res = await fetch(`${BASE}/api/orcamentos/00000000-0000-0000-0000-000000000000/pdf`, { redirect: "manual" });
  assert.ok(res.status === 307 || res.status === 302 || res.status === 401, `veio ${res.status}`);
});
