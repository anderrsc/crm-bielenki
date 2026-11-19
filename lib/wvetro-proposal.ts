// Lê a proposta impressa pelo WVetro (PDF com texto) e transforma nos itens do
// Orçamento de esquadrias. Nada é salvo aqui: a pessoa confere e salva.
//
// O PDF chega como linhas de células (texto + posição x), na ordem da página.
// O WVetro imprime sempre os mesmos rótulos (*LINHA:, *COR VIDRO, QTDE.…), então
// a leitura é por rótulo — sem IA, sem custo e sem errar número.

export type Cell = { x: number; s: string };
export type Row = Cell[];

export type WvetroItem = {
  n: number;
  ambiente: string;
  produto: string;
  linha: string;
  corEsquadria: string;
  corAcessorio: string;
  vidro: string;
  quantidade: number;
  largura: number;
  altura: number;
  metragem: number | null;
  observacoes: string;
  variaveis: string[];
};

export type WvetroProposal = {
  numero: string | null;
  emissao: string | null;
  validade: string | null;
  vendedor: string | null;
  cliente: {
    nome: string | null;
    telefone: string | null;
    celular: string | null;
    email: string | null;
    endereco: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    documento: string | null;
  };
  itens: WvetroItem[];
  total: number | null;
  observacoes: string[];
};

/** Item no formato do Orçamento de esquadrias. */
export type WindowFormItem = { product: string; line: string; measurements: string; glass: string; accessories: string; color: string; quantity: number; unit_price: number };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const joinRow = (row: Row) => clean(row.map((c) => c.s).join(" "));

/** "51.154,78" → 51154.78; "3,60000" → 3.6; "1200" → 1200. */
export function brNumber(s: string | null | undefined): number | null {
  const t = (s ?? "").replace(/[R$\s]/g, "");
  if (!/\d/.test(t)) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

/** "19/08/2026" → "2026-08-19". */
export function brDate(s: string | null | undefined): string | null {
  const m = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(s ?? "");
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2]}-${m[1]}`;
}

// Rótulos do cabeçalho: valor é a célula seguinte, se não for outro rótulo.
const HEADER_LABELS = ["CLIENTE:", "TEL. FIXO:", "CELULAR", "EMAIL:", "TEL2/Fax:", "IE/RG:", "CNPJ/CPF:", "Numero:", "Emissão:", "Vendedor:", "Contato:", "Email:"];
const isLabel = (s: string) => HEADER_LABELS.some((l) => s.toUpperCase().startsWith(l.toUpperCase())) || /^\*?[A-ZÀ-Ú./ ]+:$/.test(s);

function valueAfter(row: Row, label: string): string | null {
  const i = row.findIndex((c) => clean(c.s).toUpperCase().startsWith(label.toUpperCase()));
  if (i < 0) return null;
  const inline = clean(row[i].s.slice(label.length));
  if (inline) return inline;
  const next = row[i + 1];
  return next && !isLabel(clean(next.s)) ? clean(next.s) : null;
}

/** Texto depois de um rótulo que vem colado ou em células seguintes até o próximo rótulo. */
function textAfter(row: Row, label: string, stopAt?: string): string {
  const flat = joinRow(row);
  const start = flat.toUpperCase().indexOf(label.toUpperCase());
  if (start < 0) return "";
  let rest = flat.slice(start + label.length);
  if (stopAt) {
    const stop = rest.toUpperCase().indexOf(stopAt.toUpperCase());
    if (stop >= 0) rest = rest.slice(0, stop);
  }
  return clean(rest);
}

const startsWith = (row: Row, label: string) => joinRow(row).toUpperCase().startsWith(label.toUpperCase());
const has = (row: Row, label: string) => joinRow(row).toUpperCase().includes(label.toUpperCase());

const COLUMNS = ["TIPO", "QTDE.", "LARGURA:", "ALTURA:", "METRAGEM:", "DT.INSTALAÇÃO"] as const;

/** Lê a linha de números alinhando cada valor com a coluna do cabeçalho mais próxima. */
function readMeasures(header: Row, values: Row) {
  const centers = COLUMNS.map((name) => {
    const cell = header.find((c) => clean(c.s).toUpperCase() === name);
    return cell ? cell.x + name.length * 2.5 : null;
  });
  const out: Partial<Record<(typeof COLUMNS)[number], string>> = {};
  for (const cell of values) {
    let best = -1, dist = Infinity;
    centers.forEach((c, i) => { if (c !== null && Math.abs(c - cell.x) < dist) { dist = Math.abs(c - cell.x); best = i; } });
    if (best >= 0) out[COLUMNS[best]] = clean(`${out[COLUMNS[best]] ?? ""} ${cell.s}`);
  }
  return out;
}

export function parseWvetroRows(rows: Row[]): WvetroProposal {
  const proposal: WvetroProposal = {
    numero: null, emissao: null, validade: null, vendedor: null,
    cliente: { nome: null, telefone: null, celular: null, email: null, endereco: null, bairro: null, cidade: null, uf: null, cep: null, documento: null },
    itens: [], total: null, observacoes: [],
  };
  type Mode = "header" | "item" | "itemObs" | "variables" | "footer" | "notes";
  let mode: Mode = "header";
  let item: WvetroItem | null = null;
  let titleDone = false;

  const finish = () => {
    if (item && item.produto && item.quantidade > 0) proposal.itens.push({ ...item, observacoes: clean(item.observacoes) });
    item = null;
  };

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r].filter((c) => clean(c.s));
    if (!row.length) continue;
    const flat = joinRow(row);
    const upper = flat.toUpperCase();

    if (startsWith(row, "*LOCAL/AMBIENTE:")) {
      finish();
      mode = "item";
      titleDone = false;
      const ambiente = textAfter(row, "*LOCAL/AMBIENTE:", "ITEM NRO:");
      const n = Number(valueAfter(row, "ITEM NRO:") ?? proposal.itens.length + 1);
      item = { n: Number.isFinite(n) ? n : proposal.itens.length + 1, ambiente, produto: "", linha: "", corEsquadria: "", corAcessorio: "", vidro: "", quantidade: 0, largura: 0, altura: 0, metragem: null, observacoes: "", variaveis: [] };
      continue;
    }
    if (upper.startsWith("TOTAL:")) {
      finish();
      mode = "footer";
      proposal.total = brNumber(valueAfter(row, "TOTAL:") ?? textAfter(row, "TOTAL:"));
      continue;
    }
    if (upper.startsWith("LISTA DE VARI")) { mode = "variables"; continue; }
    if (/^OBSERVA[CÇ][OÕ]ES:$/.test(upper)) { finish(); mode = "notes"; continue; }

    if (mode === "header") {
      const numero = valueAfter(row, "Numero:"); if (numero) proposal.numero = numero.replace(/\D/g, "") || numero;
      const emissao = valueAfter(row, "Emissão:"); if (emissao) proposal.emissao = brDate(emissao);
      const vendedor = valueAfter(row, "Vendedor:"); if (vendedor) proposal.vendedor = vendedor;
      if (startsWith(row, "CLIENTE:")) {
        proposal.cliente.nome = textAfter(row, "CLIENTE:", "TEL. FIXO:") || null;
        proposal.cliente.telefone = valueAfter(row, "TEL. FIXO:");
        proposal.cliente.celular = valueAfter(row, "CELULAR");
      }
      if (startsWith(row, "EMAIL:")) {
        const email = textAfter(row, "EMAIL:", "TEL2/Fax:");
        proposal.cliente.email = /@/.test(email) ? email.toLowerCase() : null;
        proposal.cliente.telefone ??= valueAfter(row, "TEL2/Fax:");
      }
      if (startsWith(row, "ENDEREÇO:")) {
        const [endereco, ...bairro] = row.map((c) => clean(c.s)).filter((s) => !s.toUpperCase().startsWith("IE/RG"));
        proposal.cliente.endereco = clean(endereco.replace(/^ENDEREÇO:/i, "").replace(/^[,\s]+/, "")) || null;
        proposal.cliente.bairro = bairro.length ? bairro.join(" ") : null;
      }
      if (startsWith(row, "CEP:")) {
        const m = /CEP:\s*([\d.-]*)\s*-\s*([^/]*?)\s*\/\s*([A-Z]{2})/i.exec(flat);
        if (m) { proposal.cliente.cep = m[1].replace(/\D/g, "") || null; proposal.cliente.cidade = clean(m[2]) || null; proposal.cliente.uf = m[3].toUpperCase(); }
        proposal.cliente.documento = valueAfter(row, "CNPJ/CPF:");
      }
      continue;
    }

    if (mode === "item" && item) {
      const it: WvetroItem = item;
      if (startsWith(row, "*LINHA:")) { it.linha = textAfter(row, "*LINHA:"); titleDone = true; continue; }
      if (startsWith(row, "*COR ESQUADRIA:")) {
        it.corEsquadria = textAfter(row, "*COR ESQUADRIA:", "*COR");
        it.corAcessorio = textAfter(row, "ACESSÓRIO:");
        continue;
      }
      if (startsWith(row, "*COR VIDRO")) { it.vidro = clean(textAfter(row, "*COR VIDRO").replace(/^:/, "")); continue; }
      if (has(row, "QTDE.") && has(row, "LARGURA")) {
        const values = rows[r + 1] ?? [];
        const m = readMeasures(row, values);
        it.quantidade = brNumber(m["QTDE."]) ?? 0;
        it.largura = brNumber(m["LARGURA:"]) ?? 0;
        it.altura = brNumber(m["ALTURA:"]) ?? 0;
        it.metragem = brNumber(m["METRAGEM:"]);
        r++;
        continue;
      }
      if (upper.startsWith("OBSERVAÇÕES DESTE ITEM") || upper.startsWith("OBSERVACOES DESTE ITEM")) { mode = "itemObs"; continue; }
      if (!titleDone) { it.produto = clean(`${it.produto} ${flat}`); continue; }
      continue;
    }
    if (mode === "itemObs" && item) { (item as WvetroItem).observacoes += ` ${flat}`; continue; }
    if (mode === "variables") {
      const target = item ?? proposal.itens[proposal.itens.length - 1];
      // Nome à esquerda e valor encostado à direita: separa no maior espaço entre células.
      if (target && row.length >= 2) {
        let cut = 1;
        for (let i = 1; i < row.length; i++) if (row[i].x - row[i - 1].x > row[cut].x - row[cut - 1].x) cut = i;
        target.variaveis.push(`${joinRow(row.slice(0, cut))}: ${joinRow(row.slice(cut))}`);
      }
      continue;
    }
    if (mode === "footer") {
      const validade = /VALIDO ATÉ:?\s*(\d{2}\/\d{2}\/\d{2,4})/i.exec(flat);
      if (validade) proposal.validade = brDate(validade[1]);
      continue;
    }
    if (mode === "notes") proposal.observacoes.push(flat);
  }
  finish();
  return proposal;
}

// ─── Para o formulário ───────────────────────────────────────────────────────

/** "INCOLOR 06MM - TEMPERADO" → "Incolor 6 mm - temperado". */
export function sentence(s: string): string {
  const t = clean(s).toLocaleLowerCase("pt-BR").replace(/\b0?(\d+)\s?mm\b/g, "$1 mm");
  return t ? t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1) : "";
}

/** "L. SUPREMA" → "Suprema"; "GUARDA-CORPO" → "Guarda-corpo". */
export const lineName = (linha: string) => sentence(linha.replace(/^L\.\s*/i, ""));

/** Tira do nome o " | SUPREMA" que repete a linha e acrescenta o ambiente. */
export function productName(item: WvetroItem): string {
  const line = clean(item.linha.replace(/^L\.\s*/i, "")).toUpperCase();
  const parts = item.produto.split("|").map(clean);
  const kept = parts.filter((p, i) => i === 0 || p.toUpperCase().replace(/\s*\(.*\)$/, "") !== line);
  let name = kept.join(" | ");
  const extra = parts.map((p) => /^(.*?)\s*(\(.*\))$/.exec(p)).find((m, i) => i > 0 && m && clean(m[1]).toUpperCase() === line);
  if (extra) name = `${name} ${extra[2]}`;
  return item.ambiente ? `${name} — ${sentence(item.ambiente)}` : name;
}

export function toWindowItems(proposal: WvetroProposal): WindowFormItem[] {
  return proposal.itens.map((item) => {
    const detalhes = [item.observacoes && item.observacoes.toLocaleLowerCase("pt-BR"), ...item.variaveis.map(sentence)].filter(Boolean).join("; ");
    return {
      product: productName(item),
      line: lineName(item.linha),
      measurements: item.largura && item.altura ? `${item.largura} × ${item.altura}` : "",
      glass: sentence(item.vidro),
      accessories: [sentence(item.corAcessorio), detalhes].filter(Boolean).join(" · "),
      color: sentence(item.corEsquadria),
      quantity: item.quantidade,
      unit_price: 0,
    };
  });
}

/** Observações do orçamento: número da proposta e os detalhes gerais do pedido. */
export function proposalNotes(proposal: WvetroProposal): string {
  // Vai para a proposta impressa do cliente: sem citar o programa usado internamente.
  const head = proposal.numero ? `Referente à proposta nº ${proposal.numero}${proposal.emissao ? ` de ${proposal.emissao.split("-").reverse().join("/")}` : ""}.` : "";
  return [head, ...proposal.observacoes].filter(Boolean).join("\n");
}

/** Área de cada item (m²) para repartir o total: usa a metragem do WVetro ou L × A × quantidade. */
const itemArea = (item: { quantity: number; measurements: string }, metragem?: number | null) => {
  if (metragem && metragem > 0) return metragem;
  const [l, a] = item.measurements.split(/[×x]/i).map((v) => Number(v.trim()));
  return l > 0 && a > 0 ? (l * a * item.quantity) / 1e6 : 0;
};

/**
 * Reparte o total da proposta entre os itens pela metragem, para o orçamento
 * fechar exatamente no total do WVetro. Os centavos que sobram do arredondamento
 * vão para um item de quantidade 1; se não houver, vira desconto de centavos.
 */
export function distributeTotal(items: { quantity: number; measurements: string }[], total: number, metragens: (number | null)[] = []): { unitPrices: number[]; discount: number } {
  const cents = Math.round(total * 100);
  const areas = items.map((item, i) => itemArea(item, metragens[i]));
  const sum = areas.reduce((a, b) => a + b, 0);
  if (!(cents > 0) || !items.length) return { unitPrices: items.map(() => 0), discount: 0 };
  const weights = sum > 0 ? areas.map((a) => a / sum) : items.map(() => 1 / items.length);
  const units = items.map((item, i) => Math.round((cents * weights[i]) / item.quantity));
  let rest = cents - units.reduce((s, u, i) => s + u * items[i].quantity, 0);
  const single = items.findIndex((item, i) => item.quantity === 1 && units[i] + rest > 0);
  if (rest !== 0 && single >= 0) { units[single] += rest; rest = 0; }
  if (rest > 0) {
    // Sobe 1 centavo nos unitários até cobrir e devolve o excesso como desconto.
    for (let i = 0; i < items.length && rest > 0; i++) { units[i] += Math.ceil(rest / items[i].quantity); rest -= Math.ceil(rest / items[i].quantity) * items[i].quantity; }
  }
  return { unitPrices: units.map((u) => u / 100), discount: rest < 0 ? -rest / 100 : 0 };
}
