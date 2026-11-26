// Comandos da Lia pelo WhatsApp: partes puras (sem banco), testáveis.

export type CommandOp =
  | "entrada" | "saida" | "transferir" | "saldo" | "extrato"
  | "baixa" | "cliente" | "devendo" | "recibo" | "compra"
  | "relatorio" | "caixa" | "desfazer" | "cancelar" | "ajuda" | "editar";

const ALIASES: Record<string, CommandOp> = {
  entrada: "entrada", adicionar: "entrada", receber: "entrada", recebi: "entrada",
  saida: "saida", despesa: "saida", paguei: "saida", gasto: "saida",
  transferir: "transferir", transferencia: "transferir",
  saldo: "saldo", saldos: "saldo",
  extrato: "extrato",
  baixa: "baixa",
  cliente: "cliente", ficha: "cliente",
  devendo: "devendo", devedores: "devendo",
  recibo: "recibo",
  compra: "compra",
  relatorio: "relatorio",
  caixa: "caixa",
  desfazer: "desfazer", estornar: "desfazer",
  cancelar: "cancelar",
  ajuda: "ajuda", comandos: "ajuda", menu: "ajuda",
  editar: "editar", corrigir: "editar",
};

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "/Entrada Anderson recebeu..." → { op: "entrada", rest: "Anderson recebeu..." }. Sem barra ou desconhecido → null. */
export function parseCommand(text: string): { op: CommandOp; rest: string } | { unknown: string } | null {
  const m = text.trim().match(/^\/\s*([\p{L}]+)\s*([\s\S]*)$/u);
  if (!m) return null;
  const op = ALIASES[fold(m[1])];
  return op ? { op, rest: m[2].trim() } : { unknown: m[1] };
}

/**
 * Comando falado ou escrito sem barra, começando por "Lia": "Lia, lança 30 reais na conta do Anderson".
 * Devolve o texto sem o "Lia" quando é um chamado, ou null.
 */
export function stripLiaCall(text: string): string | null {
  const t = text.replace(/^\[áudio\]\s*/i, "").trim();
  // A transcrição às vezes escreve o nome como "Léa", "Lía", "Lya" ou "Lia." no começo.
  const m = t.match(/^(?:ei|oi|olá|ola|ô|o|e aí|e ai|alô|alo)?[\s,]*(?:l[iíeéy]a|lia+h?)\b[\s,:!.\-–]*([\s\S]*)$/i);
  return m ? m[1].trim() : null;
}

/** Descobre o comando pelo que foi dito (sem barra). null = não deu para saber. */
export function detectOp(text: string): CommandOp | null {
  const t = fold(text);
  const rules: Array<[RegExp, CommandOp]> = [
    [/\b(desfaz|desfazer|estorna|estornar|estorno)/, "desfazer"],
    [/\b(cancela|cancelar|esquece)\b/, "cancelar"],
    [/\b(ajuda|comandos|o que voce faz)\b/, "ajuda"],
    [/\b(corrig|edita|editar|altera|alterar|muda o|muda a|troca o|troca a)/, "editar"],
    [/\btransfer/, "transferir"],
    [/\bextrato\b/, "extrato"],
    [/\bsaldo/, "saldo"],
    [/\brelatorio/, "relatorio"],
    [/\bcaixa (de )?hoje|\bcaixa do dia|\bcomo (esta|ta) o caixa/, "caixa"],
    [/\b(da|dar|de) baixa|\bbaixa\b|\bcliente .*(pagou|pago)|\bpagou\b/, "baixa"],
    [/\b(devendo|devedores|quem deve|em aberto)/, "devendo"],
    [/\brecibo/, "recibo"],
    [/\b(compra|comprei|comprar)\b/, "compra"],
    [/\b(ficha|como esta o cliente|dados do cliente)\b/, "cliente"],
    [/\b(saida|paguei|gastei|despesa|gasto)\b/, "saida"],
    [/\b(entrada|recebi|recebeu|recebemos|entrou|lanca|lancar|adiciona|adicionar|vendi|vendemos)\b/, "entrada"],
  ];
  for (const [re, op] of rules) if (re.test(t)) return op;
  return null;
}

export const isYes = (t: string) => /^(?:l[ií]a[\s,]*)?(sim|s|ok|confirmo|confirma|confirmar|pode|pode lan[cç]ar|isso|certo|yes|👍|✅)[.! ]*$/i.test(t.trim());
export const isNo = (t: string) => /^(?:l[ií]a[\s,]*)?(n[aã]o|n|cancela|cancelar|\/cancelar|deixa|esquece|para)[.! ]*$/i.test(t.trim());

/** Primeiro valor em reais do texto: "30,00", "R$ 1.250,50", "2.000", "35". */
export function parseMoney(text: string): number | null {
  const m = text.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d)/i);
  if (!m) return null;
  let raw = m[1];
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
export const brDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export const METHOD_LABEL: Record<string, string> = {
  pix: "Pix", dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito",
  boleto: "Boleto", transferencia: "Transferência", cheque: "Cheque",
};

/** Melhor nome da lista para o texto (ignora acento e maiúscula). Empate ou nada → null. */
export function bestMatch<T extends { name: string }>(query: string | null | undefined, items: T[]): T | null {
  const q = fold(query ?? "");
  if (!q) return null;
  const exact = items.filter((i) => fold(i.name) === q);
  if (exact.length === 1) return exact[0];
  const contains = items.filter((i) => fold(i.name).includes(q) || q.includes(fold(i.name)));
  if (contains.length === 1) return contains[0];
  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  const scored = items.map((i) => ({ i, s: words.filter((w) => fold(i.name).includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (scored.length && (scored.length === 1 || scored[0].s > scored[1].s)) return scored[0].i;
  return null;
}

/** Lista para o usuário escolher por número. */
export function optionsText(options: { label: string }[]) {
  return options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
}

/** Resposta "2" ou "opção 2" → índice 1. */
export function pickedOption(text: string, count: number): number | null {
  const m = text.trim().match(/^(?:op[cç][aã]o\s*)?(\d{1,2})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= count ? n - 1 : null;
}

export const HELP_TEXT = `*Comandos da Lia* 🤖
Tudo que lança ou envia mostra um resumo antes. Só executa depois do *sim*.

*Financeiro*
/entrada (ou /adicionar): recebimento
/saida: despesa
/transferir: entre contas
/saldo: saldo das contas
/extrato: últimos lançamentos de uma conta

*Clientes*
/baixa: baixa + recibo ao cliente
/cliente: ficha do cliente
/devendo: quem tem saldo em aberto
/recibo: reenvia o último recibo

*Compras*
/compra: conta a pagar de fornecedor

*Relatórios*
/relatorio semana | mês (financeiro)
/caixa hoje

*Controle*
/editar: corrige o resumo (ou /editar último)
/desfazer: estorna o último lançamento
/cancelar: aborta o comando`;
