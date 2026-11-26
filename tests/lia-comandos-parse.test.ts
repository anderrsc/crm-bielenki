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

import { detectOp, stripLiaCall } from "@/lib/lia-comandos/parse";

describe("comandos falados (áudio) ou escritos começando por Lia", () => {
  it("reconhece o chamado da Lia", () => {
    expect(stripLiaCall("[áudio] Lia, lança uma entrada de 30 reais na conta do Anderson.")).toBe("lança uma entrada de 30 reais na conta do Anderson.");
    expect(stripLiaCall("Lía faz a baixa do Jonata")).toBe("faz a baixa do Jonata");
    expect(stripLiaCall("Oi Lia, qual o saldo?")).toBe("qual o saldo?");
    expect(stripLiaCall("Liane mandou o orçamento")).toBeNull();
    expect(stripLiaCall("bom dia")).toBeNull();
  });
  it("descobre o comando pelo que foi dito", () => {
    expect(detectOp("lança uma entrada de 30 reais na conta do Anderson")).toBe("entrada");
    expect(detectOp("o Anderson recebeu 30 reais, calha vendida na hora")).toBe("entrada");
    expect(detectOp("paguei 85 de gasolina no pix da Marquinhos")).toBe("saida");
    expect(detectOp("dá baixa no Jonata, 2 mil no pix")).toBe("baixa");
    expect(detectOp("qual o saldo da conta do Anderson")).toBe("saldo");
    expect(detectOp("quem está devendo")).toBe("devendo");
    expect(detectOp("registra uma compra da Figueira de 1250")).toBe("compra");
    expect(detectOp("desfaz o último")).toBe("desfazer");
    expect(detectOp("transfere 500 da conta do Anderson pro caixa")).toBe("transferir");
    expect(detectOp("manda o relatório do mês pro financeiro")).toBe("relatorio");
    expect(detectOp("como está o tempo")).toBeNull();
  });
});

describe("variações do nome na transcrição", () => {
  it("aceita Léa, Lía, Lya", () => {
    expect(stripLiaCall("[áudio] Léa, qual o saldo?")).toBe("qual o saldo?");
    expect(stripLiaCall("Lya lança 30 reais")).toBe("lança 30 reais");
    expect(stripLiaCall("E aí Lia, quem está devendo?")).toBe("quem está devendo?");
    expect(stripLiaCall("Leandro mandou a nota")).toBeNull();
  });
});
