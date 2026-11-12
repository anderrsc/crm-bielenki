// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ClientSelect } from "@/components/client-select";
import { searchClientOptions } from "@/app/(crm)/client-options-actions";
vi.mock("@/app/(crm)/client-options-actions", () => ({ searchClientOptions: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

test("busca espera a digitação e mantém o cliente escolhido fora dos resultados", async () => {
  vi.useFakeTimers();
  vi.mocked(searchClientOptions).mockResolvedValue({ items: [{ id: "b", name: "Bruno" }] });
  const onChange = vi.fn();
  render(<ClientSelect items={[{ id: "a", name: "Ana" }]} value="a" onChange={onChange} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Br" } });
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Bruno" } });
  expect(searchClientOptions).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(searchClientOptions).toHaveBeenCalledTimes(1);
  expect(searchClientOptions).toHaveBeenCalledWith("Bruno");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("a");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
  expect(onChange).toHaveBeenCalledWith("b");
});

test("restaura o nome do cliente de rascunho fora da primeira página", async () => {
  vi.mocked(searchClientOptions).mockResolvedValue({ items: [{ id: "restored", name: "Cliente restaurado" }] });
  await act(async () => { render(<ClientSelect value="restored" />); });
  expect(searchClientOptions).toHaveBeenCalledWith("", "restored");
  expect(screen.getByRole("option", { name: "Cliente restaurado" })).toBeTruthy();
});
