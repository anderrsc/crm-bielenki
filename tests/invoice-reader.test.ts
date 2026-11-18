import { afterEach, expect, test, vi } from "vitest";
import { guessType, invoiceItems, invoiceSchema, readInvoiceWithAi } from "@/lib/ai/invoice-reader";

afterEach(() => vi.unstubAllGlobals());

test("itens da nota viram itens da compra com tipo e unitário coerentes", () => {
  const data = invoiceSchema.parse({
    fornecedor: { nome: "Petry Distribuidora", cnpj: "12.345.678/0001-90" }, numero_nota: "1234", data_emissao: "2026-11-10",
    itens: [
      { descricao: "PERFIL SU-001 BRANCO 6M", quantidade: "10", unidade: "BR", valor_unitario: "45,90", valor_total: "459,00", tipo: "Perfil" },
      { descricao: "Parafuso 4,2x13", quantidade: 0, valor_unitario: null, valor_total: 30, tipo: "xyz" },
      { descricao: "  ", quantidade: 1, valor_unitario: 1, valor_total: 1, tipo: "Outro" },
    ],
    valor_total: 489, vencimentos: [{ data: "2026-12-10", valor: 489 }, { data: "data ruim", valor: 1 }],
  });
  expect(invoiceItems(data)).toEqual([
    { category: "Perfil", description: "PERFIL SU-001 BRANCO 6M", quantity: 10, unit_price: 45.9 },
    { category: "Acessório", description: "Parafuso 4,2x13", quantity: 1, unit_price: 30 },
  ]);
  expect(data.vencimentos[1].data).toBeNull();
  expect(guessType("Bobina alumínio 0,5mm")).toBe("Alumínio bobina");
  expect(guessType("Tubo PVC 100mm")).toBe("Cano");
});

test("PDF vai como arquivo e foto como imagem para a IA; erro de chave é claro", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fornecedor: { nome: "X", cnpj: null }, itens: [{ descricao: "Cano", quantidade: 2, valor_unitario: 5, valor_total: 10, tipo: "Cano" }], vencimentos: [] }) } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const r = await readInvoiceWithAi({ name: "n.pdf", type: "application/pdf", base64: "AAA" }, "k");
  expect(r.itens).toHaveLength(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.messages[0].content[1].type).toBe("file");
  await readInvoiceWithAi({ name: "n.jpg", type: "image/jpeg", base64: "AAA" }, "k");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content[1].type).toBe("image_url");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 401 })));
  await expect(readInvoiceWithAi({ name: "n.jpg", type: "image/jpeg", base64: "AAA" }, "k")).rejects.toThrow(/Chave da OpenAI/);
});

test("Gemini recebe o arquivo inline e cai no modelo alternativo se o primeiro não existir", async () => {
  const { readInvoiceWithGemini } = await import("@/lib/ai/invoice-reader");
  const ok = { candidates: [{ content: { parts: [{ text: '```json\n{"fornecedor":{"nome":"Y","cnpj":null},"itens":[{"descricao":"Perfil","quantidade":1,"valor_unitario":10,"valor_total":10,"tipo":"Perfil"}],"vencimentos":[]}\n```' }] } }] };
  const fetchMock = vi.fn()
    .mockImplementationOnce(async () => new Response("nope", { status: 404 }))
    .mockImplementationOnce(async () => new Response(JSON.stringify(ok), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const r = await readInvoiceWithGemini({ name: "n.pdf", type: "application/pdf", base64: "AAA" }, "k");
  expect(r.itens[0].descricao).toBe("Perfil");
  expect(fetchMock.mock.calls[1][0]).toContain("gemini-flash-latest");
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: "application/pdf", data: "AAA" });
});

test("Claude Haiku lê PDF como documento e devolve os itens", async () => {
  const { readInvoiceWithClaude } = await import("@/lib/ai/invoice-reader");
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "text", text: 'Aqui está: {"fornecedor":{"nome":"Z","cnpj":"1"},"itens":[{"descricao":"Bobina","quantidade":1,"valor_unitario":900,"valor_total":900,"tipo":"Alumínio bobina"}],"vencimentos":[]}' }],
  }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const r = await readInvoiceWithClaude({ name: "n.pdf", type: "application/pdf", base64: "AAA" }, "sk-ant-test");
  expect(r.itens[0].tipo).toBe("Alumínio bobina");
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.model).toBe("claude-haiku-5-5");
  expect(body.messages[0].content[0].type).toBe("document");
});
