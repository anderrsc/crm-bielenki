// Comandos da Lia pelo WhatsApp. Somente servidor (service role).
// Só números de lia_command_phones. Tudo que lança, envia ou estorna vira um resumo
// pendente e só executa com "sim". Consultas respondem direto.
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiChat, type AiProvider } from "@/lib/ai/chat";
import { scheduleReceipt } from "@/lib/receipts/process";
import { phoneKey } from "@/lib/whatsapp/phone";
import { todayISO, addDaysISO } from "@/lib/utils";
import {
  HELP_TEXT, METHOD_LABEL, bestMatch, brDate, brl, fold, isNo, isYes, optionsText,
  detectOp, parseCommand, parseMoney, pickedOption, stripLiaCall, type CommandOp,
} from "./parse";

const PENDING_MINUTES = 30;
const WRITE_OPS = ["entrada", "saida", "transferir", "baixa", "compra"] as const;
type WriteOp = (typeof WRITE_OPS)[number];
type Fields = Record<string, unknown>;
type Option = { id: string; label: string };
type Choose = { field: string; options: Option[] };

type LogRow = {
  id: string; op: string; status: string; fields: Fields; choose: Choose | null;
  summary: string | null; result: Record<string, unknown> | null; target_id: string | null; created_at: string;
};

export type CommandSender = { profileId: string; label: string };

export type CommandContext = {
  db: SupabaseClient;
  companyId: string;
  phone: string;
  text: string;
  /** Responde para quem mandou o comando. */
  reply: (text: string) => Promise<void>;
  /** Envia para outro número (relatório para o financeiro). */
  sendTo: (phone: string, text: string) => Promise<void>;
  ai: { provider: AiProvider; apiKey: string | null; model?: string | null } | null;
};

/** Número liberado para comandos? (compara DDD + 8 últimos dígitos, com ou sem o 9). */
export async function commandSender(db: SupabaseClient, companyId: string, phone: string): Promise<CommandSender | null> {
  const key = phoneKey(phone);
  if (key.length < 10) return null;
  const { data } = await db.from("lia_command_phones").select("phone,label,profile_id").eq("company_id", companyId).eq("active", true);
  const hit = (data ?? []).find((r: { phone: string }) => phoneKey(r.phone) === key) as { label: string; profile_id: string } | undefined;
  return hit ? { profileId: hit.profile_id, label: hit.label } : null;
}

// ── Dados de apoio ────────────────────────────────────────────────────────────

type Account = { id: string; name: string };
type Category = { id: string; name: string; entry_type: string };

async function accounts(db: SupabaseClient, companyId: string): Promise<Account[]> {
  const { data } = await db.from("receiving_accounts").select("id,name").eq("company_id", companyId).eq("active", true).order("name");
  return (data ?? []) as Account[];
}
async function categories(db: SupabaseClient, companyId: string): Promise<Category[]> {
  const { data } = await db.from("financial_categories").select("id,name,entry_type").eq("company_id", companyId).eq("active", true).order("name");
  return (data ?? []) as Category[];
}
async function searchNamed(db: SupabaseClient, table: "clients" | "suppliers", companyId: string, name: string): Promise<Option[]> {
  const q = name.trim().replace(/[%,()]/g, " ").trim();
  if (q.length < 2) return [];
  const base = () => db.from(table).select("id,name").eq("company_id", companyId).eq("status", "ativo").limit(8);
  let { data } = await base().ilike("name", `%${q}%`);
  if (!data?.length) {
    const first = q.split(/\s+/).find((w) => w.length >= 3);
    if (first) ({ data } = await base().ilike("name", `%${first}%`));
  }
  const rows = (data ?? []) as { id: string; name: string }[];
  const exact = rows.filter((r) => fold(r.name) === fold(q));
  return (exact.length === 1 ? exact : rows).map((r) => ({ id: r.id, label: r.name }));
}

// ── IA: entende o texto livre e devolve os campos ─────────────────────────────

const FIELD_HELP: Record<WriteOp, string> = {
  entrada: `valor (número), conta (nome da conta onde o dinheiro caiu), categoria (nome), descricao (curta, do que se trata), data (aaaa-mm-dd), metodo (pix|dinheiro|cartao_credito|cartao_debito|boleto|transferencia), cliente (nome, só se for de um cliente cadastrado)`,
  saida: `valor (número), conta (de onde saiu o dinheiro), categoria (nome), descricao, data (aaaa-mm-dd), metodo (pix|dinheiro|cartao_credito|cartao_debito|boleto|transferencia), fornecedor (nome, se houver)`,
  transferir: `valor (número), conta (origem), conta_destino (destino), data (aaaa-mm-dd), descricao`,
  baixa: `cliente (nome de quem pagou; no /baixa o nome citado é sempre o cliente), valor (número), orcamento (número do orçamento/pedido, se citado), conta (onde caiu), data (aaaa-mm-dd), metodo (pix|dinheiro|cartao_credito|cartao_debito|boleto|transferencia)`,
  compra: `fornecedor (nome), valor (número), descricao, vencimento (aaaa-mm-dd; "30 dias" = hoje + 30), metodo (pix|boleto|transferencia|dinheiro|cartao_credito), categoria (nome)`,
};

async function extractFields(ctx: CommandContext, op: WriteOp, text: string, current: Fields, refs: { accounts: Account[]; categories: Category[] }): Promise<Fields> {
  const today = todayISO();
  const fallback = (): Fields => {
    const out: Fields = { ...current };
    const v = parseMoney(text);
    if (v) out.valor = v;
    const acc = refs.accounts.find((a) => fold(text).includes(fold(a.name)));
    if (acc) out.conta = acc.name;
    if (!current.descricao && op !== "baixa") out.descricao = text.slice(0, 120);
    if (op === "baixa" && !current.cliente) out.cliente = text.replace(/[\d.,]+|r\$|pix|or[cç]amento/gi, " ").trim().split(/\s+/).slice(0, 3).join(" ");
    return out;
  };
  if (!ctx.ai?.apiKey && ctx.ai?.provider !== "ollama") return fallback();
  const prompt = [
    `Hoje é ${today} (America/Sao_Paulo). Ontem = ${addDaysISO(today, -1)}.`,
    `Comando: /${op}. Campos possíveis: ${FIELD_HELP[op]}.`,
    `Contas existentes: ${refs.accounts.map((a) => a.name).join(" | ") || "(nenhuma)"}.`,
    `Categorias existentes: ${refs.categories.map((c) => `${c.name} (${c.entry_type})`).join(" | ") || "(nenhuma)"}.`,
    `Campos já preenchidos (JSON): ${JSON.stringify(stripIds(current))}.`,
    `Mensagem do usuário: """${text}"""`,
    "",
    "Devolva o objeto JSON COMPLETO com os campos atualizados. Mantenha os já preenchidos, a menos que a mensagem os corrija.",
    "Use o nome exato de uma conta/categoria existente quando a mensagem se referir a ela (ex.: \"na conta do Anderson\" → a conta que tem Anderson no nome).",
    "Escolha a categoria mais adequada entre as existentes quando o assunto deixar claro (ex.: venda de balcão/retirada → categoria de vendas). Não invente valores, datas nem nomes. Campo não informado = null.",
    "cliente/fornecedor: só preencha quando a mensagem disser claramente que o dinheiro é de/para um cliente ou fornecedor cadastrado (ex.: \"do cliente Jonata\"). Quem recebeu ou pagou (ex.: \"Anderson recebeu\") indica a CONTA, não o cliente.",
    "Valores em reais como número (\"30,00\" → 30; \"1.250,50\" → 1250.5).",
  ].join("\n");
  try {
    const raw = await aiChat({
      provider: ctx.ai!.provider, model: ctx.ai!.model ?? null, apiKey: ctx.ai!.apiKey, json: true, temperature: 0, maxTokens: 600,
      messages: [{ role: "system", content: "Você extrai dados de comandos financeiros de uma empresa brasileira. Responda só com JSON." }, { role: "user", content: prompt }],
    });
    const parsed = JSON.parse(raw) as Fields;
    const merged: Fields = { ...current };
    for (const [k, v] of Object.entries(parsed)) if (v !== undefined && k in FIELD_KEYS) merged[k] = v;
    // Nome mudou: o id antigo deixa de valer e é resolvido de novo.
    for (const [name, id] of Object.entries(ID_OF)) if (merged[name] !== current[name]) delete merged[id];
    if (merged.cliente !== current.cliente || merged.orcamento !== current.orcamento) { delete merged.entry_id; delete merged.entry_label; delete merged.entry_open; }
    return merged;
  } catch (error) {
    console.error("Lia comandos: IA falhou, usando leitura simples:", error instanceof Error ? error.message : error);
    return fallback();
  }
}

const FIELD_KEYS: Record<string, true> = { valor: true, conta: true, conta_destino: true, categoria: true, descricao: true, data: true, metodo: true, cliente: true, fornecedor: true, orcamento: true, vencimento: true };
const ID_OF: Record<string, string> = { conta: "conta_id", conta_destino: "conta_destino_id", categoria: "categoria_id", cliente: "client_id", fornecedor: "supplier_id" };
const stripIds = (f: Fields) => Object.fromEntries(Object.entries(f).filter(([k]) => k in FIELD_KEYS));

const ALL_OPS: CommandOp[] = ["entrada", "saida", "transferir", "saldo", "extrato", "baixa", "cliente", "devendo", "recibo", "compra", "relatorio", "caixa", "desfazer", "cancelar", "ajuda", "editar"];

/** Quando as palavras-chave não bastam, a IA escolhe o comando (só escolhe; nada é executado sem confirmação). */
async function classifyOp(ctx: CommandContext, text: string): Promise<CommandOp | null> {
  if (!ctx.ai?.apiKey && ctx.ai?.provider !== "ollama") return null;
  try {
    const raw = await aiChat({
      provider: ctx.ai!.provider, model: ctx.ai!.model ?? null, apiKey: ctx.ai!.apiKey, json: true, temperature: 0, maxTokens: 60,
      messages: [
        { role: "system", content: "Classifique o pedido em um comando de um CRM financeiro. Responda só JSON {\"op\": \"...\"}." },
        { role: "user", content: `Comandos: entrada (recebimento numa conta), saida (despesa), transferir (entre contas), saldo, extrato, baixa (pagamento de cliente), cliente (ficha), devendo (saldos em aberto), recibo (reenviar), compra (conta a pagar de fornecedor), relatorio, caixa (caixa do dia), desfazer, cancelar, ajuda, editar. Se não for nenhum, op = null.\nPedido: """${text}"""` },
      ],
    });
    const op = (JSON.parse(raw) as { op?: string | null }).op;
    return op && (ALL_OPS as string[]).includes(op) ? (op as CommandOp) : null;
  } catch { return null; }
}

// ── Resolve nomes → cadastros e diz o que falta ───────────────────────────────

type Resolved = { fields: Fields; missing: string | null; choose: Choose | null };

async function resolve(ctx: CommandContext, op: WriteOp, input: Fields, refs: { accounts: Account[]; categories: Category[] }): Promise<Resolved> {
  const f: Fields = { ...input };
  const { db, companyId } = ctx;
  const num = Number(f.valor);
  f.valor = Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : null;
  if (typeof f.data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.data)) f.data = todayISO();
  if (typeof f.metodo !== "string" || !METHOD_LABEL[f.metodo]) f.metodo = op === "compra" ? null : "pix";

  const pickAccount = (nameKey: "conta" | "conta_destino", idKey: string): Choose | string | null => {
    if (f[idKey]) return null;
    const hit = bestMatch(String(f[nameKey] ?? ""), refs.accounts);
    if (hit) { f[idKey] = hit.id; f[nameKey] = hit.name; return null; }
    if (!refs.accounts.length) return "Não há contas cadastradas no Financeiro.";
    return { field: idKey, options: refs.accounts.map((a) => ({ id: a.id, label: a.name })) };
  };
  const askAccount = (r: Choose | string | null, question: string): Resolved | null => {
    if (!r) return null;
    if (typeof r === "string") return { fields: f, missing: r, choose: null };
    return { fields: f, missing: `${question}\n${optionsText(r.options)}\n\nResponda com o número.`, choose: r };
  };
  const pickCategory = (type: "receber" | "pagar") => {
    if (f.categoria_id || !f.categoria) return;
    const hit = bestMatch(String(f.categoria), refs.categories.filter((c) => c.entry_type === type));
    if (hit) { f.categoria_id = hit.id; f.categoria = hit.name; }
  };
  const pickParty = async (kind: "cliente" | "fornecedor"): Promise<Resolved | null> => {
    const idKey = kind === "cliente" ? "client_id" : "supplier_id";
    if (f[idKey] || !f[kind]) return null;
    const found = await searchNamed(db, kind === "cliente" ? "clients" : "suppliers", companyId, String(f[kind]));
    if (found.length === 1) { f[idKey] = found[0].id; f[kind] = found[0].label; return null; }
    if (!found.length) return { fields: f, missing: `Não achei ${kind === "cliente" ? "o cliente" : "o fornecedor"} "${f[kind]}". Mande o nome como está no cadastro.`, choose: null };
    return { fields: f, missing: `Achei mais de um ${kind}. Qual é?\n${optionsText(found)}\n\nResponda com o número.`, choose: { field: idKey, options: found } };
  };

  if (op === "entrada" || op === "saida") {
    const party = await pickParty(op === "entrada" ? "cliente" : "fornecedor");
    if (party && f[op === "entrada" ? "cliente" : "fornecedor"] && party.choose) return party;
    // Nome que não é cadastro (ex.: venda de balcão): segue sem vincular.
    if (party && !party.choose) { f[op === "entrada" ? "client_id" : "supplier_id"] = null; }
    pickCategory(op === "entrada" ? "receber" : "pagar");
    if (!f.valor) return { fields: f, missing: "Qual o valor?", choose: null };
    return askAccount(pickAccount("conta", "conta_id"), op === "entrada" ? "Em qual conta caiu?" : "De qual conta saiu?") ?? { fields: f, missing: null, choose: null };
  }

  if (op === "transferir") {
    if (!f.valor) return { fields: f, missing: "Qual o valor da transferência?", choose: null };
    return askAccount(pickAccount("conta", "conta_id"), "De qual conta sai?")
      ?? askAccount(pickAccount("conta_destino", "conta_destino_id"), "Para qual conta vai?")
      ?? (f.conta_id === f.conta_destino_id ? { fields: f, missing: "As contas de origem e destino são iguais. Qual é o destino?", choose: null } : { fields: f, missing: null, choose: null });
  }

  if (op === "compra") {
    if (!f.fornecedor) return { fields: f, missing: "Qual o fornecedor?", choose: null };
    const party = await pickParty("fornecedor");
    if (party) return party;
    pickCategory("pagar");
    if (!f.valor) return { fields: f, missing: "Qual o valor da compra?", choose: null };
    if (typeof f.vencimento !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.vencimento)) f.vencimento = f.data;
    return { fields: f, missing: null, choose: null };
  }

  // baixa
  if (!f.cliente && !f.client_id) return { fields: f, missing: "De qual cliente é o pagamento?", choose: null };
  const party = await pickParty("cliente");
  if (party) return party;
  if (!f.entry_id) {
    const { data } = await db.from("financial_entries").select("id,description,open_amount,due_date")
      .eq("company_id", companyId).eq("client_id", String(f.client_id)).eq("entry_type", "receber")
      .gt("open_amount", 0).neq("status", "cancelado").order("due_date", { ascending: true }).limit(8);
    const open = (data ?? []) as { id: string; description: string; open_amount: number; due_date: string | null }[];
    if (!open.length) return { fields: f, missing: `${f.cliente} não tem nada em aberto no Financeiro.`, choose: null };
    const ref = String(f.orcamento ?? "").replace(/\D/g, "");
    const byRef = ref ? open.filter((e) => e.description.replace(/\D+/g, " ").split(" ").includes(ref)) : [];
    const chosen = byRef.length === 1 ? byRef[0] : open.length === 1 ? open[0] : null;
    if (chosen) { f.entry_id = chosen.id; f.entry_label = `${chosen.description} (aberto ${brl(Number(chosen.open_amount))})`; f.entry_open = Number(chosen.open_amount); }
    else {
      const options = open.map((e) => ({ id: e.id, label: `${e.description} · aberto ${brl(Number(e.open_amount))}${e.due_date ? ` · vence ${brDate(e.due_date)}` : ""}` }));
      return { fields: f, missing: `${f.cliente} tem mais de uma conta em aberto. Qual é?\n${optionsText(options)}\n\nResponda com o número.`, choose: { field: "entry_id", options } };
    }
  }
  if (!f.valor) return { fields: f, missing: `Qual o valor recebido? (em aberto: ${brl(Number(f.entry_open ?? 0))})`, choose: null };
  if (f.entry_open && Number(f.valor) > Number(f.entry_open)) return { fields: f, missing: `O valor (${brl(Number(f.valor))}) é maior que o aberto (${brl(Number(f.entry_open))}). Qual o valor certo?`, choose: null };
  return askAccount(pickAccount("conta", "conta_id"), "Em qual conta caiu?") ?? { fields: f, missing: null, choose: null };
}

// ── Resumos ──────────────────────────────────────────────────────────────────

function summaryLines(op: string, f: Fields): string[] {
  const v = f.valor ? brl(Number(f.valor)) : "—";
  const method = METHOD_LABEL[String(f.metodo ?? "")] ?? "—";
  switch (op) {
    case "entrada": return ["Tipo: Entrada", `Valor: ${v}`, `Conta: ${f.conta ?? "—"}`, `Categoria: ${f.categoria_id ? f.categoria : "sem categoria"}`, `Descrição: ${f.descricao ?? "—"}`, ...(f.client_id ? [`Cliente: ${f.cliente} (recibo vai para o WhatsApp dele)`] : []), `Forma: ${method}`, `Data: ${brDate(String(f.data))}`];
    case "saida": return ["Tipo: Saída", `Valor: ${v}`, `Conta: ${f.conta ?? "—"}`, `Categoria: ${f.categoria_id ? f.categoria : "sem categoria"}`, `Descrição: ${f.descricao ?? "—"}`, ...(f.supplier_id ? [`Fornecedor: ${f.fornecedor}`] : []), `Forma: ${method}`, `Data: ${brDate(String(f.data))}`];
    case "transferir": return ["Tipo: Transferência", `Valor: ${v}`, `De: ${f.conta ?? "—"}`, `Para: ${f.conta_destino ?? "—"}`, `Data: ${brDate(String(f.data))}`];
    case "baixa": return ["Tipo: Baixa de pagamento", `Cliente: ${f.cliente}`, `Conta a receber: ${f.entry_label ?? "—"}`, `Valor: ${v}`, `Caiu em: ${f.conta ?? "—"}`, `Forma: ${method}`, `Data: ${brDate(String(f.data))}`, "O recibo vai automático para o WhatsApp do cliente."];
    case "compra": return ["Tipo: Compra (conta a pagar)", `Fornecedor: ${f.fornecedor}`, `Valor: ${v}`, `Descrição: ${f.descricao ?? "—"}`, `Vencimento: ${brDate(String(f.vencimento))}`, `Forma: ${METHOD_LABEL[String(f.metodo ?? "")] ?? "a definir"}`, `Categoria: ${f.categoria_id ? f.categoria : "sem categoria"}`];
    default: return [];
  }
}

function confirmText(title: string, lines: string[]) {
  return `📋 *${title}*\n${lines.join("\n")}\n\nResponda *sim* para confirmar, *não* para cancelar, ou mande a correção (ex.: "valor 35").`;
}

// ── Log (pendências) ─────────────────────────────────────────────────────────

const LOG_COLS = "id,op,status,fields,choose,summary,result,target_id,created_at";

async function pendingOf(ctx: CommandContext): Promise<LogRow | null> {
  const cutoff = new Date(Date.now() - PENDING_MINUTES * 60_000).toISOString();
  await ctx.db.from("lia_command_log").update({ status: "expirado", updated_at: new Date().toISOString() })
    .eq("company_id", ctx.companyId).eq("phone", ctx.phone).eq("status", "pendente").lt("updated_at", cutoff);
  const { data } = await ctx.db.from("lia_command_log").select(LOG_COLS).eq("company_id", ctx.companyId).eq("phone", ctx.phone)
    .eq("status", "pendente").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as LogRow | null) ?? null;
}

async function setStatus(ctx: CommandContext, id: string, patch: Record<string, unknown>) {
  await ctx.db.from("lia_command_log").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("company_id", ctx.companyId);
}

async function cancelPending(ctx: CommandContext) {
  await ctx.db.from("lia_command_log").update({ status: "cancelado", updated_at: new Date().toISOString() })
    .eq("company_id", ctx.companyId).eq("phone", ctx.phone).eq("status", "pendente");
}

// ── Fluxo de escrita: monta, pergunta o que falta, resume ─────────────────────

async function prepare(ctx: CommandContext, sender: CommandSender, log: LogRow | null, op: WriteOp, text: string, extra: { target?: LogRow } = {}) {
  const refs = { accounts: await accounts(ctx.db, ctx.companyId), categories: await categories(ctx.db, ctx.companyId) };
  const current = log?.fields ?? (extra.target ? { ...extra.target.fields } : {});
  const fields = text ? await extractFields(ctx, op, text, current, refs) : current;
  const r = await resolve(ctx, op, fields, refs);
  const target = extra.target ?? (log?.target_id ? await logById(ctx, log.target_id) : null);
  let summary: string | null = null;
  if (!r.missing) {
    const lines = summaryLines(op, r.fields);
    if (target) {
      const before = summaryLines(op, target.fields);
      const changed = lines.map((l, i) => (l !== before[i] ? `${l}  _(antes: ${before[i]?.split(": ").slice(1).join(": ") ?? "—"})_` : l));
      summary = confirmText("Corrigir o último lançamento?", [...changed, "", "O lançamento anterior será estornado e este entra no lugar."]);
    } else summary = confirmText(op === "baixa" ? "Confirma a baixa?" : "Confirma o lançamento?", lines);
  }
  const row = { op, fields: r.fields, choose: r.choose, summary, status: "pendente" };
  if (log) await setStatus(ctx, log.id, row);
  else await ctx.db.from("lia_command_log").insert({ ...row, company_id: ctx.companyId, phone: ctx.phone, profile_id: sender.profileId, command_text: text.slice(0, 1000), target_id: extra.target?.id ?? null });
  await ctx.reply(r.missing ?? summary!);
}

async function logById(ctx: CommandContext, id: string): Promise<LogRow | null> {
  const { data } = await ctx.db.from("lia_command_log").select(LOG_COLS).eq("id", id).eq("company_id", ctx.companyId).maybeSingle();
  return (data as LogRow | null) ?? null;
}

async function execute(ctx: CommandContext, sender: CommandSender, action: Record<string, unknown>) {
  const { data, error } = await ctx.db.rpc("lia_command_execute", { p_company: ctx.companyId, p_profile: sender.profileId, p_action: action });
  if (error) throw new Error(error.message);
  return (data ?? {}) as { entry_ids?: string[]; payment_ids?: string[] };
}

async function confirm(ctx: CommandContext, sender: CommandSender, log: LogRow) {
  if (!log.summary) { await ctx.reply("Ainda falta informação. Responda a pergunta acima ou mande /cancelar."); return; }
  // Trava: só um "sim" executa (mensagens duplicadas ou dois toques).
  const { data: claimed } = await ctx.db.from("lia_command_log").update({ status: "confirmado", updated_at: new Date().toISOString() })
    .eq("id", log.id).eq("status", "pendente").select("id");
  if (!claimed?.length) return;
  try {
    const f = log.fields;
    if (log.op === "desfazer") {
      const target = log.target_id ? await logById(ctx, log.target_id) : null;
      if (!target?.result) throw new Error("Lançamento original não encontrado.");
      await execute(ctx, sender, { op: "estornar", payment_ids: target.result.payment_ids ?? [], entry_ids: target.result.entry_ids ?? [], motivo: "Desfeito pela Lia (comando WhatsApp)" });
      await setStatus(ctx, target.id, { status: "desfeito" });
      await setStatus(ctx, log.id, { result: { ok: true } });
      await ctx.reply("✅ Desfeito. O lançamento foi estornado no Financeiro.");
      return;
    }
    if (log.op === "recibo") {
      const res = await execute(ctx, sender, { op: "reenviar_recibo", payment_id: f.payment_id });
      await setStatus(ctx, log.id, { result: res });
      await scheduleReceipt(String(f.payment_id));
      await ctx.reply(`✅ Recibo reenviado para ${f.cliente}.`);
      return;
    }
    if (log.op === "relatorio") {
      await ctx.sendTo(String(f.destino_phone), String(f.report));
      await setStatus(ctx, log.id, { result: { sent_to: f.destino_phone } });
      await ctx.reply("✅ Relatório enviado ao financeiro.");
      return;
    }
    // Correção do último: estorna o anterior e lança o novo.
    const target = log.target_id ? await logById(ctx, log.target_id) : null;
    if (target && (target.status !== "confirmado" || !target.result)) throw new Error("O lançamento anterior já foi desfeito ou alterado.");
    // Estorno do anterior e lançamento novo na mesma transação.
    const res = await execute(ctx, sender, {
      ...(target?.result ? { substituir: { payment_ids: target.result.payment_ids ?? [], entry_ids: target.result.entry_ids ?? [] }, motivo: "Corrigido pela Lia (comando WhatsApp)" } : {}),
      op: log.op, valor: f.valor, data: f.data, metodo: f.metodo, descricao: f.descricao, conta_id: f.conta_id, conta_destino_id: f.conta_destino_id,
      client_id: f.client_id, supplier_id: f.supplier_id, categoria_id: f.categoria_id, vencimento: f.vencimento, entry_id: f.entry_id,
    });
    await setStatus(ctx, log.id, { result: res });
    if (target) await setStatus(ctx, target.id, { status: "desfeito" });
    if (log.op === "baixa" && res.payment_ids?.[0]) await scheduleReceipt(res.payment_ids[0]);
    const done: Record<string, string> = {
      entrada: `✅ Entrada de ${brl(Number(f.valor))} lançada na conta ${f.conta}.`,
      saida: `✅ Saída de ${brl(Number(f.valor))} lançada na conta ${f.conta}.`,
      transferir: `✅ Transferência de ${brl(Number(f.valor))} de ${f.conta} para ${f.conta_destino} lançada.`,
      baixa: `✅ Baixa de ${brl(Number(f.valor))} registrada para ${f.cliente}. O recibo está sendo enviado.`,
      compra: `✅ Compra de ${brl(Number(f.valor))} (${f.fornecedor}) lançada em contas a pagar, vencimento ${brDate(String(f.vencimento))}.`,
    };
    await ctx.reply(`${done[log.op] ?? "✅ Feito."}${target ? " O lançamento anterior foi estornado." : ""}\nPara desfazer: /desfazer`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await setStatus(ctx, log.id, { status: "falhou", error: msg.slice(0, 500) });
    await ctx.reply(`❌ Não consegui concluir: ${msg}\nNada foi alterado. Confira e mande o comando de novo.`);
  }
}

// ── Consultas (sem confirmação) ──────────────────────────────────────────────

async function balances(ctx: CommandContext) {
  const { data, error } = await ctx.db.rpc("lia_command_balances", { p_company: ctx.companyId });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string; balance: number }[];
}

type PaymentRow = { amount: number; paid_at: string; payment_method: string | null; receiving_account_name: string | null; receiving_account_id: string | null; entry: { entry_type: string; description: string } | null };

async function payments(ctx: CommandContext, from: string, to: string, accountId?: string) {
  let q = ctx.db.from("payments").select("amount,paid_at,payment_method,receiving_account_name,receiving_account_id,entry:financial_entries(entry_type,description)")
    .eq("company_id", ctx.companyId).is("reversed_at", null).gte("paid_at", from).lte("paid_at", to).order("paid_at", { ascending: false }).limit(1000);
  if (accountId) q = q.eq("receiving_account_id", accountId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PaymentRow[];
}

const sign = (p: PaymentRow) => (p.entry?.entry_type === "pagar" ? -1 : 1);

async function querySaldo(ctx: CommandContext, rest: string) {
  const list = await balances(ctx);
  const one = rest ? bestMatch(rest, list) : null;
  const rows = one ? [one] : list;
  if (!rows.length) return "Nenhuma conta cadastrada no Financeiro.";
  const total = rows.reduce((n, r) => n + Number(r.balance), 0);
  return `💰 *Saldo${one ? "" : " das contas"}*\n${rows.map((r) => `${r.name}: ${brl(Number(r.balance))}`).join("\n")}${one ? "" : `\n\n*Total: ${brl(total)}*`}`;
}

async function queryExtrato(ctx: CommandContext, rest: string) {
  const list = await accounts(ctx.db, ctx.companyId);
  const days = Math.min(Number(rest.match(/(\d{1,3})\s*dias?/i)?.[1] ?? 7), 90);
  const acc = bestMatch(rest.replace(/\d+\s*dias?/i, "").trim(), list);
  if (!acc) return `De qual conta? Ex.: /extrato ${list[0]?.name ?? "Anderson"} 7 dias\nContas: ${list.map((a) => a.name).join(", ")}`;
  const today = todayISO();
  const rows = await payments(ctx, addDaysISO(today, -days), today, acc.id);
  if (!rows.length) return `Sem lançamentos na conta ${acc.name} nos últimos ${days} dias.`;
  const lines = rows.slice(0, 25).map((p) => `${brDate(p.paid_at).slice(0, 5)} ${sign(p) > 0 ? "➕" : "➖"} ${brl(Number(p.amount))} · ${(p.entry?.description ?? "").slice(0, 40)}`);
  const inn = rows.filter((p) => sign(p) > 0).reduce((n, p) => n + Number(p.amount), 0);
  const out = rows.filter((p) => sign(p) < 0).reduce((n, p) => n + Number(p.amount), 0);
  return `📄 *Extrato ${acc.name}* (${days} dias)\n${lines.join("\n")}${rows.length > 25 ? `\n…e mais ${rows.length - 25}` : ""}\n\nEntradas: ${brl(inn)}\nSaídas: ${brl(out)}`;
}

async function queryCaixaHoje(ctx: CommandContext) {
  const today = todayISO();
  const rows = await payments(ctx, today, today);
  const inn = rows.filter((p) => sign(p) > 0).reduce((n, p) => n + Number(p.amount), 0);
  const out = rows.filter((p) => sign(p) < 0).reduce((n, p) => n + Number(p.amount), 0);
  const lines = rows.slice(0, 20).map((p) => `${sign(p) > 0 ? "➕" : "➖"} ${brl(Number(p.amount))} · ${(p.entry?.description ?? "").slice(0, 35)}${p.receiving_account_name ? ` (${p.receiving_account_name})` : ""}`);
  const bal = await balances(ctx);
  return `🧾 *Caixa de hoje* (${brDate(today)})\n${lines.join("\n") || "Nenhum lançamento hoje."}\n\nEntradas: ${brl(inn)}\nSaídas: ${brl(out)}\nResultado: ${brl(inn - out)}\n\n*Saldos*\n${bal.map((b) => `${b.name}: ${brl(Number(b.balance))}`).join("\n")}`;
}

async function queryDevendo(ctx: CommandContext) {
  const { data, error } = await ctx.db.from("financial_entries").select("open_amount,due_date,client:clients(id,name)")
    .eq("company_id", ctx.companyId).eq("entry_type", "receber").gt("open_amount", 0).neq("status", "cancelado").not("client_id", "is", null).limit(2000);
  if (error) throw new Error(error.message);
  const today = todayISO();
  const by = new Map<string, { name: string; open: number; late: number }>();
  for (const e of (data ?? []) as unknown as { open_amount: number; due_date: string | null; client: { id: string; name: string } | null }[]) {
    if (!e.client) continue;
    const cur = by.get(e.client.id) ?? { name: e.client.name, open: 0, late: 0 };
    cur.open += Number(e.open_amount);
    if (e.due_date && e.due_date < today) cur.late += Number(e.open_amount);
    by.set(e.client.id, cur);
  }
  const list = [...by.values()].sort((a, b) => b.open - a.open);
  if (!list.length) return "Ninguém com saldo em aberto. 🎉";
  const total = list.reduce((n, c) => n + c.open, 0);
  return `📌 *Saldos em aberto* (${list.length} clientes)\n${list.slice(0, 20).map((c, i) => `${i + 1}. ${c.name}: ${brl(c.open)}${c.late ? ` (vencido ${brl(c.late)})` : ""}`).join("\n")}${list.length > 20 ? `\n…e mais ${list.length - 20}` : ""}\n\n*Total: ${brl(total)}*`;
}

async function queryCliente(ctx: CommandContext, rest: string) {
  if (!rest) return "De qual cliente? Ex.: /cliente Alexei";
  const found = await searchNamed(ctx.db, "clients", ctx.companyId, rest);
  if (!found.length) return `Não achei o cliente "${rest}".`;
  if (found.length > 1) return `Achei mais de um. Mande o nome completo:\n${found.map((c) => `• ${c.label}`).join("\n")}`;
  const c = found[0];
  const [{ data: quotes }, { data: entries }, { data: client }] = await Promise.all([
    ctx.db.from("quotes").select("status").eq("company_id", ctx.companyId).eq("client_id", c.id).limit(500),
    ctx.db.from("financial_entries").select("total_amount,paid_amount,open_amount,due_date,status").eq("company_id", ctx.companyId).eq("client_id", c.id).eq("entry_type", "receber").neq("status", "cancelado").limit(500),
    ctx.db.from("clients").select("phone,whatsapp,city").eq("id", c.id).maybeSingle(),
  ]);
  const qs = (quotes ?? []) as { status: string }[];
  const count = (s: string[]) => qs.filter((q) => s.includes(q.status)).length;
  const es = (entries ?? []) as { total_amount: number; paid_amount: number; open_amount: number; due_date: string | null }[];
  const sum = (k: "total_amount" | "paid_amount" | "open_amount") => es.reduce((n, e) => n + Number(e[k]), 0);
  const late = es.filter((e) => e.due_date && e.due_date < todayISO()).reduce((n, e) => n + Number(e.open_amount), 0);
  const cl = client as { phone: string | null; whatsapp: string | null; city: string | null } | null;
  return [
    `👤 *${c.label}*`,
    [cl?.whatsapp ?? cl?.phone, cl?.city].filter(Boolean).join(" · "),
    "",
    `Orçamentos: ${qs.length} (enviados ${count(["enviado"])}, fechados ${count(["aprovado", "fechado"])})`,
    `Vendido: ${brl(sum("total_amount"))}`,
    `Pago: ${brl(sum("paid_amount"))}`,
    `*Saldo a pagar: ${brl(sum("open_amount"))}*${late ? `\nVencido: ${brl(late)}` : ""}`,
  ].filter((l, i) => l || i === 2).join("\n");
}

async function buildReport(ctx: CommandContext, rest: string) {
  const today = todayISO();
  const month = /m[eê]s/i.test(rest);
  const from = month ? `${today.slice(0, 8)}01` : addDaysISO(today, -6);
  const rows = await payments(ctx, from, today);
  const inn = rows.filter((p) => sign(p) > 0).reduce((n, p) => n + Number(p.amount), 0);
  const out = rows.filter((p) => sign(p) < 0).reduce((n, p) => n + Number(p.amount), 0);
  const byAcc = new Map<string, number>();
  for (const p of rows) byAcc.set(p.receiving_account_name ?? "Sem conta", (byAcc.get(p.receiving_account_name ?? "Sem conta") ?? 0) + sign(p) * Number(p.amount));
  const bal = await balances(ctx);
  return [
    `📊 *Relatório ${month ? "do mês" : "da semana"}* (${brDate(from)} a ${brDate(today)})`,
    "",
    `Entradas: ${brl(inn)}`,
    `Saídas: ${brl(out)}`,
    `*Resultado: ${brl(inn - out)}*`,
    "",
    "*Movimento por conta*",
    ...[...byAcc.entries()].map(([n, v]) => `${n}: ${brl(v)}`),
    "",
    "*Saldos hoje*",
    ...bal.map((b) => `${b.name}: ${brl(Number(b.balance))}`),
  ].join("\n");
}

// ── Entrada principal ─────────────────────────────────────────────────────────

/**
 * Trata a mensagem se for comando (ou resposta a um comando pendente).
 * Devolve false quando não é comando: a mensagem segue o fluxo normal do Atendimento.
 */
export async function handleLiaCommand(ctxIn: CommandContext, sender: CommandSender): Promise<boolean> {
  let ctx = ctxIn;
  // Áudio transcrito chega como "[áudio] ..."; o que vale é o que foi dito.
  let text = ctx.text.trim().replace(/^\[áudio\]\s*/i, "").replace(/[.!]+$/, "").trim();
  let cmd = parseCommand(text);
  const pending = await pendingOf(ctx);
  // Sem barra, começando por "Lia" (escrito ou falado): descobre o comando pelo que foi dito.
  if (!cmd) {
    const called = stripLiaCall(text);
    if (called !== null) {
      if (pending && (isYes(called) || isNo(called) || pickedOption(called, pending.choose?.options.length ?? 0) !== null)) text = called;
      else {
        const op = detectOp(called) ?? await classifyOp(ctx, called);
        if (op) cmd = { op, rest: op === "editar" && pending ? called.replace(/^(corrig\S*|edit\S*|alter\S*|mud\S*|troc\S*)\s*/i, "") : called };
        else { await ctx.reply("Não entendi o que fazer. Fale começando com \"Lia\" e o que quer, por exemplo: \"Lia, lança entrada de 30 reais na conta do Anderson\". Mande /ajuda para ver a lista."); return true; }
      }
    }
  }
  ctx = { ...ctx, text };

  if (!cmd) {
    if (!pending) return false;
    if (isYes(text)) { await confirm(ctx, sender, pending); return true; }
    if (isNo(text)) { await setStatus(ctx, pending.id, { status: "cancelado" }); await ctx.reply("Cancelado. Nada foi lançado."); return true; }
    if (pending.choose) {
      const i = pickedOption(text, pending.choose.options.length);
      if (i !== null) {
        const opt = pending.choose.options[i];
        const fields: Fields = { ...pending.fields, [pending.choose.field]: opt.id };
        const nameKey = Object.entries(ID_OF).find(([, id]) => id === pending.choose!.field)?.[0];
        if (nameKey) fields[nameKey] = opt.label;
        if (pending.choose.field === "entry_id") fields.entry_label = opt.label;
        if (pending.choose.field === "entry_id") {
          const { data } = await ctx.db.from("financial_entries").select("open_amount").eq("id", opt.id).maybeSingle();
          fields.entry_open = Number((data as { open_amount: number } | null)?.open_amount ?? 0);
        }
        await setStatus(ctx, pending.id, { fields, choose: null });
        await prepare(ctx, sender, { ...pending, fields, choose: null }, pending.op as WriteOp, "");
        return true;
      }
    }
    if (!(WRITE_OPS as readonly string[]).includes(pending.op)) { await ctx.reply("Responda *sim* para confirmar ou *não* para cancelar."); return true; }
    await prepare(ctx, sender, pending, pending.op as WriteOp, text);
    return true;
  }

  if ("unknown" in cmd) { await ctx.reply(`Não conheço o comando /${cmd.unknown}. Mande /ajuda para ver a lista.`); return true; }
  const { op, rest } = cmd;

  try {
    switch (op) {
      case "ajuda": await ctx.reply(HELP_TEXT); return true;
      case "cancelar":
        if (pending) { await cancelPending(ctx); await ctx.reply("Cancelado. Nada foi lançado."); }
        else await ctx.reply("Não há nenhum comando pendente.");
        return true;
      case "editar": {
        if (/^[uú]ltimo\b/i.test(rest)) {
          const { data } = await ctx.db.from("lia_command_log").select(LOG_COLS).eq("company_id", ctx.companyId).eq("phone", ctx.phone)
            .eq("status", "confirmado").in("op", WRITE_OPS as unknown as string[]).order("created_at", { ascending: false }).limit(1).maybeSingle();
          const target = data as LogRow | null;
          if (!target?.result) { await ctx.reply("Não achei lançamento seu feito por comando para corrigir."); return true; }
          await cancelPending(ctx);
          await prepare(ctx, sender, null, target.op as WriteOp, rest.replace(/^[uú]ltimo\s*/i, ""), { target });
          return true;
        }
        if (!pending) { await ctx.reply("Não há resumo pendente. Para corrigir o que já foi lançado: /editar último valor 35,00"); return true; }
        if (!(WRITE_OPS as readonly string[]).includes(pending.op)) { await ctx.reply("Esse comando não tem o que editar. Responda *sim* ou *não*."); return true; }
        await prepare(ctx, sender, pending, pending.op as WriteOp, rest);
        return true;
      }
      case "saldo": await ctx.reply(await querySaldo(ctx, rest)); return true;
      case "extrato": await ctx.reply(await queryExtrato(ctx, rest)); return true;
      case "caixa": await ctx.reply(await queryCaixaHoje(ctx)); return true;
      case "devendo": await ctx.reply(await queryDevendo(ctx)); return true;
      case "cliente": await ctx.reply(await queryCliente(ctx, rest)); return true;
      case "relatorio": {
        const report = await buildReport(ctx, rest);
        if (!/financeiro/i.test(rest)) { await ctx.reply(report); return true; }
        const { data } = await ctx.db.from("lia_command_phones").select("phone").eq("company_id", ctx.companyId).eq("active", true).ilike("label", "financeiro").maybeSingle();
        const to = (data as { phone: string } | null)?.phone;
        if (!to) { await ctx.reply("Número do financeiro não cadastrado."); return true; }
        await cancelPending(ctx);
        const summary = `${report}\n\n———\nEnviar este relatório para o WhatsApp do financeiro? Responda *sim* ou *não*.`;
        await ctx.db.from("lia_command_log").insert({ company_id: ctx.companyId, phone: ctx.phone, profile_id: sender.profileId, op: "relatorio", command_text: text, fields: { report, destino_phone: to }, summary });
        await ctx.reply(summary);
        return true;
      }
      case "desfazer": {
        const { data } = await ctx.db.from("lia_command_log").select(LOG_COLS).eq("company_id", ctx.companyId).eq("phone", ctx.phone)
          .eq("status", "confirmado").in("op", WRITE_OPS as unknown as string[]).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const target = data as LogRow | null;
        if (!target?.result) { await ctx.reply("Não achei lançamento seu feito por comando para desfazer."); return true; }
        await cancelPending(ctx);
        const summary = confirmText("Desfazer este lançamento?", [...summaryLines(target.op, target.fields), `Lançado em: ${new Date(target.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, "", "Ele será estornado no Financeiro."]);
        await ctx.db.from("lia_command_log").insert({ company_id: ctx.companyId, phone: ctx.phone, profile_id: sender.profileId, op: "desfazer", command_text: text, target_id: target.id, summary });
        await ctx.reply(summary);
        return true;
      }
      case "recibo": {
        if (!rest) { await ctx.reply("De qual cliente? Ex.: /recibo Jonata"); return true; }
        const found = await searchNamed(ctx.db, "clients", ctx.companyId, rest.replace(/\b[uú]ltimo\b/i, "").trim());
        if (found.length !== 1) { await ctx.reply(found.length ? `Achei mais de um. Mande o nome completo:\n${found.map((c) => `• ${c.label}`).join("\n")}` : `Não achei o cliente "${rest}".`); return true; }
        const { data } = await ctx.db.from("payment_receipts").select("payment_id,receipt_number,status,payment:payments(amount,paid_at)")
          .eq("company_id", ctx.companyId).eq("client_id", found[0].id).neq("status", "cancelado").order("receipt_number", { ascending: false }).limit(1).maybeSingle();
        const rec = data as unknown as { payment_id: string; receipt_number: number; payment: { amount: number; paid_at: string } | null } | null;
        if (!rec) { await ctx.reply(`${found[0].label} não tem recibo para reenviar.`); return true; }
        await cancelPending(ctx);
        const summary = confirmText("Reenviar recibo?", [`Cliente: ${found[0].label}`, `Recibo nº ${String(rec.receipt_number).padStart(6, "0")}`, `Valor: ${brl(Number(rec.payment?.amount ?? 0))} · ${brDate(rec.payment?.paid_at)}`]);
        await ctx.db.from("lia_command_log").insert({ company_id: ctx.companyId, phone: ctx.phone, profile_id: sender.profileId, op: "recibo", command_text: text, fields: { payment_id: rec.payment_id, cliente: found[0].label }, summary });
        await ctx.reply(summary);
        return true;
      }
      default: {
        // entrada, saida, transferir, baixa, compra
        if (!rest) {
          const ex: Record<string, string> = { entrada: "/entrada 30,00 conta Anderson, calha vendida na hora", saida: "/saida 85,00 gasolina, conta Marquinhos", transferir: "/transferir 500 da conta Anderson para Marquinhos", baixa: "/baixa Jonata 2.000 Pix orçamento 1738", compra: "/compra Figueira 1.250,00 perfis, boleto 30 dias" };
          await ctx.reply(`Faltou o conteúdo. Ex.: ${ex[op]}`);
          return true;
        }
        await cancelPending(ctx);
        await prepare(ctx, sender, null, op as WriteOp, rest);
        return true;
      }
    }
  } catch (error) {
    console.error("Lia comandos:", error);
    await ctx.reply(`❌ Erro ao processar o comando: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}

export type { CommandOp };
