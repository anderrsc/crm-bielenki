// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/(crm)/actions", () => ({ createClientRecord: vi.fn() }));
vi.mock("@/app/(crm)/client-pipeline-actions", () => ({}));
import { QuickClientDialog } from "@/components/quick-client-dialog";

afterEach(cleanup);

// Cadastro rápido já com o endereço completo: não precisa abrir "Editar cliente" depois.
test("novo cliente rápido tem CEP, rua, número, complemento, bairro, cidade e UF", () => {
  render(<QuickClientDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Novo cliente/ }));
  const form = document.querySelector("form")!;
  for (const name of ["postal_code", "city", "state", "neighborhood", "address"]) expect(form.querySelector(`[name="${name}"]`), name).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("Ex. Rua Vicente Bernardes"), { target: { value: "Rua Exemplo" } });
  fireEvent.change(screen.getByPlaceholderText("Ex. 120 ou S/N"), { target: { value: "120" } });
  fireEvent.change(screen.getByPlaceholderText("Ex. Sala 2"), { target: { value: "Casa 2" } });
  expect((form.querySelector('[name="address"]') as HTMLInputElement).value).toBe("Rua Exemplo, 120, Casa 2");
  expect((form.querySelector('[name="state"]') as HTMLSelectElement).value).toBe("SC");
});
