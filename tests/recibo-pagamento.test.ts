import { expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { valorPorExtenso } from "@/lib/receipts/extenso";
import { renderReceiptHtml, type ReceiptData } from "@/lib/receipts/receipt-html";
import { clientDocument, whatsappNumber } from "@/lib/receipts/receipt-data";

test("valor por extenso", () => {
  expect(valorPorExtenso(4900)).toBe("quatro mil e novecentos reais");
  expect(valorPorExtenso(2000)).toBe("dois mil reais");
  expect(valorPorExtenso(1250.5)).toBe("mil duzentos e cinquenta reais e cinquenta centavos");
  expect(valorPorExtenso(1)).toBe("um real");
  expect(valorPorExtenso(0.01)).toBe("um centavo");
  expect(valorPorExtenso(15000)).toBe("quinze mil reais");
  expect(valorPorExtenso(100)).toBe("cem reais");
  expect(valorPorExtenso(101)).toBe("cento e um reais");
  expect(valorPorExtenso(1100)).toBe("mil e cem reais");
  expect(valorPorExtenso(2005)).toBe("dois mil e cinco reais");
  expect(valorPorExtenso(1_000_000)).toBe("um milhão de reais");
  expect(valorPorExtenso(1_234_567.89)).toBe("um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais e oitenta e nove centavos");
});

test("documento e telefone do cliente", () => {
  expect(clientDocument("123.456.789-01")).toEqual({ label: "CPF", value: "***.456.789-**" });
  expect(clientDocument("26887887000175")).toEqual({ label: "CNPJ", value: "26.887.887/0001-75" });
  expect(clientDocument(null).value).toBe("");
  expect(whatsappNumber(null, "(47) 99698-0082")).toBe("5547996980082");
  expect(whatsappNumber("123")).toBeNull();
});

const base: ReceiptData = {
  receiptNumber: "000184", issuedAt: "2026-11-25T11:41:12Z", paidAt: "2026-11-25", paymentCreatedAt: "2026-11-25T11:41:12Z", method: "Pix",
  account: "Sicoob · Pix CNPJ", operator: "Anderson", quoteNumber: "ORC-2026-01942", orderNumber: "1942", saleNumber: "V-1942", reference: "Pedido 1942",
  company: { name: "Marquinhos Calhas e Esquadrias", taxId: "26.887.887/0001-75", address: "Rua Ingrácia da Rosa, 92, Rau, Jaraguá do Sul/SC", cityUf: "Jaraguá do Sul/SC", phone: "(47) 3058-4839", whatsapp: "(47) 99696-0340", email: "calhasmarcosluiz@gmail.com", website: "", qrLabel: "Nosso portfólio" },
  client: { name: "Mariana <Souza>", document: "***.456.789-**", documentLabel: "CPF", phone: "(47) 99698-0082", city: "Jaraguá do Sul - SC" },
  items: [{ description: "Calha de alumínio sob medida", detail: "0,7 mm - corte 40", unit: "m", quantity: 30, total: 5400 }, { description: "Rufo de alumínio", unit: "m", quantity: 15, total: 1500 }],
  gross: 6900, discount: 0, interest: 0, net: 6900, paidBefore: 2000, amount: 4900, balance: 0, amountInWords: "quatro mil e novecentos reais", notes: null,
};

test("recibo: sem valor unitário, escapa texto, mostra quitado ou parcial", () => {
  const html = renderReceiptHtml(base, { logoDataUri: "data:,", qrDataUri: null, fontFaces: "" });
  expect(html).not.toMatch(/Valor unit/i);
  expect(html).toContain("Mariana &lt;Souza&gt;");
  expect(html).toContain("Pedido quitado");
  expect(html).toContain("R$ 4.900,00");
  expect(html).toContain("25 de novembro de 2026");
  const parcial = renderReceiptHtml({ ...base, paidBefore: 0, amount: 2000, balance: 4900, discount: 500 }, { logoDataUri: "data:,", qrDataUri: null, fontFaces: "" });
  expect(parcial).toContain("Parcialmente pago");
  expect(parcial).toContain("- R$ 500,00");
  if (process.env.RECIBO_PREVIEW) {
    const many = { ...base, receiptNumber: "000185", items: Array.from({ length: 22 }, (_, i) => ({ description: `Item ${i + 1} – Janela de correr Linha Suprema`, detail: i % 2 ? "1,50 × 1,20 m · vidro 4 mm" : null, unit: "un", quantity: 1 + (i % 3), total: 500 + i * 37 })) };
    writeFileSync("/tmp/recibo-1.html", html.replace("Mariana &lt;Souza&gt;", "Mariana Souza"));
    writeFileSync("/tmp/recibo-2.html", renderReceiptHtml(many, { logoDataUri: "data:,", qrDataUri: null, fontFaces: "" }));
  }
});

test("mensagem do WhatsApp com o recibo", async () => {
  const { receiptCaption, receiptFileName } = await import("@/lib/receipts/process");
  const bundle = { data: { ...base, client: { ...base.client, name: "Mariana Souza" } }, companyId: "c", clientName: "Mariana Souza", phone: "5547996980082", companyQrUrl: null };
  const quitado = receiptCaption(bundle);
  expect(quitado).toContain("Olá, Mariana!");
  expect(quitado).toContain("*R$ 4.900,00* via Pix em 25/11/2026 referente ao pedido nº 1942");
  expect(quitado).toContain("recibo nº 000184");
  expect(quitado).toContain("Pedido quitado");
  const parcial = receiptCaption({ ...bundle, data: { ...bundle.data, balance: 1500 } });
  expect(parcial).toContain("Saldo restante: *R$ 1.500,00*");
  expect(receiptFileName(bundle)).toBe("Recibo-000184-Mariana-Souza.pdf");
});
