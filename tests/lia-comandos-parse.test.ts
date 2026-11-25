import { describe, expect, it } from "vitest";
import { bestMatch, isNo, isYes, parseCommand, parseMoney, pickedOption } from "@/lib/lia-comandos/parse";

describe("comandos da Lia: leitura", () => {
  it("reconhece comandos e apelidos", () => {
    expect(parseCommand("/adicionar Anderson recebeu 30,00 na conta")).toEqual({ op: "entrada", rest: "Anderson recebeu 30,00 na conta" });
    expect(parseCommand("/Saída 85 gasolina")).toEqual({ op: "saida", rest: "85 gasolina" });
    expect(parseCommand("/editar valor 35")).toEqual({ op: "editar", rest: "valor 35" });
    expect(parseCommand("/xyz")).toEqual({ unknown: "xyz" });
    expect(parseCommand("bom dia")).toBeNull();
  });

  it("lê valores em reais", () => {
    expect(parseMoney("recebeu 30,00 na conta")).toBe(30);
    expect(parseMoney("R$ 1.250,50 perfis")).toBe(1250.5);
    expect(parseMoney("baixa 2.000 pix")).toBe(2000);
    expect(parseMoney("35.5")).toBe(35.5);
    expect(parseMoney("sem valor")).toBeNull();
  });

  it("confirmação, cancelamento e escolha", () => {
    expect(isYes("Sim")).toBe(true);
    expect(isYes("sim!")).toBe(true);
    expect(isYes("sim mas muda o valor")).toBe(false);
    expect(isNo("não")).toBe(true);
    expect(pickedOption("2", 3)).toBe(1);
    expect(pickedOption("4", 3)).toBeNull();
  });

  it("acha a conta pelo nome", () => {
    const contas = [{ name: "Conta Anderson" }, { name: "Caixa Marquinhos" }, { name: "Sicoob Marquinhos" }];
    expect(bestMatch("anderson", contas)?.name).toBe("Conta Anderson");
    expect(bestMatch("Sicoob", contas)?.name).toBe("Sicoob Marquinhos");
    expect(bestMatch("marquinhos", contas)).toBeNull();
  });
});
